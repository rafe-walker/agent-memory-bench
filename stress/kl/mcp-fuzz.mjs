#!/usr/bin/env node
// Protocol abuse against an MCP stdio server: after each hostile message the server must
// still answer tools/list, never crash, and never write outside its data dir.
// usage: node stress/kl/mcp-fuzz.mjs kl|sl   (KLBIN / SLBIN = dist/cli.js)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Mcp } from '../lib/mcp.mjs';

const which = process.argv[2] ?? 'kl';
const W = mkdtempSync(join(tmpdir(), 'fz-'));
const repo = join(W, 'repo');
execFileSync('git', ['init', '-q', repo]);
const dd = join(W, 'data');
const bin = which === 'kl' ? process.env.KLBIN : process.env.SLBIN;
const args = which === 'kl' ? [bin, 'serve', '--data-dir', dd, '--actor', 'fz'] : [bin, 'serve', '--actor', 'fz', '--session', 'fz'];
const env = which === 'kl' ? {} : { KRONICLE_LITE_DATA_DIR: dd };
const results = [];
const rec = (name, ok, d) => { results.push(ok); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ': ' + JSON.stringify(d).slice(0, 300) : ''}`); };

let m = new Mcp('node', args, { cwd: repo, env, timeoutMs: 60000 });
await m.init();
const alive = async () => { try { const r = await m.request('tools/list', {}); return !!r.result; } catch { return false; } };
const restartIfDead = async (name) => {
  if (await alive()) return true;
  const ex = await Promise.race([m.exited, new Promise((r) => setTimeout(() => r('hung'), 1000))]);
  rec(`${name}: server survives`, false, { exit: ex, stderr: m.stderr.slice(-300) });
  m = new Mcp('node', args, { cwd: repo, env, timeoutMs: 60000 }); await m.init(); return false;
};

const hostile = [
  ['garbage line', () => m.raw('this is not json')],
  ['truncated json', () => m.raw('{"jsonrpc":"2.0","id":99,"method":"tools/li')],
  ['batch array', () => m.raw(JSON.stringify([{ jsonrpc: '2.0', id: 100, method: 'tools/list' }, { jsonrpc: '2.0', id: 101, method: 'ping' }]))],
  ['id is object', () => m.raw(JSON.stringify({ jsonrpc: '2.0', id: { a: 1 }, method: 'tools/list' }))],
  ['null id', () => m.raw(JSON.stringify({ jsonrpc: '2.0', id: null, method: 'tools/list' }))],
  ['unknown method', () => m.raw(JSON.stringify({ jsonrpc: '2.0', id: 102, method: 'nope/nope' }))],
  ['params is a string', () => m.raw(JSON.stringify({ jsonrpc: '2.0', id: 103, method: 'tools/call', params: 'x' }))],
  ['deeply nested (100k)', () => m.raw('{"jsonrpc":"2.0","id":104,"method":"tools/call","params":' + '['.repeat(100000) + ']'.repeat(100000) + '}')],
  ['12 MB line (over the SDK 10 MiB ReadBuffer)', () => m.raw(JSON.stringify({ jsonrpc: '2.0', id: 105, method: 'tools/call', params: { name: 'x', arguments: { s: 'a'.repeat(12_000_000) } } }))],
  ['NUL bytes', () => m.raw('{"jsonrpc":"2.0","id":106,"method":"tools/list"}\u0000\u0000')],
  ['re-initialize mid-session', () => m.raw(JSON.stringify({ jsonrpc: '2.0', id: 107, method: 'initialize', params: { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'x', version: '1' } } }))],
  ['future protocol version', () => m.raw(JSON.stringify({ jsonrpc: '2.0', id: 108, method: 'initialize', params: { protocolVersion: '2099-01-01', capabilities: {}, clientInfo: { name: 'x', version: '1' } } }))],
];
for (const [name, fn] of hostile) {
  const t0 = Date.now();
  fn();
  await new Promise((r) => setTimeout(r, 300));
  const ok = await restartIfDead(name);
  if (ok) rec(`${name}: server survives`, true, { ms: Date.now() - t0 });
}

// tool-level abuse
const slugs = ['../../../../tmp/evil', '..', '/abs/path', 'a/../../b', 'C:\\Windows\\x', 'con', 'a'.repeat(5000), 'ü-ünïcode', 'a\u0000b', 'a\nb', '%2e%2e/x', '.hidden', 'instructions/x/claude-md'];
if (which === 'kl') {
  for (const slug of slugs) {
    const r = await m.call('put_document', { slug, title: 't', markdown: '# t\n\nbody\n' });
    const accepted = !(r.isError || r.error);
    rec(`put_document slug ${JSON.stringify(slug).slice(0, 40)} -> ${accepted ? 'accepted' : 'refused'}`, true);
  }
  const strays = readdirSync(W).filter((f) => !['repo', 'data'].includes(f));
  rec('no file written outside data dir', strays.length === 0 && !existsSync('/tmp/evil') && !existsSync('/abs'), { strays });
  // huge doc
  const t0 = Date.now();
  const big = '# Big\n\n' + Array.from({ length: 20000 }, (_, i) => `## S${i}\n\nparagraph ${i} ${'x'.repeat(200)}\n`).join('\n');
  const r = await m.call('put_document', { slug: 'big', title: 'big', markdown: big }).catch((e) => ({ error: { message: e.message } }));
  rec('put_document 4 MB / 40k blocks', true, { ms: Date.now() - t0, refused: !!(r.isError || r.error), err: r.error?.message ?? (r.isError ? JSON.stringify(r.result).slice(0, 120) : null) });
  const t1 = Date.now();
  const rc = await m.call('recall', { query: 'paragraph', top_k: 1000, max_chars: 100000000 }).catch((e) => ({ error: { message: e.message } }));
  rec('recall top_k 1000 / max_chars 1e8', !rc.error, { ms: Date.now() - t1, bytes: JSON.stringify(rc).length, err: rc.error?.message });
  const t2 = Date.now();
  const st = await m.call('get_system_state', { response_format: 'json' }).catch((e) => ({ error: { message: e.message } }));
  rec('get_system_state after 40k-block put', !st.error, { ms: Date.now() - t2, bytes: JSON.stringify(st).length });
  const q = await m.call('recall', { query: '"unterminated AND OR NOT ( * ^ NEAR(' }).catch((e) => ({ error: { message: e.message } }));
  rec('recall with FTS5 syntax garbage returns a result, not a crash', !q.error, JSON.stringify(q).slice(0, 160));
}
const finalAlive = await alive();
rec('server alive at the end', finalAlive);
await m.close();
rmSync(W, { recursive: true, force: true });
process.exit(results.every(Boolean) ? 0 : 1);
