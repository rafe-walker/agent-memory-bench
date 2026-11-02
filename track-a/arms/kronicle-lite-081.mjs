// kronicle-lite 0.8.1 candidate (branch `fix-0.8.1`): raw-text format-only rule (R2-01..03),
// reorders within a section retract, `## Use C#` keeps its `#`, lineage inference over the cursor
// chain, staleness-memo / typo-hint / long-diff fixes. Same adapter as the next-release arm.
//   KL_081_PKG  built package dir (default: <bench>/.arms-081/kronicle-lite-081, made by
//               track-a/setup-kl-081.sh)
import fs from 'node:fs';
import path from 'node:path';
import KronicleLiteNextRelease from './kronicle-lite-next-release.mjs';
import { ROOT } from '../lib/util.mjs';

const PKG = process.env.KL_081_PKG || path.join(ROOT, '.arms-081', 'kronicle-lite-081');
let snap = 'local build'; try { snap = fs.readFileSync(path.join(PKG, 'SNAPSHOT'), 'utf8').trim(); } catch {}

export default class KronicleLite081 extends KronicleLiteNextRelease {
  static pkg = PKG;
  static cli = path.join(PKG, 'dist', 'cli.js');
  static meta = {
    ...KronicleLiteNextRelease.meta,
    id: 'kronicle-lite-081',
    label: 'kronicle-lite 0.8.1 candidate',
    version: `0.8.1 candidate — ${snap}`,
  };
}
