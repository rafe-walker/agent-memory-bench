// A1: native Claude Code file conventions, simulated exactly as documented
// (code.claude.com/docs/en/memory and /context-window, fetched 2026-10-31):
//  - session start: CLAUDE.md / .claude/CLAUDE.md / CLAUDE.local.md in cwd and ancestors (AGENTS.md
//    only when none of those exist), @imports expanded (relative to the importing file, max 4 hops,
//    not inside code spans), .claude/rules/**/*.md without `paths:` frontmatter, and the first
//    200 lines or 25KB (whichever first) of auto memory ~/.claude/projects/<project>/memory/MEMORY.md.
//  - mid-session: the docs only say the Edit tool notices a file changed since it was read. OBSERVED
//    (undocumented) harness behaviour, seen in this very build session on 2026-10-31: when a file Claude
//    read earlier changes on disk, the next turn carries a system note "<file> changed on disk since you
//    last read it ... Here are the relevant changes (shown with line numbers)" listing the NEW lines.
//    We model that note for files the agent Read (not for imported/injected content). See README.
//  - after /compact: project-root CLAUDE.md, unscoped rules and auto memory are re-injected from disk.
//  - lookups: the agent greps the repo.
import fs from 'node:fs';
import path from 'node:path';
import { Arm, view, grepRepo, readFileSafe, listFiles } from './_base.mjs';

const MEMORY_LINES = 200, MEMORY_BYTES = 25 * 1024, IMPORT_HOPS = 4;

export default class Native extends Arm {
  static meta = {
    id: 'native', label: 'native CLAUDE.md / AGENTS.md / auto memory (simulated per docs)', version: 'Claude Code docs as of 2026-10-31', kind: ['knowledge', 'compaction'],
    setupSteps: ['write CLAUDE.md (optionally @import runbooks)'],
    notes: 'Loader simulated from the published docs, not by running the claude binary. Auto memory content is written by Claude itself; the bench writes the line Claude would write (remember()).',
  };
  get memDir() { return path.join(this.ctx.home, '.claude', 'projects', this.ctx.repo.replace(/[^a-zA-Z0-9]/g, '-'), 'memory'); }
  async setup() { fs.mkdirSync(this.memDir, { recursive: true }); }
  async ingest() {}

  #expandImports(file, hops, seen) {
    const text = readFileSafe(file);
    if (text == null) return [];
    const out = [{ file, text }];
    if (hops >= IMPORT_HOPS) return out;
    const noCode = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
    for (const m of noCode.matchAll(/(?:^|\s)@([^\s`]+)/g)) {
      const target = m[1].startsWith('~/') ? path.join(this.ctx.home, m[1].slice(2)) : path.resolve(path.dirname(file), m[1]);
      if (seen.has(target) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) continue;
      seen.add(target);
      out.push(...this.#expandImports(target, hops + 1, seen));
    }
    return out;
  }
  #load() {
    const t0 = performance.now();
    const repo = this.ctx.repo;
    const parts = [];
    const claudeFiles = ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md'].map((f) => path.join(repo, f)).filter((f) => fs.existsSync(f));
    const roots = claudeFiles.length ? claudeFiles : ['AGENTS.md', '.claude/AGENTS.md'].map((f) => path.join(repo, f)).filter((f) => fs.existsSync(f));
    const seen = new Set(roots);
    for (const f of roots) for (const { file, text } of this.#expandImports(f, 0, seen)) parts.push(`Contents of ${file} (project instructions):\n\n${text}`);
    const rulesDir = path.join(repo, '.claude', 'rules');
    if (fs.existsSync(rulesDir)) for (const f of listFiles(rulesDir, (p) => p.endsWith('.md')).sort()) {
      const t = readFileSafe(f);
      if (/^---[\s\S]*?\npaths:/m.test(t.split('\n---')[0] + '\n---')) continue; // path-scoped: loads on demand only
      parts.push(`Contents of ${f} (project rule):\n\n${t}`);
    }
    const mem = readFileSafe(path.join(this.memDir, 'MEMORY.md'));
    if (mem) {
      let lines = mem.split('\n').slice(0, MEMORY_LINES).join('\n');
      if (Buffer.byteLength(lines) > MEMORY_BYTES) lines = Buffer.from(lines).subarray(0, MEMORY_BYTES).toString('utf8');
      parts.push(`Contents of ${path.join(this.memDir, 'MEMORY.md')} (auto memory):\n\n${lines}`);
    }
    return view(parts.join('\n\n'), performance.now() - t0, 0, { delivery: 'push' });
  }
  async sessionStart() { return this.#load(); }
  // Grep, then Read the top matching file (the usual Grep -> Read pattern); Read files are tracked.
  async read(q) {
    const g = grepRepo(this.ctx.repo, q.grep);
    const top = g.text.split('\n')[0]?.match(/^\.?\/?([^:]+):\d+:/)?.[1];
    if (!top) return g;
    const abs = path.join(this.ctx.repo, top);
    const t = readFileSafe(abs);
    if (t == null) return g;
    (this.readFiles ??= new Map()).set(abs, t);
    const numbered = t.split('\n').map((l, i) => `${String(i + 1).padStart(6)}\t${l}`).join('\n');
    return view(`${g.text}\n\n[Read ${top}]\n${numbered}`, g.ms, 2);
  }
  async sync() {}
  async touch() {
    const notes = [];
    for (const [abs, before] of this.readFiles ?? []) {
      const now = readFileSafe(abs);
      if (now == null || now === before) continue;
      const b = new Set(before.split('\n'));
      const changed = now.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => !b.has(l));
      if (!changed.length) continue;
      notes.push(`Note: ${abs} changed on disk since you last read it. Here are the relevant changes (shown with line numbers):\n${changed.map(([n, l]) => `${n}\t${l}`).join('\n')}`);
      this.readFiles.set(abs, now);
    }
    return view(notes.join('\n\n'), 0, 0, { delivery: 'push' });
  }
  // Auto memory: Claude writes a topic file and a one-line index entry in MEMORY.md.
  async remember(text, { slug = 'note' } = {}) {
    const t0 = performance.now();
    const topic = `${slug.replace(/[^a-z0-9]+/gi, '_')}.md`;
    fs.writeFileSync(path.join(this.memDir, topic), `---\nname: ${slug}\n---\n${text}\n`);
    fs.appendFileSync(path.join(this.memDir, 'MEMORY.md'), `- [${slug}](${topic}) — ${text}\n`);
    return view('', performance.now() - t0, 0);
  }
  async seedMemoryLines(lines) { fs.appendFileSync(path.join(this.memDir, 'MEMORY.md'), lines.join('\n') + '\n'); }
  async postCompact() { return this.#load(); }
  async newSession() { return this.#load(); }
  async tamper(oldV, newV) {
    let n = 0;
    for (const f of listFiles(this.memDir)) { const t = readFileSafe(f); if (t.includes(oldV)) { fs.writeFileSync(f, t.split(oldV).join(newV)); n++; } }
    return n > 0;
  }
  async integrityCheck() { return null; }
  storeDirs() { return [this.memDir]; }
}
