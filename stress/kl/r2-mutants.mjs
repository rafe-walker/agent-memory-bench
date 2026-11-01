#!/usr/bin/env node
// Round 2: source-level mutation testing of kronicle-lite's classifier / lineage / retraction / parser rules
// against the repo's own vitest suites. Each mutant is one or more LITERAL string replacements on a copy of the
// checkout (src/ + test/). SURVIVED = the suite still passes = a test gap (not a product bug by itself).
// HOME and KRONICLE_LITE_DATA_DIR are pinned to temp paths for every child.
// usage: KL=<kl checkout with node_modules> node stress/kl/r2-mutants.mjs [M01 M02 …] [--jobs N]
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KL = process.env.KL;
if (!KL) { console.error('set KL=<kronicle-lite checkout>'); process.exit(2); }
const args = process.argv.slice(2);
const jobs = Number(args.includes('--jobs') ? args[args.indexOf('--jobs') + 1] : 6);
const want = args.filter((a) => /^M\d+$/.test(a));
const COS = ['test/cosmetic.test.ts', 'test/stress-corpus.test.ts', 'test/format-only-property.test.ts', 'test/format-only-mutants.test.ts', 'test/orient.test.ts', 'test/stress-repros.test.ts'];
const LIN = ['test/lineage.test.ts', 'test/lineage-property.test.ts', 'test/lineage-cli.test.ts', 'test/orient.test.ts'];
const DOC = ['test/documents.test.ts', 'test/orient.test.ts', 'test/stress-repros.test.ts', 'test/integrity.test.ts'];
const SEC = ['test/secrets.test.ts'];
const HON = ['test/honesty.test.ts', 'test/recall.test.ts', 'test/lineage.test.ts'];
// [id, file, [[old, new], …], suites, what]
const MUTANTS = [
  ['M01', 'src/orient/cosmetic.ts', [['|\\||<|', '|<|']], COS, 'tables (| lines) no longer opaque'],
  ['M02', 'src/orient/cosmetic.ts', [['(?: {4}|\\t|>|', '(?: {4}|\\t|']], COS, 'block quotes no longer opaque'],
  ['M03', 'src/orient/cosmetic.ts', [["if (kind === 'code') return null;", '']], COS, 'fenced code blocks parsed as prose'],
  ['M04', 'src/orient/cosmetic.ts', [["out.push({ t: 'code', v: src.slice(i, close + run.length) });", "out.push({ t: 'code', v: src.slice(i, close + run.length).replace(/\\s+/g, ' ') });"]], COS, 'whitespace collapsed inside inline code'],
  ['M05', 'src/orient/cosmetic.ts', [['href: m[0].slice(m[1]!.length + 2)', "href: ''"]], COS, 'link targets ignored'],
  ['M06', 'src/orient/cosmetic.ts', [["out.push({ t: 'html', v: src.slice(i, close + 1) });", 'out.push(textLeaf(src.slice(i, close + 1)));']], COS, 'inline HTML treated as prose text'],
  ['M07', 'src/orient/cosmetic.ts', [["let v = s.replace(/[ \\t\\n]+/g, ' ');", "let v = s.replace(/[\\s\\u200b-\\u200f\\u2060\\ufeff]+/g, ' ');"]], COS, 'zero-width / NBSP / bidi folded as whitespace'],
  ['M08', 'src/orient/cosmetic.ts', [["out.push(b.t === 'p' ? { t: 'p', c } : { t: 'li', indent: b.indent,", "out.push(b.t === 'p' ? { t: 'p', c } : { t: 'li', indent: 0,"]], COS, 'list nesting (indent) ignored'],
  ['M09', 'src/orient/cosmetic.ts', [["out.push({ t: run.length === 2 ? 'strong' : 'em', c });", "out.push({ t: 'em', c });"]], COS, 'strong == em'],
  ['M10', 'src/lineage/lineage.ts', [['v = a.heading_path === b.heading_path && a.kind === b.kind && ', 'v = a.kind === b.kind && ']], LIN, 'a moved block counts as a format-only twin'],
  ['M11', 'src/lineage/lineage.ts', [['if (w.currentFrom >= 0 && pos >= w.currentFrom) continue;', 'if (w.currentFrom >= 0 && pos >= w.currentFrom - 1) continue;']], LIN, 'reading the version just before current clears pending'],
  ['M12', 'src/lineage/lineage.ts', [['const MAX_DERIVED_DEPTH = 4;', 'const MAX_DERIVED_DEPTH = 1;']], LIN, 'derived depth 4 -> 1'],
  ['M13', 'src/lineage/lineage.ts', [['WHERE at >= ?) r JOIN blocks', 'WHERE at >= ? OR 1) r JOIN blocks']], LIN, 'inference ignores the session bound'],
  ['M14', 'src/orient/orient.ts', [['if (a && b && lineage.hopFormatOnly(a, b)) continue;', '']], LIN, 'format-only source edits produce derived retractions'],
  ['M15', 'src/orient/retraction.ts', [['oldB && newB && !moved ? classifyEdit', 'oldB && newB ? classifyEdit']], COS, 'a moved identical block is format-only'],
  ['M16', 'src/lineage/lineage.ts', [['return (hr !== undefined && hr >= tomb) || (dr !== undefined && dr >= tomb);', 'return hr !== undefined || dr !== undefined;'], ['return (hr !== null && hr >= tomb) || (dr !== null && dr >= tomb);', 'return hr !== null || dr !== null;']], LIN, 'a read BEFORE the removal resolves it'],
  ['M17', 'src/lineage/lineage.ts', [['if (w.currentFrom === 0 || (w.currentFrom > 0 && w.blocks.slice(w.currentFrom).some((b) => ids.has(b.block_id)))) {', 'if (w.currentFrom === 0 || w.currentFrom > 0) {']], LIN, 'a live source is always fresh (superseded never stale)'],
  ['M18', 'src/docs/documents.ts', [['const i = oldUnmatched.findIndex((o) => o.content_hash === n.content_hash && o.kind === n.kind && o.heading_path === path);', 'const i = oldUnmatched.findIndex((o) => o.content_hash === n.content_hash && o.kind === n.kind);']], DOC, 'planRevision carries across sections (round-1 F02 reverted)'],
  ['M19', 'src/secrets/guard.ts', [["{ id: 'github_token', description: 'GitHub token (ghp_/gho_/ghu_/ghs_/ghr_, github_pat_)', re: /\\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\\b/g },", '']], SEC, 'write-time github token detector removed'],
  ['M20', 'src/recall/honesty.ts', [["{ n: 3, when: 'derived note: a block it was derived from changed or was removed (not re-derived)', authority: 'never_act', reason: 'stale_derived', basis: 'document', test: (i) => i.stale_derived === true },", '']], HON, 'stale_derived honesty row removed'],
];

const W = mkdtempSync(join(tmpdir(), 'klr2-mut-'));
const env = { ...process.env, HOME: join(W, 'home'), KRONICLE_LITE_DATA_DIR: join(W, 'no-default-store') };
mkdirSync(env.HOME, { recursive: true });
process.on('exit', () => rmSync(W, { recursive: true, force: true }));

function prepare([id, file, subs]) {
  const d = join(W, id);
  mkdirSync(d);
  for (const f of ['src', 'test', 'package.json', 'tsconfig.json', 'vitest.config.ts', 'dist']) {
    try { cpSync(join(KL, f), join(d, f), { recursive: true }); } catch {}
  }
  symlinkSync(realpathSync(join(KL, 'node_modules')), join(d, 'node_modules'));
  let src = readFileSync(join(d, file), 'utf8');
  for (const [a, b] of subs) {
    if (!src.includes(a)) return { d, applied: false, missing: a.slice(0, 60) };
    src = src.replace(a, b);
  }
  writeFileSync(join(d, file), src);
  return { d, applied: true };
}

function run(m) {
  const [id, file, , suites, what] = m;
  const p = prepare(m);
  if (!p.applied) return Promise.resolve({ id, what, result: 'NOT-APPLIED', missing: p.missing });
  return new Promise((res) => {
    const ch = spawn('npx', ['vitest', 'run', ...suites], { cwd: p.d, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    ch.stdout.on('data', (x) => (log += x));
    ch.stderr.on('data', (x) => (log += x));
    const t = setTimeout(() => ch.kill('SIGKILL'), 20 * 60 * 1000);
    ch.on('close', (code) => {
      clearTimeout(t);
      const failed = /(\d+) failed/.exec(log)?.[1];
      res({ id, file, what, result: code === 0 ? 'SURVIVED' : 'killed', failed_tests: failed ? Number(failed) : null });
    });
  });
}

const list = MUTANTS.filter((m) => want.length === 0 || want.includes(m[0]));
const results = [];
let next = 0;
await Promise.all(Array.from({ length: jobs }, async () => {
  while (next < list.length) {
    const m = list[next++];
    const r = await run(m);
    results.push(r);
    console.log(JSON.stringify(r));
  }
}));
const surv = results.filter((r) => r.result === 'SURVIVED');
console.log(JSON.stringify({ mutants: results.length, killed: results.filter((r) => r.result === 'killed').length, survived: surv.map((r) => r.id), not_applied: results.filter((r) => r.result === 'NOT-APPLIED').map((r) => r.id) }));
