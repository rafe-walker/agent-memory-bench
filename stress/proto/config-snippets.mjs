// (e) Every MCP config snippet in the kronicle-lite / sea-lite / mcp-catalog-snap READMEs, the
// isokron-plugins .mcp.json files and isokron-setup's clients.md: parse it in its client's format
// (JSON / JSONC-free / TOML), apply that client's interpolation, then actually launch the command line
// from a temp dir (HOME = temp) and complete initialize + tools/list. HTTP snippets: start the server,
// substitute the token, connect. Codex TOML is additionally validated by `codex mcp list` when
// CODEX_BIN is set. Usage: node config-snippets.mjs
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmp, check, summary, httpServer, META } from './common.mjs';

const ROOT = '/home/claude';
const blocks = [];
const grab = (file, lang, filter) => {
  const s = readFileSync(file, 'utf8');
  for (const m of s.matchAll(/```(\w*)\n([\s\S]*?)```/g)) {
    if (lang && m[1] !== lang) continue;
    if (filter && !filter.test(m[2])) continue;
    blocks.push({ file: file.replace(ROOT + '/', ''), line: s.slice(0, m.index).split('\n').length, lang: m[1], text: m[2] });
  }
};
for (const f of ['kronicle-lite/README.md', 'sea-lite/README.md', 'isokron-plugins/skills/isokron-setup/references/clients.md']) {
  grab(join(ROOT, f), 'json', /mcpServers|"servers"/);
  grab(join(ROOT, f), 'toml', /mcp_servers/);
  grab(join(ROOT, f), 'sh', /claude mcp add/);
}
for (const f of ['isokron-plugins/plugins/kronicle-lite/.mcp.json', 'isokron-plugins/plugins/sea-lite/.mcp.json']) blocks.push({ file: f, line: 1, lang: 'json', text: readFileSync(join(ROOT, f), 'utf8') });

// minimal TOML for the subset used ([a.b.c] tables, key = string|number|array of strings, comments)
function toml(text) {
  const out = {}; let cur = out;
  for (let raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').replace(/^#.*$/, '').trim();
    if (!line) continue;
    const t = line.match(/^\[([^\]]+)\]$/);
    if (t) { cur = out; for (const k of t[1].split('.')) cur = cur[k] ??= {}; continue; }
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!kv) throw new Error(`unparsed TOML line: ${line}`);
    cur[kv[1]] = JSON.parse(kv[2]);
  }
  return out;
}

async function launch(label, command, args, env, cwd) {
  // initialize + tools/list over stdio, 2025-06-18 handshake (what the client would send)
  return new Promise((resolve) => {
    const p = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '', err = '', done = false;
    const finish = (ok, detail) => { if (done) return; done = true; clearTimeout(timer); p.kill('SIGKILL'); resolve({ ok, detail }); };
    const timer = setTimeout(() => finish(false, `timeout; stderr: ${err.slice(-200)}`), 120000);
    p.stderr.on('data', (d) => { err += d; });
    p.on('exit', (c) => finish(false, `exited ${c}: ${err.slice(-300).replace(/\n/g, ' ')}`));
    p.stdout.on('data', (d) => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
        if (m.id === 1) { p.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n'); }
        if (m.id === 2) finish(!!m.result?.tools?.length, `${m.result?.tools?.length} tools; stderr: ${err.split('\n')[0].slice(0, 160)}`);
      }
    });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cfg', version: '0' } } }) + '\n');
  });
}

for (const b of blocks) {
  const label = `${b.file}:${b.line}`;
  const t = tmp('proto-cfg-');
  const home = join(t.dir, 'home'); const ws = join(t.dir, 'workspace'); mkdirSync(home); mkdirSync(ws);
  spawnSync('git', ['init', '-q', ws]);
  const baseEnv = { PATH: process.env.PATH, HOME: home, npm_config_cache: join(home, '.npm'), HTTPS_PROXY: process.env.HTTPS_PROXY ?? '', HTTP_PROXY: process.env.HTTP_PROXY ?? '', NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS ?? '', npm_config_cafile: process.env.npm_config_cafile ?? '', SSL_CERT_FILE: process.env.SSL_CERT_FILE ?? '' };
  const interp = (s) => s.replace(/\$\{workspaceFolder\}/g, ws).replace(/\$\{userHome\}/g, home).replace(/\$\{env:([A-Z_]+)\}/g, (_, k) => baseEnv[k] ?? '');
  let servers = [];
  try {
    if (b.lang === 'json') {
      const j = JSON.parse(b.text);
      const map = j.mcpServers ?? j.servers;
      for (const [name, s] of Object.entries(map)) servers.push({ name, ...s, format: j.servers ? 'vscode' : 'mcpServers' });
    } else if (b.lang === 'toml') {
      const j = toml(b.text);
      for (const [name, s] of Object.entries(j.mcp_servers)) servers.push({ name, command: s.command, args: s.args, envVars: s.env_vars, format: 'codex' });
    } else if (b.lang === 'sh') {
      for (const line of b.text.split('\n').filter((l) => /^claude mcp add/.test(l))) {
        const [, name, rest] = line.match(/^claude mcp add (\S+) -- (.+?)\s*(#.*)?$/);
        const argv = rest.split(/\s+/);
        servers.push({ name, command: argv[0], args: argv.slice(1), format: 'claude-cli' });
      }
    }
    check(`${label}: parses (${b.lang})`, servers.length > 0, servers.map((s) => s.name).join(','));
  } catch (e) { check(`${label}: parses (${b.lang})`, false, e.message); t.rm(); continue; }
  for (const s of servers) {
    if (s.url) {
      // HTTP snippet: start the matching server, put the real token where the snippet has a placeholder
      const which = /sea/.test(s.name) ? 'sl' : 'kl';
      const h = await httpServer(which, which === 'sl' ? ['--actor', 'owner'] : []);
      const u = new URL(s.url);
      const url = `http://127.0.0.1:${h.port}${u.pathname}`;
      const headers = Object.fromEntries(Object.entries(s.headers ?? {}).map(([k, v]) => [k, v.replace(/<[^>]+>|\$\{env:[A-Z_]+\}/g, h.token)]));
      const r = await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cfg', version: '0' } } }) });
      check(`${label} [${s.name}] http snippet connects (path ${u.pathname}, default port ${u.port})`, r.status === 200 && u.port === String(which === 'sl' ? 7418 : 7417), `HTTP ${r.status}`);
      await h.close();
      continue;
    }
    if (s.type && !['stdio', 'local'].includes(s.type)) { check(`${label} [${s.name}] type`, false, s.type); continue; }
    const env = { ...baseEnv, ...Object.fromEntries(Object.entries(s.env ?? {}).map(([k, v]) => [k, interp(v)])) };
    const args = (s.args ?? []).map(interp);
    const r = await launch(label, s.command, args, env, ws);
    check(`${label} [${s.name}] \`${s.command} ${args.join(' ')}\` launches from a temp dir (initialize + tools/list)`, r.ok, r.detail);
    const dd = args.includes('--data-dir') ? args[args.indexOf('--data-dir') + 1] : env.KRONICLE_LITE_DATA_DIR ?? '~/.kronicle-lite';
    console.log(`     store: ${dd.replace(t.dir, '<tmp>')}`);
  }
  if (b.lang === 'toml' && process.env.CODEX_BIN) {
    const ch = join(t.dir, 'codex'); mkdirSync(ch); writeFileSync(join(ch, 'config.toml'), b.text);
    const r = spawnSync(process.env.CODEX_BIN, ['mcp', 'list', '--json'], { env: { ...process.env, CODEX_HOME: ch }, encoding: 'utf8' });
    check(`${label}: \`codex mcp list\` accepts the TOML`, r.status === 0, (r.stderr || '').split('\n').filter((l) => !/WARNING/.test(l)).join(' ').slice(0, 200));
  }
  t.rm();
}
process.exit(summary() ? 1 : 0);
