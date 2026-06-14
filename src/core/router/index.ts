import { randomUUID } from 'crypto';
import { appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { LLMProvider, RoutingStrategy } from '../../types/index.js';
import { analyzeTask } from './task-analyzer.js';
import { ProviderRegistry } from './provider-registry.js';
import { HeuristicStore } from './heuristics.js';
import {
  CapabilityStrategy,
  CostStrategy,
  LatencyStrategy,
  RoundRobinStrategy,
} from './strategies/index.js';
import type {
  TaskProfile,
  RoutingDecision,
  RouteOutcome,
  IRoutingStrategy,
  RankedProvider,
} from './types.js';

export interface RouterConfig {
  strategy: RoutingStrategy;
  fallbackProvider: LLMProvider;
  enabledProviders: LLMProvider[];
  // Directory used for heuristics file and decisions log.
  stateDir: string;
}

export class Router {
  private readonly registry: ProviderRegistry;
  private readonly heuristics: HeuristicStore;
  private strategy: IRoutingStrategy;
  private readonly config: RouterConfig;
  private readonly decisionsLogPath: string;
  private readonly extraStrategies = new Map<string, IRoutingStrategy>();

  constructor(config: RouterConfig) {
    this.config = config;

    this.registry = new ProviderRegistry(config.enabledProviders);

    this.heuristics = new HeuristicStore(
      join(config.stateDir, 'heuristics.json'),
      config.enabledProviders
    );

    this.decisionsLogPath = join(config.stateDir, 'decisions.jsonl');
    mkdirSync(dirname(this.decisionsLogPath), { recursive: true });

    this.strategy = this.buildStrategy(config.strategy);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  route(rawTask: string, preferredAgent?: string): RoutingDecision {
    const profile = analyzeTask(rawTask);
    return this.routeProfile(profile, preferredAgent);
  }

  routeProfile(profile: TaskProfile, preferredAgent?: string): RoutingDecision {
    const healthyProviders = this.registry.healthy();

    if (healthyProviders.length === 0) {
      throw new Error('No healthy providers available. Check API keys and circuit-breaker state.');
    }

    const ranked: RankedProvider[] = this.strategy.select(
      profile,
      healthyProviders,
      this.heuristics.get()
    );

    const primary   = ranked[0];
    const secondary = ranked[1] ?? null;

    // Prefer configured fallback if it's healthy and not already primary.
    const fallback = this.resolveFallback(primary.provider, secondary, healthyProviders);

    const primaryStats = this.registry.get(primary.provider)!;
    const estimatedCostUsd =
      (profile.estimatedInputTokens / 1000) * primaryStats.costPer1kInputTokens;

    const scoreBreakdown = Object.fromEntries(
      ranked.map((r) => [r.provider, r.score])
    ) as Record<LLMProvider, number>;

    const decision: RoutingDecision = {
      id: randomUUID(),
      taskProfile: profile,
      selectedProvider: primary.provider,
      selectedAgent: preferredAgent ?? this.inferAgent(profile),
      fallbackProvider: fallback,
      strategy: this.config.strategy,
      scoreBreakdown,
      reasoning: primary.reason,
      estimatedCostUsd,
      estimatedLatencyMs: primaryStats.avgLatencyMs,
      timestamp: Date.now(),
    };

    this.logDecision(decision);
    return decision;
  }

  // Call this after a task completes to feed the learning loop.
  recordOutcome(outcome: RouteOutcome): void {
    if (outcome.success) {
      this.registry.recordSuccess(outcome.provider, outcome.actualLatencyMs);
    } else {
      this.registry.recordFailure(outcome.provider, outcome.errorType ?? 'unknown');
    }
    this.heuristics.ingest(outcome);
    this.heuristics.save();
  }

  // Register a custom routing strategy (used by the plugin system).
  addStrategy(s: IRoutingStrategy): void {
    this.extraStrategies.set(s.name, s);
  }

  // Switch to a named strategy (built-in or plugin-registered).
  useStrategy(name: string): void {
    const extra = this.extraStrategies.get(name);
    if (extra) { this.strategy = extra; return; }
    this.strategy = this.buildStrategy(name as RoutingStrategy);
  }

  // Expose internals for the learning loop layer.
  getRegistry(): ProviderRegistry { return this.registry; }
  getHeuristics(): HeuristicStore { return this.heuristics; }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private buildStrategy(name: RoutingStrategy): IRoutingStrategy {
    switch (name) {
      case 'capability':  return new CapabilityStrategy(this.heuristics);
      case 'cost':        return new CostStrategy(this.heuristics);
      case 'latency':     return new LatencyStrategy(this.heuristics);
      case 'round-robin': return new RoundRobinStrategy(this.heuristics);
    }
  }

  private resolveFallback(
    primary: LLMProvider,
    secondary: RankedProvider | null,
    healthy: { provider: LLMProvider }[]
  ): LLMProvider | null {
    const configured = this.config.fallbackProvider;
    if (configured !== primary && healthy.some((p) => p.provider === configured)) {
      return configured;
    }
    return secondary?.provider ?? null;
  }

  // Map task type to a default agent when no preferred agent is specified.
  private inferAgent(profile: TaskProfile): string {
    const map: Record<string, string> = {
      planning:  'planner',
      coding:    'executor',
      execution: 'executor',
      search:    'researcher',
      analysis:  'researcher',
      reasoning: 'planner',
      creative:  'executor',
      general:   'planner',
    };
    return map[profile.type] ?? 'planner';
  }

  private logDecision(decision: RoutingDecision): void {
    try {
      mkdirSync(dirname(this.decisionsLogPath), { recursive: true });
      appendFileSync(this.decisionsLogPath, JSON.stringify(decision) + '\n');
    } catch {
      // Non-fatal: logging must never crash the router.
    }
  }
}

export { analyzeTask } from './task-analyzer.js';
export type { TaskProfile, RoutingDecision, RouteOutcome } from './types.js';
