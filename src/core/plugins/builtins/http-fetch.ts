import type { RufloPlugin } from '../types.js';

export const httpFetchPlugin: RufloPlugin = {
  name:        '@ruflo/tool-http-fetch',
  version:     '1.0.0',
  description: 'Gives agents the ability to fetch a URL and receive its text content',

  tools: [
    {
      name:        'http_fetch',
      description: 'Fetch the content of a URL and return it as plain text (max 8 KB)',
      parameters: {
        url: {
          type:        'string',
          description: 'The full URL to fetch (must start with https://)',
          required:    true,
        },
        maxChars: {
          type:        'number',
          description: 'Maximum characters to return (default 4000, max 8000)',
          required:    false,
        },
      },
      async execute(args) {
        const url     = String(args['url'] ?? '');
        const maxLen  = Math.min(8000, Number(args['maxChars'] ?? 4000));

        if (!url.startsWith('https://') && !url.startsWith('http://')) {
          return `Error: URL must start with http:// or https://`;
        }

        try {
          const controller = new AbortController();
          const timer      = setTimeout(() => controller.abort(), 10_000);

          const res = await fetch(url, {
            signal:  controller.signal,
            headers: { 'User-Agent': 'ruflo-agent/0.1.0' },
          });
          clearTimeout(timer);

          if (!res.ok) return `HTTP ${res.status}: ${res.statusText}`;

          const text = await res.text();
          // Strip HTML tags for cleaner LLM consumption.
          const clean = text
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim();

          return clean.length > maxLen ? clean.slice(0, maxLen) + '\n[…truncated]' : clean;
        } catch (err) {
          return `Fetch error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  ],
};
