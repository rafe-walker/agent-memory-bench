#!/usr/bin/env node
// Round 2, attacks (c) lineage and (d) pending: scenario probes through the library API (same code the MCP server calls).
// Each scenario prints one JSON line {id, ok, ...evidence}; ok=false is a candidate finding (verify with --only ID twice).
// usage: KL=<kl checkout> node stress/kl/r2-lineage.mjs [--only ID] [--json]
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openKl } from './r2-lib.mjs';

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const tick = () => { const t = Date.now(); while (Date.now() - t < 4); };
const RUNBOOK = (target) => `# Deploy runbook\n\n## Steps\n\nDeploy with ./bin/deploy --target ${target}.\n\nNotify #ops after the deploy.\n`;

function ctx() {
  const h = openKl();
  const { kl } = h;
  const put = (slug, markdown, actor, extra = {}) => { tick(); const r = kl.docs.putDocument({ slug, title: slug, markdown, actor_id: actor, ...extra }); tick(); return r; };
  const recall = (actor, query, extra = {}) => { tick(); const r = kl.recall.recall({ query, actor_id: actor, ...extra }); tick(); return r; };
  const orient = (actor, extra = {}) => { tick(); const r = kl.orient.getSystemState({ actor_id: actor, ...extra }); tick(); return r; };
  const readDoc = (actor, slug) => { tick(); kl.lineage.recordDocumentRead(actor, kl.docs.getDocument(slug).doc_id, 'document'); tick(); };
  const noteHit = (actor, query, slug) => recall(actor, query).hits.find((x) => x.doc_slug === slug) ?? null;
  const stale = (slug) => kl.lineage.staleness(kl.docs.getDocument(slug).doc_id);
  const pending = (actor) => kl.lineage.pending(actor);
  return { ...h, put, recall, orient, readDoc, noteHit, stale, pending };
}

const scenarios = {
  // Baseline: orient, recall the runbook, write a note, runbook changes -> note stale.
  C01_baseline(c) {
    c.orient('agent', { focus: 'pulse' });
    c.recall('agent', 'deploy target');
    c.put('note', '# Note\n\nWe deploy to staging-a.\n', 'agent');
    c.put('runbook', RUNBOOK('staging-b'), 'ops');
    const h = c.noteHit('reader', 'deploy staging note', 'note');
    return { ok: c.stale('note').length > 0 && h?.authority === 'never_act', stale: c.stale('note').length, authority: h?.authority, reason: h?.authority_reason };
  },
  // Wake contract: orient before write-class tools. recall -> orient again -> put (no cursor / newest cursor).
  C02_reorient_before_write(c) {
    c.orient('agent', { focus: 'pulse' });
    c.recall('agent', 'deploy target');
    const c1 = c.orient('agent', { focus: 'pulse' }).cursor; // "orient before write-class tools"
    const r = c.put('note', '# Note\n\nWe deploy to staging-a.\n', 'agent', { cursor: c1 });
    c.put('runbook', RUNBOOK('staging-b'), 'ops');
    const h = c.noteHit('reader', 'deploy staging note', 'note');
    return { ok: c.stale('note').length > 0, inferred_edges: r.lineage?.derived_from_inferred?.length ?? r.lineage ?? null, stale: c.stale('note').length, authority: h?.authority, reason: h?.authority_reason };
  },
  // Same as C02 with full orientation briefings and the cursor chained (since_cursor = previous).
  C02b_reorient_chained(c) {
    const c0 = c.orient('agent').cursor;
    c.recall('agent', 'deploy target');
    const c1 = c.orient('agent', { since_cursor: c0 }).cursor;
    c.put('note', '# Note\n\nWe deploy to staging-a.\n', 'agent', { cursor: c1 });
    c.put('runbook', RUNBOOK('staging-b'), 'ops');
    const h = c.noteHit('reader', 'deploy staging note', 'note');
    return { ok: c.stale('note').length > 0, stale: c.stale('note').length, authority: h?.authority, reason: h?.authority_reason };
  },
  // Same, full orientation briefings, put without a cursor (session = latest briefing).
  C03b_reorient_full_no_cursor(c) {
    c.orient('agent');
    c.recall('agent', 'deploy target');
    c.orient('agent');
    c.put('note', '# Note\n\nWe deploy to staging-a.\n', 'agent');
    c.put('runbook', RUNBOOK('staging-b'), 'ops');
    const h = c.noteHit('reader', 'deploy staging note', 'note');
    return { ok: c.stale('note').length > 0, stale: c.stale('note').length, authority: h?.authority, reason: h?.authority_reason };
  },
  // C03b with a note kept in a file (source kind file, absolute path): is the note can_act after the source changed?
  C03c_reorient_bound_note_can_act(c) {
    const f = join(c.dir, 'NOTES.md');
    const md = '# Notes\n\nWe deploy to staging-a.\n';
    writeFileSync(f, md);
    c.orient('agent');
    c.recall('agent', 'deploy target');
    c.orient('agent');
    c.put('note', md, 'agent', { source: { kind: 'file', path: f } });
    const before = c.noteHit('r0', 'deploy staging note', 'note');
    c.put('runbook', RUNBOOK('staging-b'), 'ops');
    const h = c.noteHit('reader', 'deploy staging note', 'note');
    return { ok: h?.authority !== 'can_act', before_change: [before?.authority, before?.authority_reason], after_source_change: [h?.authority, h?.authority_reason] };
  },
  // Control for C03c: same, without the second orient.
  C03d_bound_note_control(c) {
    const f = join(c.dir, 'NOTES.md');
    const md = '# Notes\n\nWe deploy to staging-a.\n';
    writeFileSync(f, md);
    c.orient('agent');
    c.recall('agent', 'deploy target');
    c.put('note', md, 'agent', { source: { kind: 'file', path: f } });
    c.put('runbook', RUNBOOK('staging-b'), 'ops');
    const h = c.noteHit('reader', 'deploy staging note', 'note');
    return { ok: h?.authority !== 'can_act', after_source_change: [h?.authority, h?.authority_reason] };
  },
  // Same, put without any cursor (session = latest orient).
  C03_reorient_no_cursor(c) {
    c.orient('agent', { focus: 'pulse' });
    c.recall('agent', 'deploy target');
    c.orient('agent', { focus: 'pulse' });
    c.put('note', '# Note\n\nWe deploy to staging-a.\n', 'agent');
    c.put('runbook', RUNBOOK('staging-b'), 'ops');
    const h = c.noteHit('reader', 'deploy staging note', 'note');
    return { ok: c.stale('note').length > 0, stale: c.stale('note').length, authority: h?.authority, reason: h?.authority_reason };
  },
  // Source removed (tombstoned) then re-derived from the new location: can the note ever clear without explicit lineage?
  C04_tombstoned_source_rederive(c) {
    c.orient('agent', { focus: 'pulse' });
    c.recall('agent', 'deploy target');
    c.put('note', '# Note\n\nWe deploy to staging-a.\n', 'agent');
    // runbook block removed; the instruction moves to another document
    c.put('runbook', '# Deploy runbook\n\n## Steps\n\nNotify #ops after the deploy.\n', 'ops');
    c.put('deploy-v2', '# Deploy v2\n\nDeploy with ./bin/deploy2 --target staging-c.\n', 'ops');
    const before = c.stale('note').length;
    // agent re-derives in a new session: orients, reads the new doc, rewrites the note
    c.orient('agent', { focus: 'pulse' });
    c.recall('agent', 'deploy2 target');
    c.readDoc('agent', 'deploy-v2');
    c.put('note', '# Note\n\nWe deploy to staging-c with deploy2.\n', 'agent');
    const after = c.stale('note');
    return { ok: after.length === 0, stale_before: before, stale_after: after.map((s) => [s.change, s.old_text]) };
  },
  // Chains: n1 from runbook, n2 from n1, ... n6 from n5. Each note's staleness after the runbook changes.
  C05_chain_depth(c) {
    c.orient('agent', { focus: 'pulse' });
    c.recall('agent', 'deploy target');
    c.put('n1', '# N1\n\nalpha1 says deploy to staging-a.\n', 'agent');
    for (let i = 2; i <= 6; i++) {
      c.orient(`a${i}`, { focus: 'pulse' });
      c.recall(`a${i}`, `alpha${i - 1}`);
      c.put(`n${i}`, `# N${i}\n\nalpha${i} relies on alpha${i - 1}.\n`, `a${i}`);
    }
    c.put('runbook', RUNBOOK('staging-b'), 'ops');
    const per = {};
    for (let i = 1; i <= 6; i++) per[`n${i}`] = c.stale(`n${i}`).length;
    return { ok: Object.values(per).every((n) => n > 0), stale_per_note: per };
  },
  // Shared memo: one recall that serves n6 (depth-truncated) and n2 together; is n2 still marked?
  C06_chain_memo_poison(c) {
    c.orient('agent', { focus: 'pulse' });
    c.recall('agent', 'deploy target');
    c.put('n1', '# N1\n\nzulu1 deploy to staging-a.\n', 'agent');
    for (let i = 2; i <= 6; i++) {
      c.orient(`a${i}`, { focus: 'pulse' });
      c.recall(`a${i}`, `zulu${i - 1}`);
      c.put(`n${i}`, `# N${i}\n\nzulu${i} relies on zulu${i - 1} and shared${i === 6 || i === 2 ? 'term' : ''}.\n`, `a${i}`);
    }
    c.put('runbook', RUNBOOK('staging-b'), 'ops');
    const alone = c.noteHit('r1', 'zulu2 relies', 'n2');
    const both = c.recall('r2', 'sharedterm').hits.map((x) => [x.doc_slug, x.authority, x.authority_reason]);
    const n2both = both.find((x) => x[0] === 'n2');
    return { ok: alone?.authority === 'never_act' && n2both?.[1] === 'never_act', n2_alone: [alone?.authority, alone?.authority_reason], together: both };
  },
  // Cycle: A from runbook; B from A; A re-put after reading B. Runbook changes. Is B stale regardless of evaluation order?
  C07_cycle(c) {
    c.orient('agent', { focus: 'pulse' });
    c.recall('agent', 'deploy target');
    c.put('nota', '# A\n\nkilo note a: staging-a target.\n', 'agent');
    c.orient('b', { focus: 'pulse' });
    c.recall('b', 'kilo note a');
    c.put('notb', '# B\n\nkilo note b builds on note a.\n', 'b');
    c.orient('agent', { focus: 'pulse' });
    c.recall('agent', 'kilo note b');
    c.put('nota', '# A\n\nkilo note a: staging-a target, see note b.\n', 'agent');
    c.put('runbook', RUNBOOK('staging-b'), 'ops');
    const together = c.recall('r', 'kilo note').hits.map((x) => [x.doc_slug, x.authority, x.authority_reason]);
    const fresh = { nota: c.stale('nota').length, notb: c.stale('notb').length };
    return { ok: together.every((x) => x[1] === 'never_act') && fresh.nota > 0 && fresh.notb > 0, together, stale_each: fresh };
  },
  // Two-note cycle without changing the shared block: A from runbook, B from A, A re-put (block carried + a new
  // paragraph that infers B). Runbook changes. Recall serving A then B in one call: is B still marked?
  C07b_cycle_memo(c) {
    c.orient('agent', { focus: 'pulse' });
    c.recall('agent', 'deploy target');
    c.put('nota', '# A\n\nkilo fact kilo fact kilo fact: deploy to staging-a.\n', 'agent');
    c.orient('b', { focus: 'pulse' });
    c.recall('b', 'kilo fact');
    c.put('notb', '# B\n\nlima builds on the kilo fact.\n', 'b');
    c.orient('agent', { focus: 'pulse' });
    c.recall('agent', 'lima builds');
    c.put('nota', '# A\n\nkilo fact kilo fact kilo fact: deploy to staging-a.\n\nSee also lima.\n', 'agent');
    c.put('runbook', RUNBOOK('staging-b'), 'ops');
    const bAlone = c.noteHit('r0', 'lima builds', 'notb');
    const together = c.recall('r', 'kilo fact').hits.map((x) => [x.doc_slug, x.authority, x.authority_reason]);
    const memo = new Map();
    const ordered = ['nota', 'notb'].map((sl) => [sl, c.kl.lineage.staleness(c.kl.docs.getDocument(sl).doc_id, memo).length]);
    return { ok: bAlone?.authority === 'never_act' && together.every((x) => x[1] === 'never_act') && ordered.every((x) => x[1] > 0), b_alone: [bAlone?.authority, bAlone?.authority_reason], together, shared_memo_A_then_B: ordered, stale_each: { nota: c.stale('nota').length, notb: c.stale('notb').length } };
  },
  // Orient: a note derived from a stale note (via) gets a `derived` retraction for its reader?
  C08_transitive_retraction(c) {
    c.orient('agent', { focus: 'pulse' });
    c.recall('agent', 'deploy target');
    c.put('n1', '# N1\n\nmike1 deploy to staging-a.\n', 'agent');
    c.orient('b', { focus: 'pulse' });
    c.recall('b', 'mike1');
    c.put('n2', '# N2\n\nmike2 relies on mike1.\n', 'b');
    c.recall('reader', 'mike2 relies');
    const cur = c.orient('hook', { focus: 'pulse' }).cursor;
    c.put('runbook', RUNBOOK('staging-b'), 'ops');
    const o = c.orient('hook', { since_cursor: cur, focus: 'retractions', pending_actor: 'reader' });
    const derived = o.retractions.filter((r) => r.kind === 'derived').map((r) => r.doc_slug);
    const n2stale = c.stale('n2').length;
    const pend = c.pending('reader');
    return { ok: !(n2stale > 0 && !derived.includes('n2')), n2_stale: n2stale, derived_retractions_for: derived, reader_pending: pend.count };
  },
  // Cross-project: note in project P2, source in P1; P2-scoped orient must tell the agent its note went stale.
  C09_cross_project(c) {
    const P1 = { key: 'p1', root: '/x/p1' };
    const P2 = { key: 'p2', root: '/x/p2' };
    c.put('runbook', RUNBOOK('staging-a'), 'ops', { project: P1 });
    c.orient('agent', { focus: 'pulse' });
    c.recall('agent', 'deploy target');
    c.put('note', '# Note\n\nWe deploy to staging-a.\n', 'agent', { project: P2 });
    const cur = c.orient('hook', { focus: 'pulse' }).cursor;
    c.put('runbook', RUNBOOK('staging-b'), 'ops', { project: P1 });
    let o;
    try { o = c.orient('hook', { since_cursor: cur, focus: 'retractions', project_keys: ['p2'] }); } catch (e) { return { ok: false, error: String(e) }; }
    const derived = o.retractions.filter((r) => r.kind === 'derived').length;
    const h = c.recall('reader', 'deploy staging note', { project_keys: ['p2'] }).hits.find((x) => x.doc_slug === 'note');
    return { ok: derived > 0 && h?.authority === 'never_act', derived_in_p2: derived, hidden: o.scope?.hidden_retractions, note_authority: h?.authority };
  },
  // Revert: source A -> B -> A again. Note derived from the first A: stale (noise) or fresh?
  C10_revert_noise(c) {
    c.orient('agent', { focus: 'pulse' });
    c.recall('agent', 'deploy target');
    c.put('note', '# Note\n\nWe deploy to staging-a.\n', 'agent');
    c.put('runbook', RUNBOOK('staging-b'), 'ops');
    c.put('runbook', RUNBOOK('staging-a'), 'ops');
    return { ok: true, observation: true, stale_after_revert: c.stale('note').length };
  },
  // Pending: actor reads v1; v2 (real), v3 (format-only of v2). Reading v3 clears; reading nothing keeps it.
  D01_pending_basic(c) {
    c.recall('agent', 'deploy target');
    c.put('runbook', RUNBOOK('staging-b'), 'ops');
    c.put('runbook', RUNBOOK('staging-b').replace('Deploy with', 'Deploy  with'), 'ops');
    const p1 = c.pending('agent').count;
    c.recall('agent', 'deploy target');
    const p2 = c.pending('agent').count;
    return { ok: p1 === 1 && p2 === 0, before: p1, after: p2 };
  },
  // Pending: a document re-put that RE-CREATES a removed block with the same text as before (new block id, no lineage):
  // does reading the doc clear the removal (fine) — and does the old read now count as current?
  D02_removed_then_readded(c) {
    c.recall('agent', 'deploy target');
    c.put('runbook', '# Deploy runbook\n\n## Steps\n\nNotify #ops after the deploy.\n', 'ops');
    const p1 = c.pending('agent');
    c.put('runbook', RUNBOOK('staging-z'), 'ops');
    const p2 = c.pending('agent');
    return { ok: p2.count >= 1, after_remove: p1.count, after_readd_changed: p2.count, items: p2.items.map((i) => [i.change, i.new_text]) };
  },
  // Pending: block moved to another DOCUMENT (removed here, added there): reading the old doc clears the safety item,
  // though the agent never saw the new text.
  D03_tombstone_cleared_by_doc_read(c) {
    c.recall('agent', 'deploy target');
    c.put('runbook', '# Deploy runbook\n\n## Steps\n\nNotify #ops after the deploy.\n', 'ops');
    c.readDoc('agent', 'runbook');
    return { ok: c.pending('agent').count === 0, observation: 'documented: removal resolves on a doc read after it', pending: c.pending('agent').count };
  },
  // Pending: rapid successive changes v1->v2->v3; actor reads v2 only (between): v3 still pending?
  D04_read_middle_version(c) {
    c.recall('agent', 'deploy target');
    c.put('runbook', RUNBOOK('staging-b'), 'ops');
    c.recall('agent', 'deploy target');
    c.put('runbook', RUNBOOK('staging-c'), 'ops');
    const p = c.pending('agent');
    return { ok: p.count === 1 && p.items[0]?.new_text?.includes('staging-c'), pending: p.count, item: p.items[0] && [p.items[0].old_text, p.items[0].new_text] };
  },
  // Pending: actor wrote the block itself (own write counts as a read) — then another actor changes it.
  D05_own_write_then_changed(c) {
    c.put('mine', '# Mine\n\nCache TTL is 60 s.\n', 'agent');
    c.put('mine', '# Mine\n\nCache TTL is 600 s.\n', 'ops');
    return { ok: c.pending('agent').count === 1, pending: c.pending('agent').count };
  },
  // Pending: section rename -> every block "moved" (identical text). After the agent re-reads, cleared?
  D06_section_rename(c) {
    c.recall('agent', 'deploy target');
    c.put('runbook', RUNBOOK('staging-a').replace('## Steps', '## Forbidden'), 'ops');
    const p1 = c.pending('agent');
    c.recall('agent', 'deploy target');
    return { ok: p1.count >= 1 && c.pending('agent').count === 0, after_rename: p1.count, change: p1.items[0]?.change, after_reread: c.pending('agent').count };
  },
};

let failed = 0;
const out = [];
for (const [id, fn] of Object.entries(scenarios)) {
  if (only && !id.startsWith(only)) continue;
  const c = ctx();
  try {
    c.put('runbook', RUNBOOK('staging-a'), 'ops');
    const r = fn(c);
    out.push({ id, ...r });
    if (!r.ok) failed++;
  } catch (e) {
    out.push({ id, ok: false, error: String(e?.stack ?? e).split('\n').slice(0, 3).join(' | ') });
    failed++;
  } finally { c.done(); }
}
for (const r of out) console.log(JSON.stringify(r));
process.exit(failed ? 1 : 0);
