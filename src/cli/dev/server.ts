import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import type { Inspector, DevEvent } from './inspector.js';

export type ContextGetter = () => {
  activeProviders():    string[];
  router: {
    getRegistry(): { all(): Array<{ provider: string; isHealthy: boolean; avgLatencyMs: number; successRate: number }> };
    getHeuristics(): { get(): Record<string, unknown> };
  };
  memory:  { ns(s: string): { get<T>(k: string): Promise<T | null> } };
  swarm:   { submit(task: string): Promise<{ jobId: string; output: string; success: boolean; totalCostUsd: number; totalLatencyMs: number; agentsUsed: string[]; providersUsed: string[] }> };
  learning: { run(): Promise<unknown>; getLatestReport(): Promise<unknown> };
};

// ── SSE helpers ───────────────────────────────────────────────────────────────

function sseHeaders(): Record<string, string> {
  return {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection':    'keep-alive',
    'X-Accel-Buffering': 'no',    // nginx: disable proxy buffering
    'Access-Control-Allow-Origin': '*',
  };
}

function sseWrite(res: ServerResponse, event: DevEvent): void {
  if (res.writableEnded) return;
  try {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch { /* client disconnected */ }
}

// ── CORS + JSON helpers ───────────────────────────────────────────────────────

function cors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res: ServerResponse, status: number, data: unknown): void {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end',  () => resolve(body));
    req.on('error', reject);
  });
}

// ── Embedded devtools HTML ────────────────────────────────────────────────────

function devtoolsHtml(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ruflo devtools</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Cascadia Code','Fira Code','Consolas',monospace;font-size:13px;background:#0d1117;color:#c9d1d9;height:100vh;display:flex;flex-direction:column}
header{display:flex;align-items:center;gap:16px;padding:8px 16px;background:#161b22;border-bottom:1px solid #30363d;flex-shrink:0}
.logo{color:#7c6af7;font-weight:700;font-size:15px;letter-spacing:-0.5px}
.dot{width:8px;height:8px;border-radius:50%;background:#f85149;display:inline-block;margin-right:4px}
.dot.connected{background:#3fb950}
#conn-label{color:#8b949e;font-size:12px}
.badge{background:#21262d;border:1px solid #30363d;border-radius:4px;padding:2px 8px;font-size:11px;color:#8b949e}
main{flex:1;display:grid;grid-template-columns:280px 1fr;overflow:hidden}
aside{display:flex;flex-direction:column;gap:0;border-right:1px solid #30363d;overflow-y:auto}
.panel{padding:12px;border-bottom:1px solid #30363d}
.panel h3{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;color:#8b949e;margin-bottom:8px}
textarea{width:100%;height:80px;background:#0d1117;border:1px solid #30363d;border-radius:4px;color:#c9d1d9;padding:6px 8px;font-family:inherit;font-size:12px;resize:vertical}
textarea:focus{outline:none;border-color:#7c6af7}
.row{display:flex;gap:6px;margin-top:6px}
select{flex:1;background:#161b22;border:1px solid #30363d;border-radius:4px;color:#c9d1d9;padding:4px 6px;font-family:inherit;font-size:12px}
button{background:#7c6af7;border:none;border-radius:4px;color:#fff;padding:4px 12px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:600}
button:hover{background:#9d8df8}
button:disabled{background:#30363d;color:#8b949e;cursor:default}
.provider{display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px}
.prov-dot{width:7px;height:7px;border-radius:50%;background:#f85149;flex-shrink:0}
.prov-dot.healthy{background:#3fb950}
.prov-name{flex:1;color:#c9d1d9}
.prov-multi{color:#7c6af7;font-size:11px}
#tools-list{font-size:11px;color:#8b949e;line-height:1.6}
.tool-name{color:#58a6ff}
#events-panel{display:flex;flex-direction:column;overflow:hidden}
#events-header{padding:8px 16px;border-bottom:1px solid #30363d;display:flex;align-items:center;gap:8px;flex-shrink:0;background:#161b22}
#events-header span{color:#8b949e;font-size:11px}
#clear-btn{margin-left:auto;background:none;border:1px solid #30363d;color:#8b949e;padding:2px 8px;font-size:11px;border-radius:3px}
#clear-btn:hover{color:#c9d1d9;border-color:#8b949e}
#event-log{flex:1;overflow-y:auto;padding:8px 16px;display:flex;flex-direction:column-reverse;gap:3px}
.ev{display:flex;gap:8px;align-items:baseline;line-height:1.5;border-radius:3px;padding:1px 3px}
.ev:hover{background:#161b22}
.ev-ts{color:#484f58;font-size:10px;white-space:nowrap;flex-shrink:0}
.ev-type{font-size:11px;font-weight:700;white-space:nowrap;flex-shrink:0;min-width:110px}
.ev-data{color:#8b949e;font-size:12px;word-break:break-all}
.t-job-start{color:#58a6ff}.t-job-end-ok{color:#3fb950}.t-job-end-fail{color:#f85149}
.t-reload{color:#e3b341}.t-error{color:#f85149}.t-log-warn{color:#e3b341}.t-log-info{color:#484f58}
.t-heuristics{color:#bc8cff}.t-default{color:#8b949e}
</style>
</head>
<body>
<header>
  <span class="logo">◈ ruflo devtools</span>
  <span><span class="dot" id="dot"></span><span id="conn-label">connecting…</span></span>
  <span class="badge">:${port}</span>
  <span class="badge" id="event-count">0 events</span>
</header>
<main>
<aside>
  <div class="panel">
    <h3>Submit Task</h3>
    <textarea id="task-input" placeholder="Describe a task for the swarm…"></textarea>
    <div class="row">
      <select id="strategy">
        <option value="capability">capability</option>
        <option value="cost">cost</option>
        <option value="latency">latency</option>
        <option value="round-robin">round-robin</option>
      </select>
      <button id="run-btn">Run</button>
    </div>
  </div>
  <div class="panel">
    <h3>Providers</h3>
    <div id="provider-list"><span style="color:#484f58">loading…</span></div>
  </div>
  <div class="panel">
    <h3>Plugins &amp; Tools</h3>
    <div id="tools-list"><span style="color:#484f58">—</span></div>
  </div>
</aside>
<section id="events-panel">
  <div id="events-header">
    <span>Event stream</span>
    <button id="clear-btn" onclick="clearLog()">clear</button>
  </div>
  <div id="event-log"></div>
</section>
</main>
<script>
const log   = document.getElementById('event-log');
const dot   = document.getElementById('dot');
const label = document.getElementById('conn-label');
const count = document.getElementById('event-count');
let total   = 0;

function ts(ms) {
  return new Date(ms).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
}

function typeClass(ev) {
  if (ev.type === 'job:start')  return 't-job-start';
  if (ev.type === 'job:end')    return ev.data.success ? 't-job-end-ok' : 't-job-end-fail';
  if (ev.type === 'reload')     return 't-reload';
  if (ev.type === 'error')      return 't-error';
  if (ev.type === 'heuristics') return 't-heuristics';
  if (ev.type === 'log')        return ev.data.level === 'warn' ? 't-log-warn' : 't-log-info';
  return 't-default';
}

function summarise(ev) {
  const d = ev.data;
  switch (ev.type) {
    case 'connected':   return \`providers: \${d.providers?.join(', ') || '—'}  tools: \${d.tools?.join(', ') || '—'}\`;
    case 'job:start':   return \`\${d.jobId?.slice(0,8)}  \${d.raw?.slice(0,60)}\`;
    case 'job:end':     return \`\${d.jobId?.slice(0,8)}  \${d.success?'✓':'✗'}  \${d.latency}ms  $\${d.cost?.toFixed(6)}\`;
    case 'reload':      return \`\${d.reason}  (\${d.elapsed}ms)\`;
    case 'error':       return d.message;
    case 'heuristics':  return \`calibration pts: \${d.calibrationCount}\`;
    case 'log':         return \`[\${d.level}] \${d.message}\`;
    default:            return JSON.stringify(d).slice(0, 120);
  }
}

function addEvent(ev) {
  total++;
  count.textContent = total + ' events';
  const row = document.createElement('div');
  row.className = 'ev';
  row.innerHTML = \`<span class="ev-ts">\${ts(ev.ts)}</span><span class="ev-type \${typeClass(ev)}">\${ev.type}</span><span class="ev-data">\${summarise(ev)}</span>\`;
  log.prepend(row);
  if (log.children.length > 300) log.lastElementChild?.remove();
}

function clearLog() { log.innerHTML = ''; total = 0; count.textContent = '0 events'; }

// Populate providers panel from status API.
async function refreshProviders() {
  try {
    const r = await fetch('/api/status');
    const d = await r.json();
    const pl = document.getElementById('provider-list');
    pl.innerHTML = (d.providers || []).map(p =>
      \`<div class="provider"><div class="prov-dot \${p.isHealthy?'healthy':''}"></div><span class="prov-name">\${p.provider}</span><span class="prov-multi">\${p.multiplier?.toFixed(3)??''}</span></div>\`
    ).join('');
    const tl = document.getElementById('tools-list');
    tl.innerHTML = (d.tools || []).length > 0
      ? d.tools.map(t => \`<div><span class="tool-name">\${t.name}</span> — \${t.description}</div>\`).join('')
      : '<span style="color:#484f58">No tools loaded. Run: ruflo plugin list --builtin</span>';
  } catch {}
}

// SSE connection.
const es = new EventSource('/api/events');
es.onopen  = () => { dot.className = 'dot connected'; label.textContent = 'connected'; refreshProviders(); };
es.onerror = () => { dot.className = 'dot'; label.textContent = 'reconnecting…'; };
es.onmessage = (e) => { try { addEvent(JSON.parse(e.data)); } catch {} };

// Task submission.
document.getElementById('run-btn').addEventListener('click', async () => {
  const task     = document.getElementById('task-input').value.trim();
  const strategy = document.getElementById('strategy').value;
  if (!task) return;
  const btn = document.getElementById('run-btn');
  btn.disabled = true; btn.textContent = 'Running…';
  try {
    const r = await fetch('/api/run', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ task, strategy }),
    });
    const d = await r.json();
    addEvent({ type: 'job:end', ts: Date.now(), data: d });
    refreshProviders();
  } catch(e) {
    addEvent({ type: 'error', ts: Date.now(), data: { message: String(e) } });
  } finally {
    btn.disabled = false; btn.textContent = 'Run';
  }
});

document.getElementById('task-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) document.getElementById('run-btn').click();
});

refreshProviders();
setInterval(refreshProviders, 10000);
</script>
</body>
</html>`;
}

// ── DevHttpServer ─────────────────────────────────────────────────────────────

export class DevHttpServer {
  private readonly inspector:  Inspector;
  private readonly getCtx:     ContextGetter;
  private readonly port:       number;
  private sseClients:          Set<ServerResponse> = new Set();
  private server:              ReturnType<typeof createServer> | null = null;

  constructor(inspector: Inspector, getCtx: ContextGetter, port: number) {
    this.inspector = inspector;
    this.getCtx    = getCtx;
    this.port      = port;

    // Forward all inspector events to SSE clients.
    this.inspector.subscribe((event) => {
      for (const client of this.sseClients) {
        sseWrite(client, event);
      }
    });
  }

  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handle(req, res).catch((err) => {
          if (!res.writableEnded) json(res, 500, { error: String(err) });
        });
      });

      this.server.on('error', reject);
      this.server.listen(this.port, '127.0.0.1', () => resolve());
    });
  }

  close(): void {
    for (const client of this.sseClients) {
      try { client.end(); } catch { /* ignore */ }
    }
    this.sseClients.clear();
    this.server?.close();
  }

  // ── Request router ─────────────────────────────────────────────────────────

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url      = req.url ?? '/';
    const method   = req.method ?? 'GET';

    if (method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }

    // GET /
    if (method === 'GET' && url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(devtoolsHtml(this.port));
      return;
    }

    // GET /api/events  — SSE stream
    if (method === 'GET' && url === '/api/events') {
      res.writeHead(200, sseHeaders());
      this.sseClients.add(res);

      // Replay recent events so a freshly-connected browser is up to date.
      for (const event of this.inspector.recent(30).reverse()) {
        sseWrite(res, event);
      }

      req.on('close', () => { this.sseClients.delete(res); });
      // Keep-alive ping every 20s to prevent proxy timeouts.
      const ping = setInterval(() => {
        if (res.writableEnded) { clearInterval(ping); return; }
        try { res.write(': ping\n\n'); } catch { clearInterval(ping); }
      }, 20_000);
      return;
    }

    // GET /api/status
    if (method === 'GET' && url === '/api/status') {
      const ctx       = this.getCtx();
      const registry  = ctx.router.getRegistry();
      const providers = registry.all().map((p) => ({
        provider:   p.provider,
        isHealthy:  p.isHealthy,
        latencyMs:  Math.round(p.avgLatencyMs),
        successRate: Math.round(p.successRate * 100) / 100,
        multiplier: (ctx.router.getHeuristics().get() as { providerMultiplier?: Record<string, number> })
                      .providerMultiplier?.[p.provider] ?? 1,
      }));
      json(res, 200, { providers, tools: [] });
      return;
    }

    // GET /api/jobs
    if (method === 'GET' && url === '/api/jobs') {
      const c      = this.getCtx();
      const ns     = c.memory.ns('job');
      const jobIds = (await ns.get<string[]>('index')) ?? [];
      json(res, 200, { total: jobIds.length, ids: jobIds.slice(-20) });
      return;
    }

    // GET /api/heuristics
    if (method === 'GET' && url === '/api/heuristics') {
      const weights = this.getCtx().router.getHeuristics().get();
      json(res, 200, weights);
      return;
    }

    // GET /api/report
    if (method === 'GET' && url === '/api/report') {
      const report = await this.getCtx().learning.getLatestReport();
      json(res, 200, report ?? { message: 'No learning report yet' });
      return;
    }

    // POST /api/run
    if (method === 'POST' && url === '/api/run') {
      const body = await readBody(req);
      let task = '';
      try {
        const parsed = JSON.parse(body) as { task?: string };
        task = parsed.task ?? '';
      } catch {
        task = body.trim();
      }
      if (!task) { json(res, 400, { error: 'task is required' }); return; }
      const result = await this.getCtx().swarm.submit(task);
      json(res, 200, result);
      return;
    }

    // POST /api/learn
    if (method === 'POST' && url === '/api/learn') {
      const report = await this.getCtx().learning.run();
      json(res, 200, report);
      return;
    }

    // 404
    json(res, 404, { error: `Not found: ${method} ${url}` });
  }
}
