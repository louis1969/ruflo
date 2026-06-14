import type { AgentTask, AgentResult, SwarmPlan, AgentRunner } from './types.js';
import type { Router } from '../router/index.js';
import type { LLMProvider } from '../../types/index.js';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

// ── Mock runner ──────────────────────────────────────────────────────────────
// Used until real LLM adapters are wired in. Simulates realistic latency,
// structured output, and a small random failure rate to exercise circuit-breakers.

const MOCK_LATENCY: Record<LLMProvider, number> = {
  groq: 150, gemini: 300, openai: 500, anthropic: 800, ollama: 1200,
};

export const mockAgentRunner: AgentRunner = async (task: AgentTask): Promise<AgentResult> => {
  const provider = task.decision.selectedProvider;
  const baseLatency = MOCK_LATENCY[provider] ?? 500;
  const jitter = Math.random() * baseLatency * 0.4;
  await sleep(baseLatency + jitter);

  // 5 % simulated failure rate.
  const fail = Math.random() < 0.05;

  if (fail) {
    return {
      taskId: task.id,
      jobId: task.jobId,
      agentName: task.agentName,
      provider,
      output: '',
      success: false,
      latencyMs: baseLatency + jitter,
      costUsd: 0,
      qualityScore: null,
      errorMessage: 'Simulated transient error (mock runner)',
      retries: 0,
      completedAt: Date.now(),
    };
  }

  const context = task.upstreamContext.length
    ? `\nContext from prior stages:\n${task.upstreamContext.join('\n---\n')}`
    : '';

  const output =
    `[${task.agentName}@${provider}] Processed: "${task.instruction}"${context}\n` +
    `Mock output for task ${task.id} (index ${task.index}).`;

  const tokens = Math.ceil(task.instruction.length / 4);
  const costPer1k = { groq: 0.001, gemini: 0.0001, openai: 0.003, anthropic: 0.003, ollama: 0 };
  const costUsd = (tokens / 1000) * (costPer1k[provider] ?? 0.002);

  return {
    taskId: task.id,
    jobId: task.jobId,
    agentName: task.agentName,
    provider,
    output,
    success: true,
    latencyMs: baseLatency + jitter,
    costUsd,
    qualityScore: null,
    retries: 0,
    completedAt: Date.now(),
  };
};

// ── Promise pool ─────────────────────────────────────────────────────────────

async function runWithConcurrency<T>(fns: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(fns.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < fns.length) {
      const i = next++;
      results[i] = await fns[i]!();
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, fns.length) }, worker));
  return results;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Single task executor with retry ─────────────────────────────────────────

async function runTask(
  task: AgentTask,
  runner: AgentRunner,
  router: Router,
  timeoutMs: number
): Promise<AgentResult> {
  let attempt = 0;
  let lastError = '';

  while (attempt <= MAX_RETRIES) {
    const start = Date.now();
    let result: AgentResult;

    try {
      result = await Promise.race([
        runner(task),
        sleep(timeoutMs).then((): AgentResult => ({
          taskId: task.id,
          jobId: task.jobId,
          agentName: task.agentName,
          provider: task.decision.selectedProvider,
          output: '',
          success: false,
          latencyMs: timeoutMs,
          costUsd: 0,
          qualityScore: null,
          errorMessage: `Timeout after ${timeoutMs}ms`,
          retries: attempt,
          completedAt: Date.now(),
        })),
      ]);
    } catch (err) {
      lastError = String(err);
      result = {
        taskId: task.id,
        jobId: task.jobId,
        agentName: task.agentName,
        provider: task.decision.selectedProvider,
        output: '',
        success: false,
        latencyMs: Date.now() - start,
        costUsd: 0,
        qualityScore: null,
        errorMessage: lastError,
        retries: attempt,
        completedAt: Date.now(),
      };
    }

    // Feed outcome to learning loop regardless of success.
    router.recordOutcome({
      decisionId: task.decision.id,
      provider: task.decision.selectedProvider,
      taskType: task.decision.taskProfile.type,
      success: result.success,
      actualLatencyMs: result.latencyMs,
      actualCostUsd: result.costUsd,
      qualityScore: null,
      ...(result.errorMessage ? { errorType: result.errorMessage } : {}),
    });

    if (result.success) return { ...result, retries: attempt };

    // On failure try fallback provider before retrying.
    if (attempt < MAX_RETRIES && task.decision.fallbackProvider) {
      const fallback = task.decision.fallbackProvider;
      task = {
        ...task,
        decision: { ...task.decision, selectedProvider: fallback, fallbackProvider: null },
      };
    }

    attempt++;
    if (attempt <= MAX_RETRIES) await sleep(RETRY_DELAY_MS * attempt);
  }

  return {
    taskId: task.id,
    jobId: task.jobId,
    agentName: task.agentName,
    provider: task.decision.selectedProvider,
    output: '',
    success: false,
    latencyMs: 0,
    costUsd: 0,
    qualityScore: null,
    errorMessage: lastError || 'All retries exhausted',
    retries: MAX_RETRIES,
    completedAt: Date.now(),
  };
}

// ── Plan-level executor ──────────────────────────────────────────────────────

export async function executePlan(
  plan: SwarmPlan,
  runner: AgentRunner,
  router: Router
): Promise<AgentResult[]> {
  const { mode, tasks, maxConcurrency, timeoutMs } = plan;

  switch (mode) {
    case 'sequential':
    case 'pipeline': {
      const results: AgentResult[] = [];
      for (const task of tasks) {
        // Pipeline: inject all prior outputs as context.
        if (mode === 'pipeline' && results.length > 0) {
          task.upstreamContext = results.filter((r) => r.success).map((r) => r.output);
        }
        results.push(await runTask(task, runner, router, timeoutMs));
      }
      return results;
    }

    case 'parallel': {
      const fns = tasks.map((t) => () => runTask(t, runner, router, timeoutMs));
      return runWithConcurrency(fns, maxConcurrency);
    }

    case 'race': {
      // First success wins. All tasks run in parallel; losers are still awaited
      // so their outcomes reach the router, but only the winner's output is used
      // (aggregator handles this).
      const promises = tasks.map((t) => runTask(t, runner, router, timeoutMs));
      const winner = await Promise.any(promises.map(async (p) => {
        const r = await p;
        if (!r.success) throw new Error(r.errorMessage);
        return r;
      })).catch(async () => {
        // All failed — return the first completed result as-is.
        return (await Promise.all(promises))[0]!;
      });
      // Await the rest so circuit-breaker feedback still fires.
      const all = await Promise.allSettled(promises);
      const losers = all
        .map((s) => (s.status === 'fulfilled' ? s.value : null))
        .filter((r): r is AgentResult => r !== null && r.taskId !== winner.taskId);
      return [winner, ...losers];
    }
  }
}
