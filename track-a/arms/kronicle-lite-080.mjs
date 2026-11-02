// kronicle-lite 0.8.0 as released (main @ 7e50702), built from git like the 0.8.1 candidate, as the
// before-arm for the 0.8.1 comparison. Same adapter as the next-release arm.
//   KL_080_PKG  built package dir (default: <bench>/.arms-081/kronicle-lite-080, made by
//               KL_REF=7e50702 KL_OUT=<that dir> track-a/setup-kl-081.sh)
import fs from 'node:fs';
import path from 'node:path';
import KronicleLiteNextRelease from './kronicle-lite-next-release.mjs';
import { ROOT } from '../lib/util.mjs';

const PKG = process.env.KL_080_PKG || path.join(ROOT, '.arms-081', 'kronicle-lite-080');
let snap = 'local build'; try { snap = fs.readFileSync(path.join(PKG, 'SNAPSHOT'), 'utf8').trim(); } catch {}

export default class KronicleLite080 extends KronicleLiteNextRelease {
  static pkg = PKG;
  static cli = path.join(PKG, 'dist', 'cli.js');
  static meta = {
    ...KronicleLiteNextRelease.meta,
    id: 'kronicle-lite-080',
    label: 'kronicle-lite 0.8.0 (git build)',
    version: `0.8.0 — ${snap}`,
  };
}
