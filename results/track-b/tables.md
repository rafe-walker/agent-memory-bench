Generated 2026-11-01T18:23:18.618Z from `results/track-b/runs.jsonl` (88 graded runs; 0 infra errors excluded). Headless invocations used: **118** (ledger). Total metered cost of the graded runs: **$1.17** (stream-json `total_cost_usd`).

CIs are 95% Wilson (exact Clopper–Pearson in summary.json). *p* = two-sided Fisher exact test of success vs the `none` arm in the same scenario/model. Tokens = input + cache read + cache write + output per run (all agents).

### T1 — stale runbook mid-session (target changes after build)

| model | arm | n | success | stale deploy | p vs none | read source before fault | re-checked after fault | runs with a retraction push (mean pushes) | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | none | 10 | 0/10 = 0% (0%–28%) | 10/10 = 100% (72%–100%) | – | 10/10 | 0/10 | 0/10 (0.0) | 175k | 0.0042 | 15 | 7.6 |
| haiku | native | 10 | 0/10 = 0% (0%–28%) | 10/10 = 100% (72%–100%) | 1.000 | 0/10 | 0/10 | 0/10 (0.0) | 153k | 0.0037 | 14 | 6.5 |
| haiku | kronicle | 10 | 8/10 = 80% (49%–94%) | 2/10 = 20% (6%–51%) | <0.001 | 10/10 | 10/10 | 0/10 (0.0) | 448k | 0.0113 | 36 | 14.6 |
| haiku | kronicle_ccpush | 10 | 10/10 = 100% (72%–100%) | 0/10 = 0% (0%–28%) | <0.001 | 10/10 | 10/10 | 10/10 (1.0) | 354k | 0.0093 | 32 | 13.1 |

### T3 — two agents in parallel on overlapping files

| model | arm | n | success (all 4 tickets, no collision) | runs with ≥1 collision | dup tickets | lost edits (fn / changelog) | conflict markers | edit "modified since read" errors | scope denials | tokens/run | $/run | wall s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | none | 10 | 6/10 = 60% (31%–83%) | 4/10 (17%–69%) | 1 | 0 / 3 | 0 | 4 | 0 | 796k | 0.021 | 51 |
| haiku | sea | 10 | 10/10 = 100% (72%–100%) | 0/10 (0%–28%) | 0 | 0 / 0 | 0 | 0 | 30 | 1373k | 0.028 | 170 |
| haiku | beads | 10 | 9/10 = 90% (60%–98%) | 1/10 (2%–40%) | 1 | 0 / 0 | 0 | 0 | 0 | 804k | 0.020 | 53 |

5 run(s) in this scenario read bench internals (flag `peeked`); they are included above.

### T7 — coordinator + two subagents, runbook changes during subagent 1

| model | arm | n | success | stale deploy | p vs none | all 5 steps | deployed only to the new target | last deploy hand-off names new target | coordinator stopped a subagent | runs with a retraction push (mean pushes) | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | kronicle_ccpush | 6 | 5/6 = 83% (44%–97%) | 1/6 = 17% (3%–56%) | – | 5/6 | 5/6 | 5/6 | 0/6 | 6/6 (1.0) | 147k | 0.0179 | 66 | 21.3 |

### T6 — benign-noise control (typo/whitespace edit after build)

| model | arm | n | success | wrong deploy | p vs none | read source before edit | re-checked after edit | runs with a retraction push (mean pushes) | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | none | 6 | 6/6 = 100% (61%–100%) | 0/6 = 0% (0%–39%) | – | 6/6 | 0/6 | 0/6 (0.0) | 175k | 0.0042 | 15 | 7.7 |
| haiku | kronicle_ccpush | 6 | 6/6 = 100% (61%–100%) | 0/6 = 0% (0%–39%) | 1.000 | 6/6 | 6/6 | 6/6 (1.0) | 324k | 0.0086 | 31 | 12.0 |

#### Arms

| arm | what | version |
|---|---|---|
| none | no memory | - |
| native | native CLAUDE.md (+ auto-memory MEMORY.md) | claude-code built-in |
| kronicle | kronicle-lite + orient skill (pull only) | kronicle-lite 0.7.0 (npm) |
| kronicle_ccpush | kronicle-lite + orient skill + cc-anchor retraction push + pulse (all hooks at defaults) | kronicle-lite 0.7.0 (npm) + cc-anchor 0.4.0 (tag v0.4.0, vendor/cc-anchor/VERSION) |
| sea | sea-lite + cc-anchor scope guard | sea-lite 0.5.0 (npm) + cc-anchor 0.4.0 (tag v0.4.0); no wait_seconds in 0.5.0 |
| beads | beads (competitor, coordination) | @beads/bd 1.3.2 (npm) |
