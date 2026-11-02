// sea-lite dry_run: every write tool with dry_run:true must leave the chain head, the ticket rows and
// the claims exactly as they were (a dry run that writes is a safety lie), in both eras.
import { Raw, META, check, summary } from './common.mjs';
for (const era of ['modern', 'legacy']) {
  const r = new Raw('sl', ['--actor', 'dry', '--session', 'd1']);
  const M = era === 'modern' ? { _meta: META } : {};
  if (era === 'legacy') await r.initLegacy('2025-06-18');
  let id = 1;
  const call = async (name, args) => { const m = await r.rpc(id++, 'tools/call', { name, arguments: args, ...M }); return m.result?.structuredContent ?? { _err: m.result?.content?.[0]?.text ?? m.error }; };
  const c = await call('sea_create', { title: 'base', status: 'triaged', claim_seconds: 600 });
  const tid = c.ticket.id, tok = c.claim?.claim_token ?? c.claim_token;
  const c2 = await call('sea_create', { title: 'other', status: 'triaged' });
  const snap = async () => {
    const h = await call('sea_history', { limit: 500 });
    const l = await call('sea_list', { view: 'full', include_terminal: true, limit: 200 });
    const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'expires_at' || k === 'claim_expires_at' ? undefined : v)));
    return JSON.stringify({ n: h.events?.length, last: h.events?.at(-1)?.seq ?? h.events?.at(-1), tickets: strip(l.tickets) });
  };
  const before = await snap();
  const dry = [
    ['sea_create', { title: 'dry create', status: 'triaged', claim_seconds: 60, dry_run: true }],
    ['sea_apply', { tickets: [{ ref: 'a', title: 'dry a' }], links: [{ from_ref: 'a', to_id: tid, link_type: 'blocks' }], dry_run: true }],
    ['sea_update', { ticket_id: tid, claim_token: tok, title: 'renamed', note: 'dry note', dry_run: true }],
    ['sea_link', { action: 'add', from_id: tid, to_id: c2.ticket.id, link_type: 'blocks', claim_token: tok, dry_run: true }],
    ['sea_transition', { ticket_id: tid, claim_token: tok, to: 'blocked', reason: 'x', dry_run: true }],
    ['sea_transition', { ticket_id: tid, claim_token: tok, to: 'dropped', reason: 'x', confirm: true, dry_run: true }],
    ['sea_finish', { ticket_id: tid, claim_token: tok, outcome: 'done', note: 'dry', dry_run: true }],
    ['sea_finish', { ticket_id: tid, claim_token: tok, outcome: 'abandoned', note: 'dry', dry_run: true }],
  ];
  for (const [name, args] of dry) {
    const out = await call(name, args);
    const after = await snap();
    check(`[${era}] ${name} ${args.to ?? args.outcome ?? ''} dry_run: answered without error`, !out._err, JSON.stringify(out._err ?? '').slice(0, 160));
    check(`[${era}] ${name} ${args.to ?? args.outcome ?? ''} dry_run: chain, tickets and claims unchanged`, after === before, after === before ? '' : `before ${before.length} B, after ${after.length} B`);
  }
  // the claim is still ours and still works for a real write
  const real = await call('sea_update', { ticket_id: tid, claim_token: tok, note: 'real' });
  check(`[${era}] claim still valid after the dry runs`, !real._err, JSON.stringify(real._err ?? '').slice(0, 120));
  await r.close();
}
process.exit(summary() ? 1 : 0);
