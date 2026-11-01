# agent-memory-bench — Track A report

Generated 2026-11-01T07:07:42.814Z by `npm run track-a` — deterministic, no LLM, $0. Seeds per randomized cell: **20**. Wall time 4779 s (+ merged re-runs: agent-mail × S3; beads,backlog-md,task-master × none; baseline,native,kronicle-lite,kronicle-lite-0.6,kronicle-lite-0.6-core,server-memory,basic-memory × S1; baseline,native,kronicle-lite,kronicle-lite-0.6,kronicle-lite-0.6-core,server-memory,basic-memory × S1; agent-mail × S3; sea-lite,beads,backlog-md,task-master × S14) on 2 CPU / 8 GB, Node v22.23.4. Bench code at commit `7446626` plus the working tree committed with these results.

**Bottom line.** On the faults where a fact *changes* (S1 stale runbook, S5 retired doc, S6 tamper), kronicle-lite is the only arm that tells the agent what changed: 20/20 seeds each, ✅ [84–100%], against 🟡 for files-on-disk (baseline, native: the fresh value is there if the agent re-reads) and ❌ for the reference memory server (it keeps serving the old value, 20/20). sea-lite is the only coordination arm that passes all four collision variants (S3a–d, 20/20 each) — beads fails out-of-the-box identity (S3c 0/20: both sessions believe they hold the issue), mcp_agent_mail is advisory (every racer is granted, conflict reported; blocked only at commit by its opt-in guard), Backlog.md and task-master have no claim primitive. With cc-anchor's heartbeat, sea-lite also keeps a lease alive through a long task (S13 3/3; alone it lapses and the holder learns only at its next write).

**Where we lose or nobody wins.** No arm flags contradictory sources (S2: 0 ✅ across 140 seeds). Every arm that lets the agent save a copy of a fact (native auto memory, kronicle notes, basic-memory, server-memory) serves that copy unmarked after the source changes (S1 next session: 20/20 stale for all four). kronicle-lite raises "reconcile before acting" retractions on 8 of the 10 IsoKron benign-edit templates (S7: 4/20 quiet) and a *safety* "stop following it" retraction when a file is merely renamed (S8: 10/10 rename seeds). Its recall leaks a second repo's docs when two repos share the default data dir (S11 20/20, labeled by slug only), and plain per-repo files (baseline, native) beat every shared store there. Context cost is real: kronicle's per-turn orient is ~1.1 KB when nothing changed and 2.4–3.6 KB when something did (mean 3.0 KB over all cells), and a recall ~1.7 KB (0.5) / 2.3 KB (0.6) for a ~60-byte answer that grep returns in 134 B; sea-lite's catalog is 59 KB (~15k tokens).

**kronicle-lite 0.6.0 vs 0.5.0** (unreleased local build, same adapter): S9 poisoned memory 🟡 → ✅ (the planted note carries `authority: inspect_only`, 20/20) and S10 secrets ❌ → ✅ (`secret_detected` refusal on all 7 secret shapes, nothing on disk, 20/20). No change on S5, S11, S7, S8. `--core` cuts tools/list 13.3 → 9.6 KB with identical grades, but recall responses grew 29% (authority + absence fields) and p50 recall latency at 10k docs went 4.0 → 8–9 ms.

**How to read the grades.** Each cell is graded per seed against the scenario's expected signal (scenarios/*.yaml) by fixed string/regex rules in `track-a/lib/grade.mjs`: ✅ yes = the tool surfaced the fault the way the scenario expects; 🟡 partial = the agent could notice (e.g. the fresh value on re-lookup) but is not told what changed, or the signal is advisory; ❌ no = nothing, or the wrong thing, is shown. **Score** = (yes + ½·partial)/n. ◐ = mixed across seeds. · = not applicable (reason in the per-scenario table). Intervals are 95% Wilson on the yes-rate; exact Clopper–Pearson bounds are in the JSON.

## Headline matrix

| scenario | baseline | native | kronicle-lite | kronicle-lite-0.6 | kronicle-lite-0.6-core | basic-memory | server-memory | cc-anchor | sea-lite | sea-lite+cc-anchor | beads | agent-mail | backlog-md | task-master |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **S1** Stale runbook | 🟡 50% | 🟡 50% | ✅ 100% | ✅ 100% | ✅ 100% | 🟡 50% | ❌ 0% |  |  |  |  |  |  |  |
| **S2** Contradicting facts | 🟡 50% | 🟡 50% | 🟡 50% | 🟡 50% | 🟡 50% | ◐ 48% | 🟡 50% |  |  |  |  |  |  |  |
| **S4a** Compaction loss | · | ✅ 100% | ❌ 0% | ❌ 0% | ❌ 0% | ✅ 100% | ✅ 100% | ✅ 100% |  |  |  |  |  |  |
| **S4b** Compaction loss | · | ❌ 0% | · | · | · | · | · | · |  |  |  |  |  |  |
| **S5** Retired / deleted doc still served | 🟡 50% | 🟡 50% | ✅ 100% | ✅ 100% | ✅ 100% | 🟡 50% | ❌ 0% |  |  |  |  |  |  |  |
| **S6** Tampering | · | ❌ 0% | ✅ 100% | ✅ 100% | ✅ 100% | ❌ 0% | ❌ 0% |  |  |  |  |  |  |  |
| **S7** Benign-edit noise | ✅ 100% | ❌ 0% | ◐ 20% | ◐ 20% | ◐ 20% | ✅ 100% | ✅ 100% |  |  |  |  |  |  |  |
| **S8** Moved section | ✅ 100% | ✅ 100% | ◐ 75% | ◐ 75% | ◐ 75% | ◐ 80% | ✅ 100% |  |  |  |  |  |  |  |
| **S9** Poisoned memory | · | ❌ 0% | 🟡 50% | ✅ 100% | ✅ 100% | ❌ 0% | ❌ 0% |  |  |  |  |  |  |  |
| **S10** Secret written into memory | · | ❌ 0% | ❌ 0% | ✅ 100% | ✅ 100% | ❌ 0% | ❌ 0% |  |  |  |  |  |  |  |
| **S11** Cross-project leak | ✅ 100% | ✅ 100% | 🟡 50% | 🟡 50% | 🟡 50% | 🟡 50% | ❌ 0% |  |  |  |  |  |  |  |
| **S3a** Parallel edit collision | ❌ 0% |  |  |  |  |  |  |  | ✅ 100% | ✅ 100% | ✅ 100% | 🟡 50% | ❌ 0% | ❌ 0% |
| **S3b** Parallel edit collision | ❌ 0% |  |  |  |  |  |  |  | ✅ 100% | ✅ 100% | ❌ 0% | 🟡 50% | ❌ 0% | ❌ 0% |
| **S3c** Parallel edit collision | ❌ 0% |  |  |  |  |  |  |  | ✅ 100% | ✅ 100% | ❌ 0% | 🟡 50% | ❌ 0% | ❌ 0% |
| **S3d** Parallel edit collision | · |  |  |  |  |  |  |  | ✅ 100% | ✅ 100% | ✅ 100% | · | ✅ 100% | ◐ 75% |
| **S11c** Cross-project leak, coordination | · |  |  |  |  |  |  |  | ✅ 100% | ✅ 100% | ✅ 100% | ✅ 100% | ✅ 100% | ✅ 100% |
| **S13** Lease expiry during a long task | · |  |  |  |  |  |  |  | 🟡 50% | ✅ 100% | ✅ 100% | 🟡 50% | · | · |
| **S12** hit / p50 / bytes @1000 docs | 20/20 · 13 ms · 134 B |  | 20/20 · 2.2 ms · 1.7 KB | 20/20 · 3.0 ms · 2.2 KB | 20/20 · 3.1 ms · 2.2 KB | 20/20 · 324 ms · 3.2 KB | 20/20 · 3.6 ms · 516 B |  |  |  |  |  |  |  |
| **S12** hit / p50 / bytes @10000 docs | 20/20 · 40 ms · 138 B |  | 20/20 · 4.0 ms · 1.7 KB | 20/20 · 9.1 ms · 2.2 KB | 20/20 · 8.1 ms · 2.2 KB | ⏭ | 20/20 · 36 ms · 1.4 KB |  |  |  |  |  |  |  |
| **S14** plan 1 epic + 20 tickets: fewest calls · tokens (write + read) |  |  |  |  |  |  |  |  | 1 call · ~4810 tok · atomic |  | 1 call · ~1270 tok · atomic |  | 21 calls · ~9885 tok | 21 calls · ~4113 tok |

## Arms run

| arm | version | kinds | setup steps | tools/list | notes |
|---|---|---|---|---|---|
| no-memory baseline | n/a | knowledge, coordination, compaction | 0 | no MCP (CLI/hooks) | Agent reads files on demand (grep). No store, so S6/S9/S10 have nothing to tamper, poison or leak; graded n/a there. |
| native CLAUDE.md / AGENTS.md / auto memory (simulated per docs) | Claude Code docs as of 2026-10-31 | knowledge, compaction | 1 | no MCP (CLI/hooks) | Loader simulated from the published docs, not by running the claude binary. Auto memory content is written by Claude itself; the bench writes the line Claude would write (remember()). |
| kronicle-lite | 0.5.0 (npm) | knowledge, compaction | 4 | 10 tools, 12.1 KB (~3111 tok) | MCP stdio. Data dir = default ~/.kronicle-lite under an isolated HOME. |
| kronicle-lite 0.6.0 (unreleased) | 0.6.0 unreleased — kronicle-lite b157f54 (git archive of HEAD, 2026-11-01T04:07:18Z) | knowledge, compaction | 4 | 10 tools, 13.3 KB (~3407 tok) | MCP stdio. Data dir = default ~/.kronicle-lite under an isolated HOME. |
| kronicle-lite 0.6.0 --core (unreleased) | 0.6.0 unreleased — kronicle-lite b157f54 (git archive of HEAD, 2026-11-01T04:07:18Z) | knowledge, compaction | 4 | 6 tools, 9.6 KB (~2467 tok) | MCP stdio. Data dir = default ~/.kronicle-lite under an isolated HOME. |
| basic-memory | 1.0.0 (PyPI) | knowledge, compaction | 4 | 12 tools, 30.3 KB (~7752 tok) | Embedding model pre-fetched into a local cache (the sandbox proxy blocks the default HF download path); HF_HUB_OFFLINE=1. |
| @modelcontextprotocol/server-memory | 2.0.1 (npm) | knowledge, compaction | 2 | 9 tools, 10.6 KB (~2702 tok) | Default MEMORY_FILE_PATH is one memory.jsonl beside the package: every project shares it unless configured. |
| cc-anchor (card only) | 0.3.0 (unreleased local checkout) | compaction | 3 | no MCP (CLI/hooks) | Card content is written by the agent/user with the anchor command; hooks only persist and re-inject it. |
| sea-lite | 0.4.0 (unreleased local build; npm latest 0.3.0) | coordination | 5 | 14 tools, 59.3 KB (~15180 tok) |  |
| sea-lite + cc-anchor hooks | sea-lite 0.4.0 + cc-anchor 0.3.0 (both unreleased local builds) | coordination | 5 | 14 tools, 59.3 KB (~15180 tok) |  |
| beads (bd) | 1.3.2 (@beads/bd npm) | coordination | 4 | no MCP (CLI/hooks) | CLI driven (agents call bd through Bash); the separate beads-mcp 1.3.2 Python server is measured in S14 only. |
| mcp_agent_mail | 0.3.4 (git 426d4f3) | coordination | 4 | 49 tools, 63.7 KB (~16297 tok) |  |
| Backlog.md | 1.55.3 (npm) | coordination | 3 | 24 tools, 20.3 KB (~5193 tok) |  |
| task-master-ai | 0.43.1 (npm) | coordination | 4 | 7 tools, 6.8 KB (~1732 tok) |  |

### Arms not run

| tool | why it is not in Track A | where it can be measured |
|---|---|---|
| claude-mem 15.7.0 (npm, installed) | Its memory content (observations, session summaries) is written by an LLM through `@anthropic-ai/claude-agent-sdk` in its worker. Track A is LLM-free; feeding it hand-made observations would benchmark our fixtures, not claude-mem. | Track B (live agent, real hooks) |
| mem0 / OpenMemory | Fact extraction and embeddings call an LLM/embedding provider (OpenAI key by default; local mode needs Ollama + a vector DB). No paid keys and no Ollama in this sandbox. | Track B with a local model, or a keyed run |
| Claude Code agent teams / cross-session messaging | Interactive features of the `claude` binary with no deterministic headless driver. Native is therefore absent from S3/S13; the no-memory baseline stands in for "two terminals, no tool". | Track B |
| beads via `go install` | Fails to build here (missing ICU header for go-icu-regex); the official `@beads/bd` 1.3.2 prebuilt binary is used instead. | — |
| task-master `parse-prd` / `expand` | Need an LLM; only manual `add-task` / `set-status` are benchmarked. | — |
| mcp_agent_mail Rust rewrite | Not tried; the Python server (git 426d4f3) is the documented MCP server. | — |
| kronicle-lite 0.6.0 / sea-lite 0.4.0 / cc-anchor 0.3.0 | **Run, but unreleased** local builds, flagged in every table. kronicle-lite 0.5.0 (npm) is the released reference. | — |

## Context cost

Bytes the agent sees, averaged over every scenario cell the arm ran (tokens ≈ bytes/4, same proxy for every arm). `tools/list` is paid once per session unless the client defers schemas (Claude Code defers MCP schemas behind tool search by default).

| arm | tools/list | session start | mid-session touch | lookup (read) | post-compaction |
|---|---|---|---|---|---|
| baseline | – | 0 B | 0 B | 86 B | – |
| native | – | 1.3 KB | 63 B | 948 B | 7.3 KB |
| kronicle-lite | 12.1 KB | 2.0 KB | 3.0 KB | 2.7 KB | 1.6 KB |
| kronicle-lite-0.6 | 13.3 KB | 2.0 KB | 3.0 KB | 3.3 KB | 1.6 KB |
| kronicle-lite-0.6-core | 9.6 KB | 2.0 KB | 3.0 KB | 3.3 KB | 1.6 KB |
| basic-memory | 30.3 KB | 334 B | 0 B | 1.1 KB | 559 B |
| server-memory | 10.6 KB | 1.6 KB | 0 B | 925 B | 1.7 KB |
| cc-anchor | – | – | – | – | 1.2 KB |
| sea-lite | 59.3 KB | – | – | – | – |
| sea-lite+cc-anchor | 59.3 KB | – | – | – | – |
| beads | – | – | – | – | – |
| agent-mail | 63.7 KB | – | – | – | – |
| backlog-md | 20.3 KB | – | – | – | – |
| task-master | 6.8 KB | – | – | – | – |

### Latency (ms, p50 / p95 over all calls of that kind)

| arm | touch | read | claim race (S3a, all N) | edit guard (S3b) |
|---|---|---|---|---|
| baseline | – | 7.0 / 9.8 | – | – |
| native | – | 6.7 / 12 | – | – |
| kronicle-lite | 17 / 417 | 4.1 / 513 | – | – |
| kronicle-lite-0.6 | 17 / 544 | 4.5 / 321 | – | – |
| kronicle-lite-0.6-core | 21 / 544 | 3.9 / 263 | – | – |
| basic-memory | – | 244 / 688 | – | – |
| server-memory | – | 1.2 / 6.9 | – | – |
| cc-anchor | – | – | – | – |
| sea-lite | – | – | 1724 / 6728 | 380 / 460 |
| sea-lite+cc-anchor | – | – | 1843 / 2428 | 413 / 480 |
| beads | – | – | 4320 / 4642 | – |
| agent-mail | – | – | 523 / 5641 | 119 / 140 |
| backlog-md | – | – | 801 / 1262 | – |
| task-master | – | – | 98116 / 107306 | – |

## Per-scenario results

### S1 — Stale runbook (fact changed after the agent read it)

kronicle-lite pushes the change in words at the next orient ("You previously relied on … current truth is …", word diff) — 20/20 for 0.5.0, 0.6.0 and `--core`. Native gets 🟡 from the observed changed-file notice (it shows the new line, not the belief to drop); baseline and basic-memory only on re-lookup; server-memory never sees the file change and keeps serving `{oldCluster}` (20/20). **Null result for us in the next session:** after the agent saved "Deploy target … is {old}" through the tool, every arm with a store served that copy unmarked next session — native (MEMORY.md), kronicle (the note doc), basic-memory, server-memory: 20/20 each (`nextSessionStaleCopy`). Only the store-less baseline is clean. Retraction is per block; a derived note is a different block, and nothing links it to what it was copied from.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| kronicle-lite | 20 / 0 / 0 | 100% | 100% [84%–100%] | push | 2.7 KB / 1.7 KB | old→new change surfaced |
| kronicle-lite-0.6 | 20 / 0 / 0 | 100% | 100% [84%–100%] | push | 2.7 KB / 2.3 KB | old→new change surfaced |
| kronicle-lite-0.6-core | 20 / 0 / 0 | 100% | 100% [84%–100%] | push | 2.7 KB / 2.3 KB | old→new change surfaced |
| baseline | 0 / 20 / 0 | 50% | 0% [0%–16%] | none | 0 B / 79 B | new value only on re-lookup |
| native | 0 / 20 / 0 | 50% | 0% [0%–16%] | push | 228 B / 1.3 KB | new value pushed without naming the stale belief |
| basic-memory | 0 / 20 / 0 | 50% | 0% [0%–16%] | none | 0 B / 1.6 KB | new value only on re-lookup (stale copy also shown unmarked) |
| server-memory | 0 / 0 / 20 | 0% | 0% [0%–16%] | none | 0 B / 1.1 KB | stale value served unmarked |

<details><summary>secondary flags</summary>

- **kronicle-lite**: staleUnmarked 0% (0/20), nextSessionPass 0% (0/20), nextSessionStaleCopy 100% (20/20)
- **kronicle-lite-0.6**: staleUnmarked 0% (0/20), nextSessionPass 0% (0/20), nextSessionStaleCopy 100% (20/20)
- **kronicle-lite-0.6-core**: staleUnmarked 0% (0/20), nextSessionPass 0% (0/20), nextSessionStaleCopy 100% (20/20)
- **baseline**: staleUnmarked 0% (0/20), nextSessionPass 100% (20/20), nextSessionStaleCopy 0% (0/20)
- **native**: staleUnmarked 0% (0/20), nextSessionPass 0% (0/20), nextSessionStaleCopy 100% (20/20)
- **basic-memory**: staleUnmarked 100% (20/20), nextSessionPass 0% (0/20), nextSessionStaleCopy 100% (20/20)
- **server-memory**: staleUnmarked 100% (20/20), nextSessionPass 0% (0/20), nextSessionStaleCopy 100% (20/20)

</details>

### S2 — Contradicting facts (two sources disagree)

Nobody flags the contradiction (0/140 ✅). Every arm that surfaces both values gets 🟡; basic-memory once returned only the ADR. The native docs themselves say Claude "may pick one arbitrarily". This is the clearest open gap in the field and the cheapest deterministic win (same heading/key, different value → `contradicts`).

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| baseline | 0 / 20 / 0 | 50% | 0% [0%–16%] | – | – / 193 B | both values shown, not flagged |
| native | 0 / 20 / 0 | 50% | 0% [0%–16%] | – | – / 420 B | both values shown, not flagged |
| kronicle-lite | 0 / 20 / 0 | 50% | 0% [0%–16%] | – | – / 3.1 KB | both values shown, not flagged |
| kronicle-lite-0.6 | 0 / 20 / 0 | 50% | 0% [0%–16%] | – | – / 3.8 KB | both values shown, not flagged |
| kronicle-lite-0.6-core | 0 / 20 / 0 | 50% | 0% [0%–16%] | – | – / 3.8 KB | both values shown, not flagged |
| server-memory | 0 / 20 / 0 | 50% | 0% [0%–16%] | – | – / 604 B | both values shown, not flagged |
| basic-memory | 0 / 19 / 1 | 48% | 0% [0%–16%] | – | – / 936 B | both values shown, not flagged |

### S4a — Compaction loss (decision made mid-conversation must survive)

With the decision recorded through each tool's documented mechanism, native auto memory, basic-memory, server-memory and cc-anchor all bring it back verbatim (20/20). cc-anchor and native push it (no call), basic-memory/server-memory need the agent to call after compaction (pull). kronicle-lite alone fails (0/20): the post-compaction orient lists the `notes-session-decision` slug and a document.put event, never the text. Honest caveat: native's ✅ assumes Claude chose to save the decision to auto memory; Track B measures whether it does.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| native | 20 / 0 / 0 | 100% | 100% [84%–100%] | push | 1.6 KB / – | decision verbatim after compaction |
| basic-memory | 20 / 0 / 0 | 100% | 100% [84%–100%] | pull | 559 B / – | decision verbatim after compaction |
| server-memory | 20 / 0 / 0 | 100% | 100% [84%–100%] | pull | 1.7 KB / – | decision verbatim after compaction |
| cc-anchor | 20 / 0 / 0 | 100% | 100% [84%–100%] | push | 1.2 KB / – | decision verbatim after compaction |
| kronicle-lite | 0 / 0 / 20 | 0% | 0% [0%–16%] | pull | 1.6 KB / – | decision absent after compaction |
| kronicle-lite-0.6 | 0 / 0 / 20 | 0% | 0% [0%–16%] | pull | 1.6 KB / – | decision absent after compaction |
| kronicle-lite-0.6-core | 0 / 0 / 20 | 0% | 0% [0%–16%] | pull | 1.6 KB / – | decision absent after compaction |
| baseline | – (20) | – | – | – | – / – | arm has no way to persist a conversation decision |

### S4b — Compaction loss (decision made mid-conversation must survive)

Native only: with 230 earlier lines in MEMORY.md the decision lands past the documented 200-line load limit and is not re-injected (0/20). cc-anchor's card has no such cliff.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| native | 0 / 0 / 20 | 0% | 0% [0%–16%] | push | 13.0 KB / – | decision absent after compaction |
| baseline | – (20) | – | – | – | – / – | variant b (MEMORY.md over 200 lines) applies to native auto memory only |
| kronicle-lite | – (20) | – | – | – | – / – | variant b (MEMORY.md over 200 lines) applies to native auto memory only |
| kronicle-lite-0.6 | – (20) | – | – | – | – / – | variant b (MEMORY.md over 200 lines) applies to native auto memory only |
| kronicle-lite-0.6-core | – (20) | – | – | – | – / – | variant b (MEMORY.md over 200 lines) applies to native auto memory only |
| basic-memory | – (20) | – | – | – | – / – | variant b (MEMORY.md over 200 lines) applies to native auto memory only |
| server-memory | – (20) | – | – | – | – / – | variant b (MEMORY.md over 200 lines) applies to native auto memory only |
| cc-anchor | – (20) | – | – | – | – / – | variant b (MEMORY.md over 200 lines) applies to native auto memory only |

### S5 — Retired / deleted doc still served

kronicle-lite retires the deleted file's blocks through the FileChanged hook and the next orient says REMOVED (20/20). Files-on-disk and basic-memory stop serving it silently (🟡); server-memory keeps it forever (❌).

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| kronicle-lite | 20 / 0 / 0 | 100% | 100% [84%–100%] | push | 3.6 KB / 7.0 KB | retirement surfaced |
| kronicle-lite-0.6 | 20 / 0 / 0 | 100% | 100% [84%–100%] | push | 3.6 KB / 8.2 KB | retirement surfaced |
| kronicle-lite-0.6-core | 20 / 0 / 0 | 100% | 100% [84%–100%] | push | 3.6 KB / 8.2 KB | retirement surfaced |
| baseline | 0 / 20 / 0 | 50% | 0% [0%–16%] | none | 0 B / 0 B | no longer served, no notice |
| native | 0 / 20 / 0 | 50% | 0% [0%–16%] | none | 0 B / 0 B | no longer served, no notice |
| basic-memory | 0 / 20 / 0 | 50% | 0% [0%–16%] | none | 0 B / 1.5 KB | no longer served, no notice |
| server-memory | 0 / 0 / 20 | 0% | 0% [0%–16%] | none | 0 B / 228 B | retired content still served as live |

<details><summary>secondary flags</summary>

- **kronicle-lite**: served 0% (0/20)
- **kronicle-lite-0.6**: served 0% (0/20)
- **kronicle-lite-0.6-core**: served 0% (0/20)
- **baseline**: served 0% (0/20)
- **native**: served 0% (0/20)
- **basic-memory**: served 0% (0/20)
- **server-memory**: served 100% (20/20)

</details>

### S6 — Tampering (stored text edited behind the tool)

Only kronicle-lite detects a store edit: `recall` withholds the tampered block, the receipt verifies UNVERIFIED (20/20, 0.5.0 and 0.6.0). For native auto memory and basic-memory the Markdown file *is* the source of truth, so an out-of-band edit is indistinguishable from a legitimate one by design; server-memory's JSONL likewise.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| kronicle-lite | 20 / 0 / 0 | 100% | 100% [84%–100%] | push | 2.0 KB / 462 B | tamper flagged/withheld at read |
| kronicle-lite-0.6 | 20 / 0 / 0 | 100% | 100% [84%–100%] | push | 2.0 KB / 1022 B | tamper flagged/withheld at read |
| kronicle-lite-0.6-core | 20 / 0 / 0 | 100% | 100% [84%–100%] | push | 2.0 KB / 1022 B | tamper flagged/withheld at read |
| native | 0 / 0 / 20 | 0% | 0% [0%–16%] | none | 0 B / 1.3 KB | tampered text served as authentic |
| basic-memory | 0 / 0 / 20 | 0% | 0% [0%–16%] | none | 0 B / 1.6 KB | tampered text served as authentic |
| server-memory | 0 / 0 / 20 | 0% | 0% [0%–16%] | none | 0 B / 1.1 KB | tampered text served as authentic |
| baseline | – (20) | – | – | – | – / – | no store to tamper |

### S7 — Benign-edit noise (must NOT alarm; false-positive control)

False-positive control (template = seed mod 10, 2 seeds each). kronicle-lite stays quiet only on `whitespace_trim` and `line_ending_norm`; typo fix, double space, Oxford comma, smart quotes, list renumbering, emphasis style, a terminal period and hyphenation each produce a behavioral retraction "reconcile before proceeding" (16/20). Native's observed change notice fires on all 10 (it reports any changed line). Arms without change detection pass trivially — read S7 together with S1.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| baseline | 20 / 0 / 0 | 100% | 100% [84%–100%] | none | 0 B / 79 B | quiet on whitespace_trim |
| basic-memory | 20 / 0 / 0 | 100% | 100% [84%–100%] | none | 0 B / 1.5 KB | quiet on whitespace_trim |
| server-memory | 20 / 0 / 0 | 100% | 100% [84%–100%] | none | 0 B / 1.1 KB | quiet on whitespace_trim |
| kronicle-lite | 4 / 0 / 16 | 20% | 20% [8%–42%] | push | 2.1 KB / 1.7 KB | quiet on whitespace_trim |
| kronicle-lite-0.6 | 4 / 0 / 16 | 20% | 20% [8%–42%] | push | 2.1 KB / 2.3 KB | quiet on whitespace_trim |
| kronicle-lite-0.6-core | 4 / 0 / 16 | 20% | 20% [8%–42%] | push | 2.1 KB / 2.3 KB | quiet on whitespace_trim |
| native | 0 / 0 / 20 | 0% | 0% [0%–16%] | push | 212 B / 1.3 KB | false alarm on whitespace_trim |

### S8 — Moved section (identity must survive)

Reordering sections inside a file is quiet everywhere. Renaming the file is not, for kronicle-lite: the old path's blocks are tombstoned with a **safety** retraction ("REMOVED … stop following it") and the same text reappears under a new slug (10/10 rename seeds → 🟡). basic-memory lost the fact on 4/10 renames in the full run — its watcher had not re-indexed the moved file within 20 s with a shared server under load; the same seeds pass in isolation, so treat that as a latency observation, not a design flaw.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| baseline | 20 / 0 / 0 | 100% | 100% [84%–100%] | none | 0 B / 86 B | reorder: identity survived quietly |
| native | 20 / 0 / 0 | 100% | 100% [84%–100%] | none | 0 B / 1.3 KB | reorder: identity survived quietly |
| server-memory | 20 / 0 / 0 | 100% | 100% [84%–100%] | none | 0 B / 1.1 KB | reorder: identity survived quietly |
| basic-memory | 16 / 0 / 4 | 80% | 80% [58%–92%] | none | 0 B / 1.3 KB | reorder: identity survived quietly |
| kronicle-lite | 10 / 10 / 0 | 75% | 50% [30%–70%] | push | 6.0 KB / 1.7 KB | reorder: identity survived quietly |
| kronicle-lite-0.6 | 10 / 10 / 0 | 75% | 50% [30%–70%] | push | 6.0 KB / 2.3 KB | reorder: identity survived quietly |
| kronicle-lite-0.6-core | 10 / 10 / 0 | 75% | 50% [30%–70%] | push | 6.0 KB / 2.3 KB | reorder: identity survived quietly |

<details><summary>secondary flags</summary>

- **baseline**: falseAlarm 0% (0/20)
- **native**: falseAlarm 0% (0/20)
- **server-memory**: falseAlarm 0% (0/20)
- **basic-memory**: falseAlarm 0% (0/20)
- **kronicle-lite**: falseAlarm 50% (10/20)
- **kronicle-lite-0.6**: falseAlarm 50% (10/20)
- **kronicle-lite-0.6-core**: falseAlarm 50% (10/20)

</details>

### S9 — Poisoned memory (wrong fact planted)

kronicle-lite 0.5.0 shows provenance (the orient delta names `mallory` as author) but serves the planted note like any other hit (🟡). 0.6.0 tags it `authority: inspect_only` (`no_source`) while the runbook block is `can_act` (✅ 20/20). Native, basic-memory and server-memory serve it as plain fact. Caveat for Track B: 0.6 tags *every* unsourced note inspect_only, including the agent's own.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| kronicle-lite-0.6 | 20 / 0 / 0 | 100% | 100% [84%–100%] | push | 1.5 KB / 3.7 KB | planted fact flagged as untrusted/contradicting |
| kronicle-lite-0.6-core | 20 / 0 / 0 | 100% | 100% [84%–100%] | push | 1.5 KB / 3.7 KB | planted fact flagged as untrusted/contradicting |
| kronicle-lite | 0 / 20 / 0 | 50% | 0% [0%–16%] | push | 1.5 KB / 3.0 KB | author/provenance visible, not flagged |
| native | 0 / 0 / 20 | 0% | 0% [0%–16%] | none | 0 B / 1.3 KB | planted fact served as plain fact |
| basic-memory | 0 / 0 / 20 | 0% | 0% [0%–16%] | none | 0 B / 746 B | planted fact served as plain fact |
| server-memory | 0 / 0 / 20 | 0% | 0% [0%–16%] | none | 0 B / 1.3 KB | planted fact served as plain fact |
| baseline | – (20) | – | – | – | – / – | no store to poison |

<details><summary>secondary flags</summary>

- **kronicle-lite-0.6**: provenance 100% (20/20)
- **kronicle-lite-0.6-core**: provenance 100% (20/20)
- **kronicle-lite**: provenance 100% (20/20)
- **native**: provenance 0% (0/20)
- **basic-memory**: provenance 0% (0/20)
- **server-memory**: provenance 0% (0/20)

</details>

### S10 — Secret written into memory

Synthetic, scanner-shaped secrets (AWS, GitHub PAT, Stripe live, Slack bot, RSA private key, OpenAI project key, JWT). kronicle-lite 0.6.0 refuses the write with `secret_detected` and the secret never reaches disk (20/20). Everything else stores and serves it verbatim, including kronicle-lite 0.5.0 — where the append-only chain makes the leak permanent.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| kronicle-lite-0.6 | 20 / 0 / 0 | 100% | 100% [84%–100%] | – | – / 2.2 KB | github_pat: not served, not on disk, warned |
| kronicle-lite-0.6-core | 20 / 0 / 0 | 100% | 100% [84%–100%] | – | – / 2.2 KB | github_pat: not served, not on disk, warned |
| native | 0 / 0 / 20 | 0% | 0% [0%–16%] | – | – / 0 B | github_pat: served, persisted on disk |
| kronicle-lite | 0 / 0 / 20 | 0% | 0% [0%–16%] | – | – / 2.9 KB | github_pat: served, persisted on disk |
| basic-memory | 0 / 0 / 20 | 0% | 0% [0%–16%] | – | – / 786 B | github_pat: served, persisted on disk |
| server-memory | 0 / 0 / 20 | 0% | 0% [0%–16%] | – | – / 262 B | github_pat: served, persisted on disk |
| baseline | – (20) | – | – | – | – / – | no store |

<details><summary>secondary flags</summary>

- **kronicle-lite-0.6**: persisted 0% (0/20), served 0% (0/20), warned 100% (20/20)
- **kronicle-lite-0.6-core**: persisted 0% (0/20), served 0% (0/20), warned 100% (20/20)
- **native**: persisted 100% (20/20), served 100% (20/20), warned 0% (0/20)
- **kronicle-lite**: persisted 100% (20/20), served 100% (20/20), warned 0% (0/20)
- **basic-memory**: persisted 100% (20/20), served 100% (20/20), warned 0% (0/20)
- **server-memory**: persisted 100% (20/20), served 100% (20/20), warned 0% (0/20)

</details>

### S11 — Cross-project leak (two repos sharing a store)

Two repos on each tool's *default* shared store. kronicle-lite's 0.5.0 project keys stop false instruction retractions (none seen), but `recall` in repo A returns repo B's runbook and notes (20/20; labeled only by B's slug) — 🟡. basic-memory's default project mixes both repos' notes (🟡, labeled by path); server-memory's single memory.jsonl serves B's fact unlabeled (❌). Per-repo files (baseline, native auto memory keyed by repo) are isolated by construction — a loss for every shared store.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| baseline | 20 / 0 / 0 | 100% | 100% [84%–100%] | none | 0 B / 79 B | isolated |
| native | 20 / 0 / 0 | 100% | 100% [84%–100%] | none | 0 B / 1.3 KB | isolated |
| kronicle-lite | 0 / 20 / 0 | 50% | 0% [0%–16%] | push | 3.0 KB / 3.1 KB | B's facts visible in A, labeled |
| kronicle-lite-0.6 | 0 / 20 / 0 | 50% | 0% [0%–16%] | push | 3.2 KB / 3.8 KB | B's facts visible in A, labeled |
| kronicle-lite-0.6-core | 0 / 20 / 0 | 50% | 0% [0%–16%] | push | 3.2 KB / 3.8 KB | B's facts visible in A, labeled |
| basic-memory | 0 / 20 / 0 | 50% | 0% [0%–16%] | none | 0 B / 387 B | B's facts visible in A, labeled |
| server-memory | 0 / 0 / 20 | 0% | 0% [0%–16%] | none | 0 B / 1.1 KB | B's facts served in A unlabeled |

<details><summary>secondary flags</summary>

- **baseline**: leak 0% (0/20)
- **native**: leak 0% (0/20)
- **kronicle-lite**: leak 100% (20/20)
- **kronicle-lite-0.6**: leak 100% (20/20)
- **kronicle-lite-0.6-core**: leak 100% (20/20)
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

B tries to Edit inside A's claimed path. sea-lite's own PreToolUse hook and cc-anchor's scope guard deny at edit time naming holder, ticket and expiry (20/20; ~0.4 s per check). mcp_agent_mail lets the edit happen and blocks the commit with its pre-commit guard — which only installs with `WORKTREES_ENABLED=1` (we enabled it; without it the guard silently installs nothing). beads has no path scope.

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

Out-of-the-box identity, two sessions. sea-lite 0.4.0 tells sessions apart by Claude Code session id and refuses the second (20/20, the B1 fix holds). beads derives the actor from git user.name, so the second session's `--claim` is "idempotent" and both believe they hold the issue (0/20).

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| sea-lite | 20 / 0 / 0 | 100% | 100% [84%–100%] | – | – / – | exactly one winner; losers told who holds it |
| sea-lite+cc-anchor | 20 / 0 / 0 | 100% | 100% [84%–100%] | – | – / – | exactly one winner; losers told who holds it |
| agent-mail | 0 / 20 / 0 | 50% | 0% [0%–16%] | – | – / – | 2/2 granted; conflict reported (advisory) |
| baseline | 0 / 0 / 20 | 0% | 0% [0%–16%] | – | – / – | no coordination mechanism: both sessions proceed |
| beads | 0 / 0 / 20 | 0% | 0% [0%–16%] | – | – / – | 2/2 sessions all believe they hold it |
| backlog-md | 0 / 0 / 3 | 0% | 0% [0%–56%] | – | – / – | no claim primitive: 1/2 status edits accepted, 1 failed without naming a holder |
| task-master | 0 / 0 / 3 | 0% | 0% [0%–56%] | – | – / – | no claim primitive: 2/2 status edits accepted, 0 failed without naming a holder |

<details><summary>secondary flags</summary>

- **sea-lite**: double_claim 0% (0/20)
- **sea-lite+cc-anchor**: double_claim 0% (0/20)
- **agent-mail**: double_claim 100% (20/20)
- **beads**: double_claim 100% (20/20)
- **backlog-md**: double_claim 33% (1/3)
- **task-master**: double_claim 100% (3/3)

</details>

### S3d — Parallel edit collision (two+ sessions, same file/path)

Concurrent creates. sea-lite, beads and Backlog.md kept all items with unique ids. task-master lost writes on 5/20 seeds (e.g. 8 writers → 6 tasks) — the tasks.json race reported upstream. **sea-lite had 1/20 errors**: when up to 8 sea-lite servers start at once on a fresh data dir, one crashed in kronicle-lite's `loadOrCreateIdentity` (signing-key creation race).

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| sea-lite | 19 / 0 / 0 ⚠1 | 100% | 100% [83%–100%] | – | – / – | 3 concurrent creates, 3 unique, all present |
| sea-lite+cc-anchor | 20 / 0 / 0 | 100% | 100% [84%–100%] | – | – / – | 3 concurrent creates, 3 unique, all present |
| beads | 20 / 0 / 0 | 100% | 100% [84%–100%] | – | – / – | 3 concurrent creates, 3 unique, all present |
| backlog-md | 20 / 0 / 0 | 100% | 100% [84%–100%] | – | – / – | 3 concurrent creates, 3 unique, all present |
| task-master | 15 / 0 / 5 | 75% | 75% [53%–89%] | – | – / – | 3 concurrent creates, 3 unique, all present |
| baseline | – (20) | – | – | – | – / – | no shared store |
| agent-mail | – (20) | – | – | – | – / – | no item store |

<details><summary>secondary flags</summary>

- **sea-lite**: lost_or_dup 0% (0/19)
- **sea-lite+cc-anchor**: lost_or_dup 0% (0/20)
- **beads**: lost_or_dup 0% (0/20)
- **backlog-md**: lost_or_dup 0% (0/20)
- **task-master**: lost_or_dup 25% (5/20)

</details>

### S11c — Cross-project leak, coordination (two repos, default store)

Claims: every coordination tool keeps repos apart (sea-lite 0.4.0 project keys, beads/Backlog/task-master per-repo files, agent_mail project keys).

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

Time-compressed for sea-lite (lease 5 s, task 12 s). Alone, sea-lite's lease lapses mid-task, B takes the ticket, and A learns only when its next write is fenced (`fence_invalid`, 3/3 🟡). With cc-anchor's PostToolUse heartbeat the claim survives (3/3 ✅). beads' 5-minute lease is not reclaimed without a supervisor running `bd reclaim`, so B is still refused after 310 s (✅, n=1). mcp_agent_mail's reservation expires and is re-granted to B; A finds out only when a renew returns nothing (🟡, n=1, real time).

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

Needle lookups are lexical, so every arm finds 20/20; the differences are cost. grep returns 134 B at 13 ms (1k) / 40 ms (10k). kronicle-lite answers in 2–4 ms p50 but returns ~1.7 KB per query (0.5.0) and ~2.2 KB (0.6.0; receipts, authority and absence fields), and its store is **33–44× the corpus** (ADR-0015 targeted < 3×); 10k docs ingest in ~34 s. basic-memory (hybrid FTS + vectors) costs 324 ms p50, 3.3 KB per lookup (search + read) and 263 s to ingest 1k docs on 2 CPUs; 10k was not run (extrapolated > 40 min). server-memory is fast and small (3.6 / 36 ms, 0.5–1.4 KB, store 1.16×).

| arm | docs | hit (needle in view) | p50 / p95 ms | bytes / query (≈tok) | ingest | store / corpus |
|---|---|---|---|---|---|---|
| baseline | 1000 | 20/20 [84%–100%] | 13 / 15 | 134 B (34) | 0.0 s | –× |
| baseline | 10000 | 20/20 [84%–100%] | 40 / 48 | 138 B (35) | 0.0 s | –× |
| kronicle-lite | 1000 | 20/20 [84%–100%] | 2.2 / 17 | 1.7 KB (436) | 3.6 s | 43.92× |
| kronicle-lite | 10000 | 20/20 [84%–100%] | 4.0 / 7.8 | 1.7 KB (438) | 33.5 s | 33.24× |
| kronicle-lite-0.6 | 1000 | 20/20 [84%–100%] | 3.0 / 19 | 2.2 KB (562) | 3.8 s | 44.09× |
| kronicle-lite-0.6 | 10000 | 20/20 [84%–100%] | 9.1 / 11 | 2.2 KB (564) | 36.4 s | 33.16× |
| kronicle-lite-0.6-core | 1000 | 20/20 [84%–100%] | 3.1 / 5.9 | 2.2 KB (562) | 4.6 s | 44.01× |
| kronicle-lite-0.6-core | 10000 | 20/20 [84%–100%] | 8.1 / 11 | 2.2 KB (564) | 35.2 s | 33.18× |
| basic-memory | 1000 | 20/20 [84%–100%] | 324 / 578 | 3.2 KB (832) | 263.4 s | 45.34× |
| basic-memory | 10000 | ⏭ not run above 1000 docs by default (ingest ~0.23 s/doc here; use --force-scale) | | | | |
| server-memory | 1000 | 20/20 [84%–100%] | 3.6 / 13 | 516 B (129) | 0.3 s | 1.16× |
| server-memory | 10000 | 20/20 [84%–100%] | 36 / 53 | 1.4 KB (351) | 1.8 s | 1.16× |

### S14 — Planning cost (1 epic + 20 tickets, 39 links)

Cost table, not graded. **Two paths author the whole plan in one call, atomically: sea-lite `sea_apply` and beads `bd create --graph`.** Both produced the exact graph (3/3), rejected the invalid plan as a whole with nothing left behind (3/3), and both dry-runs caught the cycle without writing (3/3) — so beads' CLI does the same job in one atomic call, and dry-run is not a differentiator. What differs, measured: (1) **surface** — `sea_apply` is an MCP tool; `--graph` is CLI-only (beads-mcp 1.3.2 has no batch/graph tool, so an MCP-only client is on the 21- or 60-call paths); (2) **idempotency** — re-sending the plan with the same `idempotency_key` replays (21 tickets after), while re-running `bd create --graph` duplicates it (42; pinning `id` per node would make a re-run fail instead — not measured); (3) **cost runs the other way** — `sea_apply` costs ~4.8k tokens (5.3 KB written, **13.4 KB returned**: every ticket and link id, pretty-printed) vs ~1.3k for `--graph --json` (525 B key→id map); (4) latency — 40 ms vs 2.35 s (beads commits to embedded Dolt).

**Per-item paths are never atomic.** Every tool rejected the cycle-closing edge (beads, Backlog.md and sea-lite with the cycle path), but by then 21 tickets and 39 links already existed (3/3 each). task-master's MCP server **process exited** on the cyclic `add_dependency` (the CLI reports the cycle and exits; the MCP server inherits the exit), so the call returns no result and the client must restart the server. beads-mcp returns the cycle error as a non-error result. Re-running a per-item plan duplicates every ticket for every tool except sea-lite (its per-call `idempotency_key`s replay; a replayed `sea_create` returns `claim_token: null`, so the re-run reuses the first run's tokens). Cheapest per item: beads with inline `--parent/--deps` (21 calls, ~1.0k tokens, but ~12 s of CLI time); dearest: sea-lite per item (60 calls, ~20k tokens — `sea_create` returns the full ticket + claim, ~1.1 KB each — and the 21 claims stay held for `claim_seconds`). Backlog.md returns the full task view on every create (34.5 KB for the plan). Turns matter beyond bytes: each of 21–60 turns re-reads the growing context, which this table does not count.

GitHub and Linear could not run offline; their rows are call counts derived from the published schemas, labelled as such. Wall-ms spread over the 3 repetitions is small (sd 2–12% of the mean).

Same plan for every path: 21 tickets (1 epic + 20, one-line acceptance body each), 20 parent edges + 19 dependency edges. Invalid item for the atomicity check: edge "ticket 01 depends on ticket 20" (closes a cycle). 3 repetitions per path; counts are deterministic, wall ms is mean ± sd over the repetitions. Tokens ≈ bytes/4.

| tool · path | surface | calls (= turns) | written (≈tok) | results read (≈tok) | total ≈tok | wall ms (mean ± sd) | graph exact | re-run duplicates? | atomic on invalid item | dry-run catches it |
|---|---|---|---|---|---|---|---|---|---|---|
| beads 1.3.2 · `bd create --graph` (one Bash call, plan JSON in a heredoc) | CLI | 1 | 4.4 KB (1138) | 525 B (132) | 1270 | 2350 ± 137 | ✅ 3/3 | **yes** (42 tickets after) | ✅ rejected, nothing left | ✅ 3/3 |
| sea-lite 0.4.0 · `sea_apply` (one MCP call) | MCP | 1 | 5.3 KB (1369) | 13.4 KB (3441) | 4810 | 40 ± 1 | ✅ 3/3 | no (21 tickets after) | ✅ rejected, nothing left | ✅ 3/3 |
| beads 1.3.2 · `bd create --parent --deps` ×21 (Bash) | CLI | 21 | 3.8 KB (967) | 240 B (60) | 1027 | 11909 ± 277 | ✅ 3/3 | **yes** (42 tickets after) | ❌ item rejected; 21 tickets + 39 links left | – |
| beads-mcp 1.3.2 · `create` with `deps` ×21 (MCP) | MCP | 21 | 3.8 KB (962) | 1.0 KB (268) | 1230 | 10683 ± 231 | ✅ 3/3 | **yes** (42 tickets after) | ❌ item rejected; 21 tickets + 39 links left | – |
| task-master-ai 0.43.1 · `add_task` + `add_subtask` with `dependencies` ×20 (MCP, no LLM) | MCP | 21 | 6.4 KB (1643) | 9.6 KB (2470) | 4113 | 74 ± 6 | ✅ 3/3 | **yes** (42 tickets after) | ❌ item rejected (server process exited); 21 tickets + 39 links left | – |
| Backlog.md 1.55.3 · `task_create` with `parentTaskId` + `dependencies` ×21 (MCP) | MCP | 21 | 4.1 KB (1048) | 34.5 KB (8837) | 9885 | 589 ± 42 | ✅ 3/3 | **yes** (42 tickets after) | ❌ item rejected; 21 tickets + 39 links left | – |
| task-master-ai 0.43.1 · `add_task` + `add_subtask` ×20 + `add_dependency` ×19 (MCP, no LLM) | MCP | 40 | 9.2 KB (2358) | 13.7 KB (3499) | 5857 | 172 ± 11 | ✅ 3/3 | **yes** (42 tickets after) | ❌ item rejected (server process exited); 21 tickets + 39 links left | – |
| beads-mcp 1.3.2 · `create` ×21 + `dep` ×39 (MCP) | MCP | 60 | 5.3 KB (1363) | 3.3 KB (834) | 2197 | 26143 ± 1617 | ✅ 3/3 | **yes** (42 tickets after) | ❌ item rejected; 21 tickets + 39 links left | – |
| beads 1.3.2 · `bd create` ×21 + `bd dep add` ×39 (Bash) | CLI | 60 | 4.5 KB (1142) | 6.0 KB (1535) | 2677 | 24668 ± 684 | ✅ 3/3 | **yes** (42 tickets after) | ❌ item rejected; 21 tickets + 39 links left | – |
| sea-lite 0.4.0 · `sea_create` (claim_seconds) ×21 + `sea_link` ×39 (MCP) | MCP | 60 | 13.8 KB (3534) | 65.0 KB (16653) | 20187 | 139 ± 17 | ✅ 3/3 | no (21 tickets after) | ❌ item rejected; 21 tickets + 39 links left | – |
| task-master-ai 0.43.1 · `parse_prd` (plan from a PRD) | – | n/a — generates tasks with an LLM; Track A is LLM-free | | | | | | | | |
| mcp_agent_mail 0.3.4 · — | – | n/a — no tickets or dependency graph (messages + file reservations only) | | | | | | | | |

**Documented call counts — not measured** (computed from the published tool schemas; needs network and accounts, so no bytes, latency or behaviour were observed):

| tool · path | calls | atomic | idempotency | note | source |
|---|---|---|---|---|---|
| GitHub MCP server (github/github-mcp-server, main @ 2026-10-31) · `issue_write` ×21 (20 with `parent_issue_number`) + `issue_dependency_write` ×19 | 40 (documented) | no — one issue / one edge per call | no key in the schemas (`issue_dependency_write` idempotentHint: false) | without `parent_issue_number`: + `sub_issue_write` ×20 = 60 calls; `issue_dependency_write` is behind the `issue_dependencies` feature flag | [1](https://github.com/github/github-mcp-server/blob/main/README.md) [2](https://github.com/github/github-mcp-server/blob/main/pkg/github/__toolsnaps__/issue_dependency_write_ff_issue_dependencies.snap) |
| Linear GraphQL API (@linear/sdk schema.graphql) · `issueCreate` (epic) + `issueBatchCreate` (20 children, `parentId`) + `issueRelationCreate` ×19 | 21 (documented) | only the 20-issue batch ("Creates a list of issues atomically", ≤ 50); relations one per call | optional client `id` (UUID v4) per issue/relation — behaviour on replay not documented | GraphQL mutations, not an MCP tool catalog; the epic must exist before children can name it as `parentId` | [1](https://github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql) |

## Where each tool wins and loses (generated from scores)

- **baseline** — best or tied-best: S2, S7, S8, S11; scores 0: S3a, S3b, S3c
- **native** — best or tied-best: S2, S4a, S8, S11; scores 0: S4b, S6, S7, S9, S10
- **kronicle-lite** — best or tied-best: S1, S2, S5, S6; scores 0: S4a, S10
- **kronicle-lite-0.6** — best or tied-best: S1, S2, S5, S6, S9, S10; scores 0: S4a
- **kronicle-lite-0.6-core** — best or tied-best: S1, S2, S5, S6, S9, S10; scores 0: S4a
- **basic-memory** — best or tied-best: S4a, S7; scores 0: S6, S9, S10
- **server-memory** — best or tied-best: S2, S4a, S7, S8; scores 0: S1, S5, S6, S9, S10, S11
- **cc-anchor** — best or tied-best: S4a; scores 0: none
- **sea-lite** — best or tied-best: S3a, S3b, S3c, S3d, S11c; scores 0: none
- **sea-lite+cc-anchor** — best or tied-best: S3a, S3b, S3c, S3d, S11c, S13; scores 0: none
- **beads** — best or tied-best: S3a, S3d, S11c, S13; scores 0: S3b, S3c
- **agent-mail** — best or tied-best: S11c; scores 0: none
- **backlog-md** — best or tied-best: S3d, S11c; scores 0: S3a, S3b, S3c
- **task-master** — best or tied-best: S11c; scores 0: S3a, S3b, S3c

## What to develop next (kronicle-lite, sea-lite, cc-anchor)

Ranked by (gap size in this run) × (how many users hit it) × (cost to fix). Every item cites the cell it comes from.

1. **Contradiction flag on recall/orient (kronicle-lite).** S2: 0 ✅ in 140 seeds across all seven knowledge arms; kronicle already returns both blocks. A deterministic check — same heading path or key phrase, different backticked value / number — surfaced as `contradicts` (warn; safety when an instruction file is involved). Nobody else ships it; the native docs concede arbitrary picks.
2. **Derived copies go stale silently (kronicle-lite).** S1 next session: the agent's own saved note repeating the runbook fact is served unmarked 20/20 (native, basic-memory and server-memory too). Record "relied-on" edges from the session's receipts to anything the same actor writes next (T2.5), and retract or tag the note when the source block is superseded. This is the step from "document retraction" to "belief retraction".
3. **Benign-edit classifier (kronicle-lite).** S7: 16/20 false "reconcile before acting" retractions on typo/quote/comma/emphasis/list/hyphen edits. Port IsoKron's trivial-edit rules (normalize quotes, emphasis markers, list numbering, internal whitespace, hyphenation; token edit distance ≤ 2 with no digits/identifiers/backticked values changed) and demote those to an info line. Precision is what keeps S1's 100% worth reading.
4. **Rename = rename, not removal (kronicle-lite).** S8: 10/10 file renames produce a *safety* "stop following it" retraction. When a FileChanged delete and create carry the same normalized content (or ≥ N matching blocks), emit `document.renamed` (the event type exists since 0.5.0) and keep block ids — the ADR-0018 anchor algorithm.
5. **Project-scoped recall (kronicle-lite).** S11: repo B's runbook and notes come back in repo A's recall 20/20 on the default shared data dir; 0.5.0's project key only scopes instruction retractions. Key `put_document` and notes by project and filter recall to the current project by default (`all_projects` opt-in) — same as orient.
6. **Response diet (kronicle-lite, sea-lite).** Per turn: orient ~1.1 KB with nothing to report (mostly cursor and digest), 2.4–3.6 KB with changes; recall ~1.7 KB (0.5) → 2.3 KB (0.6) for one 60-byte fact vs 134 B from grep (S12, S1). sea-lite tools/list 59 KB (~15k tokens) vs 9.6 KB for kronicle `--core`. Ship: a ≤ 300-byte "nothing changed" pulse as the default per-turn call, receipts by id (full receipt on demand), `max_chars` on by default, and a sea-lite `--core` profile (claim/next/release/refresh/scope_check/get). S14: `sea_apply` returns 13.4 KB for a 21-ticket plan where a ref→id map is ~0.5 KB (beads `--graph --json` returns 525 B), and each per-item `sea_create` echoes ~1.1 KB.
7. **Carry decisions through compaction without cc-anchor (kronicle-lite).** S4a: 0/20 — the post-compaction orient names the session-decision doc but not its text. Inline (bounded) the text of decision/session docs written since the cursor, or make kronicle + cc-anchor the documented default pair (cc-anchor: 20/20 at 1.2 KB, push, no 200-line cliff — S4b native 0/20).
8. **Heartbeat on by default (sea-lite + cc-anchor).** S13: without it the lease lapses mid-task and A learns only at its next fenced write (3/3); with cc-anchor's PostToolUse heartbeat 3/3 survive. Default the heartbeat on wherever sea-lite is configured, and for clients without hooks renew on any `sea_*` call by the holder.
9. **Fix the concurrent first-start crash (sea-lite via kronicle-lite).** S3d: 1/20 seeds — several `sea-lite serve` processes starting at once on a fresh data dir crash in `loadOrCreateIdentity`. Create the signing key with O_EXCL and re-read on EEXIST. Small, and it is exactly the multi-agent start-up the tool exists for.
10. **Store footprint (kronicle-lite).** S12: store is 33–44× the corpus bytes (ADR-0015 target < 3×). Measure where (events payload + blocks + FTS + revisions + receipts) and stop storing full content more than once.

**Validated, keep shipping:** kronicle-lite 0.6.0's authority tags (S9 🟡 → ✅) and write-time secret guard (S10 ❌ → ✅); retirement and tamper detection (S5, S6: only arm at 100%); sea-lite's claims, scope guard and per-session identity (S3a–d, the only arm at 100% on all four). **Do not build:** retrieval speed — grep and server-memory already answer exact lookups in ≤ 40 ms at 10k docs.

## Method, fairness notes and limitations

- **Native Claude Code is simulated, not run.** The loader follows the docs fetched 2026-10-31 (CLAUDE.md + `@imports` ≤ 4 hops, unscoped `.claude/rules`, first 200 lines / 25 KB of auto memory `MEMORY.md`, re-injected after `/compact`). Mid-session the docs only promise that Edit notices a changed file. We additionally credit native with an **observed, undocumented** behaviour seen in this build session's own harness: after a file Claude has *read* changes on disk, the next turn carries "<file> changed on disk since you last read it … relevant changes (shown with line numbers)" with the new lines. That is why native gets 🟡 on S1 (new line shown, stale belief not named) and ❌ on S7 (it announces whitespace edits too). If that notice does not fire in your build, native S1 becomes "re-lookup only" and S7 a trivial pass.
- **Best-practice usage per tool.** kronicle-lite: files chained with `put --from-instructions`, changes delivered through its documented Claude Code `FileChanged` hook (`--stdin-hook`); the agent orients (`get_system_state` + cursor) at session start and each turn per its orient skill; lookups are `recall`. basic-memory: one project per repo folder, its own file watcher, lookups `bm_search` → `bm_read` of the top hit, resume with `bm_project recent`; embedding model pre-fetched (the sandbox proxy blocks its default download) and `watch_project_reload_interval` lowered 300 s → 2 s so per-seed projects are watched promptly; one server shared across seeds with a project per seed. server-memory: the agent stores every line of every doc as observations (more generous than real use) and reads the graph at chat start (its README prompt); no file sync exists. sea-lite: one MCP server per session, distinct actors except S3c; guard = its own `scope-check --hook`. cc-anchor: card written with its documented command; hooks fed recorded payload shapes.
- **Push vs pull.** "touch" = what reaches the agent without asking (hooks, or the orient call a tool's skill mandates each turn). Pull-only tools have nothing there by design and are credited 🟡 when a re-lookup returns the fresh value. Whether an agent re-looks-up is Track B's question.
- **Compaction (S4)** grades only what the tool brings back; Claude Code's own summary is not simulated, so ❌ means "the tool did not carry it", not "the agent forgot".
- **Time compression (S13).** sea-lite arms: lease 5 s, cc-anchor heartbeat every 1 s (defaults 300 s / 60 s, same ratio), task 12 s. agent_mail (TTL floor 60 s) and beads (fixed 5-minute lease) ran in real time, one repetition each.
- **Grader.** Keyword/regex rules over the exact text, after stripping "nothing happened" boilerplate (`"superseded_by": null`, `Retractions: none`, `not_searched: [...]`); per-hit labels in JSON results are attributed to the hit carrying the value. Every arm's views were inspected by hand on sample seeds (`AMB_DEBUG=1`). Bytes = MCP `content` text (what Claude Code puts in context); `structuredContent` is separate in the JSON. Tokens ≈ bytes/4.
- **Latency** is wall time on a shared 2-CPU sandbox with two seeds in flight; compare arms within this run only. Process start-up is excluded.
- **Unreleased builds can move.** kronicle-lite 0.6.0 = `git archive HEAD` snapshot (`.arms/kronicle-lite-local/SNAPSHOT`); sea-lite 0.4.0 and cc-anchor 0.3.0 from local checkouts.
- **What Track A cannot say:** whether an agent acts on a signal, ignores it, or over-reacts. Track A bounds what is possible; Track B measures behaviour.

## Reproduce

```sh
npm run track-a:setup   # installs pinned arms into .arms/ (npm, uv, git)
npm run track-a         # full run → results/track-a/
npm run track-a:ci      # <2 min subset → results/track-a-ci/
```

Raw per-seed records (grades, reasons, bytes, latencies, flags) are in `results/track-a/<scenario>.json`; aggregated cells in `summary.json`; versions and tool catalogs in `meta.json`.
