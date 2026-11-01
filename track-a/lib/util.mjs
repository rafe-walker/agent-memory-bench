import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
export const ARMS_DIR = process.env.AMB_ARMS_DIR || path.join(ROOT, '.arms');
export const WORK_DIR = process.env.AMB_WORK_DIR || path.join(os.tmpdir(), 'amb-work');

let counter = 0;
export function tmpdir(tag = 'x') {
  fs.mkdirSync(WORK_DIR, { recursive: true });
  return fs.mkdtempSync(path.join(WORK_DIR, `${tag}-${process.pid}-${counter++}-`));
}
export function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch {} }

// Synchronous exec with timing. Returns {code, stdout, stderr, ms}.
export function sh(cmd, args, { cwd, env, input, timeout = 120000 } = {}) {
  const t0 = performance.now();
  const r = spawnSync(cmd, args, { cwd, env: env ?? process.env, input, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? (r.signal ? 128 : -1), stdout: r.stdout ?? '', stderr: (r.stderr ?? '') + (r.error ? String(r.error) : ''), ms: performance.now() - t0 };
}
// Async exec (for concurrent races).
export function shAsync(cmd, args, { cwd, env, input, timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const c = spawn(cmd, args, { cwd, env: env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => c.kill('SIGKILL'), timeout);
    c.stdout.on('data', (d) => (stdout += d)); c.stderr.on('data', (d) => (stderr += d));
    c.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, ms: performance.now() - t0 }); });
    if (input) c.stdin.write(input); c.stdin.end();
  });
}
export function writeFiles(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
}
export function gitInit(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const env = { ...process.env, GIT_AUTHOR_NAME: 'bench', GIT_AUTHOR_EMAIL: 'bench@example.test', GIT_COMMITTER_NAME: 'bench', GIT_COMMITTER_EMAIL: 'bench@example.test' };
  sh('git', ['init', '-q', '-b', 'main'], { cwd: dir, env });
  return env;
}
export function gitCommitAll(dir, msg = 'snapshot') {
  const env = { ...process.env, GIT_AUTHOR_NAME: 'bench', GIT_AUTHOR_EMAIL: 'bench@example.test', GIT_COMMITTER_NAME: 'bench', GIT_COMMITTER_EMAIL: 'bench@example.test' };
  sh('git', ['add', '-A'], { cwd: dir, env });
  sh('git', ['commit', '-q', '-m', msg, '--allow-empty'], { cwd: dir, env });
}
// Recursively search a directory's files for a byte string (used to check secret persistence).
export function dirContains(dir, needle) {
  const hits = [];
  const walk = (p) => {
    let st; try { st = fs.lstatSync(p); } catch { return; }
    if (st.isDirectory()) { for (const e of fs.readdirSync(p)) walk(path.join(p, e)); return; }
    if (!st.isFile() || st.size > 256 * 1024 * 1024) return;
    try { if (fs.readFileSync(p).includes(needle)) hits.push(p); } catch {}
  };
  walk(dir);
  return hits;
}
export const bytesOf = (s) => (s == null ? 0 : Buffer.byteLength(typeof s === 'string' ? s : JSON.stringify(s)));
export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
