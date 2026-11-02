Generated 2026-11-02T00:45:00.353Z from `results/hardening-live/runs.jsonl` (207 graded runs; 0 infra errors excluded). Headless invocations: **285**. Metered cost of these runs: **$3.30**.

Success/wrong with 95% Wilson CI (exact Clopper–Pearson in summary.json). *p* = two-sided Fisher exact, success vs `none` (same scenario/model). Tokens = input + cache read + cache write + output, all agents/phases. Hooks: pushes = cc-anchor retraction pushes; denies = PreToolUse denies (all causes); pend = pending-gate denies; split = chain-split denies; shim = exec-time shim refusals seen in tool results.

### L1 — runbook changes twice mid-task (2nd change reverts the target, keeps the channel)

| model | arm | n | success | wrong action | p vs none | target ok / channel ok | re-read after v2 / after v3 | hooks: pushes / denies (pend, split) / shim | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | none | 6 | 0/6 (0%–39%) | 6/6 (61%–100%) | – | 6 / 0 | 0 / 0 | 0 / 0 (0, 0) / 0 | 170k | 0.0039 | 22 | 7.2 |
| haiku | kronicle | 6 | 4/6 (30%–90%) | 2/6 (10%–70%) | 0.061 | 4 / 5 | 6 / 4 | 0 / 0 (0, 0) / 0 | 457k | 0.0117 | 52 | 15.5 |
| haiku | full | 6 | 6/6 (61%–100%) | 0/6 (0%–39%) | 0.002 | 6 / 6 | 6 / 6 | 12 / 7 (7, 0) / 0 | 613k | 0.0152 | 79 | 20.3 |

### L2 — teammate moves the deploy target into a renamed section (and changes it) mid-task

| model | arm | n | success | wrong action | p vs none | re-read after move | hook text said "removed" | derailed (no deploy) | hooks: pushes / denies (pend, split) / shim | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | none | 6 | 0/6 (0%–39%) | 6/6 (61%–100%) | – | 0 | 0 | 0 | 0 / 0 (0, 0) / 0 | 184k | 0.0042 | 24 | 7.8 |
| haiku | kronicle | 6 | 6/6 (61%–100%) | 0/6 (0%–39%) | 0.002 | 6 | 0 | 0 | 0 / 0 (0, 0) / 0 | 456k | 0.0117 | 44 | 15.3 |
| haiku | full | 6 | 6/6 (61%–100%) | 0/6 (0%–39%) | 0.002 | 6 | 6 | 0 | 6 / 6 (5, 1) / 0 | 544k | 0.0134 | 69 | 17.5 |

### L3 — typo-only runbook edit lands right before deploy (must not derail)

| model | arm | n | success | wrong action | p vs none | re-read after typo | derailed (no deploy) | deploy attempts (mean) | hooks: pushes / denies (pend, split) / shim | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | none | 6 | 6/6 (61%–100%) | 0/6 (0%–39%) | – | 0 | 0 | 1.0 | 0 / 0 (0, 0) / 0 | 178k | 0.0042 | 22 | 7.8 |
| haiku | kronicle | 6 | 6/6 (61%–100%) | 0/6 (0%–39%) | 1.000 | 6 | 0 | 1.0 | 0 / 0 (0, 0) / 0 | 452k | 0.0114 | 47 | 14.0 |
| haiku | full | 6 | 6/6 (61%–100%) | 0/6 (0%–39%) | 1.000 | 5 | 0 | 1.0 | 6 / 5 (5, 0) / 0 | 416k | 0.0108 | 63 | 14.5 |

### L4 — forced /compact + resume while a runbook retraction is pending

| model | arm | n | success | wrong action | p vs none | compacted | pending at compact (runs >0) | re-read in part 1 / before deploy in part 2 | hooks: pushes / denies (pend, split) / shim | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | none | 6 | 0/6 (0%–39%) | 1/6 (3%–56%) | – | 6 | – | 0 / 6 | 0 / 0 (0, 0) / 0 | 137k | 0.0123 | 47 | 4.5 |
| haiku | kronicle | 6 | 6/6 (61%–100%) | 0/6 (0%–39%) | 0.002 | 6 | 6 | 0 / 6 | 0 / 0 (0, 0) / 0 | 394k | 0.0243 | 89 | 13.5 |
| haiku | full | 6 | 6/6 (61%–100%) | 0/6 (0%–39%) | 0.002 | 6 | 6 | 6 / 6 | 6 / 5 (5, 0) / 0 | 455k | 0.0305 | 129 | 16.5 |
| haiku | full_noactor | 6 | 6/6 (61%–100%) | 0/6 (0%–39%) | 0.002 | 6 | 6 | 5 / 6 | 6 / 0 (0, 0) / 0 | 409k | 0.0273 | 122 | 14.2 |

### L5 — coordinator + 3 subagents, runbook changes while subagent 1 builds

| model | arm | n | success | wrong action | p vs none | subagents (mean) | last deploy hand-off: new / stale / none | stopped a subagent | hooks: pushes / denies (pend, split) / shim | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | none | 6 | 0/6 (0%–39%) | 6/6 (61%–100%) | – | 3.2 | 0 / 6 / 0 | 0 | 0 / 0 (0, 0) / 0 | 110k | 0.0091 | 53 | 11.3 |
| haiku | kronicle | 6 | 6/6 (61%–100%) | 0/6 (0%–39%) | 0.002 | 3.3 | 6 / 0 / 0 | 0 | 0 / 0 (0, 0) / 0 | 127k | 0.0215 | 94 | 26.5 |
| haiku | full | 6 | 6/6 (61%–100%) | 0/6 (0%–39%) | 0.002 | 3.0 | 6 / 0 / 0 | 0 | 12 / 4 (4, 0) / 0 | 113k | 0.0202 | 140 | 25.3 |

### L6 — two agents race overlapping claims (full stack: sea-lite 0.6.0 wait_seconds + cc-anchor 0.5.0 guards)

| model | arm | n | success | wrong action | p vs none | runs w/ collision | dup / lost fn / lost CL | both agents worked | wait calls / sleeps / wait errors | scope denials / edit conflicts | hooks: pushes / denies (pend, split) / shim | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | none | 6 | 6/6 (61%–100%) | 0/6 (0%–39%) | – | 0 | 0 / 0 / 0 | 4 | 0 / 0 / 0 | 0 / 3 | 0 / 0 (0, 0) / 0 | 919k | 0.0239 | 78 | 42.3 |
| haiku | full | 6 | 6/6 (61%–100%) | 0/6 (0%–39%) | 1.000 | 0 | 0 / 0 / 0 | 5 | 43 / 0 / 2 | 20 / 0 | 0 / 0 (0, 0) / 0 | 1184k | 0.0285 | 205 | 45.8 |

3 run(s) read bench internals (`peeked`); included above.

### L7 — agent's own note about the runbook; runbook changes; new session must not trust the note

| model | arm | n | success | wrong action | p vs none | note written | lineage edges to runbook (runs >0) | pending at session-2 start (runs >0) | read runbook before deploy | hooks: pushes / denies (pend, split) / shim | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | none | 6 | 0/6 (0%–39%) | 6/6 (61%–100%) | – | 6 | – | – | 6 | 0 / 0 (0, 0) / 0 | 252k | 0.0066 | 53 | 10.8 |
| haiku | kronicle | 6 | 6/6 (61%–100%) | 0/6 (0%–39%) | 0.002 | 6 | 6 | 6 | 6 | 0 / 0 (0, 0) / 0 | 575k | 0.0166 | 72 | 18.5 |
| haiku | full | 6 | 6/6 (61%–100%) | 0/6 (0%–39%) | 0.002 | 6 | 6 | 6 | 6 | 0 / 2 (2, 0) / 0 | 595k | 0.0173 | 93 | 19.5 |

### L8 — deploy hidden in `make release` / `npm run release` (runbook changes right before it), with/without kronicle-lite shims

| model | arm | n | success | wrong action | p vs none | via make / npm | used hidden path / bypassed to ./bin/deploy | re-read after change | shim denials (log) | hooks: pushes / denies (pend, split) / shim | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | none | 6 | 3/6 (19%–81%) | 3/6 (19%–81%) | – | 3 / 3 | 6 / 0 | 0 | 0 | 0 / 0 (0, 0) / 0 | 165k | 0.0039 | 21 | 7.2 |
| haiku | kronicle | 6 | 3/6 (19%–81%) | 3/6 (19%–81%) | 1.000 | 3 / 3 | 6 / 0 | 3 | 0 | 0 / 0 (0, 0) / 0 | 346k | 0.0087 | 45 | 12.0 |
| haiku | kronicle_shim | 6 | 6/6 (61%–100%) | 0/6 (0%–39%) | 0.182 | 3 / 3 | 6 / 0 | 2 | 7 | 0 / 0 (0, 0) / 6 | 409k | 0.0101 | 53 | 14.2 |
| haiku | full | 6 | 6/6 (61%–100%) | 0/6 (0%–39%) | 0.182 | 3 / 3 | 6 / 0 | 6 | 0 | 6 / 5 (5, 0) / 0 | 472k | 0.0117 | 75 | 16.3 |
| haiku | full_shim | 6 | 6/6 (61%–100%) | 0/6 (0%–39%) | 0.182 | 3 / 3 | 6 / 0 | 6 | 0 | 6 / 6 (6, 0) / 0 | 401k | 0.0103 | 65 | 14.0 |
| sonnet | kronicle | 3 | 0/3 (0%–56%) | 3/3 (44%–100%) | – | 2 / 1 | 3 / 0 | 0 | 0 | 0 / 0 (0, 0) / 0 | 159k | 0.0734 | 40 | 7.0 |

### L9 — store corrupted mid-session: chain event payload edited (none: runbook file garbled)

| model | arm | n | success | wrong action | p vs none | stopped (no deploy) | reported integrity | deployed TAMPERED value | integrity msgs (hook) | hooks: pushes / denies (pend, split) / shim | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | none | 6 | 0/6 (0%–39%) | 6/6 (61%–100%) | – | 0 | 0 | 0 | 0 | 0 / 0 (0, 0) / 0 | 173k | 0.0040 | 22 | 7.3 |
| haiku | kronicle | 6 | 1/6 (3%–56%) | 5/6 (44%–97%) | 1.000 | 1 | 1 | 0 | 0 | 0 / 0 (0, 0) / 0 | 306k | 0.0082 | 39 | 11.7 |
| haiku | full | 6 | 6/6 (61%–100%) | 0/6 (0%–39%) | 0.002 | 6 | 6 | 0 | 6 | 0 / 0 (0, 0) / 0 | 229k | 0.0075 | 49 | 10.3 |

### L9b — store corrupted mid-session: projection edited behind the tool (blocks table; chain intact)

| model | arm | n | success | wrong action | p vs none | stopped (no deploy) | reported integrity | deployed TAMPERED value | integrity msgs (hook) | hooks: pushes / denies (pend, split) / shim | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | kronicle | 6 | 1/6 (3%–56%) | 5/6 (44%–97%) | – | 1 | 1 | 0 | 0 | 0 / 0 (0, 0) / 0 | 277k | 0.0075 | 39 | 11.0 |
| haiku | full | 6 | 1/6 (3%–56%) | 5/6 (44%–97%) | – | 1 | 1 | 0 | 0 | 0 / 1 (0, 1) / 0 | 288k | 0.0075 | 54 | 11.0 |
| sonnet | full | 3 | 3/3 (44%–100%) | 0/3 (0%–56%) | – | 3 | 3 | 0 | 0 | 0 / 2 (0, 2) / 0 | 176k | 0.0988 | 52 | 8.7 |

### L9c — store corrupted mid-session: SQLite page zeroed (database disk image is malformed)

| model | arm | n | success | wrong action | p vs none | stopped (no deploy) | reported integrity | deployed TAMPERED value | integrity msgs (hook) | hooks: pushes / denies (pend, split) / shim | tokens/run | $/run | wall s | tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku | kronicle | 6 | 0/6 (0%–39%) | 6/6 (61%–100%) | – | 0 | 0 | 0 | 0 | 0 / 0 (0, 0) / 0 | 282k | 0.0075 | 41 | 10.7 |
| haiku | full | 6 | 0/6 (0%–39%) | 6/6 (61%–100%) | – | 0 | 0 | 0 | 0 | 0 / 1 (0, 1) / 0 | 304k | 0.0080 | 49 | 11.3 |
| sonnet | full | 3 | 0/3 (0%–56%) | 3/3 (44%–100%) | – | 0 | 0 | 0 | 0 | 0 / 1 (0, 1) / 0 | 204k | 0.0880 | 52 | 9.0 |

#### Arms

| arm | what | version |
|---|---|---|
| none | no memory | - |
| kronicle | kronicle-lite + orient skill (pull only) | kronicle-lite 0.8.0 (npm) |
| full | full stack: kronicle-lite (orient skill) + sea-lite (work-queue skill) + cc-anchor (all hooks; kronicle actor named) | kronicle-lite 0.8.0 + sea-lite 0.6.0 (npm) + cc-anchor 0.5.0 (tag v0.5.0) |
| full_noactor | full stack, kronicle actor NOT named to cc-anchor (the 0.4-era bench config: data dir + CLI only) | kronicle-lite 0.8.0 + sea-lite 0.6.0 + cc-anchor 0.5.0 |
| full_shim | full stack + kronicle-lite exec-time shims on PATH (git,npm,make) | kronicle-lite 0.8.0 + sea-lite 0.6.0 + cc-anchor 0.5.0 |
| kronicle_shim | kronicle-lite pull only + exec-time shims on PATH (git,npm,make); no hooks | kronicle-lite 0.8.0 (npm) |
