#!/usr/bin/env node
// Scale/soak: N docs (in-process puts), then (a) push-hook path latency via the CLI
// (`orient --focus retractions` with a cursor) and `--focus pulse`, (b) store size,
// (c) a long-lived MCP server doing get_system_state + recall in a loop: RSS / FD / latency drift.
// usage: KL=<kl checkout> node stress/kl/scale.mjs [--docs 10000] [--loops 1500]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Mcp } from '../lib/mcp.mjs';

const KL = process.env.KL;
const { KronicleLite } = await import(pathToFileURL(join(KL, 'dist/index.js')).href);
const arg = (n, d) => (process.argv.includes(n) ? Number(process.argv[process.argv.indexOf(n) + 1]) : d);
const N = arg('--docs', 10000), LOOPS = arg('--loops', 1500);
const dir = mkdtempSync(join(tmpdir(), 'kls-'));
const cwd = mkdtempSync(join(tmpdir(), 'klsc-'));
const cli = (...a) => { const t0 = process.hrtime.bigint(); const out = execFileSync('node', [join(KL, 'dist/cli.js'), ...a, '--data-dir', dir, '--cwd', cwd], { encoding: 'utf8', maxBuffer: 1 << 28 }); return { ms: Number(process.hrtime.bigint() - t0) / 1e6, out }; };
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

let kl = new KronicleLite({ dataDir: dir });
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  kl.docs.putDocument({ slug: `doc-${i}`, title: `Doc ${i}`, markdown: `# Doc ${i}\n\n## Deploy\n\nHost h${i}.internal port ${1000 + (i % 5000)}.\n\n## Notes\n\nOwner team-${i % 37} reviews it weekly.\n`, actor_id: 'w', project: null });
}
const putMs = Date.now() - t0;
kl.close();
const size = readdirSync(dir).filter((f) => f.startsWith('kronicle-lite.db')).reduce((a, f) => a + statSync(join(dir, f)).size, 0);
console.log(`put ${N} docs in-process: ${putMs} ms (${(putMs / N).toFixed(2)} ms/doc); store ${(size / 1e6).toFixed(1)} MB`);

const c0 = JSON.parse(cli('orient', '--actor', 'push-hook', '--json', '--focus', 'pulse', '--all-projects').out).cursor;
kl = new KronicleLite({ dataDir: dir });
for (let i = 0; i < 20; i++) kl.docs.putDocument({ slug: `doc-${i}`, title: `Doc ${i}`, markdown: `# Doc ${i}\n\n## Deploy\n\nHost h${i}.internal port ${2000 + i}.\n\n## Notes\n\nOwner team-${i % 37} reviews it weekly.\n`, actor_id: 'w', project: null });
kl.close();
const lat = { retractions: [], pulse: [] };
let nRetr = 0;
for (let k = 0; k < 7; k++) {
  const r = cli('orient', '--actor', 'push-hook', '--json', '--cursor', c0, '--focus', 'retractions', '--all-projects'); lat.retractions.push(r.ms); nRetr = JSON.parse(r.out).retractions.length;
  lat.pulse.push(cli('orient', '--actor', 'push-hook', '--json', '--focus', 'pulse', '--all-projects').ms);
}
console.log(`CLI orient --focus retractions (20 changes since cursor, ${N} docs): median ${med(lat.retractions).toFixed(0)} ms, retractions=${nRetr}; --focus pulse median ${med(lat.pulse).toFixed(0)} ms`);
const vc = cli('verify-chain'); console.log(`verify-chain (last 1000): ${vc.ms.toFixed(0)} ms`);
const vf = cli('verify-chain', '--full'); console.log(`verify-chain --full: ${vf.ms.toFixed(0)} ms`);

// soak a long-lived server
const m = new Mcp('node', [join(KL, 'dist/cli.js'), 'serve', '--data-dir', dir, '--actor', 'soak'], { cwd, timeoutMs: 120000 });
await m.init();
const fds = () => { try { return readdirSync(`/proc/${m.p.pid}/fd`).length; } catch { return -1; } };
const rss = () => { try { return Number(execFileSync('ps', ['-o', 'rss=', '-p', String(m.p.pid)], { encoding: 'utf8' }).trim()) / 1024; } catch { return -1; } };
let cursor = null;
const samples = [];
for (let i = 0; i < LOOPS; i++) {
  const ta = Date.now();
  const s = await m.call('get_system_state', { response_format: 'json', ...(cursor ? { since_cursor: cursor } : {}), all_projects: true });
  cursor = s.result?.cursor ?? cursor;
  const r = await m.call('recall', { query: `team-${i % 37} host`, top_k: 10, cursor, actor_id: 'soak', all_projects: true });
  if (r.isError || s.isError) { console.log('error at loop', i, JSON.stringify(r.result ?? s.result).slice(0, 200)); break; }
  if (i % Math.max(1, Math.floor(LOOPS / 6)) === 0 || i === LOOPS - 1) samples.push({ i, ms: Date.now() - ta, rss_mb: Math.round(rss()), fds: fds() });
}
console.log('soak samples (loop, ms per orient+recall, server RSS MB, FDs):', JSON.stringify(samples));
const after = readdirSync(dir).filter((f) => f.startsWith('kronicle-lite.db')).reduce((a, f) => a + statSync(join(dir, f)).size, 0);
console.log(`store after soak: ${(after / 1e6).toFixed(1)} MB (receipts + flight recorder rows from ${LOOPS} loops: +${((after - size) / 1e6).toFixed(1)} MB)`);
await m.close();
rmSync(dir, { recursive: true, force: true }); rmSync(cwd, { recursive: true, force: true });
