import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { LearningReport } from '../../core/learning/types.js';
import type { EvalRun } from '../../core/eval/types.js';

// ── Raw file shapes ────────────────────────────────────────────────────────────

interface FileRecord { value: unknown; expiresAt: number | null }
type RufloStore = Record<string, FileRecord>;

interface HeuristicsFile {
  providerMultiplier: Record<string, number>;
  taskTypePenalty:    Record<string, Record<string, number>>;
  qualityEma:         Record<string, Record<string, number>>;
  updatedAt:          number;
  totalOutcomes:      number;
}

// ── Public types ───────────────────────────────────────────────────────────────

export interface JobSummary {
  id:            string;
  status:        string;
  raw:           string;
  startedAt:     number;
  completedAt?:  number;
  mode?:         string;
  agentsUsed?:   string[];
  providersUsed?: string[];
  totalCostUsd?: number;
  totalLatencyMs?: number;
}

export interface ProviderHeuristic {
  provider:    string;
  multiplier:  number;
  qualityEma:  Record<string, number>;
  avgQuality:  number | null;
}

export interface DashboardData {
  stateDir:        string;
  jobs:            JobSummary[];
  totalJobs:       number;
  heuristics: {
    totalOutcomes: number;
    providers:     ProviderHeuristic[];
    updatedAt:     number;
  } | null;
  latestReport:    LearningReport | null;
  latestEvalRun:   EvalRun | null;
  loadedAt:        number;
}

// ── Loader ────────────────────────────────────────────────────────────────────

function readStore(stateDir: string): RufloStore {
  const path = join(stateDir, 'memory', 'ruflo.json');
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as RufloStore;
  } catch { return {}; }
}

function val<T>(store: RufloStore, key: string): T | null {
  const record = store[key];
  if (!record) return null;
  if (record.expiresAt !== null && record.expiresAt < Date.now()) return null;
  return record.value as T;
}

export function loadDashboardData(stateDir: string): DashboardData {
  const store = readStore(stateDir);

  // ── Jobs ──────────────────────────────────────────────────────────────────
  const jobIndex = val<string[]>(store, 'job:index') ?? [];
  const jobs: JobSummary[] = [];

  // Most recent 10 jobs only — we show the last 8 in the panel.
  for (const id of jobIndex.slice(-10).reverse()) {
    const raw = val<JobSummary & { plan?: { mode?: string }; results?: Array<{ agentName: string; provider: string; costUsd: number; latencyMs: number }> }>(store, `job:${id}`);
    if (!raw) continue;
    const results = raw.results ?? [];
    const agentsUsed = [...new Set(results.map((r) => r.agentName))];
    const providersUsed = [...new Set(results.map((r) => r.provider))];
    const totalCostUsd = results.reduce((s, r) => s + r.costUsd, 0);
    const totalLatencyMs = raw.completedAt ? raw.completedAt - raw.startedAt : undefined;

    jobs.push({
      id:             raw.id,
      status:         raw.status,
      raw:            raw.raw,
      startedAt:      raw.startedAt,
      completedAt:    raw.completedAt,
      mode:           raw.plan?.mode ?? 'sequential',
      agentsUsed,
      providersUsed,
      totalCostUsd,
      totalLatencyMs,
    });
  }

  // ── Heuristics ────────────────────────────────────────────────────────────
  let heuristics: DashboardData['heuristics'] = null;
  const hPath = join(stateDir, 'heuristics.json');
  if (existsSync(hPath)) {
    try {
      const h = JSON.parse(readFileSync(hPath, 'utf8')) as HeuristicsFile;
      const providers: ProviderHeuristic[] = Object.entries(h.providerMultiplier).map(([provider, multiplier]) => {
        const qualityEma = h.qualityEma[provider] ?? {};
        const scores     = Object.values(qualityEma);
        const avgQuality = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
        return { provider, multiplier, qualityEma, avgQuality };
      });
      heuristics = { totalOutcomes: h.totalOutcomes, providers, updatedAt: h.updatedAt };
    } catch { /* non-fatal */ }
  }

  // ── Latest learning report ────────────────────────────────────────────────
  let latestReport: LearningReport | null = null;
  const reportIndex = val<string[]>(store, 'report:index');
  if (reportIndex && reportIndex.length > 0) {
    const lastKey = reportIndex.at(-1)!;
    latestReport = val<LearningReport>(store, `report:${lastKey}`);
  }

  // ── Latest eval run ───────────────────────────────────────────────────────
  let latestEvalRun: EvalRun | null = null;
  const evalPath = join(stateDir, 'eval-runs.json');
  if (existsSync(evalPath)) {
    try {
      const runs = Object.values(JSON.parse(readFileSync(evalPath, 'utf8')) as Record<string, EvalRun>);
      if (runs.length > 0) {
        latestEvalRun = runs.sort((a, b) => b.runAt - a.runAt)[0]!;
      }
    } catch { /* non-fatal */ }
  }

  return {
    stateDir,
    jobs,
    totalJobs:    jobIndex.length,
    heuristics,
    latestReport,
    latestEvalRun,
    loadedAt:     Date.now(),
  };
}
