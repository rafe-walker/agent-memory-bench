// kronicle-lite `next-release` (0.8.0 candidate: lineage + shims merged on 0.7.0, the shim gate on
// version-bound reconciliation, bounded lineage inference). Same adapter as the lineage and shims
// arms: MCP stdio, the agent never declares lineage (`remember` passes its cursor), and for S16
// `kronicle-lite shim install --commands terraform` into the isolated HOME.
//   KL_NEXT_PKG  built package dir (default: <bench>/.arms-next-release/kronicle-lite-next-release,
//                made by track-a/setup-kl-next-release.sh)
import fs from 'node:fs';
import path from 'node:path';
import KronicleLiteShims from './kronicle-lite-shims.mjs';
import { ROOT } from '../lib/util.mjs';

const PKG = process.env.KL_NEXT_PKG || path.join(ROOT, '.arms-next-release', 'kronicle-lite-next-release');
let snap = 'local build'; try { snap = fs.readFileSync(path.join(PKG, 'SNAPSHOT'), 'utf8').trim(); } catch {}

export default class KronicleLiteNextRelease extends KronicleLiteShims {
  static pkg = PKG;
  static cli = path.join(PKG, 'dist', 'cli.js');
  static meta = {
    ...KronicleLiteShims.meta,
    id: 'kronicle-lite-next-release',
    label: 'kronicle-lite next-release (0.8.0 candidate)',
    version: `next-release — ${snap}`,
  };
}
