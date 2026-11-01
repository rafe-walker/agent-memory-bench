#!/usr/bin/env node
// Replay a kronicle-lite JSONL export (stdin) and check sea-lite claim invariants:
//  - a ticket is never claimed by a second holder (actor+session) while the first claim is live
//    (no release / expiry event in between, or the new claim's time < the old expires_at);
//  - claim_expired is never noticed before expires_at;
//  - updates / status changes on a claimed ticket come from its holder (reported, not all are fenced).
import { createInterface } from 'node:readline';
const cur = new Map();
const out = { events: 0, claims: 0, double_claim_live: [], reclaim_without_expiry: [], early_expiry: [], foreign_writes: [] };
for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  const ev = JSON.parse(line);
  if (!ev.event_type || !ev.event_type.startsWith('sea_ticket.')) continue;
  out.events++;
  const p = ev.payload ?? {};
  const t = p.ticket_id; const c = cur.get(t);
  switch (ev.event_type) {
    case 'sea_ticket.claimed': {
      out.claims++;
      const who = `${p.claim_actor}#${p.claim_session ?? ''}`;
      if (c && c.who !== who) {
        const rec = { ticket: t, seq: ev.seq, prev: c.who, prev_seq: c.seq, prev_expires: c.expires, next: who, at: ev.occurred_at };
        if (Date.parse(ev.occurred_at) < Date.parse(c.expires)) out.double_claim_live.push(rec); else out.reclaim_without_expiry.push(rec);
      }
      cur.set(t, { who, actor: p.claim_actor, expires: p.expires_at, seq: ev.seq });
      break;
    }
    case 'sea_ticket.claim_expired':
      if (Date.parse(p.noticed_at ?? ev.occurred_at) < Date.parse(p.expired_at)) out.early_expiry.push({ ticket: t, seq: ev.seq, expired_at: p.expired_at, noticed_at: p.noticed_at });
      cur.delete(t); break;
    case 'sea_ticket.claim_released': case 'sea_ticket.claim_force_released':
      cur.delete(t); break;
    case 'sea_ticket.updated': case 'sea_ticket.status_set': case 'sea_ticket.note_added':
      if (c && c.actor !== ev.actor_id && Date.parse(ev.occurred_at) < Date.parse(c.expires)) out.foreign_writes.push({ ticket: t, seq: ev.seq, type: ev.event_type, by: ev.actor_id, holder: c.who });
      break;
  }
}
const summary = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Array.isArray(v) ? v.length : v]));
console.log(JSON.stringify(summary));
for (const k of ['double_claim_live', 'reclaim_without_expiry', 'early_expiry', 'foreign_writes']) for (const r of out[k].slice(0, 3)) console.log(k, JSON.stringify(r));
process.exit(out.double_claim_live.length + out.early_expiry.length > 0 ? 1 : 0);
