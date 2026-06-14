import chalk from 'chalk';
import type { DashboardData, JobSummary } from './data.js';

// ── ANSI primitives ───────────────────────────────────────────────────────────

export const ANSI = {
  clear:       '\x1b[2J',
  home:        '\x1b[H',
  hideCursor:  '\x1b[?25l',
  showCursor:  '\x1b[?25h',
  eraseLine:   '\x1b[K',
  bold:        '\x1b[1m',
  reset:       '\x1b[0m',
};

// ── Color helpers ─────────────────────────────────────────────────────────────

const c = {
  brand:   (s: string) => chalk.hex('#7c6af7')(s),
  dim:     (s: string) => chalk.dim(s),
  bold:    (s: string) => chalk.bold(s),
  green:   (s: string) => chalk.green(s),
  red:     (s: string) => chalk.red(s),
  yellow:  (s: string) => chalk.yellow(s),
  cyan:    (s: string) => chalk.cyan(s),
  white:   (s: string) => chalk.white(s),
  blue:    (s: string) => chalk.blue(s),
  gray:    (s: string) => chalk.gray(s),
};

// ── String utilities (width-safe) ─────────────────────────────────────────────

// Strip ANSI codes to measure display width.
const ANSI_RE = /\x1b\[[0-9;]*m/g;
export function visibleLen(s: string): number {
  return s.replace(ANSI_RE, '').length;
}

export function pad(s: string, width: number, align: 'left' | 'right' = 'left'): string {
  const vl   = visibleLen(s);
  const fill = Math.max(0, width - vl);
  return align === 'left' ? s + ' '.repeat(fill) : ' '.repeat(fill) + s;
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

// ── Progress bar ──────────────────────────────────────────────────────────────

export function bar(value: number, width: number): string {
  const clamped = Math.max(0, Math.min(1, value));
  const filled  = Math.round(clamped * width);
  const empty   = width - filled;
  const color   = clamped >= 0.8 ? chalk.green : clamped >= 0.5 ? chalk.yellow : chalk.red;
  return color('█'.repeat(filled)) + c.gray('░'.repeat(empty));
}

// ── Box drawing ───────────────────────────────────────────────────────────────

const BOX = { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│', lt: '├', rt: '┤' };

export function boxTop(title: string, width: number): string {
  const inner = width - 2;
  const label = title ? ` ${title} ` : '';
  const right = inner - label.length;
  return c.dim(BOX.tl + BOX.h + c.bold(label) + BOX.h.repeat(Math.max(0, right)) + BOX.tr);
}

export function boxBottom(width: number): string {
  return c.dim(BOX.bl + BOX.h.repeat(width - 2) + BOX.br);
}

export function boxRow(content: string, width: number): string {
  return c.dim(BOX.v) + ' ' + pad(content, width - 4) + ' ' + c.dim(BOX.v);
}

export function boxDivider(width: number): string {
  return c.dim(BOX.lt + BOX.h.repeat(width - 2) + BOX.rt);
}

export function boxLines(title: string, rows: string[], width: number): string[] {
  return [boxTop(title, width), ...rows.map((r) => boxRow(r, width)), boxBottom(width)];
}

// ── Status indicators ─────────────────────────────────────────────────────────

export function statusDot(healthy: boolean): string {
  return healthy ? c.green('●') : c.red('●');
}

export function jobIcon(status: string): string {
  switch (status) {
    case 'completed': return c.green('✓');
    case 'failed':    return c.red('✗');
    case 'partial':   return c.yellow('~');
    case 'running':   return c.cyan('⟳');
    default:          return c.gray('·');
  }
}

// ── Time helpers ──────────────────────────────────────────────────────────────

function ago(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60)  return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Header panel ──────────────────────────────────────────────────────────────

export function renderHeader(data: DashboardData, width: number): string[] {
  const logo    = c.brand(c.bold('  ruflo'));
  const version = c.dim('  v0.1.0');
  const clock   = c.dim(`${fmtDate(data.loadedAt)}  ${fmtTime(data.loadedAt)}`);
  const dir     = c.gray(data.stateDir);
  const left    = logo + version + '  ' + dir;
  const right   = clock;
  const gap     = Math.max(1, width - visibleLen(left) - visibleLen(right) - 2);
  return ['', left + ' '.repeat(gap) + right];
}

// ── Providers panel ───────────────────────────────────────────────────────────

export function renderProviders(data: DashboardData, width: number): string[] {
  if (!data.heuristics) {
    return boxLines('Providers', [c.gray('No heuristics data — run: ruflo run <task>')], width);
  }
  const { providers, totalOutcomes } = data.heuristics;
  const rows = providers.map((p) => {
    const dot     = statusDot(true);
    const name    = pad(p.provider, 12);
    const multi   = c.cyan(`×${p.multiplier.toFixed(3)}`);
    const quality = p.avgQuality !== null
      ? c.white(p.avgQuality.toFixed(3))
      : c.gray(' n/a ');
    const miniBar = p.avgQuality !== null ? ' ' + bar(p.avgQuality, 8) : '';
    return `${dot}  ${name} ${multi}  q:${quality}${miniBar}`;
  });
  rows.push(c.gray(`  ${totalOutcomes} outcomes ingested  ·  updated ${ago(data.heuristics.updatedAt)} ago`));
  return boxLines('Providers', rows, width);
}

// ── Learning panel ────────────────────────────────────────────────────────────

export function renderLearning(data: DashboardData, width: number): string[] {
  if (!data.latestReport) {
    return boxLines('Learning', [c.gray('No learning data — run: ruflo learn')], width);
  }
  const r = data.latestReport;
  const q = r.snapshot.overall.avgQuality;

  const rows = [
    `Quality    ${q !== null ? c.white(q.toFixed(3)) + '  ' + bar(q, 10) : c.gray('n/a')}`,
    `Coverage   ${c.white(Math.round(r.snapshot.overall.evalCoverage * 100) + '%').padEnd(5)}  ${bar(r.snapshot.overall.evalCoverage, 10)}`,
    `Updates    ${c.cyan(String(r.heuristicUpdates))}  ·  Jobs: ${c.white(String(r.jobsAnalyzed))}  ·  Scored: ${c.white(String(r.resultsScored))}`,
    `Last run   ${c.gray(ago(r.runAt) + ' ago')}`,
  ];

  if (r.recommendations.length > 0 && r.recommendations[0] !== 'All systems nominal. No immediate action required.') {
    rows.push('');
    rows.push(c.yellow('⚠  ') + truncate(r.recommendations[0]!, width - 8));
  }

  return boxLines('Learning', rows, width);
}

// ── Jobs panel ────────────────────────────────────────────────────────────────

export function renderJobs(data: DashboardData, width: number, scroll: number): string[] {
  const title = `Jobs  ${c.gray(String(data.totalJobs) + ' total')}`;
  if (data.jobs.length === 0) {
    return boxLines(title, [c.gray('No jobs yet — run: ruflo run <task>')], width);
  }

  const visible = data.jobs.slice(scroll, scroll + 8);
  const rows    = visible.map((j: JobSummary) => {
    const icon     = jobIcon(j.status);
    const id       = c.gray(j.id.slice(0, 8));
    const age      = c.gray(ago(j.startedAt));
    const provider = c.dim((j.providersUsed?.[0] ?? '').padEnd(10));
    const task     = c.white(truncate(j.raw, width - 40));
    const cost     = j.totalCostUsd !== undefined && j.totalCostUsd > 0
      ? c.gray('  $' + j.totalCostUsd.toFixed(5))
      : '';
    return `${icon}  ${id}  ${age.padEnd(5)}  ${provider}  ${task}${cost}`;
  });

  if (data.jobs.length > 8) {
    const more = data.jobs.length - 8 - scroll;
    if (more > 0) rows.push(c.gray(`  ↓ ${more} more  (↑↓ to scroll)`));
    if (scroll > 0) rows.unshift(c.gray(`  ↑ ${scroll} above`));
  }

  return boxLines(title, rows, width);
}

// ── Eval panel ───────────────────────────────────────────────────────────────

export function renderEval(data: DashboardData, width: number): string[] {
  if (!data.latestEvalRun) {
    return boxLines('Latest Eval', [c.gray('No eval data — run: ruflo eval')], width);
  }
  const run = data.latestEvalRun;
  const s   = run.summary;
  const pr  = s.passRate;

  const passColor = pr >= 0.8 ? c.green : pr >= 0.5 ? c.yellow : c.red;
  const passBar   = bar(pr, 14);
  const passed    = `${s.passed}/${s.totalCases}  ${passBar}  ${passColor(Math.round(pr * 100) + '%')}`;

  const rows = [
    `${c.cyan(run.suiteName.padEnd(18))}  Pass: ${passed}`,
    `Score: ${c.white(s.avgScore.toFixed(3))}  ·  Latency: ${c.white(s.avgLatencyMs + 'ms')}  ·  Cost: ${c.white('$' + s.totalCostUsd.toFixed(6))}  ·  ${ago(run.runAt)} ago`,
  ];

  // Per-task-type mini breakdown.
  const taskEntries = Object.entries(s.byTaskType);
  if (taskEntries.length > 0) {
    rows.push('');
    const cols = taskEntries.slice(0, 4).map(([t, v]) =>
      `${c.dim(t.slice(0, 8))}: ${bar(v.avgScore, 6)} ${(v.avgScore * 100).toFixed(0)}%`
    );
    rows.push(cols.join('  '));
  }

  return boxLines(`Eval  ${c.gray(run.id.slice(0, 8))}`, rows, width);
}

// ── Footer ────────────────────────────────────────────────────────────────────

export function renderFooter(nextRefreshIn: number, width: number): string[] {
  const shortcuts = [
    c.bold('q') + c.dim(' quit'),
    c.bold('r') + c.dim(' refresh'),
    c.bold('↑↓') + c.dim(' scroll jobs'),
    c.bold('l') + c.dim(' learn now'),
    c.bold('e') + c.dim(' eval now'),
  ].join(c.gray('  ·  '));

  const timer = c.gray(`auto-refresh in ${nextRefreshIn}s`);
  const gap   = Math.max(1, width - visibleLen(shortcuts) - visibleLen(timer) - 4);
  return ['', `  ${shortcuts}${' '.repeat(gap)}${timer}`, ''];
}

// ── Compose all panels ────────────────────────────────────────────────────────

export function renderFrame(
  data:           DashboardData,
  width:          number,
  scroll:         number,
  nextRefreshIn:  number,
): string[] {
  const W       = Math.max(60, width);
  const halfW   = Math.floor((W - 1) / 2);
  const lines:  string[] = [];

  // Header.
  lines.push(...renderHeader(data, W));
  lines.push('');

  // Two-column: providers (left) + learning (right).
  if (W >= 100) {
    const provLines = renderProviders(data, halfW);
    const learnLines = renderLearning(data, W - halfW - 1);
    const maxH = Math.max(provLines.length, learnLines.length);
    const blank = (w: number) => ' '.repeat(w);
    for (let i = 0; i < maxH; i++) {
      const l = provLines[i]  ?? blank(halfW);
      const r = learnLines[i] ?? blank(W - halfW - 1);
      lines.push(pad(l, halfW) + ' ' + r);
    }
  } else {
    lines.push(...renderProviders(data, W));
    lines.push('');
    lines.push(...renderLearning(data, W));
  }

  lines.push('');
  lines.push(...renderJobs(data, W, scroll));
  lines.push('');
  lines.push(...renderEval(data, W));
  lines.push(...renderFooter(nextRefreshIn, W));

  return lines;
}
