// sea-lite `serve --http` team mode: an actor token must act as its own actor in BOTH eras
// (2026-07-28 per-request _meta, and the 2025-era stateless legacy leg), and may never name
// another actor_id; an agent-role token may not force-release. Tokens are never printed.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { BIN, META, MODERN, tmp, httpServer, serverEnv, check, summary } from './common.mjs';

const t = tmp('proto-actors-');
const data = join(t.dir, 'data');
const mint = (actor, role) => {
  const out = execFileSync(BIN.sl, ['add-token', '--actor', actor, ...(role ? ['--role', role] : []), '--data-dir', data], { env: serverEnv(t.dir), encoding: 'utf8' });
  const m = out.match(/[A-Za-z0-9_-]{43}/);
  if (!m) throw new Error('no token in add-token output');
  return m[0];
};
(await import('node:fs')).mkdirSync(data, { recursive: true, mode: 0o700 }); // add-token on a fresh dir: see P2 finding
const alice = mint('alice');
const bob = mint('bob');
const srv = await httpServer('sl', ['--actor', 'owner', '--role', 'operator'], { home: t.dir });
let n = 1;
const post = async (tok, body, { legacy = false, headers = {} } = {}) => {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${tok}`, ...headers };
  if (!legacy) { h['MCP-Protocol-Version'] = MODERN; h['Mcp-Method'] = body.method; if (body.params?.name) h['Mcp-Name'] = body.params.name; if (body.params?.uri) h['Mcp-Name'] = body.params.uri; }
  const res = await fetch(srv.url, { method: 'POST', headers: h, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  const line = text.split('\n').find((l) => l.startsWith('data:'));
  try { json = JSON.parse(line ? line.slice(5) : text); } catch {}
  return { status: res.status, json, text };
};
const tool = async (tok, name, args, era) => {
  const legacy = era === 'legacy';
  const params = { name, arguments: args, ...(legacy ? {} : { _meta: META }) };
  const r = await post(tok, { jsonrpc: '2.0', id: n++, method: 'tools/call', params }, { legacy });
  const res = r.json?.result;
  let parsed = res?.structuredContent;
  if (!parsed && res?.content?.[0]?.text) try { parsed = JSON.parse(res.content[0].text); } catch { parsed = res.content[0].text; }
  return { status: r.status, isError: !!res?.isError, out: parsed, err: r.json?.error, raw: r.text.slice(0, 300) };
};

for (const era of ['modern', 'legacy']) {
  // whoami-equivalent: create a ticket and read created_by
  const c = await tool(alice, 'sea_create', { title: `alice-${era}`, status: 'triaged' }, era);
  check(`[${era}] alice token: created_by is alice`, c.out?.ticket?.created_by === 'alice', JSON.stringify(c.out?.ticket?.created_by ?? c.raw));
  const spoof = await tool(alice, 'sea_create', { title: `spoof-${era}`, actor_id: 'bob' }, era);
  check(`[${era}] alice token + actor_id:"bob" → forbidden`, spoof.isError && /forbidden/.test(JSON.stringify(spoof.out)), JSON.stringify(spoof.out ?? spoof.raw).slice(0, 200));
  const spoofOwner = await tool(alice, 'sea_create', { title: `spoof-owner-${era}`, actor_id: 'owner' }, era);
  check(`[${era}] alice token + actor_id:"owner" → forbidden`, spoofOwner.isError, JSON.stringify(spoofOwner.out ?? spoofOwner.raw).slice(0, 200));
  // bob claims; alice (agent role) tries to force-release
  const bc = await tool(bob, 'sea_claim', { ticket_ids: [c.out?.ticket?.id] }, era);
  check(`[${era}] bob claims alice's ticket`, !bc.isError && bc.out?.claims?.length === 1, JSON.stringify(bc.out ?? bc.raw).slice(0, 200));
  const fr = await tool(alice, 'sea_release', { ticket_id: c.out?.ticket?.id, force: true, reason: 'x' }, era);
  check(`[${era}] alice (agent) force-release of bob's claim → forbidden`, fr.isError && /forbidden/.test(JSON.stringify(fr.out)), JSON.stringify(fr.out ?? fr.raw).slice(0, 200));
  const g = await tool(bob, 'sea_get', { id: c.out?.ticket?.id }, era);
  check(`[${era}] claim still held by bob`, g.out?.ticket?.claim?.holder === 'bob', JSON.stringify(g.out?.ticket?.claim ?? g.raw).slice(0, 200));
  // stats attribution
  // instructions name the actor (initialize in legacy, server/discover in modern)
  const d = era === 'legacy'
    ? await post(alice, { jsonrpc: '2.0', id: n++, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '0' } } }, { legacy: true })
    : await post(alice, { jsonrpc: '2.0', id: n++, method: 'server/discover', params: { _meta: META } });
  check(`[${era}] instructions say "alice"`, /You are \\?"alice/.test(d.text), (d.text.match(/You are[^.]*/) ?? [''])[0]);
  // shared bearer acts as owner (operator) and may name anyone (documented)
  const s = await tool(srv.token, 'sea_create', { title: `shared-${era}`, actor_id: 'carol' }, era);
  check(`[${era}] shared bearer: actor_id label honored (documented)`, s.out?.ticket?.created_by === 'carol', JSON.stringify(s.out?.ticket?.created_by ?? s.raw));
}
// a token that is a prefix / case variant / with trailing junk is refused
for (const [label, tok] of [['prefix', alice.slice(0, 40)], ['upper', alice.toUpperCase()], ['suffix', alice + 'x'], ['bob+alice', bob + alice]]) {
  const r = await post(tok, { jsonrpc: '2.0', id: n++, method: 'server/discover', params: { _meta: META } });
  check(`token variant ${label} → 401`, r.status === 401, String(r.status));
}
// bob's claim token must not leak to alice through any read, and must not work for alice
{
  const c = await tool(bob, 'sea_create', { title: 'bob-own', status: 'triaged', claim_seconds: 600 }, 'modern');
  const tid = c.out?.ticket?.id; const btok = c.out?.claim?.claim_token ?? c.out?.claim_token;
  check('bob got a claim token', typeof btok === 'string', JSON.stringify(c.out ?? c.raw).slice(0, 200));
  const reads = [
    await tool(alice, 'sea_get', { id: tid }, 'modern'),
    await tool(alice, 'sea_list', { view: 'full', include_terminal: true }, 'modern'),
    await tool(alice, 'sea_history', { ticket_id: tid }, 'modern'),
    await tool(alice, 'sea_history', {}, 'modern'),
  ];
  const rr = await post(alice, { jsonrpc: '2.0', id: n++, method: 'resources/read', params: { uri: `sea://tickets/${tid}`, _meta: META } });
  const blob = reads.map((r) => JSON.stringify(r.out)).join('') + rr.text;
  check("bob's claim_token never appears in alice's reads", !blob.includes(btok), `${blob.length} bytes read`);
  for (const [name, args] of [
    ['sea_update', { ticket_id: tid, claim_token: btok, note: 'alice was here' }],
    ['sea_release', { ticket_id: tid, claim_token: btok }],
    ['sea_refresh', { ticket_id: tid, claim_token: btok }],
    ['sea_finish', { ticket_id: tid, claim_token: btok, outcome: 'done', note: 'x' }],
  ]) {
    const r = await tool(alice, name, args, 'legacy');
    check(`alice ${name} with bob's (leaked) claim_token → refused`, r.isError, JSON.stringify(r.out ?? r.raw).slice(0, 160));
  }
}
const st = await tool(alice, 'sea_stats', {}, 'modern');
check('sea_stats lists alice and bob as actors', JSON.stringify(st.out ?? '').includes('"alice"') && JSON.stringify(st.out ?? '').includes('"bob"'), JSON.stringify(st.out?.actors?.map((a) => a.actor)));
await srv.close();
t.rm();
process.exit(summary() ? 1 : 0);
