// sea-lite README "Team mode" runs `serve --http` first and `add-token` after it; the actors file is
// read at start (THREAT-MODEL). Does a token minted after start work without a restart?
// Also: `add-token` on a machine with no data dir yet (fresh install).
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { BIN, META, MODERN, tmp, httpServer, serverEnv, check, summary } from './common.mjs';
const t = tmp('proto-order-');
const srv = await httpServer('sl', ['--actor', 'owner'], { home: t.dir });     // README line 200
const out = execFileSync(BIN.sl, ['add-token', '--actor', 'agent-a', '--data-dir', join(t.dir, 'data')], { env: serverEnv(t.dir), encoding: 'utf8' }); // line 201
const tok = out.match(/[A-Za-z0-9_-]{43}/)?.[0];
const call = async () => (await fetch(srv.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${tok}`, 'MCP-Protocol-Version': MODERN, 'Mcp-Method': 'tools/list' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: META } }) })).status;
const s1 = await call();
check('README order (serve, then add-token): the new token works without a restart', s1 === 200, `HTTP ${s1}${s1 === 401 ? ' (actors file is read at start; README snippet does not say to restart)' : ''}`);
await srv.close();
const fresh = tmp('proto-fresh-');
const r = spawnSync(BIN.sl, ['add-token', '--actor', 'agent-a'], { env: { ...serverEnv(fresh.dir), KRONICLE_LITE_DATA_DIR: join(fresh.dir, 'never-created') }, encoding: 'utf8' });
check('add-token on a fresh machine (no data dir yet): clean result, no stack trace', r.status === 0 || !/\n\s+at /.test(r.stderr), `exit ${r.status}: ${r.stderr.split('\n')[0].slice(0, 160)}`);
fresh.rm(); t.rm();
process.exit(summary() ? 1 : 0);
