# agent-memory-bench — Track A report

Generated 2026-11-01T16:22:18.198Z by `npm run track-a` — deterministic, no LLM, $0. Seeds per randomized cell: **20**. Wall time 111 s on 2 CPU / 8 GB, Node v22.23.4. Bench code at commit `b5dd0aa` plus the working tree committed with these results.

**Bottom line.** On the faults where a fact *changes* (S1 stale runbook, S5 retired doc, S6 tamper), kronicle-lite is the only arm that tells the agent what changed: 20/20 seeds each, ✅ [84–100%], against 🟡 for files-on-disk (baseline, native: the fresh value is there if the agent re-reads) and ❌ for the reference memory server (it keeps serving the old value, 20/20). sea-lite is the only coordination arm that passes all four collision variants (S3a–d, 20/20 each) — beads fails out-of-the-box identity (S3c 0/20: both sessions believe they hold the issue), mcp_agent_mail is advisory (every racer is granted, conflict reported; blocked only at commit by its opt-in guard), Backlog.md and task-master have no claim primitive. With cc-anchor's heartbeat, sea-lite also keeps a lease alive through a long task (S13 3/3; alone it lapses and the holder learns only at its next write).

**Where we lose or nobody wins.** No arm flags contradictory sources (S2: 0 ✅ across 140 seeds). Every arm that lets the agent save a copy of a fact (native auto memory, kronicle notes, basic-memory, server-memory) serves that copy unmarked after the source changes (S1 next session: 20/20 stale for all four). kronicle-lite raises "reconcile before acting" retractions on 8 of the 10 IsoKron benign-edit templates (S7: 4/20 quiet) and a *safety* "stop following it" retraction when a file is merely renamed (S8: 10/10 rename seeds). Its recall leaks a second repo's docs when two repos share the default data dir (S11 20/20, labeled by slug only), and plain per-repo files (baseline, native) beat every shared store there. Context cost is real: kronicle's per-turn orient is ~1.1 KB when nothing changed and 2.4–3.6 KB when something did (mean 3.0 KB over all cells), and a recall ~1.7 KB (0.5) / 2.3 KB (0.6) for a ~60-byte answer that grep returns in 134 B; sea-lite's catalog is 59 KB (~15k tokens).

**kronicle-lite 0.6.0 vs 0.5.0** (unreleased local build, same adapter): S9 poisoned memory 🟡 → ✅ (the planted note carries `authority: inspect_only`, 20/20) and S10 secrets ❌ → ✅ (`secret_detected` refusal on all 7 secret shapes, nothing on disk, 20/20). No change on S5, S11, S7, S8. `--core` cuts tools/list 13.3 → 9.6 KB with identical grades, but recall responses grew 29% (authority + absence fields) and p50 recall latency at 10k docs went 4.0 → 8–9 ms.

**How to read the grades.** Each cell is graded per seed against the scenario's expected signal (scenarios/*.yaml) by fixed string/regex rules in `track-a/lib/grade.mjs`: ✅ yes = the tool surfaced the fault the way the scenario expects; 🟡 partial = the agent could notice (e.g. the fresh value on re-lookup) but is not told what changed, or the signal is advisory; ❌ no = nothing, or the wrong thing, is shown. **Score** = (yes + ½·partial)/n. ◐ = mixed across seeds. · = not applicable (reason in the per-scenario table). Intervals are 95% Wilson on the yes-rate; exact Clopper–Pearson bounds are in the JSON.

## Headline matrix

| scenario | kronicle-lite-next |
|---|---|
| **S1** Stale runbook | ✅ 100% |
| **S5** Retired / deleted doc still served | ✅ 100% |
| **S7** Benign-edit noise | ◐ 50% |
| **S8** Moved section | ✅ 100% |

## Arms run

| arm | version | kinds | setup steps | tools/list | notes |
|---|---|---|---|---|---|
| kronicle-lite next (unreleased, on 0.6.0) | next unreleased — kronicle-lite cosmetic-fix@230cc7d (git archive, 2026-11-01T16:20:09Z) | knowledge, compaction | 4 | 10 tools, 14.1 KB (~3605 tok) | MCP stdio. Data dir = default ~/.kronicle-lite under an isolated HOME. |

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
| kronicle-lite-next | 14.1 KB | 1.8 KB | 2.0 KB | 2.0 KB | – |

### Latency (ms, p50 / p95 over all calls of that kind)

| arm | touch | read | claim race (S3a, all N) | edit guard (S3b) |
|---|---|---|---|---|
| kronicle-lite-next | 37 / 511 | 7.8 / 288 | – | – |

## Per-scenario results

### S1 — Stale runbook (fact changed after the agent read it)

kronicle-lite pushes the change in words at the next orient ("You previously relied on … current truth is …", word diff) — 20/20 for 0.5.0, 0.6.0 and `--core`. Native gets 🟡 from the observed changed-file notice (it shows the new line, not the belief to drop); baseline and basic-memory only on re-lookup; server-memory never sees the file change and keeps serving `{oldCluster}` (20/20). **Null result for us in the next session:** after the agent saved "Deploy target … is {old}" through the tool, every arm with a store served that copy unmarked next session — native (MEMORY.md), kronicle (the note doc), basic-memory, server-memory: 20/20 each (`nextSessionStaleCopy`). Only the store-less baseline is clean. Retraction is per block; a derived note is a different block, and nothing links it to what it was copied from.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| kronicle-lite-next | 20 / 0 / 0 | 100% | 100% [84%–100%] | push | 2.4 KB / 1.3 KB | old→new change surfaced |

<details><summary>secondary flags</summary>

- **kronicle-lite-next**: staleUnmarked 0% (0/20), nextSessionPass 0% (0/20), nextSessionStaleCopy 100% (20/20)

</details>

### S5 — Retired / deleted doc still served

kronicle-lite retires the deleted file's blocks through the FileChanged hook and the next orient says REMOVED (20/20). Files-on-disk and basic-memory stop serving it silently (🟡); server-memory keeps it forever (❌).

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| kronicle-lite-next | 20 / 0 / 0 | 100% | 100% [84%–100%] | push | 3.0 KB / 3.8 KB | retirement surfaced |

<details><summary>secondary flags</summary>

- **kronicle-lite-next**: served 0% (0/20)

</details>

### S7 — Benign-edit noise (must NOT alarm; false-positive control)

False-positive control (template = seed mod 10, 2 seeds each). kronicle-lite stays quiet only on `whitespace_trim` and `line_ending_norm`; typo fix, double space, Oxford comma, smart quotes, list renumbering, emphasis style, a terminal period and hyphenation each produce a behavioral retraction "reconcile before proceeding" (16/20). Native's observed change notice fires on all 10 (it reports any changed line). Arms without change detection pass trivially — read S7 together with S1.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| kronicle-lite-next | 10 / 0 / 10 | 50% | 50% [30%–70%] | push | 1.4 KB / 1.3 KB | quiet on whitespace_trim |

### S8 — Moved section (identity must survive)

Reordering sections inside a file is quiet everywhere. Renaming the file is not, for kronicle-lite: the old path's blocks are tombstoned with a **safety** retraction ("REMOVED … stop following it") and the same text reappears under a new slug (10/10 rename seeds → 🟡). basic-memory lost the fact on 4/10 renames in the full run — its watcher had not re-indexed the moved file within 20 s with a shared server under load; the same seeds pass in isolation, so treat that as a latency observation, not a design flaw.

| arm | y / p / n (n/a) | score | yes-rate [95% CI] | delivery | bytes touch / read | majority reason |
|---|---|---|---|---|---|---|
| kronicle-lite-next | 20 / 0 / 0 | 100% | 100% [84%–100%] | push | 1.0 KB / 1.4 KB | reorder: identity survived quietly |

<details><summary>secondary flags</summary>

- **kronicle-lite-next**: falseAlarm 0% (0/20)

</details>

## Where each tool wins and loses (generated from scores)

- **kronicle-lite-next** — best or tied-best: S1, S5, S7, S8 (alone: S1, S5, S7, S8); scores 0: none

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
