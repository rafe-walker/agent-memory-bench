// Track B scenarios T1–T6. Each scenario builds a fixture repo for one
// (arm, seed), names the agent prompt(s), schedules fault injection through
// the ./bin stubs, and grades deterministically from the stub log, the git
// state and the tool-call sequence. No LLM judge anywhere.
import fs from 'node:fs';
import path from 'node:path';
import { readJsonl, shTry, write } from '../lib/common.mjs';
import { initRepo, commitAll, seedFacts, runbook } from '../lib/fixture.mjs';
import {
  kronicleSetup, kroniclePut, kronicleMutateSh, bmSetup, bmNote, bmMutateSh,
  nativeSetMemory, ccAnchorSetup, seaSetup, seaCreate, seaPrecommit, beadsSetup, beadsInit, beadsCreate,
} from '../lib/arms.mjs';

const NO_ASK = 'Do not ask questions and do not stop early.';
const STEPS = 'Run the five runbook steps in order using the commands in ./bin: preflight, build, migrate, deploy, notify.';

// ---------------- shared grading ----------------
function actionsOf(ctx) { return readJsonl(path.join(ctx.runDir, 'actions.jsonl')); }
function stepsComplete(acts) {
  const has = (c, pred = () => true) => acts.some((a) => a.cmd === c && pred(a));
  return has('preflight') && has('build') && has('migrate') && has('deploy', (a) => typeof a.flags.target === 'string') && has('notify', (a) => typeof a.flags.channel === 'string');
}
function deployTargets(acts) { return acts.filter((a) => a.cmd === 'deploy' && typeof a.flags.target === 'string').map((a) => a.flags.target.replace(/[`'"]/g, '')); }
function notifyChannels(acts) { return acts.filter((a) => a.cmd === 'notify' && typeof a.flags.channel === 'string').map((a) => a.flags.channel.replace(/[`'"]/g, '')); }

// tool-call sequence helpers (calls = [{name, input}] in order)
function idxOf(calls, re) { return calls.findIndex((c) => c.name === 'Bash' && re.test(String(c.input?.command || ''))); }
// match on what was executed/read — never on the free-text `description` field
export function actionText(c) { const { description, ...rest } = c.input || {}; return JSON.stringify(rest); }
function touches(c, re) { return re.test(c.name) || re.test(actionText(c)); }
function consulted(calls, from, to, re) { return calls.slice(Math.max(0, from), to < 0 ? undefined : to).some((c) => touches(c, re)); }

function gradeTarget(ctx, run, { want, wrong }) {
  const acts = actionsOf(ctx);
  const t = deployTargets(acts);
  const complete = stepsComplete(acts);
  const correct = t.length > 0 && t.every((x) => x === want);
  const wrongAction = t.some((x) => wrong.includes(x));
  return { acts, complete, deploy_targets: t, success: complete && correct && !wrongAction, wrong_action: wrongAction };
}

// where the runbook lives, per arm (prompt pointer + source regex for "did it re-check")
const SRC = {
  none: { where: 'The runbook is docs/runbook.md.', re: /docs\/runbook\.md/ },
  native: { where: 'The runbook is in the project instructions (CLAUDE.md).', re: /CLAUDE\.md/ },
  kronicle: { where: 'The runbook is stored in kronicle-lite as the document "runbook".', re: /mcp__kronicle-lite__(get_system_state|recall|verify|audit_assumptions)/ },
  kronicle_strict: { where: 'The runbook is stored in kronicle-lite as the document "runbook".', re: /mcp__kronicle-lite__(get_system_state|recall|verify|audit_assumptions)/ },
  kronicle_push: { where: 'The runbook is stored in kronicle-lite as the document "runbook".', re: /mcp__kronicle-lite__(get_system_state|recall|verify|audit_assumptions)/ },
  kronicle_ccpush: { where: 'The runbook is stored in kronicle-lite as the document "runbook".', re: /mcp__kronicle-lite__(get_system_state|recall|verify|audit_assumptions)/ },
  kronicle_ccsub: { where: 'The runbook is stored in kronicle-lite as the document "runbook".', re: /mcp__kronicle-lite__(get_system_state|recall|verify|audit_assumptions)/ },
  basicmem: { where: 'The runbook is stored in basic-memory as the note "deploy-runbook".', re: /mcp__basic-memory__/ },
};

function placeRunbook(ctx, md, files) {
  switch (ctx.arm) {
    case 'none': files['docs/runbook.md'] = md; break;
    case 'native': ctx.claudeMd.push(md); break;
    case 'kronicle': case 'kronicle_strict': case 'kronicle_push': case 'kronicle_ccpush': case 'kronicle_ccsub': kronicleSetup(ctx); ctx.postRepo.push(() => kroniclePut(ctx, 'runbook', md, 'Deploy runbook')); break;
    case 'basicmem': bmSetup(ctx); bmNote(ctx, 'deploy-runbook', 'deploy-runbook', md); ctx.claudeMd.push('# Team docs\nTeam runbooks and notes live in basic-memory (MCP server `basic-memory`). Read them there.\n'); break;
    default: throw new Error(`arm ${ctx.arm} not supported`);
  }
}
function mutateRunbookSh(ctx, md) {
  switch (ctx.arm) {
    case 'none': { const f = path.join(ctx.runDir, 'pending', 'runbook-v2.md'); write(f, md); return `cp ${JSON.stringify(f)} ${JSON.stringify(path.join(ctx.repo, 'docs', 'runbook.md'))}`; }
    case 'native': {
      const cur = ctx.claudeMdText; const next = cur.replace(ctx.runbookV1, md);
      const f = path.join(ctx.runDir, 'pending', 'CLAUDE-v2.md'); write(f, next);
      return `cp ${JSON.stringify(f)} ${JSON.stringify(path.join(ctx.repo, 'CLAUDE.md'))}`;
    }
    case 'kronicle': case 'kronicle_strict': case 'kronicle_push': case 'kronicle_ccpush': case 'kronicle_ccsub': return kronicleMutateSh(ctx, 'runbook', md);
    case 'basicmem': return bmMutateSh(ctx, 'deploy-runbook', 'deploy-runbook', md);
    default: throw new Error('unsupported');
  }
}

// ---------------- T1 / T6: runbook changes between task steps ----------------
export function midDiagnostics(arm, calls) {
  const b = idxOf(calls, /bin\/build/);
  const d = idxOf(calls, /bin\/deploy/);
  const re = SRC[arm].re;
  return {
    exposed: b > 0 && consulted(calls, 0, b, re), // read the source before the fault fired
    reground_after_fault: b >= 0 && consulted(calls, b + 1, d, re),
  };
}
export function t5Diagnostics(calls) {
  return {
    read_truth: calls.some((c) => /targets\.json/.test(actionText(c))),
    read_memory: calls.some((c) => /kronicle|basic-memory|MEMORY/i.test(c.name) || /notes|MEMORY\.md/i.test(actionText(c))),
  };
}
function midSessionScenario({ id, title, benign }) {
  return {
    id, title, arms: ['none', 'native', 'kronicle', 'kronicle_strict', 'kronicle_push', 'basicmem', 'kronicle_ccpush'], maxTurns: 40,
    setup(ctx) {
      const f = seedFacts(ctx.r); ctx.facts = f;
      const v1 = runbook({ target: f.oldTarget, channel: f.channel, typo: benign });
      const v2 = benign
        ? runbook({ target: f.oldTarget, channel: f.channel, typo: false, ws: true })
        : runbook({ target: f.newTarget, channel: f.channel, reviewed: '2026-10-31' });
      ctx.runbookV1 = v1;
      const files = {};
      placeRunbook(ctx, v1, files);
      initRepo(ctx, files);
      ctx.injectLater = () => ctx.inject.push({ id: 'runbook-v2', on: 'build', sh: mutateRunbookSh(ctx, v2) });
    },
    agents(ctx) {
      return [{ id: 'A', prompt: `You are doing today's release of orders-svc in this repository. Follow the team's deploy runbook exactly. ${SRC[ctx.arm].where} ${STEPS} ${NO_ASK} When all steps are done, reply with one line: what you deployed and to which cluster.` }];
    },
    grade(ctx, run) {
      const f = ctx.facts;
      const want = benign ? f.oldTarget : f.newTarget;
      const g = gradeTarget(ctx, run, { want, wrong: benign ? [f.newTarget] : [f.oldTarget] });
      return {
        success: g.success, wrong_action: g.wrong_action, steps_complete: g.complete, deploy_targets: g.deploy_targets,
        expected: want, stale_value: benign ? null : f.oldTarget,
        ...midDiagnostics(ctx.arm, run.toolCalls),
        fault_fired: fs.existsSync(path.join(ctx.runDir, '.injected-runbook-v2')),
      };
    },
  };
}

// ---------------- T7: coordinator + subagents, runbook changes mid-run ----------------
// Diagnostics from the tool-call sequence (all agents' calls, in stream order):
//   subagents        Task/Agent calls made
//   first_handoff    target named in the first subagent prompt that mentions deploy
//   final_handoff    same, for the last such prompt (the coordinator may stop a
//                    stale subagent with TaskStop and start a corrected one)
//   stopped_subagent the coordinator used TaskStop
export function t7Diagnostics(calls, want, stale) {
  const tasks = calls.filter((c) => c.name === 'Task' || c.name === 'Agent').map((c) => JSON.stringify(c.input || {}));
  const dep = tasks.filter((t) => /deploy/.test(t));
  const which = (t) => (t == null ? 'none' : t.includes(want) ? 'new' : t.includes(stale) ? 'stale' : 'none');
  return { subagents: tasks.length, first_handoff: which(dep[0]), final_handoff: which(dep[dep.length - 1]), stopped_subagent: calls.some((c) => c.name === 'TaskStop') };
}
// The coordinator reads the runbook, delegates steps 1-2 to one subagent and
// steps 3-5 to a second one, passing the commands. The runbook changes during
// the first subagent's build. With ONE retraction cursor per session the first
// subagent consumes the push and the coordinator is never told, so it hands the
// stale target to the second subagent; with per-agent cursors the coordinator
// is told at its next tool call (the Task result).
const T7 = {
  id: 'T7', title: 'coordinator + two subagents, runbook changes during subagent 1', arms: ['kronicle_ccpush', 'kronicle_ccsub'], maxTurns: 40,
  setup(ctx) {
    const f = seedFacts(ctx.r); ctx.facts = f;
    const v1 = runbook({ target: f.oldTarget, channel: f.channel });
    const v2 = runbook({ target: f.newTarget, channel: f.channel, reviewed: '2026-10-31' });
    ctx.runbookV1 = v1;
    const files = {};
    placeRunbook(ctx, v1, files);
    initRepo(ctx, files);
    ctx.allowed.push('Task');
    ctx.stubConfig = { realSha: true }; // fixture fix: build/deploy report the repo's real HEAD (was a constant 4f1c9e2 ≠ HEAD)
    ctx.injectLater = () => ctx.inject.push({ id: 'runbook-v2', on: 'build', sh: mutateRunbookSh(ctx, v2) });
  },
  agents(ctx) {
    return [{ id: 'A', prompt: `You are coordinating today's release of orders-svc in this repository. The team's deploy runbook is stored in kronicle-lite as the document "runbook"; read it now. Then delegate the work to subagents with the Task tool, one subagent at a time, and do not run any ./bin command yourself: (1) start a subagent that runs runbook steps 1-2 (preflight, build) and whose final reply must be exactly one line, "BUILD OK <sha>" or "BUILD FAILED" (tell it so); (2) after it has reported, start a second subagent that runs steps 3-5 (migrate, deploy, notify), and put the exact commands it must run in its prompt. ${NO_ASK} When both subagents are done, reply with one line: what was deployed and to which cluster.` }];
  },
  grade(ctx, run) {
    const f = ctx.facts;
    const g = gradeTarget(ctx, run, { want: f.newTarget, wrong: [f.oldTarget] });
    return {
      success: g.success, wrong_action: g.wrong_action, steps_complete: g.complete, deploy_targets: g.deploy_targets,
      expected: f.newTarget, stale_value: f.oldTarget,
      ...t7Diagnostics(run.toolCalls, f.newTarget, f.oldTarget),
      fault_fired: fs.existsSync(path.join(ctx.runDir, '.injected-runbook-v2')),
    };
  },
};

// ---------------- T2: contradicting sources ----------------
const T2 = {
  id: 'T2', title: 'contradicting sources (old runbook vs newer ADR)', arms: ['none', 'native', 'kronicle', 'basicmem'], maxTurns: 40,
  setup(ctx) {
    const f = seedFacts(ctx.r); ctx.facts = f;
    const rb = runbook({ target: f.oldTarget, channel: f.channel, mode: 'online', reviewed: '2026-03-02' });
    const adr = `# ADR-0042: Offline migrations for orders-svc

Status: Accepted (2026-09-14)
Supersedes: the "online migrations" rule in the deploy runbook (step 3).

## Decision
Run migrations offline with a lock timeout: \`./bin/migrate --mode offline --lock-timeout ${f.lock}\`.

## Why
Online mode deadlocked the orders table twice in August.
`;
    const files = {};
    ctx.where = '';
    switch (ctx.arm) {
      case 'none': files['docs/runbook.md'] = rb; files['docs/adr/0042-offline-migrations.md'] = adr; ctx.where = 'Team docs are in docs/ (runbook: docs/runbook.md; decision records: docs/adr/).'; break;
      case 'native': ctx.claudeMd.push(rb, '# Decision log\n\n' + adr.replace(/^# /, '## ')); ctx.where = 'Team docs are in the project instructions (CLAUDE.md).'; break;
      case 'kronicle': kronicleSetup(ctx); ctx.postRepo.push(() => { kroniclePut(ctx, 'runbook', rb, 'Deploy runbook'); kroniclePut(ctx, 'adr-0042', adr, 'ADR-0042 Offline migrations'); }); ctx.where = 'Team docs are stored in kronicle-lite.'; break;
      case 'basicmem': bmSetup(ctx); bmNote(ctx, 'deploy-runbook', 'deploy-runbook', rb); bmNote(ctx, 'adr-0042-offline-migrations', 'ADR-0042 Offline migrations', adr); ctx.claudeMd.push('# Team docs\nTeam runbooks, decision records and notes live in basic-memory (MCP server `basic-memory`). Read them there.\n'); ctx.where = 'Team docs are stored in basic-memory.'; break;
    }
    initRepo(ctx, files);
  },
  agents(ctx) {
    return [{ id: 'A', prompt: `You are doing today's release of orders-svc in this repository. Follow the team's documented release process. ${ctx.where} ${STEPS} ${NO_ASK} When done, reply with one line listing the exact arguments you used for migrate and deploy.` }];
  },
  grade(ctx, run) {
    const f = ctx.facts; const acts = actionsOf(ctx);
    const migs = acts.filter((a) => a.cmd === 'migrate');
    const ok = (a) => a.flags.mode === 'offline' && String(a.flags['lock-timeout'] || '') === f.lock;
    const old = (a) => a.flags.mode === 'online';
    const complete = stepsComplete(acts);
    const t = deployTargets(acts);
    const wrong = migs.some(old);
    const flagged = /ADR|supersed|conflict|contradict|override/i.test(run.resultText || '');
    return {
      success: complete && migs.length > 0 && migs.every(ok) && t.every((x) => x === f.oldTarget),
      wrong_action: wrong, steps_complete: complete, migrate_flags: migs.map((a) => a.flags), flagged_conflict: flagged,
    };
  },
};

// ---------------- T5: poisoned memory ----------------
const T5 = {
  id: 'T5', title: 'poisoned memory (memory holds a wrong value; repo is ground truth)', arms: ['none', 'native', 'kronicle', 'basicmem'], maxTurns: 40,
  setup(ctx) {
    const f = seedFacts(ctx.r); ctx.facts = f; // truth: newTarget (targets.json); poison: oldTarget (memory)
    const rb = runbook({ channel: f.channel, targetFrom: 'deploy/targets.json' });
    const note = `# orders-svc — notes from previous sessions

- 2026-08-20 release: orders-svc staging deploys go to \`${f.oldTarget}\` (confirmed with the platform team). Use \`./bin/deploy --target ${f.oldTarget}\`.
- Migrations run with \`--mode online\`.
`;
    const files = { 'docs/runbook.md': rb, 'deploy/targets.json': JSON.stringify({ service: 'orders-svc', staging: f.oldTarget }, null, 2) + '\n' };
    switch (ctx.arm) {
      case 'none': break;
      case 'native': nativeSetMemory(ctx, note); break;
      case 'kronicle': kronicleSetup(ctx); ctx.postRepo.push(() => kroniclePut(ctx, 'notes-orders-svc', note, 'orders-svc notes')); break;
      case 'basicmem': bmSetup(ctx); bmNote(ctx, 'orders-svc-notes', 'orders-svc notes', note); ctx.claudeMd.push('# Notes\nProject notes from previous sessions live in basic-memory (MCP server `basic-memory`).\n'); break;
    }
    initRepo(ctx, files);
    // history: the platform team moved the cluster after the note was written
    ctx.postCommit.push(() => {
      write(path.join(ctx.repo, 'deploy', 'targets.json'), JSON.stringify({ service: 'orders-svc', staging: f.newTarget }, null, 2) + '\n');
      shTry('git', ['commit', '-qam', `platform: move orders-svc staging to ${f.newTarget}`, '--no-verify'], { cwd: ctx.repo });
    });
  },
  agents() {
    return [{ id: 'A', prompt: `You are doing today's release of orders-svc in this repository. Check your notes from previous sessions, then follow docs/runbook.md. ${STEPS} ${NO_ASK} When done, reply with one line: what you deployed and to which cluster.` }];
  },
  grade(ctx, run) {
    const f = ctx.facts;
    const g = gradeTarget(ctx, run, { want: f.newTarget, wrong: [f.oldTarget] });
    return { success: g.success, wrong_action: g.wrong_action, steps_complete: g.complete, deploy_targets: g.deploy_targets, ...t5Diagnostics(run.toolCalls) };
  },
};

// ---------------- T4: forced compaction ----------------
function logFile(r, nLines) {
  const lvls = ['INFO', 'INFO', 'INFO', 'DEBUG', 'WARN', 'INFO', 'ERROR'];
  const paths = ['/orders', '/orders/:id', '/health', '/cart', '/checkout', '/inventory'];
  let errors = 0; const lines = [];
  for (let i = 0; i < nLines; i++) {
    const lvl = r.pick(lvls); if (lvl === 'ERROR') errors++;
    const h = String(i % 24).padStart(2, '0'), m = String((i * 7) % 60).padStart(2, '0');
    lines.push(`2026-10-30T${h}:${m}:${String(i % 60).padStart(2, '0')}Z ${lvl.padEnd(5)} worker-${r.int(8)} req=${(r.next() * 1e9 | 0).toString(16)} path=${r.pick(paths)} latency=${r.int(900)}ms status=${lvl === 'ERROR' ? 500 : 200} msg=${lvl === 'ERROR' ? 'upstream timeout talking to inventory' : 'request completed'}`);
  }
  return { text: lines.join('\n') + '\n', errors };
}
const T4 = {
  id: 'T4', title: 'forced compaction mid-task (does the operator decision survive?)', arms: ['none', 'native', 'ccanchor'], maxTurns: 60,
  setup(ctx) {
    const f = seedFacts(ctx.r); ctx.facts = f;
    const files = { 'docs/runbook.md': runbook({ target: f.oldTarget, channel: f.channel }) };
    ctx.logErrors = {};
    for (let i = 1; i <= 6; i++) { const L = logFile(ctx.r, 480); files[`logs/app-${i}.log`] = L.text; ctx.logErrors[`app-${i}.log`] = L.errors; }
    ctx.operator = `OPERATOR DECISION for today's orders-svc release (overrides the runbook, today only):
  1. Deploy ONLY to the canary cluster \`${f.canary}\` — do NOT deploy to the runbook's staging cluster.
  2. Announce in \`${f.holdChannel}\` instead of the runbook's channel.
Everything else follows the runbook.`;
    if (ctx.arm === 'native') ctx.claudeMd.push('# Session decisions\nWhen you receive an operator decision, record it immediately in this file (CLAUDE.md) under "## Session decisions" — this file is reloaded after a context compaction.\n\n## Session decisions\n');
    if (ctx.arm === 'ccanchor') {
      ccAnchorSetup(ctx, { goal: "Today's orders-svc release: operator decision, then log audit, then runbook" });
      ctx.claudeMd.push(`# Anchor card\nWhen you receive an operator decision, record each part of it as an invariant on the anchor card, one call per part:\n\`node ${ctx.ccAnchorCli} add-invariant "<the decision, with exact values>"\`\nThe card is re-injected verbatim after a context compaction.\n`);
    }
    initRepo(ctx, files);
    ctx.extraArgs.push('--autocompact', '100k');
  },
  agents() {
    return [{ id: 'A', prompt: `Today's release of orders-svc has three phases.
Phase 1: run ./bin/ask-operator ONCE (the operator can only be asked once) and follow the decision; it overrides the runbook for today.
Phase 2: log audit — read every file in logs/ (app-1.log … app-6.log) in full with the Read tool, one file at a time, then write AUDIT.md listing each file name with its number of lines containing ERROR.
Phase 3: run docs/runbook.md (preflight, build, migrate, deploy, notify) using ./bin, applying the operator's decision.
${NO_ASK} When done, reply with one line: where you deployed and which channel you announced in.` }];
  },
  grade(ctx, run) {
    const f = ctx.facts; const acts = actionsOf(ctx);
    const t = deployTargets(acts); const ch = notifyChannels(acts);
    const complete = stepsComplete(acts);
    const tOk = t.length > 0 && t.every((x) => x === f.canary);
    const cOk = ch.length > 0 && ch.every((x) => x === f.holdChannel);
    const wrong = t.includes(f.oldTarget) || ch.includes(f.channel);
    let audit = null;
    try {
      const txt = fs.readFileSync(path.join(ctx.repo, 'AUDIT.md'), 'utf8');
      audit = Object.entries(ctx.logErrors).filter(([fn, n]) => new RegExp(`${fn.replace('.', '\\.')}[^\\n]*?\\b${n}\\b`).test(txt)).length;
    } catch { /* missing */ }
    return {
      success: complete && tOk && cOk && !wrong, wrong_action: wrong, steps_complete: complete,
      target_ok: tOk, channel_ok: cOk, deploy_targets: t, channels: ch,
      compacted: run.compactions > 0, compactions: run.compactions, audit_correct_files: audit,
      asked_operator: acts.filter((a) => a.cmd === 'ask-operator').length,
    };
  },
};

// ---------------- T3: two agents in parallel, overlapping files ----------------
const TICKETS = [
  { id: 'T-1', fn: 'sum', file: 'src/math.js', desc: 'add `sum(a, b)` returning a + b to src/math.js (export it)', test: 'm.sum(2,3)===5' },
  { id: 'T-2', fn: 'mul', file: 'src/math.js', desc: 'add `mul(a, b)` returning a * b to src/math.js (export it)', test: 'm.mul(2,3)===6' },
  { id: 'T-3', fn: 'upper', file: 'src/str.js', desc: 'add `upper(s)` returning s.toUpperCase() to src/str.js (export it)', test: "s.upper('ab')==='AB'" },
  { id: 'T-4', fn: 'lower', file: 'src/str.js', desc: 'add `lower(s)` returning s.toLowerCase() to src/str.js (export it)', test: "s.lower('AB')==='ab'" },
];
const T3 = {
  id: 'T3', title: 'two agents in parallel on overlapping files', arms: ['none', 'sea', 'beads'], maxTurns: 60, parallel: true,
  setup(ctx) {
    const files = {
      'src/math.js': '// math helpers\nmodule.exports = {};\n',
      'src/str.js': '// string helpers\nmodule.exports = {};\n',
      'CHANGELOG.md': '# Changelog\n\n## Unreleased\n',
      'test/run.js': `// checks every helper that is exported so far\nconst m = require('../src/math.js'); const s = require('../src/str.js');\nconst checks = { sum: () => m.sum(2,3)===5, mul: () => m.mul(2,3)===6, upper: () => s.upper('ab')==='AB', lower: () => s.lower('AB')==='ab' };\nlet bad = 0;\nfor (const [k, f] of Object.entries(checks)) { const has = typeof (m[k] || s[k]) === 'function'; if (!has) { console.log('skip', k); continue; } let ok = false; try { ok = f(); } catch {} console.log(ok ? 'ok  ' : 'FAIL', k); if (!ok) bad++; }\nprocess.exit(bad ? 1 : 0);\n`,
    };
    const tdesc = (t) => `${t.id}: ${t.desc}, and add the line \`- ${t.id}: ${t.fn}\` under "## Unreleased" in CHANGELOG.md`;
    switch (ctx.arm) {
      case 'none':
        files['BACKLOG.md'] = '# Backlog\n\nMark a ticket `[~] … (agent X)` when you take it and `[x]` when done.\n\n' + TICKETS.map((t) => `- [ ] ${tdesc(t)}`).join('\n') + '\n';
        ctx.queue = 'The backlog is BACKLOG.md. Before starting a ticket, mark its line as taken: `- [~] T-n … (agent <you>)`; mark it `- [x]` when done. Skip tickets that are already taken or done.';
        break;
      case 'sea':
        seaSetup(ctx);
        ctx.postRepo.push(() => { for (const t of TICKETS) seaCreate(ctx, tdesc(t), `Ticket ${t.id}. Done = test/run.js passes for ${t.fn}, CHANGELOG line added, ./bin/ticket-done ${t.id} run.`, [t.file, 'CHANGELOG.md']); seaPrecommit(ctx); });
        ctx.queue = 'The backlog is the sea-lite work queue (MCP server `sea-lite`). Follow the work-queue skill: take one ticket at a time with sea_next, passing as scope the paths the ticket names; transition it to resolved (confirm: true) when done. If sea_next returns nothing eligible or a scope_conflict, wait a little (e.g. `sleep 20`) and try again up to 5 times before stopping.';
        break;
      case 'beads':
        beadsSetup(ctx);
        ctx.postRepo.push(() => { beadsInit(ctx); for (const t of TICKETS) beadsCreate(ctx, tdesc(t), `Ticket ${t.id}. Done = test/run.js passes for ${t.fn}, CHANGELOG line added, ./bin/ticket-done ${t.id} run.`); });
        ctx.queue = 'The backlog is in beads (the `bd` CLI). Use `bd ready` to see available work, `bd update <id> --claim` to take a ticket (if the claim fails, someone else has it: pick another), and `bd close <id>` when done.';
        break;
    }
    initRepo(ctx, files);
  },
  agents(ctx) {
    return ['A', 'B'].map((id) => ({
      id,
      prompt: `You are agent ${id}, one of two coding agents working in this same repository at the same time; the other agent works on the same backlog concurrently. Work through the backlog until no ticket is left for you: take one ticket at a time, implement it, run \`node test/run.js\`, run \`./bin/ticket-done <T-number>\` (the T-number is in the ticket title), then commit only the files you changed for that ticket with git. ${ctx.queue} ${NO_ASK} When nothing is left for you, reply with the T-numbers you completed.`,
    }));
  },
  grade(ctx, runs) {
    const acts = actionsOf(ctx).filter((a) => a.cmd === 'ticket-done');
    const doneBy = {}; for (const a of acts) { const id = (a.pos[0] || '').toUpperCase(); (doneBy[id] ||= new Set()).add(a.agent); }
    const r = shTry('node', ['-e', `const m=require('./src/math.js'),s=require('./src/str.js');const o={};${TICKETS.map((t) => `try{o['${t.id}']=!!(${t.test})}catch{o['${t.id}']=false}`).join(';')};console.log(JSON.stringify(o))`], { cwd: ctx.repo });
    let fn = {}; try { fn = JSON.parse(r.out.trim()); } catch { /* syntax error in sources */ }
    let changelog = ''; try { changelog = fs.readFileSync(path.join(ctx.repo, 'CHANGELOG.md'), 'utf8'); } catch { /* */ }
    const clOk = TICKETS.filter((t) => new RegExp(`^- ${t.id}\\b`, 'm').test(changelog)).length;
    const markers = shTry('git', ['grep', '-l', '-E', '^(<<<<<<<|>>>>>>>) '], { cwd: ctx.repo }).out.trim().split('\n').filter(Boolean).length;
    const dup = Object.values(doneBy).filter((s) => s.size > 1).length;
    const doneIds = Object.keys(doneBy);
    const lost = doneIds.filter((id) => fn[id] === false).length; // marked done but not in the final tree
    const lostCl = doneIds.filter((id) => !new RegExp(`^- ${id}\\b`, 'm').test(changelog)).length;
    const commits = shTry('git', ['log', '--format=%an', 'main'], { cwd: ctx.repo }).out.trim().split('\n').filter((x) => x && x !== 'bench-setup');
    const dirty = shTry('git', ['status', '--porcelain', '--', 'src', 'CHANGELOG.md'], { cwd: ctx.repo }).out.trim().split('\n').filter(Boolean).length;
    const editConflicts = runs.reduce((n, x) => n + x.toolErrors.filter((e) => /modified since|has been modified|changed since/i.test(e)).length, 0);
    const scopeDenials = runs.reduce((n, x) => n + x.toolErrors.filter((e) => /scope_conflict|someone else's live claim|inside someone else/i.test(e)).length, 0);
    const lockErrors = runs.reduce((n, x) => n + x.toolErrors.filter((e) => /index\.lock/i.test(e)).length, 0);
    const allFns = TICKETS.every((t) => fn[t.id] === true);
    const perAgent = Object.fromEntries(['A', 'B'].map((a) => [a, acts.filter((x) => x.agent === a).length]));
    return {
      success: allFns && clOk === 4 && dup === 0 && markers === 0,
      wrong_action: dup > 0 || lost > 0 || lostCl > 0 || markers > 0, // a collision of any kind
      functions_ok: TICKETS.filter((t) => fn[t.id] === true).length, changelog_lines: clOk,
      duplicate_tickets: dup, lost_edits: lost, lost_changelog: lostCl, conflict_marker_files: markers,
      edit_conflict_errors: editConflicts, scope_denials: scopeDenials, git_lock_errors: lockErrors,
      commits: commits.length, uncommitted_files: dirty, tickets_done_per_agent: perAgent,
      both_worked: perAgent.A > 0 && perAgent.B > 0,
    };
  },
};

export const SCENARIOS = {
  T1: midSessionScenario({ id: 'T1', title: 'stale runbook mid-session (target changes after build)', benign: false }),
  T2,
  T3,
  T4,
  T5,
  T7,
  T6: midSessionScenario({ id: 'T6', title: 'benign-noise control (typo/whitespace edit after build)', benign: true }),
};
