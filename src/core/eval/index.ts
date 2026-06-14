import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import type { LLMProvider, RoutingStrategy, RufloConfig } from '../../types/index.js';
import type { EvalRun, EvalReport, EvalComparison, EvalSuite } from './types.js';
import type { JudgeMode } from './runner.js';
import { runEvalSuite }                    from './runner.js';
import { compareRuns, generateEvalRecommendations } from './reporter.js';
import { loadSuite, listBuiltInSuites }    from './suites/index.js';

export interface EvalHarnessOptions {
  providerConfigs: RufloConfig['providers'];
  stateDir?:       string;
}

export interface RunOptions {
  strategy?:     RoutingStrategy;
  onlyProvider?: LLMProvider;
  judgeMode?:    JudgeMode;
  concurrency?:  number;
  compareRunId?: string;
  onProgress?:   (done: number, total: number, caseName: string) => void;
}

export class EvalHarness {
  private readonly providerConfigs: RufloConfig['providers'];
  private readonly stateDir: string;
  private runStore: Map<string, EvalRun> = new Map();
  private storePath: string;

  constructor(opts: EvalHarnessOptions) {
    this.providerConfigs = opts.providerConfigs;
    this.stateDir        = opts.stateDir ?? '.ruflo';
    this.storePath       = `${this.stateDir}/eval-runs.json`;
    this.loadFromDisk();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async run(suiteIdOrPath: string, opts: RunOptions = {}): Promise<EvalReport> {
    const suite = loadSuite(suiteIdOrPath);

    const strategy    = opts.strategy    ?? 'capability';
    const judgeMode   = opts.judgeMode   ?? 'rule';
    const concurrency = opts.concurrency ?? 2;

    const run = await runEvalSuite(suite, {
      strategy,
      onlyProvider:    opts.onlyProvider,
      judgeMode,
      concurrency,
      providerConfigs: this.providerConfigs,
      onProgress:      opts.onProgress,
    });

    this.runStore.set(run.id, run);
    this.saveToDisk();

    // Optional comparison.
    let comparison: EvalComparison | undefined;
    if (opts.compareRunId) {
      const base = this.runStore.get(opts.compareRunId);
      if (base) comparison = compareRuns(base, run);
    } else {
      // Auto-compare against the most recent run of the same suite.
      const prev = this.latestRunForSuite(suite.id, run.id);
      if (prev) comparison = compareRuns(prev, run);
    }

    const recommendations = generateEvalRecommendations(run, comparison);
    return { run, comparison, recommendations };
  }

  listRuns(suiteId?: string): EvalRun[] {
    const runs = [...this.runStore.values()].sort((a, b) => b.runAt - a.runAt);
    return suiteId ? runs.filter((r) => r.suiteId === suiteId) : runs;
  }

  getLatestRun(suiteId?: string): EvalRun | null {
    return this.listRuns(suiteId)[0] ?? null;
  }

  getRun(runId: string): EvalRun | null {
    return this.runStore.get(runId) ?? null;
  }

  compare(baseId: string, compareId: string): EvalComparison | null {
    const base    = this.runStore.get(baseId);
    const compare = this.runStore.get(compareId);
    if (!base || !compare) return null;
    return compareRuns(base, compare);
  }

  listSuites(): EvalSuite[] {
    return listBuiltInSuites();
  }

  loadSuite(idOrPath: string): EvalSuite {
    return loadSuite(idOrPath);
  }

  // ── Persistence ──────────────────────────────────────────────────────────────

  private loadFromDisk(): void {
    try {
      if (!existsSync(this.storePath)) return;
      const data = JSON.parse(readFileSync(this.storePath, 'utf8')) as Record<string, EvalRun>;
      for (const [id, run] of Object.entries(data)) {
        this.runStore.set(id, run);
      }
    } catch {
      // Non-fatal — start with empty store.
    }
  }

  private saveToDisk(): void {
    try {
      mkdirSync(this.stateDir, { recursive: true });
      const data = Object.fromEntries(this.runStore);
      writeFileSync(this.storePath, JSON.stringify(data, null, 2));
    } catch {
      // Non-fatal.
    }
  }

  private latestRunForSuite(suiteId: string, excludeId: string): EvalRun | null {
    return (
      [...this.runStore.values()]
        .filter((r) => r.suiteId === suiteId && r.id !== excludeId)
        .sort((a, b) => b.runAt - a.runAt)[0] ?? null
    );
  }
}

export type { EvalRun, EvalReport, EvalComparison, EvalSuite } from './types.js';
export type { JudgeMode } from './runner.js';
export { PASS_THRESHOLD } from './judge.js';
export { renderMarkdown, renderTerminal } from './reporter.js';
export { listBuiltInSuites, loadSuite } from './suites/index.js';
