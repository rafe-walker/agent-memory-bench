// A5: mcp_agent_mail 0.3.4 (Python; git HEAD 426d4f3 of Dicklesworthstone/mcp_agent_mail), one
// server per project storage root (the server refuses a second owner), agents identified by name.
// File reservations are advisory exclusive/shared globs with a TTL >= 60 s; the authoritative gate
// is the optional pre-commit guard (install_precommit_guard). No tickets / work queue.
import path from 'node:path';
import fs from 'node:fs';
import { Arm, view, mcpView } from './_base.mjs';
import { McpClient } from '../lib/mcp.mjs';
import { ARMS_DIR, sh, gitCommitAll } from '../lib/util.mjs';

const AM = path.join(ARMS_DIR, 'mcp_agent_mail');
const NAMES = ['GreenCastle', 'BlueLake', 'RedFox', 'SilverPine', 'AmberHill', 'CopperBay', 'JadeRiver', 'OnyxPeak', 'CoralMesa'];

export default class AgentMail extends Arm {
  static meta = {
    id: 'agent-mail', label: 'mcp_agent_mail', version: '0.3.4 (git 426d4f3)', kind: ['coordination'],
    setupSteps: ['git clone + uv sync (or the install script)', 'run the server (serve-http, or serve-stdio per client)', 'register each agent (macro_start_session)', 'WORKTREES_ENABLED=1 + install_precommit_guard for enforcement (the guard install is a no-op otherwise)'],
    claims: true, leases: true, editGuard: 'pre-commit', singleServer: true,
    s13: { lease: 60, duration: 70 }, reps: { S13: 1 }, slow: { S13: true },
  };
  get env() { return { ...process.env, HOME: this.ctx.home, STORAGE_ROOT: path.join(this.ctx.home, 'am'), DATABASE_URL: `sqlite+aiosqlite:///${this.ctx.home}/am.sqlite3`, WORKTREES_ENABLED: '1' }; }
  async setup() {
    if (this.ctx.shareWith) { this.mcp = this.ctx.shareWith.mcp; this.shared = true; await this.mcp.call('ensure_project', { human_key: this.ctx.repo }); this.names = new Map(); return; }
    this.mcp = await new McpClient(path.join(AM, '.venv', 'bin', 'python'), ['-m', 'mcp_agent_mail.cli', 'serve-stdio'], { env: this.env, cwd: AM }).start();
    await this.mcp.call('ensure_project', { human_key: this.ctx.repo });
    this.names = new Map();
  }
  async listTools() { return this.mcp.listTools(); }
  // Names are assigned synchronously so concurrent racers never share an identity.
  nameOf(agent) {
    if (this.names.has(agent)) return this.names.get(agent);
    const args = { project_key: this.ctx.repo, program: 'claude-code', model: 'bench' };
    if (this.ctx.identity !== 'default') args.name = NAMES[this.names.size % NAMES.length];
    const p = this.mcp.call('register_agent', args).then((r) => r.json?.name ?? args.name);
    this.names.set(agent, p);
    return p;
  }
  async createItem({ title, paths }) { return { id: paths.join(','), view: view('') }; } // no tickets: the reservation is the claim
  async claim(agent, { paths, lease = 3600 }) {
    const r = await this.mcp.call('file_reservation_paths', { project_key: this.ctx.repo, agent_name: await this.nameOf(agent), paths: paths.map((p) => `${p}/**`), ttl_seconds: Math.max(60, lease), exclusive: true, reason: 'bench' });
    const granted = (r.json?.granted ?? []).length > 0;
    const conflicts = (r.json?.conflicts ?? []).length;
    return { granted, conflictReported: conflicts > 0, view: mcpView(r) };
  }
  async claimScope(agent, o) { return this.claim(agent, o); }
  // Advisory: the edit itself is never blocked; the pre-commit guard is the gate.
  async tryEdit(agent, rel) {
    if (!this.guard) {
      const g = await this.mcp.call('install_precommit_guard', { project_key: this.ctx.repo, code_repo_path: this.ctx.repo });
      this.guard = g;
    }
    const abs = path.join(this.ctx.repo, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `// edited by ${agent}\n`);
    const env = { ...this.env, AGENT_NAME: await this.nameOf(agent), GIT_AUTHOR_NAME: 'b', GIT_AUTHOR_EMAIL: 'b@x.test', GIT_COMMITTER_NAME: 'b', GIT_COMMITTER_EMAIL: 'b@x.test' };
    sh('git', ['add', rel], { cwd: this.ctx.repo, env });
    const c = sh('git', ['commit', '-q', '-m', 'edit'], { cwd: this.ctx.repo, env });
    return { allowed: c.code === 0, stage: 'commit', view: view(`${c.stdout}${c.stderr}`, c.ms, 0), guardInstalled: !this.guard.isError };
  }
  async tick() {}
  async holderWrite(agent) {
    const r = await this.mcp.call('renew_file_reservations', { project_key: this.ctx.repo, agent_name: await this.nameOf(agent), extend_seconds: 60 });
    return { ok: !r.isError && (r.json?.renewed ?? 0) > 0, view: mcpView(r) };
  }
  storeDirs() { return [path.join(this.ctx.home, 'am'), path.join(this.ctx.home, 'am.sqlite3')]; }
  async close() { if (!this.shared) await this.mcp?.close(); }
}
