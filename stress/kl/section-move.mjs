#!/usr/bin/env node
// A paragraph moved, byte-identical, from "## Allowed" to "## Forbidden" is carried by
// content hash (planRevision step 1 ignores heading_path): no retraction, receipt stays VERIFIED.
// usage: KL=<kl checkout> node stress/kl/section-move.mjs   (exit 1 = no signal for a meaning flip)
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const { KronicleLite } = await import(pathToFileURL(join(process.env.KL, 'dist/index.js')).href);
const dir = mkdtempSync(join(tmpdir(), 'klm-'));
const kl = new KronicleLite({ dataDir: dir });
const v1 = '# Ops policy\n\n## Allowed\n\nRestart the web tier.\n\nForce-push to the release branch.\n\n## Forbidden\n\nDrop production tables.\n';
const v2 = '# Ops policy\n\n## Allowed\n\nRestart the web tier.\n\n## Forbidden\n\nDrop production tables.\n\nForce-push to the release branch.\n';
kl.docs.putDocument({ slug: 'policy', title: 'Ops policy', markdown: v1, actor_id: 'w' });
const c0 = kl.orient.getSystemState({ actor_id: 'agent', focus: 'pulse' }).cursor;
const r1 = kl.recall.recall({ query: 'force push release branch', actor_id: 'agent' });
const hit = r1.hits[0];
const before = { heading: hit.heading_path, receipt: hit.receipt_id ?? hit.receipt };
kl.docs.putDocument({ slug: 'policy', title: 'Ops policy', markdown: v2, actor_id: 'w' });
const s = kl.orient.getSystemState({ actor_id: 'agent', since_cursor: c0, focus: 'retractions' });
const r2 = kl.recall.recall({ query: 'force push release branch', actor_id: 'agent' });
const v = kl.verifier.verify(before.receipt ?? hit.receipt);
const out = {
  recalled_under_v1: before.heading,
  recalled_under_v2: r2.hits[0]?.heading_path,
  v2_authority: r2.hits[0]?.authority,
  retractions: s.retractions.map((r) => [r.kind, r.old_text, r.new_text]),
  cosmetic_edits: (s.cosmetic_edits ?? []).length,
  old_receipt: [v.status, v.reason],
  full_orient_changes: kl.orient.getSystemState({ actor_id: 'agent2', since_cursor: c0, response_format: 'json' }).delta,
};
console.log(JSON.stringify(out, null, 1));
kl.close(); rmSync(dir, { recursive: true, force: true });
const flipped = !s.retractions.some((r) => /force-push/i.test(`${r.old_text} ${r.new_text}`));
process.exit(flipped ? 1 : 0);
