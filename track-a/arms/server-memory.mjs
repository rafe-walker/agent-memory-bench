// A?: the reference MCP memory server (@modelcontextprotocol/server-memory 2.0.1), a JSONL
// knowledge graph. Used as its README describes: the agent writes entities/observations for
// what it learns and starts each chat by retrieving the graph ("Remembering..." + read_graph).
// It has no file sync: nothing updates a stored observation when the source file changes.
import fs from 'node:fs';
import path from 'node:path';
import { Arm, view, mcpView } from './_base.mjs';
import { McpClient } from '../lib/mcp.mjs';
import { ARMS_DIR } from '../lib/util.mjs';

const BIN = path.join(ARMS_DIR, 'node_modules', '@modelcontextprotocol', 'server-memory', 'dist', 'index.js');

export default class ServerMemory extends Arm {
  static meta = {
    id: 'server-memory', label: '@modelcontextprotocol/server-memory', version: '2.0.1 (npm)', kind: ['knowledge', 'compaction'],
    setupSteps: ['claude mcp add memory -- npx -y @modelcontextprotocol/server-memory', 'add the README system prompt (retrieve graph at chat start; store facts as observations)'],
    notes: 'Default MEMORY_FILE_PATH is one memory.jsonl beside the package: every project shares it unless configured.',
  };
  get file() { return this.ctx.memoryFile ?? path.join(this.ctx.home, 'memory.jsonl'); }
  async setup() {
    this.mcp = await new McpClient(process.execPath, [BIN], { env: { ...process.env, HOME: this.ctx.home, MEMORY_FILE_PATH: this.file }, cwd: this.ctx.repo }).start();
  }
  async listTools() { return this.mcp.listTools(); }
  // The agent stores each doc it read as an entity whose observations are the doc's lines
  // (generous: a real agent stores a few facts, not whole docs).
  async ingest(paths) {
    const entities = paths.filter((p) => fs.existsSync(path.join(this.ctx.repo, p))).map((p) => ({
      name: `${this.ctx.project ?? 'repo'}:${p}`, entityType: 'document',
      observations: fs.readFileSync(path.join(this.ctx.repo, p), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')),
    }));
    if (!entities.length) return view('');
    const r = await this.mcp.call('create_entities', { entities });
    return view('', r.ms, 1);
  }
  async sessionStart() { return mcpView(await this.mcp.call('read_graph', {})); }
  async read(q) { return mcpView(await this.mcp.call('search_nodes', { query: q.keyword })); }
  async sync() {} // no file sync exists
  async touch() { return view(''); }
  async remember(text, { slug = 'note' } = {}) {
    const name = `${this.ctx.project ?? 'repo'}:notes`;
    let r = await this.mcp.call('add_observations', { observations: [{ entityName: name, contents: [text] }] });
    if (r.isError) { r = await this.mcp.call('create_entities', { entities: [{ name, entityType: 'notes', observations: [text] }] }); }
    return mcpView(r);
  }
  async postCompact() { return this.sessionStart(); }
  async newSession() { await this.mcp.close(); await this.setup(); return this.sessionStart(); }
  async tamper(oldV, newV) {
    const t = fs.readFileSync(this.file, 'utf8');
    if (!t.includes(oldV)) return false;
    fs.writeFileSync(this.file, t.split(oldV).join(newV)); return true;
  }
  async integrityCheck() { return null; }
  storeDirs() { return [this.file]; }
  async close() { await this.mcp?.close(); }
}
