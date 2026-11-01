#!/usr/bin/env node
// Round 2, (e) wording: does a retraction of a long block show WHAT changed? A block over 400 tokens (~200 words,
// e.g. a 40-line deploy script) falls back to snippets of the first ~190 characters, identical when the change
// is further down. usage: KL=<kl checkout> node stress/kl/r2-diff.mjs     exit 1 = the change is invisible
import { openKl } from './r2-lib.mjs';
const { kl, done } = openKl();
const lines = Array.from({ length: 45 }, (_, i) => `step_${i}: run check --id ${i} --verbose`);
const v1 = '# Deploy\n\n```sh\n' + lines.join('\n') + '\n./bin/deploy --target staging-a\n```\n';
const v2 = v1.replace('--target staging-a', '--target prod-eu');
kl.docs.putDocument({ slug: 'deploy', title: 'Deploy', markdown: v1, actor_id: 'ops' });
kl.recall.recall({ query: 'deploy target', actor_id: 'agent' });
const c = kl.orient.getSystemState({ actor_id: 'hook', focus: 'pulse' }).cursor;
kl.docs.putDocument({ slug: 'deploy', title: 'Deploy', markdown: v2, actor_id: 'ops' });
const r = kl.orient.getSystemState({ actor_id: 'hook', since_cursor: c, focus: 'retractions' }).retractions[0];
const p = kl.lineage.pending('agent').items[0];
const visible = (s) => s != null && /prod-eu/.test(s);
const out = { retractions: r ? 1 : 0, diff_shows_change: visible(r?.diff), new_text_shows_change: visible(r?.new_text), reason_line_shows_change: visible(r?.reason_line), old_eq_new: r?.old_text === r?.new_text, pending_diff_shows_change: visible(p?.diff), diff: r?.diff?.slice(0, 120) };
console.log(JSON.stringify(out));
done();
process.exit(out.diff_shows_change || out.new_text_shows_change || out.reason_line_shows_change ? 0 : 1);
