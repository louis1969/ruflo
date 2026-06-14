import type { RufloPlugin, PluginContext, ToolDefinition, AgentDefinition, PluginInfo } from './types.js';
import type { IRoutingStrategy } from '../router/types.js';
import type { TaskType } from '../router/types.js';
import { PluginRegistry }  from './registry.js';
import { HookManager }     from './hooks.js';
import { loadPlugins, discoverNpmPlugins } from './loader.js';
import { processToolCalls }   from './tool-runner.js';
import { httpFetchPlugin }    from './builtins/http-fetch.js';
import { jsonExtractPlugin }  from './builtins/json-extract.js';

// ── Built-in plugin catalogue ─────────────────────────────────────────────────

export const BUILTIN_PLUGINS = {
  httpFetch:   httpFetchPlugin,
  jsonExtract: jsonExtractPlugin,
} as const;

// ── Config shape ──────────────────────────────────────────────────────────────

export interface PluginManagerConfig {
  plugins?:    string[];          // paths / npm package names
  builtins?:   (keyof typeof BUILTIN_PLUGINS)[];
  autoDiscover?: boolean;         // scan node_modules for @ruflo/plugin-* packages
  context?:    Partial<PluginContext>;
}

// ── PluginManager ─────────────────────────────────────────────────────────────

export class PluginManager {
  readonly registry: PluginRegistry;
  readonly hooks:    HookManager;
  private  readonly ctx: PluginContext;

  private constructor(registry: PluginRegistry, ctx: PluginContext) {
    this.registry = registry;
    this.ctx      = ctx;
    this.hooks    = new HookManager(registry, ctx);
  }

  // ── Factory ────────────────────────────────────────────────────────────────

  static async load(cfg: PluginManagerConfig = {}): Promise<PluginManager> {
    const ctx: PluginContext = {
      memory:  cfg.context?.memory,
      config:  cfg.context?.config,
      log:     cfg.context?.log ?? ((level, msg) => {
        if (level === 'error') console.error(`[plugin] ${msg}`);
        else if (level === 'warn') console.warn(`[plugin] ${msg}`);
      }),
      emit:    cfg.context?.emit ?? (() => { /* no-op by default */ }),
    };

    const registry = new PluginRegistry();
    const manager  = new PluginManager(registry, ctx);

    // Register requested built-ins.
    for (const key of cfg.builtins ?? []) {
      registry.register(BUILTIN_PLUGINS[key]);
    }

    // Auto-discover npm plugins.
    const discovered: string[] = cfg.autoDiscover ? discoverNpmPlugins() : [];

    // Load external plugins.
    const paths = [...(cfg.plugins ?? []), ...discovered];
    const loaded = await loadPlugins(paths, ctx);
    for (const p of loaded) registry.register(p);

    return manager;
  }

  // ── Manual registration ────────────────────────────────────────────────────

  register(plugin: RufloPlugin): void {
    this.registry.register(plugin);
    if (typeof plugin.setup === 'function') {
      Promise.resolve(plugin.setup(this.ctx)).catch((err) => {
        this.ctx.log('warn', `Plugin "${plugin.name}" setup failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }

  // ── Tool pipeline ──────────────────────────────────────────────────────────

  getTools(): ToolDefinition[] {
    return this.registry.getTools();
  }

  async processOutput(output: string): Promise<{ output: string; toolsInvoked: number }> {
    const tools = this.registry.getTools();
    if (tools.length === 0 || !output.includes('<tool_call>')) {
      return { output, toolsInvoked: 0 };
    }
    const result = await processToolCalls(output, tools, this.ctx);
    if (result.errors.length > 0) {
      for (const e of result.errors) this.ctx.log('warn', `Tool error: ${e}`);
    }
    return { output: result.output, toolsInvoked: result.toolsInvoked };
  }

  // ── Agent resolution ───────────────────────────────────────────────────────

  getAgents(): AgentDefinition[] {
    return this.registry.getAgents();
  }

  resolveAgentPrompt(agentName: string): string | null {
    return this.registry.getAgent(agentName)?.systemPrompt ?? null;
  }

  // ── Custom quality evaluator ───────────────────────────────────────────────

  evaluate(
    prompt:     string,
    output:     string,
    taskType:   TaskType,
    complexity: string
  ): { score: number; breakdown: Record<string, number> } | null {
    const evaluator = this.registry.getEvaluators(taskType)[0];
    if (!evaluator) return null;
    return evaluator.evaluate(prompt, output, taskType, complexity);
  }

  // ── Strategy resolution ────────────────────────────────────────────────────

  resolveStrategy(name: string): IRoutingStrategy | null {
    const def = this.registry.getStrategy(name);
    if (!def) return null;
    return def.create();
  }

  // ── Introspection ──────────────────────────────────────────────────────────

  list(): PluginInfo[] {
    return this.registry.list();
  }

  count(): number {
    return this.registry.count();
  }

  // ── Teardown ───────────────────────────────────────────────────────────────

  async teardown(): Promise<void> {
    for (const info of this.registry.list()) {
      // We don't keep plugin references directly, so teardown is best-effort via builtins.
      void info;
    }
  }
}

// Re-exports for consumers.
export type { RufloPlugin, ToolDefinition, AgentDefinition, PluginContext, PluginInfo } from './types.js';
export type { HookName, HookPayloads, HookDefinition } from './types.js';
