import * as p from '@clack/prompts';
import chalk from 'chalk';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { RufloConfig, LLMProvider, MemoryBackend, RoutingStrategy, LearningMode, AgentTemplate } from '../../types/index.js';

const PROVIDER_MODELS: Record<LLMProvider, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  groq: 'llama-3.3-70b-versatile',
  ollama: 'llama3.2',
  gemini: 'gemini-2.0-flash',
};

const DEFAULT_AGENTS: AgentTemplate[] = [
  { name: 'planner', role: 'Decompose tasks into subtasks and delegate to specialists', providers: ['anthropic'], tools: ['memory', 'router'] },
  { name: 'researcher', role: 'Search, retrieve, and synthesize information', providers: ['openai', 'groq'], tools: ['web_search', 'memory'] },
  { name: 'executor', role: 'Run code, call APIs, and perform actions', providers: ['anthropic'], tools: ['code_exec', 'http', 'memory'] },
  { name: 'critic', role: 'Evaluate outputs and trigger learning loop updates', providers: ['anthropic', 'openai'], tools: ['memory', 'learning'] },
];

function banner() {
  console.log('');
  console.log(chalk.cyan.bold('  ██████╗ ██╗   ██╗███████╗██╗      ██████╗ '));
  console.log(chalk.cyan.bold('  ██╔══██╗██║   ██║██╔════╝██║     ██╔═══██╗'));
  console.log(chalk.cyan.bold('  ██████╔╝██║   ██║█████╗  ██║     ██║   ██║'));
  console.log(chalk.cyan.bold('  ██╔══██╗██║   ██║██╔══╝  ██║     ██║   ██║'));
  console.log(chalk.cyan.bold('  ██║  ██║╚██████╔╝██║     ███████╗╚██████╔╝'));
  console.log(chalk.cyan.bold('  ╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚══════╝ ╚═════╝ '));
  console.log('');
  console.log(chalk.gray('  Self-Learning Multi-Agent Orchestration Framework'));
  console.log(chalk.gray('  v0.1.0  •  init wizard\n'));
}

export async function runWizard(targetDir: string = process.cwd()) {
  banner();

  p.intro(chalk.bgCyan.black(' ruflo init wizard '));

  // ── Project ──────────────────────────────────────────────────────────────
  const project = await p.group(
    {
      name: () =>
        p.text({
          message: 'Project name',
          placeholder: 'my-ruflo-agent',
          validate: (v) => (!v ? 'Required' : undefined),
        }),
      description: () =>
        p.text({
          message: 'Short description',
          placeholder: 'A self-optimizing agent swarm',
        }),
    },
    { onCancel: () => { p.cancel('Wizard cancelled.'); process.exit(0); } }
  );

  // ── LLM Providers ────────────────────────────────────────────────────────
  const selectedProviders = await p.multiselect<LLMProvider>({
    message: 'LLM providers to enable',
    options: [
      { value: 'anthropic', label: 'Anthropic (Claude)', hint: 'Best for reasoning & agents' },
      { value: 'openai',    label: 'OpenAI (GPT-4o)',   hint: 'Wide tool ecosystem' },
      { value: 'groq',      label: 'Groq',              hint: 'Ultra-low latency' },
      { value: 'gemini',    label: 'Google Gemini',     hint: 'Long context' },
      { value: 'ollama',    label: 'Ollama (local)',    hint: 'Private / offline' },
    ],
    initialValues: ['anthropic'],
    required: true,
  }) as LLMProvider[];

  if (p.isCancel(selectedProviders)) { p.cancel('Cancelled.'); process.exit(0); }

  // Collect API keys per provider
  const providerKeys: RufloConfig['providers'] = {};
  for (const prov of selectedProviders) {
    if (prov === 'ollama') {
      const base = await p.text({
        message: `Ollama base URL`,
        placeholder: 'http://localhost:11434',
        initialValue: 'http://localhost:11434',
      });
      if (p.isCancel(base)) { p.cancel('Cancelled.'); process.exit(0); }
      providerKeys[prov] = { apiKey: '', baseUrl: base as string, model: PROVIDER_MODELS[prov] };
    } else {
      const envVar = `${prov.toUpperCase()}_API_KEY`;
      const key = await p.text({
        message: `${prov.charAt(0).toUpperCase() + prov.slice(1)} API key`,
        placeholder: `$${envVar} or paste key`,
        initialValue: process.env[envVar] ?? '',
        validate: (v) => (!v ? `Required for ${prov}` : undefined),
      });
      if (p.isCancel(key)) { p.cancel('Cancelled.'); process.exit(0); }
      providerKeys[prov] = { apiKey: key as string, model: PROVIDER_MODELS[prov] };
    }
  }

  // ── Memory Backend ───────────────────────────────────────────────────────
  const memoryBackend = await p.select<MemoryBackend>({
    message: 'Memory backend',
    options: [
      { value: 'file',     label: 'File (JSON)',   hint: 'Zero config, dev-friendly' },
      { value: 'sqlite',   label: 'SQLite',        hint: 'Fast local DB, no server' },
      { value: 'supabase', label: 'Supabase',      hint: 'Postgres + vector search' },
      { value: 'redis',    label: 'Redis',         hint: 'High-throughput production' },
    ],
    initialValue: 'file',
  }) as MemoryBackend;

  if (p.isCancel(memoryBackend)) { p.cancel('Cancelled.'); process.exit(0); }

  let memoryConn: string | undefined;
  if (memoryBackend === 'supabase' || memoryBackend === 'redis') {
    const conn = await p.text({
      message: `${memoryBackend === 'supabase' ? 'Supabase URL' : 'Redis connection string'}`,
      placeholder: memoryBackend === 'supabase' ? 'https://xxx.supabase.co' : 'redis://localhost:6379',
      validate: (v) => (!v ? 'Required' : undefined),
    });
    if (p.isCancel(conn)) { p.cancel('Cancelled.'); process.exit(0); }
    memoryConn = conn as string;
  }

  // ── Routing Strategy ─────────────────────────────────────────────────────
  const routingStrategy = await p.select<RoutingStrategy>({
    message: 'Routing strategy',
    options: [
      { value: 'capability',  label: 'Capability-based', hint: 'Match task type to best model (recommended)' },
      { value: 'cost',        label: 'Cost-optimized',   hint: 'Cheapest provider per task' },
      { value: 'latency',     label: 'Latency-first',    hint: 'Always pick fastest responding provider' },
      { value: 'round-robin', label: 'Round-robin',      hint: 'Distribute evenly' },
    ],
    initialValue: 'capability',
  }) as RoutingStrategy;

  if (p.isCancel(routingStrategy)) { p.cancel('Cancelled.'); process.exit(0); }

  // ── Learning Loop ────────────────────────────────────────────────────────
  const learningMode = await p.select<LearningMode>({
    message: 'Learning loop mode',
    options: [
      { value: 'routing-heuristics', label: 'Routing heuristics', hint: 'Adapt routing weights from outcome scores (recommended)' },
      { value: 'prompt-evolution',   label: 'Prompt evolution',   hint: 'DSPy-style prompt optimization per agent' },
      { value: 'disabled',           label: 'Disabled',           hint: 'Static config only' },
    ],
    initialValue: 'routing-heuristics',
  }) as LearningMode;

  if (p.isCancel(learningMode)) { p.cancel('Cancelled.'); process.exit(0); }

  // ── Agent Templates ───────────────────────────────────────────────────────
  const selectedAgents = await p.multiselect<string>({
    message: 'Bootstrap agent templates',
    options: DEFAULT_AGENTS.map((a) => ({
      value: a.name,
      label: chalk.bold(a.name),
      hint: a.role,
    })),
    initialValues: ['planner', 'executor'],
  });

  if (p.isCancel(selectedAgents)) { p.cancel('Cancelled.'); process.exit(0); }

  // ── Confirm ───────────────────────────────────────────────────────────────
  const fallback = (selectedProviders[0] ?? 'anthropic') as LLMProvider;

  const confirm = await p.confirm({
    message: `Scaffold ${chalk.cyan(project.name as string)} with ${selectedProviders.length} provider(s), ${(selectedAgents as unknown as string[]).length} agents, ${memoryBackend} memory?`,
    initialValue: true,
  });

  if (p.isCancel(confirm) || !confirm) { p.cancel('Aborted.'); process.exit(0); }

  // ── Build Config ──────────────────────────────────────────────────────────
  const config: RufloConfig = {
    project: {
      name: project.name as string,
      description: (project.description as string) || '',
      version: '0.1.0',
    },
    providers: providerKeys,
    memory: {
      backend: memoryBackend,
      ...(memoryConn ? { connectionString: memoryConn } : {}),
      ...(memoryBackend === 'file' ? { path: '.ruflo/memory' } : {}),
      ttlSeconds: 86400,
    },
    router: {
      strategy: routingStrategy,
      fallbackProvider: fallback,
    },
    swarm: {
      maxConcurrentAgents: 5,
      timeoutMs: 30000,
    },
    agents: DEFAULT_AGENTS.filter((a) => (selectedAgents as unknown as string[]).includes(a.name)),
    learning: {
      mode: learningMode,
      evalInterval: 10,
      minSamplesBeforeAdapt: 20,
    },
  };

  // ── Write Files ───────────────────────────────────────────────────────────
  const s = p.spinner();
  s.start('Scaffolding project...');

  const projectDir = join(targetDir, project.name as string);
  mkdirSync(join(projectDir, 'agents'), { recursive: true });
  mkdirSync(join(projectDir, 'memory'), { recursive: true });
  mkdirSync(join(projectDir, '.ruflo'), { recursive: true });

  // ruflo.config.json
  writeFileSync(
    join(projectDir, 'ruflo.config.json'),
    JSON.stringify(config, null, 2)
  );

  // .env template
  const envLines = selectedProviders
    .filter((p) => p !== 'ollama')
    .map((p) => `${p.toUpperCase()}_API_KEY=${providerKeys[p]?.apiKey ?? ''}`);
  writeFileSync(join(projectDir, '.env'), envLines.join('\n') + '\n');
  writeFileSync(join(projectDir, '.env.example'), envLines.map((l) => l.replace(/=.+/, '=')).join('\n') + '\n');

  // .gitignore
  writeFileSync(join(projectDir, '.gitignore'), '.env\n.ruflo/\nnode_modules/\ndist/\n');

  // Agent stubs
  for (const agent of config.agents) {
    writeFileSync(
      join(projectDir, 'agents', `${agent.name}.ts`),
      agentStub(agent.name, agent.role, agent.providers[0])
    );
  }

  // package.json stub
  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({
      name: project.name,
      version: '0.1.0',
      description: project.description || '',
      type: 'module',
      scripts: { start: 'npx ruflo run', dev: 'npx ruflo dev' },
      dependencies: { ruflo: 'latest' },
    }, null, 2)
  );

  s.stop('Project scaffolded.');

  // ── Summary ───────────────────────────────────────────────────────────────
  p.note(
    [
      `${chalk.cyan('dir')}       ${projectDir}`,
      `${chalk.cyan('providers')} ${selectedProviders.join(', ')}`,
      `${chalk.cyan('memory')}    ${memoryBackend}`,
      `${chalk.cyan('routing')}   ${routingStrategy}`,
      `${chalk.cyan('learning')}  ${learningMode}`,
      `${chalk.cyan('agents')}    ${(selectedAgents as unknown as string[]).join(', ')}`,
    ].join('\n'),
    'What was created'
  );

  p.outro(
    chalk.green('Ready.') +
    chalk.gray(`  cd ${project.name as string} && npx ruflo dev`)
  );
}

function agentStub(name: string, role: string, provider: LLMProvider): string {
  return `import type { AgentContext, AgentResult } from 'ruflo';

// Role: ${role}
export async function run(ctx: AgentContext): Promise<AgentResult> {
  const response = await ctx.llm('${provider}', {
    system: \`You are the ${name} agent. ${role}\`,
    messages: ctx.messages,
    tools: ctx.tools,
  });

  await ctx.memory.set(\`${name}:last_run\`, { ts: Date.now(), tokens: response.usage });

  return { output: response.content, score: null };
}
`;
}
