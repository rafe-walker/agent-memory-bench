// S12 retrieval at scale: N synthetic service docs, each with one unique "needle" fact.
// Measures ingest wall time, per-query latency (p50/p95), bytes returned per query, and whether
// the needle value is in what the agent sees (hit, top-5 / top hit read). No LLM, no judging.
import fs from 'node:fs';
import path from 'node:path';
import { scaleCorpus } from '../lib/fixtures.mjs';
import { mulberry32 } from '../lib/rng.mjs';
import { rate, latency, tokens } from '../lib/stats.mjs';
import { tmpdir, rmrf, writeFiles, gitInit, sh } from '../lib/util.mjs';

function dirBytes(p) { let n = 0; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); if (e.isDirectory()) walk(q); else try { n += fs.statSync(q).size; } catch {} } }; try { walk(p); } catch {} return n; }

export const S12 = {
  id: 'S12', title: 'Retrieval at scale (1k–10k docs: latency + bytes)',
  arms: ['baseline', 'kronicle-lite', 'kronicle-lite-0.6', 'kronicle-lite-0.6-core', 'kronicle-lite-next', 'basic-memory', 'server-memory'],
  async run(Arm, { size, queries = 20, seed = 42 }) {
    const docs = scaleCorpus(size, seed);
    const home = tmpdir(`S12-${Arm.meta.id.replace(/[^a-z0-9]/gi, '')}-${size}`);
    const ctx = { home, repo: path.join(home, 'repo'), seed, actor: 'agent-a', project: 'repo' };
    gitInit(ctx.repo);
    writeFiles(ctx.repo, Object.fromEntries(docs.map((d) => [d.path, d.text])));
    const corpusBytes = docs.reduce((a, d) => a + Buffer.byteLength(d.text), 0);
    const arm = new Arm(ctx);
    try {
      const t0 = performance.now();
      await arm.setup();
      const ing = await arm.ingest(docs.map((d) => d.path), { bulkDir: 'docs/services' });
      const ingestMs = performance.now() - t0;
      const rng = mulberry32(seed + size);
      const picks = Array.from({ length: queries }, () => docs[Math.floor(rng.next() * docs.length)]);
      const ms = [], bytes = [];
      let hits = 0;
      for (const d of picks) {
        const v = await arm.read({ text: `rotation key ${d.name}`, grep: `${d.name}\\b`, keyword: d.name });
        ms.push(v.ms); bytes.push(v.bytes);
        if (v.text.includes(d.val)) hits++;
      }
      const storeBytes = arm.storeDirs().reduce((a, p) => a + (fs.existsSync(p) ? (fs.statSync(p).isDirectory() ? dirBytes(p) : fs.statSync(p).size) : 0), 0);
      return {
        n: queries, hits, hit_rate: rate(hits, queries), latency_ms: latency(ms), bytes_mean: Math.round(bytes.reduce((a, b) => a + b, 0) / bytes.length), tokens_mean: tokens(Math.round(bytes.reduce((a, b) => a + b, 0) / bytes.length)),
        bytes_max: Math.max(...bytes), ingest_ms: ingestMs, corpus_bytes: corpusBytes, store_bytes: storeBytes || null, store_over_corpus: storeBytes ? +(storeBytes / corpusBytes).toFixed(2) : null,
      };
    } finally {
      try { await arm.close(); } catch {}
      if (Arm.closeShared) await Arm.closeShared(ctx.sharedKey);
      rmrf(home);
    }
  },
};
