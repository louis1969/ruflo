export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMRequest {
  model: string;
  system: string;
  messages: LLMMessage[];
  maxTokens: number;
  temperature: number;
}

export interface LLMUsage {
  inputTokens:  number;
  outputTokens: number;
  totalTokens:  number;
}

export interface LLMResponse {
  content:    string;
  model:      string;
  usage:      LLMUsage;
  stopReason: 'end_turn' | 'max_tokens' | 'stop' | 'unknown';
  latencyMs:  number;
}

export interface ILLMAdapter {
  readonly provider: string;
  complete(request: LLMRequest): Promise<LLMResponse>;
}
