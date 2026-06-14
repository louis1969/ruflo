import type { LLMProvider } from '../../types/index.js';
import type { TaskType } from '../router/types.js';
import type { EvalResult, CalibrationEntry } from './types.js';

interface ProviderTaskBucket {
  provider: LLMProvider;
  taskType: TaskType;
  scores: number[];
}

// Groups eval results and computes per-(provider, taskType) averages.
// Returns entries only for groups with enough samples to be statistically meaningful.
export function computeCalibration(
  evals: EvalResult[],
  minSamples = 3
): CalibrationEntry[] {
  const buckets = new Map<string, ProviderTaskBucket>();

  for (const e of evals) {
    const key = `${e.provider}::${e.taskType}`;
    const existing = buckets.get(key) ?? {
      provider: e.provider,
      taskType: e.taskType,
      scores:   [],
    };
    existing.scores.push(e.qualityScore);
    buckets.set(key, existing);
  }

  const entries: CalibrationEntry[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.scores.length < minSamples) continue;
    const avg = bucket.scores.reduce((s, v) => s + v, 0) / bucket.scores.length;
    entries.push({
      provider:    bucket.provider,
      taskType:    bucket.taskType,
      avgQuality:  Math.round(avg * 1000) / 1000,
      sampleCount: bucket.scores.length,
    });
  }

  return entries;
}

// Summarises which provider wins each taskType.
export function topProviderByTask(
  entries: CalibrationEntry[]
): Partial<Record<TaskType, LLMProvider>> {
  const best = new Map<TaskType, { provider: LLMProvider; quality: number }>();

  for (const e of entries) {
    const current = best.get(e.taskType);
    if (!current || e.avgQuality > current.quality) {
      best.set(e.taskType, { provider: e.provider, quality: e.avgQuality });
    }
  }

  return Object.fromEntries([...best.entries()].map(([t, v]) => [t, v.provider])) as
    Partial<Record<TaskType, LLMProvider>>;
}
