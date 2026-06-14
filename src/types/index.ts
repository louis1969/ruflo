export type LLMProvider = 'anthropic' | 'openai' | 'groq' | 'ollama' | 'gemini';
export type MemoryBackend = 'file' | 'redis' | 'supabase' | 'sqlite';
export type RoutingStrategy = 'capability' | 'cost' | 'latency' | 'round-robin';
export type LearningMode = 'prompt-evolution' | 'routing-heuristics' | 'disabled';

export interface AgentTemplate {
  name: string;
  role: string;
  providers: LLMProvider[];
  tools: string[];
}

export interface RufloConfig {
  project: {
    name: string;
    description: string;
    version: string;
  };
  providers: {
    [K in LLMProvider]?: {
      apiKey: string;
      model?: string;
      baseUrl?: string;
    };
  };
  memory: {
    backend: MemoryBackend;
    connectionString?: string;
    path?: string;
    ttlSeconds?: number;
  };
  router: {
    strategy: RoutingStrategy;
    fallbackProvider: LLMProvider;
  };
  swarm: {
    maxConcurrentAgents: number;
    timeoutMs: number;
  };
  agents: AgentTemplate[];
  learning: {
    mode: LearningMode;
    evalInterval: number;
    minSamplesBeforeAdapt: number;
  };
}
