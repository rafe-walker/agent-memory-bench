#!/usr/bin/env node
// Before/after table for two Track A result dirs (one arm each), plus a direct probe of the
// per-turn orient cost when nothing changed (not a graded scenario cell).
//   node track-a/compare.mjs --before DIR --before-arm ID --after DIR --after-arm ID [--scenarios S1,S4a,...]
import fs from 'node:fs';
import path from 'node:path';
import { McpClient } from './lib/mcp.mjs';
import { tmpdir, rmrf, gitInit, writeFiles } from './lib/util.mjs';

const a = Object.fromEntries(process.argv.slice(2).reduce((acc, x, i, arr) => { if (x.startsWith('--')) acc.push([x.slice(2), arr[i + 1]]); return acc; }, []));
const SC = (a.scenarios ?? 'S1,S4a,S5,S7,S8,S11').split(',');
const load = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
const B = load(a.before), A = load(a.after);
const pct = (c) => (c?.score == null ? '–' : `${Math.round(c.score * 100)}%`);
const ypn = (c) => (c ? `${c.yes}/${c.partial}/${c.no}${c.errors ? ` ⚠${c.errors}` : ''}` : '–');
const kb = (n) => (n == null ? '–' : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

const out = [];
out.push(`| scenario | before y/p/n | before score | after y/p/n | after score |`, `|---|---|---|---|---|`);
for (const s of SC) {
  const cb = B.cells[`${s}|${a['before-arm']}`], ca = A.cells[`${s}|${a['after-arm']}`];
  out.push(`| ${s} | ${ypn(cb)} | ${pct(cb)} | ${ypn(ca)} | ${pct(ca)} |`);
}
out.push('', '**Bytes the agent sees (mean per call)**', '', `| cell · view | before | after |`, `|---|---|---|`);
for (const s of SC) {
  const cb = B.cells[`${s}|${a['before-arm']}`], ca = A.cells[`${s}|${a['after-arm']}`];
  for (const k of [...new Set([...Object.keys(cb?.bytes ?? {}), ...Object.keys(ca?.bytes ?? {})])]) out.push(`| ${s} · ${k} | ${kb(cb?.bytes?.[k]?.mean)} | ${kb(ca?.bytes?.[k]?.mean)} |`);
}
out.push('', '**S12 retrieval at scale**', '', `| docs | arm | hit | p50 / p95 ms | bytes/query | ingest | store/corpus |`, `|---|---|---|---|---|---|---|`);
for (const [S, arm] of [[B, a['before-arm']], [A, a['after-arm']]]) {
  for (const [k, r] of Object.entries(S.scale ?? {})) {
    if (!k.startsWith(`${arm}|`)) continue;
    out.push(`| ${r.size} | ${arm} | ${r.hits}/${r.n} | ${r.latency_ms?.p50?.toFixed(1)} / ${r.latency_ms?.p95?.toFixed(1)} | ${kb(r.bytes_mean)} | ${(r.ingest_ms / 1000).toFixed(1)} s | ${r.store_over_corpus}× |`);
  }
}

// Probe: orient twice with the cursor and no change in between (the per-turn call).
async function quiet(armId) {
  const Arm = (await import(`./arms/${armId}.mjs`)).default;
  const home = tmpdir('quiet');
  const repo = path.join(home, 'repo');
  gitInit(repo); writeFiles(repo, { 'docs/x.md': '# x\n\nDeploy to `stg-west-3`.\n' });
  const env = { ...process.env, HOME: home, KRONICLE_LITE_DATA_DIR: path.join(home, '.kl') };
  const c = await new McpClient(process.execPath, [Arm.cli, 'serve', '--actor', 'agent-a'], { env, cwd: repo }).start();
  try {
    await c.call('put_document', { slug: 'x', title: 'x', markdown: '# x\n\nDeploy to `stg-west-3`.\n' });
    const s0 = await c.call('get_system_state', {});
    const s1 = await c.call('get_system_state', { since_cursor: s0.json.cursor });
    const p1 = await c.call('get_system_state', { since_cursor: s0.json.cursor, focus: 'pulse' });
    return { orientation: s1.bytes, pulse: p1.bytes };
  } finally { await c.close(); rmrf(home); }
}
const qb = await quiet(a['before-arm']), qa = await quiet(a['after-arm']);
out.push('', '**Per-turn orient with a cursor, nothing changed (probe)**', '', `| call | before | after |`, `|---|---|---|`,
  `| get_system_state (default focus) | ${kb(qb.orientation)} | ${kb(qa.orientation)} |`, `| get_system_state focus=pulse | ${kb(qb.pulse)} | ${kb(qa.pulse)} |`);
console.log(out.join('\n'));
process.exit(0);
