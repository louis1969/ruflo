import type { RufloPlugin } from '../types.js';

export const jsonExtractPlugin: RufloPlugin = {
  name:        '@ruflo/tool-json-extract',
  version:     '1.0.0',
  description: 'Gives agents tools for parsing, validating, and extracting data from JSON',

  tools: [
    {
      name:        'json_get',
      description: 'Extract a value from a JSON string using a dot-notation path (e.g. "user.address.city")',
      parameters: {
        json: {
          type:        'string',
          description: 'A valid JSON string to parse',
          required:    true,
        },
        path: {
          type:        'string',
          description: 'Dot-notation path to the value (e.g. "items.0.name")',
          required:    true,
        },
      },
      execute(args) {
        const json  = String(args['json']  ?? '');
        const path  = String(args['path']  ?? '');

        let parsed: unknown;
        try {
          parsed = JSON.parse(json);
        } catch {
          return `Error: Invalid JSON — ${json.slice(0, 60)}`;
        }

        const parts = path.split('.');
        let   curr: unknown = parsed;
        for (const part of parts) {
          if (curr === null || curr === undefined) return `null (path "${path}" not found)`;
          curr = (curr as Record<string, unknown>)[part];
        }

        return curr === undefined ? `undefined (path "${path}" not found)` : JSON.stringify(curr, null, 2);
      },
    },
    {
      name:        'json_keys',
      description: 'List the top-level keys of a JSON object',
      parameters: {
        json: {
          type:        'string',
          description: 'A valid JSON object string',
          required:    true,
        },
      },
      execute(args) {
        const json = String(args['json'] ?? '');
        try {
          const parsed = JSON.parse(json) as unknown;
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            return `Error: expected a JSON object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`;
          }
          const keys = Object.keys(parsed as Record<string, unknown>);
          return `Keys (${keys.length}): ${keys.join(', ')}`;
        } catch {
          return `Error: Invalid JSON`;
        }
      },
    },
    {
      name:        'json_validate',
      description: 'Validate that a string is valid JSON and report its structure',
      parameters: {
        json: {
          type:        'string',
          description: 'The string to validate',
          required:    true,
        },
      },
      execute(args) {
        const json = String(args['json'] ?? '');
        try {
          const parsed = JSON.parse(json) as unknown;
          const type   = Array.isArray(parsed) ? `array[${(parsed as unknown[]).length}]`
                       : parsed === null        ? 'null'
                       : typeof parsed;
          return `Valid JSON — type: ${type}`;
        } catch (err) {
          return `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  ],
};
