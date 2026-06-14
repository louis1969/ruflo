import type { LearningMode } from '../../types/index.js';
import type { Router } from '../router/index.js';
import type { MemoryStore } from '../memory/index.js';
import type { SwarmJob, AgentTask } from '../swarm/types.js';
import type { EvalResult, LearningReport, MetricsSnapshot, PromptCandidate } from './types.js';
import { evaluateResult } from './evaluator.js';
import { computeCalibration } from './heuristic-updater.js';
import { detectPatterns, generateCandidates } from './prompt-evolver.js';
import { buildSnapshot, generateRecommendations } from './metrics.js';

export interface LearningConfig {
  mode: LearningMode;
  evalInterval: number;           // jobs between auto-runs (0 = never auto-run)
  minSamplesBeforeAdapt: number;  // minimum evals needed before calibration fires
}

const CURSOR_KEY    = 'cursor';
const SNAP_LIST_KEY = 'snapshots';
const EVAL_NS       = 'eval';
const PROMPT_NS     = 'prompt';
const REPORT_NS     = 'report';

export class LearningLoop {
  private readonly router: Router;
  private readonly memory: MemoryStore;
  private readonly config: LearningConfig;
  // Namespaced stores.
  private readonly evalStore:   MemoryStore;
  private readonly promptStore: MemoryStore;
  private readonly reportStore: MemoryStore;
  private readonly metaStore:   MemoryStore;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(router: Router, memory: MemoryStore, config: LearningConfig) {
    this.router      = router;
    this.memory      = memory;
    this.config      = config;
    this.evalStore   = memory.ns(EVAL_NS);
    this.promptStore = memory.ns(PROMPT_NS);
    this.reportStore = memory.ns(REPORT_NS);
    this.metaStore   = memory.ns('learning');
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async run(): Promise<LearningReport> {
    const runAt = Date.now();

    // 1. Load all completed jobs since the last cursor position.
    const { jobs, newCursor } = await this.loadNewJobs();

    // 2. Evaluate each unscored AgentResult.
    const newEvals: EvalResult[] = [];
    for (const job of jobs) {
      const taskMap = new Map(job.plan.tasks.map((t: AgentTask) => [t.id, t]));
      for (const result of job.results) {
        if (await this.evalStore.exists(result.taskId)) continue; // already scored
        const task = taskMap.get(result.taskId);
        if (!task || !result.success) continue;

        const evalResult = evaluateResult(task, result);
        await this.evalStore.set(result.taskId, evalResult);
        newEvals.push(evalResult);

        // Feed quality score back into heuristics immediately.
        this.router.getHeuristics().ingest({
          decisionId:      task.decision.id,
          provider:        result.provider,
          taskType:        task.decision.taskProfile.type,
          success:         result.success,
          actualLatencyMs: result.latencyMs,
          actualCostUsd:   result.costUsd,
          qualityScore:    evalResult.qualityScore,
        });
      }
    }

    // 3. Batch calibration — compare providers for the same taskType.
    const allEvals = await this.loadAllEvals();
    const calibration = computeCalibration(allEvals, this.config.minSamplesBeforeAdapt);
    let heuristicUpdates = 0;

    if (calibration.length > 0) {
      heuristicUpdates = this.router.getHeuristics().calibrate(calibration);
      this.router.getHeuristics().save();
    }

    // 4. Prompt evolution (pattern analysis + candidate generation).
    let candidates: PromptCandidate[] = [];
    if (this.config.mode === 'prompt-evolution' && allEvals.length > 0) {
      const patterns = detectPatterns(allEvals, jobs);
      candidates = generateCandidates(patterns);
      for (const c of candidates) {
        const key = `${c.agentName}:${c.taskType}:${c.generatedAt}`;
        await this.promptStore.set(key, c);
      }
    }

    // 5. Metrics snapshot.
    const prevSnap = await this.loadLatestSnapshot();
    const snapshot = buildSnapshot(jobs, allEvals, calibration, heuristicUpdates);
    await this.saveSnapshot(snapshot);

    // 6. Recommendations.
    const recommendations = generateRecommendations(snapshot, prevSnap ?? undefined);

    // 7. Persist cursor + report.
    await this.metaStore.set(CURSOR_KEY, newCursor);

    const report: LearningReport = {
      runAt,
      mode:                     this.config.mode,
      jobsAnalyzed:             jobs.length,
      resultsScored:            newEvals.length,
      heuristicUpdates,
      calibrationEntries:       calibration.length,
      promptCandidatesGenerated: candidates.length,
      snapshot,
      recommendations,
    };
    await this.reportStore.set(String(runAt), report);
    await this.reportStore.append<string>('index', String(runAt), 100);

    return report;
  }

  // Start a background loop that runs every intervalMs milliseconds.
  async startBackground(intervalMs: number): Promise<void> {
    this.running = true;
    const tick = async (): Promise<void> => {
      if (!this.running) return;
      await this.run().catch((err) => console.error('[LearningLoop] error:', err));
      if (this.running) this.timer = setTimeout(tick, intervalMs);
    };
    await tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async getLatestReport(): Promise<LearningReport | null> {
    const index = (await this.reportStore.get<string[]>('index')) ?? [];
    const latest = index.at(-1);
    if (!latest) return null;
    return this.reportStore.get<LearningReport>(latest);
  }

  async listCandidates(): Promise<PromptCandidate[]> {
    const keys = await this.promptStore.keys();
    const results: PromptCandidate[] = [];
    for (const k of keys) {
      const c = await this.promptStore.get<PromptCandidate>(k);
      if (c) results.push(c);
    }
    return results;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async loadNewJobs(): Promise<{ jobs: SwarmJob[]; newCursor: number }> {
    const jobStore   = this.memory.ns('job');
    const jobIndex   = (await jobStore.get<string[]>('index')) ?? [];
    const cursor     = (await this.metaStore.get<number>(CURSOR_KEY)) ?? 0;
    const newIds     = jobIndex.slice(cursor);
    const jobs: SwarmJob[] = [];

    for (const id of newIds) {
      const job = await jobStore.get<SwarmJob>(id);
      if (job && (job.status === 'completed' || job.status === 'partial')) {
        jobs.push(job);
      }
    }

    return { jobs, newCursor: cursor + newIds.length };
  }

  private async loadAllEvals(): Promise<EvalResult[]> {
    const keys = await this.evalStore.keys();
    const results: EvalResult[] = [];
    for (const k of keys) {
      const e = await this.evalStore.get<EvalResult>(k);
      if (e) results.push(e);
    }
    return results;
  }

  private async loadLatestSnapshot(): Promise<MetricsSnapshot | null> {
    const list = (await this.metaStore.get<number[]>(SNAP_LIST_KEY)) ?? [];
    const latest = list.at(-1);
    if (!latest) return null;
    return this.metaStore.get<MetricsSnapshot>(`snapshot:${latest}`);
  }

  private async saveSnapshot(snap: MetricsSnapshot): Promise<void> {
    await this.metaStore.set(`snapshot:${snap.timestamp}`, snap);
    await this.metaStore.append<number>(SNAP_LIST_KEY, snap.timestamp, 50);
  }
}

export type { LearningReport, EvalResult, PromptCandidate, MetricsSnapshot } from './types.js';
