// Usage: node track-a/noise-inferred-lineage.mjs <kronicle-lite build>/dist/index.js
// Inferred-lineage noise for an actor that never oriented: 300 docs x 4 paragraphs, 2,000 reads
// spread over 7 days (newest last), then one note. Then 50 random blocks the actor read are superseded:
// how many make the note stale (derived retractions)?
const { KronicleLite } = await import(process.argv[2]);
const store = new KronicleLite({ memory: true });
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const blocks = [];
for (let d = 0; d < 300; d++) {
  const md = `# Doc ${d}\n\n` + [0, 1, 2, 3].map((i) => `## S${i}\n\nFact ${d}-${i} value v${Math.floor(rnd() * 1e6)}.\n`).join('\n');
  store.docs.putDocument({ slug: `doc-${d}`, title: `Doc ${d}`, markdown: md, actor_id: 'human' });
  for (const b of store.docs.liveBlocks(store.docs.getDocument(`doc-${d}`).doc_id)) if (b.kind === 'paragraph') blocks.push(b);
}
const now = Date.now();
const ins = store.db.prepare(`INSERT INTO reads (actor_id, doc_id, block_id, content_hash, doc_revision, head_seq, read_at, via) VALUES ('agent', ?, ?, ?, 1, 1, ?, 'recall')`);
const readIds = [];
for (let i = 0; i < 2000; i++) {
  const b = blocks[Math.floor(rnd() * blocks.length)];
  const t = new Date(now - 7 * 86400e3 + (i / 2000) * 7 * 86400e3).toISOString();
  ins.run(b.doc_id, b.block_id, b.content_hash, t);
  readIds.push(b.block_id);
}
const put = store.docs.putDocument({ slug: 'note', title: 'Note', markdown: '# Note\n\nDeploy target is blue-7.\n', actor_id: 'agent' });
const uniq = [...new Set(readIds)];
let stale = 0;
for (let i = 0; i < 50; i++) {
  const id = uniq[Math.floor(rnd() * uniq.length)];
  const b = store.docs.getBlock(id);
  if (!b || b.valid_to) { i--; continue; }
  const before = store.lineage.staleness(put.doc_id).length;
  store.docs.supersedeBlock({ block_id: id, new_content: b.content.replace('value', 'VALUE'), reason: 'edit', actor_id: 'human' });
  const after = store.lineage.staleness(put.doc_id, new Map()).length;
  if (after > before) stale++;
}
console.log(JSON.stringify({ distinct_blocks_read: uniq.length, lineage: put.lineage, changes: 50, changes_that_marked_note_stale: stale }));
store.close();
