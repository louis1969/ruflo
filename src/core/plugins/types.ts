import type { LLMProvider } from '../../types/index.js';
import type { TaskType } from '../router/types.js';
import type { IRoutingStrategy } from '../router/types.js';
import type { ILLMAdapter } from '../llm/types.js';
import type { AgentTask, AgentResult } from '../swarm/types.js';
import type { SwarmResult } from '../swarm/types.js';
import type { EvalResult, CalibrationEntry } from '../learning/types.js';
import type { MemoryStore } from '../memory/index.js';
import type { RufloConfig } from '../../types/index.js';

// ── Plugin context ────────────────────────────────────────────────────────────

export interface PluginContext {
  memory?:  MemoryStore;
  config?:  Partial<RufloConfig>;
  log:      (level: 'info' | 'warn' | 'error', message: string) => void;
  emit:     (event: string, data: unknown) => void;
}

// ── Extension point types ─────────────────────────────────────────────────────

/** Declares a named agent role with its own system prompt. */
export interface AgentDefinition {
  name:                string;
  role:                string;
  description:         string;
  systemPrompt:        string;
  capabilities?:       Partial<Record<TaskType, number>>;
  preferredProviders?: LLMProvider[];
}

/** Registers a custom routing strategy by name. */
export interface StrategyDefinition {
  name:        string;
  description: string;
  create:      () => IRoutingStrategy;
}

/** Wraps a custom LLM backend. */
export interface ProviderDefinition {
  name:        string;
  description: string;
  create:      (config: Record<string, string>) => ILLMAdapter;
}

/** Replaces or supplements the rule-based quality evaluator. */
export interface EvaluatorDefinition {
  name:        string;
  description: string;
  taskTypes?:  TaskType[];   // undefined = applies to all
  evaluate:    (
    prompt:     string,
    output:     string,
    taskType:   TaskType,
    complexity: string
  ) => { score: number; breakdown: Record<string, number> };
}

/** A callable tool agents can invoke via <tool_call> syntax. */
export interface ToolDefinition {
  name:        string;
  description: string;
  parameters:  Record<string, { type: string; description: string; required?: boolean }>;
  execute:     (args: Record<string, unknown>, ctx: PluginContext) => Promise<string> | string;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export type HookName =
  | 'before:task'
  | 'after:task'
  | 'before:job'
  | 'after:job'
  | 'on:error'
  | 'on:eval'
  | 'on:calibrate';

export type HookPayloads = {
  'before:task':  { task: AgentTask };
  'after:task':   { task: AgentTask; result: AgentResult };
  'before:job':   { jobId: string; raw: string };
  'after:job':    { jobId: string; result: SwarmResult };
  'on:error':     { error: Error; context: string };
  'on:eval':      { evalResult: EvalResult };
  'on:calibrate': { entries: CalibrationEntry[] };
};

export interface HookDefinition<K extends HookName = HookName> {
  hook:    K;
  handler: (data: HookPayloads[K]) => Promise<void> | void;
}

// ── Plugin manifest ───────────────────────────────────────────────────────────

export interface RufloPlugin {
  name:         string;
  version:      string;
  description?: string;

  /** Called once after all plugins are registered. */
  setup?:    (ctx: PluginContext) => Promise<void> | void;
  /** Called when the process is shutting down. */
  teardown?: () => Promise<void> | void;

  agents?:     AgentDefinition[];
  strategies?: StrategyDefinition[];
  providers?:  ProviderDefinition[];
  evaluators?: EvaluatorDefinition[];
  tools?:      ToolDefinition[];
  hooks?:      HookDefinition[];
}

// ── Plugin info (for `ruflo plugin list`) ─────────────────────────────────────

export interface PluginInfo {
  name:        string;
  version:     string;
  description: string;
  provides: {
    agents:     string[];
    strategies: string[];
    providers:  string[];
    evaluators: string[];
    tools:      string[];
    hooks:      string[];
  };
}
