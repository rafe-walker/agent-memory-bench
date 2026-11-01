#!/usr/bin/env node
// BENCH PROTOTYPE — not shipped in kronicle-lite or cc-anchor.
// "Push on change": a Claude Code hook that keeps its own kronicle-lite cursor
// and, after every tool call, injects any retractions that landed since the
// last check into the agent's context (PostToolUse additionalContext). It
// tests the hypothesis that orient-at-session-start (pull) misses mid-session
// changes and that a cheap push closes the gap.
//
//   SessionStart  → record the current head as the hook's cursor (silent)
//   PostToolUse   → orient --cursor <c> --focus retractions; if any, inject them
//
// Env: KRONICLE_LITE_DATA_DIR (store), KL_PUSH_CLI (path to kronicle-lite dist/cli.js).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

let input = '';
try { input = fs.readFileSync(0, 'utf8'); } catch { /* no stdin */ }
let ev = {}; try { ev = JSON.parse(input); } catch { /* ignore */ }
const dataDir = process.env.KRONICLE_LITE_DATA_DIR;
const cli = process.env.KL_PUSH_CLI;
const proj = process.env.CLAUDE_PROJECT_DIR || ev.cwd || process.cwd();
if (!dataDir || !cli) process.exit(0);
const stateFile = path.join(proj, '.claude', 'kl-push-cursor');

function orient(extra) {
  const out = execFileSync('node', [cli, 'orient', '--data-dir', dataDir, '--actor', 'push-hook', '--json', '--cwd', proj, ...extra], { encoding: 'utf8', timeout: 8000 });
  return JSON.parse(out);
}

try {
  const cursor = fs.existsSync(stateFile) ? fs.readFileSync(stateFile, 'utf8').trim() : '';
  if (ev.hook_event_name === 'SessionStart' || !cursor) {
    const o = orient(['--focus', 'pulse']);
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, o.cursor);
    process.exit(0);
  }
  const o = orient(['--cursor', cursor, '--focus', 'retractions']);
  fs.writeFileSync(stateFile, o.cursor);
  const rs = o.retractions || [];
  if (!rs.length) process.exit(0);
  const lines = rs.slice(0, 8).map((r) => `- seq ${r.seq} (${r.kind}): ${r.diff ? `changed: ${r.diff}` : `was "${String(r.old_text || '').slice(0, 200)}" → now ${r.new_text == null ? 'REMOVED' : `"${String(r.new_text).slice(0, 200)}"`}`}`);
  const msg = `kronicle-lite: the chain changed while you were working (head seq ${o.head?.seq}). ${rs.length} retraction(s) since your last check:\n${lines.join('\n')}\nAnything you read before this point may be stale: re-read the affected document (recall / get_system_state) before acting on it.`;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: msg } }));
} catch (e) {
  try { fs.appendFileSync(path.join(proj, '.claude', 'kl-push-hook.log'), `${new Date().toISOString()} ${e.message}\n`); } catch { /* */ }
}
process.exit(0);
