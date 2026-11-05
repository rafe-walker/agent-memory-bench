// One attempt = setup -> headless claude -> independent verifier -> cleanup (always), in a fresh
// run dir with an isolated HOME / CLAUDE_CONFIG_DIR and a scrubbed agent environment.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { parseStreamJson } from './stream.mjs';
import { renderTemplate } from './spec.mjs';

// Variables the agent process may inherit from the harness. Auth and proxy only; a task adds its
// own via env_passthrough (e.g. a sandbox key the MCP config references as ${VAR}).
const AGENT_ENV_KEEP = [
  'PATH', 'LANG', 'TERM', 'TZ', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE',
  'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_REGION', 'AWS_PROFILE', 'ANTHROPIC_VERTEX_PROJECT_ID', 'CLOUD_ML_REGION',
];

/** argv for `claude -p`. Pure, so tests and --dry-run show exactly what would run. */
export function buildClaudeArgs({ prompt, armCfg, model, maxTurns, maxBudgetUsd, mcpFile }) {
  const a = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--model', model,
    '--max-turns', String(maxTurns), '--max-budget-usd', String(maxBudgetUsd),
    '--permission-mode', 'dontAsk', '--no-session-persistence', '--strict-mcp-config'];
  if (mcpFile) a.push('--mcp-config', mcpFile);
  if (armCfg.allowed_tools.length) a.push('--allowedTools', armCfg.allowed_tools.join(','));
  if (armCfg.disallowed_tools.length) a.push('--disallowedTools', armCfg.disallowed_tools.join(','));
  if (armCfg.builtin_tools) a.push('--tools', armCfg.builtin_tools.join(','));
  if (armCfg.append_system_prompt) a.push('--append-system-prompt', armCfg.append_system_prompt);
  a.push(...armCfg.extra_args);
  return a;
}

export function agentEnv(armCfg, dirs, harnessEnv = process.env) {
  const env = {};
  for (const k of [...AGENT_ENV_KEEP, ...armCfg.env_passthrough]) if (harnessEnv[k] !== undefined) env[k] = harnessEnv[k];
  Object.assign(env, {
    HOME: dirs.home, CLAUDE_CONFIG_DIR: path.join(dirs.home, '.claude'),
    DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  }, armCfg.env);
  return env;
}

// why: V8 strings top out near 512 MiB; an endless stdout would throw RangeError inside the data
// handler and take the whole runner down (no cleanup, no results). Cap and kill instead.
const MAX_OUTPUT_BYTES = Number(process.env.MCP_BENCH_MAX_OUTPUT_BYTES) > 0 ? Number(process.env.MCP_BENCH_MAX_OUTPUT_BYTES) : 256 * 1024 * 1024;
const STDERR_KEEP = 64 * 1024;

// Live child process groups. Children are detached (own group, so a group kill reaches MCP servers),
// which also means a terminal Ctrl-C never reaches them: the runner must forward it.
const live = new Map(); // pid -> role
let interrupted = null;
export const isInterrupted = () => interrupted;
/** Stop the run: SIGKILL every live agent/setup/verifier group; cleanup scripts keep running. */
export function interrupt(sig) {
  if (interrupted) return false;
  interrupted = sig;
  for (const [pid, role] of live) if (role !== 'cleanup') { try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ } }
  return true;
}

// why: a SIGKILLed runner runs no handler. The reaper holds a pipe from the runner; when the runner
// dies the pipe hits EOF and the reaper kills the agent's process group.
const REAPER = "const g=+process.argv[1];process.stdin.resume();process.stdin.on('end',()=>{try{process.kill(-g,'SIGKILL')}catch{}process.exit(0)});";

function spawnCapture(cmd, args, { cwd, env, timeoutMs, onSpawn, role = 'script', reap = false }) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let so = '', se = '', timedOut = false, done = false, truncated = false, outBytes = 0;
    // why: decoding each chunk separately turns a multi-byte char split across chunks into U+FFFD.
    const dout = new StringDecoder('utf8'), derr = new StringDecoder('utf8');
    let p;
    try { p = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true }); } catch (e) {
      resolve({ code: null, signal: null, stdout: '', stderr: String(e.message), wall_ms: 0, timed_out: false, spawn_error: e.message }); return;
    }
    live.set(p.pid, role);
    if (interrupted && role !== 'cleanup') { try { process.kill(-p.pid, 'SIGKILL'); } catch { /* gone */ } }
    let reaper = null;
    if (reap && p.pid) {
      reaper = spawn(process.execPath, ['-e', REAPER, String(p.pid)], { stdio: ['pipe', 'ignore', 'ignore'], detached: true });
      reaper.on('error', () => {});
      reaper.unref();
    }
    onSpawn?.();
    // why: kill the whole process group; MCP stdio servers are grandchildren and would outlive claude.
    const killGroup = (sig) => { try { process.kill(-p.pid, sig); } catch { /* already gone */ } };
    p.stdout.on('data', (d) => {
      if (truncated) return;
      outBytes += d.length;
      if (outBytes > MAX_OUTPUT_BYTES) { truncated = true; killGroup('SIGKILL'); return; }
      so += dout.write(d);
    });
    p.stderr.on('data', (d) => { se += derr.write(d); if (se.length > 2 * STDERR_KEEP) se = se.slice(-STDERR_KEEP); });
    const to = setTimeout(() => { timedOut = true; killGroup('SIGTERM'); setTimeout(() => killGroup('SIGKILL'), 3000).unref(); }, timeoutMs);
    const finish = (code, signal, err) => {
      if (done) return; done = true; clearTimeout(to);
      live.delete(p.pid);
      if (reaper) { try { reaper.stdin.end(); } catch { /* gone */ } }
      if (!truncated) so += dout.end();
      se += derr.end();
      resolve({ code, signal, stdout: so, stderr: se, wall_ms: Date.now() - t0, timed_out: timedOut, spawn_error: err || null, output_truncated: truncated });
    };
    p.on('error', (e) => finish(null, null, e.message));
    // why: anything still in the agent's group once claude itself exited (background shells, MCP
    // servers that ignore stdin EOF) is an orphan that could keep mutating the sandbox.
    if (reap) p.on('exit', () => killGroup('SIGKILL'));
    p.on('close', (code, signal) => finish(code, signal));
  });
}

/** Run a task script (setup / verifier / cleanup) through bash in the task dir. */
export async function runScript(cmd, ctx, timeoutSec, role = 'script') {
  const env = { ...process.env, ...ctx.scriptEnv };
  return spawnCapture('bash', ['-c', cmd], { cwd: ctx.taskDir, env, timeoutMs: timeoutSec * 1000, role });
}

/** Verifier contract: last stdout line that parses as JSON {pass, details} wins; else exit 0 = pass,
 *  1 = fail; anything else (other codes, timeout) is a verifier error, never a pass. */
export function interpretVerifier(r) {
  const lines = r.stdout.trim().split('\n').reverse();
  for (const l of lines) {
    try {
      const j = JSON.parse(l);
      if (j && typeof j === 'object' && typeof j.pass === 'boolean') {
        if (r.timed_out) break;
        return { status: j.pass ? 'pass' : 'fail', details: j.details ?? null };
      }
    } catch { /* not JSON */ }
  }
  if (r.timed_out) return { status: 'error', details: 'verifier timed out' };
  if (r.code === 0) return { status: 'pass', details: null };
  if (r.code === 1) return { status: 'fail', details: r.stdout.trim().slice(-500) || null };
  return { status: 'error', details: `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}: ${r.stderr.trim().slice(-500)}` };
}

/** Side-effect counters a verifier reports (the verifier SDK emits them); null when not reported. */
export function sideEffects(details) {
  const n = (k) => (details && typeof details === 'object' && Number.isFinite(details[k]) ? details[k] : null);
  return { duplicates: n('duplicates'), unexpected_mutations: n('unexpected_mutations') };
}

function readState(file) {
  try { const s = fs.readFileSync(file, 'utf8').trim(); return s ? JSON.parse(s) : {}; } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error(`setup wrote invalid JSON to $BENCH_STATE: ${e.message}`);
  }
}

/**
 * Run one attempt. Returns a record with status:
 *   verified | unverified | setup_error | verifier_error
 * plus agent metrics. setup_error attempts never reached the agent and are excluded from rates.
 */
export async function runAttempt({ task, armCfg, model, maxTurns, maxBudgetUsd, claudeBin, outDir, trial, order, runTag }) {
  const runDir = path.join(outDir, 'runs', `${task.id}__${model}__${armCfg.arm}__t${trial}`);
  fs.rmSync(runDir, { recursive: true, force: true });
  const dirs = { run: runDir, work: path.join(runDir, 'work'), home: path.join(runDir, 'home') };
  fs.mkdirSync(path.join(dirs.home, '.claude'), { recursive: true });
  fs.mkdirSync(dirs.work, { recursive: true });
  const stateFile = path.join(runDir, 'state.json');
  const ctx = {
    taskDir: task.dir,
    scriptEnv: {
      BENCH_TASK: task.id, BENCH_ARM: armCfg.arm, BENCH_TRIAL: String(trial), BENCH_MODEL: model, BENCH_RUN_TAG: runTag,
      BENCH_RUN_DIR: dirs.run, BENCH_WORKDIR: dirs.work, BENCH_STATE: stateFile,
    },
  };
  const rec = { task: task.id, arm: armCfg.arm, model, trial, order, run_tag: runTag, run_dir: runDir, status: null, setup: null, verifier: null, cleanup: null, agent: null };

  try {
    if (task.setup) {
      const s = await runScript(task.setup, ctx, task.script_timeout_sec);
      rec.setup = { code: s.code, wall_ms: s.wall_ms, timed_out: s.timed_out, stderr_tail: s.stderr.slice(-500) };
      if (interrupted) { rec.status = 'interrupted'; return rec; }
      if (s.code !== 0 || s.timed_out) { rec.status = 'setup_error'; return rec; }
    }
    let prompt;
    try { prompt = renderTemplate(armCfg.prompt, { run_tag: runTag, arm: armCfg.arm, trial, state: readState(stateFile) }); } catch (e) {
      rec.status = 'setup_error'; rec.setup = { ...(rec.setup || {}), error: e.message }; return rec;
    }
    let mcpFile = null;
    if (Object.keys(armCfg.mcp_servers).length) {
      // Written with ${VAR} placeholders intact; claude expands them from the agent env, so no
      // secret value is ever written into the run dir.
      // ${TASK_DIR} (not a secret) is the one placeholder the harness fills, so a task can ship its
      // own stdio server next to the spec.
      mcpFile = path.join(runDir, 'mcp.json');
      fs.writeFileSync(mcpFile, JSON.stringify({ mcpServers: armCfg.mcp_servers }, null, 2).replaceAll('${TASK_DIR}', task.dir));
    }
    const args = buildClaudeArgs({ prompt, armCfg, model, maxTurns, maxBudgetUsd, mcpFile });
    const r = await spawnCapture(claudeBin, args, { cwd: dirs.work, env: agentEnv(armCfg, dirs), timeoutMs: task.timeout_sec * 1000, role: 'agent', reap: true });
    const m = parseStreamJson(r.stdout);
    rec.agent = {
      exit_code: r.code, signal: r.signal, timed_out: r.timed_out, spawn_error: r.spawn_error, wall_ms: r.wall_ms, output_truncated: r.output_truncated,
      stderr_tail: r.stderr.slice(-500), ...m,
    };
    rec.model_id = m.init?.model ?? null;
    // why: the isolated HOME holds claude's config, MCP logs and any session data; the verifier must
    // not be able to read the agent's side of the run through BENCH_RUN_DIR.
    fs.rmSync(dirs.home, { recursive: true, force: true });
    if (interrupted) {
      fs.writeFileSync(path.join(runDir, 'transcript.jsonl.gz'), zlib.gzipSync(r.stdout));
      rec.status = 'interrupted'; return rec;
    }
    // why: verifiers read the sandbox through an independent surface and never the agent's narrative,
    // so nothing the agent said (transcript, final text) is on disk until the verifier has finished.
    const v = await runScript(task.verifier, ctx, task.script_timeout_sec);
    rec.verifier = { ...interpretVerifier(v), wall_ms: v.wall_ms };
    fs.writeFileSync(path.join(runDir, 'transcript.jsonl.gz'), zlib.gzipSync(r.stdout));
    rec.side_effects = sideEffects(rec.verifier.details);
    rec.status = rec.verifier.status === 'pass' ? 'verified' : rec.verifier.status === 'fail' ? 'unverified' : 'verifier_error';
    return rec;
  } finally {
    if (task.cleanup) {
      const c = await runScript(task.cleanup, ctx, task.script_timeout_sec, 'cleanup');
      rec.cleanup = { code: c.code, wall_ms: c.wall_ms, timed_out: c.timed_out, stderr_tail: c.code === 0 ? '' : c.stderr.slice(-500) };
    }
    fs.rmSync(dirs.home, { recursive: true, force: true });
  }
}
