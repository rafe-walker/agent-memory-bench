// Schema-valid requests whose RESPONSE line exceeds the 10 MiB stdio ReadBuffer every TS SDK client
// (v1 and v2) enforces. Measures the raw response line size over stdio.
// Usage: node big-response.mjs sl|kl
import { Raw, META, check, summary } from './common.mjs';
const which = process.argv[2] ?? 'sl';
const LIMIT = 10 * 1024 * 1024;
const r = new Raw(which, which === 'sl' ? ['--actor', 'big'] : [], { timeoutMs: 300000 });
let id = 1;
let lastLen = 0;
r.p.stdout.on('data', () => {});
const sized = async (method, params) => {
  const before = r.buf.length;
  const t0 = Date.now();
  const m = await r.rpc(id++, method, { ...params, _meta: META }, 600000);
  const len = Buffer.byteLength(JSON.stringify(m));
  return { m, len, ms: Date.now() - t0 };
};
if (which === 'sl') {
  const body = 'b'.repeat(100_000);
  for (let b = 0; b < 4; b++) {
    const { m, len } = await sized('tools/call', { name: 'sea_apply', arguments: { tickets: Array.from({ length: 50 }, (_, i) => ({ ref: `r${i}`, title: `t${b}-${i}`, body, status: 'triaged' })) } });
    if (m.result?.isError) console.log('apply err', m.result.content[0].text.slice(0, 200));
  }
  for (const [name, args] of [['sea_list', { view: 'full', limit: 200 }], ['sea_list', { view: 'compact', limit: 200 }], ['sea_history', { limit: 500 }]]) {
    const { m, len, ms } = await sized('tools/call', { name, arguments: args });
    check(`${name} ${JSON.stringify(args)} response ≤ 10 MiB (TS SDK stdio ReadBuffer)`, len <= LIMIT, `${(len / 1048576).toFixed(1)} MiB in ${ms} ms, isError=${!!m.result?.isError}`);
  }
} else {
  const n = Number(process.argv[3] ?? 200000);
  const md = 'p\n\n'.repeat(n).slice(0, 2_000_000);
  const { m, len, ms } = await sized('tools/call', { name: 'put_document', arguments: { slug: 'many', title: 'many', markdown: md } });
  check(`put_document ${n} one-line paragraphs: response ≤ 10 MiB`, len <= LIMIT, `${(len / 1048576).toFixed(1)} MiB in ${ms} ms, isError=${!!m.result?.isError} ${m.result?.isError ? m.result.content[0].text.slice(0, 200) : ''}`);
  const big = Array.from({ length: 60 }, (_, i) => `# S${i}\n\n${'word port '.repeat(20000)}`).join('\n\n');
  await sized('tools/call', { name: 'put_document', arguments: { slug: 'big', title: 'big', markdown: big.slice(0, 1_990_000) } });
  const rc = await sized('tools/call', { name: 'recall', arguments: { query: 'port', top_k: 50, max_chars: 400000, receipts: 'inline' } });
  check('recall top_k 50 max_chars 400000 inline: response ≤ 10 MiB', rc.len <= LIMIT, `${(rc.len / 1048576).toFixed(2)} MiB in ${rc.ms} ms`);
  const gs = await sized('tools/call', { name: 'get_system_state', arguments: { response_format: 'json', budget_tokens: 64000 } });
  check('get_system_state budget 64000: response ≤ 10 MiB', gs.len <= LIMIT, `${(gs.len / 1048576).toFixed(2)} MiB in ${gs.ms} ms`);
}
const alive = await r.rpc(id++, 'tools/list', { _meta: META }).then(() => true, () => false);
check('server alive', alive);
await r.close();
process.exit(summary() ? 1 : 0);
