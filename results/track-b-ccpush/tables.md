Generated 2026-11-01T15:06:47.032Z from `results/track-b/runs.jsonl` (16 graded runs; 0 infra errors excluded). Headless invocations used: **16 / 240** (ledger, incl. 1 smoke test). Total metered cost: **$0.14** (stream-json `total_cost_usd`).

CIs are 95% Wilson (exact Clopper–Pearson in summary.json). *p* = two-sided Fisher exact test of success vs the `none` arm in the same scenario/model. Tokens = input + cache read + cache write + output per run (all agents).

### T1 — stale runbook mid-session (target changes after build)

| model | arm | n | success | stale deploy | p vs none | read source before fault | re-checked after fault | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | kronicle_ccpush | 10 | 10/10 = 100% (72%–100%) | 0/10 = 0% (0%–28%) | – | 10/10 | 10/10 | 318k | 0.0084 | 32 | 11.7 |

### T6 — benign-noise control (typo/whitespace edit after build)

| model | arm | n | success | wrong deploy | p vs none | read source before edit | re-checked after edit | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | kronicle_ccpush | 6 | 6/6 = 100% (61%–100%) | 0/6 = 0% (0%–39%) | – | 6/6 | 6/6 | 315k | 0.0085 | 28 | 11.5 |

#### Arms

| arm | what | version |
|---|---|---|
| none | no memory | - |
| native | native CLAUDE.md (+ auto-memory MEMORY.md) | claude-code built-in |
| kronicle | kronicle-lite + orient skill | kronicle-lite 0.5.0 (npm) |
| kronicle_strict | kronicle-lite + orient skill + stricter wake contract (pulse before every world-changing command; no hook) | kronicle-lite 0.5.0 (npm), CLAUDE.md variant |
| kronicle_push | kronicle-lite + orient skill + PostToolUse retraction push (bench prototype) | kronicle-lite 0.5.0 + prototypes/kronicle-push-hook.mjs |
| kronicle_ccpush | kronicle-lite + orient skill + cc-anchor retraction push + pulse (shipped hooks) | kronicle-lite 0.5.0 + cc-anchor push-hook (vendor/cc-anchor-push, see VERSION) |
| basicmem | basic-memory (competitor, memory) | basic-memory 1.0.0 (PyPI) |
| ccanchor | cc-anchor anchor card | cc-anchor 0.3.0 (local) |
| sea | sea-lite + cc-anchor scope guard | sea-lite 0.4.0 (local, unreleased) + cc-anchor 0.3.0 |
| beads | beads (competitor, coordination) | @beads/bd 1.3.2 (npm) |
