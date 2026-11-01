#!/usr/bin/env node
// Track B runner: executes a plan of (scenario × arm × model × seed) cells
// with real headless `claude -p` sessions in isolated per-run HOME /
// CLAUDE_CONFIG_DIR, grades each run deterministically, and appends one JSON
// line per run to results/track-b/runs.jsonl. Resumable; hard budget cap.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { RESULTS, BIN, rng, write, readJsonl, appendJsonl } from './common.mjs';
import { commitAll } from './fixture.mjs';
import { SCENARIOS } from '../scenarios/index.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const PLAN = JSON.parse(fs.readFileSync(args.plan || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'plans', 'main.json'), 'utf8'));
const CAP = Number(args.cap || process.env.TRACKB_CAP || 240);
const RUN_ROOT = args['run-root'] || process.env.TRACKB_RUN_ROOT || path.join(os.tmpdir(), 'amb-track-b');
const CONC = Number(args.concurrency || PLAN.concurrency || 4);
const DRY = !!args['dry-run'];
const LEDGER = path.join(RESULTS, 'ledger.jsonl');
const RUNS = path.join(RESULTS, 'runs.jsonl');
const TRANSCRIPTS = path.join(RESULTS, 'transcripts');
fs.mkdirSync(TRANSCRIPTS, { recursive: true });

let invocations = readJsonl(LEDGER).length;
const done = new Map(readJsonl(RUNS).map((r) => [r.key, r]));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const BASE_TOOLS = ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Skill', 'TodoWrite'];

function cleanEnv(ctx, agentId) {
  const keep = ['PATH', 'HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE', 'ANTHROPIC_BASE_URL', 'LANG', 'TERM'];
  const env = {};
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  env.PATH = [...ctx.pathPrepend, env.PATH].join(':');
  Object.assign(env, {
    HOME: ctx.home, CLAUDE_CONFIG_DIR: ctx.cfgDir, BENCH_AGENT: agentId,
    GIT_AUTHOR_NAME: `agent-${agentId}`, GIT_AUTHOR_EMAIL: `agent-${agentId}@example.invalid`,
    GIT_COMMITTER_NAME: `agent-${agentId}`, GIT_COMMITTER_EMAIL: `agent-${agentId}@example.invalid`,
    DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
    BEADS_ACTOR: `agent-${agentId}`,
    ORDERS_RELTOOL: BIN.stub, BENCH_RUN: ctx.runDir,
  }, ctx.env);
  return env;
}

function parseStream(text) {
  const out = { toolCalls: [], toolErrors: [], compactions: 0, result: null, resultText: '', hookEvents: 0, initTools: null, mcpServers: null, skills: null };
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.type === 'system' && m.subtype === 'init') { out.initTools = m.tools; out.mcpServers = m.mcp_servers; out.skills = m.skills; }
    if (m.type === 'system' && m.subtype === 'compact_boundary') out.compactions++;
    if (m.type === 'system' && /^hook_/.test(m.subtype || '')) out.hookEvents++;
    if (m.type === 'assistant' && Array.isArray(m.message?.content)) {
      for (const c of m.message.content) if (c.type === 'tool_use') out.toolCalls.push({ name: c.name, input: c.input });
    }
    if (m.type === 'user' && Array.isArray(m.message?.content)) {
      for (const c of m.message.content) {
        if (c.type !== 'tool_result') continue;
        const t = typeof c.content === 'string' ? c.content : Array.isArray(c.content) ? c.content.map((x) => x.text || '').join('\n') : '';
        if (c.is_error) out.toolErrors.push(t.slice(0, 2000));
        else if (/scope_conflict|someone else's live claim|has been modified since|index\.lock/i.test(t)) out.toolErrors.push(t.slice(0, 2000));
      }
    }
    if (m.type === 'result') { out.result = m; out.resultText = m.result || ''; }
  }
  return out;
}

function runClaude(ctx, agent, model, scn) {
  return new Promise((resolve) => {
    const mcp = { mcpServers: { ...ctx.mcp.mcpServers, ...(ctx.perAgentMcp ? ctx.perAgentMcp(agent.id) : {}) } };
    const mcpFile = path.join(ctx.runDir, `mcp-${agent.id}.json`);
    write(mcpFile, JSON.stringify(mcp, null, 2));
    const cliArgs = [
      '-p', agent.prompt, '--model', model, '--output-format', 'stream-json', '--verbose',
      '--permission-mode', 'dontAsk', '--allowedTools', ctx.allowed.join(','),
      '--strict-mcp-config', '--mcp-config', mcpFile,
      '--max-turns', String(scn.maxTurns || 40), '--max-budget-usd', String(PLAN.maxUsdPerRun || 1.5),
      '--include-hook-events',
      ...ctx.pluginDirs.flatMap((p) => ['--plugin-dir', p]),
      ...ctx.extraArgs,
    ];
    appendJsonl(LEDGER, { ts: new Date().toISOString(), key: ctx.key, agent: agent.id, model });
    invocations++;
    const t0 = Date.now();
    const p = spawn('claude', cliArgs, { cwd: ctx.repo, env: cleanEnv(ctx, agent.id), stdio: ['ignore', 'pipe', 'pipe'] });
    let so = '', se = '';
    p.stdout.on('data', (d) => { so += d; });
    p.stderr.on('data', (d) => { se += d; });
    const to = setTimeout(() => { p.kill('SIGTERM'); setTimeout(() => p.kill('SIGKILL'), 5000); }, (PLAN.timeoutSec || 900) * 1000);
    p.on('close', (code) => {
      clearTimeout(to);
      const wall = Date.now() - t0;
      fs.writeFileSync(path.join(TRANSCRIPTS, `${ctx.key.replace(/\|/g, '__')}__${agent.id}.jsonl.gz`), zlib.gzipSync(so));
      if (se.trim()) fs.writeFileSync(path.join(ctx.runDir, `stderr-${agent.id}.txt`), se);
      resolve({ agent: agent.id, code, wall_ms: wall, stderr_tail: se.slice(-500), ...parseStream(so) });
    });
  });
}

function sumUsage(runs) {
  const u = { input: 0, output: 0, cache_read: 0, cache_write: 0, cost_usd: 0, turns: 0, duration_ms: 0 };
  for (const r of runs) {
    const x = r.result || {};
    const us = x.usage || {};
    u.input += us.input_tokens || 0; u.output += us.output_tokens || 0;
    u.cache_read += us.cache_read_input_tokens || 0; u.cache_write += us.cache_creation_input_tokens || 0;
    u.cost_usd += x.total_cost_usd || 0; u.turns += x.num_turns || 0; u.duration_ms += x.duration_ms || 0;
  }
  u.total_tokens = u.input + u.output + u.cache_read + u.cache_write;
  return u;
}

async function runOne(item) {
  const { scenario, arm, model, seed } = item;
  const scn = SCENARIOS[scenario];
  const key = `${scenario}|${arm}|${model}|${seed}`;
  const runDir = path.join(RUN_ROOT, scenario, arm, model, `s${seed}`);
  fs.rmSync(runDir, { recursive: true, force: true });
  const ctx = {
    key, scenario, arm, model, seed, runDir, r: rng(seed * 1000 + scenario.charCodeAt(1)),
    repo: path.join(runDir, 'repo'), home: path.join(runDir, 'home'), cfgDir: path.join(runDir, 'home', '.claude'),
    env: {}, mcp: { mcpServers: {} }, allowed: [...BASE_TOOLS], extraArgs: [], pluginDirs: [], pathPrepend: [],
    inject: [], claudeMd: [], postRepo: [], postCommit: [], postSetup: [], operator: null,
  };
  fs.mkdirSync(ctx.cfgDir, { recursive: true });
  const t0 = Date.now();
  scn.setup(ctx);
  if (ctx.claudeMd.length) { ctx.claudeMdText = ctx.claudeMd.join('\n\n'); write(path.join(ctx.repo, 'CLAUDE.md'), ctx.claudeMdText); }
  for (const f of ctx.postRepo) f();
  commitAll(ctx, 'initial import');
  for (const f of ctx.postCommit) f();
  for (const f of ctx.postSetup) f();
  if (ctx.injectLater) ctx.injectLater();
  ctx.pluginDirs = [...new Set(ctx.pluginDirs)];
  write(path.join(runDir, 'stub-config.json'), JSON.stringify({ inject: ctx.inject, operator: ctx.operator }, null, 2));
  const setupMs = Date.now() - t0;

  const agents = scn.agents(ctx);
  if (args['setup-only']) { log(`setup ok ${key} in ${setupMs}ms -> ${runDir}`); return { key, ctx, agents }; }
  const runs = await Promise.all(agents.map((a) => runClaude(ctx, a, model, scn)));
  const grade = scn.parallel ? scn.grade(ctx, runs) : scn.grade(ctx, runs[0]);
  const usage = sumUsage(runs);
  const rec = {
    key, scenario, arm, model, seed, ts: new Date().toISOString(), setup_ms: setupMs,
    wall_ms: Math.max(...runs.map((r) => r.wall_ms)), usage,
    agents: runs.map((r) => ({
      agent: r.agent, exit: r.code, subtype: r.result?.subtype ?? null, is_error: r.result?.is_error ?? null,
      model_usage: r.result?.modelUsage ? Object.keys(r.result.modelUsage) : null, tool_calls: r.toolCalls.length,
      tool_errors: r.toolErrors.length, compactions: r.compactions, hook_events: r.hookEvents,
      mcp_servers: r.mcpServers, result_text: (r.resultText || '').slice(0, 600), stderr_tail: r.code ? r.stderr_tail : undefined,
      tool_seq: r.toolCalls.map((c) => c.name === 'Bash' ? `Bash:${String(c.input?.command || '').slice(0, 80)}` : c.name.startsWith('mcp__') ? c.name : `${c.name}:${String(c.input?.file_path || c.input?.skill || c.input?.pattern || '').split('/').slice(-2).join('/')}`),
    })),
    actions: readJsonl(path.join(runDir, 'actions.jsonl')).map(({ cmd, argv, agent }) => ({ cmd, argv, agent })),
    peeked: runs.some((r) => r.toolCalls.some((c) => /stub-config|stub\.mjs|\/pending\/|\.injected-|actions\.jsonl|\/kl\/|docs-src/.test(JSON.stringify(c.input || {})))),
    infra_error: runs.some((r) => !r.result) ? 'no result line (crash/timeout)' : null,
    ...grade,
  };
  appendJsonl(RUNS, rec);
  done.set(key, rec);
  log(`${key} success=${rec.success} wrong=${rec.wrong_action} $${usage.cost_usd.toFixed(4)} ${Math.round(rec.wall_ms / 1000)}s [${invocations}/${CAP}]`);
  return rec;
}

function cellStopped(cell, arm, model) {
  const rs = [...done.values()].filter((r) => r.scenario === cell.scenario && r.arm === arm && r.model === model && !r.infra_error);
  if (rs.length >= (cell.n || 10)) return true;
  const minN = cell.minN ?? cell.n;
  if (rs.length >= minN) {
    const s = new Set(rs.map((r) => `${r.success}/${r.wrong_action}`));
    if (s.size === 1) return true; // unanimous at minN: decisive enough, stop spending
  }
  return false;
}

async function main() {
  const queue = [];
  const model = args.model || PLAN.model || 'haiku';
  const maxSeed = Math.max(...PLAN.cells.map((c) => c.n || 10));
  for (let seed = 1; seed <= maxSeed; seed++) {
    for (const cell of PLAN.cells) {
      if (seed > (cell.n || 10)) continue;
      for (const arm of cell.arms || SCENARIOS[cell.scenario].arms) queue.push({ cell, scenario: cell.scenario, arm, model: cell.model || model, seed: seed + (cell.seedOffset || 0) });
    }
  }
  log(`plan: ${queue.length} items, ${done.size} already done, ledger ${invocations}/${CAP}, concurrency ${CONC}, run-root ${RUN_ROOT}`);
  if (DRY) { for (const q of queue) console.log(q.scenario, q.arm, q.model, q.seed, done.has(`${q.scenario}|${q.arm}|${q.model}|${q.seed}`) ? 'done' : ''); return; }
  let stop = false;
  async function worker() {
    while (!stop && queue.length) {
      const item = queue.shift();
      const key = `${item.scenario}|${item.arm}|${item.model}|${item.seed}`;
      if (done.has(key) && !done.get(key).infra_error) continue;
      if (cellStopped(item.cell, item.arm, item.model)) continue;
      if (args['setup-only']) { try { await runOne(item); } catch (e) { log(`SETUP ERROR ${key}: ${e.stack || e}`); } continue; }
      const need = SCENARIOS[item.scenario].parallel ? 2 : 1;
      if (invocations + need > CAP) { log(`budget cap reached (${invocations}/${CAP}); stopping`); stop = true; break; }
      try { await runOne(item); } catch (e) { log(`ERROR ${key}: ${e.stack || e}`); appendJsonl(path.join(RESULTS, 'errors.jsonl'), { key, ts: new Date().toISOString(), error: String(e.stack || e).slice(0, 2000) }); }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  log(`finished; ledger ${invocations}/${CAP}`);
}
main();
