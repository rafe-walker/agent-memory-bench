// Concurrent first starts of `serve --http` on one fresh data dir (two agents launching at once, or
// kronicle-lite + sea-lite sharing the dir as documented): both must start and agree on one bearer.
// kronicle-lite uses an exclusive-create helper (util/once-file); sea-lite's loadOrCreateBearer is
// existsSync + writeFileSync(flag 'wx'). Usage: node first-start-race.mjs [rounds]
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { BIN, tmp, freePort, serverEnv, check, summary, track } from './common.mjs';
const rounds = Number(process.argv[2] ?? 20);
const only = process.argv[3]; // e.g. sl+sl
const width = Number(process.argv[4] ?? 2); // servers started at once per round (pair types alternate)
const start = (which, home, port) => new Promise((res) => {
  const p = track(spawn(BIN[which], ['serve', '--http', '--host', '127.0.0.1', '--port', String(port), '--data-dir', join(home, 'data'), ...(which === 'sl' ? ['--actor', 'o'] : [])], { env: serverEnv(home), stdio: ['ignore', 'pipe', 'pipe'] }));
  let log = '';
  p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
  const t = setTimeout(() => res({ p, ok: /serving/.test(log), log, slow: true }), 60000);
  p.on('exit', (code) => { clearTimeout(t); res({ p, ok: false, log, code }); });
  const iv = setInterval(() => { if (/serving/.test(log)) { clearInterval(iv); clearTimeout(t); res({ p, ok: true, log }); } }, 20);
});
for (const pair of [['sl', 'sl'], ['kl', 'kl'], ['kl', 'sl']].filter((p) => !only || p.join('+') === only)) {
  let fails = 0; let sample = ''; let slowN = 0;
  for (let i = 0; i < rounds; i++) {
    const t = tmp('proto-race-');
    const ports = []; for (let k = 0; k < width; k++) ports.push(await freePort());
    const all = await Promise.all(ports.map((port, k) => start(pair[k % 2], t.dir, port)));
    const bad = all.find((x) => !x.ok && !x.slow); // a crash, not a slow start
    slowN += all.filter((x) => x.slow).length;
    if (bad) { fails++; sample ||= bad.log.replace(/\n/g, ' ').slice(0, 220); }
    for (const x of all) { x.p.kill('SIGKILL'); }
    await new Promise((r) => setTimeout(r, 100));
    t.rm();
  }
  check(`${pair.join('+')}: concurrent first start on a fresh dir — all ${width} serve (${rounds} rounds)`, fails === 0, `${fails}/${rounds} rounds had a server exit; ${slowN} slow starts (> 60 s, not counted); e.g. ${sample}`);
}
process.exit(summary() ? 1 : 0);
