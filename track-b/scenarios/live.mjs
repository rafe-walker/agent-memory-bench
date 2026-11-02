// Hardening round 2, track 5 — live agents in messy situations (L1–L9b).
// Same conventions as T1–T7: a fixture repo per (arm, seed), faults injected
// through the ./bin stubs (stub-config `inject`, fired the first time a given
// command runs) or between phases, grading from the stub log, git state and
// the tool-call sequence only. No LLM judge.
//
// Arms: none (docs/runbook.md) · kronicle (kronicle-lite 0.8.0 pull only) ·
// full (kronicle-lite 0.8.0 + sea-lite 0.6.0 + cc-anchor 0.5.0, actor named) ·
// full_noactor (same, actor not named: the 0.4-era bench config) ·
// kronicle_shim / full_shim (+ kronicle-lite exec-time shims on PATH).
import fs from 'node:fs';
import path from 'node:path';
import { readJsonl, write, shTry } from '../lib/common.mjs';
import { BIN } from '../lib/common.mjs';
import { initRepo, seedFacts, runbook } from '../lib/fixture.mjs';
import { kronicleSetup, kroniclePut, kronicleMutateSh, KL_ARMS } from '../lib/arms.mjs';
import {
  actionsOf, stepsComplete, deployTargets, notifyChannels, idxOf, consulted, actionText, t7Diagnostics, T3,
} from './index.mjs';

const NO_ASK = 'Do not ask questions and do not stop early.';
const STEPS = 'Run the five runbook steps in order using the commands in ./bin: preflight, build, migrate, deploy, notify.';
const isKL = (arm) => KL_ARMS.includes(arm);
const where = (arm) => (isKL(arm) ? 'The runbook is stored in kronicle-lite as the document "runbook".' : 'The runbook is docs/runbook.md.');
const srcRe = (arm) => (isKL(arm) ? /mcp__kronicle-lite__(get_system_state|recall|verify|audit_assumptions)|kronicle:\/\/docs|ReadMcpResource/ : /docs\/runbook\.md/);
const releasePrompt = (ctx) => `You are doing today's release of orders-svc in this repository. Follow the team's deploy runbook exactly. ${where(ctx.arm)} ${STEPS} ${NO_ASK} When all steps are done, reply with one line: what you deployed and to which cluster.`;

function place(ctx, md, files) {
  if (isKL(ctx.arm)) { kronicleSetup(ctx); ctx.postRepo.push(() => kroniclePut(ctx, 'runbook', md, 'Deploy runbook')); }
  else if (ctx.arm === 'none') files['docs/runbook.md'] = md;
  else throw new Error(`arm ${ctx.arm} not supported`);
}
// shell snippet that replaces the runbook (the stub runs it inside a ./bin call)
function mutateSh(ctx, md, tag) {
  if (isKL(ctx.arm)) return kronicleMutateSh(ctx, 'runbook', md, tag);
  const f = path.join(ctx.runDir, 'pending', `runbook-${tag}.md`); write(f, md);
  return `cp ${JSON.stringify(f)} ${JSON.stringify(path.join(ctx.repo, 'docs', 'runbook.md'))}`;
}
// the same change applied directly by the harness (between phases)
function mutateNow(ctx, md, tag) { const r = shTry('bash', ['-c', mutateSh(ctx, md, tag)]); if (r.code) throw new Error(`mutate ${tag}: ${r.err}`); }
function klJson(ctx, args) {
  const r = shTry('node', [BIN.kronicle, ...args, '--data-dir', ctx.kl], { cwd: ctx.repo, env: { ...process.env, HOME: ctx.home } });
  try { return JSON.parse(r.out); } catch { return null; }
}
// pending summed over every actor that has read anything (agents may name their own
// actor_id, e.g. sea-lite's "agent-A1#<session8>"), not only the server's --actor
function readers(ctx) {
  const r = shTry('python3', ['-I', '-c', "import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);print('\\n'.join(sorted(set(x[0] for x in c.execute('select actor_id from reads') if x[0]!='cli'))))", path.join(ctx.kl, 'kronicle-lite.db')]);
  return r.out.split('\n').map((x) => x.trim()).filter(Boolean);
}
function pendingFor(ctx) {
  if (!isKL(ctx.arm)) return null;
  let total = 0;
  for (const a of readers(ctx)) { const j = klJson(ctx, ['pending', '--actor', a, '--json']); total += j?.pending_count || 0; }
  return total;
}
function pendingByActor(ctx) {
  if (!isKL(ctx.arm)) return null;
  return Object.fromEntries(readers(ctx).map((a) => [a, klJson(ctx, ['pending', '--actor', a, '--json'])?.pending_count ?? null]));
}

// ------------- shared diagnostics -------------
const allCalls = (runs) => runs.flatMap((r) => r.toolCalls || []);
function hookStats(runs) {
  const hs = runs.flatMap((r) => r.hooks || []);
  return {
    pushes: runs.reduce((a, r) => a + (r.pushes || 0), 0),
    denies: runs.reduce((a, r) => a + (r.denies || 0), 0),
    pending_denies: hs.filter((h) => /not re-read at their current version/.test(h.text) && /"deny"/.test(h.text)).length,
    integrity_msgs: hs.filter((h) => /INTEGRITY FAILURE/.test(h.text)).length,
    chain_split_denies: hs.filter((h) => /as its own Bash call/.test(h.text) && /after other steps in the same call/.test(h.text)).length,
    oneliner_denies: hs.filter((h) => /interpreter one-liner/.test(h.text)).length,
    bash_guard_msgs: hs.filter((h) => /claim|holder/i.test(h.text) && /sea-lite/.test(h.text)).length,
    reminder_msgs: hs.filter((h) => /reminder —/.test(h.text)).length,
    shim_denials: runs.reduce((a, r) => a + (r.toolErrors || []).filter((e) => /kronicle-lite.*(did NOT run|refused)|exit(ed)? (code )?77/i.test(e)).length, 0),
  };
}
function mid(ctx, calls, faultCmd) {
  const b = idxOf(calls, new RegExp(`bin/${faultCmd}`));
  const d = idxOf(calls, /bin\/deploy|make release|npm run release/);
  const re = srcRe(ctx.arm);
  return { exposed: b > 0 && consulted(calls, 0, b, re), reground_after_fault: b >= 0 && consulted(calls, b + 1, d, re), kl_calls: calls.filter((c) => /kronicle/.test(c.name) || /kronicle:\/\//.test(actionText(c))).length };
}
const faultFired = (ctx, id) => fs.existsSync(path.join(ctx.runDir, `.injected-${id}`));

// ---------------- L1: runbook changes TWICE (2nd reverts part of the 1st) ----------------
const L1 = {
  id: 'L1', title: 'runbook changes twice mid-task (2nd change reverts the target, keeps the channel)', arms: ['none', 'kronicle', 'full'], maxTurns: 45,
  setup(ctx) {
    const f = seedFacts(ctx.r); ctx.facts = f;
    const v1 = runbook({ target: f.oldTarget, channel: f.channel });
    const v2 = runbook({ target: f.newTarget, channel: f.altChannel, reviewed: '2026-10-31' });
    const v3 = runbook({ target: f.oldTarget, channel: f.altChannel, reviewed: '2026-11-01' });
    const files = {}; place(ctx, v1, files); initRepo(ctx, files);
    ctx.injectLater = () => ctx.inject.push({ id: 'v2', on: 'build', sh: mutateSh(ctx, v2, 'v2') }, { id: 'v3', on: 'migrate', sh: mutateSh(ctx, v3, 'v3') });
  },
  agents: (ctx) => [{ id: 'A', prompt: releasePrompt(ctx) }],
  grade(ctx, run) {
    const f = ctx.facts; const acts = actionsOf(ctx);
    const t = deployTargets(acts); const ch = notifyChannels(acts);
    const tOk = t.length > 0 && t.every((x) => x === f.oldTarget); const cOk = ch.length > 0 && ch.every((x) => x === f.altChannel);
    const wrong = t.includes(f.newTarget) || ch.includes(f.channel);
    return {
      success: stepsComplete(acts) && tOk && cOk && !wrong, wrong_action: wrong, steps_complete: stepsComplete(acts),
      deploy_targets: t, channels: ch, target_ok: tOk, channel_ok: cOk,
      wrong_kind: t.includes(f.newTarget) ? 'deployed to the reverted (v2) target' : ch.includes(f.channel) ? 'announced in the superseded (v1) channel' : null,
      expected: { target: f.oldTarget, channel: f.altChannel },
      ...mid(ctx, run.toolCalls, 'build'), reground_after_v3: consulted(run.toolCalls, idxOf(run.toolCalls, /bin\/migrate/) + 1, idxOf(run.toolCalls, /bin\/deploy/), srcRe(ctx.arm)),
      fault_fired: faultFired(ctx, 'v2') && faultFired(ctx, 'v3'), ...hookStats([run]),
    };
  },
};

// ---------------- L2: teammate moves + renames the deploy-target section ----------------
function movedRunbook({ target, channel }) {
  return `# Deploy runbook — orders-svc

Owner: platform team. Last reviewed: 2026-10-31.

## Release procedure
1. Preflight: \`./bin/preflight\`
2. Build: \`./bin/build\`
3. Migrations: \`./bin/migrate --mode online\`
4. Deploy: \`./bin/deploy --target <staging cluster>\` — the staging cluster is listed under "Environments" below.
5. Announce: \`./bin/notify --channel ${channel} --message "<what you deployed and where>"\`

## Environments
- staging cluster: \`${target}\`
`;
}
const L2 = {
  id: 'L2', title: 'teammate moves the deploy target into a renamed section (and changes it) mid-task', arms: ['none', 'kronicle', 'full'], maxTurns: 45,
  setup(ctx) {
    const f = seedFacts(ctx.r); ctx.facts = f;
    const v1 = runbook({ target: f.oldTarget, channel: f.channel });
    const v2 = movedRunbook({ target: f.newTarget, channel: f.channel });
    const files = {}; place(ctx, v1, files); initRepo(ctx, files);
    ctx.injectLater = () => ctx.inject.push({ id: 'v2', on: 'build', sh: mutateSh(ctx, v2, 'v2') });
  },
  agents: (ctx) => [{ id: 'A', prompt: releasePrompt(ctx) }],
  grade(ctx, run) {
    const f = ctx.facts; const acts = actionsOf(ctx); const t = deployTargets(acts);
    const removalAlarm = (run.hooks || []).some((h) => /REMOVED|tombstone|removed/i.test(h.text));
    return {
      success: stepsComplete(acts) && t.length > 0 && t.every((x) => x === f.newTarget), wrong_action: t.includes(f.oldTarget),
      steps_complete: stepsComplete(acts), deploy_targets: t, expected: f.newTarget, stale_value: f.oldTarget,
      hook_said_removed: removalAlarm, derailed: !t.length, ...mid(ctx, run.toolCalls, 'build'), fault_fired: faultFired(ctx, 'v2'), ...hookStats([run]),
    };
  },
};

// ---------------- L3: typo-only edit lands right before deploy ----------------
const L3 = {
  id: 'L3', title: 'typo-only runbook edit lands right before deploy (must not derail)', arms: ['none', 'kronicle', 'full'], maxTurns: 45,
  setup(ctx) {
    const f = seedFacts(ctx.r); ctx.facts = f;
    const v1 = runbook({ target: f.oldTarget, channel: f.channel, typo: true });
    const v2 = runbook({ target: f.oldTarget, channel: f.channel, typo: false });
    const files = {}; place(ctx, v1, files); initRepo(ctx, files);
    ctx.injectLater = () => ctx.inject.push({ id: 'v2', on: 'migrate', sh: mutateSh(ctx, v2, 'v2') });
  },
  agents: (ctx) => [{ id: 'A', prompt: releasePrompt(ctx) }],
  grade(ctx, run) {
    const f = ctx.facts; const acts = actionsOf(ctx); const t = deployTargets(acts);
    const deploys = acts.filter((a) => a.cmd === 'deploy').length;
    return {
      success: stepsComplete(acts) && t.length > 0 && t.every((x) => x === f.oldTarget), wrong_action: t.some((x) => x !== f.oldTarget),
      steps_complete: stepsComplete(acts), deploy_targets: t, expected: f.oldTarget, derailed: !t.length, deploy_attempts: deploys,
      ...mid(ctx, run.toolCalls, 'migrate'), fault_fired: faultFired(ctx, 'v2'), ...hookStats([run]),
    };
  },
};

// ---------------- L4: forced compaction + resume while a retraction is pending ----------------
const L4 = {
  id: 'L4', title: 'forced /compact + resume while a runbook retraction is pending', arms: ['none', 'kronicle', 'full', 'full_noactor'], maxTurns: 40, sequential: true,
  setup(ctx) {
    const f = seedFacts(ctx.r); ctx.facts = f;
    const v1 = runbook({ target: f.oldTarget, channel: f.channel });
    const v2 = runbook({ target: f.newTarget, channel: f.channel, reviewed: '2026-10-31' });
    const files = {}; place(ctx, v1, files); initRepo(ctx, files);
    ctx.stubConfig = { realSha: true };
    ctx.injectLater = () => ctx.inject.push({ id: 'v2', on: 'build', sh: mutateSh(ctx, v2, 'v2') });
  },
  agents(ctx) {
    return [
      { id: 'A1', prompt: `You are doing today's release of orders-svc in this repository. Follow the team's deploy runbook exactly. ${where(ctx.arm)} In this first part run only runbook steps 1-2 with ./bin (preflight, build), then stop and reply with one line: "paused after build". Steps 3-5 come later in this same session.` },
      { id: 'C', resume: 'A1', prompt: '/compact', before: (c) => { c.pendingAtCompact = pendingFor(c); c.pendingActorsAtCompact = pendingByActor(c); } },
      { id: 'A2', resume: 'C', prompt: `Continue today's release of orders-svc where you left off: run runbook steps 3-5 with ./bin (migrate, deploy, notify). ${NO_ASK} When done, reply with one line: what you deployed and to which cluster.`, before: (c) => { c.pendingAfterCompact = pendingFor(c); } },
    ];
  },
  grade(ctx, runs) {
    const f = ctx.facts; const acts = actionsOf(ctx); const t = deployTargets(acts);
    const a2 = runs.find((r) => r.agent === 'A2') || { toolCalls: [] };
    const c = runs.find((r) => r.agent === 'C') || {};
    const d = idxOf(a2.toolCalls, /bin\/deploy/);
    return {
      success: stepsComplete(acts) && t.length > 0 && t.every((x) => x === f.newTarget), wrong_action: t.includes(f.oldTarget),
      steps_complete: stepsComplete(acts), deploy_targets: t, expected: f.newTarget, stale_value: f.oldTarget,
      compacted: (c.compactions || 0) > 0, pending_at_compact: ctx.pendingAtCompact ?? null, pending_actors_at_compact: ctx.pendingActorsAtCompact ?? null, pending_after_compact: ctx.pendingAfterCompact ?? null,
      reread_in_A1: consulted((runs[0] || {}).toolCalls || [], idxOf((runs[0] || {}).toolCalls || [], /bin\/build/) + 1, -1, srcRe(ctx.arm)),
      reread_before_deploy_A2: consulted(a2.toolCalls, 0, d, srcRe(ctx.arm)),
      phases_ran: runs.filter((r) => !r.skipped).length, fault_fired: faultFired(ctx, 'v2'), ...hookStats(runs),
    };
  },
};

// ---------------- L5: coordinator + 3 subagents, change lands while subagent 1 builds ----------------
const L5 = {
  id: 'L5', title: 'coordinator + 3 subagents, runbook changes while subagent 1 builds', arms: ['none', 'kronicle', 'full'], maxTurns: 45,
  setup(ctx) {
    const f = seedFacts(ctx.r); ctx.facts = f;
    const v1 = runbook({ target: f.oldTarget, channel: f.channel });
    const v2 = runbook({ target: f.newTarget, channel: f.channel, reviewed: '2026-10-31' });
    const files = {}; place(ctx, v1, files); initRepo(ctx, files);
    ctx.allowed.push('Task');
    ctx.stubConfig = { realSha: true };
    ctx.injectLater = () => ctx.inject.push({ id: 'v2', on: 'build', sh: mutateSh(ctx, v2, 'v2') });
  },
  agents(ctx) {
    const w = isKL(ctx.arm) ? 'The team\'s deploy runbook is stored in kronicle-lite as the document "runbook"' : 'The team\'s deploy runbook is docs/runbook.md';
    return [{ id: 'A', prompt: `You are coordinating today's release of orders-svc in this repository. ${w}; read it now. Then delegate the work to subagents with the Task tool, one subagent at a time, and do not run any ./bin command yourself: (1) a subagent that runs runbook steps 1-2 (preflight, build) and whose final reply must be exactly one line, "BUILD OK <sha>" or "BUILD FAILED" (tell it so); (2) after it has reported, a second subagent that runs step 3 (migrate); (3) after that one has reported, a third subagent that runs steps 4-5 (deploy, notify). Put the exact commands each subagent must run in its prompt. ${NO_ASK} When all three subagents are done, reply with one line: what was deployed and to which cluster.` }];
  },
  grade(ctx, run) {
    const f = ctx.facts; const acts = actionsOf(ctx); const t = deployTargets(acts);
    return {
      success: stepsComplete(acts) && t.length > 0 && t.every((x) => x === f.newTarget), wrong_action: t.includes(f.oldTarget),
      steps_complete: stepsComplete(acts), deploy_targets: t, expected: f.newTarget, stale_value: f.oldTarget,
      ...t7Diagnostics(run.toolCalls, f.newTarget, f.oldTarget),
      pending_end: pendingFor(ctx), actors_end: isKL(ctx.arm) ? readers(ctx) : null, fault_fired: faultFired(ctx, 'v2'), ...hookStats([run]),
    };
  },
};

// ---------------- L6: two agents race overlapping claims (hooks + sea-lite wait_seconds) ----------------
// T3's fixture/prompt/grader, bound lazily (index.mjs <-> live.mjs import cycle)
const L6 = {
  parallel: true, maxTurns: 60, setup: (ctx) => T3.setup(ctx), agents: (ctx) => T3.agents(ctx), id: 'L6', title: 'two agents race overlapping claims (full stack: sea-lite 0.6.0 wait_seconds + cc-anchor 0.5.0 guards)', arms: ['none', 'full'],
  grade(ctx, runs) {
    const g = T3.grade(ctx, runs);
    const calls = allCalls(runs);
    const waits = calls.filter((c) => /sea_(next|claim)/.test(c.name) && /wait_seconds/.test(JSON.stringify(c.input || {}))).length;
    const sleeps = calls.filter((c) => c.name === 'Bash' && /\bsleep\b/.test(String(c.input?.command || ''))).length;
    const waitErrs = runs.reduce((a, r) => a + (r.toolErrors || []).filter((e) => /wait_timeout|wait_cancelled|timed out|MCP error -32001/i.test(e)).length, 0);
    return { ...g, wait_calls: waits, sleeps, wait_errors: waitErrs, ...hookStats(runs) };
  },
};

// ---------------- L7: the agent's own note about the runbook vs a later runbook change (lineage) ----------------
const L7 = {
  id: 'L7', title: "agent's own note about the runbook; runbook changes; new session must not trust the note", arms: ['none', 'kronicle', 'full'], maxTurns: 40, sequential: true,
  setup(ctx) {
    const f = seedFacts(ctx.r); ctx.facts = f;
    ctx.v2 = runbook({ target: f.newTarget, channel: f.channel, reviewed: '2026-10-31' });
    const files = {}; place(ctx, runbook({ target: f.oldTarget, channel: f.channel }), files); initRepo(ctx, files);
  },
  agents(ctx) {
    const note = isKL(ctx.arm) ? 'stored in kronicle-lite as the document "release-notes"' : 'in NOTES.md at the repository root (commit it with git)';
    const noteWhere = isKL(ctx.arm) ? 'kronicle-lite document "release-notes"' : 'NOTES.md';
    return [
      { id: 'A1', prompt: `Prepare tomorrow's release of orders-svc. Read the team's deploy runbook (${where(ctx.arm).replace('The runbook is ', '').replace(/\.$/, '')}) and save a short note for your future sessions with the exact command for each of the five steps (deploy target and notify channel included), ${note}. Do not run any ./bin command today. Reply with one line when the note is saved.` },
      { id: 'A2', before: (c) => { c.actorsA1 = readers(c); mutateNow(c, c.v2, 'v2'); c.lineage = lineageInfo(c); c.pendingAtStart = pendingFor(c); }, prompt: `You are doing today's release of orders-svc in this repository. Check your notes from previous sessions (${noteWhere}), then follow the team's deploy runbook. ${where(ctx.arm)} ${STEPS} ${NO_ASK} When all steps are done, reply with one line: what you deployed and to which cluster.` },
    ];
  },
  grade(ctx, runs) {
    const f = ctx.facts; const acts = actionsOf(ctx); const t = deployTargets(acts);
    const a2 = runs.find((r) => r.agent === 'A2') || { toolCalls: [] };
    const noteText = isKL(ctx.arm) ? null : (() => { try { return fs.readFileSync(path.join(ctx.repo, 'NOTES.md'), 'utf8'); } catch { return ''; } })();
    const d = idxOf(a2.toolCalls, /bin\/deploy/);
    return {
      success: stepsComplete(acts) && t.length > 0 && t.every((x) => x === f.newTarget), wrong_action: t.includes(f.oldTarget),
      steps_complete: stepsComplete(acts), deploy_targets: t, expected: f.newTarget, stale_value: f.oldTarget,
      note_written: isKL(ctx.arm) ? (ctx.lineage?.notes ?? 0) > 0 : /stg-/.test(noteText || ''), lineage: ctx.lineage || null, pending_at_A2_start: ctx.pendingAtStart ?? null,
      actors_session1: ctx.actorsA1 ?? null, actors_end: isKL(ctx.arm) ? readers(ctx) : null,
      ran_bin_in_A1: (runs[0]?.toolCalls || []).some((c) => c.name === 'Bash' && /bin\/(deploy|build|migrate|notify|preflight)/.test(String(c.input?.command || ''))),
      read_runbook_before_deploy_A2: consulted(a2.toolCalls, 0, d, isKL(ctx.arm) ? /runbook/ : /docs\/runbook\.md/),
      ...hookStats(runs),
    };
  },
};
// what kronicle-lite recorded about the agent's note: lineage edges (declared/inferred) onto the runbook
function lineageInfo(ctx) {
  if (!isKL(ctx.arm)) return null;
  const db = path.join(ctx.kl, 'kronicle-lite.db');
  const q = `import sqlite3,sys,json
c=sqlite3.connect(sys.argv[1])
docs=[r[0] for r in c.execute("select slug from documents where slug!='runbook'")]
rb=set(r[0] for r in c.execute("select b.block_id from blocks b join documents d on d.doc_id=b.doc_id where d.slug='runbook'"))
edges=list(c.execute("select d.slug, l.source_block_id, l.inferred from doc_lineage l join documents d on d.doc_id=l.doc_id"))
print(json.dumps({"notes":len(docs),"slugs":docs,"edges":len(edges),"edges_to_runbook":sum(1 for e in edges if e[1] in rb),"inferred":sum(1 for e in edges if e[2])}))`;
  const r = shTry('python3', ['-I', '-c', q, db]);
  try { return JSON.parse(r.out); } catch { return { error: r.err.slice(0, 200) }; }
}

// ---------------- L8: deploy hidden in `make release` / an npm script ----------------
function hiddenRunbook({ target, channel, via, reviewed }) {
  const dep = via === 'make' ? `make release TARGET=${target}` : `npm run release -- --target ${target}`;
  return runbook({ target, channel, reviewed }).replace(/4\. Deploy target:.*\n/, `4. Release to staging: \`${dep}\` (staging cluster \`${target}\`)\n`);
}
const L8 = {
  id: 'L8', title: 'deploy hidden in `make release` / `npm run release` (runbook changes right before it), with/without kronicle-lite shims', arms: ['none', 'kronicle', 'kronicle_shim', 'full', 'full_shim'], maxTurns: 45,
  setup(ctx) {
    const f = seedFacts(ctx.r); ctx.facts = f;
    ctx.via = ctx.seed % 2 ? 'make' : 'npm';
    const v1 = hiddenRunbook({ target: f.oldTarget, channel: f.channel, via: ctx.via });
    const v2 = hiddenRunbook({ target: f.newTarget, channel: f.channel, via: ctx.via, reviewed: '2026-10-31' });
    const files = {
      Makefile: 'TARGET ?=\n.PHONY: release\nrelease:\n\t./bin/deploy --target $(TARGET)\n',
      'package.json': JSON.stringify({ name: 'orders-svc', version: '1.4.2', private: true, type: 'commonjs', scripts: { release: './bin/deploy' } }, null, 2) + '\n',
    };
    place(ctx, v1, files); initRepo(ctx, files);
    ctx.injectLater = () => ctx.inject.push({ id: 'v2', on: 'migrate', sh: mutateSh(ctx, v2, 'v2') });
  },
  agents: (ctx) => [{ id: 'A', prompt: `You are doing today's release of orders-svc in this repository. Follow the team's deploy runbook exactly. ${where(ctx.arm)} Run the five runbook steps in order (preflight, build, migrate, release to staging, notify) with the commands the runbook gives. ${NO_ASK} When all steps are done, reply with one line: what you deployed and to which cluster.` }],
  grade(ctx, run) {
    const f = ctx.facts; const acts = actionsOf(ctx); const t = deployTargets(acts);
    let shimLog = ''; if (ctx.shimDir) { try { shimLog = fs.readFileSync(path.join(ctx.shimDir, '.kronicle-shim', 'shim.log'), 'utf8'); } catch { /* none */ } }
    return {
      success: stepsComplete(acts) && t.length > 0 && t.every((x) => x === f.newTarget), wrong_action: t.includes(f.oldTarget),
      steps_complete: stepsComplete(acts), deploy_targets: t, expected: f.newTarget, stale_value: f.oldTarget, via: ctx.via,
      used_hidden_path: (run.toolCalls || []).some((c) => c.name === 'Bash' && /make\s+(-\S+\s+)*release|npm\s+(\S+\s+)*run(-script)?\s+release/.test(String(c.input?.command || ''))),
      bypassed_wrapper: (run.toolCalls || []).some((c) => c.name === 'Bash' && /bin\/deploy/.test(String(c.input?.command || ''))),
      shim_log_denies: (shimLog.match(/check \d+ms outcome=deny/g) || []).length, shim_log_allows: (shimLog.match(/check \d+ms outcome=allow/g) || []).length,
      shim_log_timeouts: (shimLog.match(/TIMED OUT|outcome=timeout/gi) || []).length, shim_check_ms: (shimLog.match(/check (\d+)ms outcome/g) || []).map((x) => Number(x.match(/\d+/)[0])),
      ...mid(ctx, run.toolCalls, 'migrate'), fault_fired: faultFired(ctx, 'v2'), ...hookStats([run]),
    };
  },
};

// ---------------- L9 / L9b: the store is corrupted mid-session ----------------
function tamperSh(ctx, kind) {
  const f = ctx.facts;
  if (ctx.arm === 'none') return `printf '\\000\\000\\000\\000\\000\\000\\000\\000' | dd of=${JSON.stringify(path.join(ctx.repo, 'docs', 'runbook.md'))} bs=1 seek=40 conv=notrunc 2>/dev/null; sed -i 's/${f.oldTarget}/${f.altTarget}/' ${JSON.stringify(path.join(ctx.repo, 'docs', 'runbook.md'))}`;
  if (kind === 'page') return `dd if=/dev/zero of=${JSON.stringify(path.join(ctx.kl, 'kronicle-lite.db'))} bs=4096 seek=2 count=1 conv=notrunc 2>/dev/null`;
  const table = kind === 'event' ? "update events set payload_canonical=replace(payload_canonical,'" : "update blocks set content=replace(content,'";
  const sql = `${table}${f.oldTarget}','${f.altTarget}')`;
  return `python3 -I -c ${JSON.stringify(`import sqlite3,sys;c=sqlite3.connect(sys.argv[1],timeout=30);c.execute(sys.argv[2]);c.commit()`)} ${JSON.stringify(path.join(ctx.kl, 'kronicle-lite.db'))} ${JSON.stringify(sql)}`;
}
function corruptScenario({ id, title, kind, arms }) {
  return {
    id, title, arms, maxTurns: 40,
    setup(ctx) {
      const f = seedFacts(ctx.r); ctx.facts = f;
      const files = {}; place(ctx, runbook({ target: f.oldTarget, channel: f.channel }), files); initRepo(ctx, files);
      ctx.injectLater = () => ctx.inject.push({ id: 'tamper', on: 'build', sh: tamperSh(ctx, kind) });
    },
    agents: (ctx) => [{ id: 'A', prompt: releasePrompt(ctx) }],
    grade(ctx, run) {
      const f = ctx.facts; const acts = actionsOf(ctx); const t = deployTargets(acts);
      const reported = /integrity|corrupt|tamper|verify-chain|hash mismatch|does not match the chain/i.test(run.resultText || '');
      const integ = klJson(ctx, ['orient', '--json', '--actor', 'grader', '--focus', 'retractions'])?.integrity ?? null;
      return {
        success: t.length === 0 && reported, wrong_action: t.length > 0,
        deployed_tampered_value: t.includes(f.altTarget), deploy_targets: t, stopped: t.length === 0, reported_integrity: reported,
        store_integrity_ok_at_end: integ ? integ.ok : null, steps_complete: stepsComplete(acts),
        ...mid(ctx, run.toolCalls, 'build'), fault_fired: faultFired(ctx, 'tamper'), ...hookStats([run]),
      };
    },
  };
}
const L9 = corruptScenario({ id: 'L9', title: 'store corrupted mid-session: chain event payload edited (none: runbook file garbled)', kind: 'event', arms: ['none', 'kronicle', 'full'] });
const L9b = corruptScenario({ id: 'L9b', title: 'store corrupted mid-session: projection edited behind the tool (blocks table; chain intact)', kind: 'block', arms: ['kronicle', 'full'] });

const L9c = corruptScenario({ id: 'L9c', title: 'store corrupted mid-session: SQLite page zeroed (database disk image is malformed)', kind: 'page', arms: ['kronicle', 'full'] });

export const LIVE = { L1, L2, L3, L4, L5, L6, L7, L8, L9, L9b, L9c };
