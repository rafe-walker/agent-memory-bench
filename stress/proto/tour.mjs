// One call of every tool, in an order where each succeeds. `call(name, args)` → {sc, isError, text}.
export async function tour(which, call, log = () => {}) {
  const done = [];
  const step = async (name, args) => {
    const r = await call(name, args);
    done.push([name, r.isError ? 'toolError' : 'ok']);
    log(name, r);
    return r.sc ?? (() => { try { return JSON.parse(r.text); } catch { return {}; } })();
  };
  if (which === 'kl') {
    await step('put_document', { slug: 'tour', title: 'Tour', markdown: '# Tour\n\nThe port is 8080.\n\nNever deploy on Friday.' });
    const st = await step('get_system_state', { response_format: 'json' });
    const rc = await step('recall', { query: 'port', cursor: st.cursor });
    const hit = rc.hits?.[0];
    await step('verify', { receipt_id: hit?.receipt_id });
    await step('audit_assumptions', { claims: [{ symbol: 'port', value: 8080 }] });
    const sup = await step('supersede_block', { block_id: hit?.block_id, new_content: 'The port is 9090.', reason: 'moved', cursor: st.cursor });
    await step('tombstone_block', { block_id: sup.new_block_id, reason: 'gone' });
    await step('get_system_state', { response_format: 'json', since_cursor: st.cursor, focus: 'retractions' });
    await step('verify_chain', {});
    await step('checkpoint_chain', {});
    await step('anchor_status', {});
  } else {
    const c = await step('sea_create', { title: 'tour one', status: 'triaged', claim_seconds: 600 });
    const tid = c.ticket?.id; const tok = c.claim?.claim_token ?? c.claim_token;
    const ap = await step('sea_apply', { tickets: [{ ref: 'a', title: 'tour a', status: 'triaged' }, { ref: 'b', title: 'tour b', status: 'triaged' }], links: [{ from_ref: 'a', to_ref: 'b', link_type: 'depends_on' }] });
    const [ia, ib] = Object.values(ap.created ?? {});
    await step('sea_refresh', { ticket_id: tid, claim_token: tok });
    await step('sea_update', { ticket_id: tid, claim_token: tok, note: 'progress' });
    await step('sea_link', { action: 'add', from_id: tid, to_id: ia, link_type: 'relates_to', claim_token: tok });
    await step('sea_transition', { ticket_id: tid, claim_token: tok, to: 'in_progress' });
    await step('sea_finish', { ticket_id: tid, claim_token: tok, outcome: 'done', note: 'finished' });
    const cl = await step('sea_claim', { ticket_ids: [ib], scope: { paths: ['src/x.ts'] } });
    await step('sea_scope_check', { paths: ['src/x.ts'] });
    await step('sea_release', { ticket_id: ib, claim_token: cl.claims?.[0]?.claim_token });
    const nx = await step('sea_next', {});
    await step('sea_get', { id: nx.ticket?.id ?? ia });
    await step('sea_list', { view: 'full' });
    await step('sea_history', { limit: 20 });
    await step('sea_stats', {});
  }
  return done;
}
