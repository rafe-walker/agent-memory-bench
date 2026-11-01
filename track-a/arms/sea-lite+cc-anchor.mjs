// sea-lite 0.4.0 (local) + cc-anchor 0.3.0 (local, unreleased) lifecycle pack: the edit guard is
// cc-anchor's PreToolUse scope guard (scope_guard=on) and leases are kept alive by cc-anchor's
// PostToolUse heartbeat. Hook scripts are driven with recorded Claude Code payload shapes.
// Time is compressed 1:60 for S13: lease 5 s (default 300 s), heartbeat interval 1 s (default 60 s).
import path from 'node:path';
import fs from 'node:fs';
import SeaLite, { SEA_CLI } from './sea-lite.mjs';
import { view } from './_base.mjs';
import { sh, shAsync, sleep } from '../lib/util.mjs';

export const CC_ANCHOR_DIR = process.env.AMB_CC_ANCHOR_DIR || '/home/claude/cc-anchor';

export default class SeaLiteCcAnchor extends SeaLite {
  static meta = {
    ...SeaLite.meta, id: 'sea-lite+cc-anchor', label: 'sea-lite + cc-anchor hooks', version: 'sea-lite 0.4.0 + cc-anchor 0.3.0 (both unreleased local builds)',
    setupSteps: [...SeaLite.meta.setupSteps.slice(0, 3), 'claude plugin install cc-anchor', 'cc-anchor config set scope_guard true (heartbeat is auto once sea-lite is configured)'],
    editGuard: 'hook', heartbeat: 'PostToolUse',
    s13: { lease: 5, duration: 12, heartbeat: 1 }, reps: { S13: 3 },
  };
  hookEnv(agent) {
    return {
      ...this.env, CLAUDE_PROJECT_DIR: this.ctx.repo, CC_ANCHOR_SCOPE_GUARD: '1', CC_ANCHOR_SEA: '1', CC_ANCHOR_HEARTBEAT: '1',
      CC_ANCHOR_HEARTBEAT_INTERVAL: String(this.ctx.heartbeatInterval ?? 60), CC_ANCHOR_SEA_LITE_BIN: SEA_CLI, CC_ANCHOR_KRONICLE: '0',
    };
  }
  async tryEdit(agent, rel) {
    await this.client(agent);
    const input = JSON.stringify({ session_id: this.sessionOf(agent), transcript_path: '/dev/null', cwd: this.ctx.repo, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(this.ctx.repo, rel), old_string: 'a', new_string: 'b' } });
    const r = sh('bash', [path.join(CC_ANCHOR_DIR, 'scripts', 'pre-tool-use.sh')], { cwd: this.ctx.repo, env: this.hookEnv(agent), input });
    const denied = r.code === 2 || /"permissionDecision"\s*:\s*"deny"/.test(r.stdout);
    return { allowed: !denied, stage: 'edit', view: view(r.stdout + r.stderr, r.ms, 0) };
  }
  // One agent tool call: PostToolUse fires (trail + rate-limited background heartbeat).
  async tick(agent) {
    const input = JSON.stringify({ session_id: this.sessionOf(agent), transcript_path: '/dev/null', cwd: this.ctx.repo, hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: path.join(this.ctx.repo, 'README.md') }, tool_response: { type: 'text' } });
    await shAsync('bash', [path.join(CC_ANCHOR_DIR, 'scripts', 'post-tool-use.sh')], { cwd: this.ctx.repo, env: this.hookEnv(agent), input });
  }
}
