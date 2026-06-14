import Anthropic from '@anthropic-ai/sdk';
import type { ILLMAdapter, LLMRequest, LLMResponse } from '../types.js';

export class AnthropicAdapter implements ILLMAdapter {
  readonly provider = 'anthropic';
  private readonly client: Anthropic;
  private readonly defaultModel: string;

  constructor(apiKey: string, model = 'claude-sonnet-4-6') {
    this.client       = new Anthropic({ apiKey });
    this.defaultModel = model;
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const start = Date.now();
    const model = req.model || this.defaultModel;

    const msg = await this.client.messages.create({
      model,
      max_tokens:  req.maxTokens,
      temperature: req.temperature,
      system:      req.system,
      messages:    req.messages.map((m) => ({
        role:    m.role as 'user' | 'assistant',
        content: m.content,
      })),
    });

    const content = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const stopMap: Record<string, LLMResponse['stopReason']> = {
      end_turn:    'end_turn',
      max_tokens:  'max_tokens',
      stop_sequence: 'stop',
    };

    return {
      content,
      model,
      usage: {
        inputTokens:  msg.usage.input_tokens,
        outputTokens: msg.usage.output_tokens,
        totalTokens:  msg.usage.input_tokens + msg.usage.output_tokens,
      },
      stopReason: stopMap[msg.stop_reason ?? ''] ?? 'unknown',
      latencyMs:  Date.now() - start,
    };
  }
}
