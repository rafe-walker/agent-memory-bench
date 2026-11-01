// Shared helpers for round-2 hardening probes (track 1: correctness of what kronicle-lite tells agents).
// usage from a probe: import { openKl, edits } from './r2-lib.mjs'   (env KL=<kronicle-lite checkout with dist/>)
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Sandbox: pin HOME and the default data dir to temp paths so nothing can fall back to ~/.kronicle-lite.
{
  const sb = mkdtempSync(join(tmpdir(), 'klr2-sandbox-'));
  process.env.HOME = join(sb, 'home');
  process.env.KRONICLE_LITE_DATA_DIR = join(sb, 'no-default-store');
  process.on('exit', () => rmSync(sb, { recursive: true, force: true }));
}
export const KL = process.env.KL;
if (!KL) { console.error('set KL=<kronicle-lite checkout with dist/>'); process.exit(2); }
export const mod = await import(pathToFileURL(join(KL, 'dist/index.js')).href);

/** A fresh store in a temp dir; returns { kl, dir, done() }. */
export function openKl(prefix = 'klr2-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const kl = new mod.KronicleLite({ dataDir: dir });
  return { kl, dir, done() { try { kl.close(); } catch {} rmSync(dir, { recursive: true, force: true }); } };
}

/**
 * End-to-end classification of many (old, new) single-block edits in one store:
 * put every v1, take a cursor, put every v2, orient --focus retractions with format-only included.
 * Returns per case: { id, format_only, in_retractions, kinds, note }.
 * Each case is a whole document; both versions must parse to the same block count/paths for a clean supersession,
 * but the verdict is read from what orient says about the slug, whatever happened.
 */
export function classifyE2E(cases, { mutants = [] } = {}) {
  const { kl, done } = openKl();
  if (mutants.length && !mod.__mutants) throw new Error('__mutants is not exported from dist/index.js; mutation runs need the src build (vitest)');
  for (const m of mutants) mod.__mutants.add(m);
  try {
    const slug = (i) => `c${i}`;
    cases.forEach((c, i) => kl.docs.putDocument({ slug: slug(i), title: 't', markdown: c.old, actor_id: 'w' }));
    const cur = kl.orient.getSystemState({ actor_id: 'agent', focus: 'pulse' }).cursor;
    cases.forEach((c, i) => kl.docs.putDocument({ slug: slug(i), title: 't', markdown: c.new, actor_id: 'w' }));
    const def = kl.orient.getSystemState({ actor_id: 'agent', since_cursor: cur, focus: 'retractions' });
    const all = kl.orient.getSystemState({ actor_id: 'agent2', since_cursor: cur, focus: 'retractions', include_format_only: true });
    return cases.map((c, i) => {
      const s = slug(i);
      const real = def.retractions.filter((r) => r.doc_slug === s);
      const fo = (def.format_only_edits ?? []).filter((r) => r.doc_slug === s);
      const anyEvt = all.retractions.filter((r) => r.doc_slug === s);
      return { ...c, in_retractions: real.length, format_only_listed: fo.length, any_event: anyEvt.length, kinds: real.map((r) => r.kind) };
    });
  } finally {
    for (const m of mutants) mod.__mutants?.delete(m);
    done();
  }
}

/** Deterministic PRNG. */
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
