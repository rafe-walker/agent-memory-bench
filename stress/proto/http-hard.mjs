// serve --http hardening beyond round 1: Host/Origin variants, CORS preflight, content negotiation,
// body limits vs schema limits, slow bodies/headers (slowloris), concurrency, token/data-dir modes,
// bind address. Usage: node http-hard.mjs kl|sl   (binds 127.0.0.1 only; tokens never printed)
import net from 'node:net';
import { statSync, chmodSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { META, MODERN, httpServer, check, summary } from './common.mjs';

const which = process.argv[2] ?? 'kl';
const srv = await httpServer(which, which === 'sl' ? ['--actor', 'owner'] : []);
const U = new URL(srv.url);
const T = srv.token;
const H = (extra = {}, method = 'tools/list', name) => ({ 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${T}`, 'MCP-Protocol-Version': MODERN, 'Mcp-Method': method, ...(name ? { 'Mcp-Name': name } : {}), ...extra });
const body = (method = 'tools/list', params = {}) => JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: META } });

// raw HTTP/1.1 over a socket, so Host/Origin are exactly what we say
function raw(reqText, { timeoutMs = 5000 } = {}) {
  return new Promise((res) => {
    const s = net.connect(srv.port, '127.0.0.1');
    let out = '';
    s.on('data', (d) => { out += d; });
    s.on('close', () => res(out));
    s.on('error', () => res(out));
    s.setTimeout(timeoutMs, () => { s.destroy(); res(out || 'TIMEOUT'); });
    s.write(reqText);
  });
}
const status = (txt) => Number((txt.match(/^HTTP\/1\.[01] (\d{3})/) ?? [])[1] ?? 0);
const req = (host, extraHeaders = '', b = body(), method = 'POST', path = U.pathname) =>
  `${method} ${path} HTTP/1.1\r\n${host === null ? '' : `Host: ${host}\r\n`}Content-Type: application/json\r\nAccept: application/json, text/event-stream\r\nAuthorization: Bearer ${T}\r\nMCP-Protocol-Version: ${MODERN}\r\nMcp-Method: tools/list\r\n${extraHeaders}Content-Length: ${Buffer.byteLength(b)}\r\nConnection: close\r\n\r\n${b}`;

const p = srv.port;
for (const [label, host, want] of [
  ['127.0.0.1:port', `127.0.0.1:${p}`, 200], ['localhost:port', `localhost:${p}`, 200], ['[::1]:port', `[::1]:${p}`, 200],
  ['LOCALHOST (case)', `LOCALHOST:${p}`, 'any'], ['localhost. (trailing dot)', `localhost.:${p}`, 'any'],
  ['evil.com', 'evil.com', 'deny'], ['localhost.evil.com', `localhost.evil.com:${p}`, 'deny'], ['127.0.0.1.nip.io', `127.0.0.1.nip.io:${p}`, 'deny'],
  ['evil.com:port@127.0.0.1', `evil.com:${p}@127.0.0.1`, 'deny'], ['127.0.0.1 evil.com (space)', `127.0.0.1 evil.com`, 'deny'],
  // numeric loopback spellings normalize to 127.0.0.1 (WHATWG URL): a browser only sends them when the page itself is on loopback
  ['0x7f000001 (hex IP)', `0x7f000001:${p}`, 'any'], ['2130706433 (decimal IP)', `2130706433:${p}`, 'any'], ['127.1', `127.1:${p}`, 'any'],
  ['no Host header (HTTP/1.1)', null, 'deny'],
]) {
  const r = await raw(req(host));
  const s = status(r);
  const ok = want === 200 ? s === 200 : want === 'deny' ? s >= 400 && s < 500 : s > 0;
  check(`[Host ${label}] → ${want}`, ok, `HTTP ${s}`);
}
// duplicate Host headers (smuggling-ish): first evil, second loopback
{
  const b = body();
  const r = await raw(`POST ${U.pathname} HTTP/1.1\r\nHost: evil.com\r\nHost: 127.0.0.1:${p}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nAuthorization: Bearer ${T}\r\nMCP-Protocol-Version: ${MODERN}\r\nMcp-Method: tools/list\r\nContent-Length: ${b.length}\r\nConnection: close\r\n\r\n${b}`);
  check('[Host duplicated: evil.com then loopback] → refused', status(r) >= 400, `HTTP ${status(r)}`);
}
for (const [label, origin, want] of [
  ['http://localhost:1234 (other local port)', 'http://localhost:1234', 'any'], ['http://127.0.0.1', 'http://127.0.0.1', 200],
  ['HTTP://LOCALHOST (case)', 'HTTP://LOCALHOST', 'any'], ['https://evil.com', 'https://evil.com', 'deny'], ['http://127.0.0.1.evil.com', 'http://127.0.0.1.evil.com', 'deny'],
  ['null', 'null', 'deny'], ['file://', 'file://', 'deny'], ['chrome-extension://abc', 'chrome-extension://abcdef', 'deny'], ['http://[::1]:9', 'http://[::1]:9', 'any'],
  ['http://localhost@evil.com', 'http://localhost@evil.com', 'deny'], ['garbage', '%%%', 'deny'], ['empty', '', 'any'],
]) {
  const r = await raw(req(`127.0.0.1:${p}`, `Origin: ${origin}\r\n`));
  const s = status(r);
  const ok = want === 200 ? s === 200 : want === 'deny' ? s === 403 || s === 400 : s > 0;
  check(`[Origin ${label}] → ${want}`, ok, `HTTP ${s}`);
}
// CORS preflight and response headers
{
  const r = await raw(`OPTIONS ${U.pathname} HTTP/1.1\r\nHost: 127.0.0.1:${p}\r\nOrigin: https://evil.com\r\nAccess-Control-Request-Method: POST\r\nAccess-Control-Request-Headers: authorization, content-type\r\nConnection: close\r\n\r\n`);
  check('[CORS] preflight from evil origin gets no Access-Control-Allow-Origin', !/access-control-allow-origin/i.test(r), r.split('\r\n')[0]);
  const ok = await raw(req(`127.0.0.1:${p}`, 'Origin: http://localhost\r\n'));
  const acao = (ok.match(/access-control-allow-origin: *([^\r]*)/i) ?? [])[1];
  check('[CORS] no wildcard Access-Control-Allow-Origin on authenticated responses', acao !== '*', `ACAO=${acao ?? 'none'}`);
}
// content negotiation
for (const [label, hdr, want] of [
  ['Content-Type text/plain', { 'Content-Type': 'text/plain' }, '4xx'], ['Accept text/html only (observation: served)', { Accept: 'text/html' }, 'any'],
  ['Accept missing', { Accept: '' }, 'any'], ['header/body method mismatch', { 'Mcp-Method': 'tools/call' }, '4xx'],
  ['MCP-Protocol-Version header 2025-06-18 with modern body', { 'MCP-Protocol-Version': '2025-06-18' }, '4xx'],
  ['Mcp-Session-Id supplied (ignored)', { 'Mcp-Session-Id': 'abc' }, 'any'],
]) {
  const h = H(hdr); if (hdr.Accept === '') delete h.Accept;
  const r = await fetch(srv.url, { method: 'POST', headers: h, body: body() });
  const ok = want === '4xx' ? r.status >= 400 && r.status < 500 : r.status < 500;
  check(`[negotiation ${label}] → ${want}`, ok, `HTTP ${r.status}`);
}
for (const m of ['DELETE', 'PUT', 'PATCH', 'GET']) {
  const r = await fetch(srv.url, { method: m, headers: { Authorization: `Bearer ${T}` } });
  check(`[method ${m}] → 405`, r.status === 405, `HTTP ${r.status}`);
}
{
  const r = await fetch(srv.url, { method: 'POST', headers: H(), body: JSON.stringify([JSON.parse(body())]) });
  check('[batch array body] → 4xx JSON-RPC error', r.status >= 400 && r.status < 500, `HTTP ${r.status} ${(await r.text()).slice(0, 100)}`);
  const n = await fetch(srv.url, { method: 'POST', headers: H({ 'Mcp-Method': 'notifications/cancelled' }, 'notifications/cancelled'), body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1, _meta: META } }) });
  check('[notification POST] → 202, empty body', n.status === 202, `HTTP ${n.status}`);
}
// body limit vs schema limit
{
  const big = (n, ch) => JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: which === 'kl' ? 'put_document' : 'sea_create', arguments: which === 'kl' ? { slug: 'big', title: 'b', markdown: ch.repeat(n) } : { title: 't', body: ch.repeat(n) }, _meta: META } });
  const name = which === 'kl' ? 'put_document' : 'sea_create';
  const n = which === 'kl' ? 2_000_000 : 100_000;
  const b1 = big(n, '中');
  // curl reads the status even when the server answers 413 and closes mid-upload (fetch sees EPIPE)
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const cd = mkdtempSync(join(tmpdir(), 'proto-curl-'));
  writeFileSync(join(cd, 'body.json'), b1); writeFileSync(join(cd, 'hdr'), `Authorization: Bearer ${T}\n`, { mode: 0o600 });
  let code = '000';
  try { code = execFileSync('curl', ['-s', '--noproxy', '*', '-o', '/dev/null', '-w', '%{http_code}', '-X', 'POST', '-H', `@${join(cd, 'hdr')}`, '-H', 'Content-Type: application/json', '-H', 'Accept: application/json, text/event-stream', '-H', `MCP-Protocol-Version: ${MODERN}`, '-H', 'Mcp-Method: tools/call', '-H', `Mcp-Name: ${name}`, '--data-binary', `@${join(cd, 'body.json')}`, srv.url], { encoding: 'utf8' }); } catch (e) { code = String(e.stdout ?? '000'); }
  rmSync(cd, { recursive: true, force: true });
  check(`[limits] schema-valid ${name} at the schema max (${n} CJK chars = ${(Buffer.byteLength(b1) / 1048576).toFixed(1)} MiB) is accepted`, code === '200', `HTTP ${code}`);
  // Body over the server's message limit (BODY_LIMIT, default 4 MiB = SDK default; kronicle-lite >= 0.8.1 uses 16 MiB on
  // both transports, P2-08) → 413 or early close. A 5 MB body over the schema maxLength is answered either way.
  const limit = Number(process.env.BODY_LIMIT ?? (which === 'kl' ? 16 * 1024 * 1024 : 4 * 1024 * 1024));
  const r2 = await fetch(srv.url, { method: 'POST', headers: H({}, 'tools/call', name), body: big(limit + 1024 * 1024, 'a') }).then((x) => x.status, (e) => `client saw ${e.cause?.code ?? e.message} (server closed early)`);
  check(`[limits] body over the ${(limit / 1048576).toFixed(0)} MiB limit → 413 or early close`, r2 === 413 || /closed early/.test(String(r2)), String(r2));
  const r3 = await fetch(srv.url, { method: 'POST', headers: H({}, 'tools/call', name), body: big(5_000_000, 'a') }).then(async (x) => `${x.status} ${(await x.text()).slice(0, 120)}`, (e) => `client saw ${e.cause?.code ?? e.message} (server closed early)`);
  check('[limits] 5 MB body over the schema maxLength → answered (413, early close, or a validation error)', /^413|closed early|^200 .*(isError|error)/.test(r3), r3.slice(0, 160));
  // Content-Length lies (claims 100 MB) and chunked oversize
  const lie = await raw(`POST ${U.pathname} HTTP/1.1\r\nHost: 127.0.0.1:${p}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nAuthorization: Bearer ${T}\r\nMCP-Protocol-Version: ${MODERN}\r\nMcp-Method: tools/list\r\nContent-Length: 104857600\r\nConnection: close\r\n\r\n{"jsonrpc":`, { timeoutMs: 3000 });
  check('[limits] Content-Length 100 MB declared → 413 before reading', status(lie) === 413, lie === 'TIMEOUT' ? 'no answer in 3 s (waits for the body)' : `HTTP ${status(lie)}`);
}
// slowloris: 300 unauthenticated sockets dribbling headers; a legit request must still be served
{
  const socks = [];
  for (let i = 0; i < 300; i++) { const s = net.connect(p, '127.0.0.1'); s.on('error', () => {}); s.write(`POST ${U.pathname} HTTP/1.1\r\nHost: 127.0.0.1\r\n`); socks.push(s); }
  const iv = setInterval(() => socks.forEach((s) => s.write(`X-${Math.random().toString(36).slice(2, 6)}: a\r\n`)), 1000);
  await new Promise((r) => setTimeout(r, 2000));
  const t0 = Date.now();
  const r = await fetch(srv.url, { method: 'POST', headers: H(), body: body() }).then((x) => x.status, (e) => e.message);
  check('[slowloris] 300 slow-header sockets: legit request still served < 2 s', r === 200 && Date.now() - t0 < 2000, `${r} in ${Date.now() - t0} ms`);
  // slow authenticated body: does it block others?
  const slow = net.connect(p, '127.0.0.1'); slow.on('error', () => {});
  slow.write(`POST ${U.pathname} HTTP/1.1\r\nHost: 127.0.0.1:${p}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nAuthorization: Bearer ${T}\r\nMCP-Protocol-Version: ${MODERN}\r\nMcp-Method: tools/list\r\nContent-Length: 1000\r\n\r\n{`);
  const t1 = Date.now();
  const r2 = await fetch(srv.url, { method: 'POST', headers: H(), body: body() }).then((x) => x.status, (e) => e.message);
  check('[slow body] a stalled authenticated body does not block other requests', r2 === 200 && Date.now() - t1 < 2000, `${r2} in ${Date.now() - t1} ms`);
  clearInterval(iv); socks.forEach((s) => s.destroy()); slow.destroy();
}
// concurrency: 200 parallel clients, mixed reads and writes
{
  const t0 = Date.now();
  const jobs = Array.from({ length: 200 }, (_, i) => {
    const [name, args] = which === 'kl' ? (i % 2 ? ['put_document', { slug: `c${i}`, title: 't', markdown: `doc ${i}` }] : ['recall', { query: 'doc' }]) : (i % 2 ? ['sea_create', { title: `c${i}` }] : ['sea_list', {}]);
    return fetch(srv.url, { method: 'POST', headers: H({}, 'tools/call', name), body: JSON.stringify({ jsonrpc: '2.0', id: i, method: 'tools/call', params: { name, arguments: args, _meta: META } }) }).then(async (r) => ({ s: r.status, t: await r.text() }), (e) => ({ s: 0, t: e.message }));
  });
  const res = await Promise.all(jobs);
  const bad = res.filter((r) => r.s !== 200 || /isError":true/.test(r.t));
  check('[concurrency] 200 parallel tools/call all succeed', bad.length === 0, `${bad.length} bad in ${Date.now() - t0} ms: ${bad.slice(0, 2).map((b) => `${b.s} ${b.t.slice(0, 120)}`).join(' | ')}`);
}
// file modes and bind address
{
  const tok = join(srv.home, 'data', 'http-bearer.token');
  check('[files] bearer token file mode 0600', (statSync(tok).mode & 0o777) === 0o600, (statSync(tok).mode & 0o777).toString(8));
  const dm = statSync(join(srv.home, 'data')).mode & 0o777;
  check('[files] data dir not group/world readable', (dm & 0o077) === 0, dm.toString(8));
  // /proc/net/tcp{,6}: local_address is hex IP:PORT, state 0A = LISTEN
  const hexPort = p.toString(16).toUpperCase().padStart(4, '0');
  const listeners = ['/proc/net/tcp', '/proc/net/tcp6'].flatMap((f) => { try { return readFileSync(f, 'utf8').split('\n').slice(1); } catch { return []; } })
    .map((l) => l.trim().split(/\s+/)).filter((c) => c[1]?.endsWith(':' + hexPort) && c[3] === '0A').map((c) => c[1].split(':')[0]);
  const line = listeners.join(',');
  check('[bind] listening on 127.0.0.1 only', listeners.length === 1 && listeners[0] === '0100007F', `listen addrs (hex) ${line}`);
}
await srv.close();
// pre-existing world-readable token file: accepted silently?
{
  const s2 = await httpServer(which, which === 'sl' ? ['--actor', 'owner'] : []);
  const tok = join(s2.home, 'data', 'http-bearer.token');
  await s2.proc.kill('SIGTERM'); await s2.exited;
  chmodSync(tok, 0o644);
  const s3 = await httpServer(which, which === 'sl' ? ['--actor', 'owner'] : [], { home: s2.home });
  const mode = statSync(tok).mode & 0o777;
  check('[files] restart over a 0644 bearer file: warns or re-tightens to 0600', mode === 0o600 || /0644|permission|mode|world/i.test(s3.log()), `mode now ${mode.toString(8)}; log: ${s3.log().replace(/\n/g, ' ').slice(0, 160)}`);
  await s3.close();
  await s2.close();
}
process.exit(summary() ? 1 : 0);
