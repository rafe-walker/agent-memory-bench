import fs from 'node:fs';
import path from 'node:path';
import { sh, tmpdir, rmrf, gitInit } from '../lib/util.mjs';

// A View is exactly what one agent touchpoint shows the model, plus its cost.
export function view(text = '', ms = 0, calls = 0, extra = {}) {
  text = text ?? '';
  return { text, bytes: Buffer.byteLength(text), ms, calls, ...extra };
}
export function joinViews(...vs) {
  vs = vs.filter(Boolean);
  return view(vs.map((v) => v.text).filter(Boolean).join('\n\n'), vs.reduce((a, v) => a + v.ms, 0), vs.reduce((a, v) => a + v.calls, 0), { scBytes: vs.reduce((a, v) => a + (v.scBytes || 0), 0) });
}
export const mcpView = (r) => view(r.text, r.ms, 1, { scBytes: r.scBytes || 0, isError: r.isError });

// Grep the repo the way an agent's Grep tool would (rg, content mode, line numbers, case-insensitive).
export function grepRepo(repo, pattern, { maxLines = 200 } = {}) {
  const t0 = performance.now();
  const r = sh('rg', ['-n', '-i', '--no-heading', '--glob', '!.git', '--glob', '!.claude/cc-anchor', '-e', pattern, '.'], { cwd: repo });
  let out = r.stdout.split('\n').filter(Boolean);
  const truncated = out.length > maxLines;
  out = out.slice(0, maxLines);
  return view(out.join('\n') + (truncated ? '\n[truncated]' : ''), performance.now() - t0, 1);
}

export function readFileSafe(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }
export function listFiles(dir, pred = () => true) {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === '.git') continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (pred(p)) out.push(p); } };
  walk(dir);
  return out;
}

export class Arm {
  static meta = { id: 'base', label: 'base', version: '-', kind: [], setupSteps: [] };
  constructor(ctx) { this.ctx = ctx; }
  get meta() { return this.constructor.meta; }
  async setup() {}
  async close() {}
  // tools/list once, in a throwaway HOME (the context cost every session pays up front).
  static async listToolsOnce(serveArgs) {
    if (!this.prototype.listTools) return null;
    const home = tmpdir('toolslist');
    const ctx = { home, repo: path.join(home, 'repo'), seed: 0, actor: 'agent-a', ...(serveArgs ? { serveArgs } : {}) };
    gitInit(ctx.repo);
    const a = new this(ctx);
    try { await a.setup(); return await a.listTools(); } finally { try { await a.close(); } catch {} rmrf(home); }
  }
  storeDirs() { return []; }
}
