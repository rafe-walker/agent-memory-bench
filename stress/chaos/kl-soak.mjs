#!/usr/bin/env node
// Long-lived kronicle-lite MCP server soak on a pre-built store (copied into a temp dir): LOOPS x
// (get_system_state since_cursor, recall, get_system_state focus=pulse for a reading actor with
// pending items), sampling per-call latency (p50/p95 per window), RSS and FDs; plus CLI `pending`
// and `orient --focus retractions` latency at start and end, and store growth.
// usage: KL=<kl pkg dir> node stress/chaos/kl-soak.mjs --store DIR [--loops 2000] [--windows 8]
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Mcp } from '../lib/mcp.mjs';
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const KL = process.env.KL; const SRC = arg('--store'); const LOOPS = Number(arg('--loops', 2000)); const WIN = Number(arg('--windows', 8));
const dir = mkdtempSync(join(tmpdir(), 'klsoak-')); cpSync(SRC, dir, { recursive: true });
const cwd = mkdtempSync(join(tmpdir(), 'klsoakc-'));
const size = () => readdirSync(dir).filter((f) => f.startsWith('kronicle-lite.db')).reduce((a, f) => a + statSync(join(dir, f)).size, 0);
const cli = (...a) => { const t0 = performance.now(); const out = execFileSync('node', [join(KL, 'dist/cli.js'), ...a, '--data-dir', dir, '--cwd', cwd], { encoding: 'utf8', maxBuffer: 1 << 28 }); return { ms: performance.now() - t0, out }; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const size0 = size();
const p0 = cli('pending', '--actor', 'soak', '--json', '--all-projects'); const o0 = cli('orient', '--actor', 'soak-hook', '--json', '--focus', 'retractions', '--all-projects');
const m = new Mcp('node', [join(KL, 'dist/cli.js'), 'serve', '--data-dir', dir, '--actor', 'soak'], { cwd, timeoutMs: 300000 });
await m.init();
const rss = () => { try { return Math.round(Number(execFileSync('ps', ['-o', 'rss=', '-p', String(m.p.pid)], { encoding: 'utf8' }).trim()) / 1024); } catch { return -1; } };
const fds = () => { try { return readdirSync(`/proc/${m.p.pid}/fd`).length; } catch { return -1; } };
let cursor = null; const win = []; const out = []; let slow = [];
const timed = async (name, args) => { const t = performance.now(); const r = await m.call(name, args); const ms = performance.now() - t; if (ms > 5000) slow.push({ name, ms: Math.round(ms), i: win.i }); if (r.isError || r.error) throw new Error(`${name}: ${JSON.stringify(r.result ?? r.error).slice(0, 200)}`); return { r, ms }; };
const t0 = Date.now();
let first = null;
const w = { gss: [], recall: [], pulse: [] };
for (let i = 0; i < LOOPS; i++) {
  win.i = i;
  const a = await timed('get_system_state', { response_format: 'json', ...(cursor ? { since_cursor: cursor } : {}), all_projects: true });
  if (first === null) first = Math.round(a.ms);
  cursor = a.r.result?.cursor ?? cursor; w.gss.push(a.ms);
  const b = await timed('recall', { query: `team-${i % 37} host`, top_k: 10, actor_id: 'soak', all_projects: true, ...(cursor ? { cursor } : {}) }); w.recall.push(b.ms);
  const c = await timed('get_system_state', { response_format: 'json', focus: 'pulse', all_projects: true }); w.pulse.push(c.ms);
  if ((i + 1) % Math.ceil(LOOPS / WIN) === 0 || i === LOOPS - 1) {
    out.push({ loop: i + 1, gss_p50: Math.round(pct(w.gss, 0.5)), gss_p95: Math.round(pct(w.gss, 0.95)), recall_p50: Math.round(pct(w.recall, 0.5)), recall_p95: Math.round(pct(w.recall, 0.95)), pulse_p95: Math.round(pct(w.pulse, 0.95)), rss_mb: rss(), fds: fds(), pending: c.r.result?.pending_count ?? null });
    w.gss = []; w.recall = []; w.pulse = [];
  }
}
await m.close();
const p1 = cli('pending', '--actor', 'soak', '--json', '--all-projects'); const o1 = cli('orient', '--actor', 'soak-hook', '--json', '--focus', 'retractions', '--all-projects');
console.log(JSON.stringify({ store: SRC, loops: LOOPS, wall_s: Math.round((Date.now() - t0) / 1000), first_get_system_state_ms: first, store_mb_before: +(size0 / 1e6).toFixed(1), store_mb_after: +(size() / 1e6).toFixed(1),
  cli_pending_ms: [Math.round(p0.ms), Math.round(p1.ms)], cli_pending_count: [JSON.parse(p0.out).pending_count, JSON.parse(p1.out).pending_count], cli_orient_retractions_ms: [Math.round(o0.ms), Math.round(o1.ms)], slow_calls_over_5s: slow.slice(0, 10) }));
for (const o of out) console.log(JSON.stringify(o));
rmSync(dir, { recursive: true, force: true }); rmSync(cwd, { recursive: true, force: true });
