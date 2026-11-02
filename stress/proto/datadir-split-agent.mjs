// The agent side of datadir-split.sh: an MCP server (cwd = repo) with the given --data-dir; the agent
// reads a runbook, then the runbook changes (another writer): one unreconciled retraction.
import { spawn } from 'node:child_process';
const [kl, repo, dd, phase] = process.argv.slice(2);
const args = ['serve', '--actor', 'agent-a', ...(dd ? ['--data-dir', dd] : [])];
const p = spawn(kl, args, { cwd: repo, stdio: ['pipe', 'pipe', 'inherit'] });
let buf = ''; const waiters = {};
p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiters[m.id]?.(m); } });
const rpc = (id, method, params) => new Promise((res) => { waiters[id] = res; p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
await rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cursor', version: '0' } });
p.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
const call = (id, name, a) => rpc(id, 'tools/call', { name, arguments: a });
if (phase === 'read') {
  await call(2, 'put_document', { slug: 'runbook', title: 'Runbook', markdown: '# Runbook\n\n## Deploy\n\nTarget: prod-a. Push with git push.' });
  await call(3, 'get_system_state', { response_format: 'json' });
  await call(4, 'recall', { query: 'deploy target' });
  p.stdin.end(); process.exit(0);
}
await call(5, 'put_document', { slug: 'runbook', title: 'Runbook', markdown: '# Runbook\n\n## Deploy\n\nTarget: prod-b. Push with git push.', actor_id: 'teammate' });
const st = await call(6, 'get_system_state', { response_format: 'json', focus: 'pulse' });
p.stdin.end();
const sc = st.result?.structuredContent ?? {};
process.stderr.write(`  [agent] server data dir ${dd || '(default)'}; pending/retractions seen by the server: ${JSON.stringify(sc.pulse ?? sc.retractions?.length ?? Object.keys(sc)).slice(0, 120)}\n`);
