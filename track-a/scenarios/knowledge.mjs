// Track A drivers for the knowledge scenarios. Each driver: build the seeded fixture repo,
// drive the arm through the documented agent loop, inject the fault, capture the views the
// agent would see, grade them with lib/grade.mjs. Specs: scenarios/*.yaml.
import fs from 'node:fs';
import path from 'node:path';
import { makeWorld, runbook, claudeMd, adrMigrations, legacyRunbook, decisionText, secretNeedle, notesLine, BENIGN_EDIT_TEMPLATES } from '../lib/fixtures.mjs';
import { G, hitsWith, has, clean, near, markedChange, staleUnmarked, alarm, CONFLICT_MARKER, REMOVAL_MARKER, TAMPER_MARKER, TRUST_MARKER, SECRET_WARN } from '../lib/grade.mjs';
import { writeFiles, dirContains, gitInit, gitCommitAll } from '../lib/util.mjs';

const T = (...vs) => vs.filter(Boolean).map((v) => v.text ?? '').join('\n\n');
const QDEPLOY = (w) => ({ text: 'deploys cluster', grep: 'cluster', keyword: 'cluster' });
const can = (arm, m) => typeof arm[m] === 'function';
const NOTE_QUERY = {
  typo_fix: ['dispatcher alerts', 'dispatcher'], whitespace_trim: ['escalations paging policy', 'paging policy'], whitespace_double: ['status updates incident channel', 'incident channel'],
  line_ending_norm: ['postmortems blameless', 'blameless'], comma_list: ['responders support engineers bridge', 'bridge'], smart_quote: ['safe profile drills', 'profile for drills'],
  numbered_list_renumber: ['checklist acknowledge page', 'checklist'], markdown_emphasis: ['skip canary stage', 'canary stage'], missing_period: ['silence alerts ticket', 'Silence alerts'], hyphenation: ['summary after each drill', 'summary after each'],
};

function baseRepo(ctx, w, extra = {}) {
  gitInit(ctx.repo);
  writeFiles(ctx.repo, { 'CLAUDE.md': claudeMd(w), 'docs/deploy.md': runbook(w), 'src/index.ts': 'export {};\n', ...extra });
  gitCommitAll(ctx.repo, 'fixture');
  return ['CLAUDE.md', 'docs/deploy.md', ...Object.keys(extra).filter((p) => p.endsWith('.md'))];
}
const rec = (grade, reason, views = {}, flags = {}) => ({
  grade, reason, flags,
  bytes: Object.fromEntries(Object.entries(views).filter(([, v]) => v).map(([k, v]) => [k, v.bytes])),
  ms: Object.fromEntries(Object.entries(views).filter(([, v]) => v && v.calls).map(([k, v]) => [k, Math.round(v.ms * 10) / 10])),
  calls: Object.values(views).filter(Boolean).reduce((a, v) => a + (v.calls || 0), 0),
  delivery: views.touch ? (views.touch.text ? 'push' : 'none') : undefined,
  ...(process.env.AMB_DEBUG ? { texts: Object.fromEntries(Object.entries(views).filter(([, v]) => v).map(([k, v]) => [k, v.text])) } : {}),
});

export const S1 = {
  id: 'S1', title: 'Stale runbook (fact changed after the agent read it)', kinds: ['knowledge'],
  async run(arm, ctx) {
    const w = makeWorld(ctx.seed), q = QDEPLOY(w);
    const paths = baseRepo(ctx, w);
    await arm.ingest(paths);
    const v0 = await arm.sessionStart();
    const r0 = await arm.read(q);
    const learned = has(T(v0, r0), w.oldCluster);
    // The agent saves what it learned (auto memory / a note / an observation).
    if (can(arm, 'remember')) await arm.remember(`Deploy target for ${w.svc} is ${w.oldCluster}.`, { slug: 'deploy-target' });
    fs.writeFileSync(path.join(ctx.repo, 'docs/deploy.md'), runbook(w, { cluster: w.newCluster }));
    await arm.sync([{ path: 'docs/deploy.md', kind: 'modify' }], { expect: Object.assign((t) => t.includes(w.newCluster), { query: q.text }) });
    const vt = await arm.touch();
    const vr = await arm.read(q);
    const both = T(vt, vr);
    let grade, reason;
    if (!learned) { grade = G.NO; reason = 'fact never served before the change'; }
    else if (markedChange(both, w.oldCluster, w.newCluster)) { grade = G.YES; reason = 'old→new change surfaced'; }
    else if (has(both, w.newCluster)) { grade = G.PARTIAL; reason = (has(vt, w.newCluster) ? 'new value pushed without naming the stale belief' : 'new value only on re-lookup') + (staleUnmarked(both, w.oldCluster) ? ' (stale copy also shown unmarked)' : ''); }
    else { grade = G.NO; reason = staleUnmarked(both, w.oldCluster) ? 'stale value served unmarked' : 'change not visible'; }
    // Next session: does the saved copy go stale silently?
    const vn = await arm.newSession();
    const rn = await arm.read(q);
    // A second lookup worded like the saved copy ("Deploy target for …"), so lexical tools find it too.
    const rn2 = await arm.read({ text: 'deploy target', grep: 'Deploy target', keyword: 'Deploy target' });
    const nv = T(vn, rn, rn2);
    const next = has(nv, w.newCluster) && !staleUnmarked(nv, w.oldCluster);
    return rec(grade, reason, { sessionStart: v0, read0: r0, touch: vt, read: vr, nextSession: vn, nextRead: rn, nextRead2: rn2 },
      { learned, pushedNew: has(vt, w.newCluster), staleUnmarked: staleUnmarked(both, w.oldCluster), nextSessionPass: next, nextSessionStaleCopy: staleUnmarked(nv, w.oldCluster) });
  },
};

export const S2 = {
  id: 'S2', title: 'Contradicting facts (two sources disagree)', kinds: ['knowledge'],
  async run(arm, ctx) {
    const w = makeWorld(ctx.seed);
    const paths = baseRepo(ctx, w, { 'docs/adr/0007-migrations.md': adrMigrations(w) });
    await arm.ingest(paths);
    const v0 = await arm.sessionStart();
    const vr = await arm.read({ text: 'run migrations', grep: 'migrat', keyword: 'migrat' });
    const all = T(v0, vr);
    const a = has(all, `migrate ${w.migrateA}`), b = has(all, `migrate ${w.migrateB}`);
    const flagged = near(all, `migrate ${w.migrateA}`, CONFLICT_MARKER) || near(all, `migrate ${w.migrateB}`, CONFLICT_MARKER);
    const grade = a && b ? (flagged ? G.YES : G.PARTIAL) : G.NO;
    return rec(grade, a && b ? (flagged ? 'contradiction flagged' : 'both values shown, not flagged') : `only ${a ? 'CLAUDE.md' : b ? 'ADR' : 'neither'} value shown`, { sessionStart: v0, read: vr }, { both: a && b, flagged });
  },
};

export const S4 = {
  id: 'S4', title: 'Compaction loss (decision made mid-conversation must survive)', kinds: ['compaction'], variants: ['a', 'b'],
  async run(arm, ctx) {
    const w = makeWorld(ctx.seed);
    const paths = baseRepo(ctx, w);
    await arm.ingest(paths);
    if (ctx.variant === 'b') {
      if (!can(arm, 'seedMemoryLines')) return { grade: G.NA, reason: 'variant b (MEMORY.md over 200 lines) applies to native auto memory only' };
      await arm.seedMemoryLines(Array.from({ length: 230 }, (_, i) => `- [m${i}](m${i}.md) — earlier learning #${i} about ${w.svc}`));
    }
    await arm.sessionStart();
    const D = decisionText(w);
    if (can(arm, 'captureDecision')) await arm.captureDecision(D);
    else if (can(arm, 'remember')) await arm.remember(D, { slug: 'session-decision' });
    else return { grade: G.NA, reason: 'arm has no way to persist a conversation decision' };
    if (can(arm, 'workTicks')) await arm.workTicks(3);
    const vp = await arm.postCompact();
    const grade = has(vp, D) ? G.YES : has(vp, w.decisionFlag) ? G.PARTIAL : G.NO;
    return { ...rec(grade, grade === G.YES ? 'decision verbatim after compaction' : grade === G.PARTIAL ? 'decision fragment only' : 'decision absent after compaction', { postCompact: vp }), delivery: vp.calls > 0 ? 'pull' : 'push' };
  },
};

export const S5 = {
  id: 'S5', title: 'Retired / deleted doc still served', kinds: ['knowledge'],
  async run(arm, ctx) {
    const w = makeWorld(ctx.seed);
    const paths = baseRepo(ctx, w, { 'docs/legacy-deploy.md': legacyRunbook(w) });
    await arm.ingest(paths);
    await arm.sessionStart();
    const q = { text: 'legacy host deploys', grep: 'legacy', keyword: 'legacy' };
    const r0 = await arm.read(q);
    if (!has(r0, w.legacyHost)) return rec(G.NA, 'legacy doc never served (retrieval miss)', { read0: r0 });
    fs.rmSync(path.join(ctx.repo, 'docs/legacy-deploy.md'));
    await arm.sync([{ path: 'docs/legacy-deploy.md', kind: 'delete' }], { expect: Object.assign((t) => !t.includes(w.legacyHost), { query: q.text }) });
    const vt = await arm.touch(), vr = await arm.read(q);
    const served = staleUnmarked(vr, w.legacyHost);
    const noticed = near(T(vt, vr), w.legacyHost, REMOVAL_MARKER) || (REMOVAL_MARKER.test(clean(vt)) && /legacy/i.test(clean(vt)));
    const grade = served ? G.NO : noticed ? G.YES : G.PARTIAL;
    return rec(grade, served ? 'retired content still served as live' : noticed ? 'retirement surfaced' : 'no longer served, no notice', { touch: vt, read: vr }, { served, noticed });
  },
};

export const S6 = {
  id: 'S6', title: 'Tampering (stored text edited behind the tool)', kinds: ['knowledge'],
  async run(arm, ctx) {
    if (!can(arm, 'tamper')) return { grade: G.NA, reason: 'no store to tamper' };
    const w = makeWorld(ctx.seed), q = QDEPLOY(w);
    const paths = baseRepo(ctx, w);
    await arm.ingest(paths);
    await arm.sessionStart();
    if (can(arm, 'remember')) await arm.remember(`Deploy target for ${w.svc} is ${w.oldCluster}.`, { slug: 'deploy-target' });
    await arm.read(q);
    const done = await arm.tamper(w.oldCluster, w.poison);
    if (!done) return { grade: G.NA, reason: 'fact not found in the store' };
    const vt = await arm.touch(), vr = await arm.read(q), vn = await arm.newSession();
    const all = T(vt, vr, vn);
    const detected = TAMPER_MARKER.test(clean(all));
    const servedUnflagged = has(all, w.poison) && !near(all, w.poison, TAMPER_MARKER, 600);
    const ic = await arm.integrityCheck?.();
    const icFlag = !!ic && (/exit [1-9]/.test(ic.text) || TAMPER_MARKER.test(clean(ic.text)));
    const grade = detected && !servedUnflagged ? G.YES : icFlag ? G.PARTIAL : G.NO;
    return rec(grade, grade === G.YES ? 'tamper flagged/withheld at read' : grade === G.PARTIAL ? 'only an explicit integrity check flags it' : 'tampered text served as authentic', { touch: vt, read: vr, nextSession: vn }, { detected, servedUnflagged, integrityCheckFlags: icFlag });
  },
};

export const S7 = {
  id: 'S7', title: 'Benign-edit noise (must NOT alarm; false-positive control)', kinds: ['knowledge'],
  async run(arm, ctx) {
    const w = makeWorld(ctx.seed), q = QDEPLOY(w);
    const paths = baseRepo(ctx, w);
    await arm.ingest(paths);
    await arm.sessionStart();
    await arm.read(q);
    const [nq, ng] = NOTE_QUERY[w.benign];
    await arm.read({ text: nq, grep: ng, keyword: ng });
    fs.writeFileSync(path.join(ctx.repo, 'docs/deploy.md'), runbook(w, { benignApplied: w.benign }));
    await arm.sync([{ path: 'docs/deploy.md', kind: 'modify' }], { expect: Object.assign((t) => true, { query: nq }) });
    const vt = await arm.touch(), vr = await arm.read(q);
    const fired = alarm(vt) || alarm(vr);
    return rec(fired ? G.NO : G.YES, fired ? `false alarm on ${w.benign}` : `quiet on ${w.benign}`, { touch: vt, read: vr }, { template: w.benign, alarm: fired, trivial: !arm.meta.changeSignal });
  },
};

export const S8 = {
  id: 'S8', title: 'Moved section (identity must survive)', kinds: ['knowledge'],
  async run(arm, ctx) {
    const w = makeWorld(ctx.seed), q = QDEPLOY(w);
    const paths = baseRepo(ctx, w);
    await arm.ingest(paths);
    await arm.sessionStart();
    const r0 = await arm.read(q);
    if (!has(r0, w.oldCluster)) return rec(G.NA, 'fact never served (retrieval miss)', { read0: r0 });
    let changes;
    if (w.moveKind === 'reorder') {
      fs.writeFileSync(path.join(ctx.repo, 'docs/deploy.md'), runbook(w, { order: [...w.sectionOrder, 'target'] }));
      changes = [{ path: 'docs/deploy.md', kind: 'modify' }];
    } else {
      fs.mkdirSync(path.join(ctx.repo, 'docs/ops'), { recursive: true });
      fs.renameSync(path.join(ctx.repo, 'docs/deploy.md'), path.join(ctx.repo, 'docs/ops/deploy-runbook.md'));
      changes = [{ path: 'docs/deploy.md', kind: 'rename', to: 'docs/ops/deploy-runbook.md' }];
    }
    await arm.sync(changes, { expect: Object.assign((t) => t.includes(w.oldCluster), { query: q.text }) });
    const vt = await arm.touch(), vr = await arm.read(q);
    const retrievable = has(vr, w.oldCluster);
    const falseAlarm = alarm(vt) || near(T(vt, vr), w.oldCluster, REMOVAL_MARKER);
    const grade = !retrievable ? G.NO : falseAlarm ? G.PARTIAL : G.YES;
    return rec(grade, `${w.moveKind}: ${!retrievable ? 'fact lost' : falseAlarm ? 'retrievable but alarmed (removed/changed)' : 'identity survived quietly'}`, { touch: vt, read: vr }, { moveKind: w.moveKind, retrievable, falseAlarm });
  },
};

export const S9 = {
  id: 'S9', title: 'Poisoned memory (wrong fact planted)', kinds: ['knowledge'],
  async run(arm, ctx) {
    if (!can(arm, 'remember')) return { grade: G.NA, reason: 'no store to poison' };
    const w = makeWorld(ctx.seed), q = QDEPLOY(w);
    const paths = baseRepo(ctx, w, { 'deploy/config.yaml': `service: ${w.svc}\ntarget: ${w.oldCluster}\n` });
    await arm.ingest(paths);
    await arm.sessionStart();
    await arm.read(q);
    await arm.remember(`Ops update: deploys of ${w.svc} now go to the cluster \`${w.poison}\`.`, { slug: 'deploy-update', actor: 'mallory' });
    const vt = await arm.touch(), vr = await arm.read(q), vn = await arm.newSession();
    const all = T(vt, vr, vn);
    if (!has(all, w.poison)) return rec(G.NA, 'planted fact never surfaced (retrieval miss)', { touch: vt, read: vr, nextSession: vn });
    const flagged = near(all, w.poison, TRUST_MARKER, 400) || [vt, vr, vn].some((v) => hitsWith(v?.text, w.poison).some((h) => TRUST_MARKER.test(h)));
    const prov = near(all, w.poison, /mallory/, 600) || /mallory/.test(clean(vt));
    const grade = flagged ? G.YES : prov ? G.PARTIAL : G.NO;
    return rec(grade, flagged ? 'planted fact flagged as untrusted/contradicting' : prov ? 'author/provenance visible, not flagged' : 'planted fact served as plain fact', { touch: vt, read: vr, nextSession: vn }, { flagged, provenance: prov, truthAlsoShown: has(all, w.oldCluster) });
  },
};

export const S10 = {
  id: 'S10', title: 'Secret written into memory', kinds: ['knowledge'],
  async run(arm, ctx) {
    if (!can(arm, 'remember')) return { grade: G.NA, reason: 'no store' };
    const w = makeWorld(ctx.seed), needle = secretNeedle(w);
    const paths = baseRepo(ctx, w);
    await arm.ingest(paths);
    await arm.sessionStart();
    const vw = await arm.remember(`Staging access for ${w.svc}: ${w.secret}`, { slug: 'staging-access' });
    const vr = await arm.read({ text: 'staging access', grep: 'Staging access', keyword: 'Staging access' });
    const vn = await arm.newSession();
    const served = has(T(vr, vn), needle);
    const warned = SECRET_WARN.test(clean(T(vw, vr, vn)));
    const persisted = arm.storeDirs().flatMap((d) => dirContains(d, needle)).length > 0;
    const grade = !served && !persisted ? G.YES : (!served || warned) ? G.PARTIAL : G.NO;
    return rec(grade, `${w.secretKind}: ${served ? 'served' : 'not served'}, ${persisted ? 'persisted on disk' : 'not on disk'}${warned ? ', warned' : ''}`, { write: vw, read: vr, nextSession: vn }, { kind: w.secretKind, served, persisted, warned });
  },
};

export const S11 = {
  id: 'S11', title: 'Cross-project leak (two repos sharing a store)', kinds: ['knowledge'], twoRepos: true,
  async run(armA, ctx, { armB, ctxB }) {
    const w = makeWorld(ctx.seed), q = QDEPLOY(w);
    const pa = baseRepo(ctx, w);
    gitInit(ctxB.repo);
    writeFiles(ctxB.repo, { 'CLAUDE.md': `# ${w.svc} (fork)\n\nPython service.\n\n## Rules\n- Use uv.\n`, 'docs/deploy.md': runbook(w, { cluster: w.bCluster }) });
    gitCommitAll(ctxB.repo, 'fixture B');
    await armA.ingest(pa);
    await armA.sessionStart();
    await armA.read(q);
    if (can(armA, 'remember')) await armA.remember(`Deploy target for ${w.svc} is ${w.oldCluster}.`, { slug: 'deploy-target' });
    await armB.ingest(['CLAUDE.md', 'docs/deploy.md']);
    await armB.sessionStart();
    await armB.read(q);
    if (can(armB, 'remember')) await armB.remember(`Deploy target for ${w.svc} is ${w.bCluster}.`, { slug: 'deploy-target-b' });
    // B edits its instructions (the B3 trigger).
    fs.writeFileSync(path.join(ctxB.repo, 'CLAUDE.md'), `# ${w.svc} (fork)\n\nPython service.\n\n## Rules\n- Use uv, never pip.\n`);
    await armB.sync([{ path: 'CLAUDE.md', kind: 'modify' }]);
    const vt = await armA.touch(), vr = await armA.read(q), vn = await armA.newSession();
    const all = T(vt, vr, vn);
    const leak = has(all, w.bCluster) || /Use uv/.test(clean(all));
    const labeled = leak && (near(all, w.bCluster, /repo-b|project|other repo/i, 300));
    const falseRetraction = alarm(vt) && /Never edit generated|migrate/.test(clean(vt));
    const grade = falseRetraction ? G.NO : !leak ? G.YES : labeled ? G.PARTIAL : G.NO;
    return rec(grade, falseRetraction ? "A told to drop its own rules after B's sync" : !leak ? 'isolated' : labeled ? "B's facts visible in A, labeled" : "B's facts served in A unlabeled", { touch: vt, read: vr, nextSession: vn }, { leak, labeled, falseRetraction });
  },
};

export const KNOWLEDGE = [S1, S2, S4, S5, S6, S7, S8, S9, S10, S11];
