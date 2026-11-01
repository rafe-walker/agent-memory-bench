// kronicle-lite `next` branch (unreleased fixes on top of 0.6.0): a build of the branch
// snapshot made by track-a/setup-kl-next.sh (git archive of the ref → $KL_NEXT_PKG, built).
// Same adapter as the 0.5.0 / 0.6.0 arms, so score differences come from the tool.
//   KL_NEXT_PKG  built package dir (default: <bench>/.arms-next/kronicle-lite-next)
import path from 'node:path';
import fs from 'node:fs';
import KronicleLite from './kronicle-lite.mjs';
import { ROOT } from '../lib/util.mjs';

const PKG = process.env.KL_NEXT_PKG || path.join(ROOT, '.arms-next', 'kronicle-lite-next');
let snap = 'local build'; try { snap = fs.readFileSync(path.join(PKG, 'SNAPSHOT'), 'utf8').trim(); } catch {}

export default class KronicleLiteNext extends KronicleLite {
  static pkg = PKG;
  static cli = path.join(PKG, 'dist', 'cli.js');
  static meta = { ...KronicleLite.meta, id: 'kronicle-lite-next', label: 'kronicle-lite next (unreleased, on 0.6.0)', version: `next unreleased — ${snap}` };
}
