import type { IRoutingStrategy, TaskProfile, ProviderStats, RankedProvider } from '../types.js';
import type { HeuristicStore } from '../heuristics.js';

// Score = (1 / avgLatencyMs) * capability_weight
// For realtime tasks, latency dominates (weight 0.9). For normal, it's balanced (0.6).
const LATENCY_WEIGHT: Record<string, number> = {
  realtime: 0.9,
  normal:   0.6,
  batch:    0.3,
};

export class LatencyStrategy implements IRoutingStrategy {
  readonly name = 'latency' as const;

  constructor(private readonly heuristics: HeuristicStore) {}

  select(profile: TaskProfile, providers: ProviderStats[]): RankedProvider[] {
    const latW = LATENCY_WEIGHT[profile.latencySensitivity] ?? 0.6;
    const capW = 1 - latW;

    return providers
      .map((p) => {
        const latencyScore = (1 / p.avgLatencyMs) * 10_000;
        const capScore     = p.capabilities[profile.type];
        const base         = latW * latencyScore + capW * capScore;
        const score        = this.heuristics.effectiveScore(p.provider, profile.type, base);
        return {
          provider: p.provider,
          score,
          reason: `latency=${p.avgLatencyMs}ms (weight=${latW}) + cap=${capScore.toFixed(2)} (weight=${capW})`,
        };
      })
      .sort((a, b) => b.score - a.score);
  }
}
