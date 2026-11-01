// kronicle-lite `shims` branch (unreleased, on 0.7.0): exec-time pulse shims on PATH.
// Same MCP adapter as the other kronicle-lite arms (orient at session start, recall, FileChanged
// hook sync), plus `kronicle-lite shim install --commands terraform` into an isolated HOME and a
// stub `terraform` that logs its argv. The agent's shell is shellEnv(): the shim dir first on PATH.
//   KL_SHIMS_PKG  built package dir (default: <bench>/.arms-shims/kronicle-lite-shims, made by
//                 track-a/setup-kl-shims.sh)
import fs from 'node:fs';
import path from 'node:path';
import KronicleLite from './kronicle-lite.mjs';
import { view } from './_base.mjs';
import { ROOT, sh } from '../lib/util.mjs';

const PKG = process.env.KL_SHIMS_PKG || path.join(ROOT, '.arms-shims', 'kronicle-lite-shims');
let snap = 'local build'; try { snap = fs.readFileSync(path.join(PKG, 'SNAPSHOT'), 'utf8').trim(); } catch {}
const SYS_PATH = '/usr/local/bin:/usr/bin:/bin';

export default class KronicleLiteShims extends KronicleLite {
  static pkg = PKG;
  static cli = path.join(PKG, 'dist', 'cli.js');
  static meta = {
    ...KronicleLite.meta,
    id: 'kronicle-lite-shims',
    label: 'kronicle-lite + exec-time shims (unreleased)',
    version: `shims unreleased — ${snap}`,
    kind: ['knowledge', 'compaction', 'exec-gate'],
    setupSteps: [...KronicleLite.meta.setupSteps, 'kronicle-lite shim install --commands terraform', 'export PATH="$HOME/.kronicle-lite/shims:$PATH" (shell profile / agent environment)'],
    notes: 'MCP stdio + PATH shims. Isolated HOME; the shim dir and a stub terraform live under it.',
  };
  get shimDir() { return path.join(this.ctx.home, 'shims'); }
  get binDir() { return path.join(this.ctx.home, 'bin'); }
  get stubLog() { return path.join(this.ctx.home, 'terraform.log'); }
  async setup() {
    await super.setup(); // starts `serve`, which creates the store
    fs.mkdirSync(this.binDir, { recursive: true });
    const stub = path.join(this.binDir, 'terraform');
    fs.writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${this.stubLog}'\necho "terraform (stub): $*"\n`);
    fs.chmodSync(stub, 0o755);
    const r = sh(process.execPath, [this.cli, 'shim', 'install', '--dir', this.shimDir, '--data-dir', this.dataDir, '--commands', 'terraform'], { env: this.env, cwd: this.ctx.repo });
    if (r.code !== 0) throw new Error(`shim install failed: ${r.stderr.slice(-400)}`);
  }
  // The environment of the agent's shell: shim dir first (or not, for the control run).
  shellEnv({ shims = true } = {}) {
    return { ...this.env, PATH: [...(shims ? [this.shimDir] : []), this.binDir, path.dirname(process.execPath), SYS_PATH].join(':') };
  }
  // What the FileChanged hook runs, as a script a long command can call mid-way (variant b).
  syncHookScript(file) {
    const p = path.join(this.ctx.home, 'sync-hook.sh');
    const input = JSON.stringify({ hook_event_name: 'FileChanged', file_path: path.join(this.ctx.repo, file), cwd: this.ctx.repo, session_id: 'bench' });
    const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
    fs.writeFileSync(p, `#!/bin/sh\nprintf '%s' ${q(input)} | env HOME=${q(this.env.HOME)} KRONICLE_LITE_DATA_DIR=${q(this.dataDir)} ${q(process.execPath)} ${q(this.cli)} put --from-instructions --stdin-hook --cwd ${q(this.ctx.repo)} >/dev/null\n`);
    fs.chmodSync(p, 0o755);
    return p;
  }
  stubCalls() { try { return fs.readFileSync(this.stubLog, 'utf8').split('\n').filter(Boolean); } catch { return []; } }
  // The reconcile step the denial asks for: `kronicle-lite shim ack --through SEQ` in the project.
  async shimAck(through) {
    const r = sh(process.execPath, [this.cli, 'shim', 'ack', '--dir', this.shimDir, ...(through != null ? ['--through', String(through)] : [])], { env: this.shellEnv(), cwd: this.ctx.repo });
    if (r.code !== 0) throw new Error(`shim ack failed: ${r.stderr.slice(-300)}`);
    return view(r.stdout, r.ms, 1);
  }
}
