import type { RufloPlugin, HookPayloads } from '../../core/plugins/types.js';

// ── Event types ───────────────────────────────────────────────────────────────

export type DevEventType =
  | 'connected'
  | 'job:start'
  | 'job:end'
  | 'task:start'
  | 'task:end'
  | 'tool:call'
  | 'tool:result'
  | 'reload'
  | 'providers'
  | 'heuristics'
  | 'log'
  | 'error';

export interface DevEvent {
  type: DevEventType;
  ts:   number;
  data: unknown;
}

type Subscriber = (event: DevEvent) => void;

// ── Inspector ─────────────────────────────────────────────────────────────────

const BUFFER_SIZE = 200;

export class Inspector {
  private readonly buffer:      DevEvent[] = [];
  private readonly subscribers: Set<Subscriber> = new Set();

  emit(type: DevEventType, data: unknown): void {
    const event: DevEvent = { type, ts: Date.now(), data };
    this.buffer.push(event);
    if (this.buffer.length > BUFFER_SIZE) this.buffer.shift();
    for (const fn of this.subscribers) {
      try { fn(event); } catch { /* subscriber errors must not crash the emitter */ }
    }
  }

  /** Returns a function that removes the subscription when called. */
  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  /** Most-recent-first slice of the event buffer. */
  recent(n = 50): DevEvent[] {
    return this.buffer.slice(-n).reverse();
  }

  log(level: 'info' | 'warn' | 'error', message: string): void {
    this.emit('log', { level, message });
    if (level === 'error') console.error(`[dev] ${message}`);
    else if (level === 'warn') process.stderr.write(`[dev] ${message}\n`);
  }

  // ── RufloPlugin integration ────────────────────────────────────────────────

  /** Returns a RufloPlugin that wires inspector events into the plugin hook system. */
  asPlugin(): RufloPlugin {
    const inspector = this;
    return {
      name:    '@ruflo/dev-inspector',
      version: '0.1.0',
      hooks: [
        {
          hook:    'before:job',
          handler: (p) => {
            const { jobId, raw } = p as HookPayloads['before:job'];
            inspector.emit('job:start', { jobId, raw });
          },
        },
        {
          hook:    'after:job',
          handler: (p) => {
            const { jobId, result } = p as HookPayloads['after:job'];
            inspector.emit('job:end', {
              jobId,
              success:    result.success,
              output:     result.output.slice(0, 1000),
              cost:       result.totalCostUsd,
              latency:    result.totalLatencyMs,
              agentsUsed: result.agentsUsed,
              providers:  result.providersUsed,
            });
          },
        },
        {
          hook:    'on:error',
          handler: (p) => {
            const { error, context } = p as HookPayloads['on:error'];
            inspector.emit('error', { message: error.message, context });
          },
        },
        {
          hook:    'on:calibrate',
          handler: (p) => {
            const { entries } = p as HookPayloads['on:calibrate'];
            inspector.emit('heuristics', { calibrationCount: entries.length });
          },
        },
      ],
    };
  }
}
