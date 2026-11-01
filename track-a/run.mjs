#!/usr/bin/env node
// Track A runner: deterministic, no LLM, $0.
//   node track-a/run.mjs [--ci] [--seeds N] [--arms a,b] [--scenarios S1,S3] [--sizes 1000,10000] [--out DIR] [--jobs N]
// S16 (exec-time gate) applies only to the opt-in arm: --arms kronicle-lite-shims --scenarios S16
//   (build it first: bash track-a/setup-kl-shims.sh).
// Writes results/track-a/{meta,summary,<scenario>}.json and REPORT.md (via lib/report.mjs).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ROOT, tmpdir, rmrf, sh, gitInit } from './lib/util.mjs';
import { rate, latency, tokens } from './lib/stats.mjs';
import { G, gradeScore } from './lib/grade.mjs';
import { KNOWLEDGE } from './scenarios/knowledge.mjs';
import { COORDINATION } from './scenarios/coordination.mjs';
import { S12 } from './scenarios/scale.mjs';
import { S14 } from './scenarios/planning.mjs';
import { EXEC_GATE } from './scenarios/exec-gate.mjs';
import { writeReport } from './lib/report.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return acc; }, []));
const CI = !!args.ci;
const SEEDS = +(args.seeds ?? (CI ? 3 : 20));
const OUT = path.resolve(args.out ?? path.join(ROOT, 'results', CI ? 'track-a-ci' : 'track-a'));
const JOBS = +(args.jobs ?? 2);
const ARM_IDS_ALL = ['baseline', 'native', 'kronicle-lite', 'kronicle-lite-0.6', 'kronicle-lite-0.6-core', 'basic-memory', 'server-memory', 'cc-anchor', 'sea-lite', 'sea-lite+cc-anchor', 'beads', 'agent-mail', 'backlog-md', 'task-master'];
const CI_ARMS = ['baseline', 'native', 'kronicle-lite', 'server-memory', 'cc-anchor', 'sea-lite', 'sea-lite+cc-anchor'];
const armIds = args.arms ? String(args.arms).split(',') : CI ? CI_ARMS : ARM_IDS_ALL;
const scenarioIds = args.scenarios ? String(args.scenarios).split(',') : null;
const SIZES = String(args.sizes ?? (CI ? '300' : '1000,10000')).split(',').map(Number);

const armModules = {};
for (const id of armIds) armModules[id] = (await import(`./arms/${id}.mjs`)).default;

const SCENARIOS = [...KNOWLEDGE, ...COORDINATION, ...EXEC_GATE].filter((s) => !scenarioIds || scenarioIds.includes(s.id));
const runId = `${Date.now()}`;
fs.mkdirSync(OUT, { recursive: true });

function applies(s, Arm) {
  const kinds = Arm.meta.kind;
  if (s.only && !s.only.includes(Arm.meta.id)) return false;
  return s.kinds.some((k) => kinds.includes(k));
}
function mkctx(Arm, s, seed, variant, extra = {}) {
  const home = tmpdir(`${s.id}-${Arm.meta.id.replace(/[^a-z0-9]/gi, '')}-${seed}`);
  return { home, repo: path.join(home, 'repo'), seed, variant, actor: 'agent-a', ci: CI, sharedKey: Arm.meta.shareRuntime ? `${s.id}:${variant ?? ''}:${runId}` : null, ...(s.ctxExtra?.[variant] ?? {}), ...extra };
}

async function runOne(Arm, s, seed, variant) {
  const t0 = performance.now();
  let arm, armB, ctx, ctxB;
  try {
    if (s.twoRepos) {
      ctx = mkctx(Arm, s, seed, variant, { sharedKey: Arm.meta.shareRuntime ? `${s.id}:${seed}:${runId}` : null });
      ctxB = { ...ctx, repo: path.join(ctx.home, 'repo-b'), actor: 'agent-b' };
      if (Arm.meta.id === 'basic-memory') { ctx.bmDefault = true; ctxB.bmDefault = true; ctxB.bmSkipCreate = true; }
      if (Arm.meta.id === 'server-memory') { ctx.memoryFile = ctxB.memoryFile = path.join(ctx.home, 'shared-memory.jsonl'); }
      gitInit(ctx.repo); gitInit(ctxB.repo);
      arm = new Arm(ctx); await arm.setup();
      if (Arm.meta.singleServer) ctxB.shareWith = arm;
      armB = new Arm(ctxB); await armB.setup();
      const r = await s.run(arm, ctx, { armB, ctxB });
      return { ...r, ms_total: Math.round(performance.now() - t0) };
    }
    ctx = mkctx(Arm, s, seed, variant);
    gitInit(ctx.repo);
    arm = new Arm(ctx); await arm.setup();
    const r = await s.run(arm, ctx);
    return { ...r, ms_total: Math.round(performance.now() - t0) };
  } catch (e) {
    return { grade: 'error', reason: String(e?.message ?? e).slice(0, 600), ms_total: Math.round(performance.now() - t0) };
  } finally {
    try { await arm?.close(); } catch {}
    try { await armB?.close(); } catch {}
    if (!args.keep && ctx) rmrf(ctx.home);
  }
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

function summarize(records) {
  const graded = records.filter((r) => [G.YES, G.PARTIAL, G.NO].includes(r.grade));
  const yes = graded.filter((r) => r.grade === G.YES).length, partial = graded.filter((r) => r.grade === G.PARTIAL).length, no = graded.filter((r) => r.grade === G.NO).length;
  const na = records.filter((r) => r.grade === G.NA).length, err = records.filter((r) => r.grade === 'error').length;
  const byKey = (k) => { const xs = records.map((r) => r.bytes?.[k]).filter((x) => x != null); return xs.length ? { mean: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length), max: Math.max(...xs), tokens_mean: tokens(Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)) } : null; };
  const bytesKeys = [...new Set(records.flatMap((r) => Object.keys(r.bytes ?? {})))];
  const msKeys = [...new Set(records.flatMap((r) => Object.keys(r.ms ?? {})))];
  const flagKeys = [...new Set(records.flatMap((r) => Object.keys(r.flags ?? {})))].filter((k) => records.some((r) => typeof r.flags?.[k] === 'boolean'));
  const majority = (xs) => { const c = {}; for (const x of xs) c[x] = (c[x] ?? 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null; };
  return {
    n: graded.length, yes, partial, no, na, errors: err,
    yes_rate: rate(yes, graded.length),
    at_least_partial_rate: rate(yes + partial, graded.length),
    score: graded.length ? graded.reduce((a, r) => a + gradeScore(r.grade), 0) / graded.length : null,
    verdict: graded.length ? (yes === graded.length ? G.YES : no === graded.length ? G.NO : yes + partial === graded.length && partial === graded.length ? G.PARTIAL : 'mixed') : (na ? G.NA : err ? 'error' : null),
    reason: majority(records.map((r) => r.reason).filter(Boolean)),
    delivery: majority(records.map((r) => r.delivery).filter(Boolean)),
    bytes: Object.fromEntries(bytesKeys.map((k) => [k, byKey(k)])),
    latency_ms: Object.fromEntries(msKeys.map((k) => [k, latency(records.map((r) => r.ms?.[k]).filter((x) => x != null))])),
    flags: Object.fromEntries(flagKeys.map((k) => [k, rate(records.filter((r) => r.flags?.[k] === true).length, records.filter((r) => typeof r.flags?.[k] === 'boolean').length)])),
    error_samples: records.filter((r) => r.grade === 'error').slice(0, 2).map((r) => r.reason),
  };
}

// --- meta: versions, tool catalogs, setup steps --------------------------------
async function armMeta() {
  const meta = {};
  for (const [id, Arm] of Object.entries(armModules)) {
    const m = { ...Arm.meta };
    if (Arm.prototype.listTools) {
      try { const t = await Arm.listToolsOnce(); if (t) m.tools_list = { tools: t.names.length, bytes: t.bytes, tokens: tokens(t.bytes), names: t.names }; }
      catch (e) { m.tools_list = { error: String(e.message).slice(0, 300) }; }
    }
    meta[id] = m;
  }
  return meta;
}

const startedAt = new Date().toISOString();
const t0 = performance.now();
const meta = {
  bench: 'agent-memory-bench Track A', version: '0.1.0', started_at: startedAt, ci: CI, seeds: SEEDS, sizes: SIZES,
  host: { platform: `${os.platform()} ${os.release()}`, node: process.version, cpus: os.cpus().length, mem_gb: Math.round(os.totalmem() / 2 ** 30) },
  git: sh('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).stdout.trim() || null,
  token_estimate: 'ceil(bytes/4); same proxy for every arm',
};
meta.arms = await armMeta();
console.error(`[track-a] arms: ${Object.keys(armModules).join(', ')} | seeds ${SEEDS} | out ${OUT}`);

const summary = { meta: { started_at: startedAt, seeds: SEEDS, ci: CI }, cells: {} };
// --merge: re-run a slice and fold it into an existing results dir (other cells kept as they were).
const prev = args.merge && fs.existsSync(path.join(OUT, 'summary.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'summary.json'), 'utf8')) : null;
if (prev) { summary.cells = prev.cells; if (prev.scale) summary.scale = prev.scale; if (prev.planning) summary.planning = prev.planning; summary.meta.merged_at = startedAt; }
for (const s of SCENARIOS) {
  const variants = s.variants ?? [null];
  const cellRecords = {};
  for (const [id, Arm] of Object.entries(armModules)) {
    if (!applies(s, Arm)) continue;
    for (const variant of variants) {
      const key = `${s.id}${variant ?? ''}|${id}`;
      if (CI && Arm.meta.slow?.[s.id]) { summary.cells[key] = { scenario: `${s.id}${variant ?? ''}`, title: s.title, arm: id, verdict: 'skipped', reason: 'slow cell (real-time lease wait) skipped in CI subset', n: 0 }; continue; }
      const seeds = Array.from({ length: (CI && s.id === 'S13') ? 1 : Arm.meta.reps?.[`${s.id}${variant ?? ''}`] ?? Arm.meta.reps?.[s.id] ?? s.seeds ?? SEEDS }, (_, i) => i + 1);
      const jobs = Arm.meta.serial ? 1 : JOBS;
      const t1 = performance.now();
      const recs = await pool(seeds, jobs, (seed) => runOne(Arm, s, seed, variant).then((r) => ({ seed, variant, ...r })));
      if (Arm.meta.shareRuntime && Arm.closeShared) await Arm.closeShared(`${s.id}:${variant ?? ''}:${runId}`);
      cellRecords[key] = recs;
      const sm = summarize(recs);
      summary.cells[key] = { scenario: `${s.id}${variant ?? ''}`, title: s.title, arm: id, ...sm, wall_ms: Math.round(performance.now() - t1) };
      console.error(`[track-a] ${key.padEnd(34)} ${String(sm.verdict).padEnd(8)} y/p/n/na/err=${sm.yes}/${sm.partial}/${sm.no}/${sm.na}/${sm.errors}  ${Math.round(performance.now() - t1)}ms${sm.errors ? '  ' + sm.error_samples[0]?.slice(0, 160) : ''}`);
    }
  }
  const prevFile = path.join(OUT, `${s.id}.json`);
  const merged = args.merge && fs.existsSync(prevFile) ? { ...JSON.parse(fs.readFileSync(prevFile, 'utf8')).records, ...cellRecords } : cellRecords;
  fs.writeFileSync(prevFile, JSON.stringify({ scenario: s.id, title: s.title, records: merged }, null, 1));
}

// S12 retrieval at scale
if (!scenarioIds || scenarioIds.includes('S12')) {
  const out = { ...(summary.scale ?? {}) };
  for (const [id, Arm] of Object.entries(armModules)) {
    if (!S12.arms.includes(id)) continue;
    for (const size of SIZES) {
      if (Arm.meta.maxScale && size > Arm.meta.maxScale && !args['force-scale']) { out[`${id}|${size}`] = { arm: id, size, skipped: `not run above ${Arm.meta.maxScale} docs by default (ingest ~0.23 s/doc here; use --force-scale)` }; console.error(`[track-a] S12|${id}|${size} skipped`); continue; }
      const t1 = performance.now();
      let r;
      try { r = await S12.run(Arm, { size, queries: CI ? 10 : 20, seed: 42 }); } catch (e) { r = { error: String(e.message).slice(0, 500) }; }
      out[`${id}|${size}`] = { arm: id, size, ...r, wall_ms: Math.round(performance.now() - t1) };
      console.error(`[track-a] S12|${id}|${size} ${r.error ? 'ERROR ' + r.error.slice(0, 200) : `hit@5 ${r.hits}/${r.n} p50 ${r.latency_ms?.p50?.toFixed?.(1)}ms bytes ${r.bytes_mean} ingest ${Math.round(r.ingest_ms)}ms`}`);
    }
  }
  summary.scale = out;
  fs.writeFileSync(path.join(OUT, 'S12.json'), JSON.stringify(out, null, 1));
}

// S14 planning cost: deterministic call/byte counts per authoring path; 3 repetitions (wall-ms variance).
if (!scenarioIds || scenarioIds.includes('S14')) {
  const ids = Object.keys(armModules).filter((id) => S14.arms.includes(id));
  if (ids.length) {
    const t1 = performance.now();
    const r = await S14.run(ids, { seeds: S14.seeds, log: (l) => console.error(l) });
    const rows = { ...(summary.planning?.rows ?? {}), ...r.rows };
    summary.planning = { title: S14.title, seeds: S14.seeds, plan: r.plan, rows, not_run: r.not_run, documented: r.documented, wall_ms: Math.round(performance.now() - t1) };
    const prevFile = path.join(OUT, 'S14.json');
    const prevRecs = args.merge && fs.existsSync(prevFile) ? JSON.parse(fs.readFileSync(prevFile, 'utf8')).records : {};
    fs.writeFileSync(prevFile, JSON.stringify({ scenario: 'S14', title: S14.title, plan: r.plan, records: { ...prevRecs, ...r.records } }, null, 1));
  }
}

if (args.merge && fs.existsSync(path.join(OUT, 'meta.json'))) { const pm = JSON.parse(fs.readFileSync(path.join(OUT, 'meta.json'), 'utf8')); meta.arms = { ...pm.arms, ...meta.arms }; meta.started_at = pm.started_at; meta.seeds = pm.seeds; meta.sizes = pm.sizes; meta.merges = [...(pm.merges ?? []), { at: startedAt, arms: Object.keys(armModules), scenarios: scenarioIds }]; meta.wall_s_initial = pm.wall_s_initial ?? pm.wall_s; }
meta.finished_at = new Date().toISOString();
meta.wall_s = Math.round((performance.now() - t0) / 1000);
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
await writeReport(OUT, meta, summary);
console.error(`[track-a] done in ${meta.wall_s}s → ${OUT}`);
// A leftover child (e.g. a shared basic-memory server) can keep the event loop alive after "done".
process.exit(0);
