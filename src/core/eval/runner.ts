import type { LLMProvider, RoutingStrategy, RufloConfig } from '../../types/index.js';
import type { EvalCase, EvalJudgment, EvalRun, EvalSuite } from './types.js';
import type { ILLMAdapter } from '../llm/types.js';
import { ruleBasedScore, llmJudge, checkCriteriaRuleBased, resolveJudgeAdapter, PASS_THRESHOLD } from './judge.js';
import { randomUUID } from 'crypto';

export type JudgeMode = 'rule' | 'llm' | 'hybrid';

export interface EvalRunOptions {
  strategy:      RoutingStrategy;
  onlyProvider?: LLMProvider;
  judgeMode:     JudgeMode;
  concurrency:   number;
  providerConfigs: RufloConfig['providers'];
  onProgress?:   (done: number, total: number, caseName: string) => void;
}

// ── Concurrency pool ──────────────────────────────────────────────────────────

async function runWithConcurrency<T>(
  items:   T[],
  limit:   number,
  fn:      (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

// ── Swarm factory for eval runs ────────────────────────────────────────────────

async function buildEvalSwarm(opts: EvalRunOptions) {
  const { Router }          = await import('../router/index.js');
  const { Swarm }           = await import('../swarm/index.js');
  const { MemoryStore, createMemoryAdapter } = await import('../memory/index.js');
  const { enabledProviders, createAgentRunner } = await import('../llm/index.js');

  const active  = enabledProviders(opts.providerConfigs);
  const providers = opts.onlyProvider
    ? (active.includes(opts.onlyProvider) ? [opts.onlyProvider] : active)
    : active;

  const fallback = providers[0] ?? 'anthropic';
  const runner   = active.length > 0 ? createAgentRunner(opts.providerConfigs) : undefined;

  const router  = new Router({
    strategy:         opts.onlyProvider ? 'round-robin' : opts.strategy,
    fallbackProvider: fallback,
    enabledProviders: providers.length > 0 ? providers : ['anthropic', 'openai', 'groq'] as LLMProvider[],
    stateDir:         '.ruflo',
  });

  const adapter = await createMemoryAdapter({ backend: 'file', path: '.ruflo/memory' });
  const memory  = new MemoryStore(adapter, 'ruflo');
  const swarm   = new Swarm({ maxConcurrentAgents: 5, timeoutMs: 90_000 }, router, memory, runner);

  return { swarm, adapter };
}

// ── Case runner ───────────────────────────────────────────────────────────────

async function runCase(
  ec:          EvalCase,
  strategy:    RoutingStrategy,
  swarm:       { submit(prompt: string): Promise<{ output: string; success: boolean; totalLatencyMs: number; totalCostUsd: number; providersUsed: LLMProvider[] }> },
  judgeAdapter: { adapter: ILLMAdapter; model: string; provider: LLMProvider } | null,
  judgeMode:   JudgeMode
): Promise<EvalJudgment> {
  let output      = '';
  let success     = false;
  let latencyMs   = 0;
  let costUsd     = 0;
  let provider: LLMProvider = 'anthropic';

  try {
    const result = await swarm.submit(ec.prompt);
    output    = result.output;
    success   = result.success;
    latencyMs = result.totalLatencyMs;
    costUsd   = result.totalCostUsd;
    provider  = result.providersUsed[0] ?? 'anthropic';
  } catch (err) {
    output  = err instanceof Error ? `[swarm error] ${err.message}` : '[swarm error]';
    success = false;
  }

  // Rule-based score always runs.
  const { score: ruleScore, breakdown } = ruleBasedScore(ec.prompt, output, ec.taskType, ec.complexity);

  let llmScore:     number | null     = null;
  let llmReasoning: string | undefined;
  let passedCriteria: string[] = [];
  let failedCriteria: string[] = [];

  if ((judgeMode === 'llm' || judgeMode === 'hybrid') && judgeAdapter) {
    try {
      const judgeResult = await llmJudge(judgeAdapter.adapter, judgeAdapter.model, ec, output);
      llmScore      = judgeResult.score;
      llmReasoning  = judgeResult.reasoning;
      passedCriteria = judgeResult.passed;
      failedCriteria = judgeResult.failed;
    } catch {
      // LLM judge failed — fall back to rule-based criteria check.
      const rb = checkCriteriaRuleBased(ec, output);
      passedCriteria = rb.passed;
      failedCriteria = rb.failed;
    }
  } else {
    const rb = checkCriteriaRuleBased(ec, output);
    passedCriteria = rb.passed;
    failedCriteria = rb.failed;
  }

  // Final score: hybrid averages rule + llm; llm-only uses llm; rule-only uses rule.
  let finalScore: number;
  if (judgeMode === 'hybrid' && llmScore !== null) {
    finalScore = Math.round((0.40 * ruleScore + 0.60 * llmScore) * 1000) / 1000;
  } else if (judgeMode === 'llm' && llmScore !== null) {
    finalScore = Math.round(llmScore * 1000) / 1000;
  } else {
    finalScore = ruleScore;
  }

  return {
    caseId:             ec.id,
    caseName:           ec.name,
    taskType:           ec.taskType,
    complexity:         ec.complexity,
    provider,
    strategy,
    output,
    success,
    latencyMs,
    costUsd,
    scores:             { ruleBased: ruleScore, llmJudge: llmScore, final: finalScore },
    breakdown,
    llmJudgeReasoning:  llmReasoning,
    passedCriteria,
    failedCriteria,
    passed:             finalScore >= PASS_THRESHOLD,
  };
}

// ── Public runner ──────────────────────────────────────────────────────────────

export async function runEvalSuite(
  suite: EvalSuite,
  opts:  EvalRunOptions
): Promise<EvalRun> {
  const runAt    = Date.now();
  const runId    = randomUUID();
  const { swarm, adapter } = await buildEvalSwarm(opts);

  let judgeAdapter: Awaited<ReturnType<typeof resolveJudgeAdapter>> = null;
  if (opts.judgeMode !== 'rule') {
    judgeAdapter = await resolveJudgeAdapter(
      opts.providerConfigs as Record<string, { apiKey?: string; model?: string; baseUrl?: string } | undefined>
    );
  }

  const judgments: EvalJudgment[] = [];
  let done = 0;

  await runWithConcurrency(suite.cases, opts.concurrency, async (ec) => {
    const judgment = await runCase(ec, opts.strategy, swarm, judgeAdapter, opts.judgeMode);
    judgments.push(judgment);
    done += 1;
    opts.onProgress?.(done, suite.cases.length, ec.name);
  });

  await adapter.close();

  // ── Build summary ────────────────────────────────────────────────────────────
  const byProvider: Record<string, { cases: number; passed: number; scores: number[]; latencies: number[]; cost: number }> = {};
  const byTaskType: Record<string, { cases: number; scores: number[]; passed: number }> = {};

  for (const j of judgments) {
    // Provider.
    const ps = byProvider[j.provider] ??= { cases: 0, passed: 0, scores: [], latencies: [], cost: 0 };
    ps.cases      += 1;
    ps.passed     += j.passed ? 1 : 0;
    ps.scores.push(j.scores.final);
    ps.latencies.push(j.latencyMs);
    ps.cost       += j.costUsd;

    // Task type.
    const ts = byTaskType[j.taskType] ??= { cases: 0, scores: [], passed: 0 };
    ts.cases  += 1;
    ts.scores.push(j.scores.final);
    ts.passed += j.passed ? 1 : 0;
  }

  const avg = (nums: number[]) => nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;

  const totalCases   = judgments.length;
  const passed       = judgments.filter((j) => j.passed).length;
  const allScores    = judgments.map((j) => j.scores.final);
  const allLatencies = judgments.map((j) => j.latencyMs);
  const totalCost    = judgments.reduce((s, j) => s + j.costUsd, 0);

  const run: EvalRun = {
    id:        runId,
    suiteId:   suite.id,
    suiteName: suite.name,
    runAt,
    strategy:  opts.strategy,
    judgments,
    summary: {
      totalCases,
      passed,
      passRate:     totalCases > 0 ? Math.round((passed / totalCases) * 1000) / 1000 : 0,
      avgScore:     Math.round(avg(allScores) * 1000) / 1000,
      avgLatencyMs: Math.round(avg(allLatencies)),
      totalCostUsd: Math.round(totalCost * 1_000_000) / 1_000_000,
      byProvider: Object.fromEntries(
        Object.entries(byProvider).map(([p, s]) => [p, {
          cases:        s.cases,
          passed:       s.passed,
          passRate:     Math.round((s.passed / s.cases) * 1000) / 1000,
          avgScore:     Math.round(avg(s.scores) * 1000) / 1000,
          avgLatencyMs: Math.round(avg(s.latencies)),
          totalCostUsd: Math.round(s.cost * 1_000_000) / 1_000_000,
        }])
      ),
      byTaskType: Object.fromEntries(
        Object.entries(byTaskType).map(([t, s]) => [t, {
          cases:    s.cases,
          avgScore: Math.round(avg(s.scores) * 1000) / 1000,
          passRate: Math.round((s.passed / s.cases) * 1000) / 1000,
        }])
      ),
    },
  };

  return run;
}
