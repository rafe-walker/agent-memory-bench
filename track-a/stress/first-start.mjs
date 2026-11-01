#!/usr/bin/env node
// S3d follow-up: N kronicle-lite processes start at once on a FRESH data dir
// (identity + signing-key creation race). Counts processes that exit non-zero
// and checks every process ended up with the same signing key.
//   node track-a/stress/first-start.mjs --cli <dist/cli.js> [--n 50] [--trials 5] [--json]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const a = Object.fromEntries(process.argv.slice(2).reduce((acc, x, i, arr) => { if (x.startsWith('--')) acc.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return acc; }, []));
const CLI = path.resolve(a.cli ?? '');
const N = +(a.n ?? 50), TRIALS = +(a.trials ?? 5);
if (!fs.existsSync(CLI)) { console.error('usage: --cli <kronicle-lite dist/cli.js>'); process.exit(2); }

// Default: a barrier worker (imports the package, all processes open the store
// at the same instant), the tightest race. --cli-mode: plain `kronicle-lite keys`.
const INDEX = path.join(path.dirname(CLI), 'index.js');
const WORKER = path.join(path.dirname(new URL(import.meta.url).pathname), 'first-start-worker.mjs');
function run(dataDir, goAt) {
  return new Promise((resolve) => {
    const argv = a['cli-mode'] ? [CLI, 'keys', '--data-dir', dataDir] : [WORKER, new URL(`file://${INDEX}`).href, dataDir, String(goAt)];
    const c = spawn(process.execPath, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (err += d));
    c.on('close', (code) => resolve({ code, out, err }));
  });
}

const trials = [];
for (let t = 0; t < TRIALS; t++) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-first-start-'));
  const dataDir = path.join(base, 'nested', 'data'); // not created: concurrent mkdir too
  const goAt = Date.now() + 1500 + N * 40;
  const rs = await Promise.all(Array.from({ length: N }, () => run(dataDir, goAt)));
  const crashed = rs.filter((r) => r.code !== 0);
  const keys = new Set(rs.filter((r) => r.code === 0).map((r) => (r.out.match(/ed25519-[0-9a-f]{16}/) ?? [''])[0]));
  trials.push({ n: N, crashed: crashed.length, distinct_keys: keys.size, sample_error: crashed[0]?.err.trim().split('\n').slice(-3).join(' | ') ?? null });
  fs.rmSync(base, { recursive: true, force: true });
}
const total = { starts: N * TRIALS, crashed: trials.reduce((s, t) => s + t.crashed, 0), split_identity_trials: trials.filter((t) => t.distinct_keys > 1).length };
if (a.json) console.log(JSON.stringify({ cli: CLI, total, trials }, null, 2));
else { for (const t of trials) console.log(`trial: ${t.crashed}/${t.n} crashed, ${t.distinct_keys} distinct key(s)${t.sample_error ? ` — ${t.sample_error}` : ''}`); console.log(`TOTAL ${total.crashed}/${total.starts} crashed; ${total.split_identity_trials} trial(s) with more than one signing key`); }
process.exit(total.crashed === 0 && total.split_identity_trials === 0 ? 0 : 1);
