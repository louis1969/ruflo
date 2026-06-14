import type { IRoutingStrategy, TaskProfile, ProviderStats, RankedProvider } from '../types.js';
import type { HeuristicStore } from '../heuristics.js';

// Cycles through healthy providers in insertion order.
// Still applies heuristic multiplier so badly-performing providers get down-weighted
// even under round-robin — pure cycle only happens at equal heuristic scores.
export class RoundRobinStrategy implements IRoutingStrategy {
  readonly name = 'round-robin' as const;
  private index = 0;

  constructor(private readonly heuristics: HeuristicStore) {}

  select(profile: TaskProfile, providers: ProviderStats[]): RankedProvider[] {
    if (providers.length === 0) return [];

    // Assign descending base scores starting from the current index position.
    const ranked: RankedProvider[] = providers.map((p, i) => {
      const positionOffset = (i - this.index % providers.length + providers.length) % providers.length;
      const baseScore = providers.length - positionOffset;
      const score = this.heuristics.effectiveScore(p.provider, profile.type, baseScore);
      return { provider: p.provider, score, reason: `round-robin slot ${positionOffset}` };
    });

    // Advance the cursor for the next call.
    this.index = (this.index + 1) % providers.length;

    return ranked.sort((a, b) => b.score - a.score);
  }
}
