import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import type { IMemoryAdapter } from '../types.js';

interface FileRecord {
  value: unknown;
  createdAt: number;
  expiresAt: number | null;
}

type FileStore = Record<string, FileRecord>;

// One JSON file per namespace under storePath/.
// Not suitable for high-concurrency writes; ideal for dev / single-process use.
export class FileAdapter implements IMemoryAdapter {
  private readonly storePath: string;
  private cache: Map<string, FileStore> = new Map();

  constructor(storePath: string) {
    this.storePath = storePath;
    mkdirSync(storePath, { recursive: true });
  }

  private filePath(namespace: string): string {
    return join(this.storePath, `${namespace}.json`);
  }

  private load(namespace: string): FileStore {
    if (this.cache.has(namespace)) return this.cache.get(namespace)!;
    const fp = this.filePath(namespace);
    if (!existsSync(fp)) {
      const empty: FileStore = {};
      this.cache.set(namespace, empty);
      return empty;
    }
    try {
      const store = JSON.parse(readFileSync(fp, 'utf8')) as FileStore;
      this.cache.set(namespace, store);
      return store;
    } catch {
      const empty: FileStore = {};
      this.cache.set(namespace, empty);
      return empty;
    }
  }

  private save(namespace: string, store: FileStore): void {
    writeFileSync(this.filePath(namespace), JSON.stringify(store, null, 2));
    this.cache.set(namespace, store);
  }

  // Keys are formatted as "namespace:key" by MemoryStore.
  private split(fullKey: string): { ns: string; key: string } {
    const idx = fullKey.indexOf(':');
    if (idx === -1) return { ns: 'default', key: fullKey };
    return { ns: fullKey.slice(0, idx), key: fullKey.slice(idx + 1) };
  }

  private isExpired(record: FileRecord): boolean {
    return record.expiresAt !== null && record.expiresAt < Date.now();
  }

  async get<T>(fullKey: string): Promise<T | null> {
    const { ns, key } = this.split(fullKey);
    const store = this.load(ns);
    const record = store[key];
    if (!record || this.isExpired(record)) return null;
    return record.value as T;
  }

  async set<T>(fullKey: string, value: T, ttlSeconds?: number): Promise<void> {
    const { ns, key } = this.split(fullKey);
    const store = this.load(ns);
    store[key] = {
      value,
      createdAt: Date.now(),
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    };
    this.save(ns, store);
  }

  async delete(fullKey: string): Promise<void> {
    const { ns, key } = this.split(fullKey);
    const store = this.load(ns);
    delete store[key];
    this.save(ns, store);
  }

  async exists(fullKey: string): Promise<boolean> {
    return (await this.get(fullKey)) !== null;
  }

  async keys(pattern?: string): Promise<string[]> {
    // Collect all keys across all namespace files.
    const allKeys: string[] = [];
    let files: string[] = [];
    try { files = readdirSync(this.storePath).filter((f) => f.endsWith('.json')); } catch { /* empty dir */ }

    for (const file of files) {
      const ns = file.replace('.json', '');
      const store = this.load(ns);
      for (const [key, record] of Object.entries(store)) {
        if (!this.isExpired(record)) allKeys.push(`${ns}:${key}`);
      }
    }

    if (!pattern) return allKeys;
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    return allKeys.filter((k) => regex.test(k));
  }

  async flush(): Promise<void> {
    let files: string[] = [];
    try { files = readdirSync(this.storePath).filter((f) => f.endsWith('.json')); } catch { /* empty */ }
    for (const file of files) {
      try { unlinkSync(join(this.storePath, file)); } catch { /* ignore */ }
    }
    this.cache.clear();
  }

  async close(): Promise<void> {
    this.cache.clear();
  }
}
