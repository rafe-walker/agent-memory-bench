#!/usr/bin/env node
// Tables for the hardening-live scenarios (L1–L9b) from <RESULTS>/runs.jsonl:
// success / wrong action with 95% Wilson CIs, Fisher p vs `none`, tokens, wall,
// tool calls, hook activity, plus per-scenario diagnostics. Writes
// <RESULTS>/summary.json and <RESULTS>/tables.md.
import fs from 'node:fs';
import path from 'node:path';
import { RESULTS, readJsonl, wilson, clopperPearson, fisher } from './common.mjs';
import { ARMS } from './arms.mjs';
import { SCENARIOS } from '../scenarios/index.mjs';

const runs = readJsonl(path.join(RESULTS, 'runs.jsonl')).filter((r) => r.scenario.startsWith('L'));
const ledger = readJsonl(path.join(RESULTS, 'ledger.jsonl'));
const pct = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '–');
const ci = ([a, b]) => `${pct(a)}–${pct(b)}`;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const fmt = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const k = (rs, f) => rs.filter(f).length;
const sum = (rs, f) => rs.reduce((a, r) => a + (Number(f(r)) || 0), 0);

const order = ['none', 'kronicle', 'kronicle_shim', 'full', 'full_noactor', 'full_shim'];
const groups = new Map();
for (const r of runs) {
  if (r.infra_error) continue;
  const g = `${r.scenario}|${r.model}|${r.arm}`;
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g).push(r);
}
const keys = [...groups.keys()].sort((a, b) => {
  const [sa, ma, aa] = a.split('|'); const [sb, mb, ab] = b.split('|');
  return sa.localeCompare(sb, 'en', { numeric: true }) || ma.localeCompare(mb) || order.indexOf(aa) - order.indexOf(ab);
});

// per-scenario diagnostic columns: [header, (rows) => cell]
const D = {
  L1: [['target ok / channel ok', (rs) => `${k(rs, (r) => r.target_ok)} / ${k(rs, (r) => r.channel_ok)}`], ['re-read after v2 / after v3', (rs) => `${k(rs, (r) => r.reground_after_fault)} / ${k(rs, (r) => r.reground_after_v3)}`]],
  L2: [['re-read after move', (rs) => `${k(rs, (r) => r.reground_after_fault)}`], ['hook text said "removed"', (rs) => `${k(rs, (r) => r.hook_said_removed)}`], ['derailed (no deploy)', (rs) => `${k(rs, (r) => r.derailed)}`]],
  L3: [['re-read after typo', (rs) => `${k(rs, (r) => r.reground_after_fault)}`], ['derailed (no deploy)', (rs) => `${k(rs, (r) => r.derailed)}`], ['deploy attempts (mean)', (rs) => fmt(mean(rs.map((r) => r.deploy_attempts)), 1)]],
  L4: [['compacted', (rs) => `${k(rs, (r) => r.compacted)}`], ['pending at compact (runs >0)', (rs) => (rs[0].pending_at_compact == null ? '–' : `${k(rs, (r) => r.pending_at_compact > 0)}`)], ['re-read in part 1 / before deploy in part 2', (rs) => `${k(rs, (r) => r.reread_in_A1)} / ${k(rs, (r) => r.reread_before_deploy_A2)}`]],
  L5: [['subagents (mean)', (rs) => fmt(mean(rs.map((r) => r.subagents)), 1)], ['last deploy hand-off: new / stale / none', (rs) => `${k(rs, (r) => r.final_handoff === 'new')} / ${k(rs, (r) => r.final_handoff === 'stale')} / ${k(rs, (r) => r.final_handoff === 'none')}`], ['stopped a subagent', (rs) => `${k(rs, (r) => r.stopped_subagent)}`]],
  L6: [['runs w/ collision', (rs) => `${k(rs, (r) => r.wrong_action)}`], ['dup / lost fn / lost CL', (rs) => `${sum(rs, (r) => r.duplicate_tickets)} / ${sum(rs, (r) => r.lost_edits)} / ${sum(rs, (r) => r.lost_changelog)}`], ['both agents worked', (rs) => `${k(rs, (r) => r.both_worked)}`], ['wait calls / sleeps / wait errors', (rs) => `${sum(rs, (r) => r.wait_calls)} / ${sum(rs, (r) => r.sleeps)} / ${sum(rs, (r) => r.wait_errors)}`], ['scope denials / edit conflicts', (rs) => `${sum(rs, (r) => r.scope_denials)} / ${sum(rs, (r) => r.edit_conflict_errors)}`]],
  L7: [['note written', (rs) => `${k(rs, (r) => r.note_written)}`], ['lineage edges to runbook (runs >0)', (rs) => (rs[0].lineage == null ? '–' : `${k(rs, (r) => (r.lineage?.edges_to_runbook || 0) > 0)}`)], ['pending at session-2 start (runs >0)', (rs) => (rs[0].pending_at_A2_start == null ? '–' : `${k(rs, (r) => r.pending_at_A2_start > 0)}`)], ['read runbook before deploy', (rs) => `${k(rs, (r) => r.read_runbook_before_deploy_A2)}`]],
  L8: [['via make / npm', (rs) => `${k(rs, (r) => r.via === 'make')} / ${k(rs, (r) => r.via === 'npm')}`], ['used hidden path / bypassed to ./bin/deploy', (rs) => `${k(rs, (r) => r.used_hidden_path)} / ${k(rs, (r) => r.bypassed_wrapper)}`], ['re-read after change', (rs) => `${k(rs, (r) => r.reground_after_fault)}`], ['shim denials (log)', (rs) => `${sum(rs, (r) => r.shim_log_denies)}`]],
  L9: [['stopped (no deploy)', (rs) => `${k(rs, (r) => r.stopped)}`], ['reported integrity', (rs) => `${k(rs, (r) => r.reported_integrity)}`], ['deployed TAMPERED value', (rs) => `${k(rs, (r) => r.deployed_tampered_value)}`], ['integrity msgs (hook)', (rs) => `${sum(rs, (r) => r.integrity_msgs)}`]],
};
D.L9b = D.L9; D.L9c = D.L9;

const summary = [];
for (const g of keys) {
  const rs = groups.get(g); const [scenario, model, arm] = g.split('|');
  const n = rs.length; const s = k(rs, (r) => r.success); const w = k(rs, (r) => r.wrong_action);
  const base = groups.get(`${scenario}|${model}|none`);
  let p = null;
  if (base && arm !== 'none') { const bs = k(base, (r) => r.success); p = fisher(s, n - s, bs, base.length - bs); }
  summary.push({
    scenario, model, arm, n, success: s, success_wilson: wilson(s, n), success_exact: clopperPearson(s, n),
    wrong: w, wrong_wilson: wilson(w, n), fisher_p_vs_none: p,
    mean_tokens: mean(rs.map((r) => r.usage.total_tokens)), mean_cost: mean(rs.map((r) => r.usage.cost_usd)), total_cost: sum(rs, (r) => r.usage.cost_usd),
    mean_wall_s: mean(rs.map((r) => r.wall_ms / 1000)), mean_tool_calls: mean(rs.map((r) => r.agents.reduce((a, x) => a + x.tool_calls, 0))),
    pushes: sum(rs, (r) => r.pushes), denies: sum(rs, (r) => r.denies), pending_denies: sum(rs, (r) => r.pending_denies),
    chain_split_denies: sum(rs, (r) => r.chain_split_denies), oneliner_denies: sum(rs, (r) => r.oneliner_denies), shim_denials: sum(rs, (r) => r.shim_denials),
    peeked: k(rs, (r) => r.peeked), seeds: rs.map((r) => r.seed).sort((a, b) => a - b),
    diag: Object.fromEntries((D[scenario] || []).map(([h, f]) => [h, f(rs)])),
  });
}

const totalCost = runs.reduce((a, r) => a + r.usage.cost_usd, 0);
let md = `Generated ${new Date().toISOString()} from \`${path.relative(path.resolve(RESULTS, '..', '..'), RESULTS)}/runs.jsonl\` (${runs.length} graded runs; ${runs.filter((r) => r.infra_error).length} infra errors excluded). Headless invocations: **${ledger.length}**. Metered cost of these runs: **$${totalCost.toFixed(2)}**.\n\n`;
md += 'Success/wrong with 95% Wilson CI (exact Clopper–Pearson in summary.json). *p* = two-sided Fisher exact, success vs `none` (same scenario/model). Tokens = input + cache read + cache write + output, all agents/phases. Hooks: pushes = cc-anchor retraction pushes; denies = PreToolUse denies (all causes); pend = pending-gate denies; split = chain-split denies; shim = exec-time shim refusals seen in tool results.\n\n';
for (const scn of Object.keys(SCENARIOS).filter((x) => x.startsWith('L'))) {
  const rows = summary.filter((r) => r.scenario === scn);
  if (!rows.length) continue;
  const dh = (D[scn] || []).map(([h]) => h);
  md += `### ${scn} — ${SCENARIOS[scn].title}\n\n`;
  md += `| model | arm | n | success | wrong action | p vs none | ${dh.join(' | ')} | hooks: pushes / denies (pend, split) / shim | tokens/run | $/run | wall s | tool calls |\n`;
  md += `|${'---|'.repeat(6 + dh.length + 5)}\n`;
  for (const r of rows) {
    md += `| ${r.model} | ${r.arm} | ${r.n} | ${r.success}/${r.n} (${ci(r.success_wilson)}) | ${r.wrong}/${r.n} (${ci(r.wrong_wilson)}) | ${r.fisher_p_vs_none == null ? '–' : r.fisher_p_vs_none < 0.001 ? '<0.001' : r.fisher_p_vs_none.toFixed(3)} | ${dh.map((h) => r.diag[h]).join(' | ')} | ${r.pushes} / ${r.denies} (${r.pending_denies}, ${r.chain_split_denies}) / ${r.shim_denials} | ${fmt(r.mean_tokens / 1000)}k | ${fmt(r.mean_cost, 4)} | ${fmt(r.mean_wall_s)} | ${fmt(r.mean_tool_calls, 1)} |\n`;
  }
  const pk = rows.reduce((a, r) => a + r.peeked, 0);
  if (pk) md += `\n${pk} run(s) read bench internals (\`peeked\`); included above.\n`;
  md += '\n';
}
const armsRun = new Set(runs.map((r) => r.arm));
md += '#### Arms\n\n| arm | what | version |\n|---|---|---|\n' + Object.entries(ARMS).filter(([a]) => armsRun.has(a)).map(([a, v]) => `| ${a} | ${v.label} | ${v.version} |`).join('\n') + '\n';
fs.writeFileSync(path.join(RESULTS, 'summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(RESULTS, 'tables.md'), md);
console.log(md);
