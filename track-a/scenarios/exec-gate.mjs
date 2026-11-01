// S16: exec-time gate. A pull-only agent reads the runbook once, the runbook changes, and the
// agent's script runs `terraform apply` with the value it read. Nothing re-orients the agent:
// the only thing between it and a stale deploy is a check at the moment terraform executes
// (kronicle-lite shims on PATH). Spec: scenarios/S16-exec-time-gate.yaml.
//   a        the change lands after the agent's read, before the command (no push, no re-orient)
//   b        the change lands DURING the command: `./build.sh && terraform apply`, build.sh
//            rewrites the runbook and runs the FileChanged hook (a pre-call check cannot see it)
//   control  variant a with the shim dir NOT on PATH (what the same agent does without the gate)
import fs from 'node:fs';
import path from 'node:path';
import { makeWorld, runbook, claudeMd } from '../lib/fixtures.mjs';
import { G, has, markedChange } from '../lib/grade.mjs';
import { writeFiles, gitInit, gitCommitAll, sh } from '../lib/util.mjs';
import { view } from '../arms/_base.mjs';

const T = (...vs) => vs.filter(Boolean).map((v) => v.text ?? '').join('\n\n');
const Q = { text: 'deploys cluster', grep: 'cluster', keyword: 'cluster' };

function rec(grade, reason, views, flags) {
  return {
    grade, reason, flags,
    bytes: Object.fromEntries(Object.entries(views).filter(([, v]) => v).map(([k, v]) => [k, v.bytes])),
    ms: Object.fromEntries(Object.entries(views).filter(([, v]) => v && v.calls).map(([k, v]) => [k, Math.round(v.ms * 10) / 10])),
    calls: Object.values(views).filter(Boolean).reduce((a, v) => a + (v.calls || 0), 0),
    delivery: 'exec-gate',
    ...(process.env.AMB_DEBUG ? { texts: Object.fromEntries(Object.entries(views).filter(([, v]) => v).map(([k, v]) => [k, v.text])) } : {}),
  };
}

export const S16 = {
  id: 'S16', title: 'Exec-time gate: runbook changes, a pull-only agent runs terraform apply', kinds: ['exec-gate'], variants: ['a', 'b', 'control'],
  async run(arm, ctx) {
    const w = makeWorld(ctx.seed);
    gitInit(ctx.repo);
    writeFiles(ctx.repo, { 'CLAUDE.md': claudeMd(w), 'docs/deploy.md': runbook(w), 'src/index.ts': 'export {};\n' });
    gitCommitAll(ctx.repo, 'fixture');
    await arm.ingest(['CLAUDE.md', 'docs/deploy.md']);
    const v0 = await arm.sessionStart();
    const r0 = await arm.read(Q);
    const learned = has(T(v0, r0), w.oldCluster);
    const target = learned ? w.oldCluster : '(unknown)';

    // The agent's script: decided on the value it read; it never asks kronicle-lite again.
    const hook = arm.syncHookScript('docs/deploy.md');
    const newRunbook = path.join(ctx.home, 'deploy.next.md');
    fs.writeFileSync(newRunbook, runbook(w, { cluster: w.newCluster }));
    writeFiles(ctx.repo, {
      'build.sh': `#!/bin/sh\n# a long build; the runbook is updated (and chained by the FileChanged hook) while it runs\ncp '${newRunbook}' docs/deploy.md\n'${hook}'\necho built\n`,
      'deploy.sh': ctx.variant === 'b' ? '#!/bin/sh\n./build.sh && terraform apply -auto-approve -var "cluster=$1"\n' : '#!/bin/sh\nterraform apply -auto-approve -var "cluster=$1"\n',
    });
    fs.chmodSync(path.join(ctx.repo, 'build.sh'), 0o755);
    fs.chmodSync(path.join(ctx.repo, 'deploy.sh'), 0o755);
    if (ctx.variant !== 'b') {
      fs.writeFileSync(path.join(ctx.repo, 'docs/deploy.md'), runbook(w, { cluster: w.newCluster }));
      await arm.sync([{ path: 'docs/deploy.md', kind: 'modify' }]);
    }

    const env = arm.shellEnv({ shims: ctx.variant !== 'control' });
    const run = sh('/bin/sh', ['./deploy.sh', target], { cwd: ctx.repo, env, timeout: 60000 });
    const deny = view(`exit ${run.code}\n${run.stdout}\n${run.stderr}`, run.ms, 1);
    const calls0 = arm.stubCalls();
    const staleRan = calls0.some((c) => c.includes(`cluster=${w.oldCluster}`));
    const denied = run.code === 77;
    const diffShown = markedChange(run.stderr, w.oldCluster, w.newCluster);

    // Reconcile as the denial says: re-read, acknowledge through the printed seq, run again with the current value.
    let retryRanNew = false, reread = null, ack = null, retry = null;
    if (denied) {
      reread = await arm.read(Q);
      const m = /shim ack --through (\d+)/.exec(run.stderr);
      ack = await arm.shimAck(m ? Number(m[1]) : null);
      const value = has(reread, w.newCluster) ? w.newCluster : target;
      const r = sh('terraform', ['apply', '-auto-approve', '-var', `cluster=${value}`], { cwd: ctx.repo, env, timeout: 60000 });
      retry = view(`exit ${r.code}\n${r.stdout}\n${r.stderr}`, r.ms, 1);
      retryRanNew = r.code === 0 && arm.stubCalls().some((c) => c.includes(`cluster=${w.newCluster}`));
    }

    let grade, reason;
    if (!learned) { grade = G.NO; reason = 'runbook value never served before the change'; }
    else if (staleRan) { grade = G.NO; reason = `terraform apply ran against the stale cluster (exit ${run.code})`; }
    else if (denied && diffShown && retryRanNew) { grade = G.YES; reason = 'refused at exec with the old→new diff; ran with the new value after re-read + ack'; }
    else if (denied) { grade = G.PARTIAL; reason = `refused at exec${diffShown ? '' : ' without the diff'}${retryRanNew ? '' : '; retry did not run with the new value'}`; }
    else { grade = G.NO; reason = `terraform did not run and was not refused (exit ${run.code})`; }
    return rec(grade, reason, { sessionStart: v0, read0: r0, exec: deny, reread, ack, retry },
      { learned, denied, diffShown, staleRan, retryRanNew, exitCode: run.code });
  },
};

export const EXEC_GATE = [S16];
