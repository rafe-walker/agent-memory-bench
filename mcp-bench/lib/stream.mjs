// Parse `claude -p --output-format stream-json --verbose` output into per-run metrics.
// Tolerates non-JSON lines and a missing result event (crash, timeout): the per-turn sums are then
// the only usage source and the run is marked usage_source: "turns".

const bytes = (s) => Buffer.byteLength(s, 'utf8');

function resultBytes(content) {
  if (content == null) return 0;
  if (typeof content === 'string') return bytes(content);
  if (Array.isArray(content)) return content.reduce((n, c) => n + (c?.type === 'text' ? bytes(c.text || '') : bytes(JSON.stringify(c))), 0);
  return bytes(JSON.stringify(content));
}

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const arr = (x) => (Array.isArray(x) ? x : []);
// why: a hostile or buggy CLI can emit strings, negatives or 1e400 (parses to Infinity); summing
// those yields string concatenation or Infinity (serialized as null). Count them, use 0.
let invalid = 0;
const tokenNum = (x) => {
  if (x === undefined || x === null) return 0;
  if (typeof x === 'number' && Number.isFinite(x) && x >= 0) return x;
  invalid++; return 0;
};

function usageOf(u) {
  u = isObj(u) ? u : {};
  return {
    input: tokenNum(u.input_tokens),
    cache_read: tokenNum(u.cache_read_input_tokens),
    cache_creation: tokenNum(u.cache_creation_input_tokens),
    output: tokenNum(u.output_tokens),
  };
}
export const totalOf = (u) => u.input + u.cache_read + u.cache_creation + u.output;

export function parseStreamJson(text) {
  const out = {
    init: null, turns: [], tool_calls: [], api_retries: [], compactions: 0, parse_errors: 0,
    result: null, events: 0,
  };
  invalid = 0;
  const turnById = new Map();
  const callById = new Map();
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    let m;
    try { m = JSON.parse(line); } catch { out.parse_errors++; continue; }
    if (!isObj(m)) { out.parse_errors++; continue; }
    out.events++;
    if (m.type === 'system') {
      if (m.subtype === 'init') out.init = { model: m.model, tools: arr(m.tools), mcp_servers: arr(m.mcp_servers).filter(isObj), version: m.claude_code_version || null, permission_mode: m.permissionMode || null };
      else if (m.subtype === 'api_retry') out.api_retries.push({ attempt: m.attempt, status: m.error_status ?? null, delay_ms: m.retry_delay_ms ?? null, error: m.error ? String(m.error).slice(0, 300) : null });
      else if (m.subtype === 'compact_boundary') out.compactions++;
    } else if (m.type === 'assistant' && isObj(m.message)) {
      const id = m.message.id || `anon-${out.turns.length}`;
      let t = turnById.get(id);
      if (!t) {
        t = { id, model: m.message.model || null, sidechain: !!m.parent_tool_use_id, usage: usageOf(null), tool_uses: [] };
        turnById.set(id, t); out.turns.push(t);
      }
      // why: one API message arrives as several events (one per content block) carrying the same or
      // a growing usage object; keep the largest per field instead of summing duplicates.
      const u = usageOf(m.message.usage);
      for (const k of Object.keys(u)) t.usage[k] = Math.max(t.usage[k], u[k]);
      for (const c of arr(m.message.content)) {
        if (!isObj(c) || c.type !== 'tool_use') continue;
        // why: a re-emitted message repeats its tool_use blocks; one tool_use id is one call.
        if (c.id !== undefined && callById.has(c.id)) continue;
        const call = { id: c.id, name: c.name, input_bytes: bytes(JSON.stringify(c.input ?? {})), result_bytes: null, is_error: null, turn: id };
        callById.set(c.id, call); out.tool_calls.push(call); t.tool_uses.push(c.name);
      }
    } else if (m.type === 'user' && Array.isArray(m.message?.content)) {
      for (const c of m.message.content) {
        if (!isObj(c) || c.type !== 'tool_result') continue;
        const call = callById.get(c.tool_use_id);
        if (!call) continue;
        call.result_bytes = resultBytes(c.content);
        call.is_error = !!c.is_error;
      }
    } else if (m.type === 'result') {
      out.result = m;
    }
  }
  return summarize(out);
}

function summarize(p) {
  const turnSum = usageOf(null);
  for (const t of p.turns) for (const k of Object.keys(turnSum)) turnSum[k] += t.usage[k];
  const r = p.result;
  const resultUsage = r?.usage ? usageOf(r.usage) : null;
  // Prefer the provider's run total from the result event; fall back to per-turn sums.
  const usage = resultUsage && totalOf(resultUsage) > 0 ? resultUsage : turnSum;
  const byTool = {};
  for (const c of p.tool_calls) {
    const b = (byTool[c.name] ||= { calls: 0, errors: 0, input_bytes: 0, result_bytes: 0 });
    b.calls++; if (c.is_error) b.errors++;
    b.input_bytes += c.input_bytes; b.result_bytes += c.result_bytes || 0;
  }
  const cost = r?.total_cost_usd;
  const costOk = typeof cost === 'number' && Number.isFinite(cost) && cost >= 0;
  if (cost != null && !costOk) invalid++;
  const failedServers = (p.init?.mcp_servers || []).filter((s) => s.status && s.status !== 'connected').map((s) => `${s.name}:${s.status}`);
  return {
    has_result: !!r,
    subtype: r?.subtype ?? null,
    is_error: r ? !!r.is_error : true,
    num_turns: r ? (Number.isInteger(r.num_turns) && r.num_turns >= 0 ? r.num_turns : null) : p.turns.filter((t) => !t.sidechain).length,
    api_calls: p.turns.length,
    duration_ms: Number.isFinite(r?.duration_ms) ? r.duration_ms : null,
    duration_api_ms: Number.isFinite(r?.duration_api_ms) ? r.duration_api_ms : null,
    // null = unknown (no result event, or an invalid value); the budget gate charges unknown cost
    // at the per-attempt cap.
    cost_usd: costOk ? cost : null,
    // Provider-reported only: from the result event, or (no result event) the sum of per-message usage.
    usage: { ...usage, total: totalOf(usage) },
    usage_source: usage === turnSum ? 'turns' : 'result',
    model_ids: [...new Set([...(isObj(r?.modelUsage) ? Object.keys(r.modelUsage) : []), ...p.turns.map((t) => t.model).filter(Boolean)])].sort(),
    usage_turn_sum: { ...turnSum, total: totalOf(turnSum) },
    model_usage: isObj(r?.modelUsage) ? r.modelUsage : null,
    turns: p.turns.map((t) => ({ ...t, total: totalOf(t.usage) })),
    tool_calls: p.tool_calls,
    tool_call_count: p.tool_calls.length,
    tool_error_count: p.tool_calls.filter((c) => c.is_error).length,
    tool_result_bytes: p.tool_calls.reduce((n, c) => n + (c.result_bytes || 0), 0),
    by_tool: byTool,
    // Estimates live here and only here; `usage` is provider-reported, never mixed with these.
    estimated: {
      method: 'utf8_bytes/4',
      tool_input_tokens: Math.round(p.tool_calls.reduce((n, c) => n + c.input_bytes, 0) / 4),
      tool_result_tokens: Math.round(p.tool_calls.reduce((n, c) => n + (c.result_bytes || 0), 0) / 4),
    },
    api_retries: p.api_retries,
    permission_denials: arr(r?.permission_denials).map((d) => d?.tool_name || String(d)),
    compactions: p.compactions,
    parse_errors: p.parse_errors,
    invalid_fields: invalid,
    init: p.init,
    mcp_failed: failedServers,
    result_text: typeof r?.result === 'string' ? r.result.slice(0, 20000) : null,
  };
}
