# agent-memory-bench — Track A report

Generated 2026-11-01T20:12:42.659Z by `npm run track-a` — deterministic, no LLM, $0. Seeds per randomized cell: **20**. Wall time 6769 s on 2 CPU / 8 GB, Node v22.23.4. Bench code at commit `e260ea6` plus the working tree committed with these results.

**Bottom line (released versions: kronicle-lite 0.7.0, sea-lite 0.5.0, cc-anchor 0.4.0).** On the faults where a fact *changes* (S1 stale runbook, S5 retired doc, S6 tamper) kronicle-lite is still the only arm that tells the agent what changed: 20/20 each, ✅ [84–100%], against 🟡 for files-on-disk and ❌ for the reference memory server. 0.7.0 turns five cells that the released 0.5.0 failed or half-passed into 20/20 ✅: **S4a** the decision after compaction (❌ → ✅: the post-compaction orient now inlines notes written since the cursor), **S8** a renamed file (10/20 → 20/20, no removal alarm), **S9** a planted note (🟡 → ✅, authority tags), **S10** a secret written to memory (❌ → ✅, refused at write), **S11** two repos on one store (🟡 → ✅, project-scoped recall). sea-lite is still the only coordination arm that passes all four collision variants (S3a–d, 20/20 each), and 0.5.0 removes the concurrent first-start crash (S3d errors 1 → 0). With cc-anchor's heartbeat the lease survives a long task (S13 3/3).

**Where we lose or nobody wins.** No arm flags contradictory sources (S2: 0 ✅ in 120 seeds). Every arm with a store serves the agent's own saved copy of a fact unmarked after the source changes (S1 next session: 20/20 stale for native, kronicle, basic-memory, server-memory; kronicle now labels the note `inspect_only` but does not say it changed). kronicle-lite 0.7.0 raises a retraction on 5 of the 10 benign-edit templates (S7: 10/20 quiet) — by design: typo, comma, smart-quote, missing-period and hyphenation edits are delivered, because the unreleased classifier that silenced them (20/20 quiet) also hid real changes. Its store is still 33–44× the corpus (S12), its `tools/list` grew 12.1 → 14.1 KB since 0.5.0, and its per-call latency roughly doubled (median p50 ratio 2.0× across 28 timings, vs 1.2× for the unchanged arms on the same box; still single-digit to tens of ms). sea-lite alone still lets a lease lapse mid-task (S13 🟡; the heartbeat lives in cc-anchor), and 0.5.0 has no blocking wait (S15: in the T3 pattern one agent does all the work and the other gives up, 3/3).

**Released vs pre-release, in one line:** no graded cell of ours went down; per-cell before/after with CIs is in `results/RELEASE-RERUN.md`, and the cost regressions are listed under "Changes since the pre-release run" below.

**How to read the grades.** Each cell is graded per seed against the scenario's expected signal (scenarios/*.yaml) by fixed string/regex rules in `track-a/lib/grade.mjs`: ✅ yes = the tool surfaced the fault the way the scenario expects; 🟡 partial = the agent could notice (e.g. the fresh value on re-lookup) but is not told what changed, or the signal is advisory; ❌ no = nothing, or the wrong thing, is shown. **Score** = (yes + ½·partial)/n. ◐ = mixed across seeds. · = not applicable (reason in the per-scenario table). Intervals are 95% Wilson on the yes-rate; exact Clopper–Pearson bounds are in the JSON.

## Headline matrix

| scenario | baseline | native | kronicle-lite | kronicle-lite-core | basic-memory | server-memory | cc-anchor | sea-lite | sea-lite+cc-anchor | beads | agent-mail | backlog-md | task-master |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **S1** Stale runbook | 🟡 50% | 🟡 50% | ✅ 100% | ✅ 100% | 🟡 50% | ❌ 0% |  |  |  |  |  |  |  |
| **S2** Contradicting facts | 🟡 50% | 🟡 50% | 🟡 50% | 🟡 50% | ◐ 43% | 🟡 50% |  |  |  |  |  |  |  |
| **S4a** Compaction loss | · | ✅ 100% | ✅ 100% | ✅ 100% | ✅ 100% | ✅ 100% | ✅ 100% |  |  |  |  |  |  |
| **S4b** Compaction loss | · | ❌ 0% | · | · | · | · | · |  |  |  |  |  |  |
| **S5** Retired / deleted doc still served | 🟡 50% | 🟡 50% | ✅ 100% | ✅ 100% | 🟡 50% | ❌ 0% |  |  |  |  |  |  |  |
| **S6** Tampering | · | ❌ 0% | ✅ 100% | ✅ 100% | ❌ 0% | ❌ 0% |  |  |  |  |  |  |  |
| **S7** Benign-edit noise | ✅ 100% | ❌ 0% | ◐ 50% | ◐ 50% | ✅ 100% | ✅ 100% |  |  |  |  |  |  |  |
| **S8** Moved section | ✅ 100% | ✅ 100% | ✅ 100% | ✅ 100% | ◐ 90% | ✅ 100% |  |  |  |  |  |  |  |
| **S9** Poisoned memory | · | ❌ 0% | ✅ 100% | ✅ 100% | ❌ 0% | ❌ 0% |  |  |  |  |  |  |  |
| **S10** Secret written into memory | · | ❌ 0% | ✅ 100% | ✅ 100% | ❌ 0% | ❌ 0% |  |  |  |  |  |  |  |
| **S11** Cross-project leak | ✅ 100% | ✅ 100% | ✅ 100% | ✅ 100% | 🟡 50% | ❌ 0% |  |  |  |  |  |  |  |
| **S3a** Parallel edit collision | ❌ 0% |  |  |  |  |  |  | ✅ 100% | ✅ 100% | ✅ 100% | 🟡 50% | ❌ 0% | ❌ 0% |
| **S3b** Parallel edit collision | ❌ 0% |  |  |  |  |  |  | ✅ 100% | ✅ 100% | ❌ 0% | 🟡 50% | ❌ 0% | ❌ 0% |
| **S3c** Parallel edit collision | ❌ 0% |  |  |  |  |  |  | ✅ 100% | ✅ 100% | ❌ 0% | 🟡 50% | ❌ 0% | ❌ 0% |
| **S3d** Parallel edit collision | · |  |  |  |  |  |  | ✅ 100% | ✅ 100% | ✅ 100% | · | ✅ 100% | ◐ 80% |
| **S11c** Cross-project leak, coordination | · |  |  |  |  |  |  | ✅ 100% | ✅ 100% | ✅ 100% | ✅ 100% | ✅ 100% | ✅ 100% |
| **S13** Lease expiry during a long task | · |  |  |  |  |  |  | 🟡 50% | ✅ 100% | ✅ 100% | 🟡 50% | · | · |
| **S12** hit / p50 / bytes @1000 docs | 20/20 · 12 ms · 134 B |  | 20/20 · 3.0 ms · 1.3 KB | 20/20 · 3.0 ms · 1.3 KB | 20/20 · 354 ms · 3.2 KB | 20/20 · 3.8 ms · 516 B |  |  |  |  |  |  |  |
| **S12** hit / p50 / bytes @10000 docs | 20/20 · 38 ms · 138 B |  | 20/20 · 6.4 ms · 1.3 KB | 20/20 · 8.6 ms · 1.3 KB | ⏭ | 20/20 · 38 ms · 1.4 KB |  |  |  |  |  |  |  |
| **S14** plan 1 epic + 20 tickets: fewest calls · tokens (write + read) |  |  |  |  |  |  |  | 1 call · ~404 tok · atomic |  | 1 call · ~1270 tok · atomic |  | 21 calls · ~9549 tok | 21 calls · ~3777 tok |

## Arms run

| arm | version | kinds | setup steps | tools/list | notes |
|---|---|---|---|---|---|
| no-memory baseline | n/a | knowledge, coordination, compaction | 0 | no MCP (CLI/hooks) | Agent reads files on demand (grep). No store, so S6/S9/S10 have nothing to tamper, poison or leak; graded n/a there. |
| native CLAUDE.md / AGENTS.md / auto memory (simulated per docs) | Claude Code docs as of 2026-10-31 | knowledge, compaction | 1 | no MCP (CLI/hooks) | Loader simulated from the published docs, not by running the claude binary. Auto memory content is written by Claude itself; the bench writes the line Claude would write (remember()). |
| kronicle-lite | 0.7.0 (npm) | knowledge, compaction | 4 | 10 tools, 14.1 KB (~3605 tok) | MCP stdio. Data dir = default ~/.kronicle-lite under an isolated HOME. |
| kronicle-lite --core | 0.7.0 (npm) | knowledge, compaction | 4 | 6 tools, 10.4 KB (~2664 tok) | MCP stdio. Data dir = default ~/.kronicle-lite under an isolated HOME. |
| basic-memory | 1.0.0 (PyPI) | knowledge, compaction | 4 | 12 tools, 30.3 KB (~7752 tok) | Embedding model pre-fetched into a local cache (the sandbox proxy blocks the default HF download path); HF_HUB_OFFLINE=1. |
| @modelcontextprotocol/server-memory | 2.0.1 (npm) | knowledge, compaction | 2 | 9 tools, 10.6 KB (~2702 tok) | Default MEMORY_FILE_PATH is one memory.jsonl beside the package: every project shares it unless configured. |
| cc-anchor (card only) | v0.4.0@b95500a (release tag) | compaction | 3 | no MCP (CLI/hooks) | Card content is written by the agent/user with the anchor command; hooks only persist and re-inject it. |
| sea-lite | 0.5.0 (npm) | coordination | 5 | 15 tools, 31.7 KB (~8128 tok); `--core`: 9 tools, 11.7 KB (~2989 tok) |  |
| sea-lite + cc-anchor hooks | sea-lite 0.5.0 (npm) + cc-anchor v0.4.0@b95500a (release tag) | coordination | 5 | 15 tools, 31.7 KB (~8128 tok); `--core`: 9 tools, 11.7 KB (~2989 tok) |  |
| beads (bd) | 1.3.2 (@beads/bd npm) | coordination | 4 | no MCP (CLI/hooks) | CLI driven (agents call bd through Bash); the separate beads-mcp 1.3.2 Python server is measured in S14 only. |
| mcp_agent_mail | 0.3.4 (git 426d4f3) | coordination | 4 | 49 tools, 63.7 KB (~16297 tok) |  |
| Backlog.md | 1.55.3 (npm) | coordination | 3 | 24 tools, 20.3 KB (~5193 tok) |  |
| task-master-ai | 0.43.1 (npm) | coordination | 4 | 7 tools, 6.8 KB (~1732 tok) |  |

### Arms not run

| tool | why it is not in Track A | where it can be measured |
|---|---|---|
| claude-mem 15.7.0 (npm, installed) | Its memory content (observations, session summaries) is written by an LLM through `@anthropic-ai/claude-agent-sdk` in its worker. Track A is LLM-free; feeding it hand-made observations would benchmark our fixtures, not claude-mem. | Track B (live agent, real LLM) |
| mem0 / OpenMemory | Fact extraction and embeddings call an LLM/embedding provider (OpenAI key by default; local mode needs Ollama + a vector DB). No paid keys and no Ollama in this sandbox. | Track B with a local model, or a keyed run |
| Claude Code agent teams / cross-session messaging | Interactive features of the `claude` binary with no deterministic headless driver. Native is therefore absent from S3/S13; the no-memory baseline stands in for "two terminals, no tool". | Track B |
| beads via `go install` | Fails to build here (missing ICU header for go-icu-regex); the official `@beads/bd` 1.3.2 prebuilt binary is used instead. | — |
| task-master `parse-prd` / `expand` | Need an LLM; only manual `add-task` / `set-status` are benchmarked. | — |
| mcp_agent_mail Rust rewrite | Not tried; the Python server (git 426d4f3) is the documented MCP server. | — |
| kronicle-lite 0.5.0 / 0.6.0, sea-lite 0.4.0, cc-anchor 0.3.0 | Superseded by the released versions in this run; the pre-release run is archived in `results/prerelease/track-a` and compared cell by cell in `results/RELEASE-RERUN.md`. | — |

## Context cost

Bytes the agent sees, averaged over every scenario cell the arm ran (tokens ≈ bytes/4, same proxy for every arm). `tools/list` is paid once per session unless the client defers schemas (Claude Code defers MCP schemas behind tool search by default).

| arm | tools/list | session start | mid-session touch | lookup (read) | post-compaction |
|---|---|---|---|---|---|
| baseline | – | 0 B | 0 B | 86 B | – |
| native | – | 1.3 KB | 63 B | 948 B | 7.3 KB |
| kronicle-lite | 14.1 KB | 2.0 KB | 1.7 KB | 1.7 KB | 1.2 KB |
| kronicle-lite-core | 10.4 KB | 2.0 KB | 1.7 KB | 1.7 KB | 1.2 KB |
| basic-memory | 30.3 KB | 334 B | 0 B | 1.1 KB | 559 B |
| server-memory | 10.6 KB | 1.6 KB | 0 B | 925 B | 1.7 KB |
| cc-anchor | – | – | – | – | 1.2 KB |
| sea-lite | 31.7 KB | – | – | – | – |
| sea-lite+cc-anchor | 31.7 KB | – | – | – | – |
| beads | – | – | – | – | – |
| agent-mail | 63.7 KB | – | – | – | – |
| backlog-md | 20.3 KB | – | – | – | – |
| task-master | 6.8 KB | – | – | – | – |

### Latency (ms, p50 / p95 over all calls of that kind)

| arm | touch | read | claim race (S3a, all N) | edit guard (S3b) |
|---|---|---|---|---|
| baseline | – | 7.9 / 18 | – | – |
| native | – | 8.0 / 15 | – | – |
| kronicle-lite | 27 / 415 | 7.8 / 241 | – | – |
| kronicle-lite-core | 28 / 499 | 8.3 / 245 | – | – |
| basic-memory | – | 300 / 1081 | – | – |
| server-memory | – | 1.6 / 15 | – | – |
| cc-anchor | – | – | – | – |
| sea-lite | – | – | 3460 / 34731 | 442 / 649 |
| sea-lite+cc-anchor | – | – | 2885 / 4596 | 608 / 1022 |
| beads | – | – | 7300 / 9740 | – |
| agent-mail | – | – | 794 / 1121 | 203 / 273 |
| backlog-md | – | – | 847 / 1329 | – |
| task-master | – | – | 71017 / 82013 | – |

## Per-scenario results

### S1 — Stale runbook (fact changed after the agent read it)

kronicle-lite pushes the change in words at the next orient ("You previously relied on … current truth is …", word diff) — 20/20 for 0.7.0 full and `--core` (as for 0.5.0 and 0.6.0). Recall is smaller (1.7 → 1.3 KB per lookup) and a quiet next-session orient is one line (80 B, was 1.25 KB). Native gets 🟡 from the observed changed-file notice (it shows the new line, not the belief to drop); baseline and basic-memory only on re-lookup; server-memory never sees the file change and keeps serving `{oldCluster}` (20/20). **Still a null result for us in the next session:** after the agent saved "Deploy target … is {old}" through the tool, every arm with a store served that copy unmarked next session — native (MEMORY.md), kronicle (the note doc, now tagged `authority: inspect_only`, `no_source`, but not marked as changed), basic-memory, server-memory: 20/20 each (`nextSessionStaleCopy`). 0.7.0's "repeats `X`, changed at seq N" marker only covers notes carried in an orient, not a note returned by `recall`.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| kronicle-lite | 20 / 0 / 0 | 100% | 100% [84%–100%] | push | 2.4 KB / 1.3 KB | old→new change surfaced |
| kronicle-lite-core | 20 / 0 / 0 | 100% | 100% [84%–100%] | push | 2.4 KB / 1.3 KB | old→new change surfaced |
| baseline | 0 / 20 / 0 | 50% | 0% [0%–16%] | none | 0 B / 79 B | new value only on re-lookup |
| native | 0 / 20 / 0 | 50% | 0% [0%–16%] | push | 228 B / 1.3 KB | new value pushed without naming the stale belief |
| basic-memory | 0 / 20 / 0 | 50% | 0% [0%–16%] | none | 0 B / 1.6 KB | new value only on re-lookup (stale copy also shown unmarked) |
| server-memory | 0 / 0 / 20 | 0% | 0% [0%–16%] | none | 0 B / 1.1 KB | stale value served unmarked |

<details><summary>secondary flags</summary>

- **kronicle-lite**: staleUnmarked 0% (0/20), nextSessionPass 0% (0/20), nextSessionStaleCopy 100% (20/20)
- **kronicle-lite-core**: staleUnmarked 0% (0/20), nextSessionPass 0% (0/20), nextSessionStaleCopy 100% (20/20)
- **baseline**: staleUnmarked 0% (0/20), nextSessionPass 100% (20/20), nextSessionStaleCopy 0% (0/20)
- **native**: staleUnmarked 0% (0/20), nextSessionPass 0% (0/20), nextSessionStaleCopy 100% (20/20)
- **basic-memory**: staleUnmarked 100% (20/20), nextSessionPass 0% (0/20), nextSessionStaleCopy 100% (20/20)
- **server-memory**: staleUnmarked 100% (20/20), nextSessionPass 0% (0/20), nextSessionStaleCopy 100% (20/20)

</details>

### S2 — Contradicting facts (two sources disagree)

Nobody flags the contradiction (0/120 ✅). Every arm that surfaces both values gets 🟡; basic-memory returned only the ADR on 3/20 seeds (1/20 in the pre-release run, same version). The native docs themselves say Claude "may pick one arbitrarily". This is still the clearest open gap in the field and the cheapest deterministic win (same heading/key, different value → `contradicts`).

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| baseline | 0 / 20 / 0 | 50% | 0% [0%–16%] | – | – / 193 B | both values shown, not flagged |
| native | 0 / 20 / 0 | 50% | 0% [0%–16%] | – | – / 420 B | both values shown, not flagged |
| kronicle-lite | 0 / 20 / 0 | 50% | 0% [0%–16%] | – | – / 2.0 KB | both values shown, not flagged |
| kronicle-lite-core | 0 / 20 / 0 | 50% | 0% [0%–16%] | – | – / 2.0 KB | both values shown, not flagged |
| server-memory | 0 / 20 / 0 | 50% | 0% [0%–16%] | – | – / 604 B | both values shown, not flagged |
| basic-memory | 0 / 17 / 3 | 43% | 0% [0%–16%] | – | – / 902 B | both values shown, not flagged |

### S4a — Compaction loss (decision made mid-conversation must survive)

With the decision recorded through each tool's documented mechanism, every arm now brings it back verbatim (20/20): native auto memory and cc-anchor push it (no call), basic-memory and server-memory need the agent to call after compaction (pull), and **kronicle-lite 0.7.0 passes for the first time** (0/20 on 0.5.0 and 0.6.0): the post-compaction orient carries the session's notes as text (`carried_notes`, "Your notes since seq N", bounded; 1.2 KB). cc-anchor 0.4.0 is unchanged at 20/20. Honest caveat: native's ✅ assumes Claude chose to save the decision to auto memory; Track B measures whether it does.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| native | 20 / 0 / 0 | 100% | 100% [84%–100%] | push | 1.6 KB / – | decision verbatim after compaction |
| kronicle-lite | 20 / 0 / 0 | 100% | 100% [84%–100%] | pull | 1.2 KB / – | decision verbatim after compaction |
| kronicle-lite-core | 20 / 0 / 0 | 100% | 100% [84%–100%] | pull | 1.2 KB / – | decision verbatim after compaction |
| basic-memory | 20 / 0 / 0 | 100% | 100% [84%–100%] | pull | 559 B / – | decision verbatim after compaction |
| server-memory | 20 / 0 / 0 | 100% | 100% [84%–100%] | pull | 1.7 KB / – | decision verbatim after compaction |
| cc-anchor | 20 / 0 / 0 | 100% | 100% [84%–100%] | push | 1.2 KB / – | decision verbatim after compaction |
| baseline | – (20) | – | – | – | – / – | arm has no way to persist a conversation decision |

### S4b — Compaction loss (decision made mid-conversation must survive)

Native only: with 230 earlier lines in MEMORY.md the decision lands past the documented 200-line load limit and is not re-injected (0/20). cc-anchor's card has no such cliff.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| native | 0 / 0 / 20 | 0% | 0% [0%–16%] | push | 13.0 KB / – | decision absent after compaction |
| baseline | – (20) | – | – | – | – / – | variant b (MEMORY.md over 200 lines) applies to native auto memory only |
| kronicle-lite | – (20) | – | – | – | – / – | variant b (MEMORY.md over 200 lines) applies to native auto memory only |
| kronicle-lite-core | – (20) | – | – | – | – / – | variant b (MEMORY.md over 200 lines) applies to native auto memory only |
| basic-memory | – (20) | – | – | – | – / – | variant b (MEMORY.md over 200 lines) applies to native auto memory only |
| server-memory | – (20) | – | – | – | – / – | variant b (MEMORY.md over 200 lines) applies to native auto memory only |
| cc-anchor | – (20) | – | – | – | – / – | variant b (MEMORY.md over 200 lines) applies to native auto memory only |

### S5 — Retired / deleted doc still served

kronicle-lite retires the deleted file's blocks through the FileChanged hook and the next orient says REMOVED (20/20). Files-on-disk and basic-memory stop serving it silently (🟡); server-memory keeps it forever (❌).

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| kronicle-lite | 20 / 0 / 0 | 100% | 100% [84%–100%] | push | 3.0 KB / 3.8 KB | retirement surfaced |
| kronicle-lite-core | 20 / 0 / 0 | 100% | 100% [84%–100%] | push | 3.0 KB / 3.8 KB | retirement surfaced |
| baseline | 0 / 20 / 0 | 50% | 0% [0%–16%] | none | 0 B / 0 B | no longer served, no notice |
| native | 0 / 20 / 0 | 50% | 0% [0%–16%] | none | 0 B / 0 B | no longer served, no notice |
| basic-memory | 0 / 20 / 0 | 50% | 0% [0%–16%] | none | 0 B / 1.5 KB | no longer served, no notice |
| server-memory | 0 / 0 / 20 | 0% | 0% [0%–16%] | none | 0 B / 228 B | retired content still served as live |

<details><summary>secondary flags</summary>

- **kronicle-lite**: served 0% (0/20)
- **kronicle-lite-core**: served 0% (0/20)
- **baseline**: served 0% (0/20)
- **native**: served 0% (0/20)
- **basic-memory**: served 0% (0/20)
- **server-memory**: served 100% (20/20)

</details>

### S6 — Tampering (stored text edited behind the tool)

Only kronicle-lite detects a store edit: `recall` withholds the tampered block, the receipt verifies UNVERIFIED (20/20, every build including 0.7.0). For native auto memory and basic-memory the Markdown file *is* the source of truth, so an out-of-band edit is indistinguishable from a legitimate one by design; server-memory's JSONL likewise.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| kronicle-lite | 20 / 0 / 0 | 100% | 100% [84%–100%] | push | 1.5 KB / 914 B | tamper flagged/withheld at read |
| kronicle-lite-core | 20 / 0 / 0 | 100% | 100% [84%–100%] | push | 1.5 KB / 914 B | tamper flagged/withheld at read |
| native | 0 / 0 / 20 | 0% | 0% [0%–16%] | none | 0 B / 1.3 KB | tampered text served as authentic |
| basic-memory | 0 / 0 / 20 | 0% | 0% [0%–16%] | none | 0 B / 1.6 KB | tampered text served as authentic |
| server-memory | 0 / 0 / 20 | 0% | 0% [0%–16%] | none | 0 B / 1.1 KB | tampered text served as authentic |
| baseline | – (20) | – | – | – | – / – | no store to tamper |

### S7 — Benign-edit noise (must NOT alarm; false-positive control)

False-positive control (template = seed mod 10, 2 seeds each). **kronicle-lite 0.7.0: 10/20 quiet, by design.** Its "format-only" rule (identical Markdown text: whitespace runs, line endings, list renumbering, emphasis markers) stays quiet on 5 templates; typo fix, Oxford comma, smart quotes, a terminal period and hyphenation are delivered as ordinary retractions (a typo carries `hint: likely_typo`). Released 0.5.0 was quiet on 2 templates (4/20). The unreleased 0.6-era cosmetic classifier was quiet on all 10 (20/20) but an adversarial corpus showed it hid 27 of 38 real changes (`staging-a` → `staging-b` filed as a typo), so it was withdrawn before release; this cell is the measured price. Track B T6 measures the behavioural cost (+85% tokens, no wrong action). Native's observed change notice fires on all 10. Arms without change detection pass trivially — read S7 together with S1.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| baseline | 20 / 0 / 0 | 100% | 100% [84%–100%] | none | 0 B / 79 B | quiet on whitespace_trim |
| basic-memory | 20 / 0 / 0 | 100% | 100% [84%–100%] | none | 0 B / 1.5 KB | quiet on whitespace_trim |
| server-memory | 20 / 0 / 0 | 100% | 100% [84%–100%] | none | 0 B / 1.1 KB | quiet on whitespace_trim |
| kronicle-lite | 10 / 0 / 10 | 50% | 50% [30%–70%] | push | 1.4 KB / 1.3 KB | quiet on whitespace_trim |
| kronicle-lite-core | 10 / 0 / 10 | 50% | 50% [30%–70%] | push | 1.4 KB / 1.3 KB | quiet on whitespace_trim |
| native | 0 / 0 / 20 | 0% | 0% [0%–16%] | push | 212 B / 1.3 KB | false alarm on whitespace_trim |

### S8 — Moved section (identity must survive)

Reordering sections inside a file is quiet everywhere. **Renaming the file is now quiet for kronicle-lite too (20/20, was 10/20 🟡):** 0.5.0/0.6.0 tombstoned the old path's blocks with a *safety* "REMOVED … stop following it" retraction and re-created the text under a new slug; 0.7.0 keeps the fact's identity without a removal alarm. Orient bytes on this cell fell 6.2 → 1.0 KB. basic-memory lost the fact on 2/20 renames (4/20 in the pre-release run) — its watcher had not re-indexed the moved file within 20 s with a shared server under load; treat that as a latency observation, not a design flaw.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| baseline | 20 / 0 / 0 | 100% | 100% [84%–100%] | none | 0 B / 86 B | reorder: identity survived quietly |
| native | 20 / 0 / 0 | 100% | 100% [84%–100%] | none | 0 B / 1.3 KB | reorder: identity survived quietly |
| kronicle-lite | 20 / 0 / 0 | 100% | 100% [84%–100%] | push | 1.0 KB / 1.4 KB | reorder: identity survived quietly |
| kronicle-lite-core | 20 / 0 / 0 | 100% | 100% [84%–100%] | push | 1.0 KB / 1.4 KB | reorder: identity survived quietly |
| server-memory | 20 / 0 / 0 | 100% | 100% [84%–100%] | none | 0 B / 1.1 KB | reorder: identity survived quietly |
| basic-memory | 18 / 0 / 2 | 90% | 90% [70%–97%] | none | 0 B / 1.4 KB | reorder: identity survived quietly |

<details><summary>secondary flags</summary>

- **baseline**: falseAlarm 0% (0/20)
- **native**: falseAlarm 0% (0/20)
- **kronicle-lite**: falseAlarm 0% (0/20)
- **kronicle-lite-core**: falseAlarm 0% (0/20)
- **server-memory**: falseAlarm 0% (0/20)
- **basic-memory**: falseAlarm 0% (0/20)

</details>

### S9 — Poisoned memory (wrong fact planted)

kronicle-lite 0.7.0 tags the planted note `authority: inspect_only` (`no_source`) while the runbook block is `can_act` (✅ 20/20; 0.5.0 showed provenance only, 🟡). Native, basic-memory and server-memory serve it as plain fact. Caveat for Track B: every unsourced note is inspect_only, including the agent's own.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| kronicle-lite | 20 / 0 / 0 | 100% | 100% [84%–100%] | push | 1.0 KB / 1.9 KB | planted fact flagged as untrusted/contradicting |
| kronicle-lite-core | 20 / 0 / 0 | 100% | 100% [84%–100%] | push | 1.0 KB / 1.9 KB | planted fact flagged as untrusted/contradicting |
| native | 0 / 0 / 20 | 0% | 0% [0%–16%] | none | 0 B / 1.3 KB | planted fact served as plain fact |
| basic-memory | 0 / 0 / 20 | 0% | 0% [0%–16%] | none | 0 B / 749 B | planted fact served as plain fact |
| server-memory | 0 / 0 / 20 | 0% | 0% [0%–16%] | none | 0 B / 1.3 KB | planted fact served as plain fact |
| baseline | – (20) | – | – | – | – / – | no store to poison |

<details><summary>secondary flags</summary>

- **kronicle-lite**: provenance 100% (20/20)
- **kronicle-lite-core**: provenance 100% (20/20)
- **native**: provenance 0% (0/20)
- **basic-memory**: provenance 0% (0/20)
- **server-memory**: provenance 0% (0/20)

</details>

### S10 — Secret written into memory

Synthetic, scanner-shaped secrets (AWS, GitHub PAT, Stripe live, Slack bot, RSA private key, OpenAI project key, JWT). kronicle-lite 0.7.0 refuses the write with `secret_detected` and the secret never reaches disk (20/20; released 0.5.0 stored it permanently in its append-only chain). Everything else stores and serves it verbatim.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| kronicle-lite | 20 / 0 / 0 | 100% | 100% [84%–100%] | – | – / 1.3 KB | github_pat: not served, not on disk, warned |
| kronicle-lite-core | 20 / 0 / 0 | 100% | 100% [84%–100%] | – | – / 1.3 KB | github_pat: not served, not on disk, warned |
| native | 0 / 0 / 20 | 0% | 0% [0%–16%] | – | – / 0 B | github_pat: served, persisted on disk |
| basic-memory | 0 / 0 / 20 | 0% | 0% [0%–16%] | – | – / 794 B | github_pat: served, persisted on disk |
| server-memory | 0 / 0 / 20 | 0% | 0% [0%–16%] | – | – / 262 B | github_pat: served, persisted on disk |
| baseline | – (20) | – | – | – | – / – | no store |

<details><summary>secondary flags</summary>

- **kronicle-lite**: persisted 0% (0/20), served 0% (0/20), warned 100% (20/20)
- **kronicle-lite-core**: persisted 0% (0/20), served 0% (0/20), warned 100% (20/20)
- **native**: persisted 100% (20/20), served 100% (20/20), warned 0% (0/20)
- **basic-memory**: persisted 100% (20/20), served 100% (20/20), warned 0% (0/20)
- **server-memory**: persisted 100% (20/20), served 100% (20/20), warned 0% (0/20)

</details>

### S11 — Cross-project leak (two repos sharing a store)

Two repos on each tool's *default* shared store. **kronicle-lite 0.7.0 keeps them apart (✅ 20/20, was 🟡 on 0.5.0 and 0.6.0):** documents carry a project key and `recall` is scoped to the current project by default (`all_projects` opt-in), so repo A no longer gets repo B's runbook and notes; responses fell 3.1 → 1.4 KB. basic-memory's default project mixes both repos' notes (🟡, labeled by path); server-memory's single memory.jsonl serves B's fact unlabeled (❌). Per-repo files (baseline, native auto memory keyed by repo) are isolated by construction.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| baseline | 20 / 0 / 0 | 100% | 100% [84%–100%] | none | 0 B / 79 B | isolated |
| native | 20 / 0 / 0 | 100% | 100% [84%–100%] | none | 0 B / 1.3 KB | isolated |
| kronicle-lite | 20 / 0 / 0 | 100% | 100% [84%–100%] | push | 1.5 KB / 1.3 KB | isolated |
| kronicle-lite-core | 20 / 0 / 0 | 100% | 100% [84%–100%] | push | 1.5 KB / 1.3 KB | isolated |
| basic-memory | 0 / 20 / 0 | 50% | 0% [0%–16%] | none | 0 B / 387 B | B's facts visible in A, labeled |
| server-memory | 0 / 0 / 20 | 0% | 0% [0%–16%] | none | 0 B / 1.1 KB | B's facts served in A unlabeled |

<details><summary>secondary flags</summary>

- **baseline**: leak 0% (0/20)
- **native**: leak 0% (0/20)
- **kronicle-lite**: leak 0% (0/20)
- **kronicle-lite-core**: leak 0% (0/20)
- **basic-memory**: leak 100% (20/20)
- **server-memory**: leak 100% (20/20)

</details>

### S3a — Parallel edit collision (two+ sessions, same file/path)

N = 2–8 racers per seed. sea-lite and beads: exactly one winner, every loser told who holds it (20/20). mcp_agent_mail grants every racer an "exclusive" reservation and reports the conflict (advisory, 20/20). Backlog.md and task-master accept every status edit.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| sea-lite | 20 / 0 / 0 | 100% | 100% [84%–100%] | – | – / – | exactly one winner; losers told who holds it |
| sea-lite+cc-anchor | 20 / 0 / 0 | 100% | 100% [84%–100%] | – | – / – | exactly one winner; losers told who holds it |
| beads | 20 / 0 / 0 | 100% | 100% [84%–100%] | – | – / – | exactly one winner; losers told who holds it |
| agent-mail | 0 / 20 / 0 | 50% | 0% [0%–16%] | – | – / – | 8/8 granted; conflict reported (advisory) |
| baseline | 0 / 0 / 20 | 0% | 0% [0%–16%] | – | – / – | no coordination mechanism: both sessions proceed |
| backlog-md | 0 / 0 / 3 | 0% | 0% [0%–56%] | – | – / – | no claim primitive: 3/3 status edits accepted, 0 failed without naming a holder |
| task-master | 0 / 0 / 3 | 0% | 0% [0%–56%] | – | – / – | no claim primitive: 3/3 status edits accepted, 0 failed without naming a holder |

<details><summary>secondary flags</summary>

- **sea-lite**: double_claim 0% (0/20)
- **sea-lite+cc-anchor**: double_claim 0% (0/20)
- **beads**: double_claim 0% (0/20)
- **agent-mail**: double_claim 100% (20/20)
- **backlog-md**: double_claim 100% (3/3)
- **task-master**: double_claim 100% (3/3)

</details>

### S3b — Parallel edit collision (two+ sessions, same file/path)

B tries to Edit inside A's claimed path. sea-lite's own PreToolUse hook and cc-anchor's scope guard deny at edit time naming holder, ticket and expiry (20/20). p50 per check: sea-lite hook 0.44 s (0.38 s on 0.4.0), cc-anchor 0.4.0 guard 0.61 s (0.41 s on 0.3.0) — slower, on a box where unchanged arms ran ~1.2× slower than in the pre-release run. mcp_agent_mail lets the edit happen and blocks the commit with its pre-commit guard — which only installs with `WORKTREES_ENABLED=1` (we enabled it; without it the guard silently installs nothing). beads has no path scope.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| sea-lite | 20 / 0 / 0 | 100% | 100% [84%–100%] | – | 386 B / – | blocked at edit, holder named |
| sea-lite+cc-anchor | 20 / 0 / 0 | 100% | 100% [84%–100%] | – | 544 B / – | blocked at edit, holder named |
| agent-mail | 0 / 20 / 0 | 50% | 0% [0%–16%] | – | 180 B / – | blocked at commit, holder named |
| baseline | 0 / 0 / 20 | 0% | 0% [0%–16%] | – | – / – | no coordination mechanism: both sessions proceed |
| beads | 0 / 0 / 20 | 0% | 0% [0%–16%] | – | – / – | claims are per issue; no path scope or edit guard |
| backlog-md | 0 / 0 / 3 | 0% | 0% [0%–56%] | – | – / – | no edit/commit guard: the overlapping edit goes through |
| task-master | 0 / 0 / 3 | 0% | 0% [0%–56%] | – | – / – | no edit/commit guard: the overlapping edit goes through |

### S3c — Parallel edit collision (two+ sessions, same file/path)

Out-of-the-box identity, two sessions. sea-lite 0.5.0 tells sessions apart by Claude Code session id and refuses the second (20/20). beads derives the actor from git user.name, so the second session's `--claim` is "idempotent" and both believe they hold the issue (0/20).

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| sea-lite | 20 / 0 / 0 | 100% | 100% [84%–100%] | – | – / – | exactly one winner; losers told who holds it |
| sea-lite+cc-anchor | 20 / 0 / 0 | 100% | 100% [84%–100%] | – | – / – | exactly one winner; losers told who holds it |
| agent-mail | 0 / 20 / 0 | 50% | 0% [0%–16%] | – | – / – | 2/2 granted; conflict reported (advisory) |
| baseline | 0 / 0 / 20 | 0% | 0% [0%–16%] | – | – / – | no coordination mechanism: both sessions proceed |
| beads | 0 / 0 / 20 | 0% | 0% [0%–16%] | – | – / – | 2/2 sessions all believe they hold it |
| backlog-md | 0 / 0 / 3 | 0% | 0% [0%–56%] | – | – / – | no claim primitive: 2/2 status edits accepted, 0 failed without naming a holder |
| task-master | 0 / 0 / 3 | 0% | 0% [0%–56%] | – | – / – | no claim primitive: 2/2 status edits accepted, 0 failed without naming a holder |

<details><summary>secondary flags</summary>

- **sea-lite**: double_claim 0% (0/20)
- **sea-lite+cc-anchor**: double_claim 0% (0/20)
- **agent-mail**: double_claim 100% (20/20)
- **beads**: double_claim 100% (20/20)
- **backlog-md**: double_claim 100% (3/3)
- **task-master**: double_claim 100% (3/3)

</details>

### S3d — Parallel edit collision (two+ sessions, same file/path)

Concurrent creates. sea-lite, beads and Backlog.md kept all items with unique ids. task-master lost writes on 4/20 seeds (5/20 in the pre-release run; e.g. 8 writers → 6 tasks) — the tasks.json race reported upstream. **sea-lite 0.5.0: 20/20, no errors** — the 0.4.0 run had 1/20 crash when up to 8 `sea-lite serve` processes started at once on a fresh data dir (signing-key race in kronicle-lite's first start); 0.5.0 depends on kronicle-lite 0.7.0, whose first start is atomic.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| sea-lite | 20 / 0 / 0 | 100% | 100% [84%–100%] | – | – / – | 3 concurrent creates, 3 unique, all present |
| sea-lite+cc-anchor | 20 / 0 / 0 | 100% | 100% [84%–100%] | – | – / – | 3 concurrent creates, 3 unique, all present |
| beads | 20 / 0 / 0 | 100% | 100% [84%–100%] | – | – / – | 3 concurrent creates, 3 unique, all present |
| backlog-md | 20 / 0 / 0 | 100% | 100% [84%–100%] | – | – / – | 3 concurrent creates, 3 unique, all present |
| task-master | 16 / 0 / 4 | 80% | 80% [58%–92%] | – | – / – | 3 concurrent creates, 3 unique, all present |
| baseline | – (20) | – | – | – | – / – | no shared store |
| agent-mail | – (20) | – | – | – | – / – | no item store |

<details><summary>secondary flags</summary>

- **sea-lite**: lost_or_dup 0% (0/20)
- **sea-lite+cc-anchor**: lost_or_dup 0% (0/20)
- **beads**: lost_or_dup 0% (0/20)
- **backlog-md**: lost_or_dup 0% (0/20)
- **task-master**: lost_or_dup 20% (4/20)

</details>

### S11c — Cross-project leak, coordination (two repos, default store)

Claims: every coordination tool keeps repos apart (sea-lite 0.5.0 project keys, beads/Backlog/task-master per-repo files, agent_mail project keys).

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| sea-lite | 20 / 0 / 0 | 100% | 100% [84%–100%] | – | – / – | isolated |
| sea-lite+cc-anchor | 20 / 0 / 0 | 100% | 100% [84%–100%] | – | – / – | isolated |
| beads | 20 / 0 / 0 | 100% | 100% [84%–100%] | – | – / – | isolated |
| agent-mail | 20 / 0 / 0 | 100% | 100% [84%–100%] | – | – / – | isolated |
| backlog-md | 3 / 0 / 0 | 100% | 100% [44%–100%] | – | – / – | isolated |
| task-master | 3 / 0 / 0 | 100% | 100% [44%–100%] | – | – / – | isolated |
| baseline | – (20) | – | – | – | – / – | no claims |

### S13 — Lease expiry during a long task

Time-compressed for sea-lite (lease 5 s, task 12 s). Alone, sea-lite 0.5.0's lease still lapses mid-task, B takes the ticket, and A learns only when its next write is fenced (`fence_invalid`, 3/3 🟡, unchanged from 0.4.0). With cc-anchor 0.4.0's PostToolUse heartbeat the claim survives (3/3 ✅). beads' 5-minute lease is not reclaimed without a supervisor running `bd reclaim`, so B is still refused after 310 s (✅, n=1). mcp_agent_mail's reservation expires and is re-granted to B; A finds out only when a renew returns nothing (🟡, n=1, real time).

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| sea-lite+cc-anchor | 3 / 0 / 0 | 100% | 100% [44%–100%] | – | – / – | claim held through 12s of work (lease 5s) |
| beads | 1 / 0 / 0 | 100% | 100% [21%–100%] | – | – / – | claim held through 310s of work (lease 300s) |
| sea-lite | 0 / 3 / 0 | 50% | 0% [0%–56%] | – | – / – | lease lapsed mid-task; B took it; A learns only on its next write |
| agent-mail | 0 / 1 / 0 | 50% | 0% [0%–79%] | – | – / – | lease lapsed mid-task; B took it; A learns only on its next write |
| baseline | – (20) | – | – | – | – / – | no claims |
| backlog-md | – (20) | – | – | – | – / – | no claims |
| task-master | – (20) | – | – | – | – / – | no claims |

<details><summary>secondary flags</summary>

- **sea-lite**: holderTold 100% (3/3)
- **agent-mail**: holderTold 100% (1/1)

</details>

### S12 — Retrieval at scale

Needle lookups are lexical, so every arm finds 20/20; the differences are cost. grep returns 134 B at 12 ms (1k) / 38 ms (10k). kronicle-lite 0.7.0 answers in 3.0 / 6.4 ms p50 (`--core` 3.0 / 8.6) and returns **1.3 KB per query** (0.5.0: 1.7 KB, 0.6.0: 2.2 KB — receipts now go by id). Its store is still **33–44× the corpus** (ADR-0015 targeted < 3×; unchanged across all three versions) and 10k docs ingest in ~38 s (0.5.0: 33.5 s). basic-memory (hybrid FTS + vectors) costs 354 ms p50, 3.3 KB per lookup (search + read) and 261 s to ingest 1k docs on 2 CPUs; 10k was not run (extrapolated > 40 min). server-memory is fast and small (3.8 / 38 ms, 0.5–1.4 KB, store 1.16×).

| arm | docs | hit (needle in view) | p50 / p95 ms | bytes / query (≈tok) | ingest | store / corpus |
|---|---|---|---|---|---|---|
| baseline | 1000 | 20/20 [84%–100%] | 12 / 16 | 134 B (34) | 0.0 s | –× |
| baseline | 10000 | 20/20 [84%–100%] | 38 / 42 | 138 B (35) | 0.0 s | –× |
| kronicle-lite | 1000 | 20/20 [84%–100%] | 3.0 / 4.1 | 1.3 KB (329) | 3.8 s | 44.29× |
| kronicle-lite | 10000 | 20/20 [84%–100%] | 6.4 / 28 | 1.3 KB (331) | 37.5 s | 33.51× |
| kronicle-lite-core | 1000 | 20/20 [84%–100%] | 3.0 / 5.2 | 1.3 KB (329) | 3.7 s | 44.4× |
| kronicle-lite-core | 10000 | 20/20 [84%–100%] | 8.6 / 12 | 1.3 KB (331) | 38.0 s | 33.76× |
| basic-memory | 1000 | 20/20 [84%–100%] | 354 / 422 | 3.2 KB (832) | 261.5 s | 48.21× |
| basic-memory | 10000 | ⏭ not run above 1000 docs by default (ingest ~0.23 s/doc here; use --force-scale) | | | | |
| server-memory | 1000 | 20/20 [84%–100%] | 3.8 / 17 | 516 B (129) | 0.3 s | 1.16× |
| server-memory | 10000 | 20/20 [84%–100%] | 38 / 68 | 1.4 KB (351) | 1.8 s | 1.16× |

### S14 — Planning cost (1 epic + 20 tickets, 39 links)

Cost table, not graded. **Three paths author the whole plan in one call, atomically: sea-lite `sea_apply`, sea-lite `sea_apply` with a template, and beads `bd create --graph`.** All produced the exact graph (3/3), rejected the invalid plan as a whole with nothing left behind (3/3), and their dry-runs caught the cycle without writing (3/3). sea-lite 0.5.0 fixed the cost gap the pre-release run found: `sea_apply` returns a compact ref→id map (**996 B, was 13.4 KB**), so the call costs ~1.6k tokens (was ~4.8k) against ~1.3k for `--graph --json` (525 B returned); the **templated** plan writes the 20 steps once (617 B written) and costs **~0.4k tokens**, the cheapest row in the table. What else differs: (1) **surface** — `sea_apply` is an MCP tool; `--graph` is CLI-only (beads-mcp 1.3.2 has no batch/graph tool); (2) **idempotency** — re-sending with the same `idempotency_key` replays (21 tickets after), re-running `bd create --graph` duplicates (42); (3) latency — 52 ms vs 2.55 s (beads commits to embedded Dolt).

**Per-item paths are never atomic.** Every tool rejected the cycle-closing edge, but by then 21 tickets and 39 links already existed (3/3 each). task-master's MCP server **process exited** on the cyclic `add_dependency` (3/3), so the call returns no result and the client must restart the server. Re-running a per-item plan duplicates every ticket for every tool except sea-lite (per-call `idempotency_key`s replay). Cheapest per item: beads with inline `--parent/--deps` (21 calls, ~1.0k tokens, ~14 s of CLI time); dearest: sea-lite per item (60 calls, ~16.7k tokens, was ~20.2k; `sea_create` still returns the full ticket + claim, and the 21 claims stay held for `claim_seconds`). Backlog.md returns the full task view on every create (34 KB for the plan). Turns matter beyond bytes: each of 21–60 turns re-reads the growing context, which this table does not count.

GitHub and Linear could not run offline; their rows are call counts derived from the published schemas, labelled as such.

Same plan for every path: 21 tickets (1 epic + 20, one-line acceptance body each), 20 parent edges + 19 dependency edges. Invalid item for the atomicity check: edge "ticket 01 depends on ticket 20" (closes a cycle). 3 repetitions per path; counts are deterministic, wall ms is mean ± sd over the repetitions. Tokens ≈ bytes/4.

| tool · path | surface | calls (= turns) | written (≈tok) | results read (≈tok) | total ≈tok | wall ms (mean ± sd) | graph exact | re-run duplicates? | atomic on invalid item | dry-run catches it |
|---|---|---|---|---|---|---|---|---|---|---|
| sea-lite 0.5.0 · `sea_apply` with `templates` (one MCP call, 20 steps written once) | MCP | 1 | 617 B (155) | 996 B (249) | 404 | 58 ± 2 | ✅ 3/3 | no (21 tickets after) | ✅ rejected, nothing left | ✅ 3/3 |
| beads 1.3.2 · `bd create --graph` (one Bash call, plan JSON in a heredoc) | CLI | 1 | 4.4 KB (1138) | 525 B (132) | 1270 | 2551 ± 42 | ✅ 3/3 | **yes** (42 tickets after) | ✅ rejected, nothing left | ✅ 3/3 |
| sea-lite 0.5.0 · `sea_apply` (one MCP call) | MCP | 1 | 5.3 KB (1369) | 996 B (249) | 1618 | 52 ± 14 | ✅ 3/3 | no (21 tickets after) | ✅ rejected, nothing left | ✅ 3/3 |
| beads 1.3.2 · `bd create --parent --deps` ×21 (Bash) | CLI | 21 | 3.8 KB (967) | 240 B (60) | 1027 | 13868 ± 304 | ✅ 3/3 | **yes** (42 tickets after) | ❌ item rejected; 21 tickets + 39 links left | – |
| beads-mcp 1.3.2 · `create` with `deps` ×21 (MCP) | MCP | 21 | 3.8 KB (962) | 1.0 KB (268) | 1230 | 11860 ± 291 | ✅ 3/3 | **yes** (42 tickets after) | ❌ item rejected; 21 tickets + 39 links left | – |
| task-master-ai 0.43.1 · `add_task` + `add_subtask` with `dependencies` ×20 (MCP, no LLM) | MCP | 21 | 5.1 KB (1307) | 9.6 KB (2470) | 3777 | 70 ± 2 | ✅ 3/3 | **yes** (42 tickets after) | ❌ item rejected (server process exited); 21 tickets + 39 links left | – |
| Backlog.md 1.55.3 · `task_create` with `parentTaskId` + `dependencies` ×21 (MCP) | MCP | 21 | 4.1 KB (1048) | 33.2 KB (8501) | 9549 | 606 ± 11 | ✅ 3/3 | **yes** (42 tickets after) | ❌ item rejected; 21 tickets + 39 links left | – |
| task-master-ai 0.43.1 · `add_task` + `add_subtask` ×20 + `add_dependency` ×19 (MCP, no LLM) | MCP | 40 | 6.7 KB (1718) | 13.7 KB (3499) | 5217 | 167 ± 15 | ✅ 3/3 | **yes** (42 tickets after) | ❌ item rejected (server process exited); 21 tickets + 39 links left | – |
| beads-mcp 1.3.2 · `create` ×21 + `dep` ×39 (MCP) | MCP | 60 | 5.3 KB (1363) | 3.3 KB (834) | 2197 | 27081 ± 750 | ✅ 3/3 | **yes** (42 tickets after) | ❌ item rejected; 21 tickets + 39 links left | – |
| beads 1.3.2 · `bd create` ×21 + `bd dep add` ×39 (Bash) | CLI | 60 | 4.5 KB (1142) | 6.0 KB (1535) | 2677 | 26392 ± 376 | ✅ 3/3 | **yes** (42 tickets after) | ❌ item rejected; 21 tickets + 39 links left | – |
| sea-lite 0.5.0 · `sea_create` (claim_seconds) ×21 + `sea_link` ×39 (MCP) | MCP | 60 | 13.8 KB (3534) | 51.6 KB (13209) | 16743 | 168 ± 22 | ✅ 3/3 | no (21 tickets after) | ❌ item rejected; 21 tickets + 39 links left | – |
| task-master-ai 0.43.1 · `parse_prd` (plan from a PRD) | – | n/a — generates tasks with an LLM; Track A is LLM-free | | | | | | | | |
| mcp_agent_mail 0.3.4 · — | – | n/a — no tickets or dependency graph (messages + file reservations only) | | | | | | | | |

**Documented call counts — not measured** (computed from the published tool schemas; needs network and accounts, so no bytes, latency or behaviour were observed):

| tool · path | calls | atomic | idempotency | note | source |
|---|---|---|---|---|---|
| GitHub MCP server (github/github-mcp-server, main @ 2026-10-31) · `issue_write` ×21 (20 with `parent_issue_number`) + `issue_dependency_write` ×19 | 40 (documented) | no — one issue / one edge per call | no key in the schemas (`issue_dependency_write` idempotentHint: false) | without `parent_issue_number`: + `sub_issue_write` ×20 = 60 calls; `issue_dependency_write` is behind the `issue_dependencies` feature flag | [1](https://github.com/github/github-mcp-server/blob/main/README.md) [2](https://github.com/github/github-mcp-server/blob/main/pkg/github/__toolsnaps__/issue_dependency_write_ff_issue_dependencies.snap) |
| Linear GraphQL API (@linear/sdk schema.graphql) · `issueCreate` (epic) + `issueBatchCreate` (20 children, `parentId`) + `issueRelationCreate` ×19 | 21 (documented) | only the 20-issue batch ("Creates a list of issues atomically", ≤ 50); relations one per call | optional client `id` (UUID v4) per issue/relation — behaviour on replay not documented | GraphQL mutations, not an MCP tool catalog; the epic must exist before children can name it as `parentId` | [1](https://github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql) |

### S15 — Contention: `wait_seconds` vs sleep-and-retry (Track B T3 pattern, sea-lite 0.5.0)

sea-lite 0.5.0 has no `wait_seconds` on `sea_next` (it is on an unreleased branch), so only the sleep-and-retry mode runs: agent A takes all 4 tickets while B polls 5 times and gives up in 3/3 repetitions — 15 tool calls and 20 model turns for 4 tickets. That is identical to the branch build's poll mode (results/track-a-sl-wait), whose `wait_seconds` mode needed 10 calls and 10 turns with a 2/2 split and nobody giving up. Track B T3 shows the same shape live: one sea agent idle in 7/10 runs, 3.3× the wall time of no tool.


Two scripted agents, 4 tickets whose scopes all overlap (each names its file + CHANGELOG.md), 3 repetitions per mode. Time compressed: work 2 s per ticket, 0.25 s per model turn, retry sleep 1 s (T3's `sleep 20`), 5 retries; wait mode passes `wait_seconds: 5` (the same patience). Deterministic scripts; wall times are real.

| mode | wall s (all done or stopped) | last release s | tickets left | done A / B | runs where an agent gave up | tool calls | model turns | release→next claim gap (mean / max s) |
|---|---|---|---|---|---|---|---|---|
| sleep + retry (T3 instruction) | 9.07 | 8.81 | 0/0/0 | 4 / 0 | 3/3 | 15 | 20 | 0.254 / 0.255 |
| `wait_seconds` | not available in this build (no `wait_seconds` on `sea_next`) | | | | | | | |


## Where each tool wins and loses (generated from scores)

- **baseline** — best or tied-best: S2, S7, S8, S11; scores 0: S3a, S3b, S3c
- **native** — best or tied-best: S2, S4a, S8, S11; scores 0: S4b, S6, S7, S9, S10
- **kronicle-lite** — best or tied-best: S1, S2, S4a, S5, S6, S8, S9, S10, S11; scores 0: none
- **kronicle-lite-core** — best or tied-best: S1, S2, S4a, S5, S6, S8, S9, S10, S11; scores 0: none
- **basic-memory** — best or tied-best: S4a, S7; scores 0: S6, S9, S10
- **server-memory** — best or tied-best: S2, S4a, S7, S8; scores 0: S1, S5, S6, S9, S10, S11
- **cc-anchor** — best or tied-best: S4a; scores 0: none
- **sea-lite** — best or tied-best: S3a, S3b, S3c, S3d, S11c; scores 0: none
- **sea-lite+cc-anchor** — best or tied-best: S3a, S3b, S3c, S3d, S11c, S13; scores 0: none
- **beads** — best or tied-best: S3a, S3d, S11c, S13; scores 0: S3b, S3c
- **agent-mail** — best or tied-best: S11c; scores 0: none
- **backlog-md** — best or tied-best: S3d, S11c; scores 0: S3a, S3b, S3c
- **task-master** — best or tied-best: S11c; scores 0: S3a, S3b, S3c

## Changes since the pre-release run (regressions first)

Before = the pre-release run (`results/prerelease/track-a`: kronicle-lite 0.5.0 npm and 0.6.0 local, sea-lite 0.4.0 local, cc-anchor 0.3.0 local). After = this run (kronicle-lite 0.7.0, sea-lite 0.5.0, cc-anchor v0.4.0). Same seeds, same adapters; per-cell table with CIs and Fisher *p* in `results/RELEASE-RERUN.md`.

**Regressions (no graded cell of ours went down; these are costs):**
- **kronicle-lite per-call latency roughly doubled.** Median p50 ratio after/before over 28 timings: 2.0× (full) and 1.75× (`--core`), against 1.16–1.27× for the unchanged knowledge arms on the same box. Examples: S1 orient with a cursor 14 → 36 ms, recall 2.8 → 7.8 ms, S12 10k-doc recall 4.0 → 6.4 ms (0.6.0 was 9.1 ms). Still far below a model turn, but measurable.
- **kronicle-lite `tools/list` grew** 12.1 KB (0.5.0) / 13.3 KB (0.6.0) → 14.1 KB (~3.6k tokens); `--core` 9.6 → 10.4 KB.
- **cc-anchor 0.4.0 scope guard p50 0.41 → 0.61 s** per Edit (S3b), sea-lite's own hook 0.38 → 0.44 s.
- **S7 vs the unreleased cosmetic classifier:** 20/20 quiet on that branch (kl-next branch, results/track-a-kl-after there) → 10/20 in the release, deliberately (it hid real changes). Against released 0.5.0 it is 4/20 → 10/20.
- **S12 ingest** 33.5 → 37.5 s at 10k docs; store footprint unchanged at 33–44×.

**Improvements:** S4a ❌ → ✅ (0/20 → 20/20), S8 10/20 → 20/20, S9 🟡 → ✅ and S10 ❌ → ✅ vs released 0.5.0 (already ✅ on 0.6.0), S11 🟡 → ✅ (all builds), S7 4/20 → 10/20 vs 0.5.0, S3d errors 1 → 0. Bytes: recall 1.7 → 1.3 KB, quiet next-session orient 1.25 KB → 80 B, S11 orient 3.0 → 1.5 KB; sea-lite `tools/list` 59.3 → 31.7 KB (11.7 KB with `--core`), S14 `sea_apply` ~4.8k → ~1.6k tokens (~0.4k templated).

**Unchanged:** S1, S5, S6 (kronicle 20/20), S2 (nobody), S3a–c and S11c (sea-lite 20/20), S13 (sea-lite alone 🟡, with cc-anchor ✅), S4a cc-anchor 20/20.

**Competitor drift (same versions both runs):** basic-memory S2 19 → 17 🟡 and S8 16 → 18 ✅, task-master S3d 15 → 16 ✅ — run-to-run variance in those tools (watcher timing, the tasks.json race); every other competitor and control cell is identical.

## What to develop next (kronicle-lite, sea-lite, cc-anchor)

Ranked by (gap size in this run) × (how many users hit it) × (cost to fix). Every item cites the cell it comes from.

1. **`pulse` must not say "proceed" over a retraction (kronicle-lite).** Track B T1: both pull-only failures (8/10) and the T7 failure are agents trusting `focus: "pulse"` ("within threshold; proceed", `retractions: null`, advanced cursor) across a real supersession. Same on 0.5.0 and 0.7.0 (probe in Track B §4). Return the retraction count and one-line diffs, or do not advance the cursor.
2. **Contradiction flag on recall/orient (kronicle-lite).** S2: 0 ✅ in 120 seeds across all six knowledge arms; kronicle already returns both blocks. Same heading path or key phrase, different backticked value / number → `contradicts`.
3. **Derived copies go stale silently (kronicle-lite).** S1 next session: the agent's saved note repeating the runbook fact is served unmarked 20/20. 0.7.0's "repeats `X`, changed at seq N" marker exists for carried notes; apply it to `recall` hits too.
4. **Release `sea_next {wait_seconds}` (sea-lite).** S15: one agent does all the work and the other gives up (3/3); Track B T3 wall 3.3× no-tool. The branch build halves calls and turns.
5. **Per-subagent retraction cursors (cc-anchor).** Track B T7: the push reached the coordinator 0/6 with 0.4.0's shared cursor.
6. **Heartbeat without cc-anchor (sea-lite).** S13: alone the lease lapses mid-task (3/3 🟡). Renew on any `sea_*` call by the holder.
7. **Win back kronicle-lite's latency and catalog size.** Per-call p50 ~2× since 0.5.0; `tools/list` 14.1 KB. Profile orient/recall (receipt storage, project scoping) and trim descriptions.
8. **Render `hint: likely_typo` in cc-anchor's push.** S7 delivers typo-shaped edits by design; Track B T6 shows every agent re-reads (+85% tokens). One line saying "typo fix, same meaning unless it is a name or value" keeps the safety and cuts the cost.
9. **Store footprint (kronicle-lite).** S12: 33–44× the corpus in every version (ADR-0015 target < 3×).

**Validated, keep shipping:** authority tags (S9), write-time secret guard (S10), project-scoped recall (S11), carried notes after compaction (S4a), rename without a removal alarm (S8), retirement and tamper detection (S5, S6: only arm at 100%); sea-lite's claims, scope guard and per-session identity (S3a–d, the only arm at 100% on all four) and the compact `sea_apply` result (S14). **Do not build:** retrieval speed for its own sake — grep and server-memory already answer exact lookups in ≤ 40 ms at 10k docs.

## Method, fairness notes and limitations

- **Native Claude Code is simulated, not run.** The loader follows the docs fetched 2026-10-31 (CLAUDE.md + `@imports` ≤ 4 hops, unscoped `.claude/rules`, first 200 lines / 25 KB of auto memory `MEMORY.md`, re-injected after `/compact`). Mid-session the docs only promise that Edit notices a changed file. We additionally credit native with an **observed, undocumented** behaviour seen in this build session's own harness: after a file Claude has *read* changes on disk, the next turn carries "<file> changed on disk since you last read it … relevant changes (shown with line numbers)" with the new lines. That is why native gets 🟡 on S1 (new line shown, stale belief not named) and ❌ on S7 (it announces whitespace edits too). If that notice does not fire in your build, native S1 becomes "re-lookup only" and S7 a trivial pass.
- **Best-practice usage per tool.** kronicle-lite: files chained with `put --from-instructions`, changes delivered through its documented Claude Code `FileChanged` hook (`--stdin-hook`); the agent orients (`get_system_state` + cursor) at session start and each turn per its orient skill; lookups are `recall`. basic-memory: one project per repo folder, its own file watcher, lookups `bm_search` → `bm_read` of the top hit, resume with `bm_project recent`; embedding model pre-fetched (the sandbox proxy blocks its default download) and `watch_project_reload_interval` lowered 300 s → 2 s so per-seed projects are watched promptly; one server shared across seeds with a project per seed. server-memory: the agent stores every line of every doc as observations (more generous than real use) and reads the graph at chat start (its README prompt); no file sync exists. sea-lite: one MCP server per session, distinct actors except S3c; guard = its own `scope-check --hook`. cc-anchor: card written with its documented command; hooks fed recorded payload shapes.
- **Push vs pull.** "touch" = what reaches the agent without asking (hooks, or the orient call a tool's skill mandates each turn). Pull-only tools have nothing there by design and are credited 🟡 when a re-lookup returns the fresh value. Whether an agent re-looks-up is Track B's question.
- **Compaction (S4)** grades only what the tool brings back; Claude Code's own summary is not simulated, so ❌ means "the tool did not carry it", not "the agent forgot".
- **Time compression (S13).** sea-lite arms: lease 5 s, cc-anchor heartbeat every 1 s (defaults 300 s / 60 s, same ratio), task 12 s. agent_mail (TTL floor 60 s) and beads (fixed 5-minute lease) ran in real time, one repetition each.
- **Grader.** Keyword/regex rules over the exact text, after stripping "nothing happened" boilerplate (`"superseded_by": null`, `Retractions: none`, `not_searched: [...]`); per-hit labels in JSON results are attributed to the hit carrying the value. Every arm's views were inspected by hand on sample seeds (`AMB_DEBUG=1`). Bytes = MCP `content` text (what Claude Code puts in context); `structuredContent` is separate in the JSON. Tokens ≈ bytes/4.
- **Latency** is wall time on a shared 2-CPU sandbox with two seeds in flight; compare arms within this run only. Process start-up is excluded. This run had the box to itself (Track B finished before it started); unchanged arms still ran ~1.2× slower than in the pre-release run, so cross-run latency ratios are normalized against them.
- **Versions.** Our tools are the released packages: kronicle-lite 0.7.0 and sea-lite 0.5.0 from npm, cc-anchor from the git tag `v0.4.0` (b95500a; a Claude Code plugin with no npm package), installed by `track-a/setup.sh`. Competitors are at the versions of the pre-release run. The pre-release run is archived in `results/prerelease/track-a`.
- **S15 (contention)** is a separate scripted run (`track-a/contention.mjs`, 3 repetitions, time-compressed: work 2 s, model turn 0.25 s, retry sleep 1 s × 5); its wait mode runs only when the build advertises `wait_seconds`.
- **What Track A cannot say:** whether an agent acts on a signal, ignores it, or over-reacts. Track A bounds what is possible; Track B measures behaviour.

## Reproduce

```sh
npm run track-a:setup   # installs pinned arms into .arms/ (npm, uv, git)
npm run track-a         # full run → results/track-a/
npm run track-a:ci      # <2 min subset → results/track-a-ci/
```

Raw per-seed records (grades, reasons, bytes, latencies, flags) are in `results/track-a/<scenario>.json`; aggregated cells in `summary.json`; versions and tool catalogs in `meta.json`.
