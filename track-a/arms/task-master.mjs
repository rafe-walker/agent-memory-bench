// task-master-ai 0.43.1 (npm): tasks in .taskmaster/tasks/tasks.json. Manual task creation
// (`add-task --title --description`) needs no LLM; parse-prd/expand do and are out of scope.
// "Claiming" is `set-status in-progress`; no atomic claim, lease, owner or path scope.
// The empty tagged tasks.json is written by the bench (init leaves none until parse-prd runs).
import path from 'node:path';
import fs from 'node:fs';
import { Arm, view } from './_base.mjs';
import { McpClient } from '../lib/mcp.mjs';
import { ARMS_DIR, sh, shAsync } from '../lib/util.mjs';

const TM = path.join(ARMS_DIR, 'node_modules', '.bin', 'task-master');

export default class TaskMaster extends Arm {
  static meta = {
    id: 'task-master', label: 'task-master-ai', version: '0.43.1 (npm)', kind: ['coordination'],
    setupSteps: ['npm i -g task-master-ai', 'task-master init', 'configure an LLM key (for parse-prd/expand; not needed for manual add-task)', 'claude mcp add task-master -- task-master-mcp'],
    claims: false, leases: false, editGuard: null,
    reps: { S3a: 3, S3b: 3, S3c: 3, S11c: 3 }, // no claim primitive: deterministic outcome, 4 s/CLI call
  };
  get env() { return { ...process.env, HOME: this.ctx.home }; }
  get file() { return path.join(this.ctx.repo, '.taskmaster', 'tasks', 'tasks.json'); }
  async setup() {
    sh(TM, ['init', '-y', '--skip-install', '--no-git', '--no-aliases'], { cwd: this.ctx.repo, env: this.env, timeout: 120000 });
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify({ master: { tasks: [], metadata: { created: '2026-11-01T00:00:00Z', description: 'bench' } } }));
  }
  tasks() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')).master.tasks; } catch { return []; } }
  async createItem({ title }) {
    const r = sh(TM, ['add-task', '--title', title, '--description', 'bench'], { cwd: this.ctx.repo, env: this.env, timeout: 120000 });
    const t = this.tasks().find((x) => x.title === title);
    if (!t) throw new Error(`add-task: ${r.stdout.slice(-200)}${r.stderr.slice(-200)}`);
    return { id: String(t.id), view: view(r.stdout, r.ms, 1) };
  }
  async claim(agent, { id }) {
    const r = await shAsync(TM, ['set-status', `--id=${id}`, '--status=in-progress'], { cwd: this.ctx.repo, env: this.env, timeout: 120000 });
    return { granted: r.code === 0, view: view(r.stdout + r.stderr, r.ms, 1) };
  }
  async claimScope(agent, { title }) { const { id } = await this.createItem({ title }); return this.claim(agent, { id }); }
  async concurrentCreate(n) {
    const rs = await Promise.all(Array.from({ length: n }, (_, i) => shAsync(TM, ['add-task', '--title', `parallel ${i}`, '--description', 'bench'], { cwd: this.ctx.repo, env: this.env, timeout: 180000 })));
    const ts = this.tasks().filter((t) => /^parallel /.test(t.title));
    const ids = ts.map((t) => String(t.id));
    return { ids, present: ts.length, errors: rs.filter((r) => r.code !== 0).length };
  }
  async listTools() { const c = await new McpClient(path.join(ARMS_DIR, 'node_modules', '.bin', 'task-master-mcp'), [], { env: this.env, cwd: this.ctx.repo }).start(); try { return await c.listTools(); } finally { await c.close(); } }
  storeDirs() { return [path.join(this.ctx.repo, '.taskmaster')]; }
}
