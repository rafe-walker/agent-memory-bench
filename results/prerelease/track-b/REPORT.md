# agent-memory-bench — Track B report (live headless agents)

*2026-11-01. All grading is deterministic: the fake `./bin` tools log every call, and the grader compares that log, the git state and the files against expected values. No LLM judge is used anywhere.*

## 0. Bottom line

1. **Headless runs worked.** `claude -p` (Claude Code 2.1.316) ran in per-run temp dirs, each with an isolated `HOME`/`CLAUDE_CONFIG_DIR` and a scrubbed environment. 222 of the 240-invocation cap were used (one was the smoke test), for **$5.21** metered cost. Haiku 5.5 is the default model; Sonnet 5.5 ran only a confirmation subset (40 invocations).
2. **The one strong result is T1 (stale runbook mid-session).**
   - Every *pull* arm deployed to the stale target in every Haiku run: 0/36 across no-memory, native CLAUDE.md, kronicle-lite 0.5.0 as shipped, and basic-memory.
   - kronicle-lite agents oriented at session start (9/9) and never again before deploying (0/9). The orient skill fires on kronicle write tools, not on a Bash `deploy`.
   - Two cheap changes each went 10/10 on Haiku (Fisher *p* = 1e-5 vs kronicle as shipped): a PostToolUse hook that pushes new retractions into the agent's context (bench prototype), and one extra wake-contract sentence, "pulse before every world-changing command". The second costs about 2× the tokens of the first (515k vs 267k per run).
   - On Sonnet (n=4) the direction holds: push 3/4, strict 4/4, kronicle 1/4, none 0/4.
3. **Mostly null everywhere else, as the design predicted.** On T2 (contradicting sources), T4 (forced compaction), T5 (poisoned memory) and T6 (benign noise), every arm succeeded in every run. Memory tools neither helped nor hurt there; they cost +20–70% tokens and up to 3× wall time.
4. **T3 (parallel agents) is suggestive, not significant.** Runs with at least one collision: sea-lite + cc-anchor guard 0/8 (Haiku) and 0/2 (Sonnet); no-memory 1/8 and 1/2; beads 2/8. At n=8 not significant (sea vs none p = 1.0; sea vs beads p = 0.47). sea-lite was 2.6× slower in wall time (156 s vs 60 s) because of scope-conflict waiting.

## 1. Headline table

Success = all steps done with the right values; Haiku unless noted.

| Scenario | none | native | kronicle 0.5.0 | kronicle + push hook (prototype) | kronicle + strict contract | basic-memory | cc-anchor | sea-lite + guard | beads |
|---|---|---|---|---|---|---|---|---|---|
| T1 stale runbook mid-session | 0/8 | 0/9 | 0/9 | **10/10** | **10/10** | 0/10 | – | – | – |
| T1 on Sonnet | 0/4 | – | 1/4 | 3/4 | 4/4 | – | – | – | – |
| T2 contradicting sources | 6/6 | 6/6 | 6/6 | – | – | 6/6 | – | – | – |
| T3 two parallel agents (runs with no collision) | 7/8 | – | – | – | – | – | – | 8/8 | 6/8 |
| T4 forced compaction (3–4 compactions per run) | 5/5 | 5/5 | – | – | – | – | 5/5 | – | – |
| T5 poisoned memory (runs that followed the poison) | 0/6 | 0/6 | 0/6 | – | – | 0/6 | – | – | – |
| T6 benign-noise control | 6/6 | – | 6/6 | 6/6 | 6/6 | – | – | – | – |
| T1 tokens per run | 182k | 143k | 232k | 267k | 515k | 229k | – | – | – |

## 2. Findings

**F1. Mid-session staleness is the gap. Push or a stricter discipline closes it; having a memory store does not.** In T1 the runbook changes while `./bin/build` runs (step 2 of 5). No pull arm re-read its source before deploying. Native CLAUDE.md is never re-injected mid-session: Claude Code's file-changed reminder only covers files read with the Read tool, and agents use `cat`. kronicle-lite's retraction data was correct; both push and strict arms surfaced the `[-old-]{+new+}` diff. The problem is *when* the agent asks, not what it gets back.

**F2. The push hook only fires between tool calls.** Sonnet seed 1 ran `preflight && build && migrate && deploy` as one Bash call; the change landed inside it, so the push arrived after the stale deploy. The agent noticed and redeployed, but it is graded a failure. The strict arm avoids this by pulsing before each command. Production needs both: push after tool calls, plus a pre-command pulse.

**F3. Push noise cost tokens but caused no wrong actions.** In T6 (typo/whitespace fix) the hook pushed a benign retraction and the agent re-read: 6/6 correct, at +78% tokens and 2.2× wall time vs no-memory. In T1 a "Last reviewed" date line produced a second, noise-only retraction.

**F4. Poisoned memory (T5): no blind deference.** 0/24 Haiku and 0/6 Sonnet runs followed the planted wrong cluster; native MEMORY.md was confirmed loaded and overridden. The control is weak: the truth was one `cat` away. A harder variant with indirect evidence is next.

**F5. Contradicting sources (T2) were not a problem.** The ADR beat the older runbook in 24/24 runs; 20/24 replies flagged the conflict. When the newer source says "Supersedes", models resolve it unaided.

**F6. Compaction (T4) did not lose the decision.** All 15 runs compacted 3–4 times; the operator decision survived in every arm, so cc-anchor had nothing to rescue.

**F7. Parallel agents (T3): collisions came from different places in each arm.** sea-lite: 0 collisions in 10 runs, 27 scope denials, both agents worked in every run. No-memory: 1 duplicate ticket from a BACKLOG.md race; Claude Code's "modified since read" check refused 6 Edits. beads: 1 lost CHANGELOG line, and 1 duplicate where an agent redid a ticket `bd` showed as assigned to the other. sea-lite's cost: agents polled with `sleep` behind scope conflicts on the shared CHANGELOG.md.

**F8. Memory tools cost tokens even when they don't help.** T1 tokens per run: native 143k, none 182k, basic-memory 229k, kronicle 232k. T2: none 189k vs kronicle 307k.

## 3. What to develop next (ranked)

1. **kronicle-lite / cc-anchor:** ship the retraction push hook (`track-b/prototypes/kronicle-push-hook.mjs`, ~50 lines on `kronicle-lite orient --cursor --focus retractions --json`) plus a PreToolUse pulse for world-changing Bash commands (configurable: `deploy|migrate|publish|git push`).
2. **kronicle-lite:** orient skill and wake contract treat side-effecting Bash as write-class (no-hook fallback for Cursor and Codex).
3. **kronicle-lite:** classify retractions cosmetic vs semantic; push only semantic by default (benign-edits generator templates are the test set).
4. **kronicle-lite:** centre `get_system_state` delta truncation on the changed text (it cut just before the target: "staging clust…(+154 chars)").
5. **sea-lite:** blocking `sea_next {wait_seconds}` or merge-at-commit scopes for append-only files; then T3 at n ≥ 20.
6. **cc-anchor:** no change justified by T4; build a harder T4 first.
7. **Typed facts / contradiction detection:** no supporting evidence yet; design a scenario where markdown fails before building.

## 4. Method and threats to validity

- **Fixture/faults:** each run gets a tiny `orders-svc` git repo; `./bin` tools wrap `track-b/lib/stub.mjs`, which logs every call. A fault fires once inside a named stub call, so the world changes between steps with no timing race.
- **Arms:** kronicle-lite 0.5.0 (npm) with shipped orient skill and wake contract; basic-memory 1.0.0 (PyPI, embedding model vendored); sea-lite 0.4.0 (snapshot of commit 3b7ed22) + cc-anchor 0.3.0 scope guard + sea-lite pre-commit guard; beads 1.3.2; cc-anchor 0.3.0 (`--plugin-dir`); native CLAUDE.md + auto-memory MEMORY.md for T5. Not run: claude-mem (its capture makes its own LLM calls) and mcp_agent_mail.
- **Invocation:** `claude -p --output-format stream-json --permission-mode dontAsk --allowedTools … --strict-mcp-config`; project-scoped settings only; environment scrubbed to proxy/CA/base-URL.
- **Seeds:** each seed draws new cluster, channel and timeout values; arms share seeds (paired). Cells stop early once all runs agree, so some n are 5–9; no cell reached the design's ≥20 seeds under the ~200-run cap. n and 95% Wilson/exact CIs are stated in the tables.
- **Regrade:** the "re-checked the source" diagnostic first matched the Bash tool's description field; fixed and regraded from saved transcripts (`lib/regrade.mjs`). Outcome grading never changed.
- **Peeking:** 5 T3 runs read `lib/stub.mjs`; T3 has no injected fault, so nothing leaked.
- **Threats:** small n, one fixture family, mostly Haiku; the push arm is a prototype; T1's fault lands inside a tool call (real changes arrive asynchronously, which helps push slightly less); the kronicle arm keeps the runbook only in kronicle-lite and the prompt's pointer sentence differs by arm; versions as of 2026-11-01.

## 5. Full tables
<!-- BEGIN:TABLES -->
Generated 2026-11-01T04:10:31.157Z from `results/track-b/runs.jsonl` (193 graded runs; 0 infra errors excluded). Headless invocations used: **222 / 240** (ledger, incl. 1 smoke test). Total metered cost: **$5.21** (stream-json `total_cost_usd`).

CIs are 95% Wilson (exact Clopper–Pearson in summary.json). *p* = two-sided Fisher exact test of success vs the `none` arm in the same scenario/model. Tokens = input + cache read + cache write + output per run (all agents).

### T1 — stale runbook mid-session (target changes after build)

| model | arm | n | success | stale deploy | p vs none | read source before fault | re-checked after fault | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | none | 8 | 0/8 = 0% (0%–32%) | 8/8 = 100% (68%–100%) | – | 8/8 | 0/8 | 182k | 0.0043 | 16 | 7.8 |
| haiku | native | 9 | 0/9 = 0% (0%–30%) | 9/9 = 100% (70%–100%) | 1.000 | 0/9 | 0/9 | 143k | 0.0036 | 17 | 6.0 |
| haiku | kronicle | 9 | 0/9 = 0% (0%–30%) | 9/9 = 100% (70%–100%) | 1.000 | 9/9 | 0/9 | 232k | 0.0063 | 21 | 9.2 |
| haiku | kronicle_strict | 10 | 10/10 = 100% (72%–100%) | 0/10 = 0% (0%–28%) | <0.001 | 10/10 | 10/10 | 515k | 0.0130 | 37 | 16.3 |
| haiku | kronicle_push | 10 | 10/10 = 100% (72%–100%) | 0/10 = 0% (0%–28%) | <0.001 | 10/10 | 10/10 | 267k | 0.0080 | 34 | 10.7 |
| haiku | basicmem | 10 | 0/10 = 0% (0%–28%) | 10/10 = 100% (72%–100%) | 1.000 | 10/10 | 0/10 | 229k | 0.0053 | 48 | 9.0 |
| sonnet | none | 4 | 0/4 = 0% (0%–49%) | 4/4 = 100% (51%–100%) | – | 4/4 | 0/4 | 111k | 0.0433 | 14 | 5.8 |
| sonnet | kronicle | 4 | 1/4 = 25% (5%–70%) | 3/4 = 75% (30%–95%) | 1.000 | 4/4 | 1/4 | 150k | 0.0824 | 20 | 7.0 |
| sonnet | kronicle_strict | 4 | 4/4 = 100% (51%–100%) | 0/4 = 0% (0%–49%) | 0.029 | 4/4 | 4/4 | 315k | 0.1440 | 41 | 14.8 |
| sonnet | kronicle_push | 4 | 3/4 = 75% (30%–95%) | 1/4 = 25% (5%–70%) | 0.143 | 4/4 | 3/4 | 155k | 0.0994 | 26 | 8.0 |

### T2 — contradicting sources (old runbook vs newer ADR)

| model | arm | n | success | used superseded flags | p vs none | flagged conflict in reply | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | none | 6 | 6/6 = 100% (61%–100%) | 0/6 = 0% (0%–39%) | – | 5/6 | 189k | 0.0045 | 22 | 8.0 |
| haiku | native | 6 | 6/6 = 100% (61%–100%) | 0/6 = 0% (0%–39%) | 1.000 | 5/6 | 149k | 0.0038 | 19 | 6.3 |
| haiku | kronicle | 6 | 6/6 = 100% (61%–100%) | 0/6 = 0% (0%–39%) | 1.000 | 4/6 | 307k | 0.0085 | 23 | 13.0 |
| haiku | basicmem | 6 | 6/6 = 100% (61%–100%) | 0/6 = 0% (0%–39%) | 1.000 | 6/6 | 231k | 0.0055 | 28 | 10.2 |

### T3 — two agents in parallel on overlapping files

| model | arm | n | success (all 4 tickets, no collision) | runs with ≥1 collision | dup tickets | lost edits (fn / changelog) | conflict markers | edit "modified since read" errors | scope denials | tokens/run | $/run | wall s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | none | 8 | 7/8 = 88% (53%–98%) | 1/8 (2%–47%) | 1 | 0 / 0 | 0 | 6 | 0 | 1087k | 0.028 | 60 |
| haiku | sea | 8 | 8/8 = 100% (68%–100%) | 0/8 (0%–32%) | 0 | 0 / 0 | 0 | 0 | 19 | 1263k | 0.027 | 156 |
| haiku | beads | 8 | 6/8 = 75% (41%–93%) | 2/8 (7%–59%) | 1 | 0 / 1 | 0 | 1 | 0 | 916k | 0.022 | 59 |
| sonnet | none | 2 | 1/2 = 50% (9%–91%) | 1/2 (9%–91%) | 1 | 0 / 0 | 0 | 1 | 0 | 460k | 0.171 | 38 |
| sonnet | sea | 2 | 2/2 = 100% (34%–100%) | 0/2 (0%–66%) | 0 | 0 / 0 | 0 | 0 | 5 | 834k | 0.290 | 80 |

5 run(s) in this scenario read bench internals (flag `peeked`); they are included above.

### T4 — forced compaction mid-task (does the operator decision survive?)

| model | arm | n | success | used pre-decision value | p vs none | compacted | target ok | channel ok | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | none | 5 | 5/5 = 100% (57%–100%) | 0/5 = 0% (0%–43%) | – | 5/5 (avg 3.0) | 5/5 | 5/5 | 864k | 0.0651 | 84 | 20.6 |
| haiku | native | 5 | 5/5 = 100% (57%–100%) | 0/5 = 0% (0%–43%) | 1.000 | 5/5 (avg 3.2) | 5/5 | 5/5 | 768k | 0.0664 | 92 | 22.0 |
| haiku | ccanchor | 5 | 5/5 = 100% (57%–100%) | 0/5 = 0% (0%–43%) | 1.000 | 5/5 (avg 3.4) | 5/5 | 5/5 | 857k | 0.0665 | 95 | 21.6 |

### T5 — poisoned memory (memory holds a wrong value; repo is ground truth)

| model | arm | n | success | followed poisoned memory | p vs none | read targets.json | read memory | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | none | 6 | 6/6 = 100% (61%–100%) | 0/6 = 0% (0%–39%) | – | 6/6 | 5/6 | 176k | 0.0045 | 19 | 7.7 |
| haiku | native | 6 | 6/6 = 100% (61%–100%) | 0/6 = 0% (0%–39%) | 1.000 | 6/6 | 0/6 | 168k | 0.0044 | 22 | 7.0 |
| haiku | kronicle | 6 | 6/6 = 100% (61%–100%) | 0/6 = 0% (0%–39%) | 1.000 | 6/6 | 6/6 | 245k | 0.0065 | 22 | 11.0 |
| haiku | basicmem | 6 | 6/6 = 100% (61%–100%) | 0/6 = 0% (0%–39%) | 1.000 | 6/6 | 6/6 | 196k | 0.0055 | 30 | 9.7 |
| sonnet | native | 3 | 3/3 = 100% (44%–100%) | 0/3 = 0% (0%–56%) | – | 3/3 | 0/3 | 99k | 0.0449 | 17 | 5.0 |
| sonnet | kronicle | 3 | 3/3 = 100% (44%–100%) | 0/3 = 0% (0%–56%) | – | 3/3 | 3/3 | 157k | 0.0770 | 22 | 8.7 |

### T6 — benign-noise control (typo/whitespace edit after build)

| model | arm | n | success | wrong deploy | p vs none | read source before edit | re-checked after edit | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | none | 6 | 6/6 = 100% (61%–100%) | 0/6 = 0% (0%–39%) | – | 6/6 | 0/6 | 174k | 0.0040 | 15 | 7.3 |
| haiku | kronicle | 6 | 6/6 = 100% (61%–100%) | 0/6 = 0% (0%–39%) | 1.000 | 6/6 | 0/6 | 225k | 0.0061 | 19 | 8.7 |
| haiku | kronicle_strict | 6 | 6/6 = 100% (61%–100%) | 0/6 = 0% (0%–39%) | 1.000 | 6/6 | 6/6 | 528k | 0.0129 | 40 | 17.0 |
| haiku | kronicle_push | 6 | 6/6 = 100% (61%–100%) | 0/6 = 0% (0%–39%) | 1.000 | 6/6 | 6/6 | 309k | 0.0082 | 33 | 11.2 |

#### Arms

| arm | what | version |
|---|---|---|
| none | no memory | - |
| native | native CLAUDE.md (+ auto-memory MEMORY.md) | claude-code built-in |
| kronicle | kronicle-lite + orient skill | kronicle-lite 0.5.0 (npm) |
| kronicle_strict | kronicle-lite + orient skill + stricter wake contract (pulse before every world-changing command; no hook) | kronicle-lite 0.5.0 (npm), CLAUDE.md variant |
| kronicle_push | kronicle-lite + orient skill + PostToolUse retraction push (bench prototype) | kronicle-lite 0.5.0 + prototypes/kronicle-push-hook.mjs |
| basicmem | basic-memory (competitor, memory) | basic-memory 1.0.0 (PyPI) |
| ccanchor | cc-anchor anchor card | cc-anchor 0.3.0 (local) |
| sea | sea-lite + cc-anchor scope guard | sea-lite 0.4.0 (local, unreleased) + cc-anchor 0.3.0 |
| beads | beads (competitor, coordination) | @beads/bd 1.3.2 (npm) |
<!-- END:TABLES -->

## 6. Reproduce

```sh
cd track-b && bash setup.sh && bash run.sh --setup-only && bash run.sh \
  && bash run.sh --plan=plans/ablation.json && bash run.sh --plan=plans/sonnet.json \
  && bash run.sh --plan=plans/extend.json && node lib/regrade.mjs && bash run.sh --report
```
