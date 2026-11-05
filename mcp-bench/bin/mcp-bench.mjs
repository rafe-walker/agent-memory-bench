#!/usr/bin/env node
// mcp-bench: paired agentic task benchmark for MCP servers.
//   mcp-bench validate <task.yaml...>
//   mcp-bench run <task.yaml...> --max-total-usd X [--arms a,b] [--n 5] [--seed 1] [--model m | --models a,b]
//                 [--max-turns N] [--max-budget-usd X] [--out DIR] [--claude-bin PATH] [--dry-run]
//   mcp-bench report <results.json> [--out REPORT.md]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { loadTask, resolveArm } from '../lib/spec.mjs';
import { schedule, effective, missingEnv, runTask } from '../lib/trials.mjs';
import { buildClaudeArgs } from '../lib/runner.mjs';
import { renderMarkdown } from '../lib/report.mjs';

const USAGE = `usage:
  mcp-bench validate <task.yaml|json...>
  mcp-bench run <task...> --max-total-usd X [--arms a,b] [--n 5] [--seed 1] [--model M | --models A,B]
                [--max-turns N] [--max-budget-usd X] [--out DIR] [--claude-bin PATH] [--dry-run]
  mcp-bench report <results.json> [--out REPORT.md]`;

const list = (s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined);
const num = (s, name, int = false) => {
  if (s === undefined) return undefined;
  const v = Number(s);
  if (!Number.isFinite(v) || v <= 0 || (int && !Number.isInteger(v))) throw new Error(`--${name}: expected a positive ${int ? 'integer' : 'number'}`);
  return v;
};

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
  if (opts.dryRun) return cmdDryRun(tasks, opts);
  if (opts.maxTotalUsd == null) { console.error('run: --max-total-usd is required (use --dry-run to see the worst-case spend)'); return 2; }
  const outDir = path.resolve(opts.out || path.join('results', new Date().toISOString().replace(/[:.]/g, '-')));
  fs.mkdirSync(outDir, { recursive: true });
  const res = { generated_at: new Date().toISOString(), seed: opts.seed, n: opts.n, claude_version: null, max_total_usd: opts.maxTotalUsd, tasks: [] };
  let spent = 0;
  for (const t of tasks) {
    const r = await runTask(t, { ...opts, outDir, spentUsd: spent, log: (s) => console.error(s) });
    spent = r.spent_usd;
    res.tasks.push(r);
    res.claude_version ||= r.claude_version;
    if (r.stopped) break;
  }
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(res, null, 2));
  fs.writeFileSync(path.join(outDir, 'REPORT.md'), renderMarkdown(res));
  console.log(path.join(outDir, 'REPORT.md'));
  return 0;
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
      task: { type: 'string', multiple: true }, arms: { type: 'string' }, n: { type: 'string', default: '5' },
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
  if (cmd === 'run') {
    return cmdRun(files, {
      arms: list(v.arms), n: num(v.n, 'n', true), seed: Number.parseInt(v.seed, 10) || 1,
      model: v.model, models: list(v.models), maxTurns: num(v['max-turns'], 'max-turns', true),
      maxBudgetUsd: num(v['max-budget-usd'], 'max-budget-usd'), maxTotalUsd: num(v['max-total-usd'], 'max-total-usd'),
      out: v.out, claudeBin: v['claude-bin'] || process.env.MCP_BENCH_CLAUDE || 'claude', dryRun: !!v['dry-run'],
    });
  }
  console.error(USAGE);
  return 2;
}

main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { console.error(`mcp-bench: ${e.message}`); process.exitCode = 1; });
