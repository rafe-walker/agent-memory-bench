// probe: what recall / get_system_state (MCP) serve after a projection-only tamper (blocks table)
import { McpClient } from '../../track-a/lib/mcp.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const TB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KL = path.join(TB, 'node_modules', 'kronicle-lite', 'dist', 'cli.js');
const D = fs.mkdtempSync(path.join(process.env.WORK || os.tmpdir(), 'p7-'));
const repo = path.join(D, 'repo'); fs.mkdirSync(repo); execFileSync('git', ['init', '-q'], { cwd: repo });
fs.writeFileSync(path.join(D, 'v1.md'), '# RB\n\n## Steps\n1. Deploy target: `stg-a`\n2. Channel: `#x`\n');
const env = { ...process.env, HOME: D };
execFileSync('node', [KL, 'put', 'runbook', path.join(D, 'v1.md'), '--data-dir', path.join(D, 'kl')], { cwd: repo, env });
const c = new McpClient('node', [KL, 'serve', '--data-dir', path.join(D, 'kl'), '--actor', 'agent'], { cwd: repo, env });
await c.start();
const txt = (r) => r.text;
const s0 = await c.call('get_system_state', { focus: 'orientation' });
const cur = s0.json.cursor;
await c.call('recall', { query: 'deploy target' });
execFileSync('python3', ['-I', '-c', "import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute(\"update blocks set content=replace(content,'stg-a','stg-evil')\");c.commit()", path.join(D, 'kl', 'kronicle-lite.db')]);
const r = await c.call('recall', { query: 'deploy target' });
const t = txt(r);
console.log('recall serves stg-evil:', /stg-evil/.test(t), '| mentions integrity:', /integrity|mismatch|does not match/i.test(t), '| can_act:', (t.match(/can_act[^,]{0,40}/g) || []).slice(0, 2));
for (const focus of ['pulse', 'orientation', 'retractions']) {
  const s = (await c.call("get_system_state", { focus, cursor: cur })).json;
  console.log(`focus=${focus}: integrity=${JSON.stringify(s.integrity)?.slice(0, 120)} next=${JSON.stringify(s.next_steps)?.slice(0, 160)}`);
}
await c.close?.(); process.exit(0);
