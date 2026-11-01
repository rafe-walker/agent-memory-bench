// Track A drivers for coordination scenarios (S3 parallel collision, S11c cross-project claims,
// S13 lease expiry during a long task). Agents are separate client sessions / OS processes.
import path from 'node:path';
import { makeWorld } from '../lib/fixtures.mjs';
import { G } from '../lib/grade.mjs';
import { gitInit, gitCommitAll, writeFiles, sleep } from '../lib/util.mjs';

const can = (arm, m) => typeof arm[m] === 'function';
const TOLD = /claimed by|already claimed|already_claimed|conflict|holds|held_by|holder|reserved by|in use by/i;
function repo(ctx, w) { gitInit(ctx.repo); writeFiles(ctx.repo, { 'README.md': '# fixture\n', [`${w.authPath}/login.ts`]: 'export {};\n', [`${w.authPath}/session.ts`]: 'export {};\n' }); gitCommitAll(ctx.repo, 'fixture'); }
const out = (grade, reason, extra = {}) => ({ grade, reason, ...extra });

export const S3 = {
  id: 'S3', title: 'Parallel edit collision (two+ sessions, same file/path)', kinds: ['coordination'], variants: ['a', 'b', 'c', 'd'],
  ctxExtra: { c: { identity: 'default' } },
  variantTitles: { a: 'claim race (N=2..8 concurrent claimers, distinct identities)', b: 'edit guard (B edits inside A’s claimed path)', c: 'default identity (two sessions, out-of-the-box config)', d: 'concurrent create (N writers, unique IDs, nothing lost)' },
  async run(arm, ctx) {
    const w = makeWorld(ctx.seed);
    repo(ctx, w);
    const v = ctx.variant;
    if (!can(arm, 'claim')) {
      if (v === 'd') return out(G.NA, 'no shared store');
      return out(G.NO, 'no coordination mechanism: both sessions proceed');
    }
    if (v === 'a' || v === 'c') {
      const n = v === 'a' ? w.racers : 2;
      const { id } = await arm.createItem({ title: w.ticketTitle, paths: [w.authPath] });
      const t0 = performance.now();
      const rs = await Promise.all(Array.from({ length: n }, (_, i) => arm.claim(`agent-${i}`, { id, paths: [w.authPath] })));
      const ms = performance.now() - t0;
      const winners = rs.filter((r) => r.granted).length;
      const losers = rs.filter((r) => !r.granted);
      const told = losers.every((r) => TOLD.test(r.view.text));
      const advisory = rs.some((r) => r.granted && r.conflictReported);
      const grade = arm.meta.claims === false ? G.NO : winners === 1 && told ? G.YES : winners === 1 || advisory ? G.PARTIAL : G.NO;
      const reason = arm.meta.claims === false ? `no claim primitive: ${winners}/${n} status edits accepted, ${n - winners} failed without naming a holder` : winners === 1 ? (told ? 'exactly one winner; losers told who holds it' : 'one winner; losers not told the holder') : advisory ? `${winners}/${n} granted; conflict reported (advisory)` : `${winners}/${n} sessions all believe they hold it`;
      return out(grade, reason, { flags: { racers: n, winners, double_claim: winners > 1, advisory }, ms: { claim_race: Math.round(ms) }, bytes: { claim: Math.round(rs.reduce((a, r) => a + r.view.bytes, 0) / rs.length) } });
    }
    if (v === 'b') {
      const a = await arm.claimScope('agent-a', { title: w.ticketTitle, paths: [w.authPath] });
      if (a.scopeless) return out(G.NO, 'claims are per issue; no path scope or edit guard');
      if (!can(arm, 'tryEdit')) return out(G.NO, 'no edit/commit guard: the overlapping edit goes through');
      const e = await arm.tryEdit('agent-b', `${w.authPath}/login.ts`);
      const named = /agent-a|GreenCastle|holds|held by|reserved/i.test(e.view.text);
      const grade = !e.allowed ? (e.stage === 'edit' ? (named ? G.YES : G.PARTIAL) : G.PARTIAL) : G.NO;
      return out(grade, !e.allowed ? `blocked at ${e.stage}${named ? ', holder named' : ''}` : `edit allowed${e.guardInstalled === false ? ' (guard install failed)' : ''}`, { flags: { blocked: !e.allowed, stage: e.stage }, ms: { guard: Math.round(e.view.ms) }, bytes: { guard: e.view.bytes } });
    }
    if (v === 'd') {
      if (!can(arm, 'concurrentCreate')) return out(G.NA, 'no item store');
      const n = Math.max(3, w.racers);
      const r = await arm.concurrentCreate(n);
      const uniq = new Set(r.ids).size;
      const ok = r.ids.length === n && uniq === n && r.present === n;
      return out(ok ? G.YES : G.NO, ok ? `${n} concurrent creates, ${n} unique, all present` : `${n} writers: ${r.ids.length} reported, ${uniq} unique ids, ${r.present} present, ${r.errors} errors`, { flags: { writers: n, lost_or_dup: !ok, duplicate_ids: uniq < r.ids.length } });
    }
  },
};

export const S11c = {
  id: 'S11c', title: 'Cross-project leak, coordination (two repos, default store)', kinds: ['coordination'], twoRepos: true,
  async run(armA, ctx, { armB, ctxB }) {
    const w = makeWorld(ctx.seed);
    repo(ctx, w); repo(ctxB, w);
    if (!can(armA, 'claimScope')) return out(G.NA, 'no claims');
    const b = await armB.claimScope('agent-b', { title: w.bTicketTitle, paths: [w.authPath] });
    const a = await armA.claimScope('agent-a', { title: w.ticketTitle, paths: [w.authPath] });
    const falseConflict = !a.granted || a.conflictReported;
    const leakedTitle = a.view.text.includes(w.bTicketTitle);
    return out(falseConflict || leakedTitle ? G.NO : G.YES, falseConflict ? "A blocked by repo B's claim on the same relative path" : leakedTitle ? "repo B's ticket shown in A" : 'isolated', { flags: { falseConflict, leakedTitle, bGranted: b.granted } });
  },
};

export const S13 = {
  id: 'S13', title: 'Lease expiry during a long task', kinds: ['coordination'],
  async run(arm, ctx) {
    const w = makeWorld(ctx.seed);
    repo(ctx, w);
    const L = ctx.ci ? (arm.meta.s13 && { ...arm.meta.s13, lease: Math.min(arm.meta.s13.lease, 3), duration: Math.min(arm.meta.s13.duration, 7) }) : arm.meta.s13;
    if (!L) return out(G.NA, arm.meta.claims ? 'no lease: claims never expire' : 'no claims');
    ctx.heartbeatInterval = L.heartbeat;
    const { id } = await arm.createItem({ title: w.ticketTitle, paths: [w.authPath] });
    const a = await arm.claim('agent-a', { id, paths: [w.authPath], lease: L.lease });
    if (!a.granted) return out('error', `A could not claim: ${a.view.text.slice(0, 200)}`);
    const t0 = Date.now();
    while (Date.now() - t0 < L.duration * 1000) { await arm.tick?.('agent-a'); await sleep(L.tickMs ?? 1000); }
    await sleep(1500); // let a background heartbeat land
    const b = await arm.claim('agent-b', { id, paths: [w.authPath], lease: L.lease });
    if (!b.granted && !b.conflictReported) return out(G.YES, `claim held through ${L.duration}s of work (lease ${L.lease}s)`, { flags: { lease_s: L.lease, task_s: L.duration, lost: false } });
    const hw = await arm.holderWrite('agent-a', { id, token: a.token });
    const told = !hw.ok;
    return out(told ? G.PARTIAL : G.NO, told ? 'lease lapsed mid-task; B took it; A learns only on its next write' : 'lease lapsed mid-task; B took it; A not told', { flags: { lease_s: L.lease, task_s: L.duration, lost: true, holderTold: told } });
  },
};

export const COORDINATION = [S3, S11c, S13];
