import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListPromptsRequestSchema, GetPromptRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { RufloContext } from './context.js';

const PROMPTS = [
  {
    name:        'ruflo_agent_system',
    description: 'Generate a role-tailored system prompt for a Ruflo agent based on its role and task context',
    arguments: [
      { name: 'agentRole',   description: 'Agent role (planner|executor|researcher|critic)', required: true },
      { name: 'taskType',    description: 'Task type (coding|reasoning|analysis|planning|creative|search|execution|general)', required: false },
      { name: 'complexity',  description: 'Task complexity (low|medium|high)', required: false },
    ],
  },
  {
    name:        'ruflo_delegate_task',
    description: 'Generate a structured delegation prompt for handing a task off to the Ruflo swarm via ruflo_run',
    arguments: [
      { name: 'goal',      description: 'High-level goal to accomplish', required: true },
      { name: 'context',   description: 'Background context or constraints', required: false },
      { name: 'outputFmt', description: 'Desired output format (markdown|json|plain)', required: false },
    ],
  },
];

const ROLE_PROMPTS: Record<string, string> = {
  planner: `You are a strategic planning agent in a multi-agent swarm. Your job is to:
- Break down complex goals into concrete, actionable steps
- Identify dependencies and sequencing requirements
- Flag ambiguities and risks before execution begins
- Produce structured plans that executor agents can act on directly

Be precise, complete, and avoid ambiguity. Structure output as numbered steps with clear success criteria.`,

  executor: `You are an execution agent in a multi-agent swarm. Your job is to:
- Implement solutions directly and concretely
- Produce working code, documents, or data — not descriptions of what to do
- Follow any upstream plan from the planner agent faithfully
- Test edge cases and validate your own output before responding

Prefer showing results over explaining methodology. Be thorough.`,

  researcher: `You are a research and analysis agent in a multi-agent swarm. Your job is to:
- Gather relevant information, patterns, and facts related to the task
- Synthesize findings into structured, actionable insights
- Distinguish between confirmed facts and inferences
- Surface relevant tradeoffs, alternatives, and risks

Use headers, bullet points, and structured formats to maximize clarity.`,

  critic: `You are a quality-review agent in a multi-agent swarm. Your job is to:
- Review the output from other agents for correctness, completeness, and clarity
- Identify errors, gaps, or improvements
- Provide specific, actionable feedback (not vague criticism)
- Approve output that meets the bar or escalate when it doesn't

Be rigorous but fair. Focus on what matters most given the task context.`,
};

const TASK_TYPE_GUIDANCE: Record<string, string> = {
  coding:    'Produce working code with proper error handling. Include code blocks with language tags.',
  reasoning: 'Walk through your reasoning step by step. Show your chain of thought before concluding.',
  analysis:  'Structure findings with headers. Support claims with evidence. Quantify where possible.',
  planning:  'Produce numbered steps with clear owners, inputs, outputs, and success criteria.',
  creative:  'Prioritize originality and quality. Match the tone and style to the stated audience.',
  search:    'Enumerate relevant facts and sources. Distinguish between high and low confidence findings.',
  execution: 'Take direct action. Produce concrete outputs, not descriptions.',
  general:   'Be thorough, precise, and structured. Adapt format to what best serves the request.',
};

export function registerPrompts(server: Server, _ctx: RufloContext): void {
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: PROMPTS }));

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;

    if (name === 'ruflo_agent_system') {
      const role       = (args['agentRole']  ?? 'executor') as string;
      const taskType   = (args['taskType']   ?? 'general')  as string;
      const complexity = (args['complexity'] ?? 'medium')   as string;

      const basePrompt  = ROLE_PROMPTS[role] ?? ROLE_PROMPTS['executor']!;
      const taskGuidance = TASK_TYPE_GUIDANCE[taskType] ?? TASK_TYPE_GUIDANCE['general']!;
      const complexityNote = complexity === 'high'
        ? '\n\nComplexity: HIGH — be exhaustive, handle edge cases, and validate your output thoroughly.'
        : complexity === 'low'
          ? '\n\nComplexity: LOW — be concise and direct. Avoid over-engineering.'
          : '';

      const systemPrompt = `${basePrompt}\n\nTask context: ${taskGuidance}${complexityNote}`;

      return {
        description: `System prompt for ${role} agent (${taskType}, ${complexity})`,
        messages: [{ role: 'user', content: { type: 'text', text: systemPrompt } }],
      };
    }

    if (name === 'ruflo_delegate_task') {
      const goal      = (args['goal']      ?? '') as string;
      const context   = (args['context']   ?? '') as string;
      const outputFmt = (args['outputFmt'] ?? 'markdown') as string;

      if (!goal) {
        throw new Error('goal is required for ruflo_delegate_task');
      }

      const parts = [
        `Goal: ${goal}`,
        context ? `\nContext:\n${context}` : '',
        `\nOutput format: ${outputFmt}`,
        '\nPlease complete this task using the Ruflo swarm via the ruflo_run tool.',
        'The swarm will automatically route to the best provider and agent configuration.',
      ].filter(Boolean);

      return {
        description: `Delegation prompt for: ${goal.slice(0, 60)}`,
        messages: [{ role: 'user', content: { type: 'text', text: parts.join('\n') } }],
      };
    }

    throw new Error(`Unknown prompt: ${name}`);
  });
}
