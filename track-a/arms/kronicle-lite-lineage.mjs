// kronicle-lite `lineage` branch (derived-note lineage + version-bound reconciliation, unreleased,
// on 0.7.0): a build of a ref snapshot made by track-a/setup-kl-lineage.sh (git archive of the ref →
// $KL_LINEAGE_PKG, built). Same adapter as the 0.5.0 / 0.6.0 / next arms — the agent loop does not
// declare lineage; `remember` passes the cursor as before, so any lineage is inferred by the tool.
//   KL_LINEAGE_PKG  built package dir (default: <bench>/.arms-lineage/kronicle-lite-lineage)
import path from 'node:path';
import fs from 'node:fs';
import KronicleLite from './kronicle-lite.mjs';
import { ROOT } from '../lib/util.mjs';

const PKG = process.env.KL_LINEAGE_PKG || path.join(ROOT, '.arms-lineage', 'kronicle-lite-lineage');
let snap = 'local build'; try { snap = fs.readFileSync(path.join(PKG, 'SNAPSHOT'), 'utf8').trim(); } catch {}

export default class KronicleLiteLineage extends KronicleLite {
  static pkg = PKG;
  static cli = path.join(PKG, 'dist', 'cli.js');
  static meta = { ...KronicleLite.meta, id: 'kronicle-lite-lineage', label: 'kronicle-lite lineage (unreleased, on 0.7.0)', version: `lineage unreleased — ${snap}` };
}
