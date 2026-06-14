import type { IMemoryAdapter } from '../types.js';

// Uses @supabase/supabase-js. Install: npm i @supabase/supabase-js
//
// Required table (run once in Supabase SQL editor):
//
//   CREATE TABLE IF NOT EXISTS ruflo_kv (
//     key        TEXT        NOT NULL,
//     namespace  TEXT        NOT NULL DEFAULT 'default',
//     value      JSONB       NOT NULL,
//     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
//     expires_at TIMESTAMPTZ,
//     PRIMARY KEY (key, namespace)
//   );
//   CREATE INDEX IF NOT EXISTS idx_ruflo_kv_ns      ON ruflo_kv(namespace);
//   CREATE INDEX IF NOT EXISTS idx_ruflo_kv_expires ON ruflo_kv(expires_at);

export class SupabaseAdapter implements IMemoryAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;
  private readonly table = 'ruflo_kv';

  static async create(url: string, anonKey: string): Promise<SupabaseAdapter> {
    let createClient: (url: string, key: string) => unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const mod = await (new Function('p', 'return import(p)'))('@supabase/supabase-js') as { createClient?: unknown; default?: { createClient?: unknown } };
      createClient = (mod.createClient ?? mod.default?.createClient) as typeof createClient;
    } catch {
      throw new Error('Supabase adapter requires @supabase/supabase-js: npm i @supabase/supabase-js');
    }
    const adapter = new SupabaseAdapter();
    adapter.client = createClient(url, anonKey);
    return adapter;
  }

  private split(fullKey: string): { ns: string; key: string } {
    const idx = fullKey.indexOf(':');
    if (idx === -1) return { ns: 'default', key: fullKey };
    return { ns: fullKey.slice(0, idx), key: fullKey.slice(idx + 1) };
  }

  async get<T>(fullKey: string): Promise<T | null> {
    const { ns, key } = this.split(fullKey);
    const { data, error } = await this.client
      .from(this.table)
      .select('value, expires_at')
      .eq('key', key)
      .eq('namespace', ns)
      .single();

    if (error || !data) return null;
    if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
    return data.value as T;
  }

  async set<T>(fullKey: string, value: T, ttlSeconds?: number): Promise<void> {
    const { ns, key } = this.split(fullKey);
    const expires_at = ttlSeconds
      ? new Date(Date.now() + ttlSeconds * 1000).toISOString()
      : null;

    await this.client.from(this.table).upsert({
      key,
      namespace: ns,
      value,
      created_at: new Date().toISOString(),
      expires_at,
    });
  }

  async delete(fullKey: string): Promise<void> {
    const { ns, key } = this.split(fullKey);
    await this.client.from(this.table).delete().eq('key', key).eq('namespace', ns);
  }

  async exists(fullKey: string): Promise<boolean> {
    return (await this.get(fullKey)) !== null;
  }

  async keys(pattern?: string): Promise<string[]> {
    const now = new Date().toISOString();
    let query = this.client
      .from(this.table)
      .select('key, namespace')
      .or(`expires_at.is.null,expires_at.gt.${now}`);

    if (pattern && !pattern.includes('*')) {
      const { ns, key } = this.split(pattern);
      query = query.eq('namespace', ns).eq('key', key);
    }

    const { data } = await query;
    if (!data) return [];

    const allKeys = (data as Array<{ key: string; namespace: string }>).map(
      (r) => `${r.namespace}:${r.key}`
    );

    if (!pattern || !pattern.includes('*')) return allKeys;
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    return allKeys.filter((k) => regex.test(k));
  }

  async flush(): Promise<void> {
    await this.client.from(this.table).delete().neq('key', '__placeholder__');
  }

  async close(): Promise<void> {
    // Supabase client has no explicit close.
  }
}
