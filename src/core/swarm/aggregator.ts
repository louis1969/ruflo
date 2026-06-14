import type { AgentResult, ExecutionMode, SwarmResult } from './types.js';
import type { LLMProvider } from '../../types/index.js';

export function aggregate(
  jobId: string,
  mode: ExecutionMode,
  results: AgentResult[],
  startedAt: number
): SwarmResult {
  const totalLatencyMs = Date.now() - startedAt;
  const totalCostUsd = results.reduce((s, r) => s + r.costUsd, 0);
  const agentsUsed = [...new Set(results.map((r) => r.agentName))];
  const providersUsed = [...new Set(results.map((r) => r.provider))] as LLMProvider[];
  const successful = results.filter((r) => r.success);
  const success = successful.length > 0;

  let output: string;

  switch (mode) {
    case 'sequential':
    case 'pipeline':
      // Last stage's output carries the full accumulated answer.
      output = successful.at(-1)?.output ?? results.at(-1)?.output ?? '';
      break;

    case 'parallel':
      // Merge all successful outputs; preserve agent labels.
      output = successful
        .map((r) => `## ${r.agentName} (${r.provider})\n${r.output}`)
        .join('\n\n');
      if (!output) output = results.at(0)?.output ?? '';
      break;

    case 'race':
      // Winner is always the first element (executor puts it there).
      output = (successful[0] ?? results[0])?.output ?? '';
      break;
  }

  return { jobId, mode, output, agentResults: results, success, totalLatencyMs, totalCostUsd, agentsUsed, providersUsed };
}
