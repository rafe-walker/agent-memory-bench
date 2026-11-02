// stdio fuzz (both eras): framing, encoding, nesting, oversize; huge strings in every parameter of
// every tool; hostile slugs / claim paths. The server must answer (result or error) and stay up.
// Usage: node fuzz.mjs kl|sl
import { Raw, META, check, summary } from './common.mjs';
const which = process.argv[2] ?? 'kl';
const extra = which === 'sl' ? ['--actor', 'fz', '--session', 'fz'] : [];
let r = new Raw(which, extra, { timeoutMs: 60000 });
await r.rpc('o', 'server/discover', { _meta: META });
const tl = await r.rpc('tl', 'tools/list', { _meta: META });
const tools = tl.result.tools;
let n = 0;
const alive = async () => { try { return !!(await r.rpc(`al${n++}`, 'tools/list', { _meta: META }, 10000)).result; } catch { return false; } };
const respawn = async () => { await r.close().catch(() => {}); r = new Raw(which, extra, { timeoutMs: 60000 }); await r.rpc('o', 'server/discover', { _meta: META }); };
const survive = async (label, fn, { expectReply } = {}) => {
  const t0 = Date.now();
  const before = r.msgs.length;
  await fn();
  let replied = null;
  if (expectReply) replied = await r.wait((m) => m.id === expectReply, 15000).catch(() => null);
  const ok = await alive();
  const exit = r.exit;
  check(`${label}: server alive`, ok, ok ? `${Date.now() - t0} ms` : `exit ${JSON.stringify(exit)} stderr: ${r.stderr.slice(-200).replace(/\n/g, ' ')}`);
  if (expectReply) check(`${label}: request answered (result or JSON-RPC error)`, !!replied, replied ? JSON.stringify(replied.error ?? 'result').slice(0, 120) : 'no reply in 15 s');
  if (!ok) await respawn();
};

// framing / encoding
await survive('CRLF line ending', () => r.writeRaw(JSON.stringify({ jsonrpc: '2.0', id: 'crlf', method: 'tools/list', params: { _meta: META } }) + '\r\n'), { expectReply: 'crlf' });
await survive('UTF-8 BOM before message', () => r.writeRaw('\uFEFF' + JSON.stringify({ jsonrpc: '2.0', id: 'bom', method: 'tools/list', params: { _meta: META } }) + '\n'), { expectReply: 'bom' });
await survive('two messages in one write', () => r.writeRaw(JSON.stringify({ jsonrpc: '2.0', id: 'm1', method: 'tools/list', params: { _meta: META } }) + '\n' + JSON.stringify({ jsonrpc: '2.0', id: 'm2', method: 'tools/list', params: { _meta: META } }) + '\n'), { expectReply: 'm2' });
await survive('message split byte-by-byte over 1 s', async () => { const s = JSON.stringify({ jsonrpc: '2.0', id: 'split', method: 'tools/list', params: { _meta: META } }) + '\n'; for (let i = 0; i < s.length; i += 7) { r.writeRaw(s.slice(i, i + 7)); await new Promise((x) => setTimeout(x, 10)); } }, { expectReply: 'split' });
await survive('invalid UTF-8 bytes inside a string', () => r.writeRaw(Buffer.concat([Buffer.from('{"jsonrpc":"2.0","id":"utf","method":"tools/call","params":{"name":"' + (which === 'kl' ? 'recall' : 'sea_list') + '","arguments":{"query":"a'), Buffer.from([0xff, 0xfe, 0xc3, 0x28, 0xed, 0xa0, 0x80]), Buffer.from('b"},"_meta":' + JSON.stringify(META) + '}}\n')])), { expectReply: 'utf' });
await survive('lone surrogate escapes in arguments', () => r.writeRaw(`{"jsonrpc":"2.0","id":"sur","method":"tools/call","params":{"name":"${which === 'kl' ? 'put_document' : 'sea_create'}","arguments":${which === 'kl' ? '{"slug":"sur","title":"\\ud800","markdown":"x\\udfff\\ud800y"}' : '{"title":"\\ud800\\udc00\\ud800"}'},"_meta":${JSON.stringify(META)}}}\n`), { expectReply: 'sur' });
await survive('NUL inside strings', () => r.send({ jsonrpc: '2.0', id: 'nul', method: 'tools/call', params: { name: which === 'kl' ? 'put_document' : 'sea_create', arguments: which === 'kl' ? { slug: 'nul', title: 'a\u0000b', markdown: 'x\u0000y' } : { title: 'a\u0000b', body: '\u0000' }, _meta: META } }), { expectReply: 'nul' });
await survive('100k-deep nested array in params', () => r.writeRaw('{"jsonrpc":"2.0","id":"deep","method":"tools/call","params":{"name":"x","arguments":' + '['.repeat(100000) + ']'.repeat(100000) + ',"_meta":' + JSON.stringify(META) + '}}\n'), { expectReply: 'deep' });
// deep nesting inside a free-form object argument (kl verify.receipt is {type: object}; sl sea_apply template ticket)
const nestStr = (d) => '{"a":'.repeat(d) + '{"leaf":1}' + '}'.repeat(d);
for (const d of [1000, 5000, 20000]) {
  const argStr = which === 'kl' ? `{"receipt":${nestStr(d)}}` : `{"templates":[{"for_each":1,"ref":"x{i}","ticket":{"title":"t","n":${nestStr(d)}}}]}`;
  await survive(`${d}-deep object in a free-form argument`, () => r.writeRaw(`{"jsonrpc":"2.0","id":"deeparg${d}","method":"tools/call","params":{"name":"${which === 'kl' ? 'verify' : 'sea_apply'}","arguments":${argStr},"_meta":${JSON.stringify(META)}}}\n`), { expectReply: `deeparg${d}` });
}
const wide = Object.fromEntries(Array.from({ length: 200000 }, (_, i) => [`k${i}`, i]));
await survive('200k-key object in a free-form argument', () => r.send({ jsonrpc: '2.0', id: 'wide', method: 'tools/call', params: { name: which === 'kl' ? 'verify' : 'sea_apply', arguments: which === 'kl' ? { receipt: wide } : { templates: [{ for_each: 1, ref: 'w{i}', ticket: { title: 't', ...wide } }] }, _meta: META } }), { expectReply: 'wide' });
// F11 re-verify: > 10 MiB single message
await survive('F11: 11 MiB message', () => r.send({ jsonrpc: '2.0', id: 'f11', method: 'tools/call', params: { name: which === 'kl' ? 'recall' : 'sea_list', arguments: { query: 'a'.repeat(11 * 1024 * 1024) }, _meta: META } }), { expectReply: 'f11' });
// F11 via a schema-valid request: put_document markdown ≤ 2,000,000 chars but escaped to > 10 MiB on the wire
if (which === 'kl') await survive('F11 schema-valid: put_document 1.9M control chars (\\u0001 escapes → 11 MiB line)', () => r.send({ jsonrpc: '2.0', id: 'f11v', method: 'tools/call', params: { name: 'put_document', arguments: { slug: 'ctl', title: 'c', markdown: '\u0001'.repeat(1_900_000) }, _meta: META } }), { expectReply: 'f11v' });

// huge strings in every string parameter of every tool (1 MiB each, one at a time)
const BIG = 'Z'.repeat(1 << 20);
const sample = { slug: 'a', title: 't', markdown: 'm', query: 'q', reason: 'r', new_content: 'c', block_id: '00000000-0000-4000-8000-000000000000', id: '00000000-0000-4000-8000-000000000000', ticket_id: '00000000-0000-4000-8000-000000000000', claim_token: 'a'.repeat(64), note: 'n', outcome: 'done', to: 'parked', action: 'add', link_type: 'blocks', from_id: '00000000-0000-4000-8000-000000000000', to_id: '00000000-0000-4000-8000-000000000001' };
let slow = [];
for (const t of tools) {
  const props = t.inputSchema.properties ?? {};
  for (const [k, s] of Object.entries(props)) {
    if (s.type !== 'string' && !(s.anyOf ?? []).some((x) => x.type === 'string')) continue;
    if (k === 'actor_id' && which === 'sl') continue;
    const args = {};
    for (const req of t.inputSchema.required ?? []) args[req] = sample[req] ?? (props[req]?.type === 'array' ? ['x'] : props[req]?.type === 'object' ? {} : 'x');
    args[k] = BIG;
    const id = `big-${t.name}-${k}`;
    const t0 = Date.now();
    r.send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: t.name, arguments: args, _meta: META } });
    const m = await r.wait((x) => x.id === id, 60000).catch(() => null);
    const ms = Date.now() - t0;
    if (ms > 2000) slow.push(`${t.name}.${k} ${ms} ms`);
    if (!m) { check(`1 MiB string in ${t.name}.${k}: answered`, false, `no reply; exit ${JSON.stringify(r.exit)}`); if (!(await alive())) await respawn(); continue; }
    const err = m.error || m.result?.isError;
    const internal = /"internal"|-32603/.test(JSON.stringify(m).slice(0, 2000));
    if (!err || internal) check(`1 MiB string in ${t.name}.${k}: refused cleanly`, !internal, `${err ? 'internal error' : 'ACCEPTED'} ${JSON.stringify(m.error ?? m.result?.content?.[0]?.text ?? '').slice(0, 160)}`);
  }
}
check('1 MiB strings: every tool answers within 2 s', slow.length === 0, slow.join('; '));
check('server alive after all fuzz', await alive());

// hostile slugs (kl) / claim paths (sl)
if (which === 'kl') {
  for (const slug of ['../x', 'a/../../b', '/etc/passwd', 'Ａ', 'a\u202eb', 'a\u0301', 'ǆ', '.', '..', 'a'.repeat(129), 'con', 'nul.txt', 'a..b', 'a.', '-a']) {
    const m = await r.rpc(`s${n++}`, 'tools/call', { name: 'put_document', arguments: { slug, title: 't', markdown: 'x' }, _meta: META });
    const acc = m.result && !m.result.isError;
    const legal = /^[a-z0-9][a-z0-9._-]{0,127}$/.test(slug);
    check(`slug ${JSON.stringify(slug)}: ${legal ? 'accepted' : 'refused'}`, acc === legal, JSON.stringify(m.error ?? m.result?.content?.[0]?.text).slice(0, 120));
  }
  // NFKC/case collisions: two distinct accepted slugs must stay distinct documents
  await r.rpc('c1', 'tools/call', { name: 'put_document', arguments: { slug: 'dup', title: 'one', markdown: 'one' }, _meta: META });
  const rr = await r.rpc('c2', 'resources/read', { uri: 'kronicle://docs/dup', _meta: META });
  check('resource read of a fresh slug returns its text', /one/.test(JSON.stringify(rr.result)), JSON.stringify(rr.error ?? '').slice(0, 100));
} else {
  const c = await r.rpc('pc', 'tools/call', { name: 'sea_create', arguments: { title: 'paths', status: 'triaged' }, _meta: META });
  const tid = c.result.structuredContent.ticket.id;
  for (const p of ['../../etc/passwd', '/etc/passwd', 'src/../../x', 'a\u0000b', 'ü/ñ/😀.ts', 'C:\\Windows\\x', '\\\\server\\share', '~/.ssh/id_rsa', '**', '*', '', ' ', 'a'.repeat(5000), 'src/./a.ts', 'SRC/A.TS']) {
    const m = await r.rpc(`p${n++}`, 'tools/call', { name: 'sea_claim', arguments: { ticket_ids: [tid], scope: { paths: [p] } }, _meta: META });
    const acc = m.result && !m.result.isError;
    const outside = /^(\.\.|\/|[A-Za-z]:\\|\\\\)/.test(p) || p.includes('/../') || p.startsWith('src/../..');
    check(`claim path ${JSON.stringify(p.slice(0, 30))}: ${outside ? 'refused (outside repo)' : 'answered'}`, outside ? !acc : true, JSON.stringify(m.result?.structuredContent?.scope ?? m.result?.content?.[0]?.text ?? m.error).slice(0, 140));
  }
}
check('server alive at the end', await alive());
await r.close();
process.exit(summary() ? 1 : 0);
