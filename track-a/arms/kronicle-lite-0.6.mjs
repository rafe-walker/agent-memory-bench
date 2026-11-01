// kronicle-lite 0.6.0, UNRELEASED: a build of the local repo's HEAD (git archive → .arms/kronicle-lite-local,
// see its SNAPSHOT file). Same adapter as the 0.5.0 arm, so score differences come from the tool.
// 0.6 adds: per-hit authority tags + authority_floor, honest absence, attention rerank, secret guard
// on write, recall max_chars caps, `serve --core` (6 tools).
import path from 'node:path';
import fs from 'node:fs';
import KronicleLite from './kronicle-lite.mjs';
import { ARMS_DIR } from '../lib/util.mjs';

const PKG = path.join(ARMS_DIR, 'kronicle-lite-local');
let snap = 'local build'; try { snap = fs.readFileSync(path.join(PKG, 'SNAPSHOT'), 'utf8').trim(); } catch {}

export default class KronicleLite06 extends KronicleLite {
  static pkg = PKG;
  static cli = path.join(PKG, 'dist', 'cli.js');
  static meta = { ...KronicleLite.meta, id: 'kronicle-lite-0.6', label: 'kronicle-lite 0.6.0 (unreleased)', version: `0.6.0 unreleased — ${snap}` };
}
