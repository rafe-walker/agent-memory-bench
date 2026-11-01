// A4: beads (`bd`) 1.3.2 via the @beads/bd npm package (prebuilt binary; `go install` fails here on a
// missing ICU header). Per-repo .beads/ store (embedded Dolt). Claims: `bd update <id> --claim`
// (atomic, anti-steal, 5-minute lease kept alive by `bd heartbeat`; a supervisor runs `bd reclaim`).
// beads has no path-scoped claims and no edit hook.
import path from 'node:path';
import { Arm, view } from './_base.mjs';
import { ARMS_DIR, sh, shAsync } from '../lib/util.mjs';

const BD = path.join(ARMS_DIR, 'node_modules', '@beads', 'bd', 'bin', 'bd');

export default class Beads extends Arm {
  static meta = {
    id: 'beads', label: 'beads (bd)', version: '1.3.2 (@beads/bd npm)', kind: ['coordination'],
    setupSteps: ['npm i -g @beads/bd (or brew/go install)', 'bd init', 'bd setup claude (hooks: bd prime)', 'agents use bd ready / bd update --claim / bd close'],
    claims: true, leases: true, editGuard: null, notes: 'CLI driven (agents call bd through Bash); the separate beads-mcp 1.3.2 Python server is measured in S14 only.',
    s13: { lease: 300, duration: 310, tickMs: 5000 }, reps: { S13: 1 }, slow: { S13: true },
  };
  get env() { return { ...process.env, HOME: this.ctx.home, BD_NON_INTERACTIVE: '1', CI: '1' }; }
  bd(args, opts = {}) { return sh(BD, args, { cwd: this.ctx.repo, env: this.env, timeout: 120000, ...opts }); }
  bdAsync(args) { return shAsync(BD, args, { cwd: this.ctx.repo, env: this.env, timeout: 120000 }); }
  actorArgs(agent) { return this.ctx.identity === 'default' ? [] : ['--actor', agent]; }
  async setup() { const r = this.bd(['init', '--quiet', '--non-interactive']); if (r.code !== 0) throw new Error(`bd init: ${r.stderr.slice(-300)}`); }
  async createItem({ title }) {
    const r = this.bd(['q', title]);
    const id = r.stdout.trim().split('\n').pop();
    if (!id) throw new Error(`bd q: ${r.stderr.slice(-200)}`);
    return { id, view: view(r.stdout, r.ms, 1) };
  }
  async claim(agent, { id }) {
    const r = await this.bdAsync(['update', id, '--claim', ...this.actorArgs(agent), '--json']);
    const out = r.stdout + r.stderr;
    const granted = !/already claimed|failed to update|Error/i.test(out) && r.code === 0;
    return { granted, view: view(out, r.ms, 1) };
  }
  async claimScope(agent, { title }) { return { granted: true, scopeless: true, view: view('beads claims are per issue; there is no path scope to conflict on', 0, 0) }; }
  async holderWrite(agent, { id }) { const r = this.bd(['heartbeat', id, ...this.actorArgs(agent)]); return { ok: r.code === 0 && !/error|fail/i.test(r.stderr), view: view(r.stdout + r.stderr, r.ms, 1) }; }
  async tick() {}
  async concurrentCreate(n) {
    const rs = await Promise.all(Array.from({ length: n }, (_, i) => this.bdAsync(['q', `parallel ${i}`])));
    const ids = rs.map((r) => r.stdout.trim().split('\n').pop()).filter((x) => x && !/\s/.test(x));
    const list = this.bd(['list', '--json', '--limit', '0']);
    const present = ids.filter((id) => list.stdout.includes(`"${id}"`)).length;
    return { ids, present, errors: rs.filter((r) => r.code !== 0).length };
  }
  storeDirs() { return [path.join(this.ctx.repo, '.beads')]; }
}
