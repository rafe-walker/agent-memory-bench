// Markdown rendering of a results.json produced by `mcp-bench run`.
const n0 = (x) => (x == null ? '–' : Math.round(x).toLocaleString('en-US'));
const pct = (x) => (x == null ? '–' : `${(x * 100).toFixed(0)}%`);
const usd = (x) => (x == null ? '–' : `$${x.toFixed(4)}`);
const sec = (ms) => (ms == null ? '–' : `${(ms / 1000).toFixed(1)}s`);
const sgn = (x, f = n0) => (x == null ? '–' : x > 0 ? `+${f(x)}` : f(x));

export function renderMarkdown(res) {
  const L = [];
  L.push(`# mcp-bench results`, '');
  L.push(`Generated ${res.generated_at}. Claude Code ${res.claude_version || 'unknown'}. Purpose: **${res.purpose || 'unspecified'}**. Seed ${res.seed}, ${res.n} trial(s) per arm per model in randomized AB/BA (Latin-square) blocks, start state reset per trial.`, '');
  L.push('**How to read this.** Tokens are provider-reported usage (Anthropic tokenizer of the model named), exposure = **task** (one full headless session per attempt, catalog and prompt included), summed as input + cache read + cache creation + output. ' +
    '**Verified** means the task\'s independent state verifier passed; the agent\'s own claim never counts. ' +
    '**Expected tokens per verified success** = total tokens across *all* attempts (failures, timeouts and errors included) ÷ verified successes. ' +
    'Success intervals are 95% Wilson. Percentiles are nearest-rank; with n < 20, p95 is the max. ' +
    '**Duplicate side effects** = attempts where the verifier found a resource created more than once. ' +
    'Estimated counts (marked est., utf-8 bytes ÷ 4) are never mixed into provider-reported tokens.', '');
  for (const t of res.tasks) {
    L.push(`## ${t.task}`, '');
    if (t.description) L.push(t.description.trim(), '');
    L.push(`Arms: ${t.arms.map((a) => (a === t.baseline ? `**${a}** (baseline)` : a)).join(', ')}. max_turns ${t.max_turns}, max $${t.max_budget_usd_per_attempt}/attempt. ${t.completed_attempts}/${t.planned_attempts} attempts run, spent ${usd(t.spent_usd)}.`, '');
    if (t.stopped) L.push(`> **Stopped early:** ${t.stopped}`, '');
    if (t.unpriced_attempts) L.push(`> **Spend estimate:** ${t.unpriced_attempts} attempt(s) reported no cost (crash, timeout or invalid value) and were charged at the per-attempt cap; provider-reported spend ${usd(t.spent_usd_reported)}.`, '');
    if (t.balanced === false) L.push(`> **Unbalanced:** n=${t.n} is not a multiple of ${t.arms.length} arms; the last block does not counterbalance order.`, '');
    for (const [model, m] of Object.entries(t.models)) {
      const ids = [...new Set(Object.values(m.arms).flatMap((a) => a.model_ids || []))];
      L.push(`### ${model}`, '', `Resolved model ID(s): ${ids.length ? ids.map((x) => `\`${x}\``).join(', ') : 'unknown'}${ids.length > 1 ? ' — **more than one: the model changed during the run**' : ''}.`, '');
      L.push('| arm | exp. tokens / verified success | success (95% CI) | verified / n | tokens p50 / p95 (n) | wall time p50 / p95 | turns p50 / p95 | tool calls p50 / p95 | duplicate side effects | unexpected mutations | exp. cost / verified success | errors (agent / tool / retry / timeout / verifier) | setup errors | no result event |');
      L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
      const side = (x) => (x?.n ? `${pct(x.p)} (${x.k}/${x.n})` : '–');
      for (const [arm, s] of Object.entries(m.arms)) {
        const ci = s.success.wilson.lo == null ? '' : ` (${pct(s.success.wilson.lo)}–${pct(s.success.wilson.hi)})`;
        const lb = s.usage_lower_bound ? '≥ ' : '';
        L.push(`| ${arm} | ${s.verified ? lb + n0(s.expected_tokens_per_verified_success) : '∞ (0 verified)'} | ${pct(s.success.p)}${ci} | ${s.verified} / ${s.attempts} | ${n0(s.tokens.total.p50)} / ${n0(s.tokens.total.p95)} (${s.tokens.total.n}) | ${sec(s.wall_ms.p50)} / ${sec(s.wall_ms.p95)} | ${n0(s.turns.p50)} / ${n0(s.turns.p95)} | ${n0(s.tool_calls.p50)} / ${n0(s.tool_calls.p95)} | ${side(s.duplicate_side_effects)} | ${side(s.unexpected_mutations)} | ${usd(s.expected_cost_per_verified_success)} | ${s.agent_errors} / ${s.tool_errors} / ${s.api_retries} / ${s.timeouts} / ${s.verifier_errors} | ${s.setup_errors} | ${n0(s.usage_lower_bound)} |`);
      }
      L.push('');
      const lbArms = Object.entries(m.arms).filter(([, s]) => s.usage_lower_bound);
      if (lbArms.length) L.push(`> **Lower bound:** ${lbArms.map(([a, s]) => `${a}: ${s.usage_lower_bound}/${s.attempts} attempts`).join(', ')} had no result event (crash, timeout, kill, output cap). Their tokens are per-message sums, whose output count is ~0, so ≥ marks figures that include them; compare such arms with care.`, '');
      L.push('Token split (p50): ' + Object.entries(m.arms).map(([a, s]) => `${a}: in ${n0(s.tokens.input.p50)}, cache read ${n0(s.tokens.cache_read.p50)}, cache write ${n0(s.tokens.cache_creation.p50)}, out ${n0(s.tokens.output.p50)}; tool results ${n0(s.tool_result_bytes.p50)} B ≈ ${n0(s.estimated_tool_result_tokens.p50)} tok (est.)`).join('; ') + '.', '');
      const pairs = Object.entries(m.paired);
      if (pairs.length) {
        L.push('| variant vs baseline | pairs | Δ tokens p50 (min…max) | variant cheaper in | Δ turns p50 | Δ wall time p50 | verified: both / baseline only / variant only / neither |');
        L.push('|---|---|---|---|---|---|---|');
        for (const [arm, p] of pairs) {
          const c = p.verified_concordance;
          L.push(`| ${arm} vs ${p.vs} | ${p.pairs} | ${sgn(p.delta_tokens.p50)} (${sgn(p.delta_tokens.min)}…${sgn(p.delta_tokens.max)}) | ${p.variant_fewer_tokens}/${p.pairs} | ${sgn(p.delta_turns.p50)} | ${sgn(p.delta_wall_ms.p50, sec)} | ${c.both} / ${c.baseline_only} / ${c.variant_only} / ${c.neither} |`);
        }
        L.push('');
      }
    }
    const fails = t.records.filter((r) => r.status !== 'verified');
    if (fails.length) {
      L.push('<details><summary>Non-verified attempts</summary>', '');
      for (const r of fails) {
        const why = r.status === 'setup_error' ? (r.setup?.error || r.setup?.stderr_tail || 'setup failed')
          : r.agent?.timed_out ? 'agent timed out' : r.agent?.is_error ? `agent ${r.agent.subtype || 'error'}` : JSON.stringify(r.verifier?.details ?? null);
        L.push(`- ${r.model} t${r.trial} ${r.arm}: **${r.status}** — ${String(why).replace(/\s+/g, ' ').slice(0, 300)}`);
      }
      L.push('', '</details>', '');
    }
  }
  return L.join('\n');
}
