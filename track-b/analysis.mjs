// Hand-written findings for results/track-b/REPORT.md, rendered by lib/report.mjs around the generated
// tables (same pattern as track-a/analysis.mjs). Numbers quoted here come from results/track-b/runs.jsonl
// of the committed run; before/after with CIs is generated into results/RELEASE-RERUN.md.
const B = {};

B.head = `# agent-memory-bench — Track B report (live headless agents), release re-run

*2026-11-01. Released versions: **kronicle-lite 0.7.0** and **sea-lite 0.5.0** (npm), **cc-anchor 0.4.0** (git tag \`v0.4.0\` @ b95500a); beads 1.3.2 unchanged. All grading is deterministic: the fake \`./bin\` tools log every call, and the grader compares that log, the git state and the files against expected values. No LLM judge is used anywhere. The pre-release run (kronicle-lite 0.5.0, sea-lite 0.4.0, cc-anchor 0.3.0 / push-hook / next-cycle local snapshots) is archived in \`results/prerelease/track-b*\`; before/after with CIs is in [\`results/RELEASE-RERUN.md\`](../RELEASE-RERUN.md).*

## 0. Bottom line

1. **Headless runs worked.** \`claude -p\` (Claude Code 2.1.316, Haiku 5.5) in per-run temp dirs with an isolated \`HOME\`/\`CLAUDE_CONFIG_DIR\` and a scrubbed environment, as before. 88 graded runs, 118 invocations, **$1.17** metered (+ $0.07 for a 4-run smoke test; the dollar cap was $8).
2. **T1 (stale runbook mid-session) is still the strong result, and the released pull-only setup now mostly passes.**
   - kronicle-lite 0.7.0 + cc-anchor 0.4.0 (retraction push): **10/10**, same as the unreleased push-hook build (10/10).
   - kronicle-lite 0.7.0 **pull only** (orient skill, no hook): **8/10**, up from 0/9 with 0.5.0 (Fisher *p* < 0.001). The 0.7.0 skill tells the agent to orient before every world-changing command, and every agent did (re-checked after the fault 10/10, was 0/9).
   - It costs: pull-only 0.7.0 used 448k tokens/run (0.5.0: 232k) and 36 s (21 s). With push: 354k, 32 s.
   - no memory 0/10 and native CLAUDE.md 0/10: unchanged.
3. **The 2 pull-only failures are a kronicle-lite protocol trap, not model noise.** In 10/10 pull runs the first check after the fault was \`get_system_state {focus: "pulse"}\`. Across a real retraction (the deploy target changed) pulse answers "5 changes since your last orient — within threshold", \`retractions: null\`, next step "Within threshold; proceed. Carry the new cursor.", and returns an advanced cursor. 8 agents asked again with the *old* cursor and saw the retraction; the 2 that carried the new cursor, as told, got an empty delta and deployed stale. 0.5.0's pulse behaves the same (probe in §4); the 0.7.0 skill just makes agents reach for it.
4. **T7 (coordinator + two subagents): 5/6**, up from 1/6, mostly because the fixture is fixed (§5). The push still lands in the wrong agent: in 6/6 runs cc-anchor 0.4.0's single per-session cursor delivered the retraction inside subagent 1's build call, and the coordinator was never pushed anything. It recovered by pulling (orient before handing off a deploy) in 5/6; the one failure is the same pulse trap. Per-subagent cursors exist only on cc-anchor's unreleased next-cycle branch.
5. **T6 (benign typo): 6/6 for both arms, at a real cost.** kronicle-lite 0.7.0 delivers typo, quote and punctuation edits as retractions by design (format-only = identical Markdown text only). The typo fix \`platfrom → platform\` was pushed in 6/6 runs and every agent re-read the runbook: **324k tokens/run vs 175k for no memory (+85%), 31 s vs 15 s, 12.0 vs 7.7 tool calls.** No wrong action.
6. **T3 (two parallel agents): sea-lite 0.5.0 + cc-anchor guard 10/10 with zero collisions** (none 6/10, beads 9/10), but **3.3× the wall time** (170 s vs 51 s), because 0.5.0 has no \`wait_seconds\`: agents poll with \`sleep 20\`, and in 7/10 runs one agent did all 4 tickets while the other polled and gave up.

## 1. Headline table (Haiku; success = all steps with the right values)

| Scenario | none | native | kronicle-lite 0.7.0 (pull) | kronicle-lite 0.7.0 + cc-anchor 0.4.0 (push) | sea-lite 0.5.0 + cc-anchor 0.4.0 | beads 1.3.2 |
|---|---|---|---|---|---|---|
| T1 stale runbook mid-session (n=10) | 0/10 | 0/10 | **8/10** (was 0/9 on 0.5.0) | **10/10** (was 10/10, push-hook build) | – | – |
| T1 tokens / wall per run | 175k / 15 s | 153k / 14 s | 448k / 36 s | 354k / 32 s | – | – |
| T6 benign typo (n=6) | 6/6 · 175k · 15 s | – | – | 6/6 · 324k · 31 s | – | – |
| T3 two parallel agents, no collision (n=10) | 6/10 | – | – | – | **10/10** | 9/10 |
| T3 wall per run | 51 s | – | – | – | 170 s | 53 s |
| T7 coordinator + 2 subagents (n=6) | – | – | – | 5/6 (shared cursor) | – | – |

Not re-run: T2, T4, T5 and the Sonnet subset (no released-version change they measure); see \`results/prerelease/track-b/REPORT.md\`.

## 2. Findings

**F1. The 0.7.0 orient skill closes most of the mid-session gap without a hook.** One added rule ("before every world-changing command — deploy, migrate, publish, git push — orient, even mid-task") moved pull-only from 0/9 to 8/10, and every pull agent re-checked after the fault (10/10, was 0/9). This was item 2 of the pre-release report's ranked list.

**F2. \`pulse\` says "proceed" across a retraction.** \`focus: "pulse"\` is a count-only drift check: events since the cursor, "within threshold; proceed", \`retractions: null\`, and an advanced cursor. When those events supersede a block the agent relied on, that is the wrong answer, and an agent that carries the new cursor (as \`next_steps\` says) can no longer see the retraction. Both pull-only T1 failures and the T7 failure follow exactly this sequence. The push arm is immune because cc-anchor calls \`--focus retractions\`.

**F3. Push is still the robust path, and on 0.7.0 it is cheaper than pull-only.** 10/10 with push vs 8/10 pull, at 354k vs 448k tokens and 13.1 vs 14.6 tool calls: the push hands over the diff; the pull-only agent makes 2–4 orient calls to find it.

**F4. One shared cursor = the push goes to whoever calls a tool first (T7).** cc-anchor 0.4.0 keeps one retraction cursor per session; subagent 1's build call consumed the push in 6/6 runs. The coordinator was saved by its own pull, not by the push, and stopped a running subagent in 0/6 runs (the next-cycle branch's per-subagent cursors: 5/6 in the pre-release run).

**F5. Format-only by design means typo pushes cost tokens (T6).** kronicle-lite 0.7.0 dropped the 0.6-era cosmetic classifier after it hid real changes (27/38 in an adversarial corpus); only identical-text Markdown edits stay quiet now. In T6 that costs +149k tokens and +16 s per run vs no memory, with zero wrong actions. cc-anchor's push text does not show kronicle-lite's \`hint: likely_typo\`, so every agent re-reads.

**F6. Parallel agents (T3): no collisions with sea-lite, slow without blocking waits.** sea-lite 0.5.0 + cc-anchor 0.4.0: 0 collisions in 10 runs, 30 scope denials, 8.8 \`sleep\` calls per run. No memory: 4/10 runs with a collision (1 duplicate ticket, 3 lost CHANGELOG lines; Claude Code's "modified since read" check refused 4 edits). beads: 1/10 (a duplicate ticket). sea-lite vs none on success is not significant at n=10 (10/10 vs 6/10, *p* = 0.087).

## 3. Where we lose

- **Wall time on parallel work (T3):** sea-lite 170 s vs 51 s (none) and 53 s (beads); pre-release 0.4.0 was 156 s. In 7/10 runs one agent did all the work while the other slept and gave up: the queue serializes on the shared CHANGELOG.md and 0.5.0 cannot block-wait. \`wait_seconds\` is on an unreleased branch (Track A S15: tool calls 15 → 10, both agents get work).
- **Tokens on every kronicle arm:** T1 pull-only 448k and push 354k vs 153k for native CLAUDE.md (which is free and fails 0/10). T6: +85% tokens for a typo.
- **Pull-only is 8/10, not 10/10,** because of \`pulse\` (F2).
- **Subagents (T7):** the push reached the coordinator in 0/6 runs.
- **First-call friction (T3):** one sea agent's first \`sea_next\` failed with "Scope is required as an object" (it passed a list) before it recovered.

## 4. What to develop next (ranked)

1. **kronicle-lite: \`pulse\` must not say "proceed" over a retraction.** When the range holds retractions of blocks the actor relied on, return their count and a one-line diff each (or do not advance the cursor) and make \`next_steps\` "reconcile N retraction(s) before acting". Probe, identical on 0.5.0 and 0.7.0: put \`stg-a-1\`, orient, put \`stg-b-2\`, \`orient --cursor C --focus pulse\` → \`retractions: null\`, "Within threshold; proceed"; \`--focus retractions\` with the same C → 1 retraction with the diff. Expected effect: pull-only T1 8/10 → 10/10, and the T7 failure.
2. **cc-anchor: per-subagent retraction cursors (release next-cycle).** T7: the push reached the coordinator 0/6 with a shared cursor.
3. **sea-lite: release \`sea_next {wait_seconds}\`.** T3 wall 3.3× and one agent idle in 7/10 runs; S15 shows the fix deterministically.
4. **cc-anchor: render \`hint: likely_typo\` in the push** ("typo fix, same meaning; no action unless it is a name or value") so T6-style edits cost a line, not a re-read.
5. **kronicle-lite: a cheaper pre-command check.** Pull-only agents made 2–4 orient calls per deploy (14.6 tool calls/run vs 7.6 for no memory).

## 5. Method and threats to validity

- **Same harness as the pre-release run:** same fixtures, prompts and seeds (each seed draws cluster, channel and timeout values; arms share seeds). Changes: the arms point at the released packages (\`track-b/package.json\`: kronicle-lite 0.7.0, sea-lite 0.5.0; \`vendor/cc-anchor\` = \`git archive v0.4.0\`); the runner records cc-anchor push/pulse hook events per agent and enforces a dollar cap (\`--usd-cap\` / \`TRACKB_USD_CAP\`).
- **T7 fixture fix.** The fake \`build\`/\`deploy\` reported a constant sha \`4f1c9e2\` that matched no commit in the fixture repo, so pre-release agents skipped \`notify\` (strict success 1/6 in both arms). T7 now sets stub-config \`realSha\` and the tools report the repo's real short HEAD. T1/T6/T3 keep the constant so their before/after compares tools, not fixtures. T7's before/after mixes a fixture change with a version change; read its success delta as mostly fixture.
- **Every cell ran its full n** (no early stop): T1 10 per arm, T6 6, T3 10 (2 agents each), T7 6.
- **Peeking:** 5 T3 runs read bench internals (\`lib/stub.mjs\`); T3 has no injected fault, so nothing leaked.
- **Threats:** small n, one fixture family, Haiku only; T1's fault lands inside a tool call; wall times are on a shared 2-CPU sandbox (Track A ran after Track B finished, not concurrently).

## 6. Full tables`;

export default B;
