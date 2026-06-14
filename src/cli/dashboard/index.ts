import { loadDashboardData } from './data.js';
import { renderFrame, ANSI } from './render.js';

export interface DashboardOptions {
  stateDir?:   string;
  refreshMs?:  number;
  once?:       boolean;   // render once and exit (non-interactive, e.g. --snapshot)
}

const REFRESH_MS = 3000;

function width(): number {
  return process.stdout.columns ?? 100;
}

// Write all lines to stdout, overwriting from the top without full-clear flicker.
function paint(lines: string[]): void {
  const out: string[] = [ANSI.home];
  for (const line of lines) {
    out.push(line + ANSI.eraseLine + '\n');
  }
  // Clear any remaining rows from a previous longer render.
  out.push('\x1b[J');
  process.stdout.write(out.join(''));
}

// ── Interactive keyboard handler ────────────────────────────────────────────────

type KeyAction = 'quit' | 'refresh' | 'scroll-up' | 'scroll-down' | 'learn' | 'eval' | null;

function parseKey(buf: Buffer): KeyAction {
  const s = buf.toString();
  if (s === 'q' || s === 'Q' || s === '\x03') return 'quit';   // q, Q, Ctrl-C
  if (s === 'r' || s === 'R')                  return 'refresh';
  if (s === 'l' || s === 'L')                  return 'learn';
  if (s === 'e' || s === 'E')                  return 'eval';
  if (s === '\x1b[A' || s === 'k')             return 'scroll-up';
  if (s === '\x1b[B' || s === 'j')             return 'scroll-down';
  return null;
}

// ── Main entry ────────────────────────────────────────────────────────────────

export async function startDashboard(opts: DashboardOptions = {}): Promise<void> {
  const stateDir  = opts.stateDir  ?? '.ruflo';
  const refreshMs = opts.refreshMs ?? REFRESH_MS;

  // ── Snapshot mode (--once): render once, exit, no TTY required. ────────────
  if (opts.once) {
    const data  = loadDashboardData(stateDir);
    const lines = renderFrame(data, width(), 0, 0);
    console.log(lines.join('\n'));
    return;
  }

  // ── Interactive mode ───────────────────────────────────────────────────────
  process.stdout.write(ANSI.hideCursor + ANSI.clear);

  let data         = loadDashboardData(stateDir);
  let scroll       = 0;
  let lastRefresh  = Date.now();
  let timer: ReturnType<typeof setInterval>;
  let busy         = false;    // prevent overlapping background actions

  function nextRefreshIn(): number {
    return Math.max(0, Math.round((lastRefresh + refreshMs - Date.now()) / 1000));
  }

  function draw(): void {
    const lines = renderFrame(data, width(), scroll, nextRefreshIn());
    paint(lines);
  }

  function refresh(): void {
    data        = loadDashboardData(stateDir);
    lastRefresh = Date.now();
    draw();
  }

  function teardown(): void {
    clearInterval(timer);
    process.stdout.write(ANSI.showCursor + '\n');
    if (process.stdin.isTTY) {
      try { process.stdin.setRawMode(false); } catch { /* ignore */ }
    }
    process.stdin.pause();
  }

  // Auto-refresh ticker.
  timer = setInterval(() => {
    refresh();
  }, refreshMs);

  // Countdown redraw every second (updates the "refresh in Xs" counter).
  const clockTimer = setInterval(() => { draw(); }, 1000);

  // Keyboard.
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (buf: Buffer) => {
      const action = parseKey(buf);
      if (!action) return;

      if (action === 'quit') {
        clearInterval(clockTimer);
        teardown();
        process.exit(0);
      }

      if (action === 'refresh') { refresh(); return; }

      if (action === 'scroll-up') {
        scroll = Math.max(0, scroll - 1);
        draw();
        return;
      }

      if (action === 'scroll-down') {
        scroll = Math.min(Math.max(0, data.jobs.length - 8), scroll + 1);
        draw();
        return;
      }

      if (action === 'learn' && !busy) {
        busy = true;
        (async () => {
          try {
            const { Router }       = await import('../../core/router/index.js');
            const { MemoryStore, createMemoryAdapter } = await import('../../core/memory/index.js');
            const { LearningLoop } = await import('../../core/learning/index.js');

            const adapter = await createMemoryAdapter({ backend: 'file', path: `${stateDir}/memory` });
            const memory  = new MemoryStore(adapter, 'ruflo');
            const router  = new Router({
              strategy: 'capability', fallbackProvider: 'openai',
              enabledProviders: ['anthropic', 'openai', 'groq'], stateDir,
            });
            const loop = new LearningLoop(router, memory, {
              mode: 'routing-heuristics', evalInterval: 10, minSamplesBeforeAdapt: 3,
            });
            await loop.run();
            await adapter.close();
          } catch { /* non-fatal */ } finally {
            busy = false;
            refresh();
          }
        })();
        return;
      }

      if (action === 'eval' && !busy) {
        busy = true;
        (async () => {
          try {
            const { EvalHarness } = await import('../../core/eval/index.js');
            const { loadProviderConfigs } = await import('../../core/llm/index.js');
            const configs = await loadProviderConfigs(process.cwd());
            const harness = new EvalHarness({ providerConfigs: configs, stateDir });
            await harness.run('general', { concurrency: 2 });
          } catch { /* non-fatal */ } finally {
            busy = false;
            refresh();
          }
        })();
        return;
      }
    });
  }

  // Graceful shutdown.
  process.on('SIGINT',  () => { clearInterval(clockTimer); teardown(); process.exit(0); });
  process.on('SIGTERM', () => { clearInterval(clockTimer); teardown(); process.exit(0); });
  process.on('exit',    () => { process.stdout.write(ANSI.showCursor); });

  // Handle terminal resize.
  process.stdout.on('resize', () => { draw(); });

  // Initial render.
  refresh();
}
