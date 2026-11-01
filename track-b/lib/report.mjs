#!/usr/bin/env node
// Aggregate results/track-b/runs.jsonl into summary.json + tables.md, and splice
// the tables into REPORT.md between <!-- BEGIN:TABLES --> / <!-- END:TABLES -->.
import fs from 'node:fs';
import path from 'node:path';
import { RESULTS, readJsonl, wilson, clopperPearson, fisher } from './common.mjs';
import { ARMS } from './arms.mjs';
import { SCENARIOS } from '../scenarios/index.mjs';

const runs = readJsonl(path.join(RESULTS, 'runs.jsonl'));
const ledger = readJsonl(path.join(RESULTS, 'ledger.jsonl'));
const pct = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '–');
const ci = ([a, b]) => `${pct(a)}–${pct(b)}`;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const fmt = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const k = (rs, f) => rs.filter(f).length;

const groups = new Map();
for (const r of runs) {
  if (r.infra_error) continue;
  const g = `${r.scenario}|${r.model}|${r.arm}`;
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g).push(r);
}

const summary = [];
const order = ['none', 'native', 'kronicle', 'kronicle_strict', 'kronicle_push', 'kronicle_ccpush', 'kronicle_ccsub', 'basicmem', 'ccanchor', 'sea', 'beads'];
const keys = [...groups.keys()].sort((a, b) => {
  const [sa, ma, aa] = a.split('|'); const [sb, mb, ab] = b.split('|');
  return sa.localeCompare(sb) || ma.localeCompare(mb) || order.indexOf(aa) - order.indexOf(ab);
});
for (const g of keys) {
  const rs = groups.get(g); const [scenario, model, arm] = g.split('|');
  const n = rs.length; const s = k(rs, (r) => r.success); const w = k(rs, (r) => r.wrong_action);
  const base = groups.get(`${scenario}|${model}|none`);
  let p = null;
  if (base && arm !== 'none') { const bs = k(base, (r) => r.success); p = fisher(s, n - s, bs, base.length - bs); }
  const row = {
    scenario, model, arm, n, success: s, success_rate: s / n, success_wilson: wilson(s, n), success_exact: clopperPearson(s, n),
    wrong: w, wrong_rate: w / n, wrong_wilson: wilson(w, n), fisher_p_vs_none: p,
    mean_tokens: mean(rs.map((r) => r.usage.total_tokens)), mean_input_side: mean(rs.map((r) => r.usage.input + r.usage.cache_read + r.usage.cache_write)),
    mean_output: mean(rs.map((r) => r.usage.output)), mean_cost: mean(rs.map((r) => r.usage.cost_usd)), total_cost: rs.reduce((a, r) => a + r.usage.cost_usd, 0),
    mean_wall_s: mean(rs.map((r) => r.wall_ms / 1000)), mean_tool_calls: mean(rs.map((r) => r.agents.reduce((a, x) => a + x.tool_calls, 0))),
    peeked: k(rs, (r) => r.peeked), steps_complete: k(rs, (r) => r.steps_complete !== false),
    seeds: rs.map((r) => r.seed).sort((a, b) => a - b),
  };
  row.pushed = k(rs, (r) => (r.agents || []).some((a) => (a.pushes || 0) > 0));
  row.pushes_mean = mean(rs.map((r) => (r.agents || []).reduce((s, a) => s + (a.pushes || 0), 0)));
  if (scenario === 'T1' || scenario === 'T6') { row.exposed = k(rs, (r) => r.exposed); row.reground = k(rs, (r) => r.reground_after_fault); row.fault_fired = k(rs, (r) => r.fault_fired); }
  if (scenario === 'T2') row.flagged = k(rs, (r) => r.flagged_conflict);
  if (scenario === 'T7') { row.complete = k(rs, (r) => r.steps_complete); row.final_new = k(rs, (r) => r.final_handoff === 'new'); row.stopped = k(rs, (r) => r.stopped_subagent); row.correct_deploy = k(rs, (r) => r.deploy_targets.length > 0 && r.deploy_targets.every((d) => d === r.expected)); }
  if (scenario === 'T5') { row.read_truth = k(rs, (r) => r.read_truth); row.read_memory = k(rs, (r) => r.read_memory); }
  if (scenario === 'T4') { row.compacted = k(rs, (r) => r.compacted); row.target_ok = k(rs, (r) => r.target_ok); row.channel_ok = k(rs, (r) => r.channel_ok); row.mean_compactions = mean(rs.map((r) => r.compactions)); row.audit_all6 = k(rs, (r) => r.audit_correct_files === 6); }
  if (scenario === 'T3') {
    for (const f of ['duplicate_tickets', 'lost_edits', 'lost_changelog', 'conflict_marker_files', 'edit_conflict_errors', 'scope_denials', 'git_lock_errors', 'uncommitted_files']) row[f] = rs.reduce((a, r) => a + (r[f] || 0), 0);
    row.runs_with_collision = w; row.both_worked = k(rs, (r) => r.both_worked); row.mean_functions_ok = mean(rs.map((r) => r.functions_ok));
  }
  summary.push(row);
}

let md = '';
const totalCost = runs.reduce((a, r) => a + r.usage.cost_usd, 0);
md += `Generated ${new Date().toISOString()} from \`${path.relative(path.resolve(RESULTS, '..', '..'), RESULTS)}/runs.jsonl\` (${runs.length} graded runs; ${runs.filter((r) => r.infra_error).length} infra errors excluded). `;
md += `Headless invocations used: **${ledger.length}** (ledger). Total metered cost of the graded runs: **$${totalCost.toFixed(2)}** (stream-json \`total_cost_usd\`).\n\n`;
md += 'CIs are 95% Wilson (exact Clopper–Pearson in summary.json). *p* = two-sided Fisher exact test of success vs the `none` arm in the same scenario/model. Tokens = input + cache read + cache write + output per run (all agents).\n\n';

for (const scn of Object.keys(SCENARIOS)) {
  const rows = summary.filter((r) => r.scenario === scn);
  if (!rows.length) continue;
  md += `### ${scn} — ${SCENARIOS[scn].title}\n\n`;
  if (scn === 'T3') {
    md += '| model | arm | n | success (all 4 tickets, no collision) | runs with ≥1 collision | dup tickets | lost edits (fn / changelog) | conflict markers | edit "modified since read" errors | scope denials | tokens/run | $/run | wall s |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n';
    for (const r of rows) md += `| ${r.model} | ${r.arm} | ${r.n} | ${r.success}/${r.n} = ${pct(r.success_rate)} (${ci(r.success_wilson)}) | ${r.wrong}/${r.n} (${ci(r.wrong_wilson)}) | ${r.duplicate_tickets} | ${r.lost_edits} / ${r.lost_changelog} | ${r.conflict_marker_files} | ${r.edit_conflict_errors} | ${r.scope_denials} | ${fmt(r.mean_tokens / 1000)}k | ${fmt(r.mean_cost, 3)} | ${fmt(r.mean_wall_s)} |\n`;
  } else {
    const extraHead = { T1: 'read source before fault | re-checked after fault', T6: 'read source before edit | re-checked after edit', T2: 'flagged conflict in reply', T5: 'read targets.json | read memory', T4: 'compacted | target ok | channel ok', T7: 'all 5 steps | deployed only to the new target | last deploy hand-off names new target | coordinator stopped a subagent' }[scn];
    const pushCol = ['T1', 'T6', 'T7'].includes(scn) && rows.some((r) => r.pushed > 0);
    const wrongName = { T1: 'stale deploy', T6: 'wrong deploy', T2: 'used superseded flags', T5: 'followed poisoned memory', T4: 'used pre-decision value', T7: 'stale deploy' }[scn];
    md += `| model | arm | n | success | ${wrongName} | p vs none | ${extraHead}${pushCol ? ' | runs with a retraction push (mean pushes)' : ''} | tokens/run | $/run | wall s | tool calls |\n|---|---|---|---|---|---|---|---|---|---|${extraHead.split('|').map(() => '---|').join('')}${pushCol ? '---|' : ''}\n`;
    for (const r of rows) {
      const extra = { T1: `${r.exposed}/${r.n} | ${r.reground}/${r.n}`, T6: `${r.exposed}/${r.n} | ${r.reground}/${r.n}`, T2: `${r.flagged}/${r.n}`, T5: `${r.read_truth}/${r.n} | ${r.read_memory}/${r.n}`, T4: `${r.compacted}/${r.n} (avg ${fmt(r.mean_compactions, 1)}) | ${r.target_ok}/${r.n} | ${r.channel_ok}/${r.n}`, T7: `${r.complete}/${r.n} | ${r.correct_deploy}/${r.n} | ${r.final_new}/${r.n} | ${r.stopped}/${r.n}` }[scn] + (pushCol ? ` | ${r.pushed}/${r.n} (${fmt(r.pushes_mean, 1)})` : '');
      md += `| ${r.model} | ${r.arm} | ${r.n} | ${r.success}/${r.n} = ${pct(r.success_rate)} (${ci(r.success_wilson)}) | ${r.wrong}/${r.n} = ${pct(r.wrong_rate)} (${ci(r.wrong_wilson)}) | ${r.fisher_p_vs_none == null ? '–' : r.fisher_p_vs_none < 0.001 ? '<0.001' : r.fisher_p_vs_none.toFixed(3)} | ${extra} | ${fmt(r.mean_tokens / 1000)}k | ${fmt(r.mean_cost, 4)} | ${fmt(r.mean_wall_s)} | ${fmt(r.mean_tool_calls, 1)} |\n`;
    }
  }
  const pk = rows.reduce((a, r) => a + r.peeked, 0);
  if (pk) md += `\n${pk} run(s) in this scenario read bench internals (flag \`peeked\`); they are included above.\n`;
  md += '\n';
}
const armsRun = new Set(runs.map((r) => r.arm));
md += '#### Arms\n\n| arm | what | version |\n|---|---|---|\n' + Object.entries(ARMS).filter(([k2]) => armsRun.has(k2)).map(([k2, v]) => `| ${k2} | ${v.label} | ${v.version} |`).join('\n') + '\n';

fs.writeFileSync(path.join(RESULTS, 'summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(RESULTS, 'tables.md'), md);
const rep = path.join(RESULTS, 'REPORT.md');
// --prose: (re)write REPORT.md from track-b/analysis.mjs (hand-written findings) + these tables.
if (process.argv.includes('--prose')) {
  const B = (await import('../analysis.mjs')).default;
  fs.writeFileSync(rep, `${B.head}\n<!-- BEGIN:TABLES -->\n<!-- END:TABLES -->\n`);
}
if (fs.existsSync(rep)) {
  const t = fs.readFileSync(rep, 'utf8');
  const a = t.indexOf('<!-- BEGIN:TABLES -->'), b = t.indexOf('<!-- END:TABLES -->');
  if (a >= 0 && b > a) fs.writeFileSync(rep, t.slice(0, a + 21) + '\n' + md + t.slice(b));
}
console.log(md);
