# ruflo

**Self-learning, self-optimizing multi-agent orchestration framework.**

Ruflo routes tasks across LLM providers, runs multi-agent swarms, calibrates routing heuristics from live outcomes, and exposes everything as an MCP server — all with zero configuration required to start.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Provider Setup](#provider-setup)
- [CLI Reference](#cli-reference)
- [Library API](#library-api)
- [Configuration File](#configuration-file)
- [Plugin System](#plugin-system)
- [MCP Integration](#mcp-integration)
- [Dev Mode](#dev-mode)
- [Architecture](#architecture)

---

## Quick Start

### As a CLI tool

```bash
npm install -g @louis1969/ruflo

# Create a new project
ruflo init

# Run a task
ruflo run "Summarise the key differences between REST and GraphQL"

# Start the learning loop
ruflo learn

# Open the live dashboard
ruflo dash
```

### As a library

```bash
npm install @louis1969/ruflo
```

```typescript
import { Router, Swarm, MemoryStore, createMemoryAdapter,
         loadProviderConfigs, enabledProviders, createAgentRunner } from '@louis1969/ruflo';

const configs = await loadProviderConfigs(process.cwd());
const active  = enabledProviders(configs);

const router  = new Router({ strategy: 'capability', fallbackProvider: 'openai',
                              enabledProviders: active, stateDir: '.ruflo' });
const adapter = await createMemoryAdapter({ backend: 'file', path: '.ruflo/memory' });
const memory  = new MemoryStore(adapter, 'ruflo');
const runner  = createAgentRunner(configs);
const swarm   = new Swarm({ maxConcurrentAgents: 5, timeoutMs: 60_000 },
                            router, memory, runner);

const result = await swarm.submit('Write a haiku about distributed systems');
console.log(result.output);

await adapter.close();
```

---

## Provider Setup

Create a `.env` file in your project root (or export these variables):

```bash
# At least one provider is required for real LLM calls.
# Without any key, ruflo falls back to a mock runner that returns canned output.

ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GROQ_API_KEY=gsk_...

# Ollama (local) — set base URL instead of an API key
OLLAMA_BASE_URL=http://localhost:11434

# Google Gemini
GEMINI_API_KEY=AIza...
```

Ruflo reads `.env` from the working directory automatically; you do not need `dotenv` in your own code.

---

## CLI Reference

### `ruflo init`

Bootstrap a new project with a guided wizard.

```
ruflo init [wizard] [-d <dir>]
```

Creates `ruflo.config.json`, `.env.example`, and a starter agent template.

---

### `ruflo run <task>`

Submit a natural-language task to the swarm and print the result.

```
ruflo run "explain binary search" [-s capability] [-v]
```

| Flag | Default | Description |
|------|---------|-------------|
| `-s, --strategy` | `capability` | Routing strategy: `capability` \| `cost` \| `latency` \| `round-robin` |
| `-v, --verbose` | `false` | Print full JSON result instead of summary |

---

### `ruflo learn`

Run one learning-loop cycle: score recent jobs, calibrate routing heuristics, and surface prompt-improvement candidates.

```
ruflo learn [-m routing-heuristics] [--min-samples 3]
```

| Flag | Default | Description |
|------|---------|-------------|
| `-m, --mode` | `routing-heuristics` | `routing-heuristics` \| `prompt-evolution` |
| `--min-samples` | `3` | Minimum evaluated jobs before calibration fires |

---

### `ruflo eval [suite]`

Run an offline benchmark suite and print a pass/fail report.

```
ruflo eval general [-j hybrid] [-c 4] [--compare <runId>] [-o report.md]
ruflo eval --list
```

| Flag | Default | Description |
|------|---------|-------------|
| `suite` | `general` | Built-in ID (`coding` \| `reasoning` \| `general`) or path to a JSON suite file |
| `-s, --strategy` | `capability` | Routing strategy |
| `-p, --provider` | — | Force all cases through a single provider |
| `-j, --judge` | `rule` | `rule` \| `llm` \| `hybrid` |
| `-c, --concurrency` | `2` | Parallel eval cases |
| `--compare` | — | Compare against a previous run ID |
| `-o, --output` | — | Save markdown report to file |
| `--list` | — | List available built-in suites and exit |

**Pass threshold:** `0.70` (configurable via `PASS_THRESHOLD` export).

---

### `ruflo status`

Print swarm job history, latest learning-loop report, and routing heuristics.

```
ruflo status
```

---

### `ruflo dash`

Open the live, auto-refreshing terminal dashboard.

```
ruflo dash [--state-dir .ruflo] [--refresh 3000] [--once]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--state-dir` | `.ruflo` | State directory to read |
| `--refresh` | `3000` | Refresh interval in ms |
| `--once` | — | Render once and exit (CI-friendly) |

---

### `ruflo dev`

Start the hot-reloading dev server with an embedded browser devtools UI at `http://localhost:8787`.

```
ruflo dev [-p 8787] [-s capability] [--no-repl]
```

| Flag | Default | Description |
|------|---------|-------------|
| `-p, --port` | `8787` | HTTP port |
| `--state-dir` | `.ruflo` | State directory |
| `-s, --strategy` | `capability` | Routing strategy |
| `--debounce` | `400` | File-change debounce in ms |
| `--no-repl` | — | Disable interactive REPL |

**REPL commands:** `r` reload · `l` learn · `e` eval · `s` status · `q` quit

Config or `.env` changes trigger automatic context rebuilds. The HTTP server stays alive across reloads; open browser clients reconnect via SSE.

---

### `ruflo mcp`

Start Ruflo as an [MCP](https://modelcontextprotocol.io) server on stdio.

```
ruflo mcp [--state-dir .ruflo] [-s capability]
ruflo mcp --config    # print Claude Desktop JSON snippet
```

See [MCP Integration](#mcp-integration) for setup details.

---

### `ruflo plugin`

```
ruflo plugin list [--builtin]    # list loaded plugins
ruflo plugin info <name>         # detail a built-in plugin
```

---

## Library API

All types and runtime values are available from the root import or via deep imports for tree-shaking:

```typescript
// Root — everything
import { Router, Swarm, PluginManager, EvalHarness } from '@louis1969/ruflo';

// Deep imports (tree-shakeable)
import { Router }       from '@louis1969/ruflo/core/router';
import { Swarm }        from '@louis1969/ruflo/core/swarm';
import { MemoryStore }  from '@louis1969/ruflo/core/memory';
import { LearningLoop } from '@louis1969/ruflo/core/learning';
import { PluginManager, BUILTIN_PLUGINS } from '@louis1969/ruflo/core/plugins';
import { EvalHarness }  from '@louis1969/ruflo/core/eval';
import { createMcpServer } from '@louis1969/ruflo/mcp';
```

### Running a programmatic eval

```typescript
import { EvalHarness, renderTerminal, loadProviderConfigs } from '@louis1969/ruflo';

const configs = await loadProviderConfigs(process.cwd());
const harness = new EvalHarness({ providerConfigs: configs });

const report = await harness.run('coding', {
  judgeMode:   'hybrid',
  concurrency: 4,
  onProgress:  (done, total, name) => process.stdout.write(`\r[${done}/${total}] ${name}`),
});

for (const line of renderTerminal(report)) console.log(line);
```

### Writing a custom plugin

```typescript
import type { RufloPlugin } from '@louis1969/ruflo';

const weatherPlugin: RufloPlugin = {
  name:    'my-weather-plugin',
  version: '1.0.0',

  tools: [{
    name:        'get_weather',
    description: 'Fetch current weather for a city',
    parameters: {
      city: { type: 'string', description: 'City name', required: true },
    },
    async execute({ city }) {
      const res = await fetch(`https://wttr.in/${city}?format=3`);
      return res.text();
    },
  }],

  hooks: [{
    hook:    'after:job',
    handler: (p) => {
      const { jobId, result } = p as any;
      console.log(`Job ${jobId} finished in ${result.totalLatencyMs}ms`);
    },
  }],
};

export default weatherPlugin;
```

Load it:

```typescript
import { PluginManager } from '@louis1969/ruflo';

const plugins = await PluginManager.load({
  plugins:      ['./plugins/weather.js'],   // local path
  builtins:     ['httpFetch', 'jsonExtract'],
  autoDiscover: true,                        // scan node_modules for @ruflo/plugin-*
});
```

---

## Configuration File

`ruflo.config.json` (created by `ruflo init`):

```jsonc
{
  "project": {
    "name":        "my-project",
    "description": "",
    "version":     "0.1.0"
  },
  "providers": {
    "anthropic": { "model": "claude-3-5-haiku-20241022" },
    "openai":    { "model": "gpt-4o-mini" },
    "groq":      { "model": "llama-3.3-70b-versatile" }
  },
  "memory": {
    "backend": "file",
    "path":    ".ruflo/memory"
  },
  "router": {
    "strategy":         "capability",
    "fallbackProvider": "openai"
  },
  "swarm": {
    "maxConcurrentAgents": 5,
    "timeoutMs":           60000
  },
  "learning": {
    "mode":                  "routing-heuristics",
    "evalInterval":          10,
    "minSamplesBeforeAdapt": 3
  },
  "agents": []
}
```

API keys are always read from environment variables (never put them in this file).

---

## Plugin System

Ruflo's plugin system provides five extension points:

| Extension | Purpose |
|-----------|---------|
| `tools` | Callable tools agents can invoke via `<tool_call>` syntax |
| `agents` | Custom named agent roles with their own system prompts |
| `strategies` | Custom routing strategies |
| `providers` | Custom LLM backends |
| `evaluators` | Custom quality scoring for the eval harness |

Plugins are also wired into lifecycle hooks:

| Hook | Fires |
|------|-------|
| `before:job` | Before a job enters the swarm |
| `after:job` | After a job completes (success or failure) |
| `before:task` | Before a single agent task runs |
| `after:task` | After a single agent task completes |
| `on:error` | On any swarm or runner error |
| `on:eval` | After each eval case is judged |
| `on:calibrate` | After heuristic calibration runs |

**Auto-discovery:** npm packages named `@ruflo/plugin-<name>` or `ruflo-plugin-<name>` are loaded automatically when `autoDiscover: true` is set (the default in the CLI).

---

## MCP Integration

Ruflo exposes all its capabilities as MCP tools, resources, and prompts, letting any MCP client (Claude Desktop, custom agents, etc.) drive it.

### Claude Desktop setup

```bash
ruflo mcp --config
```

Copy the printed JSON into `~/.config/Claude/claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`).

### Available MCP tools

| Tool | Description |
|------|-------------|
| `ruflo_run` | Submit a task and get the full result |
| `ruflo_route` | Analyse routing without running |
| `ruflo_status` | Provider health and heuristic weights |
| `ruflo_get_job` | Fetch a job result by ID |
| `ruflo_learn` | Trigger a learning-loop cycle |
| `ruflo_heuristics` | Raw heuristic weight dump |
| `ruflo_providers` | List enabled providers |

### Available MCP resources

| URI | Contents |
|-----|----------|
| `ruflo://jobs` | Recent job index |
| `ruflo://heuristics` | Current routing weights |
| `ruflo://metrics/latest` | Latest learning report |
| `ruflo://config` | Resolved project config |
| `ruflo://job/{id}` | Single job by ID |

### Available MCP prompts

| Prompt | Purpose |
|--------|---------|
| `ruflo_agent_system` | Generate a role-specific system prompt |
| `ruflo_delegate_task` | Generate a structured task-delegation prompt |

---

## Dev Mode

`ruflo dev` starts a hot-reload development environment:

```
  ◈ ruflo devtools
  ──────────────────────────────────────────────────
  devtools   http://127.0.0.1:8787
  api        http://127.0.0.1:8787/api/status
  events     http://127.0.0.1:8787/api/events
  providers  anthropic, groq
  strategy   capability
  watching   /your/project, .ruflo
  ──────────────────────────────────────────────────
  r reload  l learn  e eval  s status  q quit
```

The browser devtools UI at `http://localhost:8787` provides:
- **Live event stream** — all job starts, completions, errors, calibrations via SSE
- **Task submission form** — run tasks directly with strategy selector
- **Provider health panel** — real-time health and heuristic multipliers
- **Event log** — scrollable, colour-coded, 300-event history

File changes (`.env`, `ruflo.config.json`, any `.ts/.js/.json`) trigger context rebuilds without restarting the HTTP server or losing SSE connections.

### HTTP API

| Endpoint | Description |
|----------|-------------|
| `GET /` | Devtools UI (HTML) |
| `GET /api/events` | SSE event stream |
| `GET /api/status` | Provider health + heuristic multipliers |
| `GET /api/jobs` | Recent job IDs |
| `GET /api/heuristics` | Raw heuristic weights |
| `GET /api/report` | Latest learning report |
| `POST /api/run` | Submit a task `{ task, strategy? }` |
| `POST /api/learn` | Trigger a learning cycle |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    ruflo                             │
│                                                     │
│  CLI / MCP / Library API                            │
│         │                                           │
│  ┌──────▼──────────────────────────────────────┐   │
│  │              Swarm                          │   │
│  │  Planner → Executor (parallel) → Aggregator │   │
│  └──────┬──────────────────────────────────────┘   │
│         │                                           │
│  ┌──────▼──────┐   ┌──────────────────────────┐   │
│  │   Router    │   │      Memory Store         │   │
│  │  (heuristic │   │  file / redis / sqlite /  │   │
│  │   weights)  │   │      supabase             │   │
│  └──────┬──────┘   └──────────────────────────┘   │
│         │                                           │
│  ┌──────▼──────────────────────────────────────┐   │
│  │             LLM Adapters                    │   │
│  │  Anthropic · OpenAI · Groq · Ollama · Gemini│   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  ┌──────────────┐  ┌───────────┐  ┌────────────┐  │
│  │ Learning Loop│  │  Plugins  │  │    Eval    │  │
│  │ (calibration,│  │ (tools,   │  │  Harness   │  │
│  │  evolution)  │  │  hooks)   │  │ (rule+LLM) │  │
│  └──────────────┘  └───────────┘  └────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Routing strategies

| Strategy | Selects provider by |
|----------|---------------------|
| `capability` | Best historical success rate × heuristic multiplier for the task type |
| `cost` | Cheapest estimated token cost |
| `latency` | Lowest recorded average latency |
| `round-robin` | Cycles through healthy providers |

Heuristics are updated after every job via the learning loop. Provider multipliers decay toward `1.0` over time, so stale data doesn't dominate routing forever.

### Memory backends

| Backend | Use case |
|---------|----------|
| `file` | Default — zero dependencies, persists to `.ruflo/memory/*.json` |
| `redis` | Production multi-process setups |
| `sqlite` | Single-process, larger history |
| `supabase` | Serverless / edge deployments |

---

## State directory

Ruflo writes all runtime state under `.ruflo/` (configurable via `--state-dir`):

```
.ruflo/
  memory/
    ruflo.json          # all namespaced key-value data
  eval-runs.json        # persisted eval run history
  router.log            # append-only routing decision log
```

Add `.ruflo/` to `.gitignore` unless you want to commit heuristic state.

---

## License

MIT
