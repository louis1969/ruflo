import type { RufloConfig } from '../../types/index.js';
import type { IMemoryAdapter } from './types.js';
import { FileAdapter } from './adapters/file.js';
import { SQLiteAdapter } from './adapters/sqlite.js';
import { RedisAdapter } from './adapters/redis.js';
import { SupabaseAdapter } from './adapters/supabase.js';
import { join } from 'path';

export async function createMemoryAdapter(
  config: RufloConfig['memory'],
  stateDir = '.ruflo'
): Promise<IMemoryAdapter> {
  switch (config.backend) {
    case 'file':
      return new FileAdapter(config.path ?? join(stateDir, 'memory'));

    case 'sqlite':
      return SQLiteAdapter.create(config.path ?? join(stateDir, 'memory.db'));

    case 'redis': {
      if (!config.connectionString) {
        throw new Error('Redis backend requires memory.connectionString in ruflo.config.json');
      }
      return RedisAdapter.create(config.connectionString);
    }

    case 'supabase': {
      if (!config.connectionString) {
        throw new Error('Supabase backend requires memory.connectionString (Supabase URL) in ruflo.config.json');
      }
      const anonKey = process.env['SUPABASE_ANON_KEY'] ?? '';
      if (!anonKey) {
        throw new Error('Supabase backend requires SUPABASE_ANON_KEY env var');
      }
      return SupabaseAdapter.create(config.connectionString, anonKey);
    }

    default:
      throw new Error(`Unknown memory backend: ${(config as { backend: string }).backend}`);
  }
}
