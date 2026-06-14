import OpenAI from 'openai';
import type { ILLMAdapter, LLMRequest, LLMResponse } from '../types.js';

// Handles both OpenAI and Groq (which exposes an OpenAI-compatible API).
export class OpenAIAdapter implements ILLMAdapter {
  readonly provider: string;
  private readonly client: OpenAI;
  private readonly defaultModel: string;

  constructor(
    apiKey: string,
    model = 'gpt-4o',
    baseURL?: string,       // pass 'https://api.groq.com/openai/v1' for Groq
    provider = 'openai',
  ) {
    this.provider     = provider;
    this.defaultModel = model;
    this.client       = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const start = Date.now();
    const model = req.model || this.defaultModel;

    const completion = await this.client.chat.completions.create({
      model,
      max_tokens:  req.maxTokens,
      temperature: req.temperature,
      messages: [
        { role: 'system', content: req.system },
        ...req.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    });

    const choice = completion.choices[0];
    const content = choice?.message?.content ?? '';
    const usage   = completion.usage;

    const stopMap: Record<string, LLMResponse['stopReason']> = {
      stop:         'end_turn',
      length:       'max_tokens',
      content_filter: 'stop',
    };

    return {
      content,
      model,
      usage: {
        inputTokens:  usage?.prompt_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
        totalTokens:  usage?.total_tokens ?? 0,
      },
      stopReason: stopMap[choice?.finish_reason ?? ''] ?? 'unknown',
      latencyMs:  Date.now() - start,
    };
  }
}
