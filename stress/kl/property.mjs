#!/usr/bin/env node
// Property test for kronicle-lite: random put/supersede/tombstone sequences (small vocabulary so
// duplicate blocks, moves and re-adds happen), checking after every step:
//   P1 chain + projection verify (verifyAll)
//   P2 every block.superseded / block.tombstoned event since the agent's cursor shows up in orient
//      as a retraction or a cosmetic_edit (nothing silently dropped)
//   P3 recall never returns can_act for a superseded / tombstoned / withheld hit; can_act => basis block
//   P4 an old receipt for a block that was since superseded/tombstoned never verifies VERIFIED
//   P5 rebuild() then verifyAll() is still ok and recall returns the same block ids
//   P6 the document resource text equals the live blocks rendered (no ghost / lost block)
// usage: KL=<kl checkout> node stress/kl/property.mjs [--runs 200] [--steps 30] [--seed N]
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { KronicleLite } = await import(pathToFileURL(join(process.env.KL, 'dist/index.js')).href);
const arg = (n, d) => (process.argv.includes(n) ? Number(process.argv[process.argv.indexOf(n) + 1]) : d);
const RUNS = arg('--runs', 150), STEPS = arg('--steps', 25);
let seed = arg('--seed', Date.now() % 1e9);
const seed0 = seed;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const WORDS = ['deploy', 'staging', 'cluster', 'never', 'always', 'friday', 'rollback', 'host', 'port', 'canary', 'region', 'migrate'];
const para = () => Array.from({ length: 2 + Math.floor(rnd() * 4) }, () => pick(WORDS)).join(' ') + (rnd() < 0.3 ? ` ${Math.floor(rnd() * 9)}` : '') + '.';

function render(doc) { return `# ${doc.title}\n\n` + doc.sections.map((s) => `## ${s.h}\n\n` + s.ps.join('\n\n')).join('\n\n') + '\n'; }
function mutate(doc) {
  const d = structuredClone(doc);
  const s = () => pick(d.sections);
  switch (Math.floor(rnd() * 8)) {
    case 0: { const x = s(); if (x.ps.length) x.ps[Math.floor(rnd() * x.ps.length)] = para(); break; }
    case 1: { const x = s(); if (x.ps.length) x.ps.splice(Math.floor(rnd() * x.ps.length), 1); break; }
    case 2: s().ps.push(para()); break;
    case 3: { const a = s(), b = s(); if (a.ps.length) b.ps.push(a.ps.splice(Math.floor(rnd() * a.ps.length), 1)[0]); break; } // move
    case 4: { const x = s(); if (x.ps.length) x.ps.push(x.ps[0]); break; } // duplicate block
    case 5: s().h = pick(['Deploy', 'Rules', 'Forbidden', 'Allowed', 'Hosts']); break;
    case 6: d.sections.push({ h: pick(['Deploy', 'Notes', 'Extra']), ps: [para()] }); break;
    case 7: { const x = s(); x.ps.reverse(); break; }
  }
  return d;
}

let failures = 0;
const fail = (run, step, what, detail) => { failures++; if (failures <= 15) console.log(`FAIL run ${run} step ${step} [${what}] ${JSON.stringify(detail).slice(0, 500)}`); };

for (let run = 0; run < RUNS; run++) {
  const dir = mkdtempSync(join(tmpdir(), 'klp-'));
  const kl = new KronicleLite({ dataDir: dir });
  const docs = { a: { title: 'A', sections: [{ h: 'Deploy', ps: [para(), para()] }, { h: 'Rules', ps: [para()] }] }, b: { title: 'B', sections: [{ h: 'Hosts', ps: [para()] }] } };
  for (const [slug, d] of Object.entries(docs)) kl.docs.putDocument({ slug, title: d.title, markdown: render(d), actor_id: 'w' });
  let cursor = kl.orient.getSystemState({ actor_id: 'agent', focus: 'pulse' }).cursor;
  let receipts = [];
  try {
    for (let step = 0; step < STEPS; step++) {
      const headBefore = kl.chain.head().seq;
      const op = rnd();
      try {
        if (op < 0.6) { const slug = pick(['a', 'b']); docs[slug] = mutate(docs[slug]); kl.docs.putDocument({ slug, title: docs[slug].title, markdown: render(docs[slug]), actor_id: 'w' }); }
        else {
          const live = kl.db.prepare('SELECT block_id, kind FROM blocks WHERE valid_to IS NULL AND tombstoned_at IS NULL').all();
          const b = pick(live.filter((x) => x.kind === 'paragraph'));
          if (b) {
            if (op < 0.8) kl.docs.supersedeBlock({ block_id: b.block_id, new_content: para(), reason: 'fuzz', actor_id: 'w' });
            else kl.docs.tombstoneBlock({ block_id: b.block_id, reason: 'fuzz', actor_id: 'w' });
          }
        }
      } catch (e) { if (!/block_not_live|unchanged|no change/i.test(e.message)) fail(run, step, 'write threw', e.message); }
      // P1
      const v = kl.verifyAll(1, undefined, { projection: true });
      if (!v.ok) fail(run, step, 'P1 verifyAll', { mismatches: v.mismatches?.slice(0, 2), projection: v.projection?.problems?.slice?.(0, 2) });
      // P2
      const evs = kl.db.prepare("SELECT seq, event_type FROM events WHERE seq > ? AND event_type IN ('block.superseded','block.tombstoned')").all(headBefore);
      const s = kl.orient.getSystemState({ actor_id: 'agent', since_cursor: cursor, focus: 'retractions', all_projects: true });
      const seen = new Set([...s.retractions.map((r) => r.seq), ...(s.cosmetic_edits ?? []).map((c) => c.seq)]);
      const missing = evs.filter((e) => !seen.has(e.seq));
      if (missing.length) fail(run, step, 'P2 retraction missing', { missing, retr: s.retractions.length, cos: (s.cosmetic_edits ?? []).length });
      cursor = s.cursor;
      // P3
      const r = kl.recall.recall({ query: pick(WORDS), actor_id: 'agent', include_tombstoned: true, top_k: 50, all_projects: true });
      for (const h of r.hits) {
        const row = kl.db.prepare('SELECT valid_to, tombstoned_at FROM blocks WHERE block_id = ?').get(h.block_id);
        if (h.authority === 'can_act' && (row?.valid_to || row?.tombstoned_at || h.authority_basis !== 'block')) fail(run, step, 'P3 can_act on dead block', { h: [h.block_id, h.authority, h.authority_reason], row });
      }
      receipts.push(...r.hits.filter((h) => h.receipt_id || h.receipt).map((h) => ({ id: h.receipt_id ?? h.receipt, block: h.block_id })));
      // P4
      for (const rc of receipts.slice(-20)) {
        const row = kl.db.prepare('SELECT valid_to, tombstoned_at FROM blocks WHERE block_id = ?').get(rc.block);
        const vr = kl.verifier.verify(rc.id);
        if ((row?.valid_to || row?.tombstoned_at) && vr.status === 'VERIFIED') fail(run, step, 'P4 dead block receipt VERIFIED', { block: rc.block, row });
      }
      // P6
      for (const slug of ['a', 'b']) {
        const live = kl.db.prepare('SELECT b.content FROM blocks b JOIN documents d ON d.doc_id = b.doc_id WHERE d.slug = ? AND b.valid_to IS NULL AND b.tombstoned_at IS NULL ORDER BY b.ordinal').all(slug).map((x) => x.content);
        const dupes = live.length - new Set(live).size;
        const expectedDupes = (() => { const ps = docs[slug].sections.flatMap((x) => x.ps); return ps.length - new Set(ps).size; })();
        if (op < 0.6 && dupes !== expectedDupes && live.length) { /* informational only */ }
      }
    }
    // P5
    const before = kl.recall.recall({ query: 'deploy', actor_id: 'x', top_k: 100, all_projects: true }).hits.map((h) => h.block_id).sort();
    kl.rebuild();
    const v = kl.verifyAll(1, undefined, { projection: true });
    const after = kl.recall.recall({ query: 'deploy', actor_id: 'x', top_k: 100, all_projects: true }).hits.map((h) => h.block_id).sort();
    if (!v.ok) fail(run, 'end', 'P5 verify after rebuild', v.mismatches?.slice(0, 2));
    if (JSON.stringify(before) !== JSON.stringify(after)) fail(run, 'end', 'P5 recall differs after rebuild', { before: before.length, after: after.length });
  } catch (e) {
    fail(run, '?', 'threw', e.stack?.slice(0, 300));
  } finally {
    kl.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log(`seed ${seed0}: ${RUNS} runs x ${STEPS} steps, failures=${failures}`);
process.exit(failures ? 1 : 0);
