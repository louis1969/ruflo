import type { ILLMAdapter, LLMRequest, LLMResponse } from '../types.js';

// Uses @google/generative-ai via lazy dynamic import.
// Install: npm i @google/generative-ai
export class GeminiAdapter implements ILLMAdapter {
  readonly provider = 'gemini';
  private readonly apiKey: string;
  private readonly defaultModel: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private genAI: any = null;

  constructor(apiKey: string, model = 'gemini-2.0-flash') {
    this.apiKey       = apiKey;
    this.defaultModel = model;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async sdk(): Promise<any> {
    if (this.genAI) return this.genAI;
    let GoogleGenerativeAI: new (key: string) => unknown;
    try {
      const pkg = '@google/generative-ai';
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const mod = await (new Function('p', 'return import(p)'))(pkg) as { GoogleGenerativeAI?: unknown; default?: { GoogleGenerativeAI?: unknown } };
      GoogleGenerativeAI = (mod.GoogleGenerativeAI ?? mod.default?.GoogleGenerativeAI) as new (key: string) => unknown;
    } catch {
      throw new Error('Gemini adapter requires @google/generative-ai: npm i @google/generative-ai');
    }
    this.genAI = new GoogleGenerativeAI(this.apiKey);
    return this.genAI;
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const start  = Date.now();
    const model  = req.model || this.defaultModel;
    const genAI  = await this.sdk();

    const genModel = genAI.getGenerativeModel({
      model,
      systemInstruction: req.system,
    });

    // Gemini uses 'model' instead of 'assistant' for the AI role.
    const contents = req.messages.map((m) => ({
      role:  m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await genModel.generateContent({
      contents,
      generationConfig: {
        maxOutputTokens: req.maxTokens,
        temperature:     req.temperature,
      },
    });

    const text: string = result.response.text() ?? '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta: any   = result.response.usageMetadata ?? {};

    return {
      content: text,
      model,
      usage: {
        inputTokens:  meta.promptTokenCount     ?? 0,
        outputTokens: meta.candidatesTokenCount ?? 0,
        totalTokens:  meta.totalTokenCount      ?? 0,
      },
      stopReason: 'end_turn',
      latencyMs:  Date.now() - start,
    };
  }
}
