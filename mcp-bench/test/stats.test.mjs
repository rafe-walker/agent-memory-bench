import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeArm, summarizePairs } from '../lib/stats.mjs';
import { schedule, balanced } from '../lib/trials.mjs';

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

test('schedule: seeded AB/BA blocks, each arm first equally often, unique tags', () => {
  const task = { id: 't' };
  const a = schedule({ task, arms: ['x', 'y'], models: ['m1', 'm2'], n: 10, seed: 7 });
  assert.deepEqual(a, schedule({ task, arms: ['x', 'y'], models: ['m1', 'm2'], n: 10, seed: 7 }));
  assert.equal(a.length, 40);
  for (const m of ['m1', 'm2']) {
    for (let t = 0; t < 10; t++) assert.deepEqual(a.filter((p) => p.model === m && p.trial === t).map((p) => p.arm).sort(), ['x', 'y']);
    for (let b = 0; b < 5; b++) {
      const firsts = a.filter((p) => p.model === m && p.block === b && p.order === 0).map((p) => p.arm).sort();
      assert.deepEqual(firsts, ['x', 'y'], `block ${b} is one AB and one BA`);
    }
  }
  assert.equal(new Set(a.map((p) => p.run_tag)).size, 40);
  const blockOrders = (s) => schedule({ task, arms: ['x', 'y'], models: ['m'], n: 20, seed: s }).filter((p) => p.order === 0).map((p) => p.arm).join('');
  assert.notEqual(blockOrders(1), blockOrders(2), 'row order within blocks is randomized');
});

test('schedule: three arms form a Latin square per block; balance flag', () => {
  const a = schedule({ task: { id: 't' }, arms: ['x', 'y', 'z'], models: ['m'], n: 3, seed: 3 });
  for (let pos = 0; pos < 3; pos++) assert.deepEqual(a.filter((p) => p.order === pos).map((p) => p.arm).sort(), ['x', 'y', 'z']);
  assert.equal(balanced(3, ['x', 'y', 'z']), true);
  assert.equal(balanced(5, ['x', 'y']), false);
  assert.equal(schedule({ task: { id: 't' }, arms: ['x', 'y'], models: ['m'], n: 5, seed: 1 }).length, 10, 'partial last block still runs n trials');
});

test('side-effect rates and model ids are summarized', () => {
  const s = summarizeArm([
    { ...rec('a', 0, 'verified', 1), side_effects: { duplicates: 0, unexpected_mutations: 0 }, model_id: 'claude-x-1' },
    { ...rec('a', 1, 'unverified', 1), side_effects: { duplicates: 2, unexpected_mutations: 1 }, model_id: 'claude-x-1' },
    { ...rec('a', 2, 'unverified', 1), side_effects: { duplicates: null, unexpected_mutations: null } },
  ]);
  assert.deepEqual([s.duplicate_side_effects.k, s.duplicate_side_effects.n, s.duplicate_side_effects.total], [1, 2, 2]);
  assert.equal(s.unexpected_mutations.k, 1);
  assert.deepEqual(s.model_ids, ['claude-x-1']);
});
