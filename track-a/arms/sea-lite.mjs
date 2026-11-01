// A7: sea-lite 0.4.0 — UNRELEASED local build (/home/claude/sea-lite dist; npm latest is 0.3.0).
// One MCP server per agent session (`serve --actor <a> --session <s>`), as each Claude Code session
// spawns its own. The edit guard is sea-lite's own PreToolUse hook (`sea-lite scope-check --hook`).
// "default identity" variant: the plugin's .mcp.json (no --actor), sessions told apart only by
// CLAUDE_CODE_SESSION_ID, i.e. what two Claude Code terminals get out of the box.
import path from 'node:path';
import { createRequire } from 'node:module';
import { Arm, view, mcpView } from './_base.mjs';
import { McpClient } from '../lib/mcp.mjs';
import { sh } from '../lib/util.mjs';

export const SEA_DIR = process.env.AMB_SEA_LITE_DIR || '/home/claude/sea-lite';
export const SEA_CLI = path.join(SEA_DIR, 'dist', 'cli.js');

export default class SeaLite extends Arm {
  static meta = {
    id: 'sea-lite', label: 'sea-lite', version: '0.4.0 (unreleased local build; npm latest 0.3.0)', kind: ['coordination'],
    setupSteps: ['npm i -g sea-lite', 'claude mcp add sea-lite -- sea-lite serve', 'install the work-queue skill', 'PreToolUse hook: sea-lite scope-check --hook', '(optional) sea-lite precommit --install'],
    claims: true, leases: true, editGuard: 'hook',
    s13: { lease: 5, duration: 12 }, reps: { S13: 3 },
  };
  get env() { return { ...process.env, HOME: this.ctx.home }; }
  async setup() { this.agents = new Map(); this.sessions = new Map(); }
  sessionOf(agent) { return this.ctx.identity === 'default' ? `cc-${agent}` : `s-${agent}`; }
  async client(agent) {
    if (this.agents.has(agent)) return this.agents.get(agent);
    const args = [SEA_CLI, 'serve'];
    const env = { ...this.env };
    if (this.ctx.identity === 'default') env.CLAUDE_CODE_SESSION_ID = this.sessionOf(agent);
    else args.push('--actor', agent, '--session', this.sessionOf(agent));
    const p = new McpClient(process.execPath, args, { env, cwd: this.ctx.repo }).start();
    this.agents.set(agent, p);
    return p;
  }
  async listTools() { return (await this.client('lister')).listTools(); }
  async createItem({ title, paths }, agent = 'planner') {
    const r = await (await this.client(agent)).call('sea_create', { title, status: 'triaged', body: `paths: ${paths.join(', ')}` });
    if (r.isError) throw new Error(`sea_create: ${r.text.slice(0, 200)}`);
    return { id: r.json.ticket.id, view: mcpView(r) };
  }
  async claim(agent, { id, paths, lease = 300 }) {
    const r = await (await this.client(agent)).call('sea_claim', { ticket_ids: [id], lease_seconds: lease, scope: { paths } });
    const token = r.json?.claims?.[0]?.claim_token;
    return { granted: !r.isError && !!token, token, view: mcpView(r) };
  }
  // Two agents take different tickets but the same path scope (the overlap case).
  async claimScope(agent, { title, paths, lease = 300 }) {
    const { id } = await this.createItem({ title, paths }, agent);
    return this.claim(agent, { id, paths, lease });
  }
  hookEnv() { return this.env; }
  async tryEdit(agent, rel) {
    await this.client(agent); // the session's MCP server is running, as in a live Claude Code session
    const input = JSON.stringify({ session_id: this.sessionOf(agent), cwd: this.ctx.repo, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(this.ctx.repo, rel), old_string: 'a', new_string: 'b' } });
    const r = sh(process.execPath, [SEA_CLI, 'scope-check', '--hook'], { cwd: this.ctx.repo, env: this.hookEnv(), input });
    const denied = r.code === 2 || /"permissionDecision"\s*:\s*"deny"/.test(r.stdout);
    return { allowed: !denied, stage: 'edit', view: view(`${r.stdout}${r.stderr}`, r.ms, 0) };
  }
  async tick() {} // no automatic heartbeat without a hook
  async holderWrite(agent, { id, token }) {
    const r = await (await this.client(agent)).call('sea_update', { ticket_id: id, claim_token: token, note: 'progress' });
    return { ok: !r.isError, view: mcpView(r) };
  }
  async concurrentCreate(n) {
    const cs = await Promise.all(Array.from({ length: n }, (_, i) => this.client(`w${i}`)));
    const rs = await Promise.all(cs.map((c, i) => c.call('sea_create', { title: `parallel ${i}`, status: 'triaged' })));
    const ids = rs.map((r) => r.json?.ticket?.id).filter(Boolean);
    const list = await cs[0].call('sea_list', { limit: 200 });
    const present = ids.filter((id) => list.text.includes(id)).length;
    return { ids, present, errors: rs.filter((r) => r.isError).length };
  }
  async tamper(oldV, newV) {
    const require = createRequire(path.join(SEA_DIR, 'package.json'));
    const Database = require('better-sqlite3');
    const db = new Database(path.join(this.ctx.home, '.kronicle-lite', 'sea-lite.db'));
    let n = 0;
    try { n = db.prepare('UPDATE tickets SET body = replace(body, ?, ?), title = replace(title, ?, ?) WHERE instr(body, ?) > 0 OR instr(title, ?) > 0').run(oldV, newV, oldV, newV, oldV, oldV).changes; } finally { db.close(); }
    return n > 0;
  }
  storeDirs() { return [path.join(this.ctx.home, '.kronicle-lite')]; }
  async close() { for (const p of this.agents?.values() ?? []) { try { (await p).close(); } catch {} } }
}
