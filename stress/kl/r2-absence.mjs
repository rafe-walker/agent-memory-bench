#!/usr/bin/env node
// Round 2, (f) honest absence: a live block exists, but its full-text row was rewritten (same row count, e.g. a bad
// partial restore of the FTS shadow tables). Does recall certify absence ("absent_in_searched") and orient stay ok?
// usage: KL=<kl checkout> node stress/kl/r2-absence.mjs      exit 1 = certified absence of a live block
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { KL, openKl } from './r2-lib.mjs';
const { kl, dir, done } = openKl();
kl.docs.putDocument({ slug: 'r', title: 'R', markdown: '# R\n\nNever deploy to zebracluster on Fridays.\n', actor_id: 'o' });
const before = kl.recall.recall({ query: 'zebracluster', actor_id: 'a' });
const row = kl.db.prepare("SELECT rowid FROM blocks_fts WHERE blocks_fts MATCH 'zebracluster'").get();
const cols = kl.db.prepare('PRAGMA table_info(blocks_fts)').all().map((c) => c.name);
const textCol = cols.find((c) => /content|text|body/.test(c)) ?? cols[0];
kl.db.prepare(`UPDATE blocks_fts SET ${textCol} = 'Never deploy on Fridays.' WHERE rowid = ?`).run(row.rowid);
const after = kl.recall.recall({ query: 'zebracluster', actor_id: 'a' });
const o = kl.orient.getSystemState({ actor_id: 'a', focus: 'orientation' });
const live = kl.db.prepare("SELECT count(*) n FROM blocks WHERE content LIKE '%zebracluster%' AND valid_to IS NULL").get().n;
const out = { fts_cols: cols, before_hits: before.hits.length, after_hits: after.hits.length, live_blocks_with_term: live, verdict: after.absence.verdict, index_fresh: after.absence.index_fresh, orient_integrity_ok: o.integrity?.ok, verify_all_ok: kl.verifyAll().ok };
kl.close();
let doc;
try { doc = JSON.parse(execFileSync('node', [join(KL, 'dist/cli.js'), 'doctor', '--data-dir', dir, '--json', '--no-network'], { encoding: 'utf8' })); } catch (e) { doc = JSON.parse(e.stdout); }
out.doctor = { ok: doc.ok, fts: JSON.stringify((doc.checks ?? []).filter((c) => /fts|index/i.test(JSON.stringify(c)))).slice(0, 300), failed: (doc.checks ?? []).filter((c) => c.status !== "ok" && c.status !== "pass" && c.ok !== true).map((c) => `${c.id ?? c.name}:${c.status}`) };
console.log(JSON.stringify(out));
done();
process.exit(out.verdict === 'absent_in_searched' && live > 0 ? 1 : 0);
