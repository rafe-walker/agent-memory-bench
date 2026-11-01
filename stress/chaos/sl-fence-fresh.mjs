#!/usr/bin/env node
// A claim must fence writes until its expires_at. K holders each take a short lease with sea_next and
// immediately write with the token while P pollers hammer sea_next / sea_claim on the same queue.
// Reports every write refused BEFORE the granted expires_at, with the event that cleared the claim.
// usage: node sl-fence-fresh.mjs SLCLI KLCLI [K=4] [P=4] [ROUNDS=10] [LEASE=2]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Mcp } from '../lib/mcp.mjs';
const [SL, KL, Ks, Ps, Rs, Ls] = process.argv.slice(2);
const K = Number(Ks ?? 4), P = Number(Ps ?? 4), ROUNDS = Number(Rs ?? 10), LEASE = Number(Ls ?? 2);
const W = mkdtempSync(join(tmpdir(), 'slff-')); const D = join(W, 'data'); const repo = join(W, 'repo'); mkdirSync(repo);
execFileSync('git', ['init', '-q'], { cwd: repo });
const env = { HOME: join(W, 'home') }; mkdirSync(env.HOME);
const spawn = (a) => new Mcp('node', [SL, 'serve', '--data-dir', D, '--actor', a, '--session', `s-${a}`], { env, cwd: repo, timeoutMs: 120000 });
const holders = Array.from({ length: K }, (_, i) => spawn(`h${i}`)); const pollers = Array.from({ length: P }, (_, i) => spawn(`p${i}`));
for (const m of [...holders, ...pollers]) await m.init();
for (let i = 0; i < K * ROUNDS + 5; i++) await holders[0].call('sea_create', { title: `t${i}`, status: 'triaged' });
let stop = false; const bad = []; let writes = 0, refused = 0;
const poll = async (m) => { while (!stop) { const r = await m.call('sea_next', { lease_seconds: 30, include_unassigned: true }); if (r.result?.claim_token) await m.call('sea_release', { ticket_id: r.result.ticket.id, claim_token: r.result.claim_token }); } };
const hold = async (m, name) => {
  for (let r = 0; r < ROUNDS; r++) {
    const n = await m.call('sea_next', { lease_seconds: LEASE, include_unassigned: true });
    if (!n.result?.claim_token) continue;
    const exp = n.result.expires_at ?? n.result.ticket?.claim?.expires_at; const sent = Date.now();
    const u = await m.call('sea_update', { ticket_id: n.result.ticket.id, claim_token: n.result.claim_token, note: 'x' });
    writes++;
    if (u.isError) { refused++; if (sent < Date.parse(exp) - 50) bad.push({ holder: name, ticket: n.result.ticket.id, expires_at: exp, sent_at: new Date(sent).toISOString(), err: JSON.stringify(u.result).slice(0, 200) }); }
    else await m.call('sea_release', { ticket_id: n.result.ticket.id, claim_token: n.result.claim_token });
  }
};
const ps = pollers.map(poll);
await Promise.all(holders.map((m, i) => hold(m, `h${i}`)));
stop = true; await Promise.all(ps);
for (const m of [...holders, ...pollers]) await m.close();
console.log(JSON.stringify({ K, P, ROUNDS, LEASE, writes, refused, refused_before_expiry: bad.length }));
if (bad.length) {
  const ev = execFileSync('node', [KL, 'export', '--data-dir', D], { encoding: 'utf8', maxBuffer: 1 << 28 }).trim().split('\n').slice(1).map((l) => JSON.parse(l));
  for (const b of bad.slice(0, 3)) {
    console.log('refused early:', JSON.stringify(b));
    for (const e of ev.filter((e) => e.payload?.ticket_id === b.ticket)) console.log('   ', e.seq, e.event_type, e.actor_id, e.occurred_at, JSON.stringify(e.payload).slice(0, 220));
  }
}
rmSync(W, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
