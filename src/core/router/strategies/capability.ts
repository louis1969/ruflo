import type { IRoutingStrategy, TaskProfile, ProviderStats, HeuristicWeights, RankedProvider } from '../types.js';
import type { HeuristicStore } from '../heuristics.js';

// Score = capability[taskType] * successRate * heuristic(provider, taskType)
// Complexity multiplier: high → prefer higher-capability models.
const COMPLEXITY_WEIGHT = { low: 0.8, medium: 1.0, high: 1.2 } as const;

export class CapabilityStrategy implements IRoutingStrategy {
  readonly name = 'capability' as const;

  constructor(private readonly heuristics: HeuristicStore) {}

  select(profile: TaskProfile, providers: ProviderStats[]): RankedProvider[] {
    const weights: HeuristicWeights = this.heuristics.get();
    const complexityW = COMPLEXITY_WEIGHT[profile.complexity];

    return providers
      .map((p) => {
        const base = p.capabilities[profile.type] * p.successRate * complexityW;
        const score = this.heuristics.effectiveScore(p.provider, profile.type, base);
        return {
          provider: p.provider,
          score,
          reason: `capability[${profile.type}]=${p.capabilities[profile.type].toFixed(2)} × successRate=${p.successRate.toFixed(2)} × complexity=${complexityW}`,
        };
      })
      .sort((a, b) => b.score - a.score);

    void weights;
  }
}
