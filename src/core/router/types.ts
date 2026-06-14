import type { LLMProvider, RoutingStrategy } from '../../types/index.js';

export type TaskType =
  | 'reasoning'
  | 'coding'
  | 'search'
  | 'creative'
  | 'analysis'
  | 'planning'
  | 'execution'
  | 'general';

export type Complexity = 'low' | 'medium' | 'high';
export type LatencySensitivity = 'realtime' | 'normal' | 'batch';

export interface TaskProfile {
  raw: string;
  type: TaskType;
  complexity: Complexity;
  estimatedInputTokens: number;
  latencySensitivity: LatencySensitivity;
  requiresTools: boolean;
  requiresLongContext: boolean;
}

// Per-provider capability scores (0–1) indexed by task type.
export type CapabilityMatrix = Record<TaskType, number>;

export interface ProviderStats {
  provider: LLMProvider;
  // Baseline capability scores — updated additively by learned deltas.
  capabilities: CapabilityMatrix;
  avgLatencyMs: number;
  // Cost in USD per 1 000 input tokens (output assumed ~30% of input).
  costPer1kInputTokens: number;
  successRate: number;
  isHealthy: boolean;
  consecutiveFailures: number;
  lastFailureAt: number | null;
}

export interface RoutingDecision {
  id: string;
  taskProfile: TaskProfile;
  selectedProvider: LLMProvider;
  selectedAgent: string | null;
  fallbackProvider: LLMProvider | null;
  strategy: RoutingStrategy;
  scoreBreakdown: Record<LLMProvider, number>;
  reasoning: string;
  estimatedCostUsd: number;
  estimatedLatencyMs: number;
  timestamp: number;
}

export interface RouteOutcome {
  decisionId: string;
  provider: LLMProvider;
  taskType: TaskType;
  success: boolean;
  actualLatencyMs: number;
  actualCostUsd: number;
  // 0–1 quality score from critic agent; null when not yet evaluated.
  qualityScore: number | null;
  errorType?: string;
}

export interface IRoutingStrategy {
  name: string;
  select(
    profile: TaskProfile,
    providers: ProviderStats[],
    weights: HeuristicWeights
  ): RankedProvider[];
}

export interface RankedProvider {
  provider: LLMProvider;
  score: number;
  reason: string;
}

// Adaptive weights stored on disk and updated by the learning loop.
export interface HeuristicWeights {
  // Per-provider multiplier applied on top of raw scores (default 1.0).
  providerMultiplier: Record<LLMProvider, number>;
  // Per-task-type penalty for a provider when it has failed that type.
  taskTypePenalty: Partial<Record<LLMProvider, Partial<Record<TaskType, number>>>>;
  // Running EMA of outcome quality per provider per task type.
  qualityEma: Partial<Record<LLMProvider, Partial<Record<TaskType, number>>>>;
  updatedAt: number;
  totalOutcomes: number;
}
