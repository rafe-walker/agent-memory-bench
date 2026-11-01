// Arms: how each memory/coordination system is installed into a run, and how
// a fact change is applied in that system's own store (fault injection).
import fs from 'node:fs';
import path from 'node:path';
import { BIN, TB, sh, write, copyDir } from './common.mjs';

export const ARMS = {
  none: { label: 'no memory', version: '-' },
  native: { label: 'native CLAUDE.md (+ auto-memory MEMORY.md)', version: 'claude-code built-in' },
  kronicle: { label: 'kronicle-lite + orient skill', version: 'kronicle-lite 0.5.0 (npm)' },
  kronicle_strict: { label: 'kronicle-lite + orient skill + stricter wake contract (pulse before every world-changing command; no hook)', version: 'kronicle-lite 0.5.0 (npm), CLAUDE.md variant' },
  kronicle_push: { label: 'kronicle-lite + orient skill + PostToolUse retraction push (bench prototype)', version: 'kronicle-lite 0.5.0 + prototypes/kronicle-push-hook.mjs' },
  kronicle_ccpush: { label: 'kronicle-lite + orient skill + cc-anchor retraction push + pulse (shipped hooks)', version: 'kronicle-lite 0.5.0 + cc-anchor push-hook (vendor/cc-anchor-push, see VERSION)' },
  kronicle_ccsub: { label: 'kronicle-lite + orient skill + cc-anchor next-cycle (per-subagent retraction cursors)', version: 'kronicle-lite 0.5.0 + cc-anchor next-cycle (vendor/cc-anchor-next, see VERSION)' },
  basicmem: { label: 'basic-memory (competitor, memory)', version: 'basic-memory 1.0.0 (PyPI)' },
  ccanchor: { label: 'cc-anchor anchor card', version: 'cc-anchor 0.3.0 (local)' },
  sea: { label: 'sea-lite + cc-anchor scope guard', version: 'sea-lite 0.4.0 (local, unreleased) + cc-anchor 0.3.0' },
  beads: { label: 'beads (competitor, coordination)', version: '@beads/bd 1.3.2 (npm)' },
};

const WAKE = `# Agent wake contract (kronicle-lite)

Before material work: call \`get_system_state\` with your previous \`cursor\` as
\`since_cursor\`. Honor the drift banner; reconcile retractions BEFORE acting.
Trust the chain over your own memory or a compaction summary.

Manual re-ground: type the bare word \`orient\` to fire the orient skill
(\`.claude/skills/orient/SKILL.md\`).

Keep receipts from \`recall()\` with any claim you derive; \`verify()\` them before
building on the claim again.
`;

// ---------- native ----------
export function sanitizeProjectPath(p) { return p.replace(/[^a-zA-Z0-9]/g, '-'); }
export function nativeMemoryFile(ctx) {
  return path.join(ctx.cfgDir, 'projects', sanitizeProjectPath(ctx.repo), 'memory', 'MEMORY.md');
}
export function nativeSetMemory(ctx, content) { write(nativeMemoryFile(ctx), content); }

// ---------- kronicle-lite ----------
export function kronicleSetup(ctx) {
  ctx.kl = path.join(ctx.runDir, 'kl');
  fs.mkdirSync(ctx.kl, { recursive: true });
  ctx.mcp.mcpServers['kronicle-lite'] = {
    command: 'node', args: [BIN.kronicle, 'serve', '--data-dir', ctx.kl, '--actor', 'agent'],
  };
  ctx.allowed.push('mcp__kronicle-lite');
  copyDir(path.join(TB, 'node_modules', 'kronicle-lite', 'skills', 'orient'), path.join(ctx.repo, '.claude', 'skills', 'orient'));
  ctx.claudeMd.push(WAKE);
  if (ctx.arm === 'kronicle_strict') {
    ctx.claudeMd.push('Before EVERY command that changes the world (migrate, deploy, notify, or any write), call `get_system_state` with `focus: "pulse"` and your latest cursor; if anything changed, re-read the affected document before running the command.\n');
  }
  if (ctx.arm === 'kronicle_push') {
    const hook = path.join(TB, 'prototypes', 'kronicle-push-hook.mjs');
    const cmd = { type: 'command', command: `node ${JSON.stringify(hook)}`, timeout: 15 };
    write(path.join(ctx.repo, '.claude', 'settings.json'), JSON.stringify({
      hooks: { SessionStart: [{ hooks: [cmd] }], PostToolUse: [{ matcher: '*', hooks: [cmd] }] },
    }, null, 2));
    ctx.env.KRONICLE_LITE_DATA_DIR = ctx.kl;
    ctx.env.KL_PUSH_CLI = BIN.kronicle;
  }
  if (ctx.arm === 'kronicle_ccpush' || ctx.arm === 'kronicle_ccsub') {
    // The real cc-anchor plugin (all hooks, defaults), not a hand-wired prototype.
    // The MCP config is passed with --mcp-config (not .mcp.json), so cc-anchor's
    // file-based detection cannot see it: name the store and CLI explicitly.
    ctx.pluginDirs.push(ctx.arm === 'kronicle_ccsub' ? BIN.ccAnchorNext : BIN.ccAnchorPush);
    ctx.env.CC_ANCHOR_KRONICLE = '1';
    ctx.env.CC_ANCHOR_KRONICLE_DATA_DIR = ctx.kl;
    ctx.env.CC_ANCHOR_KRONICLE_LITE_BIN = BIN.kronicle;
  }
}
export function kroniclePut(ctx, slug, content, title) {
  const f = path.join(ctx.runDir, 'docs-src', `${slug}.md`);
  write(f, content);
  sh('node', [BIN.kronicle, 'put', slug, f, '--data-dir', ctx.kl, ...(title ? ['--title', title] : [])], { cwd: ctx.repo });
}
export function kronicleMutateSh(ctx, slug, content, tag = 'v2') {
  const f = path.join(ctx.runDir, 'pending', `${slug}-${tag}.md`);
  write(f, content);
  return `cd ${JSON.stringify(ctx.repo)} && node ${JSON.stringify(BIN.kronicle)} put ${slug} ${JSON.stringify(f)} --data-dir ${JSON.stringify(ctx.kl)}`;
}

// ---------- basic-memory ----------
export function bmSetup(ctx) {
  ctx.bmDir = path.join(ctx.home, 'basic-memory');
  fs.mkdirSync(ctx.bmDir, { recursive: true });
  write(path.join(ctx.home, '.basic-memory', 'config.json'), JSON.stringify({
    projects: { main: { path: ctx.bmDir, mode: 'local' } },
    default_project: 'main',
    semantic_embedding_cache_dir: BIN.fastembedCache,
  }, null, 2));
  ctx.mcp.mcpServers['basic-memory'] = { command: BIN.bm, args: ['mcp'], env: { HOME: ctx.home, HF_HUB_OFFLINE: '1' } };
  ctx.allowed.push('mcp__basic-memory');
  ctx.env.HF_HUB_OFFLINE = '1';
  ctx.postSetup.push(() => sh(BIN.bm, ['reindex'], { env: bmEnv(ctx), timeout: 180000 }));
}
function bmEnv(ctx) { return { PATH: process.env.PATH, HOME: ctx.home, HF_HUB_OFFLINE: '1', SSL_CERT_FILE: process.env.SSL_CERT_FILE || '' }; }
export function bmNote(ctx, name, title, body) {
  write(path.join(ctx.bmDir, `${name}.md`), `---\ntitle: ${title}\ntype: note\n---\n\n${body}`);
}
export function bmMutateSh(ctx, name, title, body, tag = 'v2') {
  const f = path.join(ctx.runDir, 'pending', `${name}-${tag}.md`);
  write(f, `---\ntitle: ${title}\ntype: note\n---\n\n${body}`);
  return `HOME=${JSON.stringify(ctx.home)} HF_HUB_OFFLINE=1 ${JSON.stringify(BIN.bm)} tool write --identifier ${name}.md --overwrite --local < ${JSON.stringify(f)}`;
}

// ---------- cc-anchor ----------
export function ccAnchorSetup(ctx, { goal, invariants = [] } = {}) {
  ctx.pluginDirs.push(BIN.ccAnchor);
  const anchor = path.join(BIN.ccAnchor, 'scripts', 'anchor.mjs');
  ctx.ccAnchorCli = anchor;
  ctx.postSetup.push(() => {
    const env = { ...process.env, HOME: ctx.home, CLAUDE_CONFIG_DIR: ctx.cfgDir };
    if (goal) sh('node', [anchor, 'set', 'goal', goal], { cwd: ctx.repo, env });
    for (const inv of invariants) sh('node', [anchor, 'add-invariant', inv], { cwd: ctx.repo, env });
  });
}

// ---------- sea-lite (+ cc-anchor scope guard) ----------
export function seaSetup(ctx) {
  ctx.sea = path.join(ctx.runDir, 'sea');
  fs.mkdirSync(ctx.sea, { recursive: true });
  const wrapDir = path.join(ctx.runDir, 'tools');
  write(path.join(wrapDir, 'sea-lite'), `#!/usr/bin/env bash\nexec node ${JSON.stringify(BIN.sea)} "$@"\n`, 0o755);
  ctx.pathPrepend.push(wrapDir);
  ctx.env.KRONICLE_LITE_DATA_DIR = ctx.sea;
  ctx.env.CC_ANCHOR_SEA_DATA_DIR = ctx.sea;
  ctx.env.CC_ANCHOR_SEA_LITE_BIN = path.join(wrapDir, 'sea-lite');
  ctx.env.CC_ANCHOR_SEA = '1';
  ctx.env.CC_ANCHOR_KRONICLE = '0';
  ctx.pluginDirs.push(BIN.ccAnchor);
  write(path.join(ctx.repo, '.claude', 'cc-anchor.json'), JSON.stringify({ scope_guard: true }, null, 2));
  copyDir(path.join(TB, 'vendor', 'sea-lite', 'skills', 'work-queue'), path.join(ctx.repo, '.claude', 'skills', 'work-queue'));
  ctx.allowed.push('mcp__sea-lite');
  // one MCP server per agent so each has its own actor + session
  ctx.perAgentMcp = (agentId) => ({
    'sea-lite': { command: 'node', args: [BIN.sea, 'serve', '--actor', `agent-${agentId}`, '--data-dir', ctx.sea] },
  });
}
export function seaCreate(ctx, title, body, paths) {
  const args = [BIN.sea, 'create', title, '--triaged', '--body', `${body}\n\nPaths: ${paths.join(', ')}`, '--data-dir', ctx.sea, '--json'];
  return JSON.parse(sh('node', args, { cwd: ctx.repo, env: { ...process.env, KRONICLE_LITE_DATA_DIR: ctx.sea } }));
}
export function seaPrecommit(ctx) {
  sh('node', [BIN.sea, 'precommit', '--install', '--data-dir', ctx.sea], { cwd: ctx.repo, env: { ...process.env, KRONICLE_LITE_DATA_DIR: ctx.sea } });
}

// ---------- beads ----------
export function beadsSetup(ctx) {
  ctx.pathPrepend.push(path.dirname(BIN.bd));
}
export function beadsInit(ctx) {
  const env = { ...process.env, HOME: ctx.home };
  sh(BIN.bd, ['init', '--quiet'], { cwd: ctx.repo, env, timeout: 120000 });
}
export function beadsCreate(ctx, title, body) {
  const env = { ...process.env, HOME: ctx.home };
  return sh(BIN.bd, ['create', title, '-d', body, '-p', '1'], { cwd: ctx.repo, env, timeout: 60000 });
}
