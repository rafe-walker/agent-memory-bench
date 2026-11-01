#!/usr/bin/env node
// Round 2, attack (b): section moves / renames / re-levels / block identity under re-put and re-import.
// For each case: put v1, agent recalls, hook cursor, put v2 -> what orient (retractions, include format-only) and
// pending say. A case labelled S (meaning changed) with no retraction and no pending is a candidate finding.
// usage: KL=<kl checkout> node stress/kl/r2-sections.mjs [--only ID]
import { PassThrough } from 'node:stream';
import { openKl } from './r2-lib.mjs';

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const CASES = [
  ['B01', 'S', '# Ops\n\n## Build with C#\n\nRun the build.\n', '# Ops\n\n## Build with C\n\nRun the build.\n', 'heading C# -> C (trailing # stripped)'],
  ['B02', 'S', '# Ops\n\n## Steps\n\n```sh\nkubectl drain node-1\n```\n\n```sh\nkubectl delete node node-1\n```\n', '# Ops\n\n## Steps\n\n```sh\nkubectl delete node node-1\n```\n\n```sh\nkubectl drain node-1\n```\n', 'two code blocks swapped in one section (order of operations)'],
  ['B03', 'S', '# Ops\n\n## Procedure\n\nFirst: stop the writer.\n\nThen: snapshot the database.\n', '# Ops\n\n## Procedure\n\nThen: snapshot the database.\n\nFirst: stop the writer.\n', 'paragraphs reordered in one section'],
  ['B04', 'C', '# Ops\n\n## Allowed\n\nRestart the web tier.\n\n## Forbidden\n\nDrop tables.\n\n## Allowed\n\nForce-push release.\n', '# Ops\n\n## Allowed\n\nRestart the web tier.\n\nForce-push release.\n\n## Forbidden\n\nDrop tables.\n\n## Allowed\n', 'duplicate heading path: block moves between two "Allowed" sections (same meaning)'],
  ['B05', 'C', '# Ops\n\n## Prod > Allowed\n\nForce-push release.\n\n## Prod\n\n### Forbidden\n', '# Ops\n\n## Prod > Allowed\n\n## Prod\n\n### Forbidden\n\nForce-push release.\n', 'path join collision? (" > " in heading text) — control: different paths'],
  ['B06', 'C', '# Ops\n\n## Prod\n\n### Allowed\n\nx\n\n## Prod > Allowed\n\nForce-push release.\n', '# Ops\n\n## Prod\n\n### Allowed\n\nx\n\nForce-push release.\n\n## Prod > Allowed\n', 'path join collision: [Ops, Prod > Allowed] vs [Ops, Prod, Allowed]'],
  ['B07', 'S', '# Ops\n\n## Production\n\nDeploy at 09:00.\n\n### Staging\n\nDeploy anytime.\n', '# Ops\n\n## Production\n\nDeploy at 09:00.\n\n## Staging\n\nDeploy anytime.\n', 'heading re-level ### -> ## (Staging no longer under Production)'],
  ['B08', 'C', '# Ops\n\n## Steps\n\nRun the build.\n', '# Ops\n\n### Steps\n\nRun the build.\n', 're-level without nesting change (benign)'],
  ['B09', 'C', '# Ops\n\n## Steps\n\nRun the build.\n', '# Ops\n\n## Steps ##\n\nRun the build.\n', 'closing hashes (CommonMark-equal, control)'],
  ['B10', 'S', '# Ops\n\n## Steps\n\n```\n## not a heading\nrm -rf /tmp/a\n```\n', '# Ops\n\n## Steps\n\n  ```\n## not a heading\nrm -rf /tmp/b\n  ```\n', 'indented fence: kronicle splits differently than CommonMark'],
  ['B11', 'S', '# Ops\n\n## Never\n\nForce-push main.\n', '# Ops\n\n## Never#\n\nForce-push main.\n', 'heading "Never#" vs "Never"'],
  ['B12', 'C', '# Ops\n\n## Port #\n\n8080\n', '# Ops\n\n## Port\n\n8080\n', 'heading "Port #" vs "Port" (CommonMark-equal: closing # after a space)'],
];

const results = [];
for (const [id, label, v1, v2, note] of CASES) {
  if (only && id !== only) continue;
  const { kl, done } = openKl();
  try {
    kl.docs.putDocument({ slug: 'ops', title: 'Ops', markdown: v1, actor_id: 'w' });
    kl.lineage.recordDocumentRead('agent', kl.docs.getDocument('ops').doc_id, 'document');
    const cur = kl.orient.getSystemState({ actor_id: 'hook', focus: 'pulse' }).cursor;
    const put = kl.docs.putDocument({ slug: 'ops', title: 'Ops', markdown: v2, actor_id: 'w' });
    const o = kl.orient.getSystemState({ actor_id: 'hook', since_cursor: cur, focus: 'retractions', include_format_only: true });
    const real = o.retractions.filter((r) => !r.format_only);
    const pend = kl.lineage.pending('agent');
    const stored = kl.docs.liveBlocks(kl.docs.getDocument('ops').doc_id).map((b) => `${b.kind}:${b.heading_path}|${b.content.slice(0, 30)}`);
    const quiet = real.length === 0 && pend.count === 0;
    results.push({ id, label, note, retractions: real.length, format_only: o.retractions.length - real.length, pending: pend.count, events: put.head?.seq ?? null, finding: label === 'S' && quiet, stored: quiet ? stored : undefined });
  } finally { done(); }
}

// Re-import identity: export -> import into a fresh store keeps block ids, lineage, receipts and pending.
if (!only || only === 'R01') {
  const a = openKl();
  const b = openKl();
  try {
    a.kl.docs.putDocument({ slug: 'ops', title: 'Ops', markdown: '# Ops\n\n## Steps\n\nDeploy to staging-a.\n', actor_id: 'w' });
    a.kl.orient.getSystemState({ actor_id: 'agent', focus: 'pulse' });
    a.kl.recall.recall({ query: 'deploy staging', actor_id: 'agent' });
    a.kl.docs.putDocument({ slug: 'note', title: 'Note', markdown: '# Note\n\nWe use staging-a.\n', actor_id: 'agent' });
    a.kl.docs.putDocument({ slug: 'ops', title: 'Ops', markdown: '# Ops\n\n## Steps\n\nDeploy to staging-b.\n', actor_id: 'w' });
    const before = { stale: a.kl.lineage.staleness(a.kl.docs.getDocument('note').doc_id).length, pending: a.kl.lineage.pending('agent').count };
    const pt = new PassThrough();
    let buf = '';
    pt.on('data', (d) => (buf += d));
    a.kl.exportEvents(pt);
    pt.end();
    const src = new PassThrough();
    src.end(buf);
    await b.kl.importEvents(src);
    const after = { stale: b.kl.lineage.staleness(b.kl.docs.getDocument('note').doc_id).length, pending: b.kl.lineage.pending('agent').count };
    const ids = (k) => k.docs.liveBlocks(k.docs.getDocument('ops').doc_id).map((x) => x.block_id).join(',');
    results.push({ id: 'R01', label: 'I', note: 'export/import keeps block ids + lineage; pending is local (reads not chained, documented FORMAT §4.2)', same_block_ids: ids(a.kl) === ids(b.kl), before, after, finding: ids(a.kl) !== ids(b.kl) || after.stale !== before.stale });
  } finally { a.done(); b.done(); }
}
for (const r of results) console.log(JSON.stringify(r));
process.exit(results.some((r) => r.finding) ? 1 : 0);
