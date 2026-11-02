#!/usr/bin/env node
// Wait herd of HERD distinct agents against ONE `sea-lite serve --http` (per-actor tokens, stateless):
// a holder claims T, HERD waiters call sea_claim(T, wait_seconds) at once, the holder releases after
// 6 s. Want exactly one winner, the rest wait_timeout, a winner shortly after release, and an idle
// server while they wait. (One server process instead of HERD stdio servers: 50 × 90 MB would not fit.)
// usage: SLBIN=<sl>/dist/cli.js node stress/chaos/sl-herd-http.mjs [HERD=50] [PORT=47533]
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const SL = process.env.SLBIN; const HERD = Number(process.argv[2] ?? 50); const PORT = Number(process.argv[3] ?? 47533);
const W = mkdtempSync(join(tmpdir(), 'slherd-')); const repo = join(W, 'repo'); mkdirSync(join(W, 'home')); execFileSync('git', ['init', '-q', repo]);
const env = { ...process.env, HOME: join(W, 'home'), KRONICLE_LITE_DATA_DIR: join(W, 'data') };
const cli = (...a) => execFileSync('node', [SL, ...a], { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const T = JSON.parse(cli('create', 'contended', '--triaged', '--json')).ticket.id;
const toks = {}; for (const a of ['holder', ...Array.from({ length: HERD }, (_, i) => `w${i}`)]) toks[a] = cli('add-token', '--actor', a).trim();
const srv = spawn('node', [SL, 'serve', '--http', '--port', String(PORT)], { cwd: repo, env, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 3000));
const call = async (actor, name, args) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${toks[actor]}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }), signal: AbortSignal.timeout(120000) });
  const txt = await r.text(); const line = txt.split('\n').find((l) => l.startsWith('data: ')); const msg = JSON.parse(line ? line.slice(6) : txt);
  const c = msg.result?.content?.[0]?.text; let body; try { body = JSON.parse(c); } catch { body = c ?? msg.error; }
  return { isError: !!(msg.error || msg.result?.isError), body };
};
const ticks = () => { try { const f = readFileSync(`/proc/${srv.pid}/stat`, 'utf8').split(') ')[1].split(' '); return Number(f[11]) + Number(f[12]); } catch { return -1; } };
const h = await call('holder', 'sea_claim', { ticket_ids: [T], lease_seconds: 300 });
const tok = JSON.stringify(h.body).match(/"claim_token":"([^"]+)"/)?.[1];
const t0 = Date.now();
const calls = Array.from({ length: HERD }, (_, i) => call(`w${i}`, 'sea_claim', { ticket_ids: [T], wait_seconds: 30 }).then((r) => ({ r, at: Date.now() - t0, a: `w${i}` })).catch((e) => ({ r: { isError: true, body: String(e) }, at: Date.now() - t0 })));
await new Promise((r) => setTimeout(r, 2000)); const k1 = ticks(); await new Promise((r) => setTimeout(r, 4000)); const k2 = ticks();
const rel = Date.now() - t0; const rr = await call('holder', 'sea_release', { ticket_id: T, claim_token: tok });
const rs = await Promise.all(calls);
const win = rs.filter((x) => !x.r.isError); const to = rs.filter((x) => JSON.stringify(x.r.body).includes('wait_timeout'));
const other = rs.filter((x) => x.r.isError && !JSON.stringify(x.r.body).includes('wait_timeout'));
const ev = execFileSync('node', [join(SL, '..', '..', '..', 'kronicle-lite', 'dist', 'cli.js'), 'export', '--data-dir', env.KRONICLE_LITE_DATA_DIR], { encoding: 'utf8', maxBuffer: 1 << 28 }).trim().split('\n').slice(1).map((l) => JSON.parse(l));
console.log(JSON.stringify({ herd: HERD, holder_release_ok: !rr.isError, winners: win.map((x) => x.a), timeouts: to.length, other: other.map((x) => JSON.stringify(x.r.body).slice(0, 160)).slice(0, 3), win_after_release_ms: win[0] ? win[0].at - rel : null, last_timeout_at_ms: Math.max(...to.map((x) => x.at)), server_cpu_ticks_4s_waiting: k2 - k1, claim_events: ev.filter((e) => e.event_type === 'sea_ticket.claimed' && e.payload.ticket_id === T).map((e) => e.payload.claim_actor) }));
srv.kill(); rmSync(W, { recursive: true, force: true });
process.exit(win.length === 1 && to.length === HERD - 1 ? 0 : 1);
