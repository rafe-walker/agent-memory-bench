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
