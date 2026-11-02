// sea-lite README's Cursor snippet passes `--actor cursor`; isokron-setup's clients.md says sea-lite
// must run WITHOUT --actor in Cursor because cc-anchor's scope-guard calls `sea-lite scope-check`
// without one. What does scope-check (the guard) say about the agent's own claim, and about a
// foreign claim, under each configuration?
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BIN, META, tmp, check, summary } from './common.mjs';
const out = [];
for (const [label, serverActor] of [['README Cursor (--actor cursor)', 'cursor'], ['clients.md Cursor (no --actor)', null]]) {
  const t = tmp('proto-am-');
  const repo = join(t.dir, 'repo'); mkdirSync(repo);
  spawnSync('git', ['init', '-q', repo]);
  const env = { ...process.env, HOME: t.dir }; delete env.SEA_LITE_ACTOR; delete env.SEA_LITE_SESSION; delete env.CLAUDE_CODE_SESSION_ID; delete env.KRONICLE_LITE_DATA_DIR;
  const p = spawn(BIN.sl, ['serve', ...(serverActor ? ['--actor', serverActor] : [])], { cwd: repo, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; const w = {};
  p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); w[m.id]?.(m); } });
  const rpc = (id, name, a) => new Promise((res) => { w[id] = res; p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: a, _meta: META } }) + '\n'); });
  const c = await rpc(1, 'sea_create', { title: 'mine', status: 'triaged' });
  const cl = await rpc(2, 'sea_claim', { ticket_ids: [c.result.structuredContent.ticket.id], scope: { paths: ['src/mine.ts'] } });
  const who = cl.result.structuredContent;
  // the guard, as cc-anchor's Cursor adapter runs it: no --actor, cwd = repo
  const g = spawnSync(BIN.sl, ['scope-check', '--json', 'src/mine.ts'], { cwd: repo, env, encoding: 'utf8' });
  const whoami = spawnSync(BIN.sl, ['whoami', '--json'], { cwd: repo, env, encoding: 'utf8' });
  let wj = {}; try { wj = JSON.parse(whoami.stdout); } catch {}
  check(`${label}: guard (no --actor) lets the agent edit its OWN claimed path (exit 0)`, g.status === 0, `exit ${g.status}; guard identity ${wj.actor ?? '?'}#${String(wj.session ?? '?').slice(0, 8)}; ${g.stdout.slice(0, 160).replace(/\n/g, ' ')}`);
  p.stdin.end(); await new Promise((r) => p.on('exit', r));
  t.rm();
}
process.exit(summary() ? 1 : 0);
