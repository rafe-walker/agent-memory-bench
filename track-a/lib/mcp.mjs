// Minimal stdio MCP client (JSON-RPC over newline-delimited JSON). Measures, per call,
// the bytes of what the agent would see (the tool result's content text + structuredContent)
// and wall-clock latency. No SDK dependency so the byte accounting is exact and auditable.
import { spawn } from 'node:child_process';

export class McpClient {
  constructor(cmd, args = [], { env = process.env, cwd, protocolVersion = '2025-06-18', timeoutMs = 120000 } = {}) {
    this.cmd = cmd; this.args = args; this.env = env; this.cwd = cwd;
    this.protocolVersion = protocolVersion; this.timeoutMs = timeoutMs;
    this.id = 0; this.pending = new Map(); this.buf = ''; this.stderr = '';
  }
  async start() {
    const t0 = performance.now();
    this.child = spawn(this.cmd, this.args, { env: this.env, cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.on('data', (d) => this.#onData(d));
    this.child.stderr.on('data', (d) => { if (this.stderr.length < 20000) this.stderr += d; });
    this.exited = new Promise((res) => this.child.on('exit', (code) => { this.exitCode = code; for (const [, p] of this.pending) p.reject(new Error(`server exited (${code}): ${this.stderr.slice(-800)}`)); this.pending.clear(); res(code); }));
    this.init = await this.rpc('initialize', { protocolVersion: this.protocolVersion, capabilities: {}, clientInfo: { name: 'agent-memory-bench', version: '0.1.0' } });
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    this.startMs = performance.now() - t0;
    return this;
  }
  #onData(d) {
    this.buf += d;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1);
      if (!line.trim()) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.id != null && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); clearTimeout(p.timer); p.resolve(m); }
      else if (m.id != null && m.method) { // server->client request (e.g. roots/list, elicitation): answer empty
        const result = m.method === 'roots/list' ? { roots: [] } : {};
        this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\n');
      }
    }
  }
  rpc(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout ${method} after ${this.timeoutMs}ms; stderr: ${this.stderr.slice(-500)}`)); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  async listTools() {
    const r = await this.rpc('tools/list', {});
    if (r.error) throw new Error(JSON.stringify(r.error));
    // Paginate if needed
    let tools = r.result.tools; let cursor = r.result.nextCursor;
    while (cursor) { const n = await this.rpc('tools/list', { cursor }); tools = tools.concat(n.result.tools); cursor = n.result.nextCursor; }
    const bytes = Buffer.byteLength(JSON.stringify({ tools }));
    return { tools, bytes, names: tools.map((t) => t.name) };
  }
  // Returns { text, json, bytes, ms, isError }. `text` is what a text-only client shows the
  // model; `bytes` counts content text + structuredContent (both reach the model in Claude Code).
  async call(name, args = {}) {
    const t0 = performance.now();
    const r = await this.rpc('tools/call', { name, arguments: args });
    const ms = performance.now() - t0;
    if (r.error) return { text: `RPC_ERROR ${JSON.stringify(r.error)}`, json: null, bytes: 0, ms, isError: true, rpcError: r.error };
    const res = r.result || {};
    const text = (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    let json = res.structuredContent ?? null;
    if (!json) { try { json = JSON.parse(text); } catch { json = null; } }
    const scBytes = res.structuredContent ? Buffer.byteLength(JSON.stringify(res.structuredContent)) : 0;
    // `bytes` = the content text blocks, i.e. what Claude Code places in the model's context.
    // structuredContent is reported separately (scBytes) and is not graded.
    return { text, json, bytes: Buffer.byteLength(text), scBytes, ms, isError: !!res.isError };
  }
  async close() {
    if (!this.child || this.exitCode !== undefined) return;
    try { this.child.stdin.end(); } catch {}
    const t = setTimeout(() => { try { this.child.kill('SIGKILL'); } catch {} }, 3000);
    this.child.kill('SIGTERM');
    await this.exited; clearTimeout(t);
  }
}
