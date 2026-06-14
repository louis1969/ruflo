import type { IRoutingStrategy, TaskProfile, ProviderStats, RankedProvider } from '../types.js';
import type { HeuristicStore } from '../heuristics.js';

// Score = quality_floor_met ? (1 / estimated_cost) : 0
// Providers below a minimum capability threshold for the task type are excluded.
const MIN_CAPABILITY_THRESHOLD = 0.60;

export class CostStrategy implements IRoutingStrategy {
  readonly name = 'cost' as const;

  constructor(private readonly heuristics: HeuristicStore) {}

  select(profile: TaskProfile, providers: ProviderStats[]): RankedProvider[] {
    return providers
      .map((p) => {
        const cap = p.capabilities[profile.type];
        if (cap < MIN_CAPABILITY_THRESHOLD) {
          return { provider: p.provider, score: 0, reason: `below quality floor (${cap.toFixed(2)} < ${MIN_CAPABILITY_THRESHOLD})` };
        }
        const estimatedCost = (profile.estimatedInputTokens / 1000) * p.costPer1kInputTokens;
        // Avoid division by zero for free providers (ollama).
        const rawScore = estimatedCost === 0 ? 1000 : 1 / estimatedCost;
        const score = this.heuristics.effectiveScore(p.provider, profile.type, rawScore);
        return {
          provider: p.provider,
          score,
          reason: `est. cost $${estimatedCost.toFixed(6)} for ~${profile.estimatedInputTokens} tokens`,
        };
      })
      .sort((a, b) => b.score - a.score);
  }
}
