// Paired trials: for each model and trial index, every arm runs once against the same start state,
// in a seeded random order (so drift in the sandbox or the API does not favor one arm).
// Attempts run sequentially: the sandbox is shared state.
import fs from 'node:fs';
import path from 'node:path';
import { mulberry32 } from '../../track-a/lib/rng.mjs';
import { resolveArm } from './spec.mjs';
import { runAttempt, isInterrupted } from './runner.mjs';
import { summarizeArm, summarizePairs } from './stats.mjs';

/**
 * Randomized counterbalanced blocks (AB/BA for two arms). A block is k consecutive trials for k arms;
 * its rows are the k cyclic rotations of a random arm permutation (a Latin square: every arm runs in
 * every position once), in random row order. n not divisible by k leaves a partial last block, which
 * is flagged as unbalanced. Each attempt still gets its own setup/cleanup (state reset per trial).
 * nonce (per invocation) is appended to every run tag: the plan stays reproducible from the seed,
 * but a rerun never reuses the tags of a killed run whose resources may still exist.
 */
export function schedule({ task, arms, models, n, seed, nonce = null }) {
  const r = mulberry32(seed);
  const k = arms.length;
  const out = [];
  for (const model of models) {
    let trial = 0;
    for (let block = 0; trial < n; block++) {
      const perm = r.shuffle(arms);
      const rows = r.shuffle(perm.map((_, i) => [...perm.slice(i), ...perm.slice(0, i)]));
      for (const order of rows) {
        if (trial >= n) break;
        order.forEach((arm, i) => out.push({ task: task.id, model, trial, block, arm, order: i, run_tag: `mcpbench-${task.id}-${arm}-t${trial}-${r.hex(6)}${nonce ? `-${nonce}` : ''}` }));
        trial++;
      }
    }
  }
  return out;
}

export const balanced = (n, arms) => arms.length < 2 || n % arms.length === 0;

// Council-settled trial counts: n per arm per model for each purpose.
export const PURPOSE_N = { smoke: 5, 'before-after': 10, publish: 20 };

/** Effective per-run settings after CLI overrides. CLI wins: it is how a smoke test is made cheap. */
export function effective(task, opts) {
  const model = opts.model || task.model;
  if (!model) throw new Error(`task ${task.id}: no model (set model: in the spec or pass --model)`);
  return {
    models: opts.models?.length ? opts.models : [model],
    maxTurns: opts.maxTurns ?? task.max_turns,
    maxBudgetUsd: opts.maxBudgetUsd ?? task.max_budget_usd,
  };
}

export function missingEnv(task, arms = Object.keys(task.arms), env = process.env) {
  const need = new Set(task.requires_env || []);
  for (const a of arms) for (const k of resolveArm(task, a).env_passthrough) need.add(k);
  return [...need].filter((k) => !env[k]);
}

/**
 * Run all paired trials for one task. opts: { arms, n, seed, model, models, maxTurns, maxBudgetUsd,
 * maxTotalUsd, claudeBin, outDir, log }.
 */
export async function runTask(task, opts) {
  const arms = opts.arms?.length ? opts.arms : Object.keys(task.arms);
  for (const a of arms) resolveArm(task, a);
  const miss = missingEnv(task, arms);
  if (miss.length) throw new Error(`task ${task.id}: missing env ${miss.join(', ')}`);
  const eff = effective(task, opts);
  const plan = schedule({ task, arms, models: eff.models, n: opts.n, seed: opts.seed, nonce: opts.runNonce });
  const records = [];
  let spent = opts.spentUsd || 0;
  let spentReported = 0, unpriced = 0, maxCharged = 0;
  let stopped = null;
  const log = opts.log || (() => {});
  const ledger = path.join(opts.outDir, 'attempts.jsonl');
  for (const p of plan) {
    if (isInterrupted()) { stopped = `interrupted (${isInterrupted()})`; break; }
    // Budget gate before each attempt: an attempt can cost up to maxBudgetUsd (more if the CLI
    // overshoots its own cap, so reserve the largest charge seen so far), so stop when the
    // remaining budget can no longer cover one.
    const reserve = Math.max(eff.maxBudgetUsd, maxCharged);
    if (opts.maxTotalUsd != null && spent + reserve > opts.maxTotalUsd + 1e-9) {
      stopped = `budget: spent $${spent.toFixed(4)}, next attempt may cost up to $${reserve} (cap $${opts.maxTotalUsd})`;
      break;
    }
    const rec = await runAttempt({
      task, armCfg: resolveArm(task, p.arm), model: p.model, maxTurns: eff.maxTurns, maxBudgetUsd: eff.maxBudgetUsd,
      claudeBin: opts.claudeBin, outDir: opts.outDir, trial: p.trial, order: p.order, runTag: p.run_tag,
      isolation: opts.isolation || 'dev', sandbox: opts.sandbox || {},
    });
    // why: no result event (crash, timeout, kill) or an invalid cost means the spend is unknown,
    // not zero; charge the reservation it was admitted under (the cap, or more if an earlier
    // attempt overshot it) so the total cap still holds.
    const reported = rec.agent?.cost_usd;
    const ran = rec.agent && !rec.agent.spawn_error;
    rec.cost_charged_usd = !ran ? 0 : reported != null ? reported : reserve;
    if (ran && reported == null) unpriced++;
    spentReported += reported ?? 0;
    spent += rec.cost_charged_usd;
    maxCharged = Math.max(maxCharged, rec.cost_charged_usd);
    records.push(rec);
    fs.appendFileSync(ledger, JSON.stringify({ ...rec, agent: rec.agent && { ...rec.agent, turns: undefined, tool_calls: undefined } }) + '\n');
    if (isInterrupted()) stopped = `interrupted (${isInterrupted()})`;
    if (rec.agent_not_started) stopped = `claude binary not runnable (${opts.claudeBin}): ${rec.setup.error}`;
    log(`${task.id} ${p.model} t${p.trial} ${p.arm}: ${rec.status} tokens=${rec.agent?.usage?.total ?? '-'} turns=${rec.agent?.num_turns ?? '-'} cost=$${(rec.agent?.cost_usd ?? 0).toFixed(4)}`);
    if (stopped) break;
  }
  const perModel = {};
  for (const model of eff.models) {
    const rs = records.filter((r) => r.model === model);
    perModel[model] = {
      arms: Object.fromEntries(arms.map((a) => [a, summarizeArm(rs.filter((r) => r.arm === a))])),
      paired: summarizePairs(rs, arms[0], arms),
    };
  }
  return {
    task: task.id, description: task.description || null, spec_file: task.file, arms, baseline: arms[0],
    n: opts.n, seed: opts.seed, purpose: opts.purpose || null, balanced: balanced(opts.n, arms), max_turns: eff.maxTurns, max_budget_usd_per_attempt: eff.maxBudgetUsd,
    planned_attempts: plan.length, completed_attempts: records.length, stopped, spent_usd: spent,
    spent_usd_reported: spentReported, unpriced_attempts: unpriced,
    claude_version: records.find((r) => r.agent?.init?.version)?.agent.init.version ?? null,
    models: perModel, records,
  };
}
