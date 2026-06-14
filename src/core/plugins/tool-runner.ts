import type { ToolDefinition, PluginContext } from './types.js';

// Matches <tool_call>...</tool_call> blocks (including multi-line JSON).
const TOOL_CALL_RE = /<tool_call>([\s\S]*?)<\/tool_call>/g;

export interface ToolRunResult {
  output:        string;
  toolsInvoked:  number;
  errors:        string[];
}

export async function processToolCalls(
  output:  string,
  tools:   ToolDefinition[],
  ctx:     PluginContext
): Promise<ToolRunResult> {
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const errors:  string[] = [];
  let   count   = 0;

  // We process sequentially so each tool result can inform the next replacement.
  let processed = output;
  let match:     RegExpExecArray | null;
  TOOL_CALL_RE.lastIndex = 0;

  // Collect all matches first (regex state resets during replacement).
  const matches: Array<{ full: string; raw: string }> = [];
  while ((match = TOOL_CALL_RE.exec(output)) !== null) {
    matches.push({ full: match[0], raw: match[1]!.trim() });
  }

  for (const { full, raw } of matches) {
    let call: { tool: string; args?: Record<string, unknown> };
    try {
      call = JSON.parse(raw) as typeof call;
    } catch {
      const errMsg = `[tool_call parse error: invalid JSON]`;
      processed = processed.replace(full, errMsg);
      errors.push(`Failed to parse tool_call JSON: ${raw.slice(0, 60)}`);
      continue;
    }

    const tool = toolMap.get(call.tool);
    if (!tool) {
      const errMsg = `[tool_call error: unknown tool "${call.tool}"]`;
      processed = processed.replace(full, errMsg);
      errors.push(`Unknown tool: "${call.tool}". Available: ${[...toolMap.keys()].join(', ')}`);
      continue;
    }

    let result: string;
    try {
      result = await tool.execute(call.args ?? {}, ctx);
      count += 1;
    } catch (err) {
      result = `[tool error: ${err instanceof Error ? err.message : String(err)}]`;
      errors.push(`Tool "${call.tool}" execution failed: ${result}`);
    }

    const replacement = `<tool_result tool="${call.tool}">\n${result}\n</tool_result>`;
    processed = processed.replace(full, replacement);
  }

  return { output: processed, toolsInvoked: count, errors };
}

// ── Tool schema → prompt fragment ────────────────────────────────────────────

export function toolsToPromptSection(tools: ToolDefinition[]): string {
  if (tools.length === 0) return '';
  const lines = [
    '## Available Tools',
    'Invoke with: <tool_call>{"tool":"<name>","args":{...}}</tool_call>',
    '',
  ];
  for (const t of tools) {
    lines.push(`**${t.name}** — ${t.description}`);
    for (const [k, v] of Object.entries(t.parameters)) {
      const req = v.required !== false ? ' (required)' : '';
      lines.push(`  • ${k}: ${v.type}${req} — ${v.description}`);
    }
  }
  return lines.join('\n');
}
