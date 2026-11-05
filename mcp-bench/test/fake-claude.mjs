#!/usr/bin/env node
// Test double for `claude -p --output-format stream-json`. Never calls a model.
// Behaviour comes from the agent env (set through a task's env:), so it also proves the runner
// scrubs everything else:
//   FAKE_CLAUDE_MODE   ok (default) | dup (writes the file twice) | skip | error | hang | crash | flood | unicode | orphan
//   FAKE_PID_FILE      write the fake's pid here (signal tests)
//   FAKE_TOKENS        input tokens per turn (default 1000)
//   FAKE_CLAUDE_LOG    append {argv, env_keys, cwd} as one JSON line
// In ok mode a prompt line "WRITE <file> <content>" is carried out in cwd (the "real state" the
// verifier inspects).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('0.0.0-fake (Claude Code)'); process.exit(0); }
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const mode = process.env.FAKE_CLAUDE_MODE || 'ok';
const base = Number(process.env.FAKE_TOKENS || 1000);
if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ argv, env_keys: Object.keys(process.env).sort(), cwd: process.cwd() }) + '\n');

const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');
let servers = [];
const mcpFile = arg('--mcp-config');
if (mcpFile) servers = Object.keys(JSON.parse(fs.readFileSync(mcpFile, 'utf8')).mcpServers).map((name) => ({ name, status: process.env.FAKE_MCP_STATUS || 'connected' }));
emit({ type: 'system', subtype: 'init', model: arg('--model'), tools: ['mcp__fake__write'], mcp_servers: servers, claude_code_version: '0.0.0-fake', permissionMode: arg('--permission-mode') });

if (process.env.FAKE_PID_FILE) fs.writeFileSync(process.env.FAKE_PID_FILE, String(process.pid));
if (mode === 'orphan') {
  // a background child that outlives claude (Bash run_in_background, an MCP server ignoring EOF)
  const c = spawn('sleep', ['300'], { stdio: 'ignore' });
  fs.writeFileSync(process.env.FAKE_ORPHAN_PID_FILE, String(c.pid));
  c.unref();
}
if (mode === 'flood') {
  // never-ending output: the harness must cap what it buffers and kill the agent
  const chunk = `${'x'.repeat(1 << 16)}\n`;
  const go = () => { while (process.stdout.write(chunk)); process.stdout.once('drain', go); };
  go();
} else if (mode === 'unicode') {
  // multi-byte characters straddling pipe chunk boundaries
  const t = '😀é'.repeat(60000);
  emit({ type: 'assistant', message: { id: 'msg_1', model: arg('--model'), content: [{ type: 'tool_use', id: 'tu_1', name: 'mcp__fake__write', input: {} }], usage: { input_tokens: 1 } } });
  emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: t }] } });
  emit({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 1 }, result: t });
} else if (mode === 'hang') { setTimeout(() => {}, 60_000); } else {
  const u1 = { input_tokens: base, cache_read_input_tokens: 200, cache_creation_input_tokens: 50, output_tokens: 40 };
  const u2 = { input_tokens: base + 100, cache_read_input_tokens: 300, cache_creation_input_tokens: 0, output_tokens: 20 };
  if (process.env.FAKE_RETRY) emit({ type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 10, retry_delay_ms: 500, error_status: 529, error: 'overloaded' });
  emit({ type: 'assistant', message: { id: 'msg_1', model: arg('--model'), content: [{ type: 'text', text: 'working' }], usage: u1 } });
  emit({ type: 'assistant', message: { id: 'msg_1', model: arg('--model'), content: [{ type: 'tool_use', id: 'tu_1', name: 'mcp__fake__write', input: { note: 'x'.repeat(10) } }], usage: u1 } });
  const m = /^WRITE (\S+) (.+)$/m.exec(arg('-p') || '');
  if ((mode === 'ok' || mode === 'dup' || mode === 'orphan') && m) fs.writeFileSync(path.join(process.cwd(), m[1]), m[2]);
  if (mode === 'dup' && m) fs.writeFileSync(path.join(process.cwd(), `${m[1]}.copy`), m[2]);
  emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: [{ type: 'text', text: ['ok', 'dup', 'orphan'].includes(mode) ? 'written' : 'refused' }], is_error: !['ok', 'dup', 'orphan'].includes(mode) }] } });
  process.stdout.write('this line is not json\n');
  if (mode === 'crash') process.exit(1);
  emit({ type: 'assistant', message: { id: 'msg_2', model: arg('--model'), content: [{ type: 'text', text: 'done' }], usage: u2 } });
  const sum = Object.fromEntries(Object.keys(u1).map((k) => [k, u1[k] + u2[k]]));
  emit({
    type: 'result', subtype: mode === 'error' ? 'error_max_turns' : 'success', is_error: mode === 'error', num_turns: 2,
    duration_ms: 1234, duration_api_ms: 1000, total_cost_usd: base / 1e6, usage: sum, permission_denials: [], result: 'done',
  });
}
