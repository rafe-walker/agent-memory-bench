import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStreamJson } from '../lib/stream.mjs';

const j = (o) => JSON.stringify(o);
const U = (i, cr, cc, o) => ({ input_tokens: i, cache_read_input_tokens: cr, cache_creation_input_tokens: cc, output_tokens: o });

test('per-turn usage is de-duplicated by message id; tool calls pair with results and sizes', () => {
  const s = [
    j({ type: 'system', subtype: 'init', model: 'm', tools: ['mcp__a__x'], mcp_servers: [{ name: 'a', status: 'connected' }, { name: 'b', status: 'failed' }], claude_code_version: '9.9.9' }),
    j({ type: 'system', subtype: 'api_retry', attempt: 1, error_status: 529, retry_delay_ms: 100, error: 'overloaded' }),
    j({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'hi' }], usage: U(10, 100, 5, 1) } }),
    j({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'mcp__a__x', input: { q: 'abc' } }], usage: U(10, 100, 5, 7) } }),
    'garbage {',
    j({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'ééé' }], is_error: true }] } }),
    j({ type: 'assistant', message: { id: 'm2', content: [{ type: 'tool_use', id: 't2', name: 'mcp__a__x', input: {} }], usage: U(20, 200, 0, 3) } }),
    j({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'okay' }] } }),
    j({ type: 'system', subtype: 'compact_boundary' }),
    j({ type: 'result', subtype: 'success', is_error: false, num_turns: 2, duration_ms: 500, duration_api_ms: 400, total_cost_usd: 0.01, usage: U(30, 300, 5, 10), permission_denials: [{ tool_name: 'Bash' }], result: 'done' }),
  ].join('\n');
  const m = parseStreamJson(s);
  assert.equal(m.api_calls, 2);
  assert.deepEqual(m.turns[0].usage, { input: 10, cache_read: 100, cache_creation: 5, output: 7 });
  assert.equal(m.usage_source, 'result');
  assert.equal(m.usage.total, 345);
  assert.equal(m.usage_turn_sum.total, 345, 'turn sums agree with result when deduped');
  assert.equal(m.tool_call_count, 2);
  assert.equal(m.tool_error_count, 1);
  assert.equal(m.tool_calls[0].input_bytes, Buffer.byteLength(JSON.stringify({ q: 'abc' })));
  assert.equal(m.tool_calls[0].result_bytes, 6, 'utf-8 bytes, not chars');
  assert.equal(m.tool_calls[1].result_bytes, 4);
  assert.deepEqual(m.by_tool['mcp__a__x'], { calls: 2, errors: 1, input_bytes: 11 + 2, result_bytes: 10 });
  assert.equal(m.api_retries.length, 1);
  assert.equal(m.api_retries[0].status, 529);
  assert.deepEqual(m.permission_denials, ['Bash']);
  assert.deepEqual(m.mcp_failed, ['b:failed']);
  assert.equal(m.compactions, 1);
  assert.equal(m.parse_errors, 1);
  assert.equal(m.init.version, '9.9.9');
  assert.equal(m.is_error, false);
  assert.equal(m.cost_usd, 0.01);
});

test('missing result event (crash/timeout): usage falls back to turn sums, run counts as an error', () => {
  const s = j({ type: 'assistant', message: { id: 'a', content: [], usage: U(5, 0, 0, 2) } });
  const m = parseStreamJson(s);
  assert.equal(m.has_result, false);
  assert.equal(m.is_error, true);
  assert.equal(m.usage_source, 'turns');
  assert.equal(m.usage.total, 7);
  assert.equal(m.num_turns, 1);
  assert.equal(m.cost_usd, null);
});

test('empty output parses to zeros', () => {
  const m = parseStreamJson('');
  assert.equal(m.usage.total, 0);
  assert.equal(m.tool_call_count, 0);
});
