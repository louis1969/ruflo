import type { LLMProvider } from '../../types/index.js';
import type { RoutingDecision } from '../router/index.js';

export type ExecutionMode = 'sequential' | 'parallel' | 'pipeline' | 'race';
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'partial';

export interface AgentTask {
  id: string;
  jobId: string;
  index: number;
  agentName: string;
  // Instruction derived from the original task, possibly enriched with prior context.
  instruction: string;
  // Carries output from upstream pipeline stages.
  upstreamContext: string[];
  decision: RoutingDecision;
  // IDs of tasks that must complete before this one starts (pipeline mode).
  dependsOn: string[];
}

export interface AgentResult {
  taskId: string;
  jobId: string;
  agentName: string;
  provider: LLMProvider;
  output: string;
  success: boolean;
  latencyMs: number;
  costUsd: number;
  // Filled in by the critic agent later; null initially.
  qualityScore: number | null;
  errorMessage?: string;
  retries: number;
  completedAt: number;
}

export interface SwarmPlan {
  jobId: string;
  mode: ExecutionMode;
  tasks: AgentTask[];
  maxConcurrency: number;
  timeoutMs: number;
}

export interface SwarmJob {
  id: string;
  raw: string;
  status: JobStatus;
  plan: SwarmPlan;
  results: AgentResult[];
  startedAt: number;
  completedAt?: number;
}

export interface SwarmResult {
  jobId: string;
  mode: ExecutionMode;
  output: string;
  agentResults: AgentResult[];
  success: boolean;
  totalLatencyMs: number;
  totalCostUsd: number;
  agentsUsed: string[];
  providersUsed: LLMProvider[];
}

// AgentRunner is the seam between the Swarm and actual LLM execution.
// Inject a real runner when LLM adapters are built; the mock is used until then.
export type AgentRunner = (task: AgentTask) => Promise<AgentResult>;
