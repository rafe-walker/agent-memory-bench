// Task spec loading and validation. A task is one YAML or JSON file; scripts it names are resolved
// relative to the file's directory. Unknown keys are errors (typos in a benchmark spec silently
// change what is measured).
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const DEFAULTS = { max_turns: 20, max_budget_usd: 0.5, timeout_sec: 600, script_timeout_sec: 120 };

// Fields an arm may override. Everything else (prompt body, verifier, model, limits) is fixed across
// arms so a paired comparison changes one thing: how the agent reaches the server.
const ARM_KEYS = {
  description: 'string', mcp_servers: 'object', allowed_tools: 'string[]', disallowed_tools: 'string[]',
  builtin_tools: 'string[]', env: 'env', env_passthrough: 'string[]', secret_env: 'string[]', plain_env: 'string[]', extra_args: 'string[]',
  append_system_prompt: 'string', prompt_prefix: 'string', prompt_suffix: 'string',
};
const TOP_KEYS = {
  id: 'string', description: 'string', prompt: 'string', model: 'string',
  max_turns: 'int', max_budget_usd: 'number', timeout_sec: 'int', script_timeout_sec: 'int',
  requires_env: 'string[]', setup: 'string', verifier: 'string', cleanup: 'string',
  arms: 'object', tags: 'string[]', ...ARM_KEYS,
};

function typeOk(v, t) {
  switch (t) {
    case 'string': return typeof v === 'string';
    case 'int': return Number.isSafeInteger(v) && v > 0;
    case 'number': return typeof v === 'number' && Number.isFinite(v) && v > 0;
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
    case 'string[]': return Array.isArray(v) && v.every((x) => typeof x === 'string');
    case 'env': return v !== null && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'string');
    default: return false;
  }
}

function checkKeys(obj, allowed, where, errors) {
  for (const [k, v] of Object.entries(obj)) {
    // why: `in` also matches inherited names (toString, constructor, __proto__).
    if (!Object.hasOwn(allowed, k)) { errors.push(`${where}.${k}: unknown key`); continue; }
    if (v === null || v === undefined) continue;
    if (!typeOk(v, allowed[k])) errors.push(`${where}.${k}: expected ${allowed[k]}`);
  }
}

function checkMcp(servers, where, errors) {
  if (!servers) return;
  for (const [name, s] of Object.entries(servers)) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) errors.push(`${where}.mcp_servers.${name}: name must match [A-Za-z0-9_-]+`);
    if (!typeOk(s, 'object')) { errors.push(`${where}.mcp_servers.${name}: expected object`); continue; }
    if (!s.command && !s.url) errors.push(`${where}.mcp_servers.${name}: needs command (stdio) or url (http/sse)`);
    // why: a literal key in a committed spec is a leak; specs must use ${VAR} placeholders.
    const flat = JSON.stringify(s);
    if (/(phx_|phc_|sk-ant-|ghp_|github_pat_)[A-Za-z0-9_]{8,}|\bsk-[A-Za-z0-9_-]{16,}|Bearer (?!\$\{)[A-Za-z0-9._~+/-]{16,}/.test(flat)) errors.push(`${where}.mcp_servers.${name}: looks like a literal secret; use a \${VAR} placeholder`);
  }
}

// Flags the harness sets itself; an arm overriding them would bypass the budget cap, change the
// model mid-comparison, or break isolation.
const RESERVED_FLAGS = ['-p', '--print', '--output-format', '--verbose', '--model', '--fallback-model', '--max-turns', '--max-budget-usd',
  '--permission-mode', '--dangerously-skip-permissions', '--allow-dangerously-skip-permissions', '--no-session-persistence',
  '--strict-mcp-config', '--mcp-config', '--resume', '-r', '--continue', '-c', '--session-id', '--settings', '--setting-sources'];
const RESERVED_ENV = ['HOME', 'CLAUDE_CONFIG_DIR'];
// why: belt and braces for redaction; a name like this is redacted even when plain_env lists it.
export const CREDENTIAL_NAME = /KEY|TOKEN|SECRET|PASSW|CREDENTIAL|AUTH|COOKIE/i;

function checkPlain(obj, where, warnings) {
  for (const k of Array.isArray(obj?.plain_env) ? obj.plain_env : []) {
    if (CREDENTIAL_NAME.test(String(k))) warnings.push(`${where}.plain_env: ${k} looks like a credential and is redacted anyway`);
  }
}

// why: these pick the model (or a subagent's) behind --model's back, so an arm's env would change
// the model mid-comparison.
const MODEL_ENV = /^(ANTHROPIC_MODEL|ANTHROPIC_SMALL_FAST_MODEL|ANTHROPIC_DEFAULT_[A-Z0-9_]+_MODEL|CLAUDE_CODE_SUBAGENT_MODEL)$/;

// why: `-pc` is `-p -c` to the CLI's parser, so a combined short-flag group is checked letter by letter.
const flagsOf = (a) => {
  const f = String(a).split('=')[0];
  return /^-[A-Za-z]{2,}$/.test(f) ? [...f.slice(1)].map((c) => `-${c}`) : [f];
};

function checkReserved(obj, where, errors) {
  if (!obj || typeof obj !== 'object') return;
  for (const a of Array.isArray(obj.extra_args) ? obj.extra_args : []) {
    for (const flag of flagsOf(a)) if (RESERVED_FLAGS.includes(flag)) errors.push(`${where}.extra_args: ${flag} is set by the harness and may not be overridden`);
  }
  if (obj.env && typeof obj.env === 'object') for (const k of Object.keys(obj.env)) {
    if (RESERVED_ENV.includes(k)) errors.push(`${where}.env.${k}: reserved (the harness isolates HOME per attempt)`);
    else if (MODEL_ENV.test(k)) errors.push(`${where}.env.${k}: reserved (selects the model; use --model / model:)`);
  }
  for (const k of Array.isArray(obj.env_passthrough) ? obj.env_passthrough : []) {
    if (MODEL_ENV.test(String(k))) errors.push(`${where}.env_passthrough: ${k} is reserved (selects the model; use --model / model:)`);
  }
}

export function parseSpecText(text, file) {
  return /\.json$/i.test(file) ? JSON.parse(text) : YAML.parse(text);
}

/** Validate a parsed spec. Returns { errors, warnings }. */
export function validateSpec(raw, dir) {
  const errors = [], warnings = [];
  if (!typeOk(raw, 'object')) return { errors: ['spec: expected a mapping'], warnings };
  checkKeys(raw, TOP_KEYS, 'spec', errors);
  if (!raw.id || !/^[a-z0-9][a-z0-9._-]*$/.test(raw.id)) errors.push('spec.id: required, [a-z0-9][a-z0-9._-]*');
  if (!raw.prompt || !String(raw.prompt).trim()) errors.push('spec.prompt: required');
  if (!raw.verifier) errors.push('spec.verifier: required (an independent state check; the agent\'s own claim never counts)');
  checkMcp(raw.mcp_servers, 'spec', errors);
  checkReserved(raw, 'spec', errors);
  checkPlain(raw, 'spec', warnings);
  const arms = raw.arms || { default: {} };
  if (!typeOk(arms, 'object') || !Object.keys(arms).length) errors.push('spec.arms: needs at least one arm');
  else for (const [name, a] of Object.entries(arms)) {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) errors.push(`spec.arms.${name}: name must match [a-z0-9][a-z0-9_-]*`);
    if (!typeOk(a ?? {}, 'object')) { errors.push(`spec.arms.${name}: expected mapping`); continue; }
    checkKeys(a ?? {}, ARM_KEYS, `spec.arms.${name}`, errors);
    checkMcp(a?.mcp_servers, `spec.arms.${name}`, errors);
    checkReserved(a, `spec.arms.${name}`, errors);
    checkPlain(a, `spec.arms.${name}`, warnings);
  }
  for (const k of ['setup', 'verifier', 'cleanup']) {
    const cmd = raw[k];
    if (!cmd || typeof cmd !== 'string') continue;
    // Check the first token if it is a relative script path (./x.py, x.sh) so typos fail in dry-run.
    const first = cmd.trim().split(/\s+/).find((t) => /\.(py|sh|mjs|js|ts)$/.test(t));
    if (first && !path.isAbsolute(first) && !fs.existsSync(path.join(dir, first))) errors.push(`spec.${k}: script not found: ${first}`);
  }
  // why: Node's setTimeout fires after 1 ms for delays above 2^31-1 ms (~24.8 days), so a huge
  // "no timeout" value would kill every attempt at once.
  for (const k of ['timeout_sec', 'script_timeout_sec']) if (Number.isFinite(raw[k]) && raw[k] > 86400) errors.push(`spec.${k}: at most 86400 (24h)`);
  if (!raw.cleanup && raw.setup) warnings.push('spec.cleanup: none; setup state will accumulate in the sandbox');
  if (raw.max_turns && raw.max_turns > 60) warnings.push(`spec.max_turns: ${raw.max_turns} is high for a benchmark task`);
  return { errors, warnings };
}

/** Load and validate one task file. Throws with all errors listed. */
export function loadTask(file) {
  const abs = path.resolve(file);
  const dir = path.dirname(abs);
  let raw;
  try { raw = parseSpecText(fs.readFileSync(abs, 'utf8'), abs); } catch (e) { throw new Error(`${file}: parse error: ${e.message}`); }
  const { errors, warnings } = validateSpec(raw, dir);
  if (errors.length) { const e = new Error(`${file}: invalid task spec\n  - ${errors.join('\n  - ')}`); e.errors = errors; throw e; }
  return { ...DEFAULTS, ...raw, arms: raw.arms || { default: {} }, file: abs, dir, warnings };
}

/** Effective config for one arm: top-level fields with the arm's overrides applied. */
export function resolveArm(task, armName) {
  const a = task.arms[armName];
  if (a === undefined) throw new Error(`task ${task.id}: no arm "${armName}" (have: ${Object.keys(task.arms).join(', ')})`);
  const o = a || {};
  const pick = (k, d) => (o[k] !== undefined ? o[k] : task[k] !== undefined ? task[k] : d);
  return {
    arm: armName,
    prompt: `${o.prompt_prefix || task.prompt_prefix || ''}${task.prompt}${o.prompt_suffix || task.prompt_suffix || ''}`,
    mcp_servers: pick('mcp_servers', {}),
    allowed_tools: pick('allowed_tools', []),
    disallowed_tools: pick('disallowed_tools', []),
    builtin_tools: pick('builtin_tools', null),
    env: { ...(task.env || {}), ...(o.env || {}) },
    env_passthrough: [...new Set([...(task.env_passthrough || []), ...(o.env_passthrough || [])])],
    secret_env: [...new Set([...(task.secret_env || []), ...(o.secret_env || [])])],
    plain_env: [...new Set([...(task.plain_env || []), ...(o.plain_env || [])])],
    extra_args: pick('extra_args', []),
    append_system_prompt: pick('append_system_prompt', null),
  };
}

/** {{name}} substitution from run vars (run_tag, arm, trial, and keys setup wrote to state). */
export function renderTemplate(s, vars) {
  return s.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (m, k) => {
    const v = k.split('.').reduce((o, p) => (o != null && typeof o === 'object' && Object.hasOwn(o, p) ? o[p] : undefined), vars);
    if (v === undefined) throw new Error(`template variable {{${k}}} is not set (setup must write it to $BENCH_STATE)`);
    return typeof v === 'string' ? v : JSON.stringify(v);
  });
}
