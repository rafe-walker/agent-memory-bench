// Summary statistics per arm and per pair. Percentiles are nearest-rank (same as Track A).
import { percentile, rate } from '../../track-a/lib/stats.mjs';

export { percentile };

const COUNTED = new Set(['verified', 'unverified', 'verifier_error']);

function dist(xs) {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x));
  return { n: v.length, p50: percentile(v, 0.5), p95: percentile(v, 0.95), min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null, sum: v.reduce((a, b) => a + b, 0) };
}

function sideRate(rs, k) {
  const rep = rs.filter((r) => r.side_effects?.[k] != null);
  return { ...rate(rep.filter((r) => r.side_effects[k] > 0).length, rep.length), total: rep.reduce((n, r) => n + r.side_effects[k], 0) };
}

/**
 * Per-arm summary. Every attempt that reached the agent counts in the denominator, including
 * timeouts, agent errors and verifier errors; only setup_error (harness never started the agent)
 * is excluded and reported separately.
 * expected_tokens_per_verified_success = total tokens across ALL counted attempts / verified.
 */
export function summarizeArm(records) {
  const counted = records.filter((r) => COUNTED.has(r.status));
  const verified = counted.filter((r) => r.status === 'verified').length;
  const tok = (r) => r.agent?.usage?.total ?? 0;
  const totalTokens = counted.reduce((n, r) => n + tok(r), 0);
  const totalCost = counted.reduce((n, r) => n + (r.agent?.cost_usd ?? 0), 0);
  const comp = (k) => dist(counted.map((r) => r.agent?.usage?.[k] ?? 0));
  return {
    attempts: counted.length,
    setup_errors: records.filter((r) => r.status === 'setup_error').length,
    verifier_errors: counted.filter((r) => r.status === 'verifier_error').length,
    verified,
    success: rate(verified, counted.length),
    tokens: { total: dist(counted.map(tok)), input: comp('input'), cache_read: comp('cache_read'), cache_creation: comp('cache_creation'), output: comp('output') },
    turns: dist(counted.map((r) => r.agent?.num_turns)),
    wall_ms: dist(counted.map((r) => r.agent?.wall_ms)),
    duration_ms: dist(counted.map((r) => r.agent?.duration_ms)),
    tool_calls: dist(counted.map((r) => r.agent?.tool_call_count ?? 0)),
    tool_result_bytes: dist(counted.map((r) => r.agent?.tool_result_bytes ?? 0)),
    tool_errors: counted.reduce((n, r) => n + (r.agent?.tool_error_count ?? 0), 0),
    api_retries: counted.reduce((n, r) => n + (r.agent?.api_retries?.length ?? 0), 0),
    agent_errors: counted.filter((r) => r.agent?.is_error).length,
    timeouts: counted.filter((r) => r.agent?.timed_out).length,
    mcp_connect_failures: counted.filter((r) => r.agent?.mcp_failed?.length).length,
    cost_usd: { total: totalCost, p50: dist(counted.map((r) => r.agent?.cost_usd)).p50 },
    // Rates over attempts whose verifier reported the counter (the verifier SDK always does).
    duplicate_side_effects: sideRate(counted, 'duplicates'),
    unexpected_mutations: sideRate(counted, 'unexpected_mutations'),
    // Frozen IDs as resolved by the CLI (init event), whatever alias was requested.
    model_ids: [...new Set(counted.map((r) => r.model_id).filter(Boolean))].sort(),
    estimated_tool_result_tokens: { method: 'utf8_bytes/4', ...dist(counted.map((r) => r.agent?.estimated?.tool_result_tokens ?? 0)) },
    // why: without a result event usage is the per-message sum, whose output_tokens is the
    // message_start value (~0); those totals, and every aggregate that includes them, are lower bounds.
    usage_lower_bound: counted.filter((r) => r.agent?.usage_source === 'turns').length,
    total_tokens: totalTokens,
    expected_tokens_per_verified_success: verified ? totalTokens / verified : null,
    expected_cost_per_verified_success: verified ? totalCost / verified : null,
  };
}

/** Paired comparison of each non-baseline arm against the baseline, trial by trial. */
export function summarizePairs(records, baseline, arms) {
  const byTrial = new Map();
  for (const r of records) {
    if (!COUNTED.has(r.status)) continue;
    const k = `${r.model}|${r.trial}`;
    if (!byTrial.has(k)) byTrial.set(k, {});
    byTrial.get(k)[r.arm] = r;
  }
  const out = {};
  for (const arm of arms) {
    if (arm === baseline) continue;
    const d = { tokens: [], turns: [], duration_ms: [] };
    const c = { both: 0, baseline_only: 0, variant_only: 0, neither: 0 };
    let pairs = 0;
    for (const t of byTrial.values()) {
      const b = t[baseline], v = t[arm];
      if (!b || !v) continue;
      pairs++;
      d.tokens.push((v.agent?.usage?.total ?? 0) - (b.agent?.usage?.total ?? 0));
      d.turns.push((v.agent?.num_turns ?? 0) - (b.agent?.num_turns ?? 0));
      d.duration_ms.push((v.agent?.wall_ms ?? 0) - (b.agent?.wall_ms ?? 0));
      const bv = b.status === 'verified', vv = v.status === 'verified';
      c[bv && vv ? 'both' : bv ? 'baseline_only' : vv ? 'variant_only' : 'neither']++;
    }
    out[arm] = {
      vs: baseline, pairs, verified_concordance: c,
      variant_fewer_tokens: d.tokens.filter((x) => x < 0).length,
      delta_tokens: dist(d.tokens), delta_turns: dist(d.turns), delta_wall_ms: dist(d.duration_ms),
    };
  }
  return out;
}
