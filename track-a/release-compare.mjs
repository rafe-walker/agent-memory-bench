#!/usr/bin/env node
// Before/after tables for the release re-run (results/RELEASE-RERUN.md body).
//   before = the pre-release run: results/prerelease/{track-a, track-b, track-b-ccpush, track-b-ccsub}
//            (kronicle-lite 0.5.0 npm + 0.6.0 local, sea-lite 0.4.0 local, cc-anchor 0.3.0 / push-hook / next-cycle local)
//   after  = results/track-a, results/track-b (kronicle-lite 0.7.0, sea-lite 0.5.0, cc-anchor v0.4.0)
//   node track-a/release-compare.mjs > /tmp/x.md
// Track A: y/p/n, score and Wilson 95% CI of the ✅ rate per cell, Fisher exact p on ✅ before vs after.
// Track B: success k/n with Wilson 95% CI, Fisher exact p before vs after, tokens / $ / wall per run.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/util.mjs';
import { wilson, fisher, readJsonl } from '../track-b/lib/common.mjs';

const R = (...p) => path.join(ROOT, 'results', ...p);
const J = (...p) => JSON.parse(fs.readFileSync(R(...p), 'utf8'));
const pct = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '–');
const ci = (k, n) => { if (!n) return '–'; const [a, b] = wilson(k, n); return `${pct(a)}–${pct(b)}`; };
const pv = (p) => (p == null ? '–' : p < 0.001 ? '<0.001' : p.toFixed(3));
const fmt = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const kb = (n) => (n == null ? '–' : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);
const out = [];
const HEAD = process.argv.includes('--head') ? (await import('./release-head.mjs')).default : null;
if (HEAD) out.push(HEAD, '');

// ---------------- Track A ----------------
const AB = J('prerelease', 'track-a', 'summary.json'), AA = J('track-a', 'summary.json');
const MB = J('prerelease', 'track-a', 'meta.json'), MA = J('track-a', 'meta.json');
// [after arm, [before arms…], label]; p is against the first before arm (the last released version where one exists).
const PAIRS = [
  ['kronicle-lite', ['kronicle-lite', 'kronicle-lite-0.6'], 'kronicle-lite', ['0.5.0', '0.6.0*'], '0.7.0'],
  ['kronicle-lite-core', ['kronicle-lite-0.6-core'], 'kronicle-lite --core', ['0.6.0*'], '0.7.0'],
  ['cc-anchor', ['cc-anchor'], 'cc-anchor', ['0.3.0*'], '0.4.0'],
  ['sea-lite', ['sea-lite'], 'sea-lite', ['0.4.0*'], '0.5.0'],
  ['sea-lite+cc-anchor', ['sea-lite+cc-anchor'], 'sea-lite + cc-anchor', ['0.4.0* + 0.3.0*'], '0.5.0 + 0.4.0'],
];
const cellStr = (c) => (!c ? '–' : c.n ? `${c.yes}/${c.partial}/${c.no}${c.errors ? ` ⚠${c.errors}` : ''} · ${pct(c.score)} · ✅ ${ci(c.yes, c.n)}` : c.verdict === 'n/a' ? 'n/a' : c.verdict ?? '–');
const scen = [...new Set(Object.values(AA.cells).map((c) => c.scenario))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
out.push('## Track A (deterministic, 20 seeds per randomized cell; S13 3 repetitions)', '');
out.push('Cell = yes/partial/no · score ((yes + ½·partial)/n) · Wilson 95% CI of the ✅ rate. * = unreleased build. *p* = two-sided Fisher exact test of ✅ counts, first "before" vs after. ▲/▼ = score up/down vs that build. Cells that are n/a on both sides are omitted.', '');
out.push('| scenario | tool | before | after | change | p |', '|---|---|---|---|---|---|');
const regressionsA = [];
for (const s of scen) {
  for (const [aId, bIds, label, bVers, aVer] of PAIRS) {
    const a = AA.cells[`${s}|${aId}`], bs = bIds.map((b) => AB.cells[`${s}|${b}`]);
    if (!a?.n && !bs.some((b) => b?.n)) continue;
    const b = bs[0];
    let change = '=', p = null;
    if (a?.n && b?.n) {
      p = fisher(b.yes, b.n - b.yes, a.yes, a.n - a.yes);
      if (a.score < b.score - 1e-9) { change = `▼ ${pct(b.score)} → ${pct(a.score)}`; regressionsA.push({ s, label, b, a, p }); }
      else if (a.score > b.score + 1e-9) change = `▲ ${pct(b.score)} → ${pct(a.score)}`;
      else if ((a.errors ?? 0) !== (b.errors ?? 0)) change = `errors ${b.errors ?? 0} → ${a.errors ?? 0}`;
    }
    const before = bs.map((c, k) => `${bVers[k]}: ${cellStr(c)}`).join('<br>');
    out.push(`| ${s} | ${label} | ${before} | ${aVer}: ${cellStr(a)} | ${change} | ${pv(p)} |`);
  }
}
// Competitors and controls: same versions; any change is noise or a bench change, so list it.
const ours = new Set(['kronicle-lite', 'kronicle-lite-0.6', 'kronicle-lite-0.6-core', 'kronicle-lite-core', 'cc-anchor', 'sea-lite', 'sea-lite+cc-anchor']);
const drift = [];
for (const [key, a] of Object.entries(AA.cells)) {
  if (ours.has(a.arm)) continue;
  const b = AB.cells[key];
  if (!b) continue;
  if (a.yes !== b.yes || a.partial !== b.partial || a.no !== b.no || (a.errors ?? 0) !== (b.errors ?? 0)) drift.push(`| ${a.scenario} | ${a.arm} | ${cellStr(b)} | ${cellStr(a)} |`);
}
out.push('', `**Controls and competitors (same versions both runs):** ${drift.length ? `${drift.length} cell(s) differ:` : 'every cell identical (yes/partial/no/errors).'}`, '');
if (drift.length) out.push('| scenario | arm | before | after |', '|---|---|---|---|', ...drift, '');

// tools/list
out.push('', '**Context cost: `tools/list` (bytes the agent pays every session)**', '', '| tool | before | after |', '|---|---|---|');
const tl = (m) => (m?.tools_list?.bytes ? `${m.tools_list.tools} tools, ${kb(m.tools_list.bytes)} (~${m.tools_list.tokens} tok)` : '–');
const tlc = (m) => (m?.tools_list_core?.bytes ? `${m.tools_list_core.tools} tools, ${kb(m.tools_list_core.bytes)} (~${m.tools_list_core.tokens} tok)` : '–');
out.push(`| kronicle-lite (full) | 0.5.0: ${tl(MB.arms['kronicle-lite'])}; 0.6.0: ${tl(MB.arms['kronicle-lite-0.6'])} | 0.7.0: ${tl(MA.arms['kronicle-lite'])} |`);
out.push(`| kronicle-lite \`--core\` | 0.6.0: ${tl(MB.arms['kronicle-lite-0.6-core'])} | 0.7.0: ${tl(MA.arms['kronicle-lite-core'])} |`);
out.push(`| sea-lite (full) | 0.4.0: ${tl(MB.arms['sea-lite'])} | 0.5.0: ${tl(MA.arms['sea-lite'])} |`);
out.push(`| sea-lite \`--core\` | 0.4.0: (no core profile) | 0.5.0: ${tlc(MA.arms['sea-lite'])} |`);

// S12
out.push('', '**S12 retrieval at scale (kronicle-lite)**', '', '| docs | before | after |', '|---|---|---|');
const sc = (S, k) => { const r = S.scale?.[k]; return r && !r.error && !r.skipped ? `${r.hits}/${r.n} hit · p50 ${fmt(r.latency_ms?.p50, 1)} ms · ${kb(r.bytes_mean)}/query · ingest ${fmt(r.ingest_ms / 1000, 1)} s · store ${r.store_over_corpus}× corpus` : (r?.error ? `error` : '–'); };
for (const size of [1000, 10000]) {
  out.push(`| ${size} full | 0.5.0: ${sc(AB, `kronicle-lite|${size}`)}<br>0.6.0: ${sc(AB, `kronicle-lite-0.6|${size}`)} | 0.7.0: ${sc(AA, `kronicle-lite|${size}`)} |`);
  out.push(`| ${size} --core | 0.6.0: ${sc(AB, `kronicle-lite-0.6-core|${size}`)} | 0.7.0: ${sc(AA, `kronicle-lite-core|${size}`)} |`);
}

// S14
out.push('', '**S14 planning cost (sea-lite paths)**', '', '| path | before (0.4.0) | after (0.5.0) |', '|---|---|---|');
const pl = (S, id) => { const r = S.planning?.rows?.[id]; return r ? `${r.calls?.[0] ?? '?'} call(s), ~${r.tokens_total} tok (written ${kb(r.written_bytes?.mean)}, returned ${kb(r.result_bytes?.mean)}); exact ${r.exact?.k}/${r.exact?.n}, atomic ${r.atomic ? `${r.atomic.k}/${r.atomic.n}` : '–'}${r.errors?.length ? `; errors: ${r.errors.length}` : ''}` : '–'; };
for (const id of ['sea-lite/apply', 'sea-lite/apply-template', 'sea-lite/per-item']) out.push(`| ${id} | ${pl(AB, id)} | ${pl(AA, id)} |`);

// S15
const s15a = fs.existsSync(R('track-a', 'S15.json')) ? J('track-a', 'S15.json') : null;
const s15b = fs.existsSync(R('track-a-sl-wait', 'S15.json')) ? J('track-a-sl-wait', 'S15.json') : null;
if (s15a) {
  out.push('', '**S15 contention (T3 pattern, scripted, time-compressed)** — no pre-release 0.4.0 run exists; the reference is the unreleased `wait` branch build.', '', '| build · mode | n | wall s | done A / B | runs where an agent gave up | tool calls | model turns |', '|---|---|---|---|---|---|---|');
  const row = (lab, x) => x && out.push(`| ${lab} | ${x.n} | ${x.wall_s} | ${x.done_A} / ${x.done_B} | ${x.gave_up}/${x.n} | ${x.calls} | ${x.turns} |`);
  row(`${s15b?.tool ?? 'branch'} · sleep+retry`, s15b?.poll); row(`${s15b?.tool ?? 'branch'} · wait_seconds`, s15b?.wait);
  row(`${s15a.tool} · sleep+retry`, s15a.poll);
  if (!s15a.wait) out.push(`| ${s15a.tool} · wait_seconds | – | not in the release | | | | |`);
}

// ---------------- Track B ----------------
out.push('', '## Track B (live headless `claude -p`, Haiku 5.5)', '');
const before = [
  ...readJsonl(R('prerelease', 'track-b', 'runs.jsonl')).map((r) => ({ ...r, _src: 'prerelease/track-b' })),
  ...readJsonl(R('prerelease', 'track-b-ccpush', 'runs.jsonl')).map((r) => ({ ...r, _src: 'prerelease/track-b-ccpush' })),
  ...readJsonl(R('prerelease', 'track-b-ccsub', 'runs.jsonl')).map((r) => ({ ...r, _src: 'prerelease/track-b-ccsub' })),
].filter((r) => !r.infra_error && r.model === 'haiku');
const after = readJsonl(R('track-b', 'runs.jsonl')).filter((r) => !r.infra_error && r.model === 'haiku');
const grp = (rs, s, a) => rs.filter((r) => r.scenario === s && r.arm === a);
const mean = (xs) => (xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : NaN);
const cellB = (rs) => { const n = rs.length, k = rs.filter((r) => r.success).length; return n ? `${k}/${n} = ${pct(k / n)} (${ci(k, n)})` : '–'; };
const costB = (rs) => (rs.length ? `${fmt(mean(rs.map((r) => r.usage.total_tokens)) / 1000)}k tok · $${fmt(mean(rs.map((r) => r.usage.cost_usd)), 4)} · ${fmt(mean(rs.map((r) => r.wall_ms / 1000)))} s` : '–');
const BPAIRS = [
  ['T1', 'none', 'none', 'no memory'],
  ['T1', 'native', 'native', 'native CLAUDE.md'],
  ['T1', 'kronicle', 'kronicle', 'kronicle-lite pull-only 0.5.0 → 0.7.0'],
  ['T1', 'kronicle_ccpush', 'kronicle_ccpush', 'kronicle-lite + cc-anchor push: 0.5.0 + push-hook (unreleased) → 0.7.0 + 0.4.0'],
  ['T6', 'none', 'none', 'no memory'],
  ['T6', 'kronicle_ccpush', 'kronicle_ccpush', 'kronicle-lite + cc-anchor push (as T1)'],
  ['T3', 'none', 'none', 'no memory (BACKLOG.md)'],
  ['T3', 'sea', 'sea', 'sea-lite + cc-anchor guard: 0.4.0 + 0.3.0 → 0.5.0 + 0.4.0'],
  ['T3', 'beads', 'beads', 'beads 1.3.2 (unchanged)'],
  ['T7', 'kronicle_ccpush', 'kronicle_ccpush', 'cc-anchor shared cursor: push-hook (unreleased) → 0.4.0; fixture fixed'],
  ['T7', 'kronicle_ccsub', null, 'cc-anchor next-cycle per-subagent cursors (unreleased; not re-run)'],
];
out.push('Success = all steps with the right values (T3: all 4 tickets, no collision). Cost = mean tokens · $ · wall per run. *p* = Fisher exact, success before vs after.', '');
out.push('| scenario | arm | before success (95% CI) | after success (95% CI) | p | before cost | after cost |', '|---|---|---|---|---|---|---|');
const regressionsB = [];
for (const [s, bA, aA, label] of BPAIRS) {
  const b = grp(before, s, bA), a = aA ? grp(after, s, aA) : [];
  if (!b.length && !a.length) continue;
  const kb_ = b.filter((r) => r.success).length, ka = a.filter((r) => r.success).length;
  const p = b.length && a.length ? fisher(kb_, b.length - kb_, ka, a.length - ka) : null;
  if (b.length && a.length && ka / a.length < kb_ / b.length) regressionsB.push({ s, label: ['none', 'native', 'beads'].includes(bA) ? `${label} — control, version unchanged` : label, b: `${kb_}/${b.length}`, a: `${ka}/${a.length}`, p });
  out.push(`| ${s} | ${label} | ${cellB(b)} | ${aA ? cellB(a) : 'not re-run'} | ${pv(p)} | ${costB(b)} | ${aA ? costB(a) : '–'} |`);
}
const spentAfter = after.reduce((x, r) => x + r.usage.cost_usd, 0);
out.push('', `Track B after-run metered cost: $${spentAfter.toFixed(2)} over ${after.length} graded runs.`);

out.push('', '## Generated check: every compared cell whose score or success is lower after', '', 'Graded outcomes only (costs are in the Regressions section at the top). Includes the no-tool and competitor controls, whose versions did not change.', '');
if (!regressionsA.length && !regressionsB.length) out.push('None.');
for (const r of regressionsA) out.push(`- Track A ${r.s}, ${r.label}: ${r.b.yes}/${r.b.partial}/${r.b.no} (${pct(r.b.score)}) → ${r.a.yes}/${r.a.partial}/${r.a.no} (${pct(r.a.score)}), Fisher p = ${pv(r.p)}.`);
for (const r of regressionsB) out.push(`- Track B ${r.s}, ${r.label}: ${r.b} → ${r.a}, Fisher p = ${pv(r.p)}.`);
const text = out.join('\n') + '\n';
if (process.argv.includes('--write')) fs.writeFileSync(R('RELEASE-RERUN.md'), text); else process.stdout.write(text);
