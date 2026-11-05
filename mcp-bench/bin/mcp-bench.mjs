#!/usr/bin/env node
// mcp-bench: paired agentic task benchmark for MCP servers.
//   mcp-bench validate <task.yaml...>
//   mcp-bench run <task.yaml...> --max-total-usd X [--purpose P] [--arms a,b] [--n N] [--seed 1] [--model m | --models a,b]
//                 [--max-turns N] [--max-budget-usd X] [--out DIR] [--claude-bin PATH] [--dry-run]
//   mcp-bench report <results.json> [--out REPORT.md]
//   mcp-bench cleanup <out-dir>
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { loadTask, resolveArm } from '../lib/spec.mjs';
import { schedule, effective, missingEnv, runTask, balanced, PURPOSE_N } from '../lib/trials.mjs';
import { buildClaudeArgs, interrupt, isInterrupted, replayPendingCleanups } from '../lib/runner.mjs';
import { renderMarkdown } from '../lib/report.mjs';

const USAGE = `usage:
  mcp-bench validate <task.yaml|json...>
  mcp-bench run <task...> --max-total-usd X [--purpose smoke|before-after|publish] [--arms a,b] [--n N] [--seed 1] [--model M | --models A,B]
                [--max-turns N] [--max-budget-usd X] [--out DIR] [--claude-bin PATH] [--dry-run]
  mcp-bench report <results.json> [--out REPORT.md]
  mcp-bench cleanup <out-dir>    re-run cleanups a killed run never ran (run also does this for its --out)`;

const list = (s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined);
const num = (s, name, int = false) => {
  if (s === undefined) return undefined;
  const v = Number(s);
  if (!Number.isFinite(v) || v <= 0 || (int && !Number.isInteger(v))) throw new Error(`--${name}: expected a positive ${int ? 'integer' : 'number'}`);
  return v;
};

// why: parseInt(x) || 1 made --seed 0, "abc" and "1.5" all seed 1; mulberry32 takes seed >>> 0,
// so 2^32 + 1 would also collide with 1.
const seedOf = (s) => {
  if (!/^\d+$/.test(String(s)) || Number(s) > 0xffffffff) throw new Error('--seed: expected an integer 0..4294967295');
  return Number(s);
};

// why: the agent is spawned with cwd = its work dir, so a relative path (./claude, bin/claude) must
// be resolved against the caller's cwd first; a bare name is still looked up on PATH.
const binPath = (b) => (b.includes('/') && !path.isAbsolute(b) ? path.resolve(b) : b);

function loadAll(files) {
  if (!files.length) throw new Error('no task files given');
  const tasks = [], errors = [];
  for (const f of files) { try { tasks.push(loadTask(f)); } catch (e) { errors.push(e.message); } }
  return { tasks, errors };
}

function cmdValidate(files) {
  const { tasks, errors } = loadAll(files);
  for (const t of tasks) {
    console.log(`ok   ${path.relative(process.cwd(), t.file)}  (${t.id}; arms: ${Object.keys(t.arms).join(', ')})`);
    for (const w of t.warnings) console.log(`     warn: ${w}`);
  }
  for (const e of errors) console.log(`FAIL ${e}`);
  return errors.length ? 1 : 0;
}

function claudeVersion(bin) {
  try { return execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 20000 }).trim(); } catch { return null; }
}

function cmdDryRun(tasks, opts) {
  let blocked = 0, attempts = 0, worst = 0;
  const v = claudeVersion(opts.claudeBin);
  console.log(`claude: ${opts.claudeBin} -> ${v || 'NOT RUNNABLE'}`);
  if (!v) blocked++;
  for (const t of tasks) {
    const arms = opts.arms?.length ? opts.arms : Object.keys(t.arms);
    let eff;
    try { for (const a of arms) resolveArm(t, a); eff = effective(t, opts); } catch (e) { console.log(`FAIL ${e.message}`); blocked++; continue; }
    const plan = schedule({ task: t, arms, models: eff.models, n: opts.n, seed: opts.seed });
    attempts += plan.length; worst += plan.length * eff.maxBudgetUsd;
    if (!balanced(opts.n, arms)) console.log(`warn ${t.id}: n=${opts.n} is not a multiple of ${arms.length} arms; the last AB/BA block is unbalanced`);
    for (const m of eff.models) if (!/\d{4,}|-\d+-\d+/.test(m)) console.log(`warn ${t.id}: model "${m}" is an alias; the resolved ID is recorded per attempt, pass a frozen ID for published numbers`);
    const miss = missingEnv(t, arms);
    if (miss.length) { console.log(`BLOCKED ${t.id}: missing env ${miss.join(', ')}`); blocked++; }
    console.log(`\n${t.id}: ${plan.length} attempts (${eff.models.join(', ')} × ${arms.join(', ')} × n=${opts.n}), max_turns ${eff.maxTurns}, max $${eff.maxBudgetUsd}/attempt, timeout ${t.timeout_sec}s`);
    for (const p of plan) console.log(`  ${p.model} t${p.trial}.${p.order} ${p.arm}`);
    for (const a of arms) {
      const cfg = resolveArm(t, a);
      const argv = buildClaudeArgs({ prompt: `<prompt: ${cfg.prompt.length} chars before {{}} rendering>`, armCfg: cfg, model: eff.models[0], maxTurns: eff.maxTurns, maxBudgetUsd: eff.maxBudgetUsd, mcpFile: Object.keys(cfg.mcp_servers).length ? '<run>/mcp.json' : null });
      console.log(`  argv[${a}]: ${argv.map((x) => (/[\s"']/.test(x) || x === '' ? JSON.stringify(x) : x)).join(' ')}`);
      if (Object.keys(cfg.mcp_servers).length) console.log(`  mcp[${a}]: ${Object.keys(cfg.mcp_servers).join(', ')}`);
    }
  }
  console.log(`\ntotal: ${attempts} attempts, worst-case spend $${worst.toFixed(2)}${opts.maxTotalUsd != null ? ` (cap $${opts.maxTotalUsd})` : ' (no --max-total-usd given; run requires one)'}`);
  return blocked ? 3 : 0;
}

async function cmdRun(files, opts) {
  const { tasks, errors } = loadAll(files);
  if (errors.length) { for (const e of errors) console.error(e); return 1; }
  if (opts.purpose === 'publish') {
    for (const t of tasks) if (effective(t, opts).models.some((m) => /haiku/i.test(m))) {
      console.error(`${t.id}: --purpose publish: small models are for smoke runs only, never a published figure`); return 2;
    }
  }
  if (opts.dryRun) return cmdDryRun(tasks, opts);
  if (opts.maxTotalUsd == null) { console.error('run: --max-total-usd is required (use --dry-run to see the worst-case spend)'); return 2; }
  const outDir = path.resolve(opts.out || path.join('results', new Date().toISOString().replace(/[:.]/g, '-')));
  fs.mkdirSync(outDir, { recursive: true });
  const runNonce = crypto.randomBytes(4).toString('hex');
  const res = { generated_at: new Date().toISOString(), purpose: opts.purpose, seed: opts.seed, n: opts.n, run_nonce: runNonce, claude_version: null, max_total_usd: opts.maxTotalUsd, tasks: [] };
  let spent = 0;
  // Children run in their own process groups; forward Ctrl-C / SIGTERM / SIGHUP (terminal or SSH
  // session closed) so the agent stops, cleanup runs and partial results are written. A second
  // signal exits at once.
  const onSignal = (sig) => {
    if (!interrupt(sig)) process.exit(130);
    console.error(`mcp-bench: ${sig}: stopping; running cleanup and writing partial results (send again to exit now)`);
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, onSignal);
  // A reused --out may hold attempts a SIGKILLed run never cleaned up; their run dirs are about to
  // be replaced, so replay their cleanup first.
  const replayed = await replayPendingCleanups(outDir, (s) => console.error(s));
  res.cleanups_replayed = replayed.length;
  res.cleanups_replay_failed = replayed.filter((x) => !x.ok).length;
  for (const t of tasks) {
    const r = await runTask(t, { ...opts, outDir, runNonce, spentUsd: spent, log: (s) => console.error(s) });
    spent = r.spent_usd;
    res.tasks.push(r);
    res.claude_version ||= r.claude_version;
    if (r.stopped || isInterrupted()) break;
  }
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(res, null, 2));
  fs.writeFileSync(path.join(outDir, 'REPORT.md'), renderMarkdown(res));
  console.log(path.join(outDir, 'REPORT.md'));
  return isInterrupted() ? 130 : 0;
}

async function cmdCleanup(dir) {
  if (!dir || !fs.existsSync(dir)) { console.error(`cleanup: no such run directory: ${dir}`); return 2; }
  const r = await replayPendingCleanups(path.resolve(dir), (s) => console.error(s));
  console.log(`${r.length} pending cleanup(s) replayed, ${r.filter((x) => !x.ok).length} failed`);
  return r.every((x) => x.ok) ? 0 : 1;
}

function cmdReport(file, out) {
  const res = JSON.parse(fs.readFileSync(file, 'utf8'));
  const md = renderMarkdown(res);
  if (out) fs.writeFileSync(out, md); else process.stdout.write(md + '\n');
  return 0;
}

async function main(argv) {
  const { values: v, positionals: pos } = parseArgs({
    args: argv, allowPositionals: true,
    options: {
      task: { type: 'string', multiple: true }, arms: { type: 'string' }, n: { type: 'string' }, purpose: { type: 'string' },
      seed: { type: 'string', default: '1' }, model: { type: 'string' }, models: { type: 'string' },
      'max-turns': { type: 'string' }, 'max-budget-usd': { type: 'string' }, 'max-total-usd': { type: 'string' },
      out: { type: 'string' }, 'claude-bin': { type: 'string' }, 'dry-run': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    },
  });
  const [cmd, ...rest] = pos;
  if (v.help || !cmd) { console.log(USAGE); return cmd ? 0 : 2; }
  const files = [...rest, ...(v.task || [])];
  if (cmd === 'validate') return cmdValidate(files);
  if (cmd === 'report') return cmdReport(rest[0], v.out);
  if (cmd === 'cleanup') return cmdCleanup(rest[0]);
  if (cmd === 'run') {
    if (v.purpose && !(v.purpose in PURPOSE_N)) throw new Error(`--purpose: one of ${Object.keys(PURPOSE_N).join(', ')}`);
    const n = num(v.n, 'n', true) ?? PURPOSE_N[v.purpose || 'smoke'];
    if (v.purpose === 'publish') {
      // Council rule: a published number needs 20-30 trials on the model customers run.
      if (n < PURPOSE_N.publish) throw new Error(`--purpose publish needs --n >= ${PURPOSE_N.publish}`);
    }
    return cmdRun(files, {
      purpose: v.purpose || null, arms: list(v.arms), n, seed: seedOf(v.seed),
      model: v.model, models: list(v.models), maxTurns: num(v['max-turns'], 'max-turns', true),
      maxBudgetUsd: num(v['max-budget-usd'], 'max-budget-usd'), maxTotalUsd: num(v['max-total-usd'], 'max-total-usd'),
      out: v.out, claudeBin: binPath(v['claude-bin'] || process.env.MCP_BENCH_CLAUDE || 'claude'), dryRun: !!v['dry-run'],
    });
  }
  console.error(USAGE);
  return 2;
}

main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { console.error(`mcp-bench: ${e.message}`); process.exitCode = 1; });
