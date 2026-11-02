// Shared helpers for the round-2 protocol track. Bins default to the npm-published packages
// installed in $PROTO_PKG (npm i kronicle-lite@0.8.0 sea-lite@0.6.0 mcp-catalog-snap@0.1.0).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

export const PKG = process.env.PROTO_PKG ?? '/tmp/claude-0/proto';
export const BIN = {
  kl: process.env.KLBIN ?? join(PKG, 'node_modules/.bin/kronicle-lite'),
  sl: process.env.SLBIN ?? join(PKG, 'node_modules/.bin/sea-lite'),
};
export const MODERN = '2026-07-28';

// Every spawned server is killed when the harness exits, even on a crash (no stray listeners).
const live = new Set();
const dirs = new Set();
const reap = () => { for (const p of live) { try { p.kill('SIGKILL'); } catch {} } for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} } };
process.on('exit', reap);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { reap(); process.exit(130); });
process.on('uncaughtException', (e) => { console.error(e); reap(); process.exit(70); });
process.on('unhandledRejection', (e) => { console.error(e); reap(); process.exit(70); });
export const track = (p) => { live.add(p); p.on('exit', () => live.delete(p)); return p; };
export const META = { 'io.modelcontextprotocol/protocolVersion': MODERN, 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'proto', version: '0' } };

export function tmp(prefix = 'proto-') {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.add(d);
  return { dir: d, rm: () => { dirs.delete(d); rmSync(d, { recursive: true, force: true, maxRetries: 5 }); } };
}

export function serverEnv(home) {
  const e = { ...process.env, HOME: home, KRONICLE_LITE_DATA_DIR: join(home, 'data'), SEA_LITE_ACTOR: 'proto', SEA_LITE_SESSION: 'proto-sess' };
  delete e.CLAUDE_CODE_SESSION_ID;
  return e;
}

/** Raw newline-delimited JSON-RPC over a spawned stdio server. */
export class Raw {
  constructor(which, args = [], { home, timeoutMs = 15000 } = {}) {
    this.t = home ? null : tmp(`proto-${which}-`);
    this.home = home ?? this.t.dir;
    this.p = track(spawn(BIN[which], ['serve', '--data-dir', join(this.home, 'data'), ...args], { env: serverEnv(this.home), stdio: ['pipe', 'pipe', 'pipe'] }));
    this.p.stdin.on('error', () => {});
    this.timeoutMs = timeoutMs;
    this.buf = '';
    this.stderr = '';
    this.msgs = [];
    this.waiters = [];
    this.unparsable = [];
    this.exit = null;
    this.exited = new Promise((res) => this.p.on('exit', (code, sig) => { this.exit = { code, sig }; res(this.exit); }));
    this.p.stdout.on('data', (d) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 1);
        if (!line.trim()) continue;
        let m;
        try { m = JSON.parse(line); } catch { this.unparsable.push(line.slice(0, 300)); continue; }
        this.msgs.push(m);
        this.waiters = this.waiters.filter((w) => !w(m));
      }
    });
    this.p.stderr.on('data', (d) => { this.stderr += d; });
  }
  send(obj) { this.p.stdin.write((typeof obj === 'string' ? obj : JSON.stringify(obj)) + '\n'); }
  writeRaw(buf) { this.p.stdin.write(buf); }
  /** Wait for a message matching pred (already received or future). */
  wait(pred, ms = this.timeoutMs) {
    const hit = this.msgs.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('timeout')), ms);
      this.waiters.push((m) => { if (pred(m)) { clearTimeout(t); res(m); return true; } return false; });
      this.exited.then(() => setTimeout(() => rej(new Error(`exited ${JSON.stringify(this.exit)}`)), 50));
    });
  }
  response(id, ms) { return this.wait((m) => m.id === id && (m.result !== undefined || m.error !== undefined), ms); }
  async rpc(id, method, params, ms) { this.send({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) }); return this.response(id, ms); }
  async initLegacy(version = '2025-06-18', caps = {}) {
    const r = await this.rpc('init', 'initialize', { protocolVersion: version, capabilities: caps, clientInfo: { name: 'proto', version: '0' } });
    this.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return r;
  }
  async close() {
    try { this.p.stdin.end(); } catch {}
    const k = setTimeout(() => this.p.kill('SIGKILL'), 3000);
    await this.exited; clearTimeout(k);
    this.t?.rm();
  }
}

export function freePort() {
  return new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}

/** Start `serve --http` on 127.0.0.1:<free port>; resolves when the "serving" line appears. Token is never printed. */
export async function httpServer(which, extra = [], { home } = {}) {
  const t = home ? null : tmp(`proto-${which}-http-`);
  const h = home ?? t.dir;
  const port = await freePort();
  const p = track(spawn(BIN[which], ['serve', '--http', '--host', '127.0.0.1', '--port', String(port), '--data-dir', join(h, 'data'), ...extra], { env: serverEnv(h), stdio: ['ignore', 'pipe', 'pipe'] }));
  let log = '';
  p.stdout.on('data', (d) => { log += d; });
  p.stderr.on('data', (d) => { log += d; });
  const exited = new Promise((res) => p.on('exit', (code, sig) => res({ code, sig })));
  const deadline = Date.now() + 15000;
  while (!/serving|listening/i.test(log)) {
    if (Date.now() > deadline || p.exitCode !== null) throw new Error(`${which} http did not start: ${log.slice(0, 500)}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  const { readFileSync } = await import('node:fs');
  let token = null;
  try { token = readFileSync(join(h, 'data', 'http-bearer.token'), 'utf8').trim(); } catch {}
  return {
    url: `http://127.0.0.1:${port}/mcp`, port, home: h, token, proc: p, log: () => log, exited,
    async close() { p.kill('SIGTERM'); const k = setTimeout(() => p.kill('SIGKILL'), 3000); await exited; clearTimeout(k); t?.rm(); },
  };
}

export const results = [];
export function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + String(detail).slice(0, 400) : ''}`);
  return ok;
}
export function summary() {
  const f = results.filter((r) => !r.ok);
  console.log(`\n${results.length - f.length}/${results.length} passed`);
  return f.length;
}
