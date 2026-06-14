import type { IMemoryAdapter } from '../types.js';

// Uses ioredis. Install: npm i ioredis
// Key format on Redis: ruflo:{fullKey}  (fullKey = "namespace:key" from MemoryStore)
export class RedisAdapter implements IMemoryAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;
  private readonly prefix = 'ruflo:';

  static async create(connectionString: string): Promise<RedisAdapter> {
    let Redis: new (url: string) => unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const mod = await (new Function('p', 'return import(p)'))('ioredis') as { default?: unknown };
      Redis = (mod.default ?? mod) as new (url: string) => unknown;
    } catch {
      throw new Error('Redis adapter requires ioredis: npm i ioredis');
    }
    const adapter = new RedisAdapter();
    adapter.client = new Redis(connectionString);
    return adapter;
  }

  private k(key: string): string {
    return `${this.prefix}${key}`;
  }

  async get<T>(key: string): Promise<T | null> {
    const raw: string | null = await this.client.get(this.k(key));
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const serialised = JSON.stringify(value);
    if (ttlSeconds) {
      await this.client.setex(this.k(key), ttlSeconds, serialised);
    } else {
      await this.client.set(this.k(key), serialised);
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.del(this.k(key));
  }

  async exists(key: string): Promise<boolean> {
    const n: number = await this.client.exists(this.k(key));
    return n > 0;
  }

  async keys(pattern?: string): Promise<string[]> {
    const glob = pattern ? this.k(pattern) : `${this.prefix}*`;
    const raw: string[] = await this.client.keys(glob);
    return raw.map((k: string) => k.slice(this.prefix.length));
  }

  async flush(): Promise<void> {
    const all: string[] = await this.client.keys(`${this.prefix}*`);
    if (all.length) await this.client.del(...all);
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}
