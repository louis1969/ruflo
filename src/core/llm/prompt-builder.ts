import type { AgentTask } from '../swarm/types.js';
import type { TaskType } from '../router/types.js';

// ── Agent role system prompts ──────────────────────────────────────────────

const ROLE_PROMPTS: Record<string, string> = {
  planner:    'You are a planning and orchestration agent. Break complex goals into clear, numbered steps with explicit success criteria. Identify dependencies between steps. Be concrete—no vague directives.',
  executor:   'You are an execution specialist. Implement solutions completely and correctly. Write working code, call APIs, perform operations. Never leave tasks half-finished or produce placeholder content.',
  researcher: 'You are a research and analysis agent. Synthesise accurate, evidence-based answers. Distinguish facts from inferences. Cite your reasoning chain.',
  critic:     'You are a quality-assurance agent. Review the prior stage output, identify weaknesses, and produce an improved, corrected version. Do not merely comment—deliver the better output directly.',
};

const DEFAULT_ROLE = 'You are a helpful, precise AI agent. Complete the given task fully.';

// ── Task-type guidance ─────────────────────────────────────────────────────

const TASK_GUIDANCE: Record<TaskType, string> = {
  coding:    'Use fenced code blocks (```language) for all code. Include a short explanation before each block. Add error handling and edge-case comments.',
  analysis:  'Structure your response with ## headers and bullet lists. Compare options systematically. Support claims with reasoning.',
  planning:  'Number every step. Include a "Definition of Done" for each. Flag risks and prerequisites.',
  reasoning: 'Show every inference step. State your premises explicitly. End with a clearly labelled conclusion.',
  search:    'Answer the question directly first, then provide supporting detail. Distinguish confirmed facts from likely inferences.',
  creative:  'Be original and vivid. Prioritise voice and engagement over generic phrasing.',
  execution: 'Describe each action taken and its result. Output should be verifiable and reproducible.',
  general:   'Be clear and concise. Provide actionable output. Avoid filler.',
};

// ── Complexity → token budget ──────────────────────────────────────────────

const MAX_TOKENS: Record<string, number> = { low: 1024, medium: 2048, high: 4096 };
const TEMPERATURE: Record<TaskType, number> = {
  coding:    0.20,
  reasoning: 0.25,
  analysis:  0.30,
  planning:  0.35,
  execution: 0.35,
  search:    0.45,
  general:   0.50,
  creative:  0.85,
};

// ── Context budget guard ───────────────────────────────────────────────────
// Keep upstream pipeline context under ~3 000 chars per item to avoid bloating context.
const MAX_UPSTREAM_CHARS = 3_000;

export interface ToolSchema {
  name:        string;
  description: string;
  parameters:  Record<string, { type: string; description: string; required?: boolean }>;
}

export interface BuiltPrompt {
  system:      string;
  userMessage: string;
  maxTokens:   number;
  temperature: number;
}

export function buildPrompt(task: AgentTask, tools?: ToolSchema[]): BuiltPrompt {
  const profile  = task.decision.taskProfile;
  const taskType = profile.type;
  const rolePart = ROLE_PROMPTS[task.agentName] ?? DEFAULT_ROLE;
  const guidance = TASK_GUIDANCE[taskType];

  const toolSection = tools && tools.length > 0
    ? [
        '',
        '## Available Tools',
        'You may invoke tools using this exact format (one per call):',
        '<tool_call>{"tool": "<name>", "args": {<params>}}</tool_call>',
        '',
        ...tools.map((t) =>
          `**${t.name}**: ${t.description}\n` +
          Object.entries(t.parameters)
            .map(([k, v]) => `  - ${k} (${v.type}${v.required !== false ? ', required' : ''}): ${v.description}`)
            .join('\n')
        ),
      ]
    : [];

  const system = [rolePart, '', `Task type: ${taskType}`, guidance, ...toolSection].join('\n');

  // Build user message: instruction + optional pipeline context.
  let userMessage = task.instruction;
  if (task.upstreamContext.length > 0) {
    const trimmed = task.upstreamContext.map((ctx) =>
      ctx.length > MAX_UPSTREAM_CHARS ? ctx.slice(0, MAX_UPSTREAM_CHARS) + '\n[…truncated]' : ctx
    );
    userMessage += '\n\n---\n## Context from prior agents\n\n' + trimmed.join('\n\n---\n\n');
  }

  return {
    system,
    userMessage,
    maxTokens:   MAX_TOKENS[profile.complexity] ?? 2048,
    temperature: TEMPERATURE[taskType] ?? 0.5,
  };
}
