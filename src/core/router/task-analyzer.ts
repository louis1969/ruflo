import type { TaskProfile, TaskType, Complexity, LatencySensitivity } from './types.js';

// Keyword signals for task type classification.
// Order matters: first match wins (more specific patterns first).
const TYPE_SIGNALS: Array<{ type: TaskType; patterns: RegExp[] }> = [
  {
    type: 'coding',
    patterns: [
      /\b(write|generate|implement|fix|debug|refactor|code|function|class|script|algorithm|bug|error|compile|test)\b/i,
      /```|`[^`]+`|\bts\b|\bjs\b|\bpython\b|\brust\b|\bgo\b/i,
    ],
  },
  {
    type: 'reasoning',
    patterns: [
      /\b(why|reason|because|cause|effect|logic|prove|proof|infer|deduce|conclude|explain why|how does)\b/i,
      /\b(chain of thought|step by step|think through|analyze|reasoning)\b/i,
    ],
  },
  {
    type: 'planning',
    patterns: [
      /\b(plan|roadmap|strategy|schedule|milestone|timeline|steps to|how to achieve|architect|design|structure)\b/i,
    ],
  },
  {
    type: 'analysis',
    patterns: [
      /\b(analyze|compare|evaluate|assess|review|audit|summarize|breakdown|pros and cons|tradeoff|benchmark)\b/i,
    ],
  },
  {
    type: 'search',
    patterns: [
      /\b(find|search|lookup|what is|who is|where is|when did|list of|examples of|latest|recent|current)\b/i,
    ],
  },
  {
    type: 'creative',
    patterns: [
      /\b(write|create|generate|draft|compose|brainstorm|story|poem|blog|marketing|copy|headline|slogan|idea)\b/i,
    ],
  },
  {
    type: 'execution',
    patterns: [
      /\b(run|execute|call|invoke|deploy|send|trigger|perform|do|make|build|compile|start|stop|restart)\b/i,
    ],
  },
];

const COMPLEXITY_SIGNALS = {
  high: [
    /\b(complex|sophisticated|multi[\s-]?step|comprehensive|detailed|thorough|enterprise|production|architect)\b/i,
    /\b(optimize|refactor entire|redesign|migrate|large[\s-]scale|system-wide)\b/i,
  ],
  low: [
    /\b(simple|quick|brief|short|basic|small|tiny|single|just|only|one[\s-]?liner)\b/i,
    /^.{0,80}$/,
  ],
};

const REALTIME_SIGNALS = [
  /\b(urgent|asap|immediately|real[\s-]?time|live|streaming|low[\s-]?latency|fast)\b/i,
];

const BATCH_SIGNALS = [
  /\b(batch|async|background|offline|queue|schedule|later|no rush|whenever)\b/i,
];

const LONG_CONTEXT_SIGNALS = [
  /\b(entire|whole|full|complete|all of|every|summarize the following|given the document|throughout)\b/i,
];

const TOOLS_REQUIRED_SIGNALS = [
  /\b(search|browse|fetch|call api|run code|execute|read file|write file|database|query|http|webhook)\b/i,
];

// Rough token estimate: 1 token ≈ 4 characters.
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function classifyType(text: string): TaskType {
  for (const { type, patterns } of TYPE_SIGNALS) {
    if (patterns.some((p) => p.test(text))) return type;
  }
  return 'general';
}

function classifyComplexity(text: string): Complexity {
  if (COMPLEXITY_SIGNALS.high.some((p) => p.test(text))) return 'high';
  if (COMPLEXITY_SIGNALS.low.some((p) => p.test(text))) return 'low';
  // Medium by word count heuristic.
  const words = text.trim().split(/\s+/).length;
  if (words > 60) return 'high';
  if (words < 12) return 'low';
  return 'medium';
}

function classifyLatency(text: string): LatencySensitivity {
  if (REALTIME_SIGNALS.some((p) => p.test(text))) return 'realtime';
  if (BATCH_SIGNALS.some((p) => p.test(text))) return 'batch';
  return 'normal';
}

export function analyzeTask(raw: string): TaskProfile {
  return {
    raw,
    type: classifyType(raw),
    complexity: classifyComplexity(raw),
    estimatedInputTokens: estimateTokens(raw),
    latencySensitivity: classifyLatency(raw),
    requiresTools: TOOLS_REQUIRED_SIGNALS.some((p) => p.test(raw)),
    requiresLongContext: LONG_CONTEXT_SIGNALS.some((p) => p.test(raw)),
  };
}
