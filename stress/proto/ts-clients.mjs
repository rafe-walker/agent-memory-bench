// Drive both servers with the official TypeScript SDK clients: v1 (@modelcontextprotocol/sdk 1.x —
// older Cursor builds) and v2 (@modelcontextprotocol/client 2.x), over stdio and Streamable HTTP,
// in both eras. Every tool once (tour.mjs); the SDK's own outputSchema validation is in the loop.
// Usage: node ts-clients.mjs [kl|sl|both]
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { BIN, PKG, tmp, httpServer, serverEnv, check, summary } from './common.mjs';
import { tour } from './tour.mjs';
const require = createRequire(PKG + '/');
const v1c = await import(require.resolve('@modelcontextprotocol/sdk/client/index.js'));
const v1stdio = await import(require.resolve('@modelcontextprotocol/sdk/client/stdio.js'));
const v1http = await import(require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js'));
const v2 = await import(require.resolve('@modelcontextprotocol/client'));
const v2stdio = await import(require.resolve('@modelcontextprotocol/client/stdio'));
const which = process.argv[2] ?? 'both';
const servers = which === 'both' ? ['kl', 'sl'] : [which];

async function run(label, srv, client, connect) {
  try {
    await connect();
  } catch (e) { check(`${label}: connect`, false, e.message); return; }
  const era = typeof client.getProtocolEra === 'function' ? client.getProtocolEra() : 'v1';
  const pv = typeof client.getNegotiatedProtocolVersion === 'function' ? client.getNegotiatedProtocolVersion() : (client.transport?.protocolVersion ?? '');
  check(`${label}: connected (${era} ${pv ?? ''})`, true);
  const { tools } = await client.listTools();
  check(`${label}: listTools`, tools.length >= 10, String(tools.length));
  const errors = [];
  const done = await tour(srv, async (name, args) => {
    try {
      const r = await client.callTool({ name, arguments: args });
      return { sc: r.structuredContent, isError: !!r.isError, text: r.content?.[0]?.text };
    } catch (e) { errors.push(`${name}: ${e.message.slice(0, 200)}`); return { isError: true, sc: {} }; }
  });
  check(`${label}: every tool callable through the SDK (incl. its outputSchema validation)`, errors.length === 0, errors.join(' | '));
  const te = done.filter(([, s]) => s !== 'ok').map(([n]) => n);
  check(`${label}: tour has no tool errors`, te.length === 0, te.join(','));
  const tpl = await client.listResourceTemplates().catch((e) => ({ err: e.message }));
  check(`${label}: listResourceTemplates`, tpl.resourceTemplates?.length >= 1, tpl.err ?? '');
  const uri = srv === 'kl' ? 'kronicle://docs/tour' : null;
  if (uri) { const rr = await client.readResource({ uri }).catch((e) => ({ err: e.message })); check(`${label}: readResource ${uri}`, !!rr.contents?.[0]?.text, rr.err ?? ''); }
  await client.close().catch(() => {});
}

for (const srv of servers) {
  const extra = srv === 'sl' ? ['--actor', 'tsclient', '--session', 'ts'] : [];
  // ── stdio ──
  for (const [name, mk] of [
    ['v1 stdio', (t) => { const c = new v1c.Client({ name: 'v1', version: '1' }); return [c, () => c.connect(new v1stdio.StdioClientTransport({ command: BIN[srv], args: ['serve', '--data-dir', join(t.dir, 'data'), ...extra], env: serverEnv(t.dir), stderr: 'ignore' }))]; }],
    ['v2 stdio default', (t) => { const c = new v2.Client({ name: 'v2', version: '2' }); return [c, () => c.connect(new v2stdio.StdioClientTransport({ command: BIN[srv], args: ['serve', '--data-dir', join(t.dir, 'data'), ...extra], env: serverEnv(t.dir), stderr: 'ignore' }))]; }],
    ['v2 stdio mode:auto (probe)', (t) => { const c = new v2.Client({ name: 'v2a', version: '2' }, { versionNegotiation: { mode: 'auto' } }); return [c, () => c.connect(new v2stdio.StdioClientTransport({ command: BIN[srv], args: ['serve', '--data-dir', join(t.dir, 'data'), ...extra], env: serverEnv(t.dir), stderr: 'ignore' }))]; }],
    ['v2 stdio modern-pinned', (t) => { const c = new v2.Client({ name: 'v2m', version: '2' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } }); return [c, () => c.connect(new v2stdio.StdioClientTransport({ command: BIN[srv], args: ['serve', '--data-dir', join(t.dir, 'data'), ...extra], env: serverEnv(t.dir), stderr: 'ignore' }))]; }],
    ['v2 stdio legacy-pinned', (t) => { const c = new v2.Client({ name: 'v2l', version: '2' }, { supportedProtocolVersions: ['2025-06-18'] }); return [c, () => c.connect(new v2stdio.StdioClientTransport({ command: BIN[srv], args: ['serve', '--data-dir', join(t.dir, 'data'), ...extra], env: serverEnv(t.dir), stderr: 'ignore' }))]; }],
  ]) {
    const t = tmp('proto-ts-');
    const [c, conn] = mk(t);
    await run(`[${srv} ${name}]`, srv, c, conn);
    t.rm();
  }
  // ── HTTP ──
  const h = await httpServer(srv, srv === 'sl' ? ['--actor', 'tsclient'] : []);
  const headers = { Authorization: `Bearer ${h.token}` };
  for (const [name, mk] of [
    ['v1 http', () => { const c = new v1c.Client({ name: 'v1', version: '1' }); return [c, () => c.connect(new v1http.StreamableHTTPClientTransport(new URL(h.url), { requestInit: { headers } }))]; }],
    ['v2 http default', () => { const c = new v2.Client({ name: 'v2', version: '2' }); return [c, () => c.connect(new v2.StreamableHTTPClientTransport(new URL(h.url), { requestInit: { headers } }))]; }],
    ['v2 http mode:auto (probe)', () => { const c = new v2.Client({ name: 'v2a', version: '2' }, { versionNegotiation: { mode: 'auto' } }); return [c, () => c.connect(new v2.StreamableHTTPClientTransport(new URL(h.url), { requestInit: { headers } }))]; }],
    ['v2 http modern-pinned', () => { const c = new v2.Client({ name: 'v2m', version: '2' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } }); return [c, () => c.connect(new v2.StreamableHTTPClientTransport(new URL(h.url), { requestInit: { headers } }))]; }],
    ['v2 http legacy-pinned', () => { const c = new v2.Client({ name: 'v2l', version: '2' }, { supportedProtocolVersions: ['2025-06-18'] }); return [c, () => c.connect(new v2.StreamableHTTPClientTransport(new URL(h.url), { requestInit: { headers } }))]; }],
  ]) {
    const [c, conn] = mk();
    await run(`[${srv} ${name}]`, srv, c, conn);
  }
  // wrong bearer: the SDK must surface an auth error, not hang
  const bad = new v2.Client({ name: 'bad', version: '0' });
  const t0 = Date.now();
  const e = await bad.connect(new v2.StreamableHTTPClientTransport(new URL(h.url), { requestInit: { headers: { Authorization: 'Bearer wrong-wrong-wrong-wrong' } } })).then(() => null, (x) => x);
  check(`[${srv} v2 http wrong bearer] fails fast`, !!e && Date.now() - t0 < 10000, `${e?.message?.slice(0, 120)} in ${Date.now() - t0} ms`);
  await h.close();
}
process.exit(summary() ? 1 : 0);
