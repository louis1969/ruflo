import type { IMemoryAdapter } from './types.js';

// MemoryStore wraps any IMemoryAdapter with:
//   - Namespace isolation  (keys stored as "ns:key")
//   - Default TTL from config
//   - getOrSet() cache-aside helper
//   - Namespaced sub-stores via .ns()
export class MemoryStore {
  private readonly adapter: IMemoryAdapter;
  private readonly namespace: string;
  private readonly defaultTtl: number | undefined;

  constructor(adapter: IMemoryAdapter, namespace = 'default', defaultTtlSeconds?: number) {
    this.adapter = adapter;
    this.namespace = namespace;
    this.defaultTtl = defaultTtlSeconds;
  }

  private k(key: string): string {
    return `${this.namespace}:${key}`;
  }

  // Create a child store scoped to a sub-namespace.
  ns(sub: string): MemoryStore {
    return new MemoryStore(this.adapter, `${this.namespace}:${sub}`, this.defaultTtl);
  }

  async get<T>(key: string): Promise<T | null> {
    return this.adapter.get<T>(this.k(key));
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    return this.adapter.set(this.k(key), value, ttlSeconds ?? this.defaultTtl);
  }

  async delete(key: string): Promise<void> {
    return this.adapter.delete(this.k(key));
  }

  async exists(key: string): Promise<boolean> {
    return this.adapter.exists(this.k(key));
  }

  async keys(pattern?: string): Promise<string[]> {
    const prefix = this.namespace + ':';
    const raw = await this.adapter.keys(pattern ? `${prefix}${pattern}` : `${prefix}*`);
    // Strip the namespace prefix so callers see short keys.
    return raw.map((k) => (k.startsWith(prefix) ? k.slice(prefix.length) : k));
  }

  // Cache-aside: return stored value or compute+store it if missing.
  async getOrSet<T>(key: string, factory: () => Promise<T>, ttlSeconds?: number): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const value = await factory();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  // Append an item to a JSON array stored at key (creates the array if absent).
  async append<T>(key: string, item: T, maxLength = 1000): Promise<void> {
    const list = (await this.get<T[]>(key)) ?? [];
    list.push(item);
    if (list.length > maxLength) list.splice(0, list.length - maxLength);
    await this.set(key, list);
  }

  async flush(): Promise<void> {
    return this.adapter.flush();
  }

  async close(): Promise<void> {
    return this.adapter.close();
  }

  raw(): IMemoryAdapter {
    return this.adapter;
  }
}

export { createMemoryAdapter } from './factory.js';
export type { IMemoryAdapter, MemoryEntry } from './types.js';
