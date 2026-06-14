import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { LLMProvider, RufloConfig } from '../../types/index.js';
import type { AgentTask, AgentResult, AgentRunner } from '../swarm/types.js';
import type { ILLMAdapter } from './types.js';
import { buildPrompt } from './prompt-builder.js';
import { estimateCost } from './cost.js';
import { createAdapter, DEFAULT_MODELS } from './factory.js';

// ── Config loader ─────────────────────────────────────────────────────────────

function parseDotEnv(path: string): void {
  if (!existsSync(path)) return;
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key   = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !process.env[key]) process.env[key] = value;
    }
  } catch { /* non-fatal */ }
}

const ENV_KEYS: Array<[string, LLMProvider]> = [
  ['ANTHROPIC_API_KEY', 'anthropic'],
  ['OPENAI_API_KEY',    'openai'],
  ['GROQ_API_KEY',      'groq'],
  ['GOOGLE_API_KEY',    'gemini'],
  ['GEMINI_API_KEY',    'gemini'],
  ['OLLAMA_BASE_URL',   'ollama'],
];

export async function loadProviderConfigs(
  cwd = process.cwd()
): Promise<RufloConfig['providers']> {
  // 1. Hydrate process.env from .env if present.
  parseDotEnv(join(cwd, '.env'));

  // 2. Read ruflo.config.json for model overrides.
  let fileConfig: RufloConfig | null = null;
  const configPath = join(cwd, 'ruflo.config.json');
  if (existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(configPath, 'utf8')) as RufloConfig;
    } catch { /* ignore parse errors */ }
  }

  const providers: RufloConfig['providers'] = { ...(fileConfig?.providers ?? {}) };

  // 3. Env vars always win over file config for API keys.
  for (const [envVar, provider] of ENV_KEYS) {
    const val = process.env[envVar];
    if (!val) continue;
    if (!providers[provider]) {
      providers[provider] = { apiKey: val, model: DEFAULT_MODELS[provider] };
    } else {
      // Ollama uses baseUrl not apiKey.
      if (provider === 'ollama') {
        providers[provider]!.baseUrl = val;
      } else {
        providers[provider]!.apiKey = val;
      }
    }
  }

  return providers;
}

export function enabledProviders(configs: RufloConfig['providers']): LLMProvider[] {
  return (Object.entries(configs) as [LLMProvider, { apiKey: string } | undefined][])
    .filter(([, c]) => c && (c.apiKey || c['baseUrl' as keyof typeof c]))
    .map(([p]) => p);
}

// ── Real AgentRunner ──────────────────────────────────────────────────────────

export interface AgentRunnerOptions {
  /** Optional plugin manager — injects tools into prompts and post-processes tool calls. */
  pluginManager?: import('../plugins/index.js').PluginManager;
}

export function createAgentRunner(
  configs: RufloConfig['providers'],
  opts:    AgentRunnerOptions = {}
): AgentRunner {
  const cache = new Map<LLMProvider, ILLMAdapter>();

  function adapter(provider: LLMProvider): ILLMAdapter {
    if (cache.has(provider)) return cache.get(provider)!;
    const cfg = configs[provider];
    if (!cfg) throw new Error(`Provider "${provider}" not configured — add API key to .env or ruflo.config.json`);
    const inst = createAdapter(provider, cfg);
    cache.set(provider, inst);
    return inst;
  }

  return async (task: AgentTask): Promise<AgentResult> => {
    const provider = task.decision.selectedProvider;
    const start    = Date.now();

    try {
      const llm   = adapter(provider);
      const tools = opts.pluginManager?.getTools() ?? [];
      const { system, userMessage, maxTokens, temperature } = buildPrompt(task, tools);
      const model = configs[provider]?.model ?? DEFAULT_MODELS[provider];

      const response = await llm.complete({
        model,
        system,
        messages:    [{ role: 'user', content: userMessage }],
        maxTokens,
        temperature,
      });

      // Post-process: execute any <tool_call> blocks the model emitted.
      let output = response.content;
      if (opts.pluginManager && tools.length > 0 && output.includes('<tool_call>')) {
        const processed = await opts.pluginManager.processOutput(output);
        output = processed.output;
      }

      return {
        taskId:      task.id,
        jobId:       task.jobId,
        agentName:   task.agentName,
        provider,
        output,
        success:     true,
        latencyMs:   response.latencyMs,
        costUsd:     estimateCost(response.model, response.usage),
        qualityScore: null,
        retries:     0,
        completedAt: Date.now(),
      };
    } catch (err) {
      return {
        taskId:       task.id,
        jobId:        task.jobId,
        agentName:    task.agentName,
        provider,
        output:       '',
        success:      false,
        latencyMs:    Date.now() - start,
        costUsd:      0,
        qualityScore: null,
        errorMessage: err instanceof Error ? err.message : String(err),
        retries:      0,
        completedAt:  Date.now(),
      };
    }
  };
}

export type { ILLMAdapter, LLMRequest, LLMResponse } from './types.js';
