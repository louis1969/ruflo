import { readFileSync, existsSync } from 'fs';
import type { EvalSuite } from '../types.js';
import { codingSuite }    from './coding.js';
import { reasoningSuite } from './reasoning.js';
import { generalSuite }   from './general.js';

const BUILT_IN: Map<string, EvalSuite> = new Map([
  [codingSuite.id,    codingSuite],
  [reasoningSuite.id, reasoningSuite],
  [generalSuite.id,   generalSuite],
]);

export function listBuiltInSuites(): EvalSuite[] {
  return [...BUILT_IN.values()];
}

export function getBuiltInSuite(id: string): EvalSuite | undefined {
  return BUILT_IN.get(id);
}

export function loadSuite(idOrPath: string): EvalSuite {
  // Try built-in first.
  const builtin = BUILT_IN.get(idOrPath);
  if (builtin) return builtin;

  // Try loading from disk as JSON.
  const path = existsSync(idOrPath) ? idOrPath : null;
  if (!path) {
    throw new Error(
      `Suite "${idOrPath}" not found. Built-in suites: ${[...BUILT_IN.keys()].join(', ')}. ` +
      `Or provide a path to a JSON file.`
    );
  }

  try {
    const raw = readFileSync(path, 'utf8');
    const suite = JSON.parse(raw) as EvalSuite;
    if (!suite.id || !suite.name || !Array.isArray(suite.cases)) {
      throw new Error('Invalid suite JSON: must have id, name, and cases[]');
    }
    return suite;
  } catch (err) {
    throw new Error(`Failed to load suite from "${path}": ${err instanceof Error ? err.message : String(err)}`);
  }
}
