// S14 planning cost: author the same plan in every work-queue arm — 1 epic + 20 tickets (one-line
// acceptance body each), every ticket a child of the epic, ticket i+1 depends on ticket i (20 + 19 =
// 39 links). Deterministic; the "seeds" are repetitions (counts are fixed, wall ms varies).
//
// Per path we meter what the model pays: tool calls (= model turns), bytes it must write (MCP:
// JSON.stringify(arguments); CLI: the Bash command line, heredoc included), bytes of tool results it
// reads back (MCP content text; CLI stdout+stderr) and wall ms (sum of call latencies; MCP server
// start-up excluded, CLI process start-up included because every call pays it). Then:
//   graph exact — read the store back (harness only, not metered): exactly 21 tickets with the planned
//                 titles, exactly the 20 parent edges and 19 dependency edges, nothing else;
//   idempotent  — re-send the same plan on the same store; any extra ticket = duplicated;
//   atomic      — fresh store, same plan plus one invalid item (edge "ticket 1 depends on ticket 20",
//                 which closes a cycle); atomic = rejected and nothing left behind;
//   validate    — batch paths only: the tool's dry-run on the invalid plan catches it, writes nothing.
// Measurement only: nothing in the products is changed.
import fs from 'node:fs';
import path from 'node:path';
import { McpClient } from '../lib/mcp.mjs';
import { ARMS_DIR, sh, tmpdir, rmrf, gitInit } from '../lib/util.mjs';
import { tokens } from '../lib/stats.mjs';
import SeaLite, { SEA_TOOL } from '../arms/sea-lite.mjs';
import Beads from '../arms/beads.mjs';
import BacklogMd from '../arms/backlog-md.mjs';
import TaskMaster from '../arms/task-master.mjs';

const N = 20;
const BD = path.join(ARMS_DIR, 'node_modules', '@beads', 'bd', 'bin', 'bd');
const BEADS_MCP = path.join(ARMS_DIR, 'beads-mcp-venv', 'bin', 'beads-mcp');
const BL = path.join(ARMS_DIR, 'node_modules', '.bin', 'backlog');
const TM_MCP = path.join(ARMS_DIR, 'node_modules', '.bin', 'task-master-mcp');
const pad = (i) => String(i).padStart(2, '0');

export const PLAN = {
  epic: { ref: 'epic', title: 'Checkout v2 rollout', body: 'Acceptance: all 20 steps resolved and checkout v2 is the default path.' },
  tickets: Array.from({ length: N }, (_, k) => ({ ref: `t${pad(k + 1)}`, title: `Checkout v2 step ${pad(k + 1)}: ship part ${k + 1} of the new flow`, body: `Acceptance: part ${k + 1} merged behind the flag with its tests passing.` })),
};
const ALL = [PLAN.epic, ...PLAN.tickets];

// ---- metering ----------------------------------------------------------------------------------
const q = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);
class Meter {
  constructor() { this.calls = 0; this.written = 0; this.result = 0; this.ms = 0; this.errors = 0; this.crashed = false; this.last = null; }
  async mcp(client, name, args) {
    this.calls++; this.written += Buffer.byteLength(JSON.stringify(args));
    let r;
    try { r = await client.call(name, args); }
    catch (e) { this.crashed = true; r = { text: `CLIENT_ERROR ${String(e.message).slice(0, 300)}`, bytes: 0, ms: 0, isError: true }; }
    this.result += r.bytes; this.ms += r.ms; if (r.isError) this.errors++;
    this.last = r; return r;
  }
  // `display` is what the agent types into Bash (`bd …`, heredoc included); `bin` is what we exec.
  // With `heredoc`, the command runs through bash exactly as displayed (Node's stdin pipe is a socket,
  // which bd cannot open as /dev/stdin; a bash heredoc is what the agent's Bash tool would run).
  cli(bin, args, { cwd, env, display, heredoc }) {
    this.calls++;
    display ??= ['bd', ...args].map(q).join(' ');
    this.written += Buffer.byteLength(display);
    const r = heredoc ? sh('bash', ['-c', display.replace(/^bd /, `${q(bin)} `)], { cwd, env, timeout: 120000 }) : sh(bin, args, { cwd, env, timeout: 120000 });
    const out = r.stdout + r.stderr;
    this.result += Buffer.byteLength(out); this.ms += r.ms; if (r.code !== 0) this.errors++;
    const v = { text: out, stdout: r.stdout, code: r.code, ms: r.ms, isError: r.code !== 0 };
    this.last = v; return v;
  }
  snap() { return { calls: this.calls, written: this.written, result: this.result, ms: Math.round(this.ms), errors: this.errors, crashed: this.crashed }; }
}
const J = (r) => { try { return JSON.parse(r.text); } catch { return null; } };

// ---- graph check -------------------------------------------------------------------------------
// g = { tickets: [{id, title}], parent: [[parentId, childId]], deps: [[dependentId, prerequisiteId]] }
function check(g) {
  const byTitle = new Map();
  for (const t of g.tickets) byTitle.set(t.title, [...(byTitle.get(t.title) ?? []), t.id]);
  const ids = ALL.map((x) => byTitle.get(x.title));
  const problems = [];
  if (g.tickets.length !== ALL.length) problems.push(`${g.tickets.length} tickets (want ${ALL.length})`);
  if (ids.some((x) => !x || x.length !== 1)) problems.push('titles missing or duplicated');
  else {
    const id = ids.map((x) => x[0]);
    const want = (pairs) => new Set(pairs.map(([a, b]) => `${a}>${b}`));
    const have = (pairs) => new Set(pairs.map(([a, b]) => `${a}>${b}`));
    const eq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
    const wp = want(Array.from({ length: N }, (_, k) => [id[0], id[k + 1]]));
    const wd = want(Array.from({ length: N - 1 }, (_, k) => [id[k + 2], id[k + 1]]));
    if (!eq(have(g.parent), wp)) problems.push(`parent edges ${g.parent.length} (want ${N}, exact match ${eq(have(g.parent), wp)})`);
    if (!eq(have(g.deps), wd)) problems.push(`dependency edges ${g.deps.length} (want ${N - 1}, exact match ${eq(have(g.deps), wd)})`);
  }
  return { exact: problems.length === 0, problems, tickets: g.tickets.length, edges: g.parent.length + g.deps.length };
}

// ---- stores ------------------------------------------------------------------------------------
function mkctx(tag) { const home = tmpdir(`S14-${tag}`); const ctx = { home, repo: path.join(home, 'repo'), seed: 0, actor: 'planner' }; gitInit(ctx.repo); return ctx; }

const seaStore = {
  async open(ctx) { const arm = new SeaLite(ctx); await arm.setup(); const client = await arm.client('planner'); return { arm, client, memo: {} }; },
  async readback(s) {
    const l = await s.client.call('sea_list', { limit: 200, include_terminal: true });
    const ts = (J(l)?.tickets ?? []).map((t) => ({ id: t.id, title: t.title }));
    const parent = [], deps = [];
    for (const t of ts) {
      const g = J(await s.client.call('sea_get', { id: t.id }));
      for (const k of g?.links ?? []) if (k.direction === 'out') { if (k.link_type === 'parent_of') parent.push([k.from_id, k.to_id]); if (k.link_type === 'depends_on') deps.push([k.from_id, k.to_id]); }
    }
    return { tickets: ts, parent, deps };
  },
  async close(s) { await s.arm.close(); },
};
const bdEnv = (ctx) => ({ ...process.env, HOME: ctx.home, BD_NON_INTERACTIVE: '1', CI: '1' });
const beadsStore = (withMcp) => ({
  async open(ctx) {
    const arm = new Beads(ctx); await arm.setup();
    const s = { ctx, env: bdEnv(ctx) };
    if (withMcp) s.client = await new McpClient(BEADS_MCP, [], { env: { ...s.env, BEADS_PATH: BD, BEADS_WORKING_DIR: ctx.repo }, cwd: ctx.repo }).start();
    return s;
  },
  async readback(s) {
    const r = sh(BD, ['list', '--json', '--limit', '0', '--all'], { cwd: s.ctx.repo, env: s.env });
    let xs = []; try { xs = JSON.parse(r.stdout); } catch {}
    const parent = [], deps = [];
    for (const i of xs) for (const d of i.dependencies ?? []) { if (d.type === 'parent-child') parent.push([d.depends_on_id, i.id]); else if (d.type === 'blocks') deps.push([i.id, d.depends_on_id]); }
    return { tickets: xs.map((i) => ({ id: i.id, title: i.title })), parent, deps };
  },
  async close(s) { await s.client?.close(); },
});
const backlogStore = {
  async open(ctx) { const arm = new BacklogMd(ctx); await arm.setup(); const client = await new McpClient(BL, ['mcp', 'start'], { env: { ...process.env, HOME: ctx.home }, cwd: ctx.repo }).start(); return { ctx, client }; },
  async readback(s) {
    const dir = path.join(s.ctx.repo, 'backlog', 'tasks');
    const tickets = [], parent = [], deps = [];
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith('.md')) : []) {
      const fm = (fs.readFileSync(path.join(dir, f), 'utf8').match(/^---\n([\s\S]*?)\n---/) ?? [])[1] ?? '';
      const field = (k) => (fm.match(new RegExp(`^${k}:\\s*(.*)$`, 'm')) ?? [])[1]?.trim().replace(/^['"]|['"]$/g, '');
      const list = (k) => { const m = fm.match(new RegExp(`^${k}:[ \\t]*(\\[.*\\])?[ \\t]*\\n((?:[ \\t]*- .*\\n?)*)`, 'm')); if (!m) return []; if (m[1]) return m[1].slice(1, -1).split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean); return m[2].split('\n').map((x) => x.replace(/^\s*-\s*/, '').trim().replace(/^['"]|['"]$/g, '')).filter(Boolean); };
      const id = field('id'); tickets.push({ id, title: field('title') });
      const p = field('parent_task_id'); if (p) parent.push([p, id]);
      for (const d of list('dependencies')) deps.push([id, d]);
    }
    return { tickets, parent, deps };
  },
  async close(s) { await s.client.close(); },
};
const tmStore = {
  async open(ctx) { const arm = new TaskMaster(ctx); await arm.setup(); const client = await new McpClient(TM_MCP, [], { env: { ...process.env, HOME: ctx.home, TASK_MASTER_TOOLS: 'all' }, cwd: ctx.repo }).start(); return { ctx, arm, client }; },
  // Epic = a task; tickets = its subtasks (task-master's only parent/child relation). Subtask ids are `<task>.<n>`.
  async readback(s) {
    const tickets = [], parent = [], deps = [];
    for (const t of s.arm.tasks()) {
      tickets.push({ id: String(t.id), title: t.title });
      for (const d of t.dependencies ?? []) deps.push([String(t.id), String(d)]);
      for (const st of t.subtasks ?? []) {
        const id = `${t.id}.${st.id}`; tickets.push({ id, title: st.title }); parent.push([String(t.id), id]);
        for (const d of st.dependencies ?? []) deps.push([id, typeof d === 'number' ? `${t.id}.${d}` : String(d)]);
      }
    }
    return { tickets, parent, deps };
  },
  async close(s) { await s.client.close(); },
};

// ---- paths -------------------------------------------------------------------------------------
// run(s, meter, { inject }) authors the plan; inject adds the cycle-closing edge "t01 depends on t20".
const seaApplyArgs = (inject, extra = {}) => ({
  tickets: ALL.map((x) => ({ ref: x.ref, title: x.title, body: x.body, ...(x.ref === 'epic' ? { kind: 'epic' } : {}) })),
  links: [
    ...PLAN.tickets.map((t) => ({ from_ref: 'epic', to_ref: t.ref, link_type: 'parent_of' })),
    ...PLAN.tickets.slice(1).map((t, k) => ({ from_ref: t.ref, to_ref: PLAN.tickets[k].ref, link_type: 'depends_on' })),
    ...(inject ? [{ from_ref: 't01', to_ref: 't20', link_type: 'depends_on' }] : []),
  ],
  idempotency_key: inject ? 's14-plan-invalid' : 's14-plan', ...extra,
});
// The same plan as one sea_apply template (sea-lite ≥ next): the epic explicitly, the 20 steps as a
// template over "01".."20" ({value} = zero-padded step, {i} = part number), with the parent edge and the
// chain edge written once ({prev} is skipped for the first step).
const seaTemplateArgs = (inject, extra = {}) => ({
  tickets: [{ ref: 'epic', title: PLAN.epic.title, body: PLAN.epic.body, kind: 'epic' }],
  templates: [{
    for_each: PLAN.tickets.map((_, k) => pad(k + 1)),
    ref: 't{value}',
    ticket: { title: 'Checkout v2 step {value}: ship part {i} of the new flow', body: 'Acceptance: part {i} merged behind the flag with its tests passing.' },
    links: [{ from_ref: 'epic', to_ref: '{ref}', link_type: 'parent_of' }, { from_ref: '{ref}', to_ref: '{prev}', link_type: 'depends_on' }],
  }],
  ...(inject ? { links: [{ from_ref: 't01', to_ref: 't20', link_type: 'depends_on' }] } : {}),
  idempotency_key: inject ? 's14-tplan-invalid' : 's14-tplan', ...extra,
});
const bdPlan = (inject) => ({
  nodes: ALL.map((x) => (x.ref === 'epic' ? { key: x.ref, title: x.title, type: 'epic', acceptance_criteria: x.body } : { key: x.ref, title: x.title, parent_key: 'epic', acceptance_criteria: x.body })),
  edges: [...PLAN.tickets.slice(1).map((t, k) => ({ from_key: t.ref, to_key: PLAN.tickets[k].ref })), ...(inject ? [{ from_key: 't01', to_key: 't20' }] : [])],
});
const heredoc = (cmd, body) => `${cmd} <<'EOF'\n${body}\nEOF`;

export const PATHS = [
  {
    id: 'sea-lite/apply', arm: 'sea-lite', tool: SEA_TOOL, path: '`sea_apply` (one MCP call)', surface: 'MCP', batch: true, store: seaStore,
    async run(s, m, { inject }) { const r = await m.mcp(s.client, 'sea_apply', seaApplyArgs(inject)); return { rejected: r.isError, note: r.isError ? r.text.slice(0, 160) : null }; },
    async dryRun(s, m) { const r = await m.mcp(s.client, 'sea_apply', seaApplyArgs(true, { dry_run: true, idempotency_key: undefined })); return { caught: r.isError, note: r.text.slice(0, 160) }; },
  },
  {
    // Needs a sea-lite build with templates (SEA_LITE_CLI=<next>/dist/cli.js); against 0.4.0 the call is rejected.
    id: 'sea-lite/apply-template', arm: 'sea-lite', tool: SEA_TOOL, path: '`sea_apply` with `templates` (one MCP call, 20 steps written once)', surface: 'MCP', batch: true, store: seaStore,
    async run(s, m, { inject }) { const r = await m.mcp(s.client, 'sea_apply', seaTemplateArgs(inject)); if (!inject && r.isError) throw new Error(`sea_apply templates: ${r.text.slice(0, 200)}`); return { rejected: r.isError, note: r.isError ? r.text.slice(0, 160) : null }; },
    async dryRun(s, m) { const r = await m.mcp(s.client, 'sea_apply', seaTemplateArgs(true, { dry_run: true, idempotency_key: undefined })); return { caught: r.isError, note: r.text.slice(0, 160) }; },
  },
  {
    id: 'sea-lite/per-item', arm: 'sea-lite', tool: SEA_TOOL, path: '`sea_create` (claim_seconds) ×21 + `sea_link` ×39 (MCP)', surface: 'MCP', store: seaStore,
    // Same session re-sending the same calls on a re-run: a replayed sea_create returns claim_token null,
    // so links reuse the first run's tokens (s.memo) exactly as the agent's context would.
    async run(s, m, { inject }) {
      const id = {}, tok = s.memo;
      for (const x of ALL) {
        const r = await m.mcp(s.client, 'sea_create', { title: x.title, body: x.body, ...(x.ref === 'epic' ? { kind: 'epic' } : {}), claim_seconds: 600, idempotency_key: `s14-c-${x.ref}` });
        const j = J(r); if (!j?.ticket?.id) throw new Error(`sea_create ${x.ref}: ${r.text.slice(0, 200)}`);
        id[x.ref] = j.ticket.id; if (j.claim_token) tok[x.ref] = j.claim_token;
      }
      const link = (from, to, type) => m.mcp(s.client, 'sea_link', { action: 'add', from_id: id[from], to_id: id[to], link_type: type, claim_token: tok[from], idempotency_key: `s14-l-${from}-${type}-${to}` });
      for (const t of PLAN.tickets) await link('epic', t.ref, 'parent_of');
      for (let k = 1; k < N; k++) await link(PLAN.tickets[k].ref, PLAN.tickets[k - 1].ref, 'depends_on');
      if (inject) { const r = await link('t01', 't20', 'depends_on'); return { rejected: r.isError, note: r.text.slice(0, 160) }; }
      return {};
    },
  },
  {
    id: 'beads/graph', arm: 'beads', tool: 'beads 1.3.2', path: '`bd create --graph` (one Bash call, plan JSON in a heredoc)', surface: 'CLI', batch: true, store: beadsStore(false),
    async run(s, m, { inject }) {
      const json = JSON.stringify(bdPlan(inject));
      const r = m.cli(BD, [], { cwd: s.ctx.repo, env: s.env, heredoc: true, display: heredoc('bd create --graph /dev/stdin --json', json) });
      return { rejected: r.isError, note: r.isError ? r.text.slice(0, 160) : null };
    },
    async dryRun(s, m) {
      const json = JSON.stringify(bdPlan(true));
      const r = m.cli(BD, [], { cwd: s.ctx.repo, env: s.env, heredoc: true, display: heredoc('bd create --graph /dev/stdin --dry-run', json) });
      return { caught: r.isError, note: r.text.slice(0, 160) };
    },
  },
  {
    id: 'beads/cli-inline', arm: 'beads', tool: 'beads 1.3.2', path: '`bd create --parent --deps` ×21 (Bash)', surface: 'CLI', store: beadsStore(false),
    async run(s, m, { inject }) {
      const id = {};
      const mk = (args) => { const r = m.cli(BD, [...args, '--silent'], { cwd: s.ctx.repo, env: s.env }); const v = r.stdout.trim().split('\n').pop(); if (r.isError || !v) throw new Error(`bd create: ${r.text.slice(0, 200)}`); return v; };
      id.epic = mk(['create', PLAN.epic.title, '-t', 'epic', '--acceptance', PLAN.epic.body]);
      PLAN.tickets.forEach((t, k) => { id[t.ref] = mk(['create', t.title, '--parent', id.epic, ...(k ? ['--deps', id[PLAN.tickets[k - 1].ref]] : []), '--acceptance', t.body]); });
      if (inject) { const r = m.cli(BD, ['dep', 'add', id.t01, id.t20], { cwd: s.ctx.repo, env: s.env }); return { rejected: r.isError, note: r.text.slice(0, 160) }; }
      return {};
    },
  },
  {
    id: 'beads/cli-edges', arm: 'beads', tool: 'beads 1.3.2', path: '`bd create` ×21 + `bd dep add` ×39 (Bash)', surface: 'CLI', store: beadsStore(false),
    async run(s, m, { inject }) {
      const id = {};
      for (const x of ALL) { const r = m.cli(BD, ['create', x.title, ...(x.ref === 'epic' ? ['-t', 'epic'] : []), '--acceptance', x.body, '--silent'], { cwd: s.ctx.repo, env: s.env }); id[x.ref] = r.stdout.trim().split('\n').pop(); if (r.isError || !id[x.ref]) throw new Error(`bd create: ${r.text.slice(0, 200)}`); }
      for (const t of PLAN.tickets) m.cli(BD, ['dep', 'add', id[t.ref], id.epic, '-t', 'parent-child'], { cwd: s.ctx.repo, env: s.env });
      for (let k = 1; k < N; k++) m.cli(BD, ['dep', 'add', id[PLAN.tickets[k].ref], id[PLAN.tickets[k - 1].ref]], { cwd: s.ctx.repo, env: s.env });
      if (inject) { const r = m.cli(BD, ['dep', 'add', id.t01, id.t20], { cwd: s.ctx.repo, env: s.env }); return { rejected: r.isError, note: r.text.slice(0, 160) }; }
      return {};
    },
  },
  {
    id: 'beads/mcp-inline', arm: 'beads', tool: 'beads-mcp 1.3.2', path: '`create` with `deps` ×21 (MCP)', surface: 'MCP', store: beadsStore(true),
    async run(s, m, { inject }) {
      const id = {};
      for (const [k, x] of ALL.entries()) {
        const args = x.ref === 'epic' ? { title: x.title, issue_type: 'epic', acceptance: x.body } : { title: x.title, acceptance: x.body, deps: [`parent-child:${id.epic}`, ...(k > 1 ? [id[ALL[k - 1].ref]] : [])] };
        const r = await m.mcp(s.client, 'create', args); id[x.ref] = J(r)?.id; if (!id[x.ref]) throw new Error(`beads-mcp create: ${r.text.slice(0, 200)}`);
      }
      if (inject) { const r = await m.mcp(s.client, 'dep', { issue_id: id.t01, depends_on_id: id.t20 }); return { rejected: r.isError || /error/i.test(r.text), note: r.text.slice(0, 160) }; }
      return {};
    },
  },
  {
    id: 'beads/mcp-edges', arm: 'beads', tool: 'beads-mcp 1.3.2', path: '`create` ×21 + `dep` ×39 (MCP)', surface: 'MCP', store: beadsStore(true),
    async run(s, m, { inject }) {
      const id = {};
      for (const x of ALL) { const r = await m.mcp(s.client, 'create', { title: x.title, ...(x.ref === 'epic' ? { issue_type: 'epic' } : {}), acceptance: x.body }); id[x.ref] = J(r)?.id; if (!id[x.ref]) throw new Error(`beads-mcp create: ${r.text.slice(0, 200)}`); }
      for (const t of PLAN.tickets) await m.mcp(s.client, 'dep', { issue_id: id[t.ref], depends_on_id: id.epic, dep_type: 'parent-child' });
      for (let k = 1; k < N; k++) await m.mcp(s.client, 'dep', { issue_id: id[PLAN.tickets[k].ref], depends_on_id: id[PLAN.tickets[k - 1].ref] });
      if (inject) { const r = await m.mcp(s.client, 'dep', { issue_id: id.t01, depends_on_id: id.t20 }); return { rejected: r.isError || /error/i.test(r.text), note: r.text.slice(0, 160) }; }
      return {};
    },
  },
  {
    id: 'backlog-md/mcp', arm: 'backlog-md', tool: 'Backlog.md 1.55.3', path: '`task_create` with `parentTaskId` + `dependencies` ×21 (MCP)', surface: 'MCP', store: backlogStore,
    async run(s, m, { inject }) {
      const id = {};
      for (const [k, x] of ALL.entries()) {
        const args = x.ref === 'epic' ? { title: x.title, acceptanceCriteria: [x.body] } : { title: x.title, acceptanceCriteria: [x.body], parentTaskId: id.epic, ...(k > 1 ? { dependencies: [id[ALL[k - 1].ref]] } : {}) };
        const r = await m.mcp(s.client, 'task_create', args); id[x.ref] = r.text.match(/Task (TASK-[\d.]+) - /)?.[1]; if (!id[x.ref]) throw new Error(`task_create: ${r.text.slice(0, 200)}`);
      }
      if (inject) { const r = await m.mcp(s.client, 'task_edit', { id: id.t01, dependencies: [id.t20] }); return { rejected: r.isError, note: r.text.slice(0, 160) }; }
      return {};
    },
  },
  {
    id: 'task-master/mcp-edges', arm: 'task-master', tool: 'task-master-ai 0.43.1', path: '`add_task` + `add_subtask` ×20 + `add_dependency` ×19 (MCP, no LLM)', surface: 'MCP', store: tmStore,
    async run(s, m, { inject }) {
      const root = s.ctx.repo;
      const e = await m.mcp(s.client, 'add_task', { title: PLAN.epic.title, description: PLAN.epic.body, projectRoot: root });
      const eid = String(J(e)?.data?.taskId ?? ''); if (!eid) throw new Error(`add_task: ${e.text.slice(0, 200)}`);
      const id = {};
      for (const t of PLAN.tickets) { const r = await m.mcp(s.client, 'add_subtask', { id: eid, title: t.title, description: t.body, projectRoot: root }); const sub = J(r)?.data?.subtask; id[t.ref] = sub ? `${eid}.${sub.id}` : null; if (!id[t.ref]) throw new Error(`add_subtask: ${r.text.slice(0, 200)}`); }
      for (let k = 1; k < N; k++) await m.mcp(s.client, 'add_dependency', { id: id[PLAN.tickets[k].ref], dependsOn: id[PLAN.tickets[k - 1].ref], projectRoot: root });
      if (inject) { const r = await m.mcp(s.client, 'add_dependency', { id: id.t01, dependsOn: id.t20, projectRoot: root }); return { rejected: r.isError, note: r.text.slice(0, 160) }; }
      return {};
    },
  },
  {
    id: 'task-master/mcp-inline', arm: 'task-master', tool: 'task-master-ai 0.43.1', path: '`add_task` + `add_subtask` with `dependencies` ×20 (MCP, no LLM)', surface: 'MCP', store: tmStore,
    async run(s, m, { inject }) {
      const root = s.ctx.repo;
      const e = await m.mcp(s.client, 'add_task', { title: PLAN.epic.title, description: PLAN.epic.body, projectRoot: root });
      const eid = String(J(e)?.data?.taskId ?? ''); if (!eid) throw new Error(`add_task: ${e.text.slice(0, 200)}`);
      const id = {};
      for (const [k, t] of PLAN.tickets.entries()) { const r = await m.mcp(s.client, 'add_subtask', { id: eid, title: t.title, description: t.body, ...(k ? { dependencies: id[PLAN.tickets[k - 1].ref] } : {}), projectRoot: root }); const sub = J(r)?.data?.subtask; id[t.ref] = sub ? `${eid}.${sub.id}` : null; if (!id[t.ref]) throw new Error(`add_subtask: ${r.text.slice(0, 200)}`); }
      if (inject) { const r = await m.mcp(s.client, 'add_dependency', { id: id.t01, dependsOn: id.t20, projectRoot: root }); return { rejected: r.isError, note: r.text.slice(0, 160) }; }
      return {};
    },
  },
];

// Rows that are not measured here (kept with the table so the gap is visible).
export const NOT_RUN = [
  { tool: 'task-master-ai 0.43.1', path: '`parse_prd` (plan from a PRD)', reason: 'n/a — generates tasks with an LLM; Track A is LLM-free' },
  { tool: 'mcp_agent_mail 0.3.4', path: '—', reason: 'n/a — no tickets or dependency graph (messages + file reservations only)' },
];
// Documented call counts from published tool schemas — NOT measured (needs network + accounts).
export const DOCUMENTED = [
  { tool: 'GitHub MCP server (github/github-mcp-server, main @ 2026-10-31)', path: '`issue_write` ×21 (20 with `parent_issue_number`) + `issue_dependency_write` ×19', calls: 40, atomic: 'no — one issue / one edge per call', idempotent: 'no key in the schemas (`issue_dependency_write` idempotentHint: false)', note: 'without `parent_issue_number`: + `sub_issue_write` ×20 = 60 calls; `issue_dependency_write` is behind the `issue_dependencies` feature flag', sources: ['https://github.com/github/github-mcp-server/blob/main/README.md', 'https://github.com/github/github-mcp-server/blob/main/pkg/github/__toolsnaps__/issue_dependency_write_ff_issue_dependencies.snap'] },
  { tool: 'Linear GraphQL API (@linear/sdk schema.graphql)', path: '`issueCreate` (epic) + `issueBatchCreate` (20 children, `parentId`) + `issueRelationCreate` ×19', calls: 21, atomic: 'only the 20-issue batch ("Creates a list of issues atomically", ≤ 50); relations one per call', idempotent: 'optional client `id` (UUID v4) per issue/relation — behaviour on replay not documented', note: 'GraphQL mutations, not an MCP tool catalog; the epic must exist before children can name it as `parentId`', sources: ['https://github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql'] },
];

async function once(P, seed) {
  const rec = { path: P.id, seed };
  // 1) clean run, readback, re-run (idempotency), readback
  let ctx = mkctx(`${P.id.replace(/[^a-z0-9]/gi, '')}-${seed}`), s;
  try {
    s = await P.store.open(ctx);
    const m = new Meter();
    const out = await P.run(s, m, { inject: false });
    rec.cost = m.snap(); rec.ok = m.errors === 0 && !m.crashed; if (out?.note) rec.note = out.note;
    rec.graph = check(await P.store.readback(s));
    const m2 = new Meter();
    try { await P.run(s, m2, { inject: false }); rec.rerun = { ...m2.snap() }; } catch (e) { rec.rerun = { ...m2.snap(), error: String(e.message).slice(0, 200) }; }
    const g2 = check(await P.store.readback(s));
    rec.rerun.tickets_after = g2.tickets; rec.rerun.edges_after = g2.edges; rec.rerun.duplicated = g2.tickets > ALL.length || g2.edges > rec.graph.edges;
  } catch (e) { rec.error = String(e.message).slice(0, 400); }
  finally { try { await P.store.close(s); } catch {} rmrf(ctx.home); }
  // 2) fresh store: dry-run (batch paths) then the plan with one invalid edge
  ctx = mkctx(`${P.id.replace(/[^a-z0-9]/gi, '')}-${seed}-bad`); s = null;
  try {
    s = await P.store.open(ctx);
    if (P.dryRun) { const md = new Meter(); const d = await P.dryRun(s, md); const g = check(await P.store.readback(s)); rec.dry = { caught: d.caught && g.tickets === 0, wrote: g.tickets, note: d.note, ...md.snap() }; }
    const m = new Meter();
    let out = {};
    try { out = await P.run(s, m, { inject: true }); } catch (e) { out = { rejected: true, note: String(e.message).slice(0, 160) }; }
    const g = check(await P.store.readback(s));
    rec.inject = { rejected: !!out.rejected, crashed: m.crashed, tickets_left: g.tickets, edges_left: g.edges, atomic: !!out.rejected && g.tickets === 0, cost: m.snap(), note: out.note };
  } catch (e) { rec.inject = { error: String(e.message).slice(0, 400) }; }
  finally { try { await P.store.close(s); } catch {} rmrf(ctx.home); }
  return rec;
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)); };
function aggregate(P, recs) {
  const good = recs.filter((r) => r.cost);
  const uniq = (f) => [...new Set(good.map(f))];
  const ms = good.map((r) => r.cost.ms);
  const written = good.map((r) => r.cost.written), result = good.map((r) => r.cost.result);
  return {
    id: P.id, arm: P.arm, tool: P.tool, path: P.path, surface: P.surface, batch: !!P.batch, n: recs.length, errors: recs.filter((r) => r.error).map((r) => r.error),
    calls: uniq((r) => r.cost.calls), call_errors: uniq((r) => r.cost.errors),
    written_bytes: { mean: Math.round(mean(written)), min: Math.min(...written), max: Math.max(...written), tokens: tokens(Math.round(mean(written))) },
    result_bytes: { mean: Math.round(mean(result)), min: Math.min(...result), max: Math.max(...result), tokens: tokens(Math.round(mean(result))) },
    tokens_total: tokens(Math.round(mean(written))) + tokens(Math.round(mean(result))),
    wall_ms: { mean: Math.round(mean(ms)), sd: Math.round(sd(ms)), min: Math.min(...ms), max: Math.max(...ms), cv: ms.length ? +(sd(ms) / mean(ms)).toFixed(3) : null, per_seed: ms },
    exact: { k: good.filter((r) => r.graph?.exact).length, n: recs.length, problems: uniq((r) => r.graph?.problems?.join('; ') || '') },
    idempotent: { k: good.filter((r) => r.rerun && !r.rerun.duplicated && !r.rerun.error).length, n: recs.length, tickets_after: uniq((r) => r.rerun?.tickets_after), edges_after: uniq((r) => r.rerun?.edges_after), rerun_calls: uniq((r) => r.rerun?.calls), rerun_errors: uniq((r) => r.rerun?.error).filter(Boolean) },
    atomic: { k: recs.filter((r) => r.inject?.atomic).length, n: recs.length, rejected: recs.filter((r) => r.inject?.rejected).length, crashed: recs.filter((r) => r.inject?.crashed).length, tickets_left: [...new Set(recs.map((r) => r.inject?.tickets_left))], edges_left: [...new Set(recs.map((r) => r.inject?.edges_left))], note: recs.find((r) => r.inject?.note)?.inject.note ?? null },
    dry_run: P.dryRun ? { k: recs.filter((r) => r.dry?.caught).length, n: recs.length, note: recs.find((r) => r.dry)?.dry.note ?? null } : null,
  };
}

export const S14 = {
  id: 'S14', title: 'Planning cost (1 epic + 20 tickets, 39 links)', seeds: 3,
  arms: [...new Set(PATHS.map((p) => p.arm))],
  async run(armIds, { seeds = 3, log = () => {} } = {}) {
    const rows = {}, records = {};
    for (const P of PATHS) {
      if (!armIds.includes(P.arm)) continue;
      const recs = [];
      for (let seed = 1; seed <= seeds; seed++) recs.push(await once(P, seed));
      records[P.id] = recs;
      rows[P.id] = aggregate(P, recs);
      const r = rows[P.id];
      log(`[track-a] S14|${P.id.padEnd(24)} calls ${r.calls.join('/')} write ${r.written_bytes.mean}B result ${r.result_bytes.mean}B ${r.wall_ms.mean}±${r.wall_ms.sd}ms exact ${r.exact.k}/${r.exact.n} idem ${r.idempotent.k}/${r.idempotent.n} atomic ${r.atomic.k}/${r.atomic.n}${r.errors.length ? '  ERR ' + r.errors[0].slice(0, 160) : ''}`);
    }
    return { rows, records, not_run: NOT_RUN, documented: DOCUMENTED, plan: { tickets: ALL.length, parent_edges: N, dep_edges: N - 1, invalid_item: 'edge "ticket 01 depends on ticket 20" (closes a cycle)' } };
  },
};
