// Renders results/track-a/REPORT.md from meta.json + summary.json, splicing in the hand-written
// analysis (track-a/analysis.md, sections keyed `## <id>`). Tables are generated; prose is not.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './util.mjs';

const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);
const ci = (r) => (r?.wilson?.lo == null ? '' : `[${pct(r.wilson.lo)}–${pct(r.wilson.hi)}]`);
const kb = (b) => (b == null ? '–' : b >= 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`);
const ms = (x) => (x == null ? '–' : x < 10 ? x.toFixed(1) : Math.round(x).toString());
const GLYPH = { yes: '✅', partial: '🟡', no: '❌', 'n/a': '·', mixed: '◐', error: '⚠', skipped: '⏭' };

async function analysis() {
  const p = path.join(ROOT, 'track-a', 'analysis.mjs');
  if (!fs.existsSync(p)) return {};
  return (await import(`${p}?t=${Date.now()}`)).default;
}

function cellText(c) {
  if (!c) return '';
  if (c.verdict === 'n/a' || c.verdict === 'skipped' || c.verdict === 'error' || !c.n) return GLYPH[c.verdict] ?? '·';
  return `${GLYPH[c.verdict] ?? ''} ${pct(c.score)}`;
}

export async function writeReport(outDir, meta, summary) {
  const A = await analysis();
  const cells = Object.values(summary.cells);
  const arms = Object.keys(meta.arms);
  const scen = [...new Set(cells.map((c) => c.scenario))];
  const L = [];
  L.push('# agent-memory-bench — Track A report', '');
  L.push(`Generated ${meta.finished_at ?? meta.started_at} by \`npm run track-a${meta.ci ? ':ci' : ''}\` — deterministic, no LLM, $0. Seeds per randomized cell: **${meta.seeds}**. Wall time ${meta.wall_s_initial ?? meta.wall_s ?? '?'} s${meta.merges ? ` (+ merged re-runs: ${meta.merges.map((m) => `${m.arms.join(',')} × ${m.scenarios?.join(',') ?? 'all'}`).join('; ')})` : ''} on ${meta.host.cpus} CPU / ${meta.host.mem_gb} GB, Node ${meta.host.node}. Bench code at commit \`${meta.git ?? 'uncommitted'}\` plus the working tree committed with these results.`, '');
  if (A.summary) L.push(A.summary, '');
  L.push('**How to read the grades.** Each cell is graded per seed against the scenario\'s expected signal (scenarios/*.yaml) by fixed string/regex rules in `track-a/lib/grade.mjs`: ✅ yes = the tool surfaced the fault the way the scenario expects; 🟡 partial = the agent could notice (e.g. the fresh value on re-lookup) but is not told what changed, or the signal is advisory; ❌ no = nothing, or the wrong thing, is shown. **Score** = (yes + ½·partial)/n. ◐ = mixed across seeds. · = not applicable (reason in the per-scenario table). Intervals are 95% Wilson on the yes-rate; exact Clopper–Pearson bounds are in the JSON.', '');

  // Matrix
  L.push('## Headline matrix', '');
  L.push(`| scenario | ${arms.join(' | ')} |`, `|---|${arms.map(() => '---').join('|')}|`);
  for (const s of scen) {
    const title = cells.find((c) => c.scenario === s)?.title ?? '';
    L.push(`| **${s}** ${title.split('(')[0].trim()} | ${arms.map((a) => cellText(summary.cells[`${s}|${a}`])).join(' | ')} |`);
  }
  if (summary.scale) {
    const sizes = [...new Set(Object.values(summary.scale).map((r) => r.size))];
    for (const size of sizes) L.push(`| **S12** hit / p50 / bytes @${size} docs | ${arms.map((a) => { const r = summary.scale[`${a}|${size}`]; return r ? (r.error ? '⚠' : r.skipped ? '⏭' : `${r.hits}/${r.n} · ${ms(r.latency_ms?.p50)} ms · ${kb(r.bytes_mean)}`) : ''; }).join(' | ')} |`);
  }
  L.push('');

  // Arms
  L.push('## Arms run', '');
  L.push('| arm | version | kinds | setup steps | tools/list | notes |', '|---|---|---|---|---|---|');
  for (const a of arms) {
    const m = meta.arms[a];
    const tl = m.tools_list ? (m.tools_list.error ? `error: ${m.tools_list.error.slice(0, 60)}` : `${m.tools_list.tools} tools, ${kb(m.tools_list.bytes)} (~${m.tools_list.tokens} tok)`) : 'no MCP (CLI/hooks)';
    L.push(`| ${m.label} | ${m.version} | ${m.kind.join(', ')} | ${m.setupSteps.length} | ${tl} | ${(m.notes ?? '').replace(/\|/g, '/')} |`);
  }
  L.push('');
  if (A.skipped) L.push('### Arms not run', '', A.skipped, '');

  // Context cost
  L.push('## Context cost', '', 'Bytes the agent sees, averaged over every scenario cell the arm ran (tokens ≈ bytes/4, same proxy for every arm). `tools/list` is paid once per session unless the client defers schemas (Claude Code defers MCP schemas behind tool search by default).', '');
  L.push('| arm | tools/list | session start | mid-session touch | lookup (read) | post-compaction |', '|---|---|---|---|---|---|');
  for (const a of arms) {
    const agg = (k) => { const xs = cells.filter((c) => c.arm === a && c.bytes?.[k]?.mean != null).map((c) => c.bytes[k].mean); return xs.length ? Math.round(xs.reduce((x, y) => x + y, 0) / xs.length) : null; };
    const m = meta.arms[a];
    L.push(`| ${a} | ${m.tools_list?.bytes ? kb(m.tools_list.bytes) : '–'} | ${kb(agg('sessionStart'))} | ${kb(agg('touch'))} | ${kb(agg('read'))} | ${kb(agg('postCompact'))} |`);
  }
  L.push('');
  L.push('### Latency (ms, p50 / p95 over all calls of that kind)', '');
  L.push('| arm | touch | read | claim race (S3a, all N) | edit guard (S3b) |', '|---|---|---|---|---|');
  for (const a of arms) {
    const lat = (k) => { const xs = cells.filter((c) => c.arm === a && c.latency_ms?.[k]?.n); if (!xs.length) return '–'; const p50 = xs.map((c) => c.latency_ms[k].p50).sort((x, y) => x - y)[Math.floor(xs.length / 2)]; const p95 = Math.max(...xs.map((c) => c.latency_ms[k].p95)); return `${ms(p50)} / ${ms(p95)}`; };
    L.push(`| ${a} | ${lat('touch')} | ${lat('read')} | ${lat('claim_race')} | ${lat('guard')} |`);
  }
  L.push('');

  // Per scenario
  L.push('## Per-scenario results', '');
  for (const s of scen) {
    const cs = cells.filter((c) => c.scenario === s);
    L.push(`### ${s} — ${cs[0]?.title ?? ''}`, '');
    if (A[s]) L.push(A[s], '');
    L.push('| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |', '|---|---|---|---|---|---|---|');
    for (const c of cs.sort((x, y) => (y.score ?? -1) - (x.score ?? -1))) {
      const bt = c.bytes?.touch?.mean ?? c.bytes?.postCompact?.mean ?? c.bytes?.guard?.mean;
      L.push(`| ${c.arm} | ${c.n ? `${c.yes} / ${c.partial} / ${c.no}` : '–'}${c.na ? ` (${c.na})` : ''}${c.errors ? ` ⚠${c.errors}` : ''} | ${c.score == null ? '–' : pct(c.score)} | ${c.n ? `${pct(c.yes_rate.p)} ${ci(c.yes_rate)}` : '–'} | ${c.delivery ?? '–'} | ${kb(bt)} / ${kb(c.bytes?.read?.mean)} | ${(c.reason ?? c.error_samples?.[0] ?? '').replace(/\|/g, '/').slice(0, 110)} |`);
    }
    const flagRows = cs.filter((c) => c.flags && Object.keys(c.flags).length);
    const interesting = ['staleUnmarked', 'nextSessionPass', 'nextSessionStaleCopy', 'persisted', 'served', 'warned', 'double_claim', 'falseAlarm', 'provenance', 'lost_or_dup', 'holderTold', 'leak'];
    const fr = flagRows.map((c) => [c.arm, interesting.filter((k) => c.flags[k]).map((k) => `${k} ${pct(c.flags[k].p)} (${c.flags[k].k}/${c.flags[k].n})`)]).filter(([, v]) => v.length);
    if (fr.length) { L.push('', '<details><summary>secondary flags</summary>', '', ...fr.map(([a, v]) => `- **${a}**: ${v.join(', ')}`), '', '</details>'); }
    L.push('');
  }

  if (summary.scale) {
    L.push('### S12 — Retrieval at scale', '');
    if (A.S12) L.push(A.S12, '');
    L.push('| arm | docs | hit (needle in view) | p50 / p95 ms | bytes / query (≈tok) | ingest | store / corpus |', '|---|---|---|---|---|---|---|');
    for (const r of Object.values(summary.scale)) {
      if (r.error) { L.push(`| ${r.arm} | ${r.size} | ⚠ ${r.error.slice(0, 80)} | | | | |`); continue; }
      if (r.skipped) { L.push(`| ${r.arm} | ${r.size} | ⏭ ${r.skipped} | | | | |`); continue; }
      L.push(`| ${r.arm} | ${r.size} | ${r.hits}/${r.n} ${ci(r.hit_rate)} | ${ms(r.latency_ms.p50)} / ${ms(r.latency_ms.p95)} | ${kb(r.bytes_mean)} (${r.tokens_mean}) | ${(r.ingest_ms / 1000).toFixed(1)} s | ${r.store_over_corpus ?? '–'}× |`);
    }
    L.push('');
  }

  // Wins / losses (generated)
  L.push('## Where each tool wins and loses (generated from scores)', '');
  for (const a of arms) {
    const mine = cells.filter((c) => c.arm === a && c.n);
    const wins = mine.filter((c) => { const best = Math.max(...cells.filter((x) => x.scenario === c.scenario && x.n).map((x) => x.score)); return c.score === best && c.score > 0; }).map((c) => c.scenario);
    const sole = wins.filter((s) => cells.filter((x) => x.scenario === s && x.n && x.score === summary.cells[`${s}|${a}`].score).length === 1);
    const loses = mine.filter((c) => c.score === 0).map((c) => c.scenario);
    L.push(`- **${a}** — best or tied-best: ${wins.join(', ') || 'none'}${sole.length ? ` (alone: ${sole.join(', ')})` : ''}; scores 0: ${loses.join(', ') || 'none'}`);
  }
  L.push('');
  if (A.priorities) L.push('## What to develop next (kronicle-lite, sea-lite, cc-anchor)', '', A.priorities, '');
  if (A.fairness) L.push('## Method, fairness notes and limitations', '', A.fairness, '');
  L.push('## Reproduce', '', '```sh', 'npm run track-a:setup   # installs pinned arms into .arms/ (npm, uv, git)', 'npm run track-a         # full run → results/track-a/', 'npm run track-a:ci      # <2 min subset → results/track-a-ci/', '```', '', 'Raw per-seed records (grades, reasons, bytes, latencies, flags) are in `results/track-a/<scenario>.json`; aggregated cells in `summary.json`; versions and tool catalogs in `meta.json`.', '');
  fs.writeFileSync(path.join(outDir, 'REPORT.md'), L.join('\n'));
}
