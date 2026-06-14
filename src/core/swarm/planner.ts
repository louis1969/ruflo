import { randomUUID } from 'crypto';
import type { TaskProfile } from '../router/types.js';
import type { RoutingDecision } from '../router/index.js';
import type { Router } from '../router/index.js';
import type { AgentTask, ExecutionMode, SwarmPlan } from './types.js';

// Maps (complexity, latencySensitivity, taskType) → execution plan.
// The planner is intentionally rule-based so it never adds LLM latency to routing.
// LLM-based decomposition is opt-in and comes as part of the planning agent itself.

interface PlanSpec {
  mode: ExecutionMode;
  agents: string[];
}

function choosePlan(profile: TaskProfile): PlanSpec {
  const { complexity, latencySensitivity, type } = profile;

  if (latencySensitivity === 'realtime') {
    return { mode: 'race', agents: ['executor', 'executor'] };
  }

  if (complexity === 'low') {
    const agent = agentForType(type);
    return { mode: 'sequential', agents: [agent] };
  }

  if (complexity === 'medium') {
    const agent = agentForType(type);
    return { mode: 'sequential', agents: [agent] };
  }

  // High complexity — fan out.
  switch (type) {
    case 'planning':
    case 'reasoning':
      return { mode: 'pipeline', agents: ['planner', 'executor', 'critic'] };
    case 'coding':
    case 'execution':
      return { mode: 'pipeline', agents: ['executor', 'critic'] };
    case 'analysis':
    case 'search':
      return { mode: 'parallel', agents: ['researcher', 'researcher'] };
    default:
      return { mode: 'pipeline', agents: ['planner', 'executor', 'critic'] };
  }
}

function agentForType(type: TaskProfile['type']): string {
  const map: Record<string, string> = {
    planning: 'planner',
    reasoning: 'planner',
    analysis: 'researcher',
    search: 'researcher',
    coding: 'executor',
    execution: 'executor',
    creative: 'executor',
    general: 'planner',
  };
  return map[type] ?? 'planner';
}

export function buildPlan(
  jobId: string,
  profile: TaskProfile,
  primaryDecision: RoutingDecision,
  router: Router,
  maxConcurrency: number,
  timeoutMs: number
): SwarmPlan {
  const spec = choosePlan(profile);

  const tasks: AgentTask[] = spec.agents.map((agentName, index) => {
    // Each task in a pipeline/parallel fan-out may get its own routing decision.
    // For race mode both slots intentionally hit different providers.
    let decision = primaryDecision;
    if (index > 0 && spec.mode !== 'pipeline') {
      try {
        decision = router.routeProfile(profile, agentName);
      } catch {
        decision = primaryDecision;
      }
    }

    return {
      id: randomUUID(),
      jobId,
      index,
      agentName,
      instruction: profile.raw,
      upstreamContext: [],
      decision,
      // Pipeline tasks wait for the previous task's output before starting.
      dependsOn: spec.mode === 'pipeline' && index > 0
        ? []  // filled in by executor using ordered results
        : [],
    };
  });

  return { jobId, mode: spec.mode, tasks, maxConcurrency, timeoutMs };
}
