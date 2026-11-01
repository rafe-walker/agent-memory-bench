# agent-memory-bench — Track A report

Generated 2026-11-01T06:24:32.762Z by `npm run track-a:ci` — deterministic, no LLM, $0. Seeds per randomized cell: **3**. Wall time 106 s on 2 CPU / 8 GB, Node v22.23.4. Bench code at commit `59768d8` plus the working tree committed with these results.

**Bottom line.** On the faults where a fact *changes* (S1 stale runbook, S5 retired doc, S6 tamper), kronicle-lite is the only arm that tells the agent what changed: 20/20 seeds each, ✅ [84–100%], against 🟡 for files-on-disk (baseline, native: the fresh value is there if the agent re-reads) and ❌ for the reference memory server (it keeps serving the old value, 20/20). sea-lite is the only coordination arm that passes all four collision variants (S3a–d, 20/20 each) — beads fails out-of-the-box identity (S3c 0/20: both sessions believe they hold the issue), mcp_agent_mail is advisory (every racer is granted, conflict reported; blocked only at commit by its opt-in guard), Backlog.md and task-master have no claim primitive. With cc-anchor's heartbeat, sea-lite also keeps a lease alive through a long task (S13 3/3; alone it lapses and the holder learns only at its next write).

**Where we lose or nobody wins.** No arm flags contradictory sources (S2: 0 ✅ across 140 seeds). Every arm that lets the agent save a copy of a fact (native auto memory, kronicle notes, basic-memory, server-memory) serves that copy unmarked after the source changes (S1 next session: 20/20 stale for all four). kronicle-lite raises "reconcile before acting" retractions on 8 of the 10 IsoKron benign-edit templates (S7: 4/20 quiet) and a *safety* "stop following it" retraction when a file is merely renamed (S8: 10/10 rename seeds). Its recall leaks a second repo's docs when two repos share the default data dir (S11 20/20, labeled by slug only), and plain per-repo files (baseline, native) beat every shared store there. Context cost is real: kronicle's per-turn orient is ~1.1 KB when nothing changed and 2.4–3.6 KB when something did (mean 3.0 KB over all cells), and a recall ~1.7 KB (0.5) / 2.3 KB (0.6) for a ~60-byte answer that grep returns in 134 B; sea-lite's catalog is 59 KB (~15k tokens).

**kronicle-lite 0.6.0 vs 0.5.0** (unreleased local build, same adapter): S9 poisoned memory 🟡 → ✅ (the planted note carries `authority: inspect_only`, 20/20) and S10 secrets ❌ → ✅ (`secret_detected` refusal on all 7 secret shapes, nothing on disk, 20/20). No change on S5, S11, S7, S8. `--core` cuts tools/list 13.3 → 9.6 KB with identical grades, but recall responses grew 29% (authority + absence fields) and p50 recall latency at 10k docs went 4.0 → 8–9 ms.

**How to read the grades.** Each cell is graded per seed against the scenario's expected signal (scenarios/*.yaml) by fixed string/regex rules in `track-a/lib/grade.mjs`: ✅ yes = the tool surfaced the fault the way the scenario expects; 🟡 partial = the agent could notice (e.g. the fresh value on re-lookup) but is not told what changed, or the signal is advisory; ❌ no = nothing, or the wrong thing, is shown. **Score** = (yes + ½·partial)/n. ◐ = mixed across seeds. · = not applicable (reason in the per-scenario table). Intervals are 95% Wilson on the yes-rate; exact Clopper–Pearson bounds are in the JSON.

## Headline matrix

| scenario | baseline | native | kronicle-lite | server-memory | cc-anchor | sea-lite | sea-lite+cc-anchor |
|---|---|---|---|---|---|---|---|
| **S1** Stale runbook | 🟡 50% | 🟡 50% | ✅ 100% | ❌ 0% |  |  |  |
| **S2** Contradicting facts | 🟡 50% | 🟡 50% | 🟡 50% | 🟡 50% |  |  |  |
| **S4a** Compaction loss | · | ✅ 100% | ❌ 0% | ✅ 100% | ✅ 100% |  |  |
| **S4b** Compaction loss | · | ❌ 0% | · | · | · |  |  |
| **S5** Retired / deleted doc still served | 🟡 50% | 🟡 50% | ✅ 100% | ❌ 0% |  |  |  |
| **S6** Tampering | · | ❌ 0% | ✅ 100% | ❌ 0% |  |  |  |
| **S7** Benign-edit noise | ✅ 100% | ❌ 0% | ◐ 67% | ✅ 100% |  |  |  |
| **S8** Moved section | ✅ 100% | ✅ 100% | ✅ 100% | ✅ 100% |  |  |  |
| **S9** Poisoned memory | · | ❌ 0% | 🟡 50% | ❌ 0% |  |  |  |
| **S10** Secret written into memory | · | ❌ 0% | ❌ 0% | ❌ 0% |  |  |  |
| **S11** Cross-project leak | ✅ 100% | ✅ 100% | 🟡 50% | ❌ 0% |  |  |  |
| **S3a** Parallel edit collision | ❌ 0% |  |  |  |  | ✅ 100% | ✅ 100% |
| **S3b** Parallel edit collision | ❌ 0% |  |  |  |  | ✅ 100% | ✅ 100% |
| **S3c** Parallel edit collision | ❌ 0% |  |  |  |  | ✅ 100% | ✅ 100% |
| **S3d** Parallel edit collision | · |  |  |  |  | ✅ 100% | ✅ 100% |
| **S11c** Cross-project leak, coordination | · |  |  |  |  | ✅ 100% | ✅ 100% |
| **S13** Lease expiry during a long task | · |  |  |  |  | 🟡 50% | ✅ 100% |
| **S12** hit / p50 / bytes @300 docs | 10/10 · 8.2 ms · 132 B |  | 10/10 · 2.5 ms · 1.7 KB | 10/10 · 2.7 ms · 514 B |  |  |  |

## Arms run

| arm | version | kinds | setup steps | tools/list | notes |
|---|---|---|---|---|---|
| no-memory baseline | n/a | knowledge, coordination, compaction | 0 | no MCP (CLI/hooks) | Agent reads files on demand (grep). No store, so S6/S9/S10 have nothing to tamper, poison or leak; graded n/a there. |
| native CLAUDE.md / AGENTS.md / auto memory (simulated per docs) | Claude Code docs as of 2026-10-31 | knowledge, compaction | 1 | no MCP (CLI/hooks) | Loader simulated from the published docs, not by running the claude binary. Auto memory content is written by Claude itself; the bench writes the line Claude would write (remember()). |
| kronicle-lite | 0.5.0 (npm) | knowledge, compaction | 4 | 10 tools, 12.1 KB (~3111 tok) | MCP stdio. Data dir = default ~/.kronicle-lite under an isolated HOME. |
| @modelcontextprotocol/server-memory | 2.0.1 (npm) | knowledge, compaction | 2 | 9 tools, 10.6 KB (~2702 tok) | Default MEMORY_FILE_PATH is one memory.jsonl beside the package: every project shares it unless configured. |
| cc-anchor (card only) | 0.3.0 (unreleased local checkout) | compaction | 3 | no MCP (CLI/hooks) | Card content is written by the agent/user with the anchor command; hooks only persist and re-inject it. |
| sea-lite | 0.4.0 (unreleased local build; npm latest 0.3.0) | coordination | 5 | 14 tools, 59.3 KB (~15180 tok) |  |
| sea-lite + cc-anchor hooks | sea-lite 0.4.0 + cc-anchor 0.3.0 (both unreleased local builds) | coordination | 5 | 14 tools, 59.3 KB (~15180 tok) |  |

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
| baseline | – | 0 B | 0 B | 85 B | – |
| native | – | 1.3 KB | 61 B | 943 B | 7.3 KB |
| kronicle-lite | 12.1 KB | 2.0 KB | 2.2 KB | 2.7 KB | 1.6 KB |
| server-memory | 10.6 KB | 1.6 KB | 0 B | 918 B | 1.7 KB |
| cc-anchor | – | – | – | – | 1.2 KB |
| sea-lite | 59.3 KB | – | – | – | – |
| sea-lite+cc-anchor | 59.3 KB | – | – | – | – |

### Latency (ms, p50 / p95 over all calls of that kind)

| arm | touch | read | claim race (S3a, all N) | edit guard (S3b) |
|---|---|---|---|---|
| baseline | – | 6.5 / 8.8 | – | – |
| native | – | 6.7 / 9.0 | – | – |
| kronicle-lite | 12 / 260 | 2.7 / 15 | – | – |
| server-memory | – | 1.5 / 15 | – | – |
| cc-anchor | – | – | – | – |
| sea-lite | – | – | 2362 / 2413 | 364 / 385 |
| sea-lite+cc-anchor | – | – | 2167 / 2238 | 379 / 407 |

## Per-scenario results

### S1 — Stale runbook (fact changed after the agent read it)

kronicle-lite pushes the change in words at the next orient ("You previously relied on … current truth is …", word diff) — 20/20 for 0.5.0, 0.6.0 and `--core`. Native gets 🟡 from the observed changed-file notice (it shows the new line, not the belief to drop); baseline and basic-memory only on re-lookup; server-memory never sees the file change and keeps serving `{oldCluster}` (20/20). **Null result for us in the next session:** after the agent saved "Deploy target … is {old}" through the tool, every arm with a store served that copy unmarked next session — native (MEMORY.md), kronicle (the note doc), basic-memory, server-memory: 20/20 each (`nextSessionStaleCopy`). Only the store-less baseline is clean. Retraction is per block; a derived note is a different block, and nothing links it to what it was copied from.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| kronicle-lite | 3 / 0 / 0 | 100% | 100% [44%–100%] | push | 2.7 KB / 1.7 KB | old→new change surfaced |
| baseline | 0 / 3 / 0 | 50% | 0% [0%–56%] | none | 0 B / 80 B | new value only on re-lookup |
| native | 0 / 3 / 0 | 50% | 0% [0%–56%] | push | 226 B / 1.3 KB | new value pushed without naming the stale belief |
| server-memory | 0 / 0 / 3 | 0% | 0% [0%–56%] | none | 0 B / 1.1 KB | stale value served unmarked |

<details><summary>secondary flags</summary>

- **kronicle-lite**: staleUnmarked 0% (0/3), nextSessionPass 0% (0/3), nextSessionStaleCopy 100% (3/3)
- **baseline**: staleUnmarked 0% (0/3), nextSessionPass 100% (3/3), nextSessionStaleCopy 0% (0/3)
- **native**: staleUnmarked 0% (0/3), nextSessionPass 0% (0/3), nextSessionStaleCopy 100% (3/3)
- **server-memory**: staleUnmarked 100% (3/3), nextSessionPass 0% (0/3), nextSessionStaleCopy 100% (3/3)

</details>

### S2 — Contradicting facts (two sources disagree)

Nobody flags the contradiction (0/140 ✅). Every arm that surfaces both values gets 🟡; basic-memory once returned only the ADR. The native docs themselves say Claude "may pick one arbitrarily". This is the clearest open gap in the field and the cheapest deterministic win (same heading/key, different value → `contradicts`).

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| baseline | 0 / 3 / 0 | 50% | 0% [0%–56%] | – | – / 191 B | both values shown, not flagged |
| native | 0 / 3 / 0 | 50% | 0% [0%–56%] | – | – / 416 B | both values shown, not flagged |
| kronicle-lite | 0 / 3 / 0 | 50% | 0% [0%–56%] | – | – / 3.1 KB | both values shown, not flagged |
| server-memory | 0 / 3 / 0 | 50% | 0% [0%–56%] | – | – / 602 B | both values shown, not flagged |

### S4a — Compaction loss (decision made mid-conversation must survive)

With the decision recorded through each tool's documented mechanism, native auto memory, basic-memory, server-memory and cc-anchor all bring it back verbatim (20/20). cc-anchor and native push it (no call), basic-memory/server-memory need the agent to call after compaction (pull). kronicle-lite alone fails (0/20): the post-compaction orient lists the `notes-session-decision` slug and a document.put event, never the text. Honest caveat: native's ✅ assumes Claude chose to save the decision to auto memory; Track B measures whether it does.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| native | 3 / 0 / 0 | 100% | 100% [44%–100%] | push | 1.6 KB / – | decision verbatim after compaction |
| server-memory | 3 / 0 / 0 | 100% | 100% [44%–100%] | pull | 1.7 KB / – | decision verbatim after compaction |
| cc-anchor | 3 / 0 / 0 | 100% | 100% [44%–100%] | push | 1.2 KB / – | decision verbatim after compaction |
| kronicle-lite | 0 / 0 / 3 | 0% | 0% [0%–56%] | pull | 1.6 KB / – | decision absent after compaction |
| baseline | – (3) | – | – | – | – / – | arm has no way to persist a conversation decision |

### S4b — Compaction loss (decision made mid-conversation must survive)

Native only: with 230 earlier lines in MEMORY.md the decision lands past the documented 200-line load limit and is not re-injected (0/20). cc-anchor's card has no such cliff.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| native | 0 / 0 / 3 | 0% | 0% [0%–56%] | push | 13.0 KB / – | decision absent after compaction |
| baseline | – (3) | – | – | – | – / – | variant b (MEMORY.md over 200 lines) applies to native auto memory only |
| kronicle-lite | – (3) | – | – | – | – / – | variant b (MEMORY.md over 200 lines) applies to native auto memory only |
| server-memory | – (3) | – | – | – | – / – | variant b (MEMORY.md over 200 lines) applies to native auto memory only |
| cc-anchor | – (3) | – | – | – | – / – | variant b (MEMORY.md over 200 lines) applies to native auto memory only |

### S5 — Retired / deleted doc still served

kronicle-lite retires the deleted file's blocks through the FileChanged hook and the next orient says REMOVED (20/20). Files-on-disk and basic-memory stop serving it silently (🟡); server-memory keeps it forever (❌).

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| kronicle-lite | 3 / 0 / 0 | 100% | 100% [44%–100%] | push | 3.6 KB / 7.0 KB | retirement surfaced |
| baseline | 0 / 3 / 0 | 50% | 0% [0%–56%] | none | 0 B / 0 B | no longer served, no notice |
| native | 0 / 3 / 0 | 50% | 0% [0%–56%] | none | 0 B / 0 B | no longer served, no notice |
| server-memory | 0 / 0 / 3 | 0% | 0% [0%–56%] | none | 0 B / 227 B | retired content still served as live |

<details><summary>secondary flags</summary>

- **kronicle-lite**: served 0% (0/3)
- **baseline**: served 0% (0/3)
- **native**: served 0% (0/3)
- **server-memory**: served 100% (3/3)

</details>

### S6 — Tampering (stored text edited behind the tool)

Only kronicle-lite detects a store edit: `recall` withholds the tampered block, the receipt verifies UNVERIFIED (20/20, 0.5.0 and 0.6.0). For native auto memory and basic-memory the Markdown file *is* the source of truth, so an out-of-band edit is indistinguishable from a legitimate one by design; server-memory's JSONL likewise.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| kronicle-lite | 3 / 0 / 0 | 100% | 100% [44%–100%] | push | 2.0 KB / 462 B | tamper flagged/withheld at read |
| native | 0 / 0 / 3 | 0% | 0% [0%–56%] | none | 0 B / 1.3 KB | tampered text served as authentic |
| server-memory | 0 / 0 / 3 | 0% | 0% [0%–56%] | none | 0 B / 1.1 KB | tampered text served as authentic |
| baseline | – (3) | – | – | – | – / – | no store to tamper |

### S7 — Benign-edit noise (must NOT alarm; false-positive control)

False-positive control (template = seed mod 10, 2 seeds each). kronicle-lite stays quiet only on `whitespace_trim` and `line_ending_norm`; typo fix, double space, Oxford comma, smart quotes, list renumbering, emphasis style, a terminal period and hyphenation each produce a behavioral retraction "reconcile before proceeding" (16/20). Native's observed change notice fires on all 10 (it reports any changed line). Arms without change detection pass trivially — read S7 together with S1.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| baseline | 3 / 0 / 0 | 100% | 100% [44%–100%] | none | 0 B / 79 B | quiet on whitespace_trim |
| server-memory | 3 / 0 / 0 | 100% | 100% [44%–100%] | none | 0 B / 1.1 KB | quiet on whitespace_trim |
| kronicle-lite | 2 / 0 / 1 | 67% | 67% [21%–94%] | push | 1.5 KB / 1.7 KB | quiet on whitespace_trim |
| native | 0 / 0 / 3 | 0% | 0% [0%–56%] | push | 202 B / 1.3 KB | false alarm on whitespace_trim |

### S8 — Moved section (identity must survive)

Reordering sections inside a file is quiet everywhere. Renaming the file is not, for kronicle-lite: the old path's blocks are tombstoned with a **safety** retraction ("REMOVED … stop following it") and the same text reappears under a new slug (10/10 rename seeds → 🟡). basic-memory lost the fact on 4/10 renames in the full run — its watcher had not re-indexed the moved file within 20 s with a shared server under load; the same seeds pass in isolation, so treat that as a latency observation, not a design flaw.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| baseline | 3 / 0 / 0 | 100% | 100% [44%–100%] | none | 0 B / 80 B | reorder: identity survived quietly |
| native | 3 / 0 / 0 | 100% | 100% [44%–100%] | none | 0 B / 1.3 KB | reorder: identity survived quietly |
| kronicle-lite | 3 / 0 / 0 | 100% | 100% [44%–100%] | push | 1.3 KB / 1.7 KB | reorder: identity survived quietly |
| server-memory | 3 / 0 / 0 | 100% | 100% [44%–100%] | none | 0 B / 1.1 KB | reorder: identity survived quietly |

<details><summary>secondary flags</summary>

- **baseline**: falseAlarm 0% (0/3)
- **native**: falseAlarm 0% (0/3)
- **kronicle-lite**: falseAlarm 0% (0/3)
- **server-memory**: falseAlarm 0% (0/3)

</details>

### S9 — Poisoned memory (wrong fact planted)

kronicle-lite 0.5.0 shows provenance (the orient delta names `mallory` as author) but serves the planted note like any other hit (🟡). 0.6.0 tags it `authority: inspect_only` (`no_source`) while the runbook block is `can_act` (✅ 20/20). Native, basic-memory and server-memory serve it as plain fact. Caveat for Track B: 0.6 tags *every* unsourced note inspect_only, including the agent's own.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| kronicle-lite | 0 / 3 / 0 | 50% | 0% [0%–56%] | push | 1.5 KB / 3.0 KB | author/provenance visible, not flagged |
| native | 0 / 0 / 3 | 0% | 0% [0%–56%] | none | 0 B / 1.3 KB | planted fact served as plain fact |
| server-memory | 0 / 0 / 3 | 0% | 0% [0%–56%] | none | 0 B / 1.3 KB | planted fact served as plain fact |
| baseline | – (3) | – | – | – | – / – | no store to poison |

<details><summary>secondary flags</summary>

- **kronicle-lite**: provenance 100% (3/3)
- **native**: provenance 0% (0/3)
- **server-memory**: provenance 0% (0/3)

</details>

### S10 — Secret written into memory

Synthetic, scanner-shaped secrets (AWS, GitHub PAT, Stripe live, Slack bot, RSA private key, OpenAI project key, JWT). kronicle-lite 0.6.0 refuses the write with `secret_detected` and the secret never reaches disk (20/20). Everything else stores and serves it verbatim, including kronicle-lite 0.5.0 — where the append-only chain makes the leak permanent.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| native | 0 / 0 / 3 | 0% | 0% [0%–56%] | – | – / 0 B | github_pat: served, persisted on disk |
| kronicle-lite | 0 / 0 / 3 | 0% | 0% [0%–56%] | – | – / 2.9 KB | github_pat: served, persisted on disk |
| server-memory | 0 / 0 / 3 | 0% | 0% [0%–56%] | – | – / 227 B | github_pat: served, persisted on disk |
| baseline | – (3) | – | – | – | – / – | no store |

<details><summary>secondary flags</summary>

- **native**: persisted 100% (3/3), served 100% (3/3), warned 0% (0/3)
- **kronicle-lite**: persisted 100% (3/3), served 100% (3/3), warned 0% (0/3)
- **server-memory**: persisted 100% (3/3), served 100% (3/3), warned 0% (0/3)

</details>

### S11 — Cross-project leak (two repos sharing a store)

Two repos on each tool's *default* shared store. kronicle-lite's 0.5.0 project keys stop false instruction retractions (none seen), but `recall` in repo A returns repo B's runbook and notes (20/20; labeled only by B's slug) — 🟡. basic-memory's default project mixes both repos' notes (🟡, labeled by path); server-memory's single memory.jsonl serves B's fact unlabeled (❌). Per-repo files (baseline, native auto memory keyed by repo) are isolated by construction — a loss for every shared store.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| baseline | 3 / 0 / 0 | 100% | 100% [44%–100%] | none | 0 B / 79 B | isolated |
| native | 3 / 0 / 0 | 100% | 100% [44%–100%] | none | 0 B / 1.3 KB | isolated |
| kronicle-lite | 0 / 3 / 0 | 50% | 0% [0%–56%] | push | 3.0 KB / 3.1 KB | B's facts visible in A, labeled |
| server-memory | 0 / 0 / 3 | 0% | 0% [0%–56%] | none | 0 B / 1.1 KB | B's facts served in A unlabeled |

<details><summary>secondary flags</summary>

- **baseline**: leak 0% (0/3)
- **native**: leak 0% (0/3)
- **kronicle-lite**: leak 100% (3/3)
- **server-memory**: leak 100% (3/3)

</details>

### S3a — Parallel edit collision (two+ sessions, same file/path)

N = 2–8 racers per seed. sea-lite and beads: exactly one winner, every loser told who holds it (20/20). mcp_agent_mail grants every racer an "exclusive" reservation and reports the conflict (advisory, 20/20). Backlog.md and task-master accept every status edit.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| sea-lite | 3 / 0 / 0 | 100% | 100% [44%–100%] | – | – / – | exactly one winner; losers told who holds it |
| sea-lite+cc-anchor | 3 / 0 / 0 | 100% | 100% [44%–100%] | – | – / – | exactly one winner; losers told who holds it |
| baseline | 0 / 0 / 3 | 0% | 0% [0%–56%] | – | – / – | no coordination mechanism: both sessions proceed |

<details><summary>secondary flags</summary>

- **sea-lite**: double_claim 0% (0/3)
- **sea-lite+cc-anchor**: double_claim 0% (0/3)

</details>

### S3b — Parallel edit collision (two+ sessions, same file/path)

B tries to Edit inside A's claimed path. sea-lite's own PreToolUse hook and cc-anchor's scope guard deny at edit time naming holder, ticket and expiry (20/20; ~0.4 s per check). mcp_agent_mail lets the edit happen and blocks the commit with its pre-commit guard — which only installs with `WORKTREES_ENABLED=1` (we enabled it; without it the guard silently installs nothing). beads has no path scope.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| sea-lite | 3 / 0 / 0 | 100% | 100% [44%–100%] | – | 379 B / – | blocked at edit, holder named |
| sea-lite+cc-anchor | 3 / 0 / 0 | 100% | 100% [44%–100%] | – | 538 B / – | blocked at edit, holder named |
| baseline | 0 / 0 / 3 | 0% | 0% [0%–56%] | – | – / – | no coordination mechanism: both sessions proceed |

### S3c — Parallel edit collision (two+ sessions, same file/path)

Out-of-the-box identity, two sessions. sea-lite 0.4.0 tells sessions apart by Claude Code session id and refuses the second (20/20, the B1 fix holds). beads derives the actor from git user.name, so the second session's `--claim` is "idempotent" and both believe they hold the issue (0/20).

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| sea-lite | 3 / 0 / 0 | 100% | 100% [44%–100%] | – | – / – | exactly one winner; losers told who holds it |
| sea-lite+cc-anchor | 3 / 0 / 0 | 100% | 100% [44%–100%] | – | – / – | exactly one winner; losers told who holds it |
| baseline | 0 / 0 / 3 | 0% | 0% [0%–56%] | – | – / – | no coordination mechanism: both sessions proceed |

<details><summary>secondary flags</summary>

- **sea-lite**: double_claim 0% (0/3)
- **sea-lite+cc-anchor**: double_claim 0% (0/3)

</details>

### S3d — Parallel edit collision (two+ sessions, same file/path)

Concurrent creates. sea-lite, beads and Backlog.md kept all items with unique ids. task-master lost writes on 5/20 seeds (e.g. 8 writers → 6 tasks) — the tasks.json race reported upstream. **sea-lite had 1/20 errors**: when up to 8 sea-lite servers start at once on a fresh data dir, one crashed in kronicle-lite's `loadOrCreateIdentity` (signing-key creation race).

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| sea-lite | 3 / 0 / 0 | 100% | 100% [44%–100%] | – | – / – | 3 concurrent creates, 3 unique, all present |
| sea-lite+cc-anchor | 3 / 0 / 0 | 100% | 100% [44%–100%] | – | – / – | 3 concurrent creates, 3 unique, all present |
| baseline | – (3) | – | – | – | – / – | no shared store |

<details><summary>secondary flags</summary>

- **sea-lite**: lost_or_dup 0% (0/3)
- **sea-lite+cc-anchor**: lost_or_dup 0% (0/3)

</details>

### S11c — Cross-project leak, coordination (two repos, default store)

Claims: every coordination tool keeps repos apart (sea-lite 0.4.0 project keys, beads/Backlog/task-master per-repo files, agent_mail project keys).

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| sea-lite | 3 / 0 / 0 | 100% | 100% [44%–100%] | – | – / – | isolated |
| sea-lite+cc-anchor | 3 / 0 / 0 | 100% | 100% [44%–100%] | – | – / – | isolated |
| baseline | – (3) | – | – | – | – / – | no claims |

### S13 — Lease expiry during a long task

Time-compressed for sea-lite (lease 5 s, task 12 s). Alone, sea-lite's lease lapses mid-task, B takes the ticket, and A learns only when its next write is fenced (`fence_invalid`, 3/3 🟡). With cc-anchor's PostToolUse heartbeat the claim survives (3/3 ✅). beads' 5-minute lease is not reclaimed without a supervisor running `bd reclaim`, so B is still refused after 310 s (✅, n=1). mcp_agent_mail's reservation expires and is re-granted to B; A finds out only when a renew returns nothing (🟡, n=1, real time).

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| sea-lite+cc-anchor | 1 / 0 / 0 | 100% | 100% [21%–100%] | – | – / – | claim held through 7s of work (lease 3s) |
| sea-lite | 0 / 1 / 0 | 50% | 0% [0%–79%] | – | – / – | lease lapsed mid-task; B took it; A learns only on its next write |
| baseline | – (1) | – | – | – | – / – | no claims |

<details><summary>secondary flags</summary>

- **sea-lite**: holderTold 100% (1/1)

</details>

### S12 — Retrieval at scale

Needle lookups are lexical, so every arm finds 20/20; the differences are cost. grep returns 134 B at 13 ms (1k) / 40 ms (10k). kronicle-lite answers in 2–4 ms p50 but returns ~1.7 KB per query (0.5.0) and ~2.2 KB (0.6.0; receipts, authority and absence fields), and its store is **33–44× the corpus** (ADR-0015 targeted < 3×); 10k docs ingest in ~34 s. basic-memory (hybrid FTS + vectors) costs 324 ms p50, 3.3 KB per lookup (search + read) and 263 s to ingest 1k docs on 2 CPUs; 10k was not run (extrapolated > 40 min). server-memory is fast and small (3.6 / 36 ms, 0.5–1.4 KB, store 1.16×).

| arm | docs | hit (needle in view) | p50 / p95 ms | bytes / query (≈tok) | ingest | store / corpus |
|---|---|---|---|---|---|---|
| baseline | 300 | 10/10 [72%–100%] | 8.2 / 9.8 | 132 B (33) | 0.0 s | –× |
| kronicle-lite | 300 | 10/10 [72%–100%] | 2.5 / 23 | 1.7 KB (435) | 1.4 s | 72.7× |
| server-memory | 300 | 10/10 [72%–100%] | 2.7 / 6.6 | 514 B (129) | 0.2 s | 1.16× |

## Where each tool wins and loses (generated from scores)

- **baseline** — best or tied-best: S2, S7, S8, S11; scores 0: S3a, S3b, S3c
- **native** — best or tied-best: S2, S4a, S8, S11; scores 0: S4b, S6, S7, S9, S10
- **kronicle-lite** — best or tied-best: S1, S2, S5, S6, S8, S9 (alone: S1, S5, S6, S9); scores 0: S4a, S10
- **server-memory** — best or tied-best: S2, S4a, S7, S8; scores 0: S1, S5, S6, S9, S10, S11
- **cc-anchor** — best or tied-best: S4a; scores 0: none
- **sea-lite** — best or tied-best: S3a, S3b, S3c, S3d, S11c; scores 0: none
- **sea-lite+cc-anchor** — best or tied-best: S3a, S3b, S3c, S3d, S11c, S13 (alone: S13); scores 0: none

## What to develop next (kronicle-lite, sea-lite, cc-anchor)

Ranked by (gap size in this run) × (how many users hit it) × (cost to fix). Every item cites the cell it comes from.

1. **Contradiction flag on recall/orient (kronicle-lite).** S2: 0 ✅ in 140 seeds across all seven knowledge arms; kronicle already returns both blocks. A deterministic check — same heading path or key phrase, different backticked value / number — surfaced as `contradicts` (warn; safety when an instruction file is involved). Nobody else ships it; the native docs concede arbitrary picks.
2. **Derived copies go stale silently (kronicle-lite).** S1 next session: the agent's own saved note repeating the runbook fact is served unmarked 20/20 (native, basic-memory and server-memory too). Record "relied-on" edges from the session's receipts to anything the same actor writes next (T2.5), and retract or tag the note when the source block is superseded. This is the step from "document retraction" to "belief retraction".
3. **Benign-edit classifier (kronicle-lite).** S7: 16/20 false "reconcile before acting" retractions on typo/quote/comma/emphasis/list/hyphen edits. Port IsoKron's trivial-edit rules (normalize quotes, emphasis markers, list numbering, internal whitespace, hyphenation; token edit distance ≤ 2 with no digits/identifiers/backticked values changed) and demote those to an info line. Precision is what keeps S1's 100% worth reading.
4. **Rename = rename, not removal (kronicle-lite).** S8: 10/10 file renames produce a *safety* "stop following it" retraction. When a FileChanged delete and create carry the same normalized content (or ≥ N matching blocks), emit `document.renamed` (the event type exists since 0.5.0) and keep block ids — the ADR-0018 anchor algorithm.
5. **Project-scoped recall (kronicle-lite).** S11: repo B's runbook and notes come back in repo A's recall 20/20 on the default shared data dir; 0.5.0's project key only scopes instruction retractions. Key `put_document` and notes by project and filter recall to the current project by default (`all_projects` opt-in) — same as orient.
6. **Response diet (kronicle-lite, sea-lite).** Per turn: orient ~1.1 KB with nothing to report (mostly cursor and digest), 2.4–3.6 KB with changes; recall ~1.7 KB (0.5) → 2.3 KB (0.6) for one 60-byte fact vs 134 B from grep (S12, S1). sea-lite tools/list 59 KB (~15k tokens) vs 9.6 KB for kronicle `--core`. Ship: a ≤ 300-byte "nothing changed" pulse as the default per-turn call, receipts by id (full receipt on demand), `max_chars` on by default, and a sea-lite `--core` profile (claim/next/release/refresh/scope_check/get).
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
