#!/usr/bin/env node
// Idempotency keys across an upgrade: OLD sea-lite writes sea_create / sea_apply with key K, then NEW
// sees (a) the SAME request again (must replay, not error) and (b) a DIFFERENT request with K (must be
// refused, F09) — on a store whose prior events were written by OLD.
// usage: node stress/chaos/sl-idem-upgrade.mjs OLD_SL_CLI NEW_SL_CLI
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Mcp } from '../lib/mcp.mjs';
const [OLD, NEW] = process.argv.slice(2);
const W = mkdtempSync(join(tmpdir(), 'slidem-')); const repo = join(W, 'repo'); mkdirSync(join(W, 'home')); execFileSync('git', ['init', '-q', repo]);
const env = { HOME: join(W, 'home'), KRONICLE_LITE_DATA_DIR: join(W, 'data') };
const run = async (cli, calls) => { const m = new Mcp('node', [cli, 'serve', '--actor', 'a', '--session', 's'], { cwd: repo, env, timeoutMs: 60000 }); await m.init(); const out = []; for (const [t, a] of calls) out.push(await m.call(t, a)); await m.close(); return out; };
const ver = (c) => JSON.parse(execFileSync('node', ['-p', `JSON.stringify(require('${join(c, '..', '..', 'package.json')}').version)`], { encoding: 'utf8' }));
const create = (title) => ['sea_create', { title, status: 'triaged', idempotency_key: 'idem-create-1' }];
const apply = (t) => ['sea_apply', { tickets: [{ ref: 'x', title: t, status: 'triaged' }], idempotency_key: 'idem-apply-1' }];
const sum = (r) => (r.isError || r.error ? `ERROR ${JSON.stringify(r.result ?? r.error).slice(0, 140)}` : `ok replayed=${r.result?.replayed ?? '?'} id=${String(r.result?.ticket?.id ?? Object.values(r.result?.created ?? {})[0] ?? '').slice(0, 8)}`);
const [o1, o2] = await run(OLD, [create('first title'), apply('first batch')]);
console.log(`sea-lite ${ver(OLD)} -> ${ver(NEW)}`);
console.log(`[old] create K: ${sum(o1)}; apply K: ${sum(o2)}`);
const [n1, n2, n3, n4] = await run(NEW, [create('first title'), apply('first batch'), create('DIFFERENT title'), apply('DIFFERENT batch')]);
console.log(`[new] same create K (want replay):     ${sum(n1)}`);
console.log(`[new] same apply K (want replay):      ${sum(n2)}`);
console.log(`[new] different create K (want error): ${sum(n3)}`);
console.log(`[new] different apply K (want error):  ${sum(n4)}`);
rmSync(W, { recursive: true, force: true });
