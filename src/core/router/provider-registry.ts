import type { LLMProvider } from '../../types/index.js';
import type { CapabilityMatrix, ProviderStats, TaskType } from './types.js';

// Static baselines derived from published benchmarks + real-world use.
// The learning loop applies learned deltas on top of these.
const BASELINE_CAPABILITIES: Record<LLMProvider, CapabilityMatrix> = {
  anthropic: {
    reasoning:  0.95,
    coding:     0.92,
    search:     0.80,
    creative:   0.90,
    analysis:   0.93,
    planning:   0.94,
    execution:  0.90,
    general:    0.88,
  },
  openai: {
    reasoning:  0.90,
    coding:     0.90,
    search:     0.85,
    creative:   0.85,
    analysis:   0.88,
    planning:   0.88,
    execution:  0.88,
    general:    0.85,
  },
  groq: {
    reasoning:  0.75,
    coding:     0.72,
    search:     0.70,
    creative:   0.70,
    analysis:   0.73,
    planning:   0.70,
    execution:  0.75,
    general:    0.78,
  },
  gemini: {
    reasoning:  0.85,
    coding:     0.82,
    search:     0.80,
    creative:   0.80,
    analysis:   0.83,
    planning:   0.82,
    execution:  0.80,
    general:    0.82,
  },
  ollama: {
    reasoning:  0.65,
    coding:     0.60,
    search:     0.55,
    creative:   0.60,
    analysis:   0.62,
    planning:   0.60,
    execution:  0.65,
    general:    0.68,
  },
};

// Median first-token latency in ms (empirical).
const BASELINE_LATENCY_MS: Record<LLMProvider, number> = {
  groq:      150,
  gemini:    300,
  openai:    500,
  anthropic: 800,
  ollama:    1200,
};

// USD per 1 000 input tokens (output assumed 30 % of input volume).
const BASELINE_COST_PER_1K: Record<LLMProvider, number> = {
  ollama:    0.000,
  groq:      0.001,
  gemini:    0.0001,
  openai:    0.003,
  anthropic: 0.003,
};

const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_RESET_MS  = 60_000;

export class ProviderRegistry {
  private stats: Map<LLMProvider, ProviderStats> = new Map();

  constructor(enabledProviders: LLMProvider[]) {
    for (const p of enabledProviders) {
      this.stats.set(p, {
        provider: p,
        capabilities: { ...BASELINE_CAPABILITIES[p] },
        avgLatencyMs: BASELINE_LATENCY_MS[p],
        costPer1kInputTokens: BASELINE_COST_PER_1K[p],
        successRate: 1.0,
        isHealthy: true,
        consecutiveFailures: 0,
        lastFailureAt: null,
      });
    }
  }

  all(): ProviderStats[] {
    return [...this.stats.values()];
  }

  healthy(): ProviderStats[] {
    const now = Date.now();
    return this.all().filter((s) => {
      // Auto-recover circuit breaker after reset window.
      if (!s.isHealthy && s.lastFailureAt && now - s.lastFailureAt > CIRCUIT_BREAKER_RESET_MS) {
        s.isHealthy = true;
        s.consecutiveFailures = 0;
      }
      return s.isHealthy;
    });
  }

  get(provider: LLMProvider): ProviderStats | undefined {
    return this.stats.get(provider);
  }

  recordSuccess(provider: LLMProvider, latencyMs: number): void {
    const s = this.stats.get(provider);
    if (!s) return;
    s.consecutiveFailures = 0;
    s.isHealthy = true;
    // EMA with α = 0.2 to smooth latency spikes.
    s.avgLatencyMs = 0.8 * s.avgLatencyMs + 0.2 * latencyMs;
    s.successRate  = 0.95 * s.successRate + 0.05 * 1;
  }

  recordFailure(provider: LLMProvider, errorType: string): void {
    const s = this.stats.get(provider);
    if (!s) return;
    s.consecutiveFailures += 1;
    s.lastFailureAt = Date.now();
    s.successRate = 0.95 * s.successRate + 0.05 * 0;
    if (s.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
      s.isHealthy = false;
    }
    void errorType;
  }

  // Apply learned capability delta from the heuristics layer.
  applyCapabilityDelta(provider: LLMProvider, taskType: TaskType, delta: number): void {
    const s = this.stats.get(provider);
    if (!s) return;
    s.capabilities[taskType] = Math.min(1, Math.max(0, s.capabilities[taskType] + delta));
  }
}
