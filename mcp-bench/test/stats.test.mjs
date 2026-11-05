import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeArm, summarizePairs } from '../lib/stats.mjs';
import { schedule } from '../lib/trials.mjs';

const rec = (arm, trial, status, total, extra = {}) => ({ arm, trial, model: 'm', status, agent: status === 'setup_error' ? null : { usage: { total, input: total, cache_read: 0, cache_creation: 0, output: 0 }, num_turns: 2, duration_ms: 100, cost_usd: total / 1e6, tool_call_count: 1, ...extra } });

test('expected tokens per verified success divides ALL attempts\' tokens by verified count', () => {
  const s = summarizeArm([rec('a', 0, 'verified', 100), rec('a', 1, 'unverified', 300), rec('a', 2, 'verifier_error', 200), rec('a', 3, 'setup_error', 0)]);
  assert.equal(s.attempts, 3, 'setup_error excluded from the denominator');
  assert.equal(s.setup_errors, 1);
  assert.equal(s.verified, 1);
  assert.equal(s.total_tokens, 600);
  assert.equal(s.expected_tokens_per_verified_success, 600);
  assert.equal(s.success.p, 1 / 3);
  assert.equal(s.tokens.total.p50, 200);
  assert.equal(s.tokens.total.p95, 300);
});

test('zero verified successes gives null (rendered as infinity), not a mean over successes', () => {
  const s = summarizeArm([rec('a', 0, 'unverified', 100)]);
  assert.equal(s.expected_tokens_per_verified_success, null);
  assert.equal(s.success.p, 0);
});

test('pairs compare each variant to baseline per trial and count concordance', () => {
  const rs = [rec('b', 0, 'verified', 1000), rec('v', 0, 'verified', 600), rec('b', 1, 'unverified', 900), rec('v', 1, 'verified', 950), rec('b', 2, 'verified', 800)];
  const p = summarizePairs(rs, 'b', ['b', 'v']).v;
  assert.equal(p.pairs, 2, 'trial 2 has no variant run');
  assert.deepEqual(p.verified_concordance, { both: 1, baseline_only: 0, variant_only: 1, neither: 0 });
  assert.equal(p.variant_fewer_tokens, 1);
  assert.equal(p.delta_tokens.min, -400);
  assert.equal(p.delta_tokens.max, 50);
});

test('schedule is seeded, paired, and randomizes arm order', () => {
  const task = { id: 't' };
  const a = schedule({ task, arms: ['x', 'y'], models: ['m1', 'm2'], n: 10, seed: 7 });
  const b = schedule({ task, arms: ['x', 'y'], models: ['m1', 'm2'], n: 10, seed: 7 });
  assert.deepEqual(a, b);
  assert.equal(a.length, 40);
  for (const m of ['m1', 'm2']) for (let t = 0; t < 10; t++) assert.deepEqual(a.filter((p) => p.model === m && p.trial === t).map((p) => p.arm).sort(), ['x', 'y']);
  const firsts = new Set(a.filter((p) => p.order === 0).map((p) => p.arm));
  assert.equal(firsts.size, 2, 'both arms go first sometimes');
  assert.equal(new Set(a.map((p) => p.run_tag)).size, 40, 'unique run tags');
  assert.notDeepEqual(schedule({ task, arms: ['x', 'y'], models: ['m1'], n: 10, seed: 8 }).map((p) => p.arm), a.slice(0, 20).map((p) => p.arm));
});
