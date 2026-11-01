// Minimal MCP stdio client for stress tests (2025-era initialize handshake by default).
import { spawn } from 'node:child_process';

export class Mcp {
  constructor(cmd, args, { env = {}, cwd, protocolVersion = '2025-06-18', timeoutMs = 30000 } = {}) {
    this.p = spawn(cmd, args, { env: { ...process.env, ...env }, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    this.p.stdin.on('error', () => {});
    this.timeoutMs = timeoutMs;
    this.protocolVersion = protocolVersion;
    this.buf = '';
    this.stderr = '';
    this.next = 1;
    this.pending = new Map();
    this.notifications = [];
    this.exited = new Promise((res) => this.p.on('exit', (code, sig) => res({ code, sig })));
    this.p.stdout.on('data', (d) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 1);
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { this.notifications.push({ unparsable: line.slice(0, 200) }); continue; }
        if (msg.id != null && this.pending.has(msg.id)) { this.pending.get(msg.id)(msg); this.pending.delete(msg.id); }
        else this.notifications.push(msg);
      }
    });
    this.p.stderr.on('data', (d) => { this.stderr += d; });
  }
  raw(line) { this.p.stdin.write(line.endsWith('\n') ? line : line + '\n'); }
  request(method, params, { id } = {}) {
    const rid = id ?? this.next++;
    const msg = { jsonrpc: '2.0', id: rid, method, ...(params !== undefined ? { params } : {}) };
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.pending.delete(rid); rej(new Error(`timeout ${method}`)); }, this.timeoutMs);
      this.pending.set(rid, (m) => { clearTimeout(t); res(m); });
      this.p.stdin.write(JSON.stringify(msg) + '\n');
    });
  }
  notify(method, params) { this.p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }) + '\n'); }
  async init() {
    const r = await this.request('initialize', { protocolVersion: this.protocolVersion, capabilities: {}, clientInfo: { name: 'stress', version: '0' } });
    this.notify('notifications/initialized');
    return r;
  }
  async call(name, args = {}, extra = {}) {
    const r = await this.request('tools/call', { name, arguments: args, ...extra });
    if (r.error) return { error: r.error };
    const sc = r.result?.structuredContent;
    let text = r.result?.content?.[0]?.text;
    let parsed = sc;
    if (!parsed && text) { try { parsed = JSON.parse(text); } catch { parsed = text; } }
    return { isError: !!r.result?.isError, result: parsed, raw: r.result };
  }
  close() { try { this.p.stdin.end(); } catch {} ; setTimeout(() => this.p.kill('SIGKILL'), 500).unref(); return this.exited; }
}
