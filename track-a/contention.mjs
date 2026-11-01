// S15 — contention: wait vs poll, mirroring Track B T3's conflict pattern, deterministic (no LLM).
//
// T3: two agents, one backlog of 4 tickets (T-1 sum, T-2 mul in src/math.js; T-3 upper, T-4 lower in
// src/str.js), and every ticket also edits CHANGELOG.md, so any two tickets' scopes overlap and the work
// serializes. The T3 instruction for the sea arm: "take one ticket at a time with sea_next, passing as scope
// the paths the ticket names … If sea_next returns nothing eligible or a scope_conflict, wait a little (e.g.
// `sleep 20`) and try again up to 5 times before stopping."
//
// Here each agent is a scripted loop over its own `sea-lite serve` process (one store), time compressed:
//   work W  = 2.0 s per ticket (holding the scope)        ≈ 40 s real
//   think T = 0.25 s between two tool calls (a model turn) ≈ 5 s real
//   poll  P = 1.0 s sleep before a retry                   ≈ 20 s real (the T3 `sleep 20`)
// Every ticket's scope is its file plus CHANGELOG.md; an agent does not know which ticket sea_next will
// hand it, so it asks with the union of the paths the open tickets name (src/math.js, src/str.js,
// CHANGELOG.md) — any held ticket conflicts, as in T3.
//   poll: on scope_conflict / nothing_eligible → (think) sleep P (think) → sea_next again; give up after 5 retries.
//   wait: sea_next with wait_seconds = 5·P (the same patience), one call.
// Agent B starts 0.1 s after A. Metered per mode over N repetitions: wall time until the backlog is done
// (or both agents stopped), tickets done per agent, tickets left undone, tool calls and model turns
// (a poll retry is 2 turns: the sleep and the retry), and the release→next-claim handoff gap.
//
// SEA_LITE_CLI selects the sea-lite build. The wait mode needs `sea_next {wait_seconds}`; when the build's
// tools/list does not advertise it (sea-lite 0.5.0, the released version), only the poll mode runs and the
// report says so.
//   node track-a/contention.mjs [--reps 3] [--out results/track-a]
import fs from 'node:fs';
import path from 'node:path';
import { McpClient } from './lib/mcp.mjs';
import { tmpdir, rmrf, gitInit } from './lib/util.mjs';
import { SEA_CLI, SEA_TOOL } from './arms/sea-lite.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return acc; }, []));
const REPS = Number(args.reps ?? 3);
const OUT = path.resolve(args.out ?? 'results/track-a');
const W = 2.0, T = 0.25, P = 1.0, RETRIES = 5;
const TICKETS = [
  { id: 'T-1', file: 'src/math.js', title: 'T-1: add sum(a, b) to src/math.js' },
  { id: 'T-2', file: 'src/math.js', title: 'T-2: add mul(a, b) to src/math.js' },
  { id: 'T-3', file: 'src/str.js', title: 'T-3: add upper(s) to src/str.js' },
  { id: 'T-4', file: 'src/str.js', title: 'T-4: add lower(s) to src/str.js' },
];
const SCOPE = ['src/math.js', 'src/str.js', 'CHANGELOG.md'];
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

async function run(mode, rep) {
  const home = tmpdir(`S15-${mode}-${rep}`);
  const repo = path.join(home, 'repo'); gitInit(repo);
  const start = (actor) => new McpClient(process.execPath, [SEA_CLI, 'serve', '--actor', actor, '--session', `s-${actor}`, '--project', 's15'], { env: { ...process.env, HOME: home }, cwd: repo }).start();
  const [A, B] = await Promise.all([start('agent-a'), start('agent-b')]);
  for (const t of TICKETS) {
    const r = await A.call('sea_create', { title: t.title, status: 'triaged' });
    if (r.isError) throw new Error(r.text);
  }
  const events = []; // { t, agent, kind: 'claim'|'release', ticket }
  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;
  const agent = async (name, c, delay) => {
    await sleep(delay);
    const st = { name, done: [], calls: 0, turns: 0, retries: 0, waited_s: 0, gave_up: false };
    let retries = 0;
    for (;;) {
      const a = mode === 'wait' ? { scope: { paths: SCOPE }, wait_seconds: RETRIES * P } : { scope: { paths: SCOPE } };
      st.calls++; st.turns++;
      const r = await c.call('sea_next', a);
      const j = r.json ?? (() => { try { return JSON.parse(r.text); } catch { return null; } })();
      if (!r.isError && j?.ticket) {
        events.push({ t: now(), agent: name, kind: 'claim', ticket: j.ticket.title.slice(0, 3) });
        if (j.waited) st.waited_s += j.waited.seconds;
        retries = 0;
        await sleep(W); // the work, holding the scope
        st.calls++; st.turns++;
        const f = await c.call('sea_finish', { ticket_id: j.ticket.id, claim_token: j.claim_token, outcome: 'done', note: 'done' });
        if (f.isError) throw new Error(`finish: ${f.text.slice(0, 200)}`);
        events.push({ t: now(), agent: name, kind: 'release', ticket: j.ticket.title.slice(0, 3) });
        st.done.push(j.ticket.title.slice(0, 3));
        await sleep(T); // the next model turn
        continue;
      }
      const empty = !r.isError && j?.ticket === null && !(await anyOpen(c));
      if (empty) break; // backlog done
      if (mode === 'wait') { st.gave_up = true; break; } // wait_timeout: waited the whole budget
      if (retries >= RETRIES) { st.gave_up = true; break; }
      retries++; st.retries++;
      st.turns++; await sleep(T + P); // a Bash `sleep` turn
      await sleep(T); // then the retry turn
    }
    st.ended_s = now();
    return st;
  };
  const anyOpen = async (c) => { const l = await c.call('sea_list', {}); return (l.json?.count ?? 0) > 0; };
  const [sa, sb] = await Promise.all([agent('A', A, 0), agent('B', B, 0.1)]);
  const wall = Math.max(sa.ended_s, sb.ended_s);
  const left = (await A.call('sea_list', {})).json?.count ?? -1;
  await A.close(); await B.close(); rmrf(home);
  // Handoff gap: each release to the next claim by anyone.
  const gaps = [];
  for (const [i, e] of events.entries()) if (e.kind === 'release') { const n = events.slice(i + 1).find((x) => x.kind === 'claim'); if (n) gaps.push(n.t - e.t); }
  const lastRelease = Math.max(...events.filter((e) => e.kind === 'release').map((e) => e.t));
  return {
    mode, rep, wall_s: +wall.toFixed(2), last_release_s: +lastRelease.toFixed(2), left,
    done: { A: sa.done, B: sb.done }, gave_up: { A: sa.gave_up, B: sb.gave_up },
    calls: sa.calls + sb.calls, turns: sa.turns + sb.turns, retries: sa.retries + sb.retries, waited_s: +(sa.waited_s + sb.waited_s).toFixed(2),
    gaps_s: gaps.map((g) => +g.toFixed(3)), events,
  };
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
// Does this build have sea_next {wait_seconds}? (A server that ignores an unknown argument would make the
// wait mode silently behave like one poll without the sleep, so detect it from the schema.)
const probeHome = tmpdir('S15-probe'); gitInit(path.join(probeHome, 'repo'));
const probe = await new McpClient(process.execPath, [SEA_CLI, 'serve'], { env: { ...process.env, HOME: probeHome }, cwd: path.join(probeHome, 'repo') }).start();
const probeR = await probe.rpc('tools/list', {});
const HAS_WAIT = JSON.stringify(probeR.result?.tools?.find((t) => t.name === 'sea_next') ?? {}).includes('wait_seconds');
await probe.close(); rmrf(probeHome);
const MODES = HAS_WAIT ? ['poll', 'wait'] : ['poll'];
const rows = [];
for (const mode of MODES) for (let rep = 1; rep <= REPS; rep++) { const r = await run(mode, rep); rows.push(r); console.error(`[S15] ${mode} #${rep}: wall ${r.wall_s}s last-release ${r.last_release_s}s left ${r.left} A ${r.done.A.join(',')} B ${r.done.B.join(',')} gave_up A ${r.gave_up.A} B ${r.gave_up.B} calls ${r.calls} turns ${r.turns} gaps ${r.gaps_s.join('/')}`); }
const agg = (mode) => {
  const rs = rows.filter((r) => r.mode === mode);
  const gaps = rs.flatMap((r) => r.gaps_s);
  return {
    mode, n: rs.length, wall_s: +mean(rs.map((r) => r.wall_s)).toFixed(2), last_release_s: +mean(rs.map((r) => r.last_release_s)).toFixed(2),
    left: rs.map((r) => r.left), done_A: mean(rs.map((r) => r.done.A.length)), done_B: mean(rs.map((r) => r.done.B.length)),
    gave_up: rs.filter((r) => r.gave_up.A || r.gave_up.B).length, calls: mean(rs.map((r) => r.calls)), turns: mean(rs.map((r) => r.turns)),
    gap_mean_s: gaps.length ? +mean(gaps).toFixed(3) : null, gap_max_s: gaps.length ? +Math.max(...gaps).toFixed(3) : null,
  };
};
const summary = { scenario: 'S15', title: 'Contention: wait_seconds vs sleep-and-retry (Track B T3 pattern)', tool: SEA_TOOL, cli: path.relative(process.cwd(), SEA_CLI), has_wait_seconds: HAS_WAIT, params: { W, T, P, RETRIES, scope: SCOPE, tickets: TICKETS.map((t) => t.id), reps: REPS }, poll: agg('poll'), wait: HAS_WAIT ? agg('wait') : null, runs: rows };
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'S15.json'), JSON.stringify(summary, null, 1));
const md = [
  `### S15 — Contention: \`wait_seconds\` vs sleep-and-retry (Track B T3 pattern, ${SEA_TOOL})`, '',
  `Two scripted agents, 4 tickets whose scopes all overlap (each names its file + CHANGELOG.md), ${REPS} repetitions per mode. Time compressed: work ${W} s per ticket, ${T} s per model turn, retry sleep ${P} s (T3's \`sleep 20\`), ${RETRIES} retries; wait mode passes \`wait_seconds: ${RETRIES * P}\` (the same patience). Deterministic scripts; wall times are real.`, '',
  '| mode | wall s (all done or stopped) | last release s | tickets left | done A / B | runs where an agent gave up | tool calls | model turns | release→next claim gap (mean / max s) |',
  '|---|---|---|---|---|---|---|---|---|',
  ...MODES.map((m) => { const a = summary[m]; return `| ${m === 'poll' ? 'sleep + retry (T3 instruction)' : '`wait_seconds`'} | ${a.wall_s} | ${a.last_release_s} | ${a.left.join('/')} | ${a.done_A} / ${a.done_B} | ${a.gave_up}/${a.n} | ${a.calls} | ${a.turns} | ${a.gap_mean_s} / ${a.gap_max_s} |`; }),
  ...(HAS_WAIT ? [] : ['| `wait_seconds` | not available in this build (no `wait_seconds` on `sea_next`) | | | | | | | |']),
  '',
];
fs.writeFileSync(path.join(OUT, 'S15.md'), md.join('\n'));
console.log(md.join('\n'));
