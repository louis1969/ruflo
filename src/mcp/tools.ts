import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { RufloContext } from './context.js';

const TOOLS = [
  {
    name: 'ruflo_run',
    description: 'Submit a task to the Ruflo agent swarm. Returns the swarm job result including output, cost, and latency.',
    inputSchema: {
      type: 'object',
      properties: {
        task:     { type: 'string',  description: 'Natural language task description' },
        strategy: { type: 'string',  description: 'Routing strategy (capability|cost|latency|round-robin)', default: 'capability' },
        verbose:  { type: 'boolean', description: 'Include full agent result details', default: false },
      },
      required: ['task'],
    },
  },
  {
    name: 'ruflo_route',
    description: 'Analyze a task and return the routing decision without executing it. Useful for understanding which provider would be selected and why.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Natural language task description' },
      },
      required: ['task'],
    },
  },
  {
    name: 'ruflo_status',
    description: 'Get current swarm status: recent jobs, active providers, heuristic multipliers, and latest learning metrics.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'ruflo_get_job',
    description: 'Retrieve the full details of a specific swarm job by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Job ID returned from ruflo_run' },
      },
      required: ['jobId'],
    },
  },
  {
    name: 'ruflo_learn',
    description: 'Trigger a learning loop cycle: evaluate recent results, calibrate routing heuristics, and surface insights.',
    inputSchema: {
      type: 'object',
      properties: {
        minSamples: { type: 'number', description: 'Minimum samples before calibration fires', default: 3 },
      },
    },
  },
  {
    name: 'ruflo_heuristics',
    description: 'Get current heuristic weights and provider multipliers used for routing decisions.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'ruflo_providers',
    description: 'List all configured providers with their health, capabilities, latency, and cost stats.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
] as const;

export function registerTools(server: Server, ctx: RufloContext): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;

    try {
      switch (name) {
        case 'ruflo_run': {
          const { task, verbose = false } = args as { task: string; strategy?: string; verbose?: boolean };
          const result = await ctx.swarm.submit(task);

          if (verbose) {
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          const lines = [
            `Job:     ${result.jobId}`,
            `Mode:    ${result.mode}`,
            `Success: ${result.success}`,
            `Agents:  ${result.agentsUsed.join(', ')}`,
            `Cost:    $${result.totalCostUsd.toFixed(6)}`,
            `Latency: ${result.totalLatencyMs}ms`,
            '',
            result.output,
          ];
          return { content: [{ type: 'text', text: lines.join('\n') }] };
        }

        case 'ruflo_route': {
          const { task } = args as { task: string };
          const decision = ctx.router.route(task);
          return { content: [{ type: 'text', text: JSON.stringify(decision, null, 2) }] };
        }

        case 'ruflo_status': {
          const jobs   = ctx.memory.ns('job');
          const jobIds = (await jobs.get<string[]>('index')) ?? [];
          const latest = await ctx.learning.getLatestReport();
          const weights = ctx.router.getHeuristics().get();
          const active  = ctx.activeProviders();

          const sections: string[] = [
            `Swarm — ${jobIds.length} job(s) total`,
            `Active providers: ${active.join(', ') || 'none'}`,
          ];

          if (latest) {
            sections.push(
              '',
              `Learning — last run: ${new Date(latest.runAt).toISOString()}`,
              `  Jobs analyzed: ${latest.jobsAnalyzed}  scored: ${latest.resultsScored}  heuristic updates: ${latest.heuristicUpdates}`,
              `  Quality (avg): ${latest.snapshot.overall.avgQuality?.toFixed(3) ?? 'n/a'}`,
            );
          } else {
            sections.push('', 'Learning — never run (use ruflo_learn to start)');
          }

          sections.push('', `Heuristics — ${weights.totalOutcomes} outcomes ingested`);
          for (const [p, m] of Object.entries(weights.providerMultiplier)) {
            sections.push(`  ${p.padEnd(12)} multiplier: ${(m as number).toFixed(3)}`);
          }

          return { content: [{ type: 'text', text: sections.join('\n') }] };
        }

        case 'ruflo_get_job': {
          const { jobId } = args as { jobId: string };
          const jobs = ctx.memory.ns('job');
          const job  = await jobs.get(jobId);
          if (!job) {
            return { content: [{ type: 'text', text: `Job "${jobId}" not found.` }], isError: true };
          }
          return { content: [{ type: 'text', text: JSON.stringify(job, null, 2) }] };
        }

        case 'ruflo_learn': {
          const { minSamples = 3 } = args as { minSamples?: number };
          // Rebuild loop with custom minSamples without touching the shared ctx loop.
          const { LearningLoop } = await import('../core/learning/index.js');
          const tempLoop = new LearningLoop(ctx.router, ctx.memory, {
            mode: 'routing-heuristics',
            evalInterval: 10,
            minSamplesBeforeAdapt: minSamples,
          });
          const report = await tempLoop.run();

          const lines = [
            `Mode:              ${report.mode}`,
            `Jobs analyzed:     ${report.jobsAnalyzed}`,
            `Results scored:    ${report.resultsScored}`,
            `Heuristic updates: ${report.heuristicUpdates}`,
            `Calibration pts:   ${report.calibrationEntries}`,
            '',
            'Recommendations:',
            ...report.recommendations.map((r) => `  • ${r}`),
            '',
            `Overall quality:   ${report.snapshot.overall.avgQuality?.toFixed(3) ?? 'n/a'}`,
            `Eval coverage:     ${Math.round(report.snapshot.overall.evalCoverage * 100)}%`,
            `Total cost:        $${report.snapshot.overall.totalCostUsd.toFixed(6)}`,
          ];
          return { content: [{ type: 'text', text: lines.join('\n') }] };
        }

        case 'ruflo_heuristics': {
          const weights = ctx.router.getHeuristics().get();
          return { content: [{ type: 'text', text: JSON.stringify(weights, null, 2) }] };
        }

        case 'ruflo_providers': {
          const stats = ctx.router.getRegistry().all();
          return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
        }

        default:
          return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
    }
  });
}
