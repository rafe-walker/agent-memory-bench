// cc-anchor 0.3.0 (unreleased local checkout) as a compaction arm: the decision is recorded on the
// anchor card with the documented command (anchor.mjs add-invariant), PreCompact renders the card,
// SessionStart(compact) injects it. Hook scripts run with recorded Claude Code payload shapes.
import path from 'node:path';
import fs from 'node:fs';
import { Arm, view } from './_base.mjs';
import { sh } from '../lib/util.mjs';
import { CC_ANCHOR_DIR } from './sea-lite+cc-anchor.mjs';

export default class CcAnchor extends Arm {
  static meta = {
    id: 'cc-anchor', label: 'cc-anchor (card only)', version: '0.3.0 (unreleased local checkout)', kind: ['compaction'],
    setupSteps: ['claude plugin marketplace add rafe-walker/cc-anchor', 'claude plugin install cc-anchor', '/cc-anchor:anchor set goal "…" + add-invariant "…" as decisions are made'],
    notes: 'Card content is written by the agent/user with the anchor command; hooks only persist and re-inject it.',
  };
  get env() { return { ...process.env, HOME: this.ctx.home, CLAUDE_PROJECT_DIR: this.ctx.repo, CC_ANCHOR_KRONICLE: '0', CC_ANCHOR_SEA: '0' }; }
  #hook(script, payload) {
    const input = JSON.stringify({ session_id: 'bench-session', transcript_path: '/dev/null', cwd: this.ctx.repo, ...payload });
    return sh('bash', [path.join(CC_ANCHOR_DIR, 'scripts', script)], { cwd: this.ctx.repo, env: this.env, input });
  }
  async ingest() {}
  async sessionStart() { const r = this.#hook('session-start.sh', { hook_event_name: 'SessionStart', source: 'startup' }); return view(this.#ctxOut(r.stdout), r.ms, 0); }
  #ctxOut(stdout) { try { const j = JSON.parse(stdout); return j.hookSpecificOutput?.additionalContext ?? j.systemMessage ?? stdout; } catch { return stdout; } }
  async captureDecision(text) {
    const r = sh(process.execPath, [path.join(CC_ANCHOR_DIR, 'scripts', 'anchor.mjs'), 'add-invariant', text], { cwd: this.ctx.repo, env: this.env });
    if (r.code !== 0) throw new Error(`anchor add-invariant failed: ${r.stderr.slice(0, 200)}`);
  }
  async workTicks(n) { for (let i = 0; i < n; i++) this.#hook('post-tool-use.sh', { hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(this.ctx.repo, `src/f${i}.ts`) }, tool_response: {} }); }
  async postCompact() {
    const a = this.#hook('pre-compact.sh', { hook_event_name: 'PreCompact', trigger: 'auto', custom_instructions: '' });
    const b = this.#hook('session-start.sh', { hook_event_name: 'SessionStart', source: 'compact' });
    return view(this.#ctxOut(b.stdout), a.ms + b.ms, 0);
  }
}
