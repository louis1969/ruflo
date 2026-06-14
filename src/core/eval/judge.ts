import type { LLMProvider } from '../../types/index.js';
import type { TaskType } from '../router/types.js';
import type { EvalScoreBreakdown } from '../learning/types.js';
import type { EvalCase } from './types.js';
import type { ILLMAdapter } from '../llm/types.js';

export const PASS_THRESHOLD = 0.70;

// ── Rule-based scorer ─────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','have','has','had',
  'do','does','did','will','would','could','should','may','might','must',
  'to','of','in','for','on','with','at','by','from','and','but','or',
  'if','that','this','it','its','not','no','so','as','into','over',
]);

const ERROR_SIGNAL = /\b(error|exception|failed|cannot|can't|i don't know|i'm sorry|unfortunately|i am unable|not able to|i apologize)\b/i;
const CODE_MARKER   = /```[\s\S]*?```|`[^`\n]+`|^\s*(function|class|const|let|var|def|import|export|async)\b/m;
const LIST_MARKER   = /^#{1,3}\s|^[-*]\s|^\d+\.\s/m;
const REASON_MARKER = /\b(therefore|because|thus|hence|consequently|first[,\s]|second[,\s]|finally)\b/i;

function keywords(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/\W+/).filter((w) => w.length > 3 && !STOP_WORDS.has(w)));
}

export function ruleBasedScore(
  prompt:     string,
  output:     string,
  taskType:   TaskType,
  complexity: 'low' | 'medium' | 'high'
): { score: number; breakdown: EvalScoreBreakdown } {
  // 1. Completeness.
  const minChars    = complexity === 'high' ? 300 : complexity === 'medium' ? 100 : 30;
  let completeness: number;
  if (output.length === 0) {
    completeness = 0;
  } else if (output.length < minChars) {
    completeness = 0.2 + 0.8 * (output.length / minChars);
  } else {
    completeness = Math.min(1, 0.7 + 0.3 * Math.log10(output.length / minChars + 1));
  }

  // 2. Error-free.
  const errorFree = ERROR_SIGNAL.test(output) ? 0.15 : 1.0;

  // 3. Keyword alignment.
  const inputKw      = keywords(prompt);
  const outputKw     = keywords(output);
  const overlap      = [...inputKw].filter((w) => outputKw.has(w)).length;
  const taskAlignment = inputKw.size === 0 ? 0.5 : Math.min(1, (overlap / inputKw.size) / 0.6);

  // 4. Structural coherence.
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

  const breakdown: EvalScoreBreakdown = { completeness, errorFree, taskAlignment, coherence };
  const score =
    0.30 * completeness +
    0.25 * errorFree    +
    0.25 * taskAlignment +
    0.20 * coherence;

  return { score: Math.round(score * 1000) / 1000, breakdown };
}

// ── LLM-as-judge ─────────────────────────────────────────────────────────────

interface JudgeResult {
  score:       number;
  reasoning:   string;
  passed:      string[];
  failed:      string[];
}

const JUDGE_SYSTEM = `You are a rigorous AI output evaluator. Your job is to score AI-generated outputs against a provided rubric.
Be objective, consistent, and calibrated. A score of 1.0 means perfect; 0.0 means completely failed.
Always respond with valid JSON only — no markdown fences, no preamble.`;

function buildJudgePrompt(task: EvalCase, output: string): string {
  const criteriaList = task.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n');
  return [
    '## Task',
    task.prompt,
    '',
    '## Evaluation Criteria',
    criteriaList,
    '',
    '## Output to Evaluate',
    output || '(empty output)',
    '',
    '## Instructions',
    'For each criterion, determine PASS or FAIL with a brief reason.',
    'Then give an overall score from 0.0 to 1.0.',
    '',
    'Respond with this exact JSON structure:',
    JSON.stringify({
      criteriaResults: [{ criterion: 'string', passed: true, reason: 'string' }],
      score: 0.85,
      reasoning: 'Overall summary of the evaluation',
    }, null, 2),
  ].join('\n');
}

export async function llmJudge(
  adapter:    ILLMAdapter,
  judgeModel: string,
  task:       EvalCase,
  output:     string
): Promise<JudgeResult> {
  const response = await adapter.complete({
    model:       judgeModel,
    system:      JUDGE_SYSTEM,
    messages:    [{ role: 'user', content: buildJudgePrompt(task, output) }],
    maxTokens:   1024,
    temperature: 0.1,
  });

  try {
    const raw = response.content.trim();
    // Strip markdown fences if model adds them anyway.
    const json = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(json) as {
      criteriaResults: Array<{ criterion: string; passed: boolean; reason: string }>;
      score: number;
      reasoning: string;
    };

    const passed = parsed.criteriaResults.filter((c) => c.passed).map((c) => c.criterion);
    const failed = parsed.criteriaResults.filter((c) => !c.passed).map((c) => c.criterion);

    return {
      score:     Math.min(1, Math.max(0, parsed.score)),
      reasoning: parsed.reasoning,
      passed,
      failed,
    };
  } catch {
    // Fallback: try to extract a score number from the response.
    const match = response.content.match(/\b(0\.\d{1,3}|1\.0)\b/);
    const score = match ? parseFloat(match[1]!) : 0.5;
    return { score, reasoning: response.content.slice(0, 200), passed: [], failed: [] };
  }
}

// ── Criteria checker (rule-based, for keyword-based criteria pass/fail) ───────

export function checkCriteriaRuleBased(
  task:   EvalCase,
  output: string
): { passed: string[]; failed: string[] } {
  const passed: string[] = [];
  const failed: string[] = [];
  const lower = output.toLowerCase();

  for (const criterion of task.criteria) {
    const criterionKw = keywords(criterion);
    const outputKw    = keywords(output);
    const overlap     = [...criterionKw].filter((w) => outputKw.has(w)).length;
    // Heuristic: if >40% of criterion keywords appear in output, treat as passed.
    if (criterionKw.size === 0 || overlap / criterionKw.size >= 0.40) {
      passed.push(criterion);
    } else {
      failed.push(criterion);
    }
    void lower; // suppress unused warning
  }

  return { passed, failed };
}

// ── Adapter factory for judge ─────────────────────────────────────────────────

export async function resolveJudgeAdapter(
  configs: Record<string, { apiKey?: string; model?: string; baseUrl?: string } | undefined>
): Promise<{ adapter: ILLMAdapter; model: string; provider: LLMProvider } | null> {
  const JUDGE_PREFERENCE: LLMProvider[] = ['anthropic', 'openai', 'groq'];
  const { createAdapter, DEFAULT_MODELS } = await import('../llm/factory.js');

  for (const provider of JUDGE_PREFERENCE) {
    const cfg = configs[provider];
    if (!cfg || (!cfg.apiKey && !cfg.baseUrl)) continue;
    const adapter = createAdapter(provider, cfg as { apiKey: string; model?: string; baseUrl?: string });
    const model   = cfg.model ?? DEFAULT_MODELS[provider];
    return { adapter, model, provider };
  }
  return null;
}
