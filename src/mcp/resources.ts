import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { RufloContext } from './context.js';

const STATIC_RESOURCES = [
  {
    uri:         'ruflo://jobs',
    name:        'Swarm Jobs',
    description: 'Index of all swarm jobs submitted to Ruflo',
    mimeType:    'application/json',
  },
  {
    uri:         'ruflo://heuristics',
    name:        'Routing Heuristics',
    description: 'Current heuristic weights and provider multipliers used by the router',
    mimeType:    'application/json',
  },
  {
    uri:         'ruflo://metrics/latest',
    name:        'Latest Learning Metrics',
    description: 'Most recent learning loop report: quality scores, calibration, recommendations',
    mimeType:    'application/json',
  },
  {
    uri:         'ruflo://config',
    name:        'Ruflo Config',
    description: 'Active provider configuration (API keys redacted)',
    mimeType:    'application/json',
  },
];

const RESOURCE_TEMPLATES = [
  {
    uriTemplate: 'ruflo://job/{id}',
    name:        'Swarm Job',
    description: 'Full details of a specific swarm job by ID',
    mimeType:    'application/json',
  },
];

export function registerResources(server: Server, ctx: RufloContext): void {
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: STATIC_RESOURCES,
  }));

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: RESOURCE_TEMPLATES,
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const { uri } = req.params;

    // Static resources.
    if (uri === 'ruflo://jobs') {
      const jobs   = ctx.memory.ns('job');
      const jobIds = (await jobs.get<string[]>('index')) ?? [];
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ total: jobIds.length, ids: jobIds }, null, 2) }] };
    }

    if (uri === 'ruflo://heuristics') {
      const weights = ctx.router.getHeuristics().get();
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(weights, null, 2) }] };
    }

    if (uri === 'ruflo://metrics/latest') {
      const latest = await ctx.learning.getLatestReport();
      if (!latest) {
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ message: 'No learning report yet — run ruflo_learn first.' }) }] };
      }
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(latest, null, 2) }] };
    }

    if (uri === 'ruflo://config') {
      const providers = ctx.router.getRegistry().all().map((s) => ({
        provider:            s.provider,
        isHealthy:           s.isHealthy,
        consecutiveFailures: s.consecutiveFailures,
        avgLatencyMs:        Math.round(s.avgLatencyMs),
        costPer1kInputTokens: s.costPer1kInputTokens,
        successRate:         Math.round(s.successRate * 100) / 100,
      }));
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ providers, activeProviders: ctx.activeProviders() }, null, 2) }] };
    }

    // Template resources: ruflo://job/{id}
    const jobMatch = uri.match(/^ruflo:\/\/job\/(.+)$/);
    if (jobMatch) {
      const jobId = jobMatch[1]!;
      const jobs  = ctx.memory.ns('job');
      const job   = await jobs.get(jobId);
      if (!job) {
        throw new Error(`Job "${jobId}" not found`);
      }
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(job, null, 2) }] };
    }

    throw new Error(`Unknown resource URI: ${uri}`);
  });
}
