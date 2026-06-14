import type { LLMProvider } from '../../types/index.js';
import type { ILLMAdapter } from './types.js';
import { AnthropicAdapter } from './adapters/anthropic.js';
import { OpenAIAdapter }    from './adapters/openai.js';
import { GeminiAdapter }    from './adapters/gemini.js';
import { OllamaAdapter }    from './adapters/ollama.js';

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai:    'gpt-4o',
  groq:      'llama-3.3-70b-versatile',
  gemini:    'gemini-2.0-flash',
  ollama:    'llama3.2',
};

export { DEFAULT_MODELS };

export function createAdapter(
  provider: LLMProvider,
  config: { apiKey: string; model?: string; baseUrl?: string }
): ILLMAdapter {
  const model = config.model || DEFAULT_MODELS[provider];

  switch (provider) {
    case 'anthropic':
      return new AnthropicAdapter(config.apiKey, model);

    case 'openai':
      return new OpenAIAdapter(config.apiKey, model);

    case 'groq':
      return new OpenAIAdapter(config.apiKey, model, GROQ_BASE_URL, 'groq');

    case 'gemini':
      return new GeminiAdapter(config.apiKey, model);

    case 'ollama':
      return new OllamaAdapter(config.baseUrl ?? 'http://localhost:11434', model);

    default:
      throw new Error(`Unknown LLM provider: ${provider as string}`);
  }
}
