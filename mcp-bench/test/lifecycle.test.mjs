// Process lifecycle: no orphans after an attempt, a signalled runner, or a SIGKILLed runner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, FAKE, tmpdir, makeTask } from './helpers.mjs';

const CLI = path.join(ROOT, 'bin', 'mcp-bench.mjs');
process.env.FAKE_SECRET ||= 'not-a-real-secret-0123456789';
// why: a killed orphan re-parented to an init that does not reap stays a zombie; zombies are dead.
const alive = (pid) => {
  try { process.kill(pid, 0); } catch { return false; }
  try { return !/^\d+ \(.*\) Z/.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return true; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 10000) { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(50); } return false; }

test('a background child the agent left behind is killed when the agent exits', () => {
  const d = tmpdir(); const out = path.join(d, 'out'); const pidf = path.join(d, 'orphan.pid');
  const task = makeTask(d, { arms: { a: { env: { FAKE_CLAUDE_MODE: 'orphan', FAKE_ORPHAN_PID_FILE: pidf } } } });
  const r = spawnSync(process.execPath, [CLI, 'run', task, '--n', '1', '--max-total-usd', '1', '--out', out, '--claude-bin', FAKE], { encoding: 'utf8', env: { ...process.env, CLEANUP_LOG: path.join(d, 'c.log') }, timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  const pid = Number(fs.readFileSync(pidf, 'utf8'));
  assert.ok(!alive(pid), `orphan ${pid} still running`);
});

test('the verifier never sees the isolated HOME (claude config, logs) in the run dir', () => {
  const d = tmpdir(); const out = path.join(d, 'out'); const vlog = path.join(d, 'v.log');
  const task = makeTask(d, { arms: { a: {} } });
  spawnSync(process.execPath, [CLI, 'run', task, '--n', '1', '--max-total-usd', '1', '--out', out, '--claude-bin', FAKE], { env: { ...process.env, CLEANUP_LOG: path.join(d, 'c.log'), VERIFY_LOG: vlog } });
  assert.doesNotMatch(fs.readFileSync(vlog, 'utf8'), /\bhome\b/);
});

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  test(`${sig} to the runner kills the agent group, runs cleanup, writes results and exits non-zero`, async () => {
    const d = tmpdir(); const out = path.join(d, 'out'); const pidf = path.join(d, 'agent.pid'); const clog = path.join(d, 'c.log');
    const task = makeTask(d, { timeout_sec: 120, arms: { a: { env: { FAKE_CLAUDE_MODE: 'hang', FAKE_PID_FILE: pidf } } } });
    const p = spawn(process.execPath, [CLI, 'run', task, '--n', '3', '--max-total-usd', '1', '--out', out, '--claude-bin', FAKE], { env: { ...process.env, CLEANUP_LOG: clog }, stdio: 'ignore' });
    const exited = new Promise((r) => p.on('exit', (code, s) => r({ code, s })));
    assert.ok(await waitFor(() => fs.existsSync(pidf) && fs.readFileSync(pidf, 'utf8')), 'agent started');
    const agent = Number(fs.readFileSync(pidf, 'utf8'));
    p.kill(sig);
    const e = await Promise.race([exited, sleep(15000).then(() => null)]);
    assert.ok(e, 'runner exited');
    assert.equal(e.code, 130);
    assert.ok(await waitFor(() => !alive(agent), 3000), 'agent killed');
    assert.equal(fs.readFileSync(clog, 'utf8').trim().split('\n').length, 1, 'cleanup ran once');
    const t = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8')).tasks[0];
    assert.match(t.stopped, /interrupted/);
    assert.equal(t.records.length, 1);
    assert.equal(t.records[0].status, 'interrupted');
    assert.equal(t.models.haiku.arms.a.attempts, 0, 'an interrupted attempt is not an agent failure');
  });
}

test('SIGKILL of the runner still takes the agent process group down', async () => {
  const d = tmpdir(); const out = path.join(d, 'out'); const pidf = path.join(d, 'agent.pid');
  const task = makeTask(d, { timeout_sec: 120, cleanup: undefined, arms: { a: { env: { FAKE_CLAUDE_MODE: 'hang', FAKE_PID_FILE: pidf } } } });
  const p = spawn(process.execPath, [CLI, 'run', task, '--n', '1', '--max-total-usd', '1', '--out', out, '--claude-bin', FAKE], { stdio: 'ignore' });
  assert.ok(await waitFor(() => fs.existsSync(pidf) && fs.readFileSync(pidf, 'utf8')));
  const agent = Number(fs.readFileSync(pidf, 'utf8'));
  p.kill('SIGKILL');
  assert.ok(await waitFor(() => !alive(agent), 5000), `agent ${agent} orphaned after runner SIGKILL`);
});

test('an interrupt while the verifier runs is interrupted, not a verifier_error', async () => {
  const d = tmpdir(); const out = path.join(d, 'out'); const pidf = path.join(d, 'verifier.pid'); const clog = path.join(d, 'c.log');
  const task = makeTask(d, { verifier: `echo $$ > ${JSON.stringify(pidf)}; sleep 30; echo '{"pass":true}'`, arms: { a: {} } });
  const p = spawn(process.execPath, [CLI, 'run', task, '--n', '2', '--max-total-usd', '1', '--out', out, '--claude-bin', FAKE], { env: { ...process.env, CLEANUP_LOG: clog }, stdio: 'ignore' });
  const exited = new Promise((r) => p.on('exit', (code) => r(code)));
  assert.ok(await waitFor(() => fs.existsSync(pidf) && fs.readFileSync(pidf, 'utf8')), 'verifier started');
  p.kill('SIGINT');
  assert.equal(await Promise.race([exited, sleep(15000).then(() => null)]), 130);
  const t = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8')).tasks[0];
  assert.equal(t.records.length, 1);
  assert.equal(t.records[0].status, 'interrupted');
  assert.equal(t.models.haiku.arms.a.attempts, 0, 'not counted as a failure');
  assert.equal(t.models.haiku.arms.a.verifier_errors, 0);
  assert.equal(fs.readFileSync(clog, 'utf8').trim().split('\n').length, 1, 'cleanup ran');
});

test('#9: cleanup skipped by a runner SIGKILL is journaled and replayed by `cleanup` and by the next run', async () => {
  const d = tmpdir(); const out = path.join(d, 'out'); const pidf = path.join(d, 'agent.pid'); const clog = path.join(d, 'c.log');
  const cleanup = 'echo "$BENCH_RUN_TAG $FAKE_SECRET" >> "$CLEANUP_LOG"; echo "cleanup saw $FAKE_SECRET" >&2';
  const env = { ...process.env, CLEANUP_LOG: clog };
  const task = makeTask(d, { timeout_sec: 120, cleanup, arms: { a: { env: { FAKE_CLAUDE_MODE: 'hang', FAKE_PID_FILE: pidf } } } });
  const p = spawn(process.execPath, [CLI, 'run', task, '--n', '1', '--max-total-usd', '1', '--out', out, '--claude-bin', FAKE], { env, stdio: 'ignore' });
  assert.ok(await waitFor(() => fs.existsSync(pidf) && fs.readFileSync(pidf, 'utf8')));
  p.kill('SIGKILL');
  await new Promise((r) => p.on('exit', r));
  assert.ok(!fs.existsSync(clog), 'cleanup did not run');
  const journal = path.join(out, 'runs', fs.readdirSync(path.join(out, 'runs'))[0], 'CLEANUP_PENDING.json');
  assert.ok(fs.existsSync(journal), 'pending cleanup journaled');
  const jtext = fs.readFileSync(journal, 'utf8');
  assert.ok(!jtext.includes(process.env.FAKE_SECRET), 'no secret value in the journal');
  const j = JSON.parse(jtext);
  assert.ok(!('cleanup' in j) && !('task_dir' in j) && !('env' in j), 'journal holds no command, directory or env');
  const oldTag = j.run_tag;
  assert.match(oldTag, /^mcpbench-fake-task-a-t0-[0-9a-f]{6}-[0-9a-f]{8}$/);

  assert.equal(spawnSync(process.execPath, [CLI, 'cleanup', out], { env }).status, 2, 'cleanup needs the task spec');
  const c1 = spawnSync(process.execPath, [CLI, 'cleanup', out, '--task', task], { env, encoding: 'utf8' });
  assert.equal(c1.status, 0, c1.stderr);
  assert.ok(!(c1.stdout + c1.stderr).includes(process.env.FAKE_SECRET), 'replay output redacted');
  assert.equal(fs.readFileSync(clog, 'utf8'), `${oldTag} ${process.env.FAKE_SECRET}\n`, 'replayed once with the original tag');
  assert.ok(!fs.existsSync(journal), 'journal removed after a successful cleanup');
  assert.equal(spawnSync(process.execPath, [CLI, 'cleanup', out, '--task', task], { env }).status, 0);
  assert.equal(fs.readFileSync(clog, 'utf8').split('\n').filter(Boolean).length, 1, 'second replay is a no-op');

  // kill again, then a normal run into the same --out replays the leftover before its own attempts
  fs.rmSync(clog); fs.rmSync(pidf);
  const p2 = spawn(process.execPath, [CLI, 'run', task, '--n', '1', '--max-total-usd', '1', '--out', out, '--claude-bin', FAKE], { env, stdio: 'ignore' });
  assert.ok(await waitFor(() => fs.existsSync(pidf) && fs.readFileSync(pidf, 'utf8')));
  p2.kill('SIGKILL');
  await new Promise((r) => p2.on('exit', r));
  const tag2 = JSON.parse(fs.readFileSync(journal, 'utf8')).run_tag;
  assert.notEqual(tag2, oldTag, 'same seed, new tag');
  makeTask(d, { cleanup, arms: { a: {} } });
  const r = spawnSync(process.execPath, [CLI, 'run', task, '--n', '1', '--max-total-usd', '1', '--out', out, '--claude-bin', FAKE], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const lines = fs.readFileSync(clog, 'utf8').trim().split('\n').map((l) => l.split(' ')[0]);
  assert.equal(lines[0], tag2, 'leftover replayed first');
  assert.equal(lines.length, 2);
  const res = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8'));
  assert.equal(res.tasks[0].records[0].status, 'verified');
  assert.equal(lines[1], res.tasks[0].records[0].run_tag);
  assert.match(res.run_nonce, /^[0-9a-f]{8}$/);
  assert.equal(res.cleanups_replayed, 1);
});

test('a cleanup journal the agent plants never runs its own command or env; replay uses the spec', () => {
  const d = tmpdir(); const out = path.join(d, 'out'); const marker = path.join(d, 'PWNED'); const clog = path.join(d, 'c.log');
  const evil = `touch ${JSON.stringify(marker)}`;
  const j = (o) => ({ task_id: 'fake-task', run_tag: 'mcpbench-fake-task-a-t9-abcdef-0123abcd', arm: 'a', trial: 9, model: 'haiku', cleanup: evil, task_dir: d, env: { BENCH_RUN_DIR: '/' }, ...o });
  const plant = [
    { dir: 'evil', journal: j() }, // run dir does not match the journal's fields
    { dir: 'other-task__haiku__a__t9', journal: j({ task_id: 'other-task', run_tag: 'mcpbench-other-task-a-t9-abcdef-0123abcd' }) }, // not a loaded spec
    { dir: 'fake-task__haiku__a__t9', journal: j({ run_tag: `mcpbench-fake-task-a-t9-abcdef-0123abcd; ${evil}` }) }, // tag not in the generated format
    { dir: 'fake-task__haiku__a__t8', journal: j({ trial: 8, run_tag: 'mcpbench-fake-task-a-t8-abcdef-0123abcd' }) }, // well-formed: the spec's cleanup runs
  ];
  const task = makeTask(d, { cleanup: 'echo "$BENCH_RUN_TAG $BENCH_RUN_DIR" >> "$CLEANUP_LOG"', arms: { a: { env: { FAKE_PLANT_JSON: JSON.stringify(plant) } } } });
  const env = { ...process.env, CLEANUP_LOG: clog };
  const run = () => spawnSync(process.execPath, [CLI, 'run', task, '--n', '1', '--max-total-usd', '1', '--out', out, '--claude-bin', FAKE], { env, encoding: 'utf8' });
  assert.equal(run().status, 0);
  for (const p of plant) assert.ok(fs.existsSync(path.join(out, 'runs', p.dir, 'CLEANUP_PENDING.json')), `${p.dir} planted`);
  fs.rmSync(clog);
  const c = spawnSync(process.execPath, [CLI, 'cleanup', out, '--task', task], { env, encoding: 'utf8' });
  assert.equal(c.status, 1, 'skipped journals are reported as a failure');
  assert.match(c.stdout, /1 pending cleanup\(s\) replayed, 0 failed, 3 skipped/);
  assert.equal(fs.readFileSync(clog, 'utf8'), `mcpbench-fake-task-a-t8-abcdef-0123abcd ${path.join(out, 'runs', 'fake-task__haiku__a__t8')}\n`, 'spec cleanup, harness-computed run dir');
  const r2 = run();
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8')).cleanups_skipped, 3);
  assert.ok(!fs.existsSync(marker), 'planted command never executed');
});
