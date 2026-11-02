#!/usr/bin/env node
// sea-lite at scale: TICKETS tickets (sea_apply batches of 50), then sea_next+release p50/p95, CLI
// board / scope-check (hook path) / verify / doctor latency, store size; then a wait herd of HERD
// servers on one held ticket (exactly one winner after release, the rest wait_timeout, idle CPU).
// usage: SLBIN=<sl>/dist/cli.js node stress/chaos/sl-scale.mjs [--tickets 10000] [--herd 50]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Mcp } from '../lib/mcp.mjs';
const arg = (n, d) => (process.argv.includes(n) ? Number(process.argv[process.argv.indexOf(n) + 1]) : d);
const SL = process.env.SLBIN; const NT = arg('--tickets', 10000); const HERD = arg('--herd', 50);
const W = mkdtempSync(join(tmpdir(), 'slscale-')); const repo = join(W, 'repo'); const D = join(W, 'data'); mkdirSync(join(W, 'home'));
execFileSync('git', ['init', '-q', repo]);
const env = { HOME: join(W, 'home'), KRONICLE_LITE_DATA_DIR: D, SEA_LITE_ACTOR: 'cli', SEA_LITE_SESSION: 'cli' };
const cli = (...a) => { const t = performance.now(); let code = 0, out = ''; try { out = execFileSync('node', [SL, ...a], { cwd: repo, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { code = e.status; out = String(e.stdout); } return { ms: performance.now() - t, code, out }; };
const srv = (a) => new Mcp('node', [SL, 'serve', '--actor', a, '--session', `s-${a}`], { cwd: repo, env, timeoutMs: 300000 });
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))]); };
const size = () => Math.round(readdirSync(D).filter((f) => f.startsWith('kronicle-lite.db')).reduce((a, f) => a + statSync(join(D, f)).size, 0) / 1e5) / 10;
const ticks = (pids) => pids.reduce((a, p) => { try { const f = readFileSync(`/proc/${p}/stat`, 'utf8').split(') ')[1].split(' '); return a + Number(f[11]) + Number(f[12]); } catch { return a; } }, 0);
const res = {};
const A = srv('loader'); await A.init();
let t0 = performance.now(); const applyMs = [];
for (let b = 0; b < NT / 50; b++) {
  const t = performance.now();
  const r = await A.call('sea_apply', { tickets: Array.from({ length: 50 }, (_, i) => ({ ref: `r${i}`, title: `scale ${b}.${i} ${['auth', 'db', 'ui', 'api'][i % 4]} work`, status: 'triaged', tags: [`b${b % 20}`] })) });
  if (r.isError || r.error) { res.apply_error = JSON.stringify(r.result ?? r.error).slice(0, 200); break; }
  applyMs.push(performance.now() - t);
}
res.load = { tickets: NT, s: Math.round((performance.now() - t0) / 1000), apply50_p50: pct(applyMs, 0.5), apply50_first: Math.round(applyMs[0]), apply50_last: Math.round(applyMs.at(-1)), store_mb: size() };
const nx = [];
for (let i = 0; i < 100; i++) { const t = performance.now(); const r = await A.call('sea_next', { lease_seconds: 60, scope: { paths: [`src/m${i}.ts`] } }); nx.push(performance.now() - t); if (r.result?.claim_token) await A.call('sea_release', { ticket_id: r.result.ticket.id, claim_token: r.result.claim_token }); }
res.sea_next = { p50: pct(nx, 0.5), p95: pct(nx, 0.95) };
const lt = []; for (let i = 0; i < 10; i++) { const t = performance.now(); await A.call('sea_list', { limit: 50, query: 'auth' }); lt.push(performance.now() - t); }
res.sea_list_query = { p50: pct(lt, 0.5), p95: pct(lt, 0.95) };
res.cli = { board_ms: Math.round(cli('board', '--json').ms), scope_check_ms: Math.round(cli('scope-check', '--paths', 'src/x.ts').ms), verify: (() => { const r = cli('verify', '--json'); return { ms: Math.round(r.ms), code: r.code }; })(), doctor: (() => { const r = cli('doctor', '--json'); return { ms: Math.round(r.ms), code: r.code }; })() };
// herd
const T = JSON.parse(cli('create', 'contended', '--triaged', '--json').out).ticket.id;
const hc = await A.call('sea_claim', { ticket_ids: [T], lease_seconds: 300 }); const tok = JSON.stringify(hc.result).match(/"claim_token":"([^"]+)"/)?.[1];
const ws = Array.from({ length: HERD }, (_, i) => srv(`w${i}`)); await Promise.all(ws.map((s) => s.init()));
const th = Date.now(); const calls = ws.map((s) => s.call('sea_claim', { ticket_ids: [T], wait_seconds: 40 }).then((r) => ({ r, at: Date.now() - th })));
await new Promise((r) => setTimeout(r, 5000)); const k1 = ticks(ws.map((s) => s.p.pid)); await new Promise((r) => setTimeout(r, 5000)); const k2 = ticks(ws.map((s) => s.p.pid));
const rel = Date.now() - th; await A.call('sea_release', { ticket_id: T, claim_token: tok });
const rs = await Promise.all(calls);
const win = rs.filter((x) => !x.r.isError && !x.r.error); const to = rs.filter((x) => JSON.stringify(x.r).includes('wait_timeout'));
res.herd = { waiters: HERD, winners: win.length, timeouts: to.length, other: rs.filter((x) => (x.r.isError || x.r.error) && !JSON.stringify(x.r).includes('wait_timeout')).map((x) => JSON.stringify(x.r.result ?? x.r.error).slice(0, 140)).slice(0, 3), win_after_release_ms: win[0] ? win[0].at - rel : null, idle_cpu_ticks_5s: k2 - k1 };
const ev = execFileSync('node', [join(SL, '..', '..', '..', 'kronicle-lite', 'dist', 'cli.js'), 'export', '--data-dir', D], { encoding: 'utf8', maxBuffer: 1 << 30 }).trim().split('\n').slice(1).map((l) => JSON.parse(l));
res.herd.claim_events_on_T = ev.filter((e) => e.event_type === 'sea_ticket.claimed' && e.payload.ticket_id === T).map((e) => e.payload.claim_actor);
await Promise.all([A, ...ws].map((s) => s.close()));
console.log(JSON.stringify(res, null, 1));
rmSync(W, { recursive: true, force: true });
