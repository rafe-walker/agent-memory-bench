// What real SDK clients do when a schema-valid call's response exceeds 10 MiB on stdio.
// Usage: node client-bigresp.mjs sl|kl [ts|py]
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { BIN, PKG, Raw, META, tmp, serverEnv, check, summary } from './common.mjs';
const require = createRequire(PKG + '/');
const v2 = await import(require.resolve('@modelcontextprotocol/client'));
const v2stdio = await import(require.resolve('@modelcontextprotocol/client/stdio'));
const which = process.argv[2] ?? 'sl';
const t = tmp('proto-bigc-');
let name, args;
if (which === 'sl') {
  const r = new Raw('sl', ['--actor', 'seed'], { home: t.dir, timeoutMs: 120000 });
  const body = 'b'.repeat(100_000);
  for (let b = 0; b < 3; b++) await r.rpc(b + 1, 'tools/call', { name: 'sea_apply', arguments: { tickets: Array.from({ length: 40 }, (_, i) => ({ ref: `r${i}`, title: `t${b}-${i}`, body, status: 'triaged' })) }, _meta: META }, 120000);
  await r.close();
  name = 'sea_list'; args = { view: 'full', limit: 120 };   // 120 tickets × 100 kB body (schema max) ≈ 24 MB line
} else {
  name = 'put_document'; args = { slug: 'many', title: 'many', markdown: 'p\n\n'.repeat(30000) }; // 90 kB doc, 30k blocks
}
const c = new v2.Client({ name: 'big', version: '0' });
const tr = new v2stdio.StdioClientTransport({ command: BIN[which], args: ['serve', '--data-dir', join(t.dir, 'data'), ...(which === 'sl' ? ['--actor', 'reader'] : [])], env: serverEnv(t.dir), stderr: 'ignore' });
let transportErr = null;
await c.connect(tr);
tr.onerror = ((prev) => (e) => { transportErr = e; prev?.(e); })(tr.onerror);
const t0 = Date.now();
const out = await c.callTool({ name, arguments: args }, { timeout: 300000 }).then((r) => ({ ok: true, size: JSON.stringify(r).length }), (e) => ({ ok: false, err: e.message }));
const ms = Date.now() - t0;
check(`TS v2 stdio client: ${name} ${JSON.stringify(args).slice(0, 60)} returns a result`, out.ok, `${out.ok ? `${(out.size / 1048576).toFixed(1)} MiB` : out.err.slice(0, 160)} after ${ms} ms; transport error: ${transportErr?.message?.slice(0, 120) ?? 'none'}`);
const after = await c.listTools().then(() => 'alive', (e) => `dead: ${e.message.slice(0, 100)}`);
check('TS v2 stdio client: connection usable afterwards', after === 'alive', after);
await c.close().catch(() => {});
t.rm();
process.exit(summary() ? 1 : 0);
