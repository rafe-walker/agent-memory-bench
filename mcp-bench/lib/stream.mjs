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

function usageOf(u) {
  u = u || {};
  return {
    input: u.input_tokens || 0,
    cache_read: u.cache_read_input_tokens || 0,
    cache_creation: u.cache_creation_input_tokens || 0,
    output: u.output_tokens || 0,
  };
}
export const totalOf = (u) => u.input + u.cache_read + u.cache_creation + u.output;

export function parseStreamJson(text) {
  const out = {
    init: null, turns: [], tool_calls: [], api_retries: [], compactions: 0, parse_errors: 0,
    result: null, events: 0,
  };
  const turnById = new Map();
  const callById = new Map();
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    let m;
    try { m = JSON.parse(line); } catch { out.parse_errors++; continue; }
    out.events++;
    if (m.type === 'system') {
      if (m.subtype === 'init') out.init = { model: m.model, tools: m.tools || [], mcp_servers: m.mcp_servers || [], version: m.claude_code_version || null, permission_mode: m.permissionMode || null };
      else if (m.subtype === 'api_retry') out.api_retries.push({ attempt: m.attempt, status: m.error_status ?? null, delay_ms: m.retry_delay_ms ?? null, error: m.error ? String(m.error).slice(0, 300) : null });
      else if (m.subtype === 'compact_boundary') out.compactions++;
    } else if (m.type === 'assistant' && m.message) {
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
      for (const c of m.message.content || []) {
        if (c.type !== 'tool_use') continue;
        const call = { id: c.id, name: c.name, input_bytes: bytes(JSON.stringify(c.input ?? {})), result_bytes: null, is_error: null, turn: id };
        callById.set(c.id, call); out.tool_calls.push(call); t.tool_uses.push(c.name);
      }
    } else if (m.type === 'user' && Array.isArray(m.message?.content)) {
      for (const c of m.message.content) {
        if (c.type !== 'tool_result') continue;
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
  const failedServers = (p.init?.mcp_servers || []).filter((s) => s.status && s.status !== 'connected').map((s) => `${s.name}:${s.status}`);
  return {
    has_result: !!r,
    subtype: r?.subtype ?? null,
    is_error: r ? !!r.is_error : true,
    num_turns: r?.num_turns ?? p.turns.filter((t) => !t.sidechain).length,
    api_calls: p.turns.length,
    duration_ms: r?.duration_ms ?? null,
    duration_api_ms: r?.duration_api_ms ?? null,
    cost_usd: r?.total_cost_usd ?? null,
    usage: { ...usage, total: totalOf(usage) },
    usage_source: usage === turnSum ? 'turns' : 'result',
    usage_turn_sum: { ...turnSum, total: totalOf(turnSum) },
    model_usage: r?.modelUsage || null,
    turns: p.turns.map((t) => ({ ...t, total: totalOf(t.usage) })),
    tool_calls: p.tool_calls,
    tool_call_count: p.tool_calls.length,
    tool_error_count: p.tool_calls.filter((c) => c.is_error).length,
    tool_result_bytes: p.tool_calls.reduce((n, c) => n + (c.result_bytes || 0), 0),
    by_tool: byTool,
    api_retries: p.api_retries,
    permission_denials: (r?.permission_denials || []).map((d) => d.tool_name || String(d)),
    compactions: p.compactions,
    parse_errors: p.parse_errors,
    init: p.init,
    mcp_failed: failedServers,
    result_text: typeof r?.result === 'string' ? r.result.slice(0, 20000) : null,
  };
}
