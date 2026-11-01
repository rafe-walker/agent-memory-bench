#!/usr/bin/env node
// Round 2, (a)/(f) robustness: one supersession whose only change is one letter in a long letters-only token.
// classifyEdit -> looksLikeTypo -> editDistance builds an (m+1)x(n+1) array for that word. Measures orient / pending
// time and memory as the word grows. usage: KL=<kl checkout> node stress/kl/r2-longword.mjs [len…]
import { openKl } from './r2-lib.mjs';
const lens = process.argv.slice(2).map(Number).filter(Boolean);
for (const n of lens.length ? lens : [1000, 4000, 8000]) {
  const { kl, done } = openKl();
  try {
    let w = ''; let x = 1; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; w += String.fromCharCode(97 + (x % 26)); }
    const w2 = w.slice(0, -1) + (w.at(-1) === 'a' ? 'b' : 'a');
    kl.docs.putDocument({ slug: 'k', title: 'K', markdown: `# K\n\nFingerprint ${w} is trusted.\n`, actor_id: 'w' });
    kl.recall.recall({ query: 'fingerprint trusted', actor_id: 'agent' });
    const c = kl.orient.getSystemState({ actor_id: 'hook', focus: 'pulse' }).cursor;
    kl.docs.putDocument({ slug: 'k', title: 'K', markdown: `# K\n\nFingerprint ${w2} is trusted.\n`, actor_id: 'w' });
    const t0 = performance.now();
    const o = kl.orient.getSystemState({ actor_id: 'hook', since_cursor: c, focus: 'retractions' });
    const t1 = performance.now();
    const p = kl.lineage.pending('agent');
    const t2 = performance.now();
    console.log(JSON.stringify({ word_len: n, retractions: o.retractions.length, orient_ms: Math.round(t1 - t0), pending_ms: Math.round(t2 - t1), pending: p.count, rss_mb: Math.round(process.memoryUsage().rss / 1048576) }));
  } finally { done(); }
}
