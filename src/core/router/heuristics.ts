import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import type { LLMProvider } from '../../types/index.js';
import type { HeuristicWeights, RouteOutcome, TaskType } from './types.js';
import type { CalibrationEntry } from '../learning/types.js';

const EMA_ALPHA = 0.15; // Learning rate for quality EMA.
const PENALTY_STEP = 0.05;
const MULTIPLIER_DECAY = 0.02;
const MULTIPLIER_BOOST = 0.03;

function defaultWeights(providers: LLMProvider[]): HeuristicWeights {
  const providerMultiplier = Object.fromEntries(
    providers.map((p) => [p, 1.0])
  ) as Record<LLMProvider, number>;

  return {
    providerMultiplier,
    taskTypePenalty: {},
    qualityEma: {},
    updatedAt: Date.now(),
    totalOutcomes: 0,
  };
}

export class HeuristicStore {
  private weights: HeuristicWeights;
  private readonly path: string;
  private readonly providers: LLMProvider[];

  constructor(storePath: string, providers: LLMProvider[]) {
    this.path = storePath;
    this.providers = providers;
    this.weights = this.load();
  }

  private load(): HeuristicWeights {
    if (!existsSync(this.path)) return defaultWeights(this.providers);
    try {
      return JSON.parse(readFileSync(this.path, 'utf8')) as HeuristicWeights;
    } catch {
      return defaultWeights(this.providers);
    }
  }

  save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.weights, null, 2));
  }

  get(): HeuristicWeights {
    return this.weights;
  }

  // Called by the learning loop after each completed task.
  ingest(outcome: RouteOutcome): void {
    const { provider, taskType, success, actualLatencyMs, qualityScore } = outcome;
    const w = this.weights;
    w.totalOutcomes += 1;

    // Provider-level multiplier: boost on success, decay on failure.
    w.providerMultiplier[provider] ??= 1.0;
    if (success) {
      w.providerMultiplier[provider] = Math.min(
        1.5,
        w.providerMultiplier[provider] + MULTIPLIER_BOOST
      );
    } else {
      w.providerMultiplier[provider] = Math.max(
        0.3,
        w.providerMultiplier[provider] - MULTIPLIER_DECAY
      );
    }

    // Task-type penalty increases on failure, resets toward 0 on success.
    w.taskTypePenalty[provider] ??= {};
    const currentPenalty = w.taskTypePenalty[provider]![taskType] ?? 0;
    if (!success) {
      w.taskTypePenalty[provider]![taskType] = Math.min(0.5, currentPenalty + PENALTY_STEP);
    } else {
      w.taskTypePenalty[provider]![taskType] = Math.max(0, currentPenalty - PENALTY_STEP / 2);
    }

    // Quality EMA — only when a critic score is available.
    if (qualityScore !== null) {
      w.qualityEma[provider] ??= {};
      const prev = w.qualityEma[provider]![taskType] ?? qualityScore;
      w.qualityEma[provider]![taskType] = (1 - EMA_ALPHA) * prev + EMA_ALPHA * qualityScore;
    }

    void actualLatencyMs; // latency adaptation happens in ProviderRegistry EMA
    w.updatedAt = Date.now();
  }

  // Batch cross-provider calibration.
  // For each taskType present in `entries`, compares providers and nudges
  // their multipliers toward their relative quality ranking.
  // Returns the number of multiplier entries updated.
  calibrate(entries: CalibrationEntry[]): number {
    if (entries.length === 0) return 0;
    const w = this.weights;

    // Group by taskType → find best quality among available providers.
    const bestByTask = new Map<TaskType, number>();
    for (const e of entries) {
      const current = bestByTask.get(e.taskType) ?? 0;
      if (e.avgQuality > current) bestByTask.set(e.taskType, e.avgQuality);
    }

    let updates = 0;
    for (const e of entries) {
      const best = bestByTask.get(e.taskType) ?? 1;
      const relPerf = best > 0 ? e.avgQuality / best : 1; // 0–1 relative to winner

      // Also update qualityEma directly from batch statistics.
      w.qualityEma[e.provider] ??= {};
      const prevEma = w.qualityEma[e.provider]![e.taskType] ?? e.avgQuality;
      w.qualityEma[e.provider]![e.taskType] = (1 - EMA_ALPHA) * prevEma + EMA_ALPHA * e.avgQuality;

      // Nudge the provider-level multiplier toward its relative performance.
      // Move 15 % of the gap between current multiplier and relative performance per cycle.
      const current = w.providerMultiplier[e.provider] ?? 1.0;
      const target  = 0.6 + 0.9 * relPerf; // maps [0,1] → [0.6, 1.5]
      const nudge   = (target - current) * 0.15;
      w.providerMultiplier[e.provider] = Math.min(1.5, Math.max(0.3, current + nudge));
      updates++;
    }

    w.updatedAt = Date.now();
    return updates;
  }

  // Effective score modifier for a (provider, taskType) pair.
  effectiveScore(provider: LLMProvider, taskType: TaskType, baseScore: number): number {
    const w = this.weights;
    const multiplier = w.providerMultiplier[provider] ?? 1.0;
    const penalty    = w.taskTypePenalty[provider]?.[taskType] ?? 0;
    const qualityEma = w.qualityEma[provider]?.[taskType];
    // Blend in quality EMA when available (weight 0.3).
    const qualityFactor = qualityEma !== undefined ? 0.7 + 0.3 * qualityEma : 1.0;
    return baseScore * multiplier * (1 - penalty) * qualityFactor;
  }
}
