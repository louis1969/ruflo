import { Router } from '../core/router/index.js';
import { Swarm } from '../core/swarm/index.js';
import { MemoryStore, createMemoryAdapter } from '../core/memory/index.js';
import { LearningLoop } from '../core/learning/index.js';
import { loadProviderConfigs, enabledProviders, createAgentRunner } from '../core/llm/index.js';
import type { IMemoryAdapter } from '../core/memory/types.js';

export interface McpContextOptions {
  stateDir?: string;
  configDir?: string;
  strategy?: 'capability' | 'cost' | 'latency' | 'round-robin';
}

export class RufloContext {
  readonly router:   Router;
  readonly memory:   MemoryStore;
  readonly swarm:    Swarm;
  readonly learning: LearningLoop;

  private adapter: IMemoryAdapter;

  private constructor(
    router:   Router,
    memory:   MemoryStore,
    swarm:    Swarm,
    learning: LearningLoop,
    adapter:  IMemoryAdapter
  ) {
    this.router   = router;
    this.memory   = memory;
    this.swarm    = swarm;
    this.learning = learning;
    this.adapter  = adapter;
  }

  static async create(opts: McpContextOptions = {}): Promise<RufloContext> {
    const stateDir  = opts.stateDir  ?? '.ruflo';
    const configDir = opts.configDir ?? process.cwd();
    const strategy  = opts.strategy  ?? 'capability';

    const configs  = await loadProviderConfigs(configDir);
    const active   = enabledProviders(configs);
    const runner   = active.length > 0 ? createAgentRunner(configs) : undefined;

    const providers = active.length > 0 ? active : ['anthropic', 'openai', 'groq'] as const;
    const fallback  = active.includes('openai') ? 'openai' : (active[0] ?? 'anthropic');

    const router  = new Router({ strategy, fallbackProvider: fallback, enabledProviders: [...providers], stateDir });
    const adapter = await createMemoryAdapter({ backend: 'file', path: `${stateDir}/memory` });
    const memory  = new MemoryStore(adapter, 'ruflo');
    const swarm   = new Swarm({ maxConcurrentAgents: 5, timeoutMs: 60_000 }, router, memory, runner);
    const loop    = new LearningLoop(router, memory, {
      mode:                  'routing-heuristics',
      evalInterval:          10,
      minSamplesBeforeAdapt: 3,
    });

    return new RufloContext(router, memory, swarm, loop, adapter);
  }

  activeProviders(): string[] {
    return this.router.getRegistry().healthy().map((s) => s.provider);
  }

  async close(): Promise<void> {
    this.learning.stop();
    await this.adapter.close();
  }
}
