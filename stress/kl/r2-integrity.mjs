#!/usr/bin/env node
// Round 2, attack (f): integrity reporting when the PROJECTION (not the chain) is edited behind kronicle-lite's back.
// Each tamper is one SQL statement on the temp store; then: what do orient (pulse/retractions/orientation) and recall say?
// A tamper that changes what agents are served while every agent-facing integrity flag stays ok=true is reported.
// usage: KL=<kl checkout> node stress/kl/r2-integrity.mjs
import { openKl } from './r2-lib.mjs';
const V1 = '# Deploy\n\n## Steps\n\nDeploy with --target staging-a.\n';
const V2 = '# Deploy\n\n## Steps\n\nDeploy with --target prod-eu.\n';
const TAMPERS = {
  resurrect_superseded: (db, ids) => db.prepare('UPDATE blocks SET valid_to = NULL, superseded_by = NULL WHERE block_id = ?').run(ids.old),
  resurrect_and_hide_new: (db, ids) => { db.prepare('UPDATE blocks SET valid_to = NULL, superseded_by = NULL WHERE block_id = ?').run(ids.old); db.prepare('UPDATE blocks SET valid_to = valid_from WHERE block_id = ?').run(ids.new); },
  drop_lineage_rows: (db) => db.prepare('DELETE FROM doc_lineage').run(),
  drop_reads_rows: (db) => db.prepare("DELETE FROM reads WHERE actor_id = 'agent'").run(),
  control_edit_live_content: (db, ids) => db.prepare("UPDATE blocks SET content = 'Deploy with --target staging-a.' WHERE block_id = ?").run(ids.new),
};
const rows = [];
for (const [name, tamper] of Object.entries(TAMPERS)) {
  const { kl, done } = openKl();
  try {
    kl.docs.putDocument({ slug: 'deploy', title: 'Deploy', markdown: V1, actor_id: 'ops' });
    kl.orient.getSystemState({ actor_id: 'agent', focus: 'pulse' });
    kl.recall.recall({ query: 'deploy target', actor_id: 'agent' });
    kl.docs.putDocument({ slug: 'note', title: 'Note', markdown: '# Note\n\nWe ship to staging-a.\n', actor_id: 'agent' });
    const cur = kl.orient.getSystemState({ actor_id: 'hook', focus: 'pulse' }).cursor;
    kl.docs.putDocument({ slug: 'deploy', title: 'Deploy', markdown: V2, actor_id: 'ops' });
    const all = kl.db.prepare("SELECT block_id, content, valid_to FROM blocks WHERE kind = 'paragraph' AND doc_id = (SELECT doc_id FROM documents WHERE slug = 'deploy')").all();
    const ids = { old: all.find((b) => b.content.includes('staging-a')).block_id, new: all.find((b) => b.content.includes('prod-eu')).block_id };
    const before = { note_stale: kl.lineage.staleness(kl.docs.getDocument('note').doc_id).length, pending: kl.lineage.pending('agent').count };
    tamper(kl.db, ids);
    const integ = {};
    for (const focus of ['pulse', 'retractions', 'orientation']) {
      const o = kl.orient.getSystemState({ actor_id: 'hook', since_cursor: cur, focus });
      integ[focus] = o.integrity ? o.integrity.ok : null;
    }
    const hits = kl.recall.recall({ query: 'deploy target', actor_id: 'x' }).hits.map((h) => [h.content?.slice(0, 40) ?? h.text?.slice(0, 40), h.authority, h.authority_reason]);
    const after = { note_stale: kl.lineage.staleness(kl.docs.getDocument('note').doc_id).length, pending: kl.lineage.pending('agent').count };
    const full = kl.verifyAll();
    rows.push({ tamper: name, integrity_ok_by_focus: integ, recall: hits, before, after, verify_all_ok: full.ok, projection_problems: full.projection?.problems?.length ?? full.projection?.mismatches?.length ?? null });
  } finally { done(); }
}
for (const r of rows) console.log(JSON.stringify(r));
