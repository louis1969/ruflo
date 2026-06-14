import type { LLMUsage } from './types.js';

// [inputCostPer1kTokens, outputCostPer1kTokens] in USD.
const MODEL_COSTS: Record<string, [number, number]> = {
  // Anthropic
  'claude-opus-4-7':            [0.01500, 0.07500],
  'claude-sonnet-4-6':          [0.00300, 0.01500],
  'claude-haiku-4-5-20251001':  [0.00025, 0.00125],
  // OpenAI
  'gpt-4o':                     [0.00250, 0.01000],
  'gpt-4o-mini':                [0.00015, 0.00060],
  'gpt-4-turbo':                [0.01000, 0.03000],
  // Groq (Llama)
  'llama-3.3-70b-versatile':    [0.00059, 0.00079],
  'llama-3.1-8b-instant':       [0.00005, 0.00008],
  'mixtral-8x7b-32768':         [0.00024, 0.00024],
  // Gemini
  'gemini-2.0-flash':           [0.000075, 0.000300],
  'gemini-2.0-flash-lite':      [0.000038, 0.000150],
  'gemini-1.5-pro':             [0.001250, 0.005000],
  'gemini-1.5-flash':           [0.000075, 0.000300],
  // Ollama — always free
  'ollama-default':             [0, 0],
};

// Fallback cost when the exact model isn't in the table.
const PROVIDER_FALLBACK_COSTS: Record<string, [number, number]> = {
  anthropic: [0.003, 0.015],
  openai:    [0.003, 0.010],
  groq:      [0.001, 0.001],
  gemini:    [0.001, 0.003],
  ollama:    [0, 0],
};

export function estimateCost(modelOrProvider: string, usage: LLMUsage): number {
  const [inCost, outCost] =
    MODEL_COSTS[modelOrProvider] ??
    PROVIDER_FALLBACK_COSTS[modelOrProvider] ??
    [0.003, 0.010];

  return (usage.inputTokens * inCost + usage.outputTokens * outCost) / 1000;
}
