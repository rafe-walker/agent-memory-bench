// A3: basic-memory 1.0.0 (PyPI), Markdown files + SQLite index (FTS + local fastembed vectors,
// hybrid search by default). Used as documented: a project points at a folder of notes (here the
// repo, so its docs are notes too); the MCP server watches the folder and re-indexes on change;
// the agent searches (bm_search), reads (bm_read), writes notes (bm_write) and checks what changed
// lately (bm_project recent) when it resumes work.
//
// Speed: one basic-memory server per (scenario, run) is shared across seeds; each seed is its own
// project (projects are isolated by design). S11 instead uses the default single project.
import fs from 'node:fs';
import path from 'node:path';
import { Arm, view, mcpView, joinViews } from './_base.mjs';
import { McpClient } from '../lib/mcp.mjs';
import { ARMS_DIR, sh, sleep, tmpdir } from '../lib/util.mjs';

const BIN = path.join(ARMS_DIR, 'bm-venv', 'bin', 'basic-memory');
const shared = new Map();

export function bmEnv(home) {
  return { ...process.env, HOME: home, HF_HUB_OFFLINE: '1', BASIC_MEMORY_SEMANTIC_EMBEDDING_CACHE_DIR: path.join(ARMS_DIR, 'fastembed-cache'), BASIC_MEMORY_NO_PROMOS: '1', BASIC_MEMORY_TELEMETRY_ENABLED: 'false', DO_NOT_TRACK: '1', BASIC_MEMORY_WATCH_PROJECT_RELOAD_INTERVAL: '2' };
}

export default class BasicMemory extends Arm {
  static meta = {
    id: 'basic-memory', label: 'basic-memory', version: '1.0.0 (PyPI)', kind: ['knowledge', 'compaction'], shareRuntime: true, maxScale: 1000,
    setupSteps: ['uv tool install basic-memory', 'basic-memory project add <name> <dir> --default', 'claude mcp add basic-memory -- basic-memory mcp', '(semantic search downloads bge-small-en-v1.5 on first use)'],
    notes: 'Embedding model pre-fetched into a local cache (the sandbox proxy blocks the default HF download path); HF_HUB_OFFLINE=1.',
  };
  async #runtime() {
    const key = this.ctx.sharedKey;
    if (key && shared.has(key)) return shared.get(key);
    const home = key ? tmpdir('bm-shared') : this.ctx.home;
    const rt = { home, mcp: await new McpClient(BIN, ['mcp'], { env: bmEnv(home), cwd: home, timeoutMs: 600000 }).start() };
    if (key) shared.set(key, rt);
    return rt;
  }
  static async closeShared(key) { const rt = shared.get(key); if (rt) { await rt.mcp.close(); shared.delete(key); } }
  async setup() {
    this.rt = await this.#runtime();
    this.mcp = this.rt.mcp;
    // S11 (two repos, default config): both agents use the one default project.
    this.project = this.ctx.bmDefault ? 'main' : `p${this.ctx.seed}x${Math.floor(Math.random() * 1e6)}`;
    this.notesDir = this.ctx.bmDefault ? path.join(this.rt.home, 'basic-memory') : this.ctx.repo;
    fs.mkdirSync(this.notesDir, { recursive: true });
    if (!this.ctx.bmSkipCreate) {
      const r = await this.mcp.call('bm_project', { command: 'create', name: this.project, path: this.notesDir });
      if (r.isError && !/exist/i.test(r.text) && !this.ctx.bmDefault) throw new Error(`bm project create failed: ${r.text.slice(0, 300)}`);
    }
  }
  async listTools() { return this.mcp.listTools(); }
  // Files already in the project folder: wait until the watcher/initial index has them.
  async ingest(paths, { bulkDir } = {}) {
    const t0 = performance.now();
    if (bulkDir) { // scale corpus: wait until a sample of docs is full-text searchable
      const sample = [paths[0], paths[Math.floor(paths.length / 2)], paths[paths.length - 1]];
      for (const p of sample) {
        const line = fs.readFileSync(path.join(this.notesDir, p), 'utf8').split('\n').find((l) => l.startsWith('The rotation key'));
        await this.#waitIndexed([], { until: async () => (await this.mcp.call('bm_search', { query: line, project: this.project })).text.includes(path.basename(p, '.md')), timeoutMs: 3600000 });
      }
      return view('', performance.now() - t0, 0);
    }
    await this.#waitIndexed(paths);
    // ...and until full-text content is searchable (the index fills after the file list does).
    for (const p of paths.filter((x) => x.endsWith('.md') && fs.existsSync(path.join(this.notesDir, x)))) {
      const line = fs.readFileSync(path.join(this.notesDir, p), 'utf8').split('\n').find((l) => l.trim() && !l.startsWith('#') && !l.startsWith('-'));
      if (!line) continue;
      const probe = line.replace(/[`*_]/g, '').split(/\s+/).slice(0, 5).join(' ');
      await this.#waitIndexed([], { until: async () => (await this.mcp.call('bm_search', { query: probe, project: this.project })).text.includes(line.slice(0, 24)), timeoutMs: 15000 });
    }
    return view('', performance.now() - t0, 0);
  }
  async #waitIndexed(paths, { until = null, timeoutMs = 20000 } = {}) {
    const t0 = Date.now();
    for (;;) {
      const r = await this.mcp.call('bm_project', { command: 'recent', project: this.project, since: '1d', page_size: 50 });
      const ok = until ? await until() : paths.every((p) => r.text.includes(path.basename(p, '.md')));
      if (ok || Date.now() - t0 > timeoutMs) return ok;
      await sleep(400);
    }
  }
  async sessionStart() { return mcpView(await this.mcp.call('bm_project', { command: 'recent', project: this.project, since: '1d' })); }
  // Search, then read the top hit (bm_search returns snippets only for some hits; the documented
  // pattern is bm_search -> bm_read).
  async read(q) {
    const r1 = await this.mcp.call('bm_search', { query: q.text, project: this.project });
    const top = r1.text.match(/^- ([^|\n]+?) \|/m)?.[1];
    const r2 = top ? await this.mcp.call('bm_read', { identifier: top.trim(), project: this.project }) : null;
    return joinViews(mcpView(r1), r2 && mcpView(r2));
  }
  // The MCP server's file watcher re-indexes; we wait until a search reflects the change (bounded).
  async sync(changes, { expect } = {}) {
    const t0 = performance.now();
    if (expect) await this.#waitIndexed([], { until: async () => expect((await this.mcp.call('bm_search', { query: expect.query, project: this.project })).text), timeoutMs: 20000 });
    else await sleep(2500);
    return view('', performance.now() - t0, 0);
  }
  async touch() { return view(''); } // nothing is pushed between turns
  async remember(text, { slug = 'note' } = {}) {
    const r = await this.mcp.call('bm_write', { identifier: `notes/${slug}.md`, title: slug, content: text, project: this.project, overwrite: true });
    if (r.isError) throw new Error(`bm_write failed: ${r.text.slice(0, 300)}`);
    return mcpView(r);
  }
  async rememberOld(text, { slug = 'note' } = {}) {
    return mcpView(await this.mcp.call('bm_write', { identifier: `notes/${slug}.md`, title: slug, content: text, project: this.project, overwrite: true }));
  }
  // After compaction the agent resumes: "what changed lately", then reads the newest note.
  async postCompact() {
    const r1 = await this.mcp.call('bm_project', { command: 'recent', project: this.project, since: '1d' });
    const id = r1.text.match(/•\s+(.+?)\s+(?:\([^)]*\)\s+)?\[id:/)?.[1];
    const r2 = id ? await this.mcp.call('bm_read', { identifier: id.trim(), project: this.project }) : null;
    return joinViews(mcpView(r1), r2 && mcpView(r2));
  }
  async newSession() { return this.sessionStart(); }
  // "Behind the tool": the note file is the source of truth, so an out-of-band edit of the file.
  async tamper(oldV, newV) {
    let n = 0;
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === '.git') continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.md')) { const t = fs.readFileSync(p, 'utf8'); if (t.includes(oldV)) { fs.writeFileSync(p, t.split(oldV).join(newV)); n++; } } } };
    walk(this.notesDir);
    if (n) await sleep(2500);
    return n > 0;
  }
  async integrityCheck() { const r = sh(BIN, ['doctor'], { env: bmEnv(this.rt.home), cwd: this.rt.home, timeout: 120000 }); return view(`exit ${r.code}\n${r.stdout.slice(-3000)}`, r.ms, 0); }
  storeDirs() { return [path.join(this.rt.home, '.basic-memory'), path.join(this.notesDir, 'notes')]; }
  async close() { if (!this.ctx.sharedKey) await this.mcp?.close(); }
}
