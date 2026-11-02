// MCP conformance over stdio, raw JSON-RPC: both eras, JSON-RPC edge cases, notifications,
// cancellation, progress, unknown methods, resources/templates, pagination.
// Usage: node conformance.mjs kl|sl
import { Raw, META, MODERN, check, summary } from './common.mjs';
const which = process.argv[2] ?? 'kl';
const extra = which === 'sl' ? ['--actor', 'conf', '--session', 'c1'] : [];
const noResponse = async (r, pred, ms = 800) => { try { await r.wait(pred, ms); return false; } catch { return true; } };
// 2026-07-28 connections answer ping with -32601 (SDK 2.4); liveness = tools/list.
const alive = async (r, id = `alive-${Math.random()}`) => { try { const m = await r.rpc(id, 'tools/list', r.legacy ? undefined : { _meta: META }, 5000); return !!m.result; } catch { return false; } };

// ── 2025-era handshakes ──
for (const v of ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25', '2099-01-01', '1999-01-01']) {
  const r = new Raw(which, extra); r.legacy = true;
  const init = await r.initLegacy(v).catch((e) => ({ error: { message: e.message } }));
  const pv = init.result?.protocolVersion;
  const known = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'].includes(v);
  check(`[init ${v}] answers ${known ? 'the same version' : 'a supported version (spec: server proposes its own)'}`, known ? pv === v : typeof pv === 'string' && pv !== v, `got ${pv ?? JSON.stringify(init.error)}`);
  if (init.result) {
    check(`[init ${v}] no 2026 fields in 2025-era result`, !('resultType' in init.result) && !('ttlMs' in init.result), Object.keys(init.result).join(','));
    const tl = await r.rpc(2, 'tools/list');
    check(`[init ${v}] tools/list ok`, Array.isArray(tl.result?.tools), JSON.stringify(tl.error ?? ''));
    if (v === '2024-11-05' && tl.result) check(`[init ${v}] tools carry outputSchema (not in 2024-11-05; extra field)`, true, `outputSchema present on ${tl.result.tools.filter((t) => t.outputSchema).length}/${tl.result.tools.length}`);
    const call = await r.rpc(3, 'tools/call', { name: which === 'kl' ? 'verify_chain' : 'sea_stats', arguments: {} });
    check(`[init ${v}] tools/call ok`, call.result && !call.result.isError, JSON.stringify(call.error ?? call.result?.content?.[0]?.text ?? '').slice(0, 200));
    const p = await r.rpc(4, 'ping');
    check(`[init ${v}] ping → {}`, p.result && Object.keys(p.result).length === 0, JSON.stringify(p));
  }
  await r.close();
}

// ── requests before initialize (2025-era) ──
{
  const r = new Raw(which, extra);
  const m = await r.rpc(1, 'tools/list').catch((e) => ({ error: { message: e.message } }));
  check('[pre-init] tools/list without initialize or _meta → answered (error or result), no hang', !!(m.error || m.result), JSON.stringify(m).slice(0, 200));
  const c = await r.rpc(2, 'tools/call', { name: which === 'kl' ? 'put_document' : 'sea_create', arguments: which === 'kl' ? { slug: 'preinit', title: 'p', markdown: 'x' } : { title: 'preinit' } }).catch((e) => ({ error: { message: e.message } }));
  check('[pre-init] write tool without initialize/_meta → refused', !!c.error, JSON.stringify(c).slice(0, 200));
  await r.close();
}

// ── 2026-07-28 stateless envelope variants (fresh process each: the opening request pins the era) ──
const envelopes = [
  ['full envelope', META, true],
  ['no clientInfo', { 'io.modelcontextprotocol/protocolVersion': MODERN, 'io.modelcontextprotocol/clientCapabilities': {} }, true],
  ['no clientCapabilities', { 'io.modelcontextprotocol/protocolVersion': MODERN }, null],
  ['version is a number', { ...META, 'io.modelcontextprotocol/protocolVersion': 20260728 }, false],
  ['capabilities is a string', { ...META, 'io.modelcontextprotocol/clientCapabilities': 'x' }, false],
  ['unknown future version', { ...META, 'io.modelcontextprotocol/protocolVersion': '2027-01-01' }, false],
  ['_meta is an array', [], false],
];
for (const [label, meta, want] of envelopes) {
  const r = new Raw(which, extra);
  const m = await r.rpc(1, 'tools/list', { _meta: meta }).catch((e) => ({ error: { message: e.message } }));
  const ok = want === null ? !!(m.result || m.error) : want ? !!m.result : !!m.error;
  check(`[2026 ${label}] → ${want === null ? 'answered' : want ? 'result' : 'error'}`, ok, JSON.stringify(m.error ?? Object.keys(m.result ?? {})).slice(0, 200));
  check(`[2026 ${label}] server alive`, await alive(r));
  await r.close();
}
{
  // per-request version re-validation on a pinned stdio connection (SDK note in kl tests)
  const r = new Raw(which, extra);
  await r.rpc(1, 'server/discover', { _meta: META });
  const bad = await r.rpc(2, 'tools/list', { _meta: { ...META, 'io.modelcontextprotocol/protocolVersion': '1900-01-01' } });
  check('[2026 pinned] later request naming an unsupported version → -32022 (spec: every request)', bad.error?.code === -32022, `got ${JSON.stringify(bad.error ?? 'result')}`.slice(0, 160));
  const legacyShape = await r.rpc(3, 'tools/list');
  check('[2026 pinned] later request with no _meta at all → error', !!legacyShape.error, `got ${JSON.stringify(legacyShape.error ?? 'result')}`.slice(0, 160));
  await r.close();
}

// ── JSON-RPC edge cases (modern connection) ──
{
  const r = new Raw(which, extra);
  await r.rpc(0, 'server/discover', { _meta: META });
  const pm = await r.rpc('pingm', 'ping', { _meta: META });
  check('[rpc] ping on a 2026-07-28 connection', !!pm.result, JSON.stringify(pm.error ?? pm.result));
  const cases = [
    ['string id', { jsonrpc: '2.0', id: 'abc', method: 'tools/list', params: { _meta: META } }, (m) => m.id === 'abc' && m.result],
    ['id 0', { jsonrpc: '2.0', id: 0.0, method: 'tools/list', params: { _meta: META } }, (m) => m.id === 0 && m.result, 0],
    ['negative id', { jsonrpc: '2.0', id: -5, method: 'ping', params: { _meta: META } }, (m) => m.id === -5],
    ['fractional id', { jsonrpc: '2.0', id: 1.5, method: 'tools/list', params: { _meta: META } }, (m) => m.id === 1.5],
    ['huge id', { jsonrpc: '2.0', id: 9007199254740993, method: 'ping', params: { _meta: META } }, (m) => m.id !== undefined],
    ['unicode id', { jsonrpc: '2.0', id: 'ü\u2028😀', method: 'ping', params: { _meta: META } }, (m) => m.id === 'ü\u2028😀'],
    ['unknown method', { jsonrpc: '2.0', id: 'u1', method: 'nope/nope', params: { _meta: META } }, (m) => m.id === 'u1' && m.error?.code === -32601],
    ['logging/setLevel (no logging cap)', { jsonrpc: '2.0', id: 'u2', method: 'logging/setLevel', params: { level: 'debug', _meta: META } }, (m) => m.id === 'u2' && m.error],
    ['completion/complete', { jsonrpc: '2.0', id: 'u3', method: 'completion/complete', params: { ref: { type: 'ref/resource', uri: 'kronicle://docs/{slug}' }, argument: { name: 'slug', value: 'a' }, _meta: META } }, (m) => m.id === 'u3'],
    ['resources/subscribe', { jsonrpc: '2.0', id: 'u4', method: 'resources/subscribe', params: { uri: 'x://y', _meta: META } }, (m) => m.id === 'u4' && m.error],
    ['prompts/list', { jsonrpc: '2.0', id: 'u5', method: 'prompts/list', params: { _meta: META } }, (m) => m.id === 'u5' && m.error?.code === -32601],
    ['params is an array', { jsonrpc: '2.0', id: 'u6', method: 'tools/list', params: [] }, (m) => m.id === 'u6' && m.error],
    ['params is a string', { jsonrpc: '2.0', id: 'u7', method: 'tools/call', params: 'x' }, (m) => m.id === 'u7' && m.error],
    ['method is a number', { jsonrpc: '2.0', id: 'u8', method: 5 }, (m) => (m.id === 'u8' || m.id === null) && m.error],
    ['jsonrpc 1.0', { jsonrpc: '1.0', id: 'u9', method: 'ping', params: { _meta: META } }, (m) => (m.id === 'u9' || m.id === null) && m.error],
    ['no jsonrpc member', { id: 'u10', method: 'ping', params: { _meta: META } }, (m) => (m.id === 'u10' || m.id === null) && m.error],
    ['tools/call unknown tool', { jsonrpc: '2.0', id: 'u11', method: 'tools/call', params: { name: 'nope', arguments: {}, _meta: META } }, (m) => m.id === 'u11' && (m.error || m.result?.isError)],
    ['tools/call arguments null', { jsonrpc: '2.0', id: 'u12', method: 'tools/call', params: { name: which === 'kl' ? 'verify_chain' : 'sea_stats', arguments: null, _meta: META } }, (m) => m.id === 'u12'],
    ['tools/call arguments array', { jsonrpc: '2.0', id: 'u13', method: 'tools/call', params: { name: which === 'kl' ? 'verify_chain' : 'sea_stats', arguments: [], _meta: META } }, (m) => m.id === 'u13' && (m.error || m.result?.isError)],
    ['tools/call name missing', { jsonrpc: '2.0', id: 'u14', method: 'tools/call', params: { arguments: {}, _meta: META } }, (m) => m.id === 'u14' && m.error],
    ['tools/list garbage cursor', { jsonrpc: '2.0', id: 'u15', method: 'tools/list', params: { cursor: '!!garbage', _meta: META } }, (m) => m.id === 'u15'],
    ['resources/list garbage cursor', { jsonrpc: '2.0', id: 'u16', method: 'resources/list', params: { cursor: '!!garbage', _meta: META } }, (m) => m.id === 'u16'],
    ['resources/templates/list', { jsonrpc: '2.0', id: 'u17', method: 'resources/templates/list', params: { _meta: META } }, (m) => m.id === 'u17' && m.result?.resourceTemplates?.length >= 1],
    ['response object sent to server (stray result)', { jsonrpc: '2.0', id: 'nobody', result: {} }, null],
    ['stray error object', { jsonrpc: '2.0', id: 'nobody2', error: { code: 1, message: 'x' } }, null],
    ['unknown notification', { jsonrpc: '2.0', method: 'notifications/whatever', params: {} }, null],
    ['notification with params garbage', { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'never-existed', reason: 'x' } }, null],
    ['empty object', {}, null],
    ['batch of two requests', [{ jsonrpc: '2.0', id: 'b1', method: 'tools/list', params: { _meta: META } }, { jsonrpc: '2.0', id: 'b2', method: 'tools/list', params: { _meta: META } }], null],
    ['empty batch', [], null],
  ];
  for (const [label, msg, pred, expectId] of cases) {
    r.send(msg);
    if (pred) {
      const m = await r.wait((x) => pred(x), 3000).catch(() => null);
      check(`[rpc] ${label}`, !!m, m ? JSON.stringify(m).slice(0, 180) : `no matching reply; last: ${JSON.stringify(r.msgs.at(-1)).slice(0, 180)}`);
    } else {
      await new Promise((res) => setTimeout(res, 300));
    }
    check(`[rpc] ${label}: alive`, await alive(r));
  }
  // id 0 handled? notifications must not be answered
  const before = r.msgs.length;
  r.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  r.send({ jsonrpc: '2.0', method: 'notifications/roots/list_changed' });
  check('[rpc] notifications are never answered', await noResponse(r, (m, i) => r.msgs.indexOf(m) >= before && m.id === undefined && !m.method, 500));
  const batchReply = r.msgs.find((m) => Array.isArray(m) || m.id === 'b1');
  check('[rpc] batch → single error (batching removed in 2025-06-18) or per-item answers, never silence', batchReply !== undefined || r.msgs.some((m) => m.id === null && m.error), JSON.stringify(batchReply ?? r.msgs.filter((m) => m.id === null).slice(-2)).slice(0, 200));
  check('[rpc] no unparsable output lines', r.unparsable.length === 0, r.unparsable.slice(0, 2).join(' | '));
  // duplicate in-flight ids
  r.send({ jsonrpc: '2.0', id: 'dup', method: 'tools/list', params: { _meta: META } });
  r.send({ jsonrpc: '2.0', id: 'dup', method: 'tools/list', params: { _meta: META } });
  await new Promise((res) => setTimeout(res, 400));
  check('[rpc] duplicate ids both answered (or 2nd refused), alive', r.msgs.filter((m) => m.id === 'dup').length >= 1 && (await alive(r)), `${r.msgs.filter((m) => m.id === 'dup').length} replies`);
  await r.close();
}

// ── resources ──
{
  const r = new Raw(which, extra);
  await r.rpc(0, 'server/discover', { _meta: META });
  if (which === 'kl') {
    await r.rpc(1, 'tools/call', { name: 'put_document', arguments: { slug: 'a.b-c_d', title: 'T', markdown: '# T\n\nhello' }, _meta: META });
    const uris = [
      ['existing', 'kronicle://docs/a.b-c_d', 'ok'],
      ['missing', 'kronicle://docs/nope', 'notfound'],
      ['traversal', 'kronicle://docs/../../etc/passwd', 'err'],
      ['encoded traversal', 'kronicle://docs/..%2F..%2Fetc%2Fpasswd', 'err'],
      ['percent-encoded slug', 'kronicle://docs/a%2Eb-c_d', 'any'],
      ['uppercase slug', 'kronicle://docs/A.B-C_D', 'any'],
      ['unicode slug', 'kronicle://docs/ü😀', 'err'],
      ['empty slug', 'kronicle://docs/', 'err'],
      ['query string', 'kronicle://docs/a.b-c_d?x=1', 'any'],
      ['fragment', 'kronicle://docs/a.b-c_d#frag', 'any'],
      ['other scheme', 'file:///etc/passwd', 'err'],
      ['huge uri', 'kronicle://docs/' + 'a'.repeat(1_000_000), 'err'],
      ['NUL', 'kronicle://docs/a\u0000b', 'err'],
    ];
    let i = 10;
    for (const [label, uri, want] of uris) {
      const m = await r.rpc(i++, 'resources/read', { uri, _meta: META });
      const leaked = JSON.stringify(m).includes('root:x:0:0');
      const ok = !leaked && (want === 'ok' ? !!m.result?.contents?.[0]?.text : want === 'any' ? !!(m.result || m.error) : !!m.error);
      check(`[resource ${label}] ${want}`, ok, JSON.stringify(m.error ?? m.result).slice(0, 160));
      if (want === 'notfound') check(`[resource ${label}] uses -32002 (resource not found, spec)`, m.error?.code === -32002, `code ${m.error?.code}`);
    }
  } else {
    const c = await r.rpc(1, 'tools/call', { name: 'sea_create', arguments: { title: 'res' }, _meta: META });
    const id = c.result?.structuredContent?.ticket?.id;
    const uris = [['existing', `sea://tickets/${id}`, 'ok'], ['missing', 'sea://tickets/00000000-0000-4000-8000-000000000000', 'notfound'], ['traversal', 'sea://tickets/../../x', 'err'], ['huge', 'sea://tickets/' + 'a'.repeat(1_000_000), 'err'], ['unicode', 'sea://tickets/ü😀', 'err']];
    let i = 10;
    for (const [label, uri, want] of uris) {
      const m = await r.rpc(i++, 'resources/read', { uri, _meta: META });
      const ok = want === 'ok' ? !!m.result?.contents?.[0]?.text : !!m.error;
      check(`[resource ${label}] ${want}`, ok, JSON.stringify(m.error ?? m.result).slice(0, 160));
      if (want === 'notfound') check(`[resource ${label}] uses -32002 (resource not found, spec)`, m.error?.code === -32002, `code ${m.error?.code}`);
    }
  }
  check('[resource] alive', await alive(r));
  await r.close();
}

// ── cancellation and progress (sl: a claim that waits; kl: a long verify_chain) ──
if (which === 'sl') {
  const holder = new Raw('sl', ['--actor', 'holder', '--session', 'h1']);
  const c = await holder.rpc(1, 'tools/call', { name: 'sea_create', arguments: { title: 'contended', status: 'triaged', claim_seconds: 600 }, _meta: META });
  const tid = c.result.structuredContent.ticket.id;
  const waiter = new Raw('sl', ['--actor', 'waiter', '--session', 'w1'], { home: holder.home });
  for (const era of ['modern', 'legacy']) {
    const w = era === 'modern' ? waiter : new Raw('sl', ['--actor', 'waiter2', '--session', 'w2'], { home: holder.home });
    if (era === 'legacy') { w.legacy = true; await w.initLegacy('2025-06-18'); }
    const meta = era === 'modern' ? { ...META, progressToken: 'pt-1' } : { progressToken: 'pt-1' };
    w.send({ jsonrpc: '2.0', id: 'wait1', method: 'tools/call', params: { name: 'sea_claim', arguments: { ticket_ids: [tid], wait_seconds: 30 }, _meta: meta } });
    const prog = await w.wait((m) => m.method === 'notifications/progress', 9000).catch(() => null);
    check(`[${era}] waiting claim sends notifications/progress with our token`, prog?.params?.progressToken === 'pt-1', JSON.stringify(prog?.params ?? 'none').slice(0, 200));
    w.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'wait1', reason: 'user', ...(era === 'modern' ? { _meta: META } : {}) } });
    const answered = await w.wait((m) => m.id === 'wait1', 1500).catch(() => null);
    check(`[${era}] cancelled request: no response (SHOULD NOT) or a cancellation error`, !answered || !!answered.error || answered.result?.isError, JSON.stringify(answered ?? 'silent').slice(0, 200));
    // release the holder's claim: the cancelled waiter must NOT end up holding it
    const rel = await holder.rpc(`rel-${era}`, 'tools/call', { name: 'sea_release', arguments: { ticket_id: tid, claim_token: c.result.structuredContent.claim?.claim_token ?? c.result.structuredContent.claim_token }, _meta: META });
    await new Promise((res) => setTimeout(res, 1500));
    const g = await holder.rpc(`get-${era}`, 'tools/call', { name: 'sea_get', arguments: { id: tid }, _meta: META });
    const claim = g.result.structuredContent.ticket.claim;
    check(`[${era}] cancelled waiter did not silently acquire the claim`, !claim || !/waiter/.test(claim.holder), JSON.stringify(claim));
    check(`[${era}] waiter alive after cancel`, await alive(w));
    // re-claim for the next era
    const re = await holder.rpc(`re-${era}`, 'tools/call', { name: 'sea_claim', arguments: { ticket_ids: [tid] }, _meta: META });
    c.result.structuredContent.claim = { claim_token: re.result.structuredContent.claims?.[0]?.claim_token };
    if (era === 'legacy') await w.close();
  }
  await waiter.close(); await holder.close();
}
process.exit(summary() ? 1 : 0);
