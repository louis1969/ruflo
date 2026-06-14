import type { EvalRun, EvalComparison, EvalReport, EvalJudgment } from './types.js';
import { PASS_THRESHOLD } from './judge.js';

// ── Comparison ────────────────────────────────────────────────────────────────

export function compareRuns(base: EvalRun, compare: EvalRun): EvalComparison {
  const baseMap    = new Map(base.judgments.map((j) => [j.caseId, j]));
  const compareMap = new Map(compare.judgments.map((j) => [j.caseId, j]));

  const improved:  string[] = [];
  const regressed: string[] = [];

  for (const [caseId, cj] of compareMap) {
    const bj = baseMap.get(caseId);
    if (!bj) continue;
    const delta = cj.scores.final - bj.scores.final;
    if (delta > 0.05)        improved.push(`${cj.caseName} (+${(delta * 100).toFixed(0)}%)`);
    else if (delta < -0.05)  regressed.push(`${cj.caseName} (${(delta * 100).toFixed(0)}%)`);
  }

  return {
    baseRunId:     base.id,
    compareRunId:  compare.id,
    scoreDelta:    Math.round((compare.summary.avgScore   - base.summary.avgScore)   * 1000) / 1000,
    passRateDelta: Math.round((compare.summary.passRate   - base.summary.passRate)   * 1000) / 1000,
    costDelta:     Math.round((compare.summary.totalCostUsd - base.summary.totalCostUsd) * 1_000_000) / 1_000_000,
    latencyDelta:  Math.round(compare.summary.avgLatencyMs - base.summary.avgLatencyMs),
    improved,
    regressed,
  };
}

// ── Recommendations ───────────────────────────────────────────────────────────

export function generateEvalRecommendations(
  run:          EvalRun,
  comparison?:  EvalComparison
): string[] {
  const recs: string[] = [];
  const { summary } = run;

  // Overall pass rate.
  if (summary.passRate < 0.5) {
    recs.push(`Pass rate ${Math.round(summary.passRate * 100)}% is below 50% — consider switching routing strategy or provider.`);
  } else if (summary.passRate >= 0.9) {
    recs.push(`Pass rate ${Math.round(summary.passRate * 100)}% — excellent. Consider moving to a harder benchmark suite.`);
  }

  // Per-taskType weak spots.
  for (const [taskType, stats] of Object.entries(summary.byTaskType)) {
    if (stats.cases >= 2 && stats.passRate < 0.5) {
      recs.push(`"${taskType}" tasks only pass ${Math.round(stats.passRate * 100)}% of the time — route these to a more capable provider.`);
    }
  }

  // Provider performance gaps.
  const providerEntries = Object.entries(summary.byProvider);
  if (providerEntries.length >= 2) {
    const sorted   = [...providerEntries].sort(([, a], [, b]) => b.avgScore - a.avgScore);
    const best     = sorted[0]!;
    const cheapest = [...providerEntries].sort(([, a], [, b]) => a.totalCostUsd - b.totalCostUsd)[0]!;
    if (cheapest[0] !== best[0]) {
      const gap = Math.round((best[1].avgScore - cheapest[1].avgScore) * 100);
      if (gap < 15 && cheapest[1].totalCostUsd * 3 < best[1].totalCostUsd) {
        recs.push(
          `Cost opportunity: "${cheapest[0]}" scores within ${gap}% of "${best[0]}" at significantly lower cost.`
        );
      }
    }
  }

  // Trend vs previous run.
  if (comparison) {
    if (comparison.scoreDelta > 0.05) {
      recs.push(`Quality improved +${Math.round(comparison.scoreDelta * 100)}% vs previous run.`);
    } else if (comparison.scoreDelta < -0.05) {
      recs.push(`Quality dropped ${Math.round(Math.abs(comparison.scoreDelta) * 100)}% vs previous run — investigate regressions.`);
    }
    if (comparison.regressed.length > 0) {
      recs.push(`Regressions detected in: ${comparison.regressed.join(', ')}.`);
    }
  }

  if (recs.length === 0) recs.push('All benchmarks nominal. No immediate action required.');
  return recs;
}

// ── Markdown report ────────────────────────────────────────────────────────────

export function renderMarkdown(report: EvalReport): string {
  const { run, comparison, recommendations } = report;
  const { summary } = run;
  const date = new Date(run.runAt).toISOString();
  const bar  = '─'.repeat(60);

  const lines: string[] = [
    `# Ruflo Eval Report`,
    ``,
    `**Suite:** ${run.suiteName}  ·  **Run:** ${run.id.slice(0, 8)}  ·  **Date:** ${date}`,
    `**Strategy:** ${run.strategy}`,
    ``,
    `## Summary`,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Cases | ${summary.totalCases} |`,
    `| Passed | ${summary.passed} / ${summary.totalCases} (${Math.round(summary.passRate * 100)}%) |`,
    `| Avg Score | ${summary.avgScore.toFixed(3)} |`,
    `| Avg Latency | ${summary.avgLatencyMs}ms |`,
    `| Total Cost | $${summary.totalCostUsd.toFixed(6)} |`,
    ``,
  ];

  // Provider breakdown.
  if (Object.keys(summary.byProvider).length > 0) {
    lines.push(`## Provider Breakdown`, ``);
    lines.push(`| Provider | Cases | Pass% | Avg Score | Avg Latency | Cost |`);
    lines.push(`|----------|-------|-------|-----------|-------------|------|`);
    for (const [p, s] of Object.entries(summary.byProvider)) {
      lines.push(
        `| ${p} | ${s.cases} | ${Math.round(s.passRate * 100)}% | ${s.avgScore.toFixed(3)} | ${s.avgLatencyMs}ms | $${s.totalCostUsd.toFixed(6)} |`
      );
    }
    lines.push(``);
  }

  // Task type breakdown.
  if (Object.keys(summary.byTaskType).length > 0) {
    lines.push(`## Task Type Breakdown`, ``);
    lines.push(`| Task Type | Cases | Pass% | Avg Score |`);
    lines.push(`|-----------|-------|-------|-----------|`);
    for (const [t, s] of Object.entries(summary.byTaskType)) {
      lines.push(`| ${t} | ${s.cases} | ${Math.round(s.passRate * 100)}% | ${s.avgScore.toFixed(3)} |`);
    }
    lines.push(``);
  }

  // Comparison.
  if (comparison) {
    lines.push(`## Comparison vs Previous Run`, ``);
    const arrow = (n: number) => n > 0 ? `▲ +${(n * 100).toFixed(1)}%` : n < 0 ? `▼ ${(n * 100).toFixed(1)}%` : `= 0%`;
    lines.push(`| Metric | Delta |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Score | ${arrow(comparison.scoreDelta)} |`);
    lines.push(`| Pass Rate | ${arrow(comparison.passRateDelta)} |`);
    lines.push(`| Cost | ${comparison.costDelta >= 0 ? '+' : ''}$${comparison.costDelta.toFixed(6)} |`);
    lines.push(`| Latency | ${comparison.latencyDelta >= 0 ? '+' : ''}${comparison.latencyDelta}ms |`);
    if (comparison.improved.length > 0)  lines.push(``, `**Improved:** ${comparison.improved.join(', ')}`);
    if (comparison.regressed.length > 0) lines.push(``, `**Regressed:** ${comparison.regressed.join(', ')}`);
    lines.push(``);
  }

  // Recommendations.
  lines.push(`## Recommendations`, ``);
  for (const r of recommendations) lines.push(`- ${r}`);
  lines.push(``);

  // Per-case results.
  lines.push(`## Case Results`, ``, `\`\`\``);
  lines.push(bar);
  for (const j of run.judgments) {
    const status = j.passed ? '✓ PASS' : '✗ FAIL';
    lines.push(
      `${status}  ${j.caseName.padEnd(35)} score:${j.scores.final.toFixed(3)}  ${j.provider.padEnd(12)}  ${j.latencyMs}ms`
    );
    if (j.failedCriteria.length > 0) {
      lines.push(`       Failed: ${j.failedCriteria[0]?.slice(0, 80)}`);
    }
  }
  lines.push(bar);
  lines.push('```');

  return lines.join('\n');
}

// ── Terminal renderer ──────────────────────────────────────────────────────────

export function renderTerminal(report: EvalReport): string[] {
  const { run, comparison, recommendations } = report;
  const { summary } = run;
  const bar  = '─'.repeat(55);
  const out:  string[] = [];

  const passEmoji = (j: EvalJudgment) => j.passed ? '✓' : '✗';

  out.push(`  ${bar}`);
  out.push(`  ${run.suiteName}  —  ${run.id.slice(0, 8)}  —  ${new Date(run.runAt).toISOString()}`);
  out.push(`  ${bar}`);
  out.push(`  Strategy:     ${run.strategy}`);
  out.push(`  Cases:        ${summary.totalCases}`);
  out.push(`  Pass rate:    ${Math.round(summary.passRate * 100)}%  (${summary.passed}/${summary.totalCases})`);
  out.push(`  Avg score:    ${summary.avgScore.toFixed(3)}  (threshold: ${PASS_THRESHOLD})`);
  out.push(`  Avg latency:  ${summary.avgLatencyMs}ms`);
  out.push(`  Total cost:   $${summary.totalCostUsd.toFixed(6)}`);
  out.push('');

  if (Object.keys(summary.byProvider).length > 0) {
    out.push(`  ${bar}`);
    out.push('  Provider Breakdown');
    out.push(`  ${bar}`);
    for (const [p, s] of Object.entries(summary.byProvider)) {
      out.push(
        `  ${p.padEnd(12)}  pass: ${Math.round(s.passRate * 100)}%` +
        `  score: ${s.avgScore.toFixed(3)}` +
        `  latency: ${s.avgLatencyMs}ms` +
        `  cost: $${s.totalCostUsd.toFixed(6)}`
      );
    }
    out.push('');
  }

  if (Object.keys(summary.byTaskType).length > 0) {
    out.push(`  ${bar}`);
    out.push('  Task Type Breakdown');
    out.push(`  ${bar}`);
    for (const [t, s] of Object.entries(summary.byTaskType)) {
      out.push(`  ${t.padEnd(14)}  pass: ${Math.round(s.passRate * 100)}%  score: ${s.avgScore.toFixed(3)}`);
    }
    out.push('');
  }

  if (comparison) {
    out.push(`  ${bar}`);
    out.push('  Comparison vs Previous Run');
    out.push(`  ${bar}`);
    const d = comparison;
    const sign = (n: number) => n >= 0 ? `+${(n * 100).toFixed(1)}%` : `${(n * 100).toFixed(1)}%`;
    out.push(`  Score delta:    ${sign(d.scoreDelta)}`);
    out.push(`  Pass rate delta: ${sign(d.passRateDelta)}`);
    if (d.improved.length > 0)  out.push(`  Improved:  ${d.improved.join(', ')}`);
    if (d.regressed.length > 0) out.push(`  Regressed: ${d.regressed.join(', ')}`);
    out.push('');
  }

  out.push(`  ${bar}`);
  out.push('  Recommendations');
  out.push(`  ${bar}`);
  for (const r of recommendations) out.push(`  • ${r}`);
  out.push('');

  out.push(`  ${bar}`);
  out.push('  Case Results');
  out.push(`  ${bar}`);
  for (const j of run.judgments) {
    out.push(
      `  ${passEmoji(j)}  ${j.caseName.padEnd(36)} ${j.scores.final.toFixed(3)}  ${j.provider.padEnd(12)}  ${j.latencyMs}ms`
    );
  }
  out.push(`  ${bar}`);

  return out;
}
