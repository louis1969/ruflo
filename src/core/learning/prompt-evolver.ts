import type { SwarmJob } from '../swarm/types.js';
import type { EvalResult, FailurePattern, PromptCandidate } from './types.js';
import type { TaskType } from '../router/types.js';

const LOW_QUALITY_THRESHOLD = 0.45;
const MIN_PATTERN_FREQUENCY = 2;

// ── Pattern detection ────────────────────────────────────────────────────────

function detectFailureKind(e: EvalResult): FailurePattern['kind'] | null {
  if (e.breakdown.completeness < 0.2)  return 'empty-output';
  if (e.breakdown.completeness < 0.5)  return 'low-completeness';
  if (e.breakdown.errorFree < 0.5)     return 'error-signal';
  if (e.breakdown.taskAlignment < 0.4) return 'low-alignment';
  if (e.breakdown.coherence < 0.5)     return 'poor-structure';
  return null;
}

export function detectPatterns(
  evals: EvalResult[],
  jobs: SwarmJob[]
): FailurePattern[] {
  const jobMap = new Map(jobs.map((j) => [j.id, j]));
  const lowQuality = evals.filter((e) => e.qualityScore < LOW_QUALITY_THRESHOLD);

  // Bucket by (agentName, taskType, kind).
  type BucketKey = string;
  const buckets = new Map<BucketKey, {
    agentName: string;
    taskType: TaskType;
    kind: FailurePattern['kind'];
    examples: string[];
  }>();

  for (const e of lowQuality) {
    const kind = detectFailureKind(e);
    if (!kind) continue;

    const key: BucketKey = `${e.agentName}::${e.taskType}::${kind}`;
    const existing = buckets.get(key) ?? { agentName: e.agentName, taskType: e.taskType, kind, examples: [] };

    if (existing.examples.length < 3) {
      const job = jobMap.get(e.jobId);
      const instruction = job?.raw ?? '';
      existing.examples.push(instruction.slice(0, 80));
    }
    buckets.set(key, existing);
  }

  return [...buckets.entries()]
    .map(([, v]) => ({ ...v, frequency: v.examples.length }))
    .filter((p) => p.frequency >= MIN_PATTERN_FREQUENCY);
}

// ── Hint generation ──────────────────────────────────────────────────────────

const HINTS: Record<FailurePattern['kind'], (p: FailurePattern) => string> = {
  'empty-output': (p) =>
    `[${p.agentName}/${p.taskType}] Always produce output. ` +
    `If uncertain, explain what you know and what additional context you need. ` +
    `Never return an empty response.`,

  'low-completeness': (p) =>
    `[${p.agentName}/${p.taskType}] Responses are too short. ` +
    `For ${p.taskType} tasks provide comprehensive coverage. ` +
    `Include context, rationale, and concrete examples where applicable.`,

  'error-signal': (p) =>
    `[${p.agentName}/${p.taskType}] Avoid phrases like "I cannot", "I'm sorry", or "I don't know". ` +
    `Instead, provide the best answer possible and note any limitations inline. ` +
    `Attempt the task fully before qualifying it.`,

  'low-alignment': (p) =>
    `[${p.agentName}/${p.taskType}] Responses drift from the task. ` +
    `Re-read the instruction before generating output. ` +
    `Address every explicit requirement in the prompt.`,

  'poor-structure': (p) => {
    const structureGuide: Record<string, string> = {
      coding:    'Use code blocks (```lang) for all code, precede with a brief explanation.',
      analysis:  'Use markdown headers (## Section) and bullet lists for each key point.',
      planning:  'Use numbered steps, include success criteria for each step.',
      reasoning: 'State your chain of reasoning explicitly: first → then → therefore.',
    };
    const guide = structureGuide[p.taskType] ?? 'Format output clearly with sections and examples.';
    return `[${p.agentName}/${p.taskType}] Improve structure. ${guide}`;
  },
};

export function generateCandidates(patterns: FailurePattern[]): PromptCandidate[] {
  return patterns.map((p) => ({
    agentName:   p.agentName,
    taskType:    p.taskType,
    hint:        HINTS[p.kind](p),
    pattern:     p,
    generatedAt: Date.now(),
    status:      'candidate' as const,
    evalScore:   null,
  }));
}
