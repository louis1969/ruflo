import type { ILLMAdapter, LLMRequest, LLMResponse } from '../types.js';

// Uses Ollama's native OpenAI-compatible /api/chat endpoint.
// No extra package required — Node 18+ fetch is sufficient.
export class OllamaAdapter implements ILLMAdapter {
  readonly provider = 'ollama';
  private readonly baseUrl: string;
  private readonly defaultModel: string;

  constructor(baseUrl = 'http://localhost:11434', model = 'llama3.2') {
    this.baseUrl      = baseUrl.replace(/\/$/, '');
    this.defaultModel = model;
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const start = Date.now();
    const model = req.model || this.defaultModel;

    const body = {
      model,
      stream: false,
      messages: [
        { role: 'system', content: req.system },
        ...req.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      options: {
        temperature: req.temperature,
        num_predict: req.maxTokens,
      },
    };

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Ollama error ${res.status}: ${text}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json() as any;
    const content: string = data.message?.content ?? '';
    const inputTokens:  number = data.prompt_eval_count ?? 0;
    const outputTokens: number = data.eval_count        ?? 0;

    return {
      content,
      model,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      stopReason: data.done ? 'end_turn' : 'unknown',
      latencyMs:  Date.now() - start,
    };
  }
}
