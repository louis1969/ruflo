#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init/index.js';

const program = new Command();

program
  .name('ruflo')
  .description('Self-learning, self-optimizing multi-agent orchestration framework')
  .version('0.1.0');

program.addCommand(initCommand());

program
  .command('dash')
  .alias('dashboard')
  .description('Launch the live CLI dashboard (providers, jobs, learning, eval)')
  .option('--state-dir <dir>', 'State directory to watch', '.ruflo')
  .option('--refresh <ms>', 'Refresh interval in milliseconds', '3000')
  .option('--once', 'Render a single snapshot and exit (non-interactive)')
  .action(async (opts: { stateDir: string; refresh: string; once?: boolean }) => {
    const { startDashboard } = await import('./cli/dashboard/index.js');
    await startDashboard({
      stateDir:  opts.stateDir,
      refreshMs: parseInt(opts.refresh, 10),
      once:      opts.once,
    });
  });

program
  .command('dev')
  .description('Start agent swarm in dev mode with hot reload and browser devtools')
  .option('-p, --port <n>', 'HTTP port for the devtools UI', '8787')
  .option('--state-dir <dir>', 'State directory', '.ruflo')
  .option('-s, --strategy <s>', 'Routing strategy', 'capability')
  .option('--debounce <ms>', 'File-change debounce in milliseconds', '400')
  .option('--no-repl', 'Disable the interactive REPL')
  .action(async (opts: { port: string; stateDir: string; strategy: string; debounce: string; repl: boolean }) => {
    const { DevServer } = await import('./cli/dev/index.js');
    await DevServer.start({
      port:       parseInt(opts.port, 10),
      stateDir:   opts.stateDir,
      configDir:  process.cwd(),
      strategy:   opts.strategy,
      debounceMs: parseInt(opts.debounce, 10),
      noRepl:     !opts.repl,
    });
  });

program
  .command('run')
  .description('Run a task through the agent swarm')
  .argument('<task>', 'Natural language task description')
  .option('-s, --strategy <s>', 'Routing strategy', 'capability')
  .option('-v, --verbose', 'Show full swarm result', false)
  .action(async (task: string, opts: { strategy: string; verbose: boolean }) => {
    const { Router }          = await import('./core/router/index.js');
    const { Swarm }           = await import('./core/swarm/index.js');
    const { MemoryStore, createMemoryAdapter } = await import('./core/memory/index.js');
    const { loadProviderConfigs, enabledProviders, createAgentRunner } = await import('./core/llm/index.js');

    const configs = await loadProviderConfigs(process.cwd());
    const active  = enabledProviders(configs);

    const { PluginManager } = await import('./core/plugins/index.js');
    const plugins = await PluginManager.load({ autoDiscover: true });

    const runner = active.length > 0 ? createAgentRunner(configs, { pluginManager: plugins }) : undefined;

    if (active.length > 0) {
      console.log(`\nProviders: ${active.join(', ')} (real LLM)`);
    } else {
      console.log('\nNo API keys found — using mock runner. Add keys to .env to enable real LLM calls.');
    }
    if (plugins.count() > 0) {
      console.log(`Plugins:   ${plugins.list().map((p) => p.name).join(', ')}`);
    }

    const router = new Router({
      strategy:         opts.strategy as 'capability' | 'cost' | 'latency' | 'round-robin',
      fallbackProvider: active.includes('openai') ? 'openai' : (active[0] ?? 'anthropic'),
      enabledProviders: active.length > 0 ? active : ['anthropic', 'openai', 'groq'],
      stateDir:         '.ruflo',
    });

    for (const sd of plugins.registry.getStrategies()) {
      router.addStrategy(sd.create());
    }

    const adapter = await createMemoryAdapter({ backend: 'file', path: '.ruflo/memory' });
    const memory  = new MemoryStore(adapter, 'ruflo');
    const swarm   = new Swarm({ maxConcurrentAgents: 5, timeoutMs: 60_000 }, router, memory, runner, plugins);

    const result = await swarm.submit(task);

    if (opts.verbose) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`\nJob:      ${result.jobId}`);
      console.log(`Mode:     ${result.mode}`);
      console.log(`Success:  ${result.success}`);
      console.log(`Agents:   ${result.agentsUsed.join(', ')}`);
      console.log(`Cost:     $${result.totalCostUsd.toFixed(6)}`);
      console.log(`Latency:  ${result.totalLatencyMs}ms\n`);
      console.log(result.output);
    }

    await adapter.close();
  });

program
  .command('learn')
  .description('Run a learning loop cycle: evaluate results, calibrate heuristics, surface insights')
  .option('-m, --mode <mode>', 'Learning mode override (routing-heuristics | prompt-evolution)', 'routing-heuristics')
  .option('--min-samples <n>', 'Minimum samples before calibration fires', '3')
  .action(async (opts: { mode: string; minSamples: string }) => {
    const { Router }          = await import('./core/router/index.js');
    const { MemoryStore, createMemoryAdapter } = await import('./core/memory/index.js');
    const { LearningLoop }    = await import('./core/learning/index.js');

    const router = new Router({
      strategy:         'capability',
      fallbackProvider: 'openai',
      enabledProviders: ['anthropic', 'openai', 'groq'],
      stateDir:         '.ruflo',
    });
    const adapter = await createMemoryAdapter({ backend: 'file', path: '.ruflo/memory' });
    const memory  = new MemoryStore(adapter, 'ruflo');

    const loop = new LearningLoop(router, memory, {
      mode:                  opts.mode as 'routing-heuristics' | 'prompt-evolution' | 'disabled',
      evalInterval:          10,
      minSamplesBeforeAdapt: parseInt(opts.minSamples, 10),
    });

    console.log('\nRunning learning cycle...\n');
    const report = await loop.run();

    const line = (s: string) => console.log(s);
    const bar  = '─'.repeat(50);

    line(`  Mode:             ${report.mode}`);
    line(`  Jobs analyzed:    ${report.jobsAnalyzed}`);
    line(`  Results scored:   ${report.resultsScored}`);
    line(`  Heuristic updates:${report.heuristicUpdates}`);
    line(`  Calibration pts:  ${report.calibrationEntries}`);
    line(`  Prompt candidates:${report.promptCandidatesGenerated}`);
    line('');
    line(`  ${bar}`);
    line('  Provider Performance');
    line(`  ${bar}`);

    for (const p of report.snapshot.providers) {
      const quality  = p.avgQuality !== null ? p.avgQuality.toFixed(3) : ' n/a ';
      const topTasks = Object.entries(p.byTaskType)
        .filter(([, d]) => d.calls >= 1)
        .map(([t]) => t)
        .slice(0, 3)
        .join(', ');
      line(
        `  ${p.provider.padEnd(12)}` +
        `  success: ${Math.round(p.successRate * 100)}%` +
        `  quality: ${quality}` +
        `  latency: ${Math.round(p.avgLatencyMs)}ms` +
        `  cost: $${p.totalCostUsd.toFixed(6)}` +
        (topTasks ? `  [${topTasks}]` : '')
      );
    }

    if (Object.keys(report.snapshot.topProviderByTask).length > 0) {
      line('');
      line(`  ${bar}`);
      line('  Best Provider per Task Type');
      line(`  ${bar}`);
      for (const [taskType, provider] of Object.entries(report.snapshot.topProviderByTask)) {
        line(`  ${taskType.padEnd(14)} → ${provider}`);
      }
    }

    line('');
    line(`  ${bar}`);
    line('  Recommendations');
    line(`  ${bar}`);
    for (const rec of report.recommendations) {
      line(`  • ${rec}`);
    }

    line('');
    line(`  Overall quality:  ${report.snapshot.overall.avgQuality?.toFixed(3) ?? 'n/a'}`);
    line(`  Eval coverage:    ${Math.round(report.snapshot.overall.evalCoverage * 100)}%`);
    line(`  Total cost:       $${report.snapshot.overall.totalCostUsd.toFixed(6)}`);
    line('');

    if (report.promptCandidatesGenerated > 0) {
      const candidates = await loop.listCandidates();
      line(`  ${bar}`);
      line('  Prompt Improvement Candidates');
      line(`  ${bar}`);
      for (const c of candidates.slice(-5)) {
        line(`  [${c.agentName}/${c.taskType}] ${c.hint.slice(0, 100)}…`);
      }
      line('');
    }

    await adapter.close();
  });

program
  .command('status')
  .description('Show swarm status, memory stats, and learning metrics')
  .action(async () => {
    const { MemoryStore, createMemoryAdapter } = await import('./core/memory/index.js');
    const { LearningLoop }                     = await import('./core/learning/index.js');
    const { Router }                           = await import('./core/router/index.js');

    const adapter = await createMemoryAdapter({ backend: 'file', path: '.ruflo/memory' });
    const memory  = new MemoryStore(adapter, 'ruflo');
    const router  = new Router({
      strategy:         'capability',
      fallbackProvider: 'openai',
      enabledProviders: ['anthropic', 'openai', 'groq'],
      stateDir:         '.ruflo',
    });
    const loop = new LearningLoop(router, memory, {
      mode:                  'routing-heuristics',
      evalInterval:          10,
      minSamplesBeforeAdapt: 3,
    });

    const jobs   = memory.ns('job');
    const jobIds = (await jobs.get<string[]>('index')) ?? [];
    const latest = await loop.getLatestReport();
    const weights = router.getHeuristics().get();

    console.log(`\n  Swarm  — ${jobIds.length} job(s) total\n`);
    for (const id of jobIds.slice(-5)) {
      const job = await jobs.get<{ status: string; raw: string; startedAt: number }>(id);
      if (job) {
        const age = Math.round((Date.now() - job.startedAt) / 1000);
        console.log(`  [${job.status.padEnd(9)}] ${id.slice(0, 8)}  ${age}s ago  "${job.raw.slice(0, 55)}"`);
      }
    }

    console.log(`\n  Learning — last run: ${latest ? new Date(latest.runAt).toISOString() : 'never'}`);
    if (latest) {
      console.log(`  Jobs analyzed:  ${latest.jobsAnalyzed}  scored: ${latest.resultsScored}  heuristic updates: ${latest.heuristicUpdates}`);
      console.log(`  Quality (avg):  ${latest.snapshot.overall.avgQuality?.toFixed(3) ?? 'n/a'}`);
    }

    console.log(`\n  Heuristics — ${weights.totalOutcomes} outcomes ingested`);
    for (const [p, m] of Object.entries(weights.providerMultiplier)) {
      console.log(`  ${p.padEnd(12)} multiplier: ${(m as number).toFixed(3)}`);
    }
    console.log('');

    await adapter.close();
  });

program
  .command('eval')
  .description('Run a benchmark eval suite against the agent swarm')
  .argument('[suite]', 'Suite ID or path to JSON suite file (coding|reasoning|general)', 'general')
  .option('-s, --strategy <s>', 'Routing strategy', 'capability')
  .option('-p, --provider <p>', 'Force a specific provider for all cases')
  .option('-j, --judge <mode>', 'Judging mode (rule|llm|hybrid)', 'rule')
  .option('-c, --concurrency <n>', 'Parallel cases', '2')
  .option('--compare <runId>', 'Compare against a previous run ID')
  .option('-o, --output <path>', 'Save markdown report to file')
  .option('--list', 'List available built-in suites and exit')
  .action(async (suite: string, opts: {
    strategy: string; provider?: string; judge: string;
    concurrency: string; compare?: string; output?: string; list?: boolean;
  }) => {
    const { EvalHarness, renderMarkdown, renderTerminal, listBuiltInSuites } = await import('./core/eval/index.js');
    const { loadProviderConfigs } = await import('./core/llm/index.js');

    if (opts.list) {
      const suites = listBuiltInSuites();
      console.log('\n  Built-in eval suites:\n');
      for (const s of suites) {
        console.log(`  ${s.id.padEnd(14)} ${s.name.padEnd(28)} ${s.cases.length} cases  — ${s.description}`);
      }
      console.log('');
      return;
    }

    const configs = await loadProviderConfigs(process.cwd());
    const harness = new EvalHarness({ providerConfigs: configs, stateDir: '.ruflo' });

    let done = 0;
    const onProgress = (d: number, t: number, name: string) => {
      done = d;
      process.stdout.write(`\r  Running [${d}/${t}] ${name.slice(0, 40).padEnd(40)}`);
    };

    console.log(`\n  Eval suite: ${suite}  |  judge: ${opts.judge}  |  strategy: ${opts.strategy}\n`);

    const report = await harness.run(suite, {
      strategy:     opts.strategy as 'capability' | 'cost' | 'latency' | 'round-robin',
      onlyProvider: opts.provider as ('anthropic' | 'openai' | 'groq' | 'ollama' | 'gemini') | undefined,
      judgeMode:    opts.judge as 'rule' | 'llm' | 'hybrid',
      concurrency:  parseInt(opts.concurrency, 10),
      compareRunId: opts.compare,
      onProgress,
    });

    if (done > 0) process.stdout.write('\n');

    const lines = renderTerminal(report);
    for (const l of lines) console.log(l);
    console.log(`  Run ID: ${report.run.id}`);
    console.log('');

    if (opts.output) {
      const { writeFileSync } = await import('fs');
      writeFileSync(opts.output, renderMarkdown(report));
      console.log(`  Report saved to: ${opts.output}\n`);
    }
  });

const pluginCmd = program
  .command('plugin')
  .description('Manage Ruflo plugins');

pluginCmd
  .command('list')
  .description('List all installed plugins (built-in + auto-discovered)')
  .option('--builtin', 'Include built-in plugins in the list')
  .action(async (opts: { builtin?: boolean }) => {
    const { PluginManager, BUILTIN_PLUGINS } = await import('./core/plugins/index.js');
    const builtins = opts.builtin
      ? (Object.keys(BUILTIN_PLUGINS) as (keyof typeof BUILTIN_PLUGINS)[])
      : [];
    const pm   = await PluginManager.load({ autoDiscover: true, builtins });
    const list = pm.list();

    if (list.length === 0) {
      console.log('\n  No plugins loaded.');
      console.log('  Install @ruflo/plugin-* or ruflo-plugin-* npm packages to auto-discover.\n');
      return;
    }

    console.log('\n  Loaded plugins:\n');
    for (const p of list) {
      console.log(`  ${p.name}  v${p.version}`);
      if (p.description) console.log(`    ${p.description}`);
      const parts: string[] = [];
      if (p.provides.tools.length)      parts.push(`tools: ${p.provides.tools.join(', ')}`);
      if (p.provides.agents.length)     parts.push(`agents: ${p.provides.agents.join(', ')}`);
      if (p.provides.strategies.length) parts.push(`strategies: ${p.provides.strategies.join(', ')}`);
      if (p.provides.evaluators.length) parts.push(`evaluators: ${p.provides.evaluators.join(', ')}`);
      if (p.provides.hooks.length)      parts.push(`hooks: ${p.provides.hooks.join(', ')}`);
      if (parts.length > 0) console.log(`    Provides: ${parts.join('  ·  ')}`);
      console.log('');
    }
  });

pluginCmd
  .command('info <name>')
  .description('Show detailed info about a built-in plugin (httpFetch | jsonExtract)')
  .action(async (name: string) => {
    const { BUILTIN_PLUGINS } = await import('./core/plugins/index.js');
    const key = name as keyof typeof BUILTIN_PLUGINS;
    const p   = BUILTIN_PLUGINS[key];
    if (!p) {
      console.error(`\n  Unknown plugin "${name}". Available: ${Object.keys(BUILTIN_PLUGINS).join(', ')}\n`);
      process.exit(1);
    }
    console.log(`\n  ${p.name}  v${p.version}`);
    if (p.description) console.log(`  ${p.description}`);
    if (p.tools && p.tools.length > 0) {
      console.log('\n  Tools:');
      for (const t of p.tools) {
        console.log(`    ${t.name} — ${t.description}`);
        for (const [k, v] of Object.entries(t.parameters)) {
          const req = v.required !== false ? ' (required)' : '';
          console.log(`      • ${k}: ${v.type}${req} — ${v.description}`);
        }
      }
    }
    console.log('');
  });

program
  .command('mcp')
  .description('Start Ruflo as an MCP server (connects via stdio to Claude Desktop / any MCP client)')
  .option('--config', 'Print Claude Desktop integration JSON and exit')
  .option('--state-dir <dir>', 'State directory for heuristics and memory', '.ruflo')
  .option('-s, --strategy <s>', 'Routing strategy', 'capability')
  .action(async (opts: { config?: boolean; stateDir: string; strategy: string }) => {
    if (opts.config) {
      const execPath   = process.execPath;
      const scriptPath = new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
      const config     = {
        mcpServers: {
          ruflo: {
            command: execPath,
            args:    [scriptPath, 'mcp', '--state-dir', opts.stateDir],
            env:     { NODE_ENV: 'production' },
          },
        },
      };
      console.log(JSON.stringify(config, null, 2));
      console.log('\nAdd the above to your claude_desktop_config.json under "mcpServers".');
      return;
    }

    const { createMcpServer } = await import('./mcp/index.js');
    await createMcpServer({
      stateDir:  opts.stateDir,
      configDir: process.cwd(),
      strategy:  opts.strategy as 'capability' | 'cost' | 'latency' | 'round-robin',
    });
  });

program.parse();
