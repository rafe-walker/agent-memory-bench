// --isolation linux-sandbox: each attempt's agent runs in rafe-walker/agent-sandbox (dedicated
// uid + bwrap + netns cage). The model gateway holds the harness's Anthropic key and is the token
// meter (provider-reported usage); the agent gets a per-attempt session token. Setup, verifier and
// cleanup stay host-side, and <out>/.harness is never bound, so the agent cannot reach the state.
// Only loaded in linux-sandbox mode (dev needs nothing from here).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const ISOLATIONS = ['dev', 'linux-sandbox'];
export const DEV_WARNING = 'WARNING: --isolation dev: the agent runs as your uid with NO sandbox. It can read the harness env, other attempts and <out>/.harness. Never publishable; use --isolation linux-sandbox (rafe-walker/agent-sandbox) for any run whose numbers you publish.';
export const PREFLIGHT_MAX_AGE_MS = 6 * 3600_000;
export const DEFAULT_MAX_TOKENS_PER_ATTEMPT = 20_000_000;
// Harness variables that never enter the sandbox: the gateway holds the model credential and is the
// only route out, so proxies and alternative providers are meaningless inside.
const DROP_IN_SANDBOX = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_BASE_URL',
  'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_REGION', 'AWS_PROFILE', 'ANTHROPIC_VERTEX_PROJECT_ID', 'CLOUD_ML_REGION',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE',
];

const asbx = () => import('agent-sandbox');

/** Public key a preflight must verify against: an explicit file (regular, owned by us or root,
 *  not group/other-writable) or agent-sandbox's root-owned host key dir. */
async function publicKey(file) {
  const a = await asbx();
  if (!file) return a.loadHostPublicKey(a.DEFAULT_KEY_DIR);
  const st = fs.lstatSync(file);
  if (!st.isFile()) throw new Error(`--sandbox-pubkey ${file} is not a regular file`);
  if (st.uid !== 0 && st.uid !== process.geteuid?.()) throw new Error(`--sandbox-pubkey ${file} is owned by uid ${st.uid}`);
  if (st.mode & 0o022) throw new Error(`--sandbox-pubkey ${file} is group/other-writable`);
  if (st.size > 16 * 1024) throw new Error(`--sandbox-pubkey ${file} is too large`);
  return fs.readFileSync(file, 'utf8');
}

/** Verify a signed agent-sandbox preflight (`agent-sandbox preflight --sign --out FILE`). Throws
 *  unless the signature, host/boot and version binding, window and publishability all hold. */
export async function verifySandboxPreflight({ preflight, pubkey, now = Date.now() }) {
  if (!preflight) throw new Error('--isolation linux-sandbox needs --sandbox-preflight FILE (sudo agent-sandbox preflight --sign --out FILE)');
  const a = await asbx();
  const text = fs.readFileSync(preflight, 'utf8');
  const r = a.verifyPreflight(text, await publicKey(pubkey), { now, maxAgeMs: PREFLIGHT_MAX_AGE_MS });
  if (!r.ok) throw new Error(`sandbox preflight rejected: ${r.reason}`);
  return {
    sha256: crypto.createHash('sha256').update(text).digest('hex'),
    key_id: r.keyId, host_id: r.binding.host_id, agent_sandbox_version: r.binding.agent_sandbox_version,
    issued_at: r.binding.issued_at, expires_at: r.binding.expires_at, suite_version: r.report.suite.version,
    capabilities: Object.fromEntries(Object.entries(r.report.capabilities).map(([k, v]) => [k, v?.status ?? 'not-probed'])),
    suite: { result: r.report.suite.result, ran: r.report.suite.ran, blocked: r.report.suite.blocked, not_applicable: r.report.suite.notApplicable },
  };
}

/** Every ancestor of p must be traversable by another uid (bwrap resolves bind sources as the worker). */
export function assertTraversable(p) {
  for (let d = path.resolve(p); ; d = path.dirname(d)) {
    const st = fs.statSync(d);
    if (!(st.mode & 0o001)) throw new Error(`--isolation linux-sandbox: ${d} is not traversable by other users (o+x), so the sandbox uid cannot reach ${p}`);
    if (d === path.dirname(d)) return;
  }
}

/** The agent env inside the sandbox: the dev env minus credentials/proxies, plus the gateway. */
export function sandboxEnv(devEnv, { baseUrl, sessionToken, pathDirs }) {
  const env = { ...devEnv };
  for (const k of DROP_IN_SANDBOX) delete env[k];
  return { ...env, PATH: [...pathDirs, '/usr/bin', '/bin'].join(':'), ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_API_KEY: sessionToken };
}

const realRoot = (bin) => path.dirname(path.dirname(fs.realpathSync(bin)));
function which(bin, PATH) {
  if (bin.includes('/')) return path.resolve(bin);
  for (const d of (PATH || '').split(':')) { const c = path.join(d, bin); if (fs.existsSync(c)) return c; }
  throw new Error(`${bin}: not found on PATH`);
}

/**
 * Run claude (or a stand-in) for one attempt inside agent-sandbox. Same result shape as the dev
 * spawn, plus `gateway_usage`, `survivors` and `sandbox`. sb: { dispatch?, realKey?, maxTokens?,
 * gatewayPort? } (dispatch: a fake model upstream for tests; no paid calls).
 */
export async function runSandboxedAgent({ claudeBin, args, dirs, env, timeoutMs, taskDir, mcpFile, sb = {} }) {
  const a = await asbx();
  const realKey = sb.realKey ?? process.env.ANTHROPIC_API_KEY ?? '';
  if (!sb.dispatch && !realKey) throw new Error('linux-sandbox: the model gateway needs ANTHROPIC_API_KEY in the harness env (it never enters the sandbox)');
  const bin = which(claudeBin, process.env.PATH);
  const binds = [...new Set([realRoot(process.execPath), realRoot(bin)])];
  // why: a read-only bind that contains the out dir would expose <out>/.harness and other attempts.
  for (const b of binds) {
    const out = sb.outDir && path.resolve(sb.outDir);
    if (b === '/' || (out && (out === b || out.startsWith(b + path.sep)))) throw new Error(`linux-sandbox: refusing to bind ${b} (it contains the out dir ${out}); install claude outside it`);
  }
  for (const b of [...binds, ...(taskDir ? [taskDir] : [])]) assertTraversable(b);
  const port = sb.gatewayPort ?? 8953;
  const t0 = Date.now();
  let net, gw, worker;
  try {
    net = await a.setupNetwork({ gatewayPorts: [port] });
    gw = new a.Gateway({
      listenHost: net.hostIp, listenPort: port, realKey: realKey || 'unused-with-dispatch',
      ...(sb.dispatch ? { dispatch: sb.dispatch } : {}),
      ...(!sb.dispatch && process.env.HTTPS_PROXY ? { proxyUrl: process.env.HTTPS_PROXY } : {}),
      ...(!sb.dispatch && process.env.NODE_EXTRA_CA_CERTS ? { caBundlePath: process.env.NODE_EXTRA_CA_CERTS } : {}),
    });
    await gw.start();
    const { attemptId, sessionToken } = gw.registerAttempt({ maxTokens: sb.maxTokens ?? DEFAULT_MAX_TOKENS_PER_ATTEMPT, maxRequests: 2000, maxWallMs: timeoutMs + 60_000 });
    worker = await a.allocateWorker();
    // why: the agent writes only its own work dir and HOME, as its own uid; nothing else of the run is bound.
    for (const d of [dirs.work, dirs.home]) chownR(d, worker.uid, worker.gid);
    const res = await a.launch({
      worker, netns: net.netns, gatewayIp: net.hostIp,
      cwd: dirs.work,
      rwBinds: [{ src: dirs.work, dest: dirs.work }, { src: dirs.home, dest: dirs.home }],
      roBinds: [
        ...binds.map((b) => ({ src: b, dest: b })),
        ...(taskDir ? [{ src: taskDir, dest: taskDir }] : []),
        ...(mcpFile ? [{ src: mcpFile, dest: mcpFile }] : []),
      ],
      env: sandboxEnv(env, { baseUrl: `http://${net.hostIp}:${port}`, sessionToken, pathDirs: binds.map((b) => path.join(b, 'bin')) }),
      command: [bin, ...args],
      wallClockMs: timeoutMs,
      // why: node (claude, undici's WASM HTTP parser) reserves ~10 GiB of address space; 1 GiB AS kills it.
      rlimits: { as: 32 * 1024 ** 3 },
      capture: true,
    });
    const u = gw.usage(attemptId);
    gw.revokeAttempt(attemptId);
    const scrub = (s) => (s || '').split(sessionToken).join('[session-token]');
    return {
      code: res.exitCode, signal: res.signal, stdout: scrub(res.stdout), stderr: scrub(res.stderr), wall_ms: Date.now() - t0,
      timed_out: res.timedOut, spawn_error: null, output_truncated: false, survivors: res.survivors,
      gateway_usage: u && { input: u.inputTokens, cache_read: u.cacheReadTokens, cache_creation: u.cacheCreationTokens, output: u.outputTokens, total: a.totalTokens(u), requests: u.requests, over_budget: u.overBudget },
      sandbox: { attempt: attemptId, worker_uid: worker.uid, netns: net.netns },
    };
  } finally {
    await gw?.stop().catch(() => {});
    if (net) await a.teardownNetwork(net).catch(() => {});
  }
}

function chownR(p, uid, gid) {
  const st = fs.lstatSync(p);
  if (st.isSymbolicLink()) return;
  fs.chownSync(p, uid, gid);
  if (st.isDirectory()) for (const e of fs.readdirSync(p)) chownR(path.join(p, e), uid, gid);
}
