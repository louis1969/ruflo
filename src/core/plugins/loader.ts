import { existsSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import type { RufloPlugin, PluginContext } from './types.js';

// ── Single plugin loader ──────────────────────────────────────────────────────

export async function loadPlugin(
  pathOrName: string,
  ctx:        PluginContext
): Promise<RufloPlugin> {
  let mod: unknown;

  // Absolute / relative path.
  if (pathOrName.startsWith('.') || pathOrName.startsWith('/')) {
    const abs = resolve(process.cwd(), pathOrName);
    if (!existsSync(abs)) {
      throw new Error(`Plugin file not found: ${abs}`);
    }
    mod = await import(`file://${abs.replace(/\\/g, '/')}`);
  } else {
    // npm package name.
    try {
      mod = await import(pathOrName);
    } catch (err) {
      throw new Error(`Cannot load plugin "${pathOrName}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const plugin = extractPlugin(mod);
  if (!plugin) {
    throw new Error(
      `Plugin "${pathOrName}" must export a \`default\` or named \`plugin\` that satisfies RufloPlugin (has name, version).`
    );
  }

  if (typeof plugin.setup === 'function') {
    await plugin.setup(ctx);
  }

  return plugin;
}

// ── Batch loader ──────────────────────────────────────────────────────────────

export async function loadPlugins(
  paths: string[],
  ctx:   PluginContext
): Promise<RufloPlugin[]> {
  const results: RufloPlugin[] = [];
  for (const p of paths) {
    try {
      results.push(await loadPlugin(p, ctx));
    } catch (err) {
      ctx.log('warn', `Failed to load plugin "${p}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return results;
}

// ── npm auto-discovery ────────────────────────────────────────────────────────

export function discoverNpmPlugins(cwd = process.cwd()): string[] {
  const discovered: string[] = [];

  // Check node_modules for @ruflo/plugin-* and ruflo-plugin-* packages.
  const nmPath = join(cwd, 'node_modules');
  if (!existsSync(nmPath)) return discovered;

  try {
    // Scoped: @ruflo/plugin-*
    const scopePath = join(nmPath, '@ruflo');
    if (existsSync(scopePath)) {
      for (const pkg of readdirSync(scopePath)) {
        if (pkg.startsWith('plugin-')) discovered.push(`@ruflo/${pkg}`);
      }
    }
    // Unscoped: ruflo-plugin-*
    for (const pkg of readdirSync(nmPath)) {
      if (pkg.startsWith('ruflo-plugin-')) discovered.push(pkg);
    }
  } catch { /* ignore read errors */ }

  return discovered;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isPlugin(v: unknown): v is RufloPlugin {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>)['name'] === 'string' &&
    typeof (v as Record<string, unknown>)['version'] === 'string'
  );
}

function extractPlugin(mod: unknown): RufloPlugin | null {
  if (isPlugin(mod)) return mod;
  if (typeof mod !== 'object' || mod === null) return null;
  const m = mod as Record<string, unknown>;
  if (isPlugin(m['default'])) return m['default'] as RufloPlugin;
  if (isPlugin(m['plugin']))  return m['plugin']  as RufloPlugin;
  return null;
}
