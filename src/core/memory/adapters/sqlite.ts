import type { IMemoryAdapter } from '../types.js';

interface KVRow {
  value: string;
  created_at: number;
  expires_at: number | null;
}

// Uses better-sqlite3 (synchronous, zero-config, production-grade for single-process).
// Install: npm i better-sqlite3 && npm i -D @types/better-sqlite3
export class SQLiteAdapter implements IMemoryAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any;

  static async create(dbPath: string): Promise<SQLiteAdapter> {
    let Database: new (path: string) => unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const mod = await (new Function('p', 'return import(p)'))('better-sqlite3') as { default?: unknown };
      Database = (mod.default ?? mod) as new (path: string) => unknown;
    } catch {
      throw new Error(
        'SQLite adapter requires better-sqlite3: npm i better-sqlite3 && npm i -D @types/better-sqlite3'
      );
    }
    const adapter = new SQLiteAdapter();
    adapter.db = new Database(dbPath);
    adapter.init();
    return adapter;
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ruflo_kv (
        key        TEXT NOT NULL,
        namespace  TEXT NOT NULL DEFAULT 'default',
        value      TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        PRIMARY KEY (key, namespace)
      );
      CREATE INDEX IF NOT EXISTS idx_namespace ON ruflo_kv(namespace);
      CREATE INDEX IF NOT EXISTS idx_expires   ON ruflo_kv(expires_at);
    `);
  }

  private split(fullKey: string): { ns: string; key: string } {
    const idx = fullKey.indexOf(':');
    if (idx === -1) return { ns: 'default', key: fullKey };
    return { ns: fullKey.slice(0, idx), key: fullKey.slice(idx + 1) };
  }

  private pruneExpired(): void {
    this.db.prepare('DELETE FROM ruflo_kv WHERE expires_at IS NOT NULL AND expires_at < ?').run(Date.now());
  }

  async get<T>(fullKey: string): Promise<T | null> {
    const { ns, key } = this.split(fullKey);
    const row = this.db
      .prepare('SELECT value, expires_at FROM ruflo_kv WHERE key = ? AND namespace = ?')
      .get(key, ns) as KVRow | undefined;
    if (!row) return null;
    if (row.expires_at !== null && row.expires_at < Date.now()) return null;
    return JSON.parse(row.value) as T;
  }

  async set<T>(fullKey: string, value: T, ttlSeconds?: number): Promise<void> {
    const { ns, key } = this.split(fullKey);
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.db.prepare(`
      INSERT INTO ruflo_kv (key, namespace, value, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key, namespace) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at
    `).run(key, ns, JSON.stringify(value), Date.now(), expiresAt);
  }

  async delete(fullKey: string): Promise<void> {
    const { ns, key } = this.split(fullKey);
    this.db.prepare('DELETE FROM ruflo_kv WHERE key = ? AND namespace = ?').run(key, ns);
  }

  async exists(fullKey: string): Promise<boolean> {
    return (await this.get(fullKey)) !== null;
  }

  async keys(pattern?: string): Promise<string[]> {
    this.pruneExpired();
    const rows = this.db
      .prepare('SELECT key, namespace FROM ruflo_kv WHERE expires_at IS NULL OR expires_at > ?')
      .all(Date.now()) as Array<{ key: string; namespace: string }>;

    const allKeys = rows.map((r) => `${r.namespace}:${r.key}`);
    if (!pattern) return allKeys;
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    return allKeys.filter((k) => regex.test(k));
  }

  async flush(): Promise<void> {
    this.db.prepare('DELETE FROM ruflo_kv').run();
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
