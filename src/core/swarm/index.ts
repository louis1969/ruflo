import { randomUUID } from 'crypto';
import type { Router } from '../router/index.js';
import type { MemoryStore } from '../memory/index.js';
import type { AgentRunner, SwarmJob, SwarmResult } from './types.js';
import type { PluginManager } from '../plugins/index.js';
import { buildPlan } from './planner.js';
import { executePlan, mockAgentRunner } from './executor.js';
import { aggregate } from './aggregator.js';

export interface SwarmConfig {
  maxConcurrentAgents: number;
  timeoutMs: number;
}

const JOB_INDEX_KEY = 'index';
const JOB_INDEX_MAX = 200;

export class Swarm {
  private readonly router:  Router;
  private readonly memory:  MemoryStore;
  private readonly config:  SwarmConfig;
  private readonly runner:  AgentRunner;
  private readonly jobs:    MemoryStore;
  private readonly plugins: PluginManager | undefined;

  constructor(
    config:  SwarmConfig,
    router:  Router,
    memory:  MemoryStore,
    runner:  AgentRunner = mockAgentRunner,
    plugins?: PluginManager
  ) {
    this.config  = config;
    this.router  = router;
    this.memory  = memory;
    this.runner  = runner;
    this.plugins = plugins;
    this.jobs    = memory.ns('job');
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async submit(rawTask: string, preferredAgent?: string): Promise<SwarmResult> {
    const jobId = randomUUID();
    const startedAt = Date.now();

    // 1. Route the task to get a primary decision + task profile.
    const decision = this.router.route(rawTask, preferredAgent);
    const profile = decision.taskProfile;

    // 2. Build the execution plan.
    const plan = buildPlan(
      jobId,
      profile,
      decision,
      this.router,
      this.config.maxConcurrentAgents,
      this.config.timeoutMs
    );

    // 3. Fire before:job hook.
    await this.plugins?.hooks.fire('before:job', { jobId, raw: rawTask });

    // 4. Persist the job as "running".
    const job: SwarmJob = {
      id: jobId,
      raw: rawTask,
      status: 'running',
      plan,
      results: [],
      startedAt,
    };
    await this.persistJob(job);

    // 5. Execute the plan.
    let results;
    try {
      results = await executePlan(plan, this.runner, this.router);
    } catch (err) {
      job.status = 'failed';
      job.completedAt = Date.now();
      await this.persistJob(job);
      throw err;
    }

    // 6. Aggregate.
    const swarmResult = aggregate(jobId, plan.mode, results, startedAt);

    // 7. Persist final job state.
    job.status = swarmResult.success ? 'completed' : results.some((r) => r.success) ? 'partial' : 'failed';
    job.results = results;
    job.completedAt = Date.now();
    await this.persistJob(job);

    // 7. Write per-agent last-run stats so the learning loop can read them.
    for (const r of results) {
      await this.memory.ns('agent').set(
        `${r.agentName}:last_run`,
        { ts: r.completedAt, provider: r.provider, success: r.success, latencyMs: r.latencyMs }
      );
    }

    // 8. Fire after:job hook.
    await this.plugins?.hooks.fire('after:job', { jobId, result: swarmResult });

    return swarmResult;
  }

  async getJob(jobId: string): Promise<SwarmJob | null> {
    return this.jobs.get<SwarmJob>(jobId);
  }

  async listJobs(): Promise<string[]> {
    return (await this.jobs.get<string[]>(JOB_INDEX_KEY)) ?? [];
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async persistJob(job: SwarmJob): Promise<void> {
    const isNew = !(await this.jobs.exists(job.id));
    await this.jobs.set(job.id, job);
    if (isNew) await this.jobs.append<string>(JOB_INDEX_KEY, job.id, JOB_INDEX_MAX);
  }
}

export type { SwarmResult, SwarmJob, AgentRunner } from './types.js';
