import { createInterface } from 'readline';
import { join }            from 'path';
import { existsSync }      from 'fs';
import { Inspector }       from './inspector.js';
import { FileWatcher }     from './watcher.js';
import { DevHttpServer, type ContextGetter } from './server.js';

export interface DevServerOptions {
  port:        number;
  stateDir:    string;
  configDir:   string;
  strategy:    string;
  debounceMs?: number;
  noRepl?:     boolean;
}

// ── Internal context (rebuilt on hot-reload) ──────────────────────────────────

interface LiveContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  router:          any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  swarm:           any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  memory:          any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  learning:        any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter:         any;
  activeProviders: string[];
}

async function buildLiveContext(opts: DevServerOptions, inspector: Inspector): Promise<LiveContext> {
  const { Router }          = await import('../../core/router/index.js');
  const { Swarm }           = await import('../../core/swarm/index.js');
  const { MemoryStore, createMemoryAdapter } = await import('../../core/memory/index.js');
  const { LearningLoop }    = await import('../../core/learning/index.js');
  const { loadProviderConfigs, enabledProviders, createAgentRunner } = await import('../../core/llm/index.js');
  const { PluginManager }   = await import('../../core/plugins/index.js');

  const configs = await loadProviderConfigs(opts.configDir);
  const active  = enabledProviders(configs);

  const plugins = await PluginManager.load({ autoDiscover: true });
  plugins.registry.register(inspector.asPlugin());

  const runner = active.length > 0
    ? createAgentRunner(configs, { pluginManager: plugins })
    : undefined;

  const fallback = active.includes('openai') ? 'openai' : (active[0] ?? 'anthropic');
  const router   = new Router({
    strategy:         opts.strategy as 'capability' | 'cost' | 'latency' | 'round-robin',
    fallbackProvider: fallback,
    enabledProviders: active.length > 0 ? active : ['anthropic', 'openai', 'groq'],
    stateDir:         opts.stateDir,
  });

  for (const sd of plugins.registry.getStrategies()) {
    router.addStrategy(sd.create());
  }

  const adapter  = await createMemoryAdapter({ backend: 'file', path: join(opts.stateDir, 'memory') });
  const memory   = new MemoryStore(adapter, 'ruflo');
  const swarm    = new Swarm(
    { maxConcurrentAgents: 5, timeoutMs: 60_000 },
    router, memory, runner, plugins,
  );
  const learning = new LearningLoop(router, memory, {
    mode:                  'routing-heuristics',
    evalInterval:          10,
    minSamplesBeforeAdapt: 3,
  });

  return { router, swarm, memory, learning, adapter, activeProviders: active };
}

async function closeContext(ctx: LiveContext): Promise<void> {
  try { await ctx.adapter.close(); } catch { /* ignore */ }
}

// ── DevServer ─────────────────────────────────────────────────────────────────

const P = '\x1b[35m';   // purple
const C = '\x1b[36m';   // cyan
const D = '\x1b[2m';    // dim
const B = '\x1b[1m';    // bold
const R = '\x1b[0m';    // reset

export class DevServer {
  static async start(opts: DevServerOptions): Promise<void> {
    const inspector = new Inspector();
    let ctx         = await buildLiveContext(opts, inspector);
    let reloadCount = 0;

    // ── ContextGetter: always delegates to the live ctx ───────────────────────
    const getCtx: ContextGetter = () => ({
      activeProviders: () => ctx.activeProviders,
      router:          ctx.router,
      memory:          ctx.memory,
      swarm:           ctx.swarm,
      learning:        ctx.learning,
    });

    // ── HTTP server ───────────────────────────────────────────────────────────
    const http = new DevHttpServer(inspector, getCtx, opts.port);
    await http.listen();

    // ── File watcher ──────────────────────────────────────────────────────────
    const watchDirs  = [opts.configDir, opts.stateDir].filter(existsSync);
    const watchFiles = [
      join(opts.configDir, '.env'),
      join(opts.configDir, 'ruflo.config.json'),
    ].filter(existsSync);

    const watcher = new FileWatcher(
      { dirs: watchDirs, files: watchFiles, debounceMs: opts.debounceMs ?? 400 },
      async (changedPath) => {
        const t0 = Date.now();
        inspector.log('info', `change: ${changedPath} — rebuilding context…`);
        try {
          const prev = ctx;
          ctx = await buildLiveContext(opts, inspector);
          await closeContext(prev);
          reloadCount++;
          const elapsed = Date.now() - t0;
          inspector.emit('reload', { reason: changedPath, elapsed, count: reloadCount });
          process.stdout.write(`\r  ${C}↺${R} reloaded (${elapsed}ms)  ${D}${changedPath}${R}\n> `);
        } catch (err) {
          inspector.log('error', `reload failed: ${(err as Error).message}`);
        }
      },
    );

    // ── Startup banner ────────────────────────────────────────────────────────
    const sep = `  ${D}${'─'.repeat(46)}${R}`;
    process.stdout.write('\n');
    process.stdout.write(`  ${P}${B}◈ ruflo devtools${R}\n`);
    process.stdout.write(`${sep}\n`);
    process.stdout.write(`  ${C}devtools${R}   http://127.0.0.1:${opts.port}\n`);
    process.stdout.write(`  ${C}api${R}        http://127.0.0.1:${opts.port}/api/status\n`);
    process.stdout.write(`  ${C}events${R}     http://127.0.0.1:${opts.port}/api/events\n`);
    process.stdout.write(`  ${C}providers${R}  ${ctx.activeProviders.length > 0 ? ctx.activeProviders.join(', ') : D + 'none — mock runner' + R}\n`);
    process.stdout.write(`  ${C}strategy${R}   ${opts.strategy}\n`);
    process.stdout.write(`  ${C}watching${R}   ${watchDirs.join(', ')}\n`);
    process.stdout.write(`${sep}\n`);
    process.stdout.write(`  ${D}r reload  l learn  e eval  s status  q quit${R}\n\n`);

    inspector.emit('connected', { providers: ctx.activeProviders, tools: [] });

    // ── Graceful shutdown ─────────────────────────────────────────────────────
    let shuttingDown = false;
    async function shutdown(): Promise<void> {
      if (shuttingDown) return;
      shuttingDown = true;
      process.stdout.write('\n  Shutting down…\n');
      watcher.close();
      http.close();
      await closeContext(ctx);
      process.exit(0);
    }

    process.on('SIGINT',  () => { void shutdown(); });
    process.on('SIGTERM', () => { void shutdown(); });

    // ── REPL ──────────────────────────────────────────────────────────────────
    if (opts.noRepl || !process.stdin.isTTY) return;

    const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
    rl.prompt();

    rl.on('line', async (raw) => {
      const cmd = raw.trim().toLowerCase();

      switch (cmd) {
        case 'r': case 'reload': {
          const t0 = Date.now();
          process.stdout.write('  Rebuilding context…\n');
          try {
            const prev = ctx;
            ctx = await buildLiveContext(opts, inspector);
            await closeContext(prev);
            reloadCount++;
            const elapsed = Date.now() - t0;
            inspector.emit('reload', { reason: 'manual', elapsed, count: reloadCount });
            process.stdout.write(`  ${C}↺${R} reloaded (${elapsed}ms)\n`);
          } catch (err) {
            process.stdout.write(`  ${P}error${R}: ${(err as Error).message}\n`);
          }
          break;
        }

        case 'l': case 'learn': {
          process.stdout.write('  Running learning loop…\n');
          ctx.learning.run()
            .then(() => { process.stdout.write('  Learning cycle complete.\n> '); })
            .catch((err: Error) => { process.stdout.write(`  error: ${err.message}\n> `); });
          break; // REPL re-prompts immediately; learn runs in background
        }

        case 'e': case 'eval': {
          process.stdout.write('  Running eval suite (general)…\n');
          void (async () => {
            try {
              const { EvalHarness, renderTerminal } = await import('../../core/eval/index.js');
              const { loadProviderConfigs }          = await import('../../core/llm/index.js');
              const configs  = await loadProviderConfigs(opts.configDir);
              const harness  = new EvalHarness({ providerConfigs: configs, stateDir: opts.stateDir });
              const report   = await harness.run('general', { concurrency: 2 });
              for (const l of renderTerminal(report)) process.stdout.write(l + '\n');
            } catch (err) {
              process.stdout.write(`  error: ${(err as Error).message}\n`);
            }
            process.stdout.write('> ');
          })();
          break;
        }

        case 's': case 'status': {
          const reg  = ctx.router.getRegistry();
          const provs = (reg.all() as Array<{ provider: string; isHealthy: boolean; avgLatencyMs: number }>) ;
          process.stdout.write('\n');
          process.stdout.write(`  Providers (${provs.length}):\n`);
          for (const p of provs) {
            const status = p.isHealthy ? `${C}●${R}` : `${P}○${R}`;
            process.stdout.write(`    ${status} ${p.provider.padEnd(12)} ${Math.round(p.avgLatencyMs)}ms\n`);
          }
          const w = ctx.router.getHeuristics().get() as { totalOutcomes?: number };
          process.stdout.write(`  Heuristics: ${w.totalOutcomes ?? 0} outcomes ingested\n`);
          process.stdout.write(`  Reloads:    ${reloadCount}\n\n`);
          break;
        }

        case 'q': case 'quit': case 'exit': {
          rl.close();
          void shutdown();
          return;
        }

        case '?': case 'h': case 'help': {
          process.stdout.write('  Commands:\n');
          process.stdout.write('    r / reload  — rebuild context from config\n');
          process.stdout.write('    l / learn   — trigger one learning-loop cycle\n');
          process.stdout.write('    e / eval    — run the built-in "general" eval suite\n');
          process.stdout.write('    s / status  — print provider health + heuristic summary\n');
          process.stdout.write('    q / quit    — graceful shutdown\n');
          break;
        }

        default:
          if (cmd) process.stdout.write(`  Unknown command "${cmd}". Type h for help.\n`);
          break;
      }

      rl.prompt();
    });

    rl.on('close', () => { void shutdown(); });
  }
}
