// Deterministic success-path tour of every sea-lite tool (every result shape: single/batch, dry_run,
// replay, add/remove, conflicts), validating each structuredContent against the advertised
// outputSchema. Usage: node outputs-sl.mjs [--core]
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { Raw, META, tmp, check, summary } from './common.mjs';

const core = process.argv.includes('--core');
const t = tmp('proto-slout-');
const A = new Raw('sl', ['--actor', 'alice', '--session', 'sA', '--role', 'operator', '--tracks', 'work,design', ...(core ? ['--core'] : [])], { home: t.dir });
const B = new Raw('sl', ['--actor', 'bob', '--session', 'sB'], { home: t.dir });
let id = 1;
const schemas = {};
for (const s of [A, B]) {
  const tl = await s.rpc(id++, 'tools/list', { _meta: META });
  for (const x of tl.result.tools) schemas[x.name] ??= x.outputSchema;
}
const ajv = new Ajv({ strict: false, allErrors: true }); addFormats(ajv);
const v = Object.fromEntries(Object.entries(schemas).map(([k, s]) => [k, ajv.compile(s)]));
const seen = {};
async function call(s, name, args, label = name, { expectError = false, caps } = {}) {
  const meta = caps ? { ...META, 'io.modelcontextprotocol/clientCapabilities': caps } : META;
  const m = await s.rpc(id++, 'tools/call', { name, arguments: args, _meta: meta });
  if (m.error) { check(`${label}: no JSON-RPC error`, false, JSON.stringify(m.error)); return null; }
  const r = m.result;
  if (r.resultType && r.resultType !== 'complete') { check(`${label}: resultType ${r.resultType}`, true); return r; }
  if (r.isError) { check(`${label}: ${expectError ? 'expected error' : 'success'}`, expectError, r.content?.[0]?.text?.slice(0, 300)); return null; }
  if (expectError) check(`${label}: expected an error`, false);
  const sc = r.structuredContent;
  if (!v[name]) { check(`${label}: tool advertised`, false); return sc; }
  const ok = v[name](sc);
  seen[name] = (seen[name] ?? 0) + 1;
  check(`${label}: structuredContent ⊨ outputSchema`, ok, ok ? '' : JSON.stringify(v[name].errors.slice(0, 3)) + ' :: ' + JSON.stringify(sc).slice(0, 300));
  const txt = r.content?.[0]?.text; let same = false; try { same = JSON.stringify(JSON.parse(txt)) === JSON.stringify(sc); } catch {}
  check(`${label}: text == structuredContent`, same);
  return sc;
}

const W = core ? B : A;
const c1 = await call(W, 'sea_create', { title: 'one', status: 'triaged', tags: ['x'] });
await call(W, 'sea_create', { title: 'one-dry', dry_run: true }, 'sea_create dry_run');
const c2 = await call(W, 'sea_create', { title: 'two', status: 'triaged', claim_seconds: 600, idempotency_key: 'k1' }, 'sea_create claim_seconds');
await call(W, 'sea_create', { title: 'two', status: 'triaged', claim_seconds: 600, idempotency_key: 'k1' }, 'sea_create replay');
await call(W, 'sea_create', { title: 'one', status: 'triaged' }, 'sea_create possible_duplicates');
const ap = await call(W, 'sea_apply', { tickets: [{ ref: 'x', title: 'x', status: 'triaged' }, { ref: 'y', title: 'y', status: 'triaged' }], links: [{ from_ref: 'x', to_ref: 'y', link_type: 'relates_to' }], templates: [{ for_each: 3, ref: 's{i}', ticket: { title: 'Step {i}', status: 'triaged' }, links: [{ from_ref: '{ref}', to_ref: '{prev}', link_type: 'depends_on' }] }], idempotency_key: 'ap1' }, 'sea_apply');
await call(W, 'sea_apply', { tickets: [{ ref: 'x', title: 'x', status: 'triaged' }, { ref: 'y', title: 'y', status: 'triaged' }], links: [{ from_ref: 'x', to_ref: 'y', link_type: 'relates_to' }], templates: [{ for_each: 3, ref: 's{i}', ticket: { title: 'Step {i}', status: 'triaged' }, links: [{ from_ref: '{ref}', to_ref: '{prev}', link_type: 'depends_on' }] }], idempotency_key: 'ap1' }, 'sea_apply replay');
if (!core) await call(A, 'sea_apply', { tickets: [{ ref: 'z', title: 'z' }], verbose: true, dry_run: true }, 'sea_apply verbose dry_run');
const t1 = c1?.ticket?.id, t2 = c2?.ticket?.id, tok2 = c2?.claim?.claim_token ?? c2?.claim_token;
const cl = await call(A, 'sea_claim', { ticket_ids: [t1], scope: { paths: ['src/a.ts', 'lib/'] } });
const re = await call(A, 'sea_claim', { ticket_ids: [t1], scope: { paths: ['src/a.ts'] } }, 'sea_claim re-claim (rotates)');
const tok1 = re?.claims?.[0]?.claim_token ?? cl?.claims?.[0]?.claim_token;
await call(B, 'sea_claim', { ticket_ids: [t1] }, 'sea_claim held by other', { expectError: true });
await call(B, 'sea_scope_check', { paths: ['src/a.ts', 'other.txt'] }, 'sea_scope_check conflict');
await call(A, 'sea_scope_check', { paths: ['src/a.ts'] }, 'sea_scope_check own');
await call(A, 'sea_refresh', { ticket_id: t1, claim_token: tok1, extend_by_seconds: 120 });
if (!core) {
  await call(A, 'sea_update', { ticket_id: t1, claim_token: tok1, title: 'one!', add_tags: ['y'], note: 'n', assignee: 'alice' });
  await call(A, 'sea_update', { ticket_id: t1, claim_token: tok1, priority: 'high', dry_run: true }, 'sea_update dry_run');
  await call(A, 'sea_update', { ticket_id: t1, claim_token: tok1, assignee: null }, 'sea_update assignee null');
  await call(A, 'sea_link', { action: 'add', from_id: t1, to_id: t2, link_type: 'blocks', claim_token: tok1, dry_run: true }, 'sea_link add dry_run');
  await call(A, 'sea_link', { action: 'add', from_id: t1, to_id: t2, link_type: 'blocks', claim_token: tok1 }, 'sea_link add');
  await call(A, 'sea_link', { action: 'remove', from_id: t1, to_id: t2, link_type: 'blocks', claim_token: tok1 }, 'sea_link remove');
}
await call(A, 'sea_transition', { ticket_id: t1, claim_token: tok1, to: 'in_progress' }, 'sea_transition single');
await call(A, 'sea_transition', { ticket_id: t1, claim_token: tok1, to: 'blocked', reason: 'r', dry_run: true }, 'sea_transition dry_run');
await call(A, 'sea_transition', { ticket_id: t1, claim_token: tok1, to: 'wont_fix', reason: 'r' }, 'sea_transition terminal, no confirm, no elicitation cap → confirmation_required', { expectError: true });
await call(A, 'sea_transition', { ticket_id: t1, claim_token: tok1, to: 'wont_fix', reason: 'r' }, 'sea_transition terminal, elicitation cap', { caps: { elicitation: {} } });
const ids = Object.values(ap?.created ?? {});
const cl2 = await call(A, 'sea_claim', { ticket_ids: ids.slice(0, 3) }, 'sea_claim batch');
const pairs = (cl2?.claims ?? []).map((c) => ({ ticket_id: c.ticket_id, claim_token: c.claim_token }));
if (pairs.length >= 2) await call(A, 'sea_transition', { tickets: pairs.slice(0, 2), to: 'blocked', reason: 'r' }, 'sea_transition batch');
await call(W, 'sea_finish', { ticket_id: t2, claim_token: tok2, outcome: 'blocked', note: 'b', dry_run: true }, 'sea_finish dry_run');
await call(W, 'sea_finish', { ticket_id: t2, claim_token: tok2, outcome: 'done', note: 'd', commit: 'abcdef1' }, 'sea_finish single');
if (pairs.length >= 3) await call(A, 'sea_finish', { tickets: pairs, outcome: 'abandoned', note: 'a' }, 'sea_finish batch');
await call(A, 'sea_finish', { ticket_id: t1, claim_token: tok1, outcome: 'done', note: 'd' }, 'sea_finish after terminal');
const n1 = await call(B, 'sea_next', { scope: { paths: ['docs/'] } }, 'sea_next');
await call(B, 'sea_next', { kind: ['epic'] }, 'sea_next none eligible');
const nt = n1?.ticket?.id, ntok = n1?.claim?.claim_token ?? n1?.claim_token;
if (nt) {
  await call(B, 'sea_release', { ticket_id: nt, claim_token: ntok, note: 'n' }, 'sea_release token');
  await call(B, 'sea_claim', { ticket_ids: [nt] }, 'sea_claim again');
  await call(A, 'sea_release', { ticket_id: nt, force: true, reason: 'ops' }, 'sea_release force (operator)');
}
if (!core) {
  const l1 = await call(A, 'sea_list', { limit: 2 }, 'sea_list page 1');
  if (l1?.next_cursor) await call(A, 'sea_list', { limit: 2, cursor: l1.next_cursor }, 'sea_list page 2');
  await call(A, 'sea_list', { view: 'full', include_terminal: true, claimed: 'mine' }, 'sea_list full');
  await call(A, 'sea_list', { project: '*', query: 'step' }, 'sea_list all projects query');
  await call(A, 'sea_history', { ticket_id: t1 }, 'sea_history ticket');
  await call(A, 'sea_history', { since_seq: 3, limit: 5, verify: false }, 'sea_history since');
  await call(A, 'sea_stats', { since: '24h' }, 'sea_stats since');
  await call(A, 'sea_stats', { actor: 'bob' }, 'sea_stats actor');
}
await call(A, 'sea_get', { id: t1 }, 'sea_get terminal');
// resources
const rr = await A.rpc(id++, 'resources/read', { uri: `sea://tickets/${t1}`, _meta: META });
check('resources/read sea://tickets/{id}', !!rr.result?.contents?.[0]?.text, JSON.stringify(rr.error ?? '').slice(0, 200));
const bad = await A.rpc(id++, 'resources/read', { uri: 'sea://tickets/../../etc/passwd', _meta: META });
check('resources/read traversal id → error, no crash', !!bad.error || /not.found|invalid/i.test(JSON.stringify(bad.result)), JSON.stringify(bad).slice(0, 200));
console.log('tools with ≥1 validated success:', Object.keys(seen).sort().join(','), `(${Object.keys(seen).length}/${Object.keys(schemas).length})`);
await A.close(); await B.close(); t.rm();
process.exit(summary() ? 1 : 0);
