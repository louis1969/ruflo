import type { LLMProvider } from '../../types/index.js';
import type { SwarmJob, AgentResult } from '../swarm/types.js';
import type { EvalResult, ProviderMetrics, MetricsSnapshot, CalibrationEntry } from './types.js';
import type { TaskType } from '../router/types.js';

// ── Snapshot builder ─────────────────────────────────────────────────────────

export function buildSnapshot(
  jobs: SwarmJob[],
  evals: EvalResult[],
  calibration: CalibrationEntry[],
  heuristicUpdateCount: number
): MetricsSnapshot {
  const evalMap = new Map(evals.map((e) => [e.taskId, e]));

  // Flatten all AgentResults.
  const allResults: AgentResult[] = jobs.flatMap((j) => j.results);

  // Group by provider.
  const byProvider = new Map<LLMProvider, AgentResult[]>();
  for (const r of allResults) {
    const list = byProvider.get(r.provider) ?? [];
    list.push(r);
    byProvider.set(r.provider, list);
  }

  const providerMetrics: ProviderMetrics[] = [...byProvider.entries()].map(([provider, results]) => {
    const successCount = results.filter((r) => r.success).length;
    const scoredResults = results.filter((r) => evalMap.has(r.taskId));
    const avgQuality = scoredResults.length > 0
      ? scoredResults.reduce((s, r) => s + (evalMap.get(r.taskId)?.qualityScore ?? 0), 0) / scoredResults.length
      : null;

    // Per-taskType breakdown.
    const byTask = new Map<TaskType, { calls: number; scores: number[] }>();
    for (const r of results) {
      const taskType = evalMap.get(r.taskId)?.taskType;
      if (!taskType) continue;
      const entry = byTask.get(taskType) ?? { calls: 0, scores: [] };
      entry.calls += 1;
      const score = evalMap.get(r.taskId)?.qualityScore;
      if (score !== undefined) entry.scores.push(score);
      byTask.set(taskType, entry);
    }

    const byTaskType: ProviderMetrics['byTaskType'] = {};
    for (const [taskType, data] of byTask) {
      byTaskType[taskType] = {
        calls: data.calls,
        avgQuality: data.scores.length > 0
          ? data.scores.reduce((a, b) => a + b, 0) / data.scores.length
          : null,
      };
    }

    return {
      provider,
      callCount:    results.length,
      successRate:  results.length > 0 ? successCount / results.length : 0,
      avgQuality:   avgQuality !== null ? Math.round(avgQuality * 1000) / 1000 : null,
      avgLatencyMs: results.length > 0
        ? results.reduce((s, r) => s + r.latencyMs, 0) / results.length
        : 0,
      totalCostUsd: results.reduce((s, r) => s + r.costUsd, 0),
      byTaskType,
    };
  });

  // Overall stats — coverage is calculated against THIS window's results only.
  const totalResults  = allResults.length;
  const windowTaskIds = new Set(allResults.map((r) => r.taskId));
  const windowEvals   = evals.filter((e) => windowTaskIds.has(e.taskId));
  const scoredCount   = windowEvals.length;
  const successCount  = allResults.filter((r) => r.success).length;
  // avgQuality uses ALL evals (historical) for a stable metric across runs.
  const avgQualityAll = evals.length > 0
    ? evals.reduce((s, e) => s + e.qualityScore, 0) / evals.length
    : null;
  const avgLatency = totalResults > 0
    ? allResults.reduce((s, r) => s + r.latencyMs, 0) / totalResults
    : 0;
  const totalCost = allResults.reduce((s, r) => s + r.costUsd, 0);

  // Top provider per taskType from calibration data.
  const topProviderByTask: Partial<Record<TaskType, LLMProvider>> = {};
  const bestByTask = new Map<TaskType, { provider: LLMProvider; quality: number }>();
  for (const e of calibration) {
    const curr = bestByTask.get(e.taskType);
    if (!curr || e.avgQuality > curr.quality) {
      bestByTask.set(e.taskType, { provider: e.provider, quality: e.avgQuality });
    }
  }
  for (const [t, v] of bestByTask) {
    topProviderByTask[t] = v.provider;
  }

  return {
    timestamp:            Date.now(),
    windowJobCount:       jobs.length,
    providers:            providerMetrics,
    topProviderByTask,
    overall: {
      successRate:   totalResults > 0 ? successCount / totalResults : 0,
      avgQuality:    avgQualityAll !== null ? Math.round(avgQualityAll * 1000) / 1000 : null,
      totalCostUsd:  Math.round(totalCost * 1_000_000) / 1_000_000,
      avgLatencyMs:  Math.round(avgLatency),
      evalCoverage:  totalResults > 0 ? scoredCount / totalResults : 0,
    },
    heuristicUpdateCount,
  };
}

// ── Recommendation engine ─────────────────────────────────────────────────────

export function generateRecommendations(
  snapshot: MetricsSnapshot,
  prev?: MetricsSnapshot
): string[] {
  const recs: string[] = [];
  const { providers, overall, topProviderByTask } = snapshot;

  // Coverage warning — only meaningful when there were results to score.
  if (snapshot.windowJobCount > 0 && overall.evalCoverage < 0.5) {
    recs.push(`Only ${Math.round(overall.evalCoverage * 100)}% of results scored — run evaluator more frequently to improve learning signal.`);
  }

  // Provider cost/quality trade-off.
  const sorted = [...providers].sort((a, b) => (b.avgQuality ?? 0) - (a.avgQuality ?? 0));
  if (sorted.length >= 2) {
    const best  = sorted[0]!;
    const cheap = [...providers].sort((a, b) => a.totalCostUsd - b.totalCostUsd)[0]!;
    if (cheap.provider !== best.provider && cheap.avgQuality !== null && best.avgQuality !== null) {
      const qualityGap = Math.round((best.avgQuality - cheap.avgQuality) * 100);
      if (qualityGap < 20 && cheap.totalCostUsd * 5 < best.totalCostUsd) {
        recs.push(
          `Cost opportunity: "${cheap.provider}" achieves similar quality to "${best.provider}" ` +
          `(gap: ${qualityGap}%) at significantly lower cost. Consider "cost" strategy for low-complexity tasks.`
        );
      }
    }
  }

  // High failure rates.
  for (const p of providers) {
    if (p.callCount >= 3 && p.successRate < 0.80) {
      recs.push(
        `Provider "${p.provider}" has ${Math.round((1 - p.successRate) * 100)}% failure rate ` +
        `— circuit breaker may activate. Investigate connectivity or quota limits.`
      );
    }
  }

  // Provider-taskType underperformance.
  for (const p of providers) {
    for (const [taskType, data] of Object.entries(p.byTaskType) as [TaskType, { calls: number; avgQuality: number | null }][]) {
      if (data.calls < 3 || data.avgQuality === null) continue;
      const winner = topProviderByTask[taskType];
      if (winner && winner !== p.provider) {
        const winnerMetrics = providers.find((x) => x.provider === winner);
        const winnerQ = winnerMetrics?.byTaskType[taskType]?.avgQuality;
        if (winnerQ !== null && winnerQ !== undefined && winnerQ - data.avgQuality > 0.15) {
          recs.push(
            `"${p.provider}" scores ${Math.round(data.avgQuality * 100)}% quality on "${taskType}" tasks ` +
            `vs "${winner}" at ${Math.round(winnerQ * 100)}% — routing heuristics will auto-adjust.`
          );
        }
      }
    }
  }

  // Trend detection vs previous snapshot.
  if (prev) {
    const delta = (overall.avgQuality ?? 0) - (prev.overall.avgQuality ?? 0);
    if (delta > 0.05) {
      recs.push(`Quality improved +${Math.round(delta * 100)}% since last run — heuristic updates are taking effect.`);
    } else if (delta < -0.05) {
      recs.push(`Quality dropped ${Math.round(Math.abs(delta) * 100)}% since last run — investigate recent task failures or provider degradation.`);
    }
  }

  // Heuristic update acknowledgement.
  if (snapshot.heuristicUpdateCount > 0) {
    recs.push(`${snapshot.heuristicUpdateCount} heuristic weight(s) updated — routing will reflect new quality signals on next task.`);
  }

  if (recs.length === 0) {
    recs.push('All systems nominal. No immediate action required.');
  }

  return recs;
}
