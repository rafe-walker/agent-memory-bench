#!/usr/bin/env node
// sea_apply / templates / idempotency adversarial checks over MCP stdio.
// usage: SLBIN=<sea-lite>/dist/cli.js node stress/sl/apply.mjs [--only NAME]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Mcp } from '../lib/mcp.mjs';

const SLBIN = process.env.SLBIN;
const W = mkdtempSync(join(tmpdir(), 'sla-'));
const repo = join(W, 'repo');
execFileSync('git', ['init', '-q', repo]);
const env = { KRONICLE_LITE_DATA_DIR: join(W, 'data') };
const srv = (actor, session) => new Mcp('node', [SLBIN, 'serve', '--actor', actor, '--session', session], { cwd: repo, env, timeoutMs: 120000 });
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const results = [];
const rec = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 400)}`); };
const short = (r) => (r.error ? { error: r.error.message?.slice(0, 200) } : r.isError ? { isError: JSON.stringify(r.result).slice(0, 300) } : r.result);
const count = async (_m, prefix = 'K ') => { const out = execFileSync('node', [SLBIN, 'list', '--all', '--json'], { cwd: repo, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 1 << 28 }); const j = JSON.parse(out); const arr = Array.isArray(j) ? j : (j.tickets ?? j.items ?? []); return arr.filter((t) => String(t.title).startsWith(prefix)).length; };

const tests = {
  async caps(m) {
    // 10 templates x 50 = 500 tickets: must be refused (cap 50) and write nothing
    const t0 = Date.now();
    const r = await m.call('sea_apply', { templates: Array.from({ length: 10 }, (_, k) => ({ for_each: 50, ref: `t${k}_{i}`, ticket: { title: `T${k} {i}` } })) });
    rec('caps: 500 expanded tickets refused', !!(r.isError || r.error), { ms: Date.now() - t0, r: short(r) });
    // 50 tickets, each with 3 links -> >100 links
    const r2 = await m.call('sea_apply', { templates: [{ for_each: 50, ref: 'l{i}', ticket: { title: 'L {i}' }, links: [{ from_ref: '{ref}', to_ref: '{prev}', link_type: 'depends_on' }, { from_ref: '{ref}', to_ref: 'l1', link_type: 'relates_to' }, { from_ref: '{ref}', to_ref: 'l2', link_type: 'references' }] }] });
    rec('caps: >100 template links refused', !!(r2.isError || r2.error), short(r2));
    // exactly at caps: 50 tickets, 100 links -> accepted
    const r3 = await m.call('sea_apply', { templates: [{ for_each: 50, ref: 'e{i}', ticket: { title: 'E {i}' }, links: [{ from_ref: '{ref}', to_ref: '{prev}', link_type: 'depends_on' }, { from_ref: '{ref}', to_ref: '{prev}', link_type: 'relates_to' }] }], tickets: [] });
    rec('caps: 50 tickets + 98 links accepted', !(r3.isError || r3.error), short(r3));
  },
  async expansionBomb(m) {
    // title size: {value} x 2000 with a 4 KB value -> 8 MB per ticket x 50
    const v = 'x'.repeat(4096);
    const t0 = Date.now();
    const rss0 = process.memoryUsage().rss;
    let r;
    try { r = await m.call('sea_apply', { dry_run: true, templates: [{ for_each: Array.from({ length: 50 }, (_, i) => v + i), ref: 'b{i}', ticket: { title: '{value}'.repeat(2000) } }] }); } catch (e) { r = { error: { message: e.message } }; }
    const ms = Date.now() - t0;
    const refused = !!(r.isError || r.error);
    rec('expansion bomb (400 MB of titles) refused quickly', refused && ms < 10000, { ms, r: short(r), rss_client_mb: Math.round((process.memoryUsage().rss - rss0) / 1e6) });
    const t1 = Date.now();
    const r2 = await m.call('sea_create', { title: 'y'.repeat(5_000_000) }).catch((e) => ({ error: { message: e.message } }));
    rec('5 MB title on sea_create refused', !!(r2.isError || r2.error), { ms: Date.now() - t1, r: short(r2) });
  },
  async placeholderInjection(m) {
    // a for_each value that itself contains placeholders must not be re-expanded
    const r = await m.call('sea_apply', { dry_run: true, templates: [{ for_each: ['{prev}', '{i}', '{ref}'], ref: 'p{i}', ticket: { title: 'T {value}' }, links: [] }] });
    const titles = JSON.stringify(r.result).match(/T \{[a-z]+\}/g);
    rec('placeholder in value stays literal', titles && titles.length === 3, { titles, r: JSON.stringify(r.result).slice(0, 300) });
    const r2 = await m.call('sea_apply', { dry_run: true, templates: [{ for_each: ['a', 'a'], ref: 'r{value}', ticket: { title: 'x' } }] });
    rec('duplicate expanded refs refused', !!(r2.isError || r2.error), short(r2));
    const r3 = await m.call('sea_apply', { dry_run: true, templates: [{ for_each: 3, ref: 'fixed', ticket: { title: 'x' } }] });
    rec('ref without {i}/{value} refused', !!(r3.isError || r3.error), short(r3));
  },
  async cycles(m) {
    const r = await m.call('sea_apply', { templates: [{ for_each: 5, ref: 'c{i}', ticket: { title: 'C {i}' }, links: [{ from_ref: '{ref}', to_ref: '{prev}', link_type: 'depends_on' }] }], links: [{ from_ref: 'c1', to_ref: 'c5', link_type: 'depends_on' }] });
    rec('template chain + closing link = cycle refused', !!(r.isError || r.error) && /cycle/i.test(JSON.stringify(r)), short(r));
    const r2 = await m.call('sea_apply', { templates: [{ for_each: 2, ref: 's{i}', ticket: { title: 'S' }, links: [{ from_ref: '{ref}', to_ref: '{ref}', link_type: 'blocks' }] }] });
    rec('self-loop via {ref} refused', !!(r2.isError || r2.error), short(r2));
    // mixed-type cycle: parent_of a->b, depends_on b->a  (different acyclic families?)
    const r3 = await m.call('sea_apply', { tickets: [{ ref: 'a', title: 'A' }, { ref: 'b', title: 'B' }], links: [{ from_ref: 'a', to_ref: 'b', link_type: 'blocks' }, { from_ref: 'b', to_ref: 'a', link_type: 'depends_on' }] });
    rec('blocks a->b + depends_on b->a (mixed-type cycle)', !!(r3.isError || r3.error), short(r3));
  },
  async idempotencyRace() {
    const N = 16;
    const servers = Array.from({ length: N }, (_, i) => srv(`r${i}`, `rs${i}`));
    await Promise.all(servers.map((s) => s.init()));
    const before = await count(servers[0]);
    const payload = { idempotency_key: 'race-key-1', templates: [{ for_each: 10, ref: 'k{i}', ticket: { title: 'K {i}' }, links: [{ from_ref: '{ref}', to_ref: '{prev}', link_type: 'depends_on' }] }] };
    const rs = await Promise.all(servers.map((s) => s.call('sea_apply', payload).catch((e) => ({ error: { message: e.message } }))));
    const after = await count(servers[0]);
    const errs = rs.filter((r) => r.isError || r.error).map(short);
    const replays = rs.filter((r) => r.result?.idempotent_replay === true).length;
    const ids = new Set(rs.map((r) => JSON.stringify(r.result?.created ?? null)));
    rec(`idempotency race x${N}: one batch created`, after - before === 10 && errs.length === 0 && ids.size === 1, { created: after - before, replays, distinct_results: ids.size, errors: errs.slice(0, 3) });
    // same key, different payload
    const r2 = await servers[1].call('sea_apply', { ...payload, templates: [{ for_each: 3, ref: 'z{i}', ticket: { title: 'Different {i}' } }] });
    rec('same key + different payload is refused (not a silent replay)', !!(r2.isError || r2.error), { refs_returned: Object.keys(r2.result?.created ?? {}), replay: r2.result?.idempotent_replay, z_created: await count(null, 'Different ') });
    const r3 = await servers[2].call('sea_create', { title: 'cross-tool', idempotency_key: 'race-key-1' });
    rec('same key on a different tool is invalid_input (documented)', !!(r3.isError || r3.error), short(r3));
    await Promise.all(servers.map((s) => s.close()));
  },
};

const m = srv('a', 'sa');
await m.init();
for (const [name, fn] of Object.entries(tests)) {
  if (only && name !== only) continue;
  try { await fn(m); } catch (e) { rec(name, false, `threw: ${e.message}`); }
}
const stderrTail = m.stderr.slice(-300);
await m.close();
if (stderrTail.trim()) console.log('server stderr tail:', stderrTail);
rmSync(W, { recursive: true, force: true });
process.exit(results.some((r) => !r.ok) ? 1 : 0);
