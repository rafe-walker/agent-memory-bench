// A6: kronicle-lite 0.5.0 (npm), driven as its README documents:
//  - files are chained with the one-shot of `kronicle-lite watch` (`put --from-instructions PATHS`),
//    which inside Claude Code is the FileChanged hook (`put --from-instructions --stdin-hook`);
//  - the agent orients with get_system_state at session start and before each material step
//    (orient skill), carrying the cursor; lookups are `recall`;
//  - agent-written memories are put_document under notes/.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Arm, view, mcpView, joinViews } from './_base.mjs';
import { McpClient } from '../lib/mcp.mjs';
import { ARMS_DIR, sh } from '../lib/util.mjs';

const PKG = path.join(ARMS_DIR, 'node_modules', 'kronicle-lite');
const CLI = path.join(PKG, 'dist', 'cli.js');

export default class KronicleLite extends Arm {
  static meta = {
    id: 'kronicle-lite', label: 'kronicle-lite', version: '0.5.0 (npm)', kind: ['knowledge', 'compaction'],
    setupSteps: ['npm i -g kronicle-lite@0.5.0 (or npx)', 'claude mcp add kronicle-lite -- kronicle-lite serve', 'install the orient skill (plugin)', 'SessionStart+FileChanged hook: kronicle-lite put --from-instructions --stdin-hook (or run `kronicle-lite watch docs/`)'],
    notes: 'MCP stdio. Data dir = default ~/.kronicle-lite under an isolated HOME.',
  };
  static cli = CLI;
  static pkg = PKG;
  static serveArgs = [];
  get cli() { return this.constructor.cli; }
  get env() { return { ...process.env, HOME: this.ctx.home, KRONICLE_LITE_DATA_DIR: this.ctx.dataDir ?? path.join(this.ctx.home, '.kronicle-lite') }; }
  get dataDir() { return this.env.KRONICLE_LITE_DATA_DIR; }
  async setup() { await this.#start(); }
  async #start() {
    this.mcp = await new McpClient(process.execPath, [this.cli, 'serve', '--actor', this.ctx.actor ?? 'agent-a', ...this.constructor.serveArgs], { env: this.env, cwd: this.ctx.repo }).start();
  }
  async listTools() { return this.mcp.listTools(); }
  // What `watch` / the FileChanged hook does for these paths.
  #chain(paths) {
    const r = sh(process.execPath, [this.cli, 'put', '--from-instructions', ...paths, '--cwd', this.ctx.repo], { cwd: this.ctx.repo, env: this.env, timeout: 600000 });
    if (r.code !== 0) this.lastError = r.stderr.slice(-400);
    return r;
  }
  async ingest(paths, { bulkDir } = {}) { const r = this.#chain(bulkDir ? [bulkDir] : paths); return view('', r.ms, 0); }
  async sessionStart() {
    const r = await this.mcp.call('get_system_state', this.cursor ? { since_cursor: this.cursor } : {});
    this.#cursorFrom(r); return mcpView(r);
  }
  #cursorFrom(r) { const m = r.text.match(/sxt1\.[A-Za-z0-9_\-.]+/); if (r.json?.cursor) this.cursor = r.json.cursor; else if (m) this.cursor = m[0]; }
  async read(q) { return mcpView(await this.mcp.call('recall', { query: q.text, top_k: 5 })); }
  // Claude Code's FileChanged hook -> `put --from-instructions --stdin-hook`, one event per path
  // (a deleted file is re-put empty, i.e. its blocks retire; same as `watch`).
  async sync(changes) {
    const paths = [...new Set(changes.flatMap((c) => [c.path, c.to].filter(Boolean)))];
    let ms = 0;
    for (const p of paths) {
      const input = JSON.stringify({ hook_event_name: 'FileChanged', file_path: path.join(this.ctx.repo, p), cwd: this.ctx.repo, session_id: 'bench' });
      const r = sh(process.execPath, [this.cli, 'put', '--from-instructions', '--stdin-hook', '--cwd', this.ctx.repo], { cwd: this.ctx.repo, env: this.env, input });
      ms += r.ms; if (r.code !== 0) this.lastError = r.stderr.slice(-400);
    }
    return view('', ms, 0);
  }
  async touch() { const r = await this.mcp.call('get_system_state', { since_cursor: this.cursor }); this.#cursorFrom(r); return mcpView(r); }
  async remember(text, { slug = 'note', actor } = {}) {
    const args = { slug: `notes-${slug}`, title: slug, markdown: `# ${slug}\n\n${text}\n` };
    if (actor) args.actor_id = actor;
    if (this.cursor) args.cursor = this.cursor;
    const r = await this.mcp.call('put_document', args);
    if (r.isError && /secret_detected|secret/i.test(r.text)) return mcpView(r); // a refusal is a graded outcome
    if (r.isError) throw new Error(`put_document failed: ${r.text.slice(0, 300)}`);
    return mcpView(r);
  }
  // Post-compaction: cc-anchor (or the orient skill) re-presents the saved cursor.
  async postCompact() { return this.touch(); }
  async newSession() { await this.mcp.close(); await this.#start(); return this.sessionStart(); }
  async tamper(oldV, newV) {
    const require = createRequire(path.join(this.constructor.pkg, 'package.json'));
    const Database = require('better-sqlite3');
    const db = new Database(path.join(this.dataDir, 'kronicle-lite.db'));
    const n = db.prepare('UPDATE blocks SET content = replace(content, ?, ?) WHERE instr(content, ?) > 0').run(oldV, newV, oldV).changes;
    try { db.prepare("INSERT INTO blocks_fts(blocks_fts) VALUES('rebuild')").run(); } catch {}
    db.close();
    return n > 0;
  }
  async integrityCheck() { const r = sh(process.execPath, [this.cli, 'verify-chain'], { env: this.env, cwd: this.ctx.repo }); return view(`exit ${r.code}\n${r.stdout}\n${r.stderr}`, r.ms, 0); }
  storeDirs() { return [this.dataDir]; }
  async close() { await this.mcp?.close(); }
}
