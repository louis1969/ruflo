import type { HookName, HookPayloads, PluginContext } from './types.js';
import type { PluginRegistry } from './registry.js';

export class HookManager {
  constructor(
    private readonly registry: PluginRegistry,
    private readonly ctx:      PluginContext
  ) {}

  /** Fire all handlers registered for `name`. Errors are caught and logged — hooks never crash the caller. */
  async fire<K extends HookName>(name: K, data: HookPayloads[K]): Promise<void> {
    const handlers = this.registry.getHooks(name);
    for (const h of handlers) {
      try {
        await (h.handler as (d: HookPayloads[K]) => Promise<void> | void)(data);
      } catch (err) {
        this.ctx.log('warn', `Hook "${name}" error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
