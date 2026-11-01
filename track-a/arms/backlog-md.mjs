// Backlog.md 1.55.3 (npm `backlog.md`): Markdown task files under backlog/ in the repo, CLI + MCP.
// "Claiming" is setting status In Progress and an assignee; there is no atomic claim, lease or
// path scope. Measured: claim semantics and concurrent task creation (duplicate-ID class of bug).
import path from 'node:path';
import fs from 'node:fs';
import { Arm, view } from './_base.mjs';
import { McpClient } from '../lib/mcp.mjs';
import { ARMS_DIR, sh, shAsync } from '../lib/util.mjs';

const BL = path.join(ARMS_DIR, 'node_modules', '.bin', 'backlog');

export default class BacklogMd extends Arm {
  static meta = {
    id: 'backlog-md', label: 'Backlog.md', version: '1.55.3 (npm)', kind: ['coordination'],
    setupSteps: ['npm i -g backlog.md', 'backlog init <name> --defaults', '(optional) claude mcp add backlog -- backlog mcp start'],
    claims: false, leases: false, editGuard: null,
    reps: { S3a: 3, S3b: 3, S3c: 3, S11c: 3 },
  };
  get env() { return { ...process.env, HOME: this.ctx.home }; }
  async setup() { const r = sh(BL, ['init', 'bench', '--defaults'], { cwd: this.ctx.repo, env: this.env }); if (r.code !== 0) throw new Error(`backlog init rc=${r.code}: ${(r.stdout + r.stderr).slice(-300)}`); sh(BL, ['config', 'set', 'remoteOperations', 'false'], { cwd: this.ctx.repo, env: this.env }); }
  async createItem({ title }) {
    const r = sh(BL, ['task', 'create', title], { cwd: this.ctx.repo, env: this.env });
    const id = r.stdout.match(/Created task (\S+)/)?.[1];
    if (!id) throw new Error(`backlog create: ${r.stdout}${r.stderr}`.slice(0, 300));
    return { id, view: view(r.stdout, r.ms, 1) };
  }
  async claim(agent, { id }) {
    const r = await shAsync(BL, ['task', 'edit', id, '-s', 'In Progress', '-a', `@${agent}`], { cwd: this.ctx.repo, env: this.env });
    return { granted: r.code === 0, view: view(r.stdout + r.stderr, r.ms, 1) };
  }
  async claimScope(agent, { title }) { const { id } = await this.createItem({ title }); return this.claim(agent, { id }); }
  async concurrentCreate(n) {
    const rs = await Promise.all(Array.from({ length: n }, (_, i) => shAsync(BL, ['task', 'create', `parallel ${i}`], { cwd: this.ctx.repo, env: this.env })));
    const ids = rs.map((r) => r.stdout.match(/Created task (\S+)/)?.[1]).filter(Boolean);
    const files = fs.readdirSync(path.join(this.ctx.repo, 'backlog', 'tasks')).filter((f) => /parallel/.test(f));
    return { ids, present: Math.min(files.length, new Set(ids).size), errors: rs.filter((r) => r.code !== 0).length, files: files.length };
  }
  async listTools() { const c = await new McpClient(BL, ['mcp', 'start'], { env: this.env, cwd: this.ctx.repo }).start(); try { return await c.listTools(); } finally { await c.close(); } }
  storeDirs() { return [path.join(this.ctx.repo, 'backlog')]; }
}
