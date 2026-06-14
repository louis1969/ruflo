// ── Ruflo public API ──────────────────────────────────────────────────────────
// Import from 'ruflo' to get types + runtime classes.
// Import from 'ruflo/core/router', 'ruflo/core/swarm', etc. for tree-shakeable
// deep imports (see package.json exports map).

// ── Shared types ──────────────────────────────────────────────────────────────
export type {
  LLMProvider,
  MemoryBackend,
  RoutingStrategy,
  LearningMode,
  AgentTemplate,
  RufloConfig,
} from './types/index.js';

// ── Router ────────────────────────────────────────────────────────────────────
export { Router }            from './core/router/index.js';
export type { RouterConfig } from './core/router/index.js';
export type {
  TaskProfile,
  RoutingDecision,
  RouteOutcome,
  IRoutingStrategy,
  RankedProvider,
} from './core/router/types.js';

// ── Swarm ─────────────────────────────────────────────────────────────────────
export { Swarm }             from './core/swarm/index.js';
export type { SwarmConfig }  from './core/swarm/index.js';
export type {
  SwarmResult,
  SwarmJob,
  AgentTask,
  AgentResult,
  AgentRunner,
} from './core/swarm/types.js';

// ── Memory ────────────────────────────────────────────────────────────────────
export { MemoryStore, createMemoryAdapter } from './core/memory/index.js';
export type { IMemoryAdapter }              from './core/memory/types.js';

// ── Learning ──────────────────────────────────────────────────────────────────
export { LearningLoop }             from './core/learning/index.js';
export type { LearningConfig }      from './core/learning/index.js';

// ── LLM ───────────────────────────────────────────────────────────────────────
export {
  loadProviderConfigs,
  enabledProviders,
  createAgentRunner,
} from './core/llm/index.js';
export type { AgentRunnerOptions } from './core/llm/index.js';

// ── Plugins ───────────────────────────────────────────────────────────────────
export { PluginManager, BUILTIN_PLUGINS }   from './core/plugins/index.js';
export type { PluginManagerConfig }         from './core/plugins/index.js';
export type {
  RufloPlugin,
  PluginContext,
  PluginInfo,
  ToolDefinition,
  AgentDefinition,
  StrategyDefinition,
  ProviderDefinition,
  EvaluatorDefinition,
  HookDefinition,
  HookName,
  HookPayloads,
} from './core/plugins/types.js';

// ── Eval ──────────────────────────────────────────────────────────────────────
export {
  EvalHarness,
  PASS_THRESHOLD,
  renderMarkdown,
  renderTerminal,
  listBuiltInSuites,
  loadSuite,
} from './core/eval/index.js';
export type {
  EvalHarnessOptions,
  RunOptions,
} from './core/eval/index.js';
export type {
  EvalCase,
  EvalJudgment,
  EvalRun,
  EvalReport,
  EvalComparison,
  EvalSuite,
} from './core/eval/types.js';

// ── MCP ───────────────────────────────────────────────────────────────────────
export { createMcpServer }          from './mcp/index.js';
export type { McpContextOptions }   from './mcp/context.js';
