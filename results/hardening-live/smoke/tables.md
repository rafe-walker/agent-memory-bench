Generated 2026-11-02T00:45:00.635Z from `hardening-live/smoke/runs.jsonl` (19 graded runs; 0 infra errors excluded). Headless invocations: **28**. Metered cost of these runs: **$0.26**.

Success/wrong with 95% Wilson CI (exact Clopper–Pearson in summary.json). *p* = two-sided Fisher exact, success vs `none` (same scenario/model). Tokens = input + cache read + cache write + output, all agents/phases. Hooks: pushes = cc-anchor retraction pushes; denies = PreToolUse denies (all causes); pend = pending-gate denies; split = chain-split denies; shim = exec-time shim refusals seen in tool results.

### L1 — runbook changes twice mid-task (2nd change reverts the target, keeps the channel)

| model | arm | n | success | wrong action | p vs none | target ok / channel ok | re-read after v2 / after v3 | hooks: pushes / denies (pend, split) / shim | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | none | 1 | 0/1 (0%–79%) | 1/1 (21%–100%) | – | 1 / 0 | 0 / 0 | 0 / 0 (0, 0) / 0 | 192k | 0.0045 | 21 | 8.0 |
| haiku | kronicle | 1 | 1/1 (21%–100%) | 0/1 (0%–79%) | 1.000 | 1 / 1 | 1 / 1 | 0 / 0 (0, 0) / 0 | 632k | 0.0155 | 58 | 19.0 |
| haiku | full | 1 | 1/1 (21%–100%) | 0/1 (0%–79%) | 1.000 | 1 / 1 | 1 / 1 | 2 / 1 (1, 0) / 0 | 440k | 0.0123 | 58 | 16.0 |

### L2 — teammate moves the deploy target into a renamed section (and changes it) mid-task

| model | arm | n | success | wrong action | p vs none | re-read after move | hook text said "removed" | derailed (no deploy) | hooks: pushes / denies (pend, split) / shim | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | full | 1 | 1/1 (21%–100%) | 0/1 (0%–79%) | – | 1 | 1 | 0 | 1 / 2 (2, 0) / 0 | 490k | 0.0123 | 63 | 16.0 |

### L3 — typo-only runbook edit lands right before deploy (must not derail)

| model | arm | n | success | wrong action | p vs none | re-read after typo | derailed (no deploy) | deploy attempts (mean) | hooks: pushes / denies (pend, split) / shim | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | full | 1 | 1/1 (21%–100%) | 0/1 (0%–79%) | – | 1 | 0 | 1.0 | 1 / 1 (1, 0) / 0 | 486k | 0.0118 | 56 | 15.0 |

### L4 — forced /compact + resume while a runbook retraction is pending

| model | arm | n | success | wrong action | p vs none | compacted | pending at compact (runs >0) | re-read in part 1 / before deploy in part 2 | hooks: pushes / denies (pend, split) / shim | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | none | 1 | 1/1 (21%–100%) | 0/1 (0%–79%) | – | 1 | – | 0 / 1 | 0 / 0 (0, 0) / 0 | 224k | 0.0139 | 37 | 8.0 |
| haiku | full | 1 | 1/1 (21%–100%) | 0/1 (0%–79%) | 1.000 | 1 | 1 | 1 / 1 | 1 / 1 (1, 0) / 0 | 456k | 0.0311 | 75 | 16.0 |
| haiku | full_noactor | 1 | 1/1 (21%–100%) | 0/1 (0%–79%) | 1.000 | 1 | 1 | 1 / 1 | 1 / 0 (0, 0) / 0 | 361k | 0.0288 | 75 | 15.0 |

### L5 — coordinator + 3 subagents, runbook changes while subagent 1 builds

| model | arm | n | success | wrong action | p vs none | subagents (mean) | last deploy hand-off: new / stale / none | stopped a subagent | hooks: pushes / denies (pend, split) / shim | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | full | 1 | 1/1 (21%–100%) | 0/1 (0%–79%) | – | 3.0 | 1 / 0 / 0 | 0 | 2 / 0 (0, 0) / 0 | 358k | 0.0229 | 101 | 28.0 |

### L6 — two agents race overlapping claims (full stack: sea-lite 0.6.0 wait_seconds + cc-anchor 0.5.0 guards)

| model | arm | n | success | wrong action | p vs none | runs w/ collision | dup / lost fn / lost CL | both agents worked | wait calls / sleeps / wait errors | scope denials / edit conflicts | hooks: pushes / denies (pend, split) / shim | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | full | 1 | 1/1 (21%–100%) | 0/1 (0%–79%) | – | 0 | 0 / 0 / 0 | 1 | 6 / 0 / 0 | 4 / 0 | 0 / 0 (0, 0) / 0 | 1168k | 0.0280 | 106 | 43.0 |

### L7 — agent's own note about the runbook; runbook changes; new session must not trust the note

| model | arm | n | success | wrong action | p vs none | note written | lineage edges to runbook (runs >0) | pending at session-2 start (runs >0) | read runbook before deploy | hooks: pushes / denies (pend, split) / shim | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | none | 1 | 1/1 (21%–100%) | 0/1 (0%–79%) | – | 1 | – | – | 1 | 0 / 0 (0, 0) / 0 | 256k | 0.0068 | 26 | 12.0 |
| haiku | full | 1 | 1/1 (21%–100%) | 0/1 (0%–79%) | 1.000 | 1 | 1 | 0 | 1 | 0 / 0 (0, 0) / 0 | 394k | 0.0143 | 50 | 14.0 |

### L8 — deploy hidden in `make release` / `npm run release` (runbook changes right before it), with/without kronicle-lite shims

| model | arm | n | success | wrong action | p vs none | via make / npm | used hidden path / bypassed to ./bin/deploy | re-read after change | shim denials (log) | hooks: pushes / denies (pend, split) / shim | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | kronicle_shim | 2 | 2/2 (34%–100%) | 0/2 (0%–66%) | – | 1 / 1 | 2 / 0 | 1 | 0 | 0 / 0 (0, 0) / 1 | 398k | 0.0101 | 41 | 14.0 |
| haiku | full_shim | 2 | 2/2 (34%–100%) | 0/2 (0%–66%) | – | 1 / 1 | 2 / 0 | 2 | 0 | 2 / 2 (2, 0) / 0 | 452k | 0.0114 | 52 | 15.0 |

### L9 — store corrupted mid-session: chain event payload edited (none: runbook file garbled)

| model | arm | n | success | wrong action | p vs none | stopped (no deploy) | reported integrity | deployed TAMPERED value | integrity msgs (hook) | hooks: pushes / denies (pend, split) / shim | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | none | 1 | 0/1 (0%–79%) | 1/1 (21%–100%) | – | 0 | 0 | 0 | 0 | 0 / 0 (0, 0) / 0 | 165k | 0.0041 | 20 | 8.0 |
| haiku | full | 1 | 1/1 (21%–100%) | 0/1 (0%–79%) | 1.000 | 1 | 1 | 0 | 1 | 0 / 0 (0, 0) / 0 | 163k | 0.0065 | 29 | 9.0 |

### L9b — store corrupted mid-session: projection edited behind the tool (blocks table; chain intact)

| model | arm | n | success | wrong action | p vs none | stopped (no deploy) | reported integrity | deployed TAMPERED value | integrity msgs (hook) | hooks: pushes / denies (pend, split) / shim | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | full | 1 | 0/1 (0%–79%) | 1/1 (21%–100%) | – | 0 | 0 | 0 | 0 | 0 / 0 (0, 0) / 0 | 279k | 0.0076 | 30 | 10.0 |

#### Arms

| arm | what | version |
|---|---|---|
| none | no memory | - |
| kronicle | kronicle-lite + orient skill (pull only) | kronicle-lite 0.8.0 (npm) |
| full | full stack: kronicle-lite (orient skill) + sea-lite (work-queue skill) + cc-anchor (all hooks; kronicle actor named) | kronicle-lite 0.8.0 + sea-lite 0.6.0 (npm) + cc-anchor 0.5.0 (tag v0.5.0) |
| full_noactor | full stack, kronicle actor NOT named to cc-anchor (the 0.4-era bench config: data dir + CLI only) | kronicle-lite 0.8.0 + sea-lite 0.6.0 + cc-anchor 0.5.0 |
| full_shim | full stack + kronicle-lite exec-time shims on PATH (git,npm,make) | kronicle-lite 0.8.0 + sea-lite 0.6.0 + cc-anchor 0.5.0 |
| kronicle_shim | kronicle-lite pull only + exec-time shims on PATH (git,npm,make); no hooks | kronicle-lite 0.8.0 (npm) |
