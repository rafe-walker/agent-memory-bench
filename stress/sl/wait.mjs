#!/usr/bin/env node
// sea-lite `wait` branch: many waiters, cancellation, disconnect, kill -9 holder, expiry-at-timeout.
// usage: SLBIN=<sea-lite wait build>/dist/cli.js node stress/sl/wait.mjs [--only NAME]
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Mcp } from '../lib/mcp.mjs';

const SLBIN = process.env.SLBIN;
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const rec = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${JSON.stringify(detail).slice(0, 600)}`); };

function world() {
  const W = mkdtempSync(join(tmpdir(), 'slw-'));
  const repo = join(W, 'repo');
  execFileSync('git', ['init', '-q', repo]);
  const env = { ...process.env, KRONICLE_LITE_DATA_DIR: join(W, 'data') };
  const cli = (...a) => { try { return { code: 0, out: execFileSync('node', [SLBIN, ...a], { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) { return { code: e.status, out: String(e.stdout), err: String(e.stderr) }; } };
  const srv = (actor, session) => new Mcp('node', [SLBIN, 'serve', '--actor', actor, '--session', session], { cwd: repo, env: { KRONICLE_LITE_DATA_DIR: env.KRONICLE_LITE_DATA_DIR }, timeoutMs: 120000 });
  const holderOf = (id) => { const b = JSON.parse(cli('board', '--json').out); const t = b.tickets.find((x) => x.id === id); return t?.claim ? t.claim.holder_label : null; };
  const create = (title) => { const j = JSON.parse(cli('create', title, '--triaged', '--json').out); const id = j.id ?? j.ticket?.id; if (!id) throw new Error('create failed'); return id; };
  return { W, repo, env, cli, srv, holderOf, create, done: () => rmSync(W, { recursive: true, force: true }) };
}

const tests = {
  async herd() {
    const w = world();
    const T = w.create('contended');
    const H = w.srv('holder', 'h'); await H.init(); H.claimOk = (r) => { if (r.isError || r.error) throw new Error('holder claim failed: ' + JSON.stringify(r).slice(0, 200)); return r; };
    const hc = H.claimOk(await H.call('sea_claim', { ticket_ids: [T], lease_seconds: 300 }));
    const token = hc.result?.claims?.[0]?.claim_token ?? hc.result?.tokens?.[T] ?? JSON.stringify(hc.result).match(/"claim_token":"([^"]+)"/)?.[1];
    const N = 25;
    const waiters = Array.from({ length: N }, (_, i) => w.srv(`w${i}`, `ws${i}`));
    await Promise.all(waiters.map((s) => s.init()));
    const t0 = Date.now();
    const calls = waiters.map((s) => s.call('sea_claim', { ticket_ids: [T], wait_seconds: 20 }).then((r) => ({ r, at: Date.now() - t0 })));
    await sleep(3000);
    // CPU of waiting server processes: sample /proc
    const pids = waiters.map((s) => s.p.pid);
    const t1 = ticksSync(pids);
    await sleep(4000);
    const t2 = ticksSync(pids);
    await H.call('sea_release', { ticket_id: T, claim_token: token, note: 'done' });
    const rs = await Promise.all(calls);
    const winners = rs.filter((x) => !x.r.isError && !x.r.error);
    const timeouts = rs.filter((x) => JSON.stringify(x.r).includes('wait_timeout'));
    const other = rs.filter((x) => (x.r.isError || x.r.error) && !JSON.stringify(x.r).includes('wait_timeout'));
    rec('herd: one waiter wins after release, rest time out', winners.length === 1 && timeouts.length === N - 1, {
      winners: winners.length, timeouts: timeouts.length, other: other.map((x) => JSON.stringify(x.r).slice(0, 160)).slice(0, 3),
      win_latency_after_release_ms: winners[0] ? winners[0].at - 7000 : null, freed: winners[0]?.r.result?.waited?.freed,
      idle_cpu_ticks_25_waiters_4s: t2 - t1, holder_now: w.holderOf(T),
    });
    await Promise.all([H, ...waiters].map((s) => s.close()));
    w.done();
  },
  async cancel() {
    const w = world();
    const T = w.create('cancel-me');
    const H = w.srv('holder', 'h'); await H.init(); H.claimOk = (r) => { if (r.isError || r.error) throw new Error('holder claim failed: ' + JSON.stringify(r).slice(0, 200)); return r; };
    const hc = H.claimOk(await H.call('sea_claim', { ticket_ids: [T], lease_seconds: 300 }));
    const token = JSON.stringify(hc.result).match(/"claim_token":"([^"]+)"/)?.[1];
    const C = w.srv('canceller', 'c'); await C.init();
    const id = 777;
    const p = C.request('tools/call', { name: 'sea_claim', arguments: { ticket_ids: [T], wait_seconds: 60 } }, { id }).catch((e) => ({ timeout: e.message }));
    await sleep(1500);
    C.notify('notifications/cancelled', { requestId: id, reason: 'user' });
    const resp = await Promise.race([p, sleep(5000).then(() => 'no response in 5s')]);
    await H.call('sea_release', { ticket_id: T, claim_token: token, note: 'x' });
    await sleep(3000);
    const holder = w.holderOf(T);
    rec('cancel: cancelled waiter never takes the claim later', holder === null && !/validation/i.test(JSON.stringify(resp)), { holder_after_release: holder, response: JSON.stringify(resp).slice(0, 200) });
    await Promise.all([H.close(), C.close()]);
    w.done();
  },
  async disconnect() {
    const w = world();
    const T = w.create('disconnect');
    const H = w.srv('holder', 'h'); await H.init(); H.claimOk = (r) => { if (r.isError || r.error) throw new Error('holder claim failed: ' + JSON.stringify(r).slice(0, 200)); return r; };
    const hc = H.claimOk(await H.call('sea_claim', { ticket_ids: [T], lease_seconds: 300 }));
    const token = JSON.stringify(hc.result).match(/"claim_token":"([^"]+)"/)?.[1];
    const C = w.srv('gone', 'g'); await C.init();
    C.call('sea_claim', { ticket_ids: [T], wait_seconds: 60 }).catch(() => {});
    await sleep(1500);
    C.p.stdin.end(); // client went away (stdio EOF)
    const ex = await Promise.race([C.exited, sleep(5000).then(() => 'still running after 5s')]);
    await H.call('sea_release', { ticket_id: T, claim_token: token, note: 'x' });
    await sleep(3000);
    const holder = w.holderOf(T);
    rec('disconnect: server of a vanished client exits and takes no claim', holder === null && typeof ex === 'object', { server_exit: ex, holder_after_release: holder });
    C.p.kill('SIGKILL'); await H.close();
    w.done();
  },
  async killHolder() {
    const w = world();
    const T = w.create('kill-holder');
    const H = w.srv('holder', 'h'); await H.init(); H.claimOk = (r) => { if (r.isError || r.error) throw new Error('holder claim failed: ' + JSON.stringify(r).slice(0, 200)); return r; };
    H.claimOk(await H.call('sea_claim', { ticket_ids: [T], lease_seconds: 6 }));
    const Wt = w.srv('waiter', 'w'); await Wt.init();
    const t0 = Date.now();
    const p = Wt.call('sea_claim', { ticket_ids: [T], wait_seconds: 30 });
    await sleep(500);
    H.p.kill('SIGKILL');
    const r = await p;
    const ms = Date.now() - t0;
    rec('kill -9 holder: waiter gets it at lease expiry (not before, not much after)', !r.isError && ms >= 5000 && ms < 8000, { ms, freed: r.result?.waited?.freed, err: r.isError ? JSON.stringify(r.result).slice(0, 200) : null });
    await Wt.close();
    w.done();
  },
  async expiryAtTimeout() {
    // lease ends at the same moment the wait times out: either a claim (lease_expired) or a wait_timeout whose
    // named expiry is still in the future. A wait_timeout naming an already-expired lease is a wrong answer.
    let bad = 0, claimed = 0, timedOut = 0; const samples = [];
    for (let k = 0; k < 6; k++) {
      const w = world();
      const T = w.create('edge');
      const H = w.srv('holder', 'h'); await H.init(); H.claimOk = (r) => { if (r.isError || r.error) throw new Error('holder claim failed: ' + JSON.stringify(r).slice(0, 200)); return r; };
      H.claimOk(await H.call('sea_claim', { ticket_ids: [T], lease_seconds: 5 }));
      const Wt = w.srv('waiter', 'w'); await Wt.init();
      const r = await Wt.call('sea_claim', { ticket_ids: [T], wait_seconds: 5 });
      const now = Date.now();
      if (!r.isError) claimed++;
      else if (JSON.stringify(r.result).includes('wait_timeout')) {
        timedOut++;
        const exp = JSON.stringify(r.result).match(/"expires_at":"([^"]+)"/)?.[1];
        if (exp && Date.parse(exp) <= now) { bad++; samples.push({ expires_at: exp, answered_at: new Date(now).toISOString() }); }
      }
      await Promise.all([H.close(), Wt.close()]);
      w.done();
    }
    rec('expiry == timeout: never wait_timeout on an expired lease', bad === 0 && claimed + timedOut === 6, { claimed, timedOut, bad, samples });
  },
  async progress() {
    const w = world();
    const T = w.create('progress');
    const H = w.srv('holder', 'h'); await H.init(); H.claimOk = (r) => { if (r.isError || r.error) throw new Error('holder claim failed: ' + JSON.stringify(r).slice(0, 200)); return r; };
    H.claimOk(await H.call('sea_claim', { ticket_ids: [T], lease_seconds: 300 }));
    const C = w.srv('p', 'p'); await C.init();
    const r = await C.request('tools/call', { name: 'sea_claim', arguments: { ticket_ids: [T], wait_seconds: 12 }, _meta: { progressToken: 'pt1' } });
    const prog = C.notifications.filter((n) => n.method === 'notifications/progress');
    rec('progress: >=2 notifications in a 12 s wait, monotonic', prog.length >= 2 && prog.every((n, i) => i === 0 || n.params.progress > prog[i - 1].params.progress), { count: prog.length, first: prog[0]?.params, result: JSON.stringify(r.result ?? r.error).slice(0, 150) });
    await Promise.all([H.close(), C.close()]);
    w.done();
  },
};

function ticksSync(pids) {
  let a = 0;
  for (const p of pids) { try { const f = execFileSync('cat', [`/proc/${p}/stat`], { encoding: 'utf8' }).split(' '); a += Number(f[13]) + Number(f[14]); } catch {} }
  return a;
}

for (const [name, fn] of Object.entries(tests)) {
  if (only && name !== only) continue;
  try { await fn(); } catch (e) { rec(name, false, `threw: ${e.stack?.slice(0, 300)}`); }
}
process.exit(results.some((r) => !r.ok) ? 1 : 0);
