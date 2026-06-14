export interface MemoryEntry<T = unknown> {
  value: T;
  namespace: string;
  createdAt: number;
  expiresAt: number | null;
}

export interface IMemoryAdapter {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  // Returns all keys optionally filtered by glob pattern (e.g. "agent:*").
  keys(pattern?: string): Promise<string[]>;
  // Wipe all keys — use with care.
  flush(): Promise<void>;
  close(): Promise<void>;
}
