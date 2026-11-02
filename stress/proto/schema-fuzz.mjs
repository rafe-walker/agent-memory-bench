// Validate every tool's result against its own advertised outputSchema (and, for kronicle-lite,
// the full schema from kronicle://schemas/tools) across many random schema-valid inputs.
// Usage: node schema-fuzz.mjs kl|sl [--n 600] [--seed 1] [--core]
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import jsf from 'json-schema-faker';
import { createRequire } from 'node:module';
import { Raw, META, PKG } from './common.mjs';

const require = createRequire(PKG + '/');
const which = process.argv[2] ?? 'kl';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const N = Number(arg('--n', 600));
let seed = Number(arg('--seed', 1));
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
jsf.option({ random: rnd, alwaysFakeOptionals: false, optionalsProbability: 0.5, maxItems: 4, maxLength: 40, failOnInvalidTypes: false, useDefaultValue: false, fillProperties: false, ignoreMissingRefs: true });

const mkAjv = (s) => { const A = String(s?.$schema ?? '').includes('2020') ? Ajv2020 : Ajv; const a = new A({ strict: false, allErrors: true, validateFormats: true }); addFormats(a); return a; };
const r = new Raw(which, process.argv.includes('--core') ? ['--core'] : []);
let id = 1;
const call = async (name, args) => {
  try { return await r.rpc(id++, 'tools/call', { name, arguments: args, _meta: META }, 30000); }
  catch (e) { console.log('HANG/EXIT', name, JSON.stringify(args).slice(0, 500), e.message); throw e; }
};
const tl = await r.rpc(id++, 'tools/list', { _meta: META });
const tools = tl.result.tools;
let full = {};
if (which === 'kl') {
  const x = await r.rpc(id++, 'resources/read', { uri: 'kronicle://schemas/tools', _meta: META });
  full = JSON.parse(x.result.contents[0].text);
}
const validators = {};
for (const t of tools) {
  validators[t.name] = { adv: mkAjv(t.outputSchema).compile(t.outputSchema), inp: mkAjv(t.inputSchema).compile(t.inputSchema) };
  if (full[t.name]) validators[t.name].full = mkAjv(full[t.name]).compile(full[t.name]);
}

// ── pools harvested from every successful result ──
const pool = { slug: new Set(['a', 'b-doc', 'c.d']), block_id: new Set(), receipt_id: new Set(), receipt: [], cursor: new Set(), content_hash: new Set(), ticket: new Set(), pair: [], doc_id: new Set() };
const harvest = (v, key) => {
  if (Array.isArray(v)) return v.forEach((x) => harvest(x, key));
  if (v && typeof v === 'object') {
    if (key === 'receipt' && v.receipt_id) pool.receipt.push(v);
    if (typeof v.ticket_id === 'string' && typeof v.claim_token === 'string') pool.pair.push([v.ticket_id, v.claim_token]);
    for (const [k, x] of Object.entries(v)) harvest(x, k);
    return;
  }
  if (typeof v !== 'string') return;
  if (key === 'slug' || key === 'doc_slug') pool.slug.add(v);
  else if (['block_id', 'old_block_id', 'new_block_id'].includes(key)) pool.block_id.add(v);
  else if (key === 'receipt_id') pool.receipt_id.add(v);
  else if (key === 'cursor' || key === 'cursor_compact') pool.cursor.add(v);
  else if (key === 'content_hash') pool.content_hash.add(v);
  else if (key === 'doc_id') pool.doc_id.add(v);
  else if (which === 'sl' && (key === 'id' || key === 'ticket_id' || key === 'from_id' || key === 'to_id') && /^[A-Za-z0-9_-]{4,}$/.test(v)) pool.ticket.add(v);
};
const P = (s) => pick([...s]);
const substitute = (name, a) => {
  if (!a || typeof a !== 'object') return a;
  const sub = (o) => {
    if (Array.isArray(o)) return o.forEach(sub);
    if (!o || typeof o !== 'object') return;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (rnd() < 0.25) { sub(v); continue; } // keep the faker value sometimes
      if (k === 'slug' && pool.slug.size) o[k] = P(pool.slug);
      else if (k === 'block_id' && pool.block_id.size) o[k] = P(pool.block_id);
      else if (k === 'content_hash' && pool.content_hash.size) o[k] = P(pool.content_hash);
      else if (k === 'receipt_id' && pool.receipt_id.size) o[k] = P(pool.receipt_id);
      else if (k === 'receipt' && pool.receipt.length) o[k] = pick(pool.receipt);
      else if ((k === 'cursor' || k === 'since_cursor') && pool.cursor.size) o[k] = P(pool.cursor);
      else if (k === 'actor_id') o[k] = pick(['proto', 'proto', 'other-agent', 'ünï-cødé']);
      else if (k === 'push' || k === 'remote') o[k] = false; // never touch the network
      else if (which === 'sl' && (k === 'ticket_id' || k === 'id' || k === 'from_id' || k === 'to_id') && pool.ticket.size) {
        if (pool.pair.length && rnd() < 0.6) { const [t, c] = pick(pool.pair); o[k] = t; if ('claim_token' in o || rnd() < 0.7) o.claim_token = c; }
        else o[k] = P(pool.ticket);
      } else if (which === 'sl' && k === 'ticket_ids' && pool.ticket.size) o[k] = [P(pool.ticket)];
      else if (k === 'paths') o[k] = [pick(['src/a.ts', 'src/', 'docs/**', './lib/x', 'README.md'])];
      else if (k === 'lease_seconds' || k === 'claim_seconds') o[k] = 600;
      else if (k === 'wait_seconds') o[k] = 0;
      else sub(v);
    }
  };
  sub(a);
  return a;
};

// ── seed scenario ──
const seedCalls = which === 'kl'
  ? [
      ['put_document', { slug: 'alpha', title: 'Alpha', markdown: '# Alpha\n\nThe port is 8080.\n\n## Rules\n\nNever deploy on Friday.\n\n- one\n- two\n' }],
      ['put_document', { slug: 'beta', title: 'Beta', markdown: 'Beta paragraph one about ports.\n\nBeta paragraph two.' }],
      ['get_system_state', { response_format: 'json' }],
      ['recall', { query: 'port', receipts: 'inline' }],
      ['recall', { query: 'deploy Friday' }],
      ['put_document', { slug: 'alpha', title: 'Alpha', markdown: '# Alpha\n\nThe port is 9090.\n\n## Rules\n\nNever deploy on Friday.\n\n- one\n- two\n' }],
      ['get_system_state', { response_format: 'json', focus: 'retractions' }],
      ['audit_assumptions', { claims: [{ symbol: 'port', value: 8080 }] }],
      ['verify_chain', {}],
      ['checkpoint_chain', {}],
      ['anchor_status', {}],
    ]
  : [
      ['sea_create', { title: 'one', status: 'triaged' }],
      ['sea_create', { title: 'two', status: 'triaged', claim_seconds: 600 }],
      ['sea_apply', { tickets: [{ ref: 'x', title: 'x', status: 'triaged' }, { ref: 'y', title: 'y' }], links: [{ from_ref: 'x', to_ref: 'y', link_type: 'depends_on' }] }],
      ['sea_next', { scope: { paths: ['src/a.ts'] } }],
      ['sea_list', { view: 'full' }],
      ['sea_history', {}],
      ['sea_stats', {}],
      ['sea_scope_check', { paths: ['src/a.ts'] }],
    ];

const stats = {};
const failures = [];
const bump = (n, k) => { stats[n] ??= { ok: 0, toolErr: 0, rpcErr: 0, advFail: 0, fullFail: 0, textMismatch: 0, inputRejected: 0 }; stats[n][k]++; };
const examine = async (name, args, origin) => {
  const m = await call(name, args);
  if (m.error) { bump(name, 'rpcErr'); if (m.error.code !== -32602) failures.push({ kind: 'rpc-error', name, args, error: m.error }); return; }
  const res = m.result;
  if (res.isError) {
    bump(name, 'toolErr');
    const t = res.content?.[0]?.text ?? '';
    if (/invalid_input|Input validation error|-32602/.test(t) && validators[name].inp(args)) { bump(name, 'inputRejected'); failures.push({ kind: 'schema-valid-input-rejected', name, args: JSON.stringify(args).slice(0, 400), text: t.slice(0, 300) }); }
    if (/"internal"/.test(t)) failures.push({ kind: 'internal-error', name, args, text: t.slice(0, 500) });
    return;
  }
  bump(name, 'ok');
  const sc = res.structuredContent;
  if (sc === undefined) { failures.push({ kind: 'no-structuredContent', name, args }); return; }
  if (!validators[name].adv(sc)) { bump(name, 'advFail'); failures.push({ kind: 'advertised-outputSchema', name, origin, args: JSON.stringify(args).slice(0, 300), errors: validators[name].adv.errors.slice(0, 4) }); }
  if (validators[name].full && !validators[name].full(sc)) { bump(name, 'fullFail'); failures.push({ kind: 'full-outputSchema', name, origin, args: JSON.stringify(args).slice(0, 300), errors: validators[name].full.errors.slice(0, 4) }); }
  try { const fromText = JSON.parse(res.content[0].text); if (JSON.stringify(fromText) !== JSON.stringify(sc)) { bump(name, 'textMismatch'); } } catch { /* markdown text is allowed */ }
  harvest(sc);
};

for (const [n, a] of seedCalls) await examine(n, a, 'seed');
for (let i = 0; i < N; i++) {
  const t = pick(tools);
  let args;
  try { args = jsf.generate(t.inputSchema); } catch (e) { args = {}; }
  args = substitute(t.name, args);
  // wait_seconds is a real wait (≤ 300 s): keep it short so a legitimate wait is not mistaken for a hang.
  const clampWait = (o) => { if (o && typeof o === 'object') for (const k of Object.keys(o)) { if (k === 'wait_seconds' && typeof o[k] === 'number') o[k] = Math.min(o[k], 2); else clampWait(o[k]); } };
  clampWait(args);
  if (which === 'kl' && t.name === 'put_document' && typeof args.markdown === 'string' && rnd() < 0.5) args.markdown = `# H${i}\n\n${args.markdown} port ${i}\n\nSecond para ${i}.`;
  await examine(t.name, args, `rand#${i}`);
}
console.table(stats);
const byKind = {};
for (const f of failures) (byKind[`${f.kind}:${f.name}`] ??= []).push(f);
for (const [k, v] of Object.entries(byKind)) console.log(`\n### ${k} ×${v.length}\n${JSON.stringify(v[0], null, 1).slice(0, 1500)}`);
console.log(`\npools: ${Object.entries(pool).map(([k, v]) => `${k}=${v.size ?? v.length}`).join(' ')}; server exit=${JSON.stringify(r.exit)}`);
await r.close();
process.exit(failures.filter((f) => f.kind !== 'schema-valid-input-rejected').length ? 1 : 0);
