import type {
  RufloPlugin,
  AgentDefinition,
  StrategyDefinition,
  ProviderDefinition,
  EvaluatorDefinition,
  ToolDefinition,
  HookDefinition,
  HookName,
  PluginInfo,
} from './types.js';
import type { TaskType } from '../router/types.js';

export class PluginRegistry {
  private plugins: RufloPlugin[] = [];

  register(plugin: RufloPlugin): void {
    if (this.plugins.find((p) => p.name === plugin.name)) {
      // Silently skip duplicate registrations (idempotent).
      return;
    }
    this.plugins.push(plugin);
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  getTools(): ToolDefinition[] {
    return this.plugins.flatMap((p) => p.tools ?? []);
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.getTools().find((t) => t.name === name);
  }

  getAgents(): AgentDefinition[] {
    return this.plugins.flatMap((p) => p.agents ?? []);
  }

  getAgent(name: string): AgentDefinition | undefined {
    return this.getAgents().find((a) => a.name === name);
  }

  getStrategies(): StrategyDefinition[] {
    return this.plugins.flatMap((p) => p.strategies ?? []);
  }

  getStrategy(name: string): StrategyDefinition | undefined {
    return this.getStrategies().find((s) => s.name === name);
  }

  getProviders(): ProviderDefinition[] {
    return this.plugins.flatMap((p) => p.providers ?? []);
  }

  getProvider(name: string): ProviderDefinition | undefined {
    return this.getProviders().find((pr) => pr.name === name);
  }

  getEvaluators(taskType?: TaskType): EvaluatorDefinition[] {
    const all = this.plugins.flatMap((p) => p.evaluators ?? []);
    if (!taskType) return all;
    return all.filter((e) => !e.taskTypes || e.taskTypes.includes(taskType));
  }

  getHooks<K extends HookName>(name: K): HookDefinition<K>[] {
    return (this.plugins
      .flatMap((p) => p.hooks ?? [])
      .filter((h) => h.hook === name) as unknown) as HookDefinition<K>[];
  }

  // ── Introspection ─────────────────────────────────────────────────────────

  list(): PluginInfo[] {
    return this.plugins.map((p) => ({
      name:        p.name,
      version:     p.version,
      description: p.description ?? '',
      provides: {
        agents:     (p.agents     ?? []).map((a) => a.name),
        strategies: (p.strategies ?? []).map((s) => s.name),
        providers:  (p.providers  ?? []).map((pr) => pr.name),
        evaluators: (p.evaluators ?? []).map((e) => e.name),
        tools:      (p.tools      ?? []).map((t) => t.name),
        hooks:      (p.hooks      ?? []).map((h) => h.hook),
      },
    }));
  }

  count(): number { return this.plugins.length; }
}
