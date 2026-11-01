#!/usr/bin/env node
// Round 2, attack (e): can a pulse say "proceed" while a change landed since the cursor the agent presents?
// The pulse's "changed" test counts events since the actor's LATEST briefing (flight recorder), not since the
// presented cursor. So any second briefing for the same actor after the change (its own earlier pulse, a hook
// sharing the actor id, a retractions call it did not act on) turns the next pulse on the OLD cursor into "proceed".
// usage: KL=<kl checkout> node stress/kl/r2-pulse-wording.mjs      exit 1 = a "proceed" with an unreviewed change
import { openKl } from './r2-lib.mjs';
const out = [];
for (const variant of ['second_pulse_old_cursor', 'hook_same_actor', 'control_single_pulse']) {
  const { kl, done } = openKl();
  try {
    kl.docs.putDocument({ slug: 'instructions/claude-md', title: 'CLAUDE.md', markdown: '# Rules\n\nDeploy target is staging-a.\n', actor_id: 'import' });
    const c0 = kl.orient.getSystemState({ actor_id: 'agent', focus: 'pulse' }).cursor; // agent's session cursor
    kl.docs.putDocument({ slug: 'instructions/claude-md', title: 'CLAUDE.md', markdown: '# Rules\n\nDeploy target is prod-eu.\n', actor_id: 'import' });
    if (variant === 'second_pulse_old_cursor') kl.orient.getSystemState({ actor_id: 'agent', since_cursor: c0, focus: 'pulse' });
    if (variant === 'hook_same_actor') kl.orient.getSystemState({ actor_id: 'agent', focus: 'retractions' }); // e.g. a hook configured with the agent's actor id
    const p = kl.orient.getSystemState({ actor_id: 'agent', since_cursor: c0, focus: 'pulse' });
    const r = kl.orient.getSystemState({ actor_id: 'probe', since_cursor: c0, focus: 'retractions' });
    const says = p.next_steps.join(' ');
    const lie = /proceed/i.test(says) && !/do not/i.test(says) && r.retractions.length > 0;
    out.push({ variant, recovery: p.recovery?.method, from_seq: p.recovery?.from_seq, head: p.head?.seq, retractions_since_c0: r.retractions.length, pending: p.pending_count, next_steps: p.next_steps, proceed_lie: lie });
  } finally { done(); }
}
for (const o of out) console.log(JSON.stringify(o));
process.exit(out.some((o) => o.proceed_lie) ? 1 : 0);
