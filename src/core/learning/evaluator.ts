import type { AgentTask, AgentResult } from '../swarm/types.js';
import type { EvalResult, EvalScoreBreakdown } from './types.js';

// Stop-words stripped before keyword overlap to avoid inflating alignment scores.
const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','have','has','had',
  'do','does','did','will','would','could','should','may','might','must',
  'to','of','in','for','on','with','at','by','from','and','but','or',
  'if','that','this','it','its','not','no','so','as','into','over',
]);

// Regex patterns that signal a problematic / apology response.
const ERROR_SIGNAL = /\b(error|exception|failed|cannot|can't|i don't know|i'm sorry|unfortunately|i am unable|not able to|i apologize)\b/i;

// Code task markers — structural coherence signals for each task type.
const CODE_MARKER   = /```[\s\S]*?```|`[^`\n]+`|^\s*(function|class|const|let|var|def|import|export|async)\b/m;
const LIST_MARKER   = /^#{1,3}\s|^[-*]\s|^\d+\.\s/m;
const REASON_MARKER = /\b(therefore|because|thus|hence|consequently|first[,\s]|second[,\s]|finally)\b/i;

function keywords(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 3 && !STOP_WORDS.has(w))
  );
}

function scoreBreakdown(task: AgentTask, result: AgentResult): EvalScoreBreakdown {
  const output    = result.output;
  const profile   = task.decision.taskProfile;
  const taskType  = profile.type;
  const complexity = profile.complexity;

  // ── 1. Completeness ─────────────────────────────────────────────────────
  const minChars = complexity === 'high' ? 300 : complexity === 'medium' ? 100 : 30;
  let completeness: number;
  if (output.length === 0) {
    completeness = 0;
  } else if (output.length < minChars) {
    completeness = 0.2 + 0.8 * (output.length / minChars);
  } else {
    // Logarithmic saturation — very long responses cap at 1.
    completeness = Math.min(1, 0.7 + 0.3 * Math.log10(output.length / minChars + 1));
  }

  // ── 2. Error-free ────────────────────────────────────────────────────────
  const errorFree = ERROR_SIGNAL.test(output) ? 0.15 : 1.0;

  // ── 3. Task alignment (keyword overlap) ──────────────────────────────────
  const inputKw  = keywords(task.instruction);
  const outputKw = keywords(output);
  const overlap  = [...inputKw].filter((w) => outputKw.has(w)).length;
  // Scale: need ~60 % keyword overlap for full score.
  const taskAlignment = inputKw.size === 0 ? 0.5
    : Math.min(1, (overlap / inputKw.size) / 0.6);

  // ── 4. Coherence (task-type structure) ───────────────────────────────────
  let coherence: number;
  switch (taskType) {
    case 'coding':
    case 'execution':
      coherence = CODE_MARKER.test(output) ? 1.0 : 0.5;
      break;
    case 'analysis':
    case 'planning':
      coherence = LIST_MARKER.test(output) ? 1.0 : output.length > 200 ? 0.75 : 0.5;
      break;
    case 'reasoning':
      coherence = REASON_MARKER.test(output) ? 1.0 : 0.65;
      break;
    case 'creative':
      coherence = output.length > 150 ? 0.85 : 0.55;
      break;
    default:
      coherence = output.length > 80 ? 0.75 : 0.5;
  }

  return { completeness, errorFree, taskAlignment, coherence };
}

// Weights must sum to 1.
const WEIGHTS = { completeness: 0.30, errorFree: 0.25, taskAlignment: 0.25, coherence: 0.20 };

export function evaluateResult(task: AgentTask, result: AgentResult): EvalResult {
  const start     = Date.now();
  const bd        = scoreBreakdown(task, result);
  const quality   =
    WEIGHTS.completeness  * bd.completeness  +
    WEIGHTS.errorFree     * bd.errorFree     +
    WEIGHTS.taskAlignment * bd.taskAlignment +
    WEIGHTS.coherence     * bd.coherence;

  return {
    taskId:        result.taskId,
    jobId:         result.jobId,
    agentName:     result.agentName,
    provider:      result.provider,
    taskType:      task.decision.taskProfile.type,
    qualityScore:  Math.round(quality * 1000) / 1000,
    breakdown:     bd,
    evaluatorType: 'rule-based',
    scoredAt:      Date.now(),
  };
  void start;
}
