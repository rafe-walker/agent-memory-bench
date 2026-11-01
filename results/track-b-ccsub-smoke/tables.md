Generated 2026-11-01T15:53:35.073Z from `results/track-b/runs.jsonl` (2 graded runs; 0 infra errors excluded). Headless invocations used: **2 / 240** (ledger, incl. 1 smoke test). Total metered cost: **$0.04** (stream-json `total_cost_usd`).

CIs are 95% Wilson (exact Clopper–Pearson in summary.json). *p* = two-sided Fisher exact test of success vs the `none` arm in the same scenario/model. Tokens = input + cache read + cache write + output per run (all agents).

### T7 — coordinator + two subagents, runbook changes during subagent 1

| model | arm | n | success | stale deploy | p vs none | deployed only to the new target | last deploy hand-off names new target | coordinator stopped a subagent | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | kronicle_ccpush | 1 | 1/1 = 100% (21%–100%) | 0/1 = 0% (0%–79%) | – | 1/1 | 1/1 | 0/1 | 284k | 0.0222 | 100 | 25.0 |
| haiku | kronicle_ccsub | 1 | 0/1 = 0% (0%–79%) | 0/1 = 0% (0%–79%) | – | 1/1 | 1/1 | 0/1 | 155k | 0.0130 | 61 | 15.0 |

#### Arms

| arm | what | version |
|---|---|---|
| none | no memory | - |
| native | native CLAUDE.md (+ auto-memory MEMORY.md) | claude-code built-in |
| kronicle | kronicle-lite + orient skill | kronicle-lite 0.5.0 (npm) |
| kronicle_strict | kronicle-lite + orient skill + stricter wake contract (pulse before every world-changing command; no hook) | kronicle-lite 0.5.0 (npm), CLAUDE.md variant |
| kronicle_push | kronicle-lite + orient skill + PostToolUse retraction push (bench prototype) | kronicle-lite 0.5.0 + prototypes/kronicle-push-hook.mjs |
| kronicle_ccpush | kronicle-lite + orient skill + cc-anchor retraction push + pulse (shipped hooks) | kronicle-lite 0.5.0 + cc-anchor push-hook (vendor/cc-anchor-push, see VERSION) |
| kronicle_ccsub | kronicle-lite + orient skill + cc-anchor next-cycle (per-subagent retraction cursors) | kronicle-lite 0.5.0 + cc-anchor next-cycle (vendor/cc-anchor-next, see VERSION) |
| basicmem | basic-memory (competitor, memory) | basic-memory 1.0.0 (PyPI) |
| ccanchor | cc-anchor anchor card | cc-anchor 0.3.0 (local) |
| sea | sea-lite + cc-anchor scope guard | sea-lite 0.4.0 (local, unreleased) + cc-anchor 0.3.0 |
| beads | beads (competitor, coordination) | @beads/bd 1.3.2 (npm) |
