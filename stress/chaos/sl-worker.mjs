#!/usr/bin/env node
// One sea-lite MCP agent for the mixed storm: sea_next(wait) → note → in_progress → finish, or sit
// past its lease and then write with the stale token (must be fenced), plus shared-idempotency-key
// sea_create / sea_apply. Prints one JSON summary line; exit 0 unless a protocol-level error.
// usage: node sl-worker.mjs SLCLI DATA_DIR ACTOR ITER
import { Mcp } from '../lib/mcp.mjs';
const [cli, dir, actor, iterS] = process.argv.slice(2);
const ITER = Number(iterS ?? 5);
const m = new Mcp('node', [cli, 'serve', '--data-dir', dir, '--actor', actor, '--session', `s-${actor}`], { timeoutMs: 120000 });
const st = { actor, ok: 0, codes: {}, stale_write_accepted: 0, errors: [] };
const code = (r) => (r.error ? `rpc:${r.error.code}` : r.isError ? String(r.result?.error?.code ?? (typeof r.result?.error === 'string' ? r.result.error : null) ?? r.result?.code ?? JSON.stringify(r.result).match(/"code":"([a-z_]+)"/)?.[1] ?? (typeof r.result === 'string' ? r.result.match(/^([a-z_]+)/)?.[1] : null) ?? 'tool_error') : 'ok');
const note = (name, r) => { const c = code(r); st.codes[`${name}:${c}`] = (st.codes[`${name}:${c}`] ?? 0) + 1; if (/SQLITE|database is locked|internal|rpc:|tool_error|unknown/i.test(c + (c === 'ok' ? '' : JSON.stringify(r.result ?? r.error ?? '').slice(0, 300))) && !/nothing_eligible|wait_timeout/.test(c)) st.errors.push(`${name}:${JSON.stringify(r.result ?? r.error).slice(0, 240)}`); return c; };
const rnd = (n) => Math.floor(Math.random() * n);
try {
  await m.init();
  for (let i = 0; i < ITER; i++) {
    const op = rnd(10);
    if (op < 6) {
      const lease = 2 + rnd(3);
      const r = await m.call('sea_next', { lease_seconds: lease, wait_seconds: rnd(4), include_unassigned: true });
      if (note('next', r) !== 'ok' || !r.result?.claim_token) continue;
      const id = r.result.ticket.id, tok = r.result.claim_token, tGot = Date.now();
      const u = await m.call('sea_update', { ticket_id: id, claim_token: tok, note: `${actor} working ${i}` });
      if (note('update', u) !== 'ok') { st.fenced_fresh = st.fenced_fresh ?? []; st.fenced_fresh.push({ id: id.slice(0, 8), lease, granted_expires: r.result.expires_at ?? r.result.ticket?.claim?.expires_at, update_ms: Date.now() - tGot, at: new Date().toISOString(), err: JSON.stringify(u.result).slice(0, 260) }); continue; }
      if (rnd(3) === 0) {
        await new Promise((res) => setTimeout(res, (lease + 2) * 1000)); // lapse
        const w = await m.call('sea_update', { ticket_id: id, claim_token: tok, note: `${actor} stale write` });
        if (note('stale_update', w) === 'ok') {
          // Allowed only if nobody else took it meanwhile: the store may let a lapsed-but-untaken claim continue.
          const g = await m.call('sea_get', { id });
          const h = g.result?.ticket?.claim?.holder ?? g.result?.claim?.holder;
          if (h && h !== actor) st.stale_write_accepted++;
        }
        continue;
      }
      note('transition', await m.call('sea_transition', { ticket_id: id, claim_token: tok, to: 'in_progress' }));
      note('finish', await m.call('sea_finish', { ticket_id: id, claim_token: tok, outcome: ['done', 'blocked', 'abandoned'][rnd(3)], note: 'storm' }));
    } else if (op < 8) {
      note('create_idem', await m.call('sea_create', { title: `idem ${i % 3}`, status: 'triaged', idempotency_key: `storm-create-${i % 3}` }));
    } else {
      note('apply_idem', await m.call('sea_apply', { tickets: [{ ref: 'a', title: `apply batch ${i % 2}`, status: 'triaged' }, { ref: 'b', title: `apply batch ${i % 2} b`, status: 'triaged' }], links: [{ from_ref: 'a', to_ref: 'b', link_type: 'blocks' }], idempotency_key: `storm-apply-${i % 2}` }));
    }
  }
} catch (e) { st.errors.push(`fatal:${String(e).slice(0, 200)} stderr:${m.stderr.slice(0, 200)}`); }
await m.close();
console.log(JSON.stringify(st));
