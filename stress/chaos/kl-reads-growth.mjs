#!/usr/bin/env node
// Does per-call cost grow with an actor's read log? A long-lived agent's recall hits all land in the
// local `reads` table (never pruned) and every get_system_state computes `pending` for that actor.
// In-process on a COPY of a pre-built store: time getSystemState(focus pulse) + lineage.pending for one
// actor as its reads grow (recall loops), vs a fresh actor at the same head.
// usage: KL=<kl pkg dir> node stress/chaos/kl-reads-growth.mjs --store DIR [--steps 0,2000,10000,30000]
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const { KronicleLite } = await import(pathToFileURL(join(process.env.KL, 'dist/index.js')).href);
const dir = mkdtempSync(join(tmpdir(), 'klrg-')); cpSync(arg('--store'), dir, { recursive: true });
const kl = new KronicleLite({ dataDir: dir });
const steps = arg('--steps', '0,2000,10000,30000').split(',').map(Number);
const t = (f, n = 5) => { const a = []; for (let i = 0; i < n; i++) { const s = performance.now(); f(); a.push(performance.now() - s); } return Math.round(a.sort((x, y) => x - y)[Math.floor(n / 2)]); };
let reads = 0; const rows = [];
for (const target of steps) {
  while (reads < target) { const r = kl.recall.recall({ query: `team-${reads % 37} host`, top_k: 10, actor_id: 'heavy', all_projects: true }); reads += r.hits.length || 1; }
  const n = kl.db.prepare('select count(*) c from reads where actor_id = ?').get('heavy').c;
  rows.push({ reads_rows: n, pending_ms_heavy: t(() => kl.lineage.pending('heavy')), pending_ms_fresh: t(() => kl.lineage.pending('fresh')),
    gss_pulse_ms_heavy: t(() => kl.orient.getSystemState({ actor_id: 'heavy', focus: 'pulse', all_projects: true }), 3), gss_pulse_ms_fresh: t(() => kl.orient.getSystemState({ actor_id: 'fresh', focus: 'pulse', all_projects: true }), 3) });
  console.log(JSON.stringify(rows.at(-1)));
}
kl.close(); rmSync(dir, { recursive: true, force: true });
