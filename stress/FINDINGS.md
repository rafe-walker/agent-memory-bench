# Stress findings

Severity: **S1** data loss / safety lie · **S2** safety check silently skipped · **S3** wrong answer / resource / robustness · **S4** cosmetic.
Every finding reproduced at least twice. Run everything: `stress/run-all.sh` (env vars in its header). Raw logs: `stress/logs/` (gitignored).

## Round 1 (2026-11-01)

Commits tested → re-verified: kronicle-lite ab2f810 → 4379825 → f66f096 (0.7.0, released); sea-lite next eca4e58 → a00bf52, wait 987d4ea → 9953553; cc-anchor push-hook a816bf6 → d941299, next-cycle 356b633 → 1bf5883.

| id | sev | component @ commit | method | symptom | repro | status |
|---|---|---|---|---|---|---|
| F01 | S1 | kl @ ab2f810 | adversarial classifier corpus; CLI push contract; live `claude -p` | 27/38 real changes labelled cosmetic → no retraction, no push (typo rule, hyphen merge, review-stamp date masking, NFKC). Live: hidden arm 2/4 stale deploys | `KL=<kl> node stress/kl/classifier-corpus.mjs` | fixed @ 4379825 (0/38; live 4/4 correct) |
| F02 | S2 | kl @ ab2f810 | targeted | paragraph moved Allowed→Forbidden: no retraction, old receipt VERIFIED | `KL=… node stress/kl/section-move.mjs` | fixed @ 4379825 |
| F03 | S2 | kl @ ab2f810 | chaos | one non-JSON event payload crashes orient/get_system_state → hooks read "nothing to push" | `KLBIN=… KL=… MODE=badjson stress/kl/tamper-json.sh` | fixed @ 4379825 |
| F04 | S2 | cc-anchor @ a816bf6 | command corpus | pulse missed 11/37 world-changing commands (global options, whitespace, quoting, one-liners) | `CCA=… stress/cca/pulse-corpus.sh` | fixed @ d941299 |
| F05 | S2 | cc-anchor @ d941299 | extended corpus (74) | still misses 6/74: backslash-newline between tool and verb, `"git" "push"`, `git subtree push`, python here-doc running git push; 0/11 false alarms | same | open (in progress) |
| F06 | S2 | cc-anchor next-cycle @ 356b633 | adversarial Bash edits | Bash claimed-path guard silent for cp -p/-a, tar -x, mv over claimed file, touch -r, overlapping calls, claims < 30 s old, dirs > 4000 entries | `CCA=… SLBIN=… stress/cca/bash-guard.sh [case]` | fixed @ 1bf5883 (13/13 + 5 edge cases) |
| F07 | S2 | sea-lite @ a00bf52 | path probes | relative paths through a symlink not resolved: scope-check passes, and a second session can claim the same files via the link (Edit/Write hooks pass absolute paths and are safe) | `SLBIN=… stress/sl/symlink-scope.sh` | open (release blocker, in progress) |
| F08 | S3 | kl @ ab2f810 | 60 parallel CLI processes | 11–17/180 writes + one orient fail `database is locked` | `KLBIN=… stress/kl/concurrency.sh 60` | fixed @ f66f096 |
| F09 | S3 | sea-lite @ eca4e58 | idempotency | reused idempotency_key with a different batch silently replayed the first | `SLBIN=… node stress/sl/apply.mjs --only idempotencyRace` | fixed @ a00bf52 |
| F10 | S3 | cc-anchor @ a816bf6 | tampered store | push/pulse ignored integrity.ok | `CCA=… KLBIN=… KLMOD=… stress/cca/push.sh integrity` | fixed @ d941299 |
| F11 | S3 | kl, sea-lite | stdio fuzz | a single message > 10 MiB → server logs `ReadBuffer exceeded`, exits 0, no JSON-RPC error; client hangs to its timeout (probably SDK) | `KLBIN=… node stress/kl/mcp-fuzz.mjs kl` (and `sl`) | open |
| F12 | S3 | kl | read-only data dir | verify-chain/doctor can't open DB; doctor misreports FTS; verify-chain exits 1 (divergence) not 2 (I/O) | `KLBIN=… stress/kl/chaos.sh ro` (root) | open |
| F13 | S3 | kl @ ab2f810 | scale/soak | 10k docs: RSS 259→491 MB then flat; 40k docs: first get_system_state 10.4 s, RSS still rising at 1004 MB; verify-chain 31 s; push path 0.6–0.74 s | `KL=… node stress/kl/scale.mjs --docs 10000` | measured, not root-caused |
| F14 | S4 | kl | CLI | `export \| head` → unhandled EPIPE, exit 1 | `kronicle-lite export --data-dir D \| head -c 10` | open |
| F15 | S4 | sea-lite @ a00bf52 | CLI | `scope-check -- PATH` drops paths after `--`, exits 2 | `sea-lite scope-check --session x -- src/a.ts` | open (in progress) |

### Passed (no finding)
kl property fuzz (270 runs × 25–30 steps, 3 seeds); kl chaos (kill -9 ×40 mid-put, disk full on 1 MB tmpfs, torn pages); HTTP auth/rebinding/body limits on both servers; hostile slugs; sea-lite 40-process claim races; sea_apply caps, 400 MB expansion bomb refused in 6 ms, 16-way idempotency race; `wait` herd of 25, cancel/disconnect, kill -9 holder (claim 20–25 ms after expiry), progress every 5 s; cc-anchor fail-open (≤ 3.1 s, never denies when kl is broken).

### Observations (not filed)
- next-cycle subagent cursor key = first 16 alphanumerics of agent_id → possible collision (format unverified; being fixed with a hash of the full id).
- format-only classifier now pushes 16/18 benign edits by design → re-run Track B benign-noise arm.
- a corrupted SQLite index row is caught only by `doctor`; orient reports integrity.ok=true.

### Coverage gaps → round 2
Clock skew (no faketime), bash 3.2 / macOS same-second mtimes and case-insensitive paths, Windows separators, 2026-07-28 client handshakes, kl `watch`/`--stdin-hook` under concurrency, sea-lite `serve --http` per-actor tokens, live runs with compaction/resume, scale re-run on f66f096, ~$2 of live multi-agent scenarios.

## Round 2 (2026-11-01, in progress)

### Track 6 — hosted anchor (local only): 2 S1, 5 S2, 9 S3, 5 S4
Full file: isokron-anchor scratch clone `docs/hardening/FINDINGS.md` (bfddb2d). Targets isokron-anchor@7327b55, kronicle-lite@7e50702.

| id | sev | where | one-line | status |
|---|---|---|---|---|
| A2-01 | S1 | kl src/anchor/anchor.ts | verify --remote / --offline / anchor_status compare against unsigned root fields → rewritten chain passes | fixing (kl branch fix-anchor-client → 0.8.1) |
| A2-02 | S1 | anchor verifier.ts | verify page shows VERIFIED for a pasted list with forged root/range/time/status | fixing (anchor branch hardening-a2) |
| A2-03 | S2 | anchor routes/anchor.ts | concurrent different-root pushes never flagged as conflict | fixing (hardening-a2) |
| A2-04 | S2 | verifier + both clients | service-key validity window/status ignored | fixing (both) |
| A2-11 | S2 | kl anchor.ts | online verify ignores local receipts | fixing (kl) |
| A2-12 | S2 | kl client/config | service key not pinned; MITM re-signs | fixing (kl) |
| A2-02b | S2 | anchor verifier.ts | VERIFIED "public logs" with no inclusion proof | fixing (hardening-a2) |
| A2-05..10, 13 | S3 | anchor | quota burn, silent R2 failure, rate-limit order, body cap, small-order keys, wrong-chain PENDING, unbounded listing | fixing (hardening-a2) |
| A2-17 | S3 | kl anchor.ts | push stores unverified receipt | fixing (kl) |
| A2-18 | S3 | isokron-site pricing | claimed public logs not yet running | fixed @ isokron-site c734429 |
| A2-14, 15, 19 | S4 | anchor | raw errors, erasure undone, npm ci ERESOLVE | fixing (hardening-a2) |
| A2-20, 21 | S4 | kl | key on argv / http allowed; stale threat model | fixing (kl) |

### Track 3 — hooks, shims, guards: 2 S1, 14 S2, 7 S3 (H2-01..24; H2-17 unused)
Full file: hard-hooks `stress/findings/hooks.md` (386db8c, branch hardening-hooks).

| id | sev | where | one-line | status |
|---|---|---|---|---|
| H2-01 | S1 | cc-anchor 0.5.0 | `--actor=X` not parsed → wrong actor checked, push allowed | fixing (cc-anchor fix-0.5.1) |
| H2-10 | S1 | cc-anchor 0.5.0 | resumed subagent loses its actor at SubagentStop → push allowed | fixing (fix-0.5.1) |
| H2-02..05, 09 | S2 | cc-anchor | pulse matcher misses | fixing (fix-0.5.1) |
| H2-11 | S2 | cc-anchor | back-off uses stale pending=0 → silent allow | fixing (fix-0.5.1) |
| H2-12 | S2 | kl shims + cc-anchor | refusal tells agent to `shim ack`; agent clears gate without re-read | fixing (kl fix-shims + fix-0.5.1) |
| H2-13 | S2 | kl shims | git-core PATH (alias, hooks, rebase -x, submodule foreach) skips shim | fixing (fix-shims: pre-push hook) |
| H2-14 | S2 | kl shims | `git -C <project>` from outside allowed | fixing (fix-shims) |
| H2-18..22 | S2 | cc-anchor guards | parent rm/mv, late writes, board timeout blind 30 s, stale verdict cache, silent fail-open | fixing (fix-0.5.1) |
| H2-06..08 | S3 | cc-anchor | (round-1 report) | fixing (fix-0.5.1) |
| H2-15 | S3 | kl shims | sudo / env -i / absolute path bypass undocumented | fixing (docs + git hook) |
| H2-16 | S3 | kl shims | one agent blocked by another's stale reads | fixing (fix-shims) |
| H2-23 | S3 | sea-lite + cc-anchor | dangling symlink passes; `src/../src` rejected; exit 2 cached ok | fixing (sea-lite fix-0.6.1) |
| H2-24 | S3 | cc-anchor | git-ignored claims unreported; same-session subagent unwarned | fixing (fix-0.5.1) |
| F15 | S4 | sea-lite | paths after `--` dropped | fixing (fix-0.6.1) |

### Track 1 — retractions, lineage, pending: 4 S1, 8 S2, 5 S3 (R2-01..17)
Full file: hard-ret `stress/findings/retractions.md` (3eb7bd0, branch hardening-retractions). Target kl @ 7e50702 (0.8.0).

| id | sev | where | one-line | status |
|---|---|---|---|---|
| R2-01 | S1 | classifier parseBlock | list numbers dropped → `9090.`→`9091.` format-only, gate silent | fixing (fix-0.8.1) |
| R2-02 | S1 | classifier (FORMAT §3.8) | CommonMark-equal edits that change raw text (globs, tabs, list numbers) silent | fixing (fix-0.8.1: raw-text rule) |
| R2-04 | S1 | lineage inference | re-orient between recall and note drops lineage → stale note stays can_act | fixing (fix-lineage-integrity) |
| R2-05 | S1 | Lineage.staleness memo | truncated results cached across one recall → stale note inspect_only | fixing (fix-lineage-integrity) |
| R2-06 | S2 | planRevision | block reorder within a section: no event | fixing (fix-0.8.1) |
| R2-07 | S2 | pulse/shim seed | no stored position → `seed`, exit 0 with pending | fixing (fix-lineage-integrity) |
| R2-08 | S2 | pulse wording | counts since actor's last briefing, not presented cursor → "proceed" | fixing (fix-lineage-integrity) |
| R2-09 | S2 | integrity | superseded row made live / lineage rows deleted: integrity.ok true | fixing (fix-lineage-integrity) |
| R2-10 | S2 | secret guard | indented/quoted PEM key not refused | fixing (fix-lineage-integrity) |
| R2-11 | S2 | secret guard | `db_password:` / `"dbPassword"` not refused or scrubbed | fixing (fix-lineage-integrity) |
| R2-17 | S2 | honest absence | rewritten FTS row → `absent_in_searched`, all checks ok | fixing (fix-lineage-integrity) |
| R2-03 | S3 | classifier | backslash hard break format-only | fixing (fix-0.8.1) |
| R2-12 | S3 | editDistance | long token → 17.7 s pulse (past shim timeout), OOM at 8k | fixing (fix-0.8.1) |
| R2-13 | S3 | HEADING_RE | `C#`→`C` no event | fixing (fix-0.8.1) |
| R2-14 | S3 | lineage | removed source → note stale forever | fixing (fix-lineage-integrity) |
| R2-15 | S3 | derivedRetractions | not transitive | fixing (fix-lineage-integrity) |
| R2-16 | S3 | wordDiff snippet | >400-token block: diff/old/new identical | fixing (fix-0.8.1) |

### Track 5 — live agents (304 runs, $3.56): 1 S1, 4 S2, 3 S3, 3 S4 (L2-01..11)
Full file: agent-memory-bench branch hardening-live `results/hardening-live/FINDINGS.md`. S1: L2-01 pulse returns `integrity: null` + "proceed" on a corrupted store → Haiku deployed from tampered store 5/6 (fixing, fix-lineage-integrity). S2: L2-02 projection tamper invisible to cc-anchor; L2-03 malformed store fails open in MCP, hooks and shim (12/12 deployed); L2-04 gate disarms when actor not found; L2-05 gate shared across subagents. All routed to fix-0.8.1 / fix-lineage-integrity / fix-shims / cc-anchor fix-0.5.1 / sea-lite fix-0.6.1.

### Track 4 — protocol and real clients: 0 S1, 1 S2, 6 S3, 9 S4 (P2-01..16)
Full file: hard-proto `stress/findings/protocol.md` (633a5c0, branch hardening-protocol). Tested npm kl 0.8.0, sl 0.6.0, mcp-catalog-snap 0.1.0; 180/180 real-client tool calls passed (TS SDK v1/v2, Python mcp 1.x/2.x, stdio + HTTP).

| id | sev | where | one-line | status |
|---|---|---|---|---|
| P2-01 | S2 | kl shims × client docs | Cursor/Copilot snippets set a project data dir; shim checks ~/.kronicle-lite → push after change lands silently | fixing (fix-shims + isokron-plugins docs-clients) |
| P2-02 | S3 | kl put_document | response echoes every block → >10 MiB kills TS v2 client after commit | fixing (kl fix-protocol) |
| P2-03 | S3 | sl sea_list/sea_history | no response budget → 38 MiB, client dies | fixing (sl fix-0.6.1) |
| P2-04 | S3 | kl schemas | get_system_state fails its own full output schema (`integrity.seq`) | fixing (fix-protocol) |
| P2-05 | S3 | both (F11) | >10 MiB frame → exit 0, no error; now reachable by a schema-valid put | fixing (both) |
| P2-06 | S3 | both (SDK stdio) | parse errors / BOM / batch never answered → client hangs | fixing (both, SDK limits documented) |
| P2-07 | S3 | sl serve --http | bearer-file first-start race | fixing (fix-0.6.1) |
| P2-08..14 | S4 | kl, sl | HTTP vs stdio size limit, Host userinfo 500, wrong error codes, pre-initialize calls run, token reload, 0644 token file, uuid/seq validation | fixing (fix-protocol, fix-0.6.1) |
| P2-15 | S4 | mcp-catalog-snap | sha mismatch only warns; emptied snapshot passes with --allow-additions | fixing (fix-0.1.1) |
| P2-16 | S4 | docs | no Hermes config; --actor docs disagree | fixing (docs-clients) |
| F12, F14 | S3/S4 | kl (round 1) | read-only data dir; export EPIPE | fixing (fix-protocol) |

### Track 2 — concurrency, chaos, storage, upgrades: 0 S1, 3 S2, 7 S3 (C2-01..10)
Full file: hard-chaos `stress/findings/chaos.md` (c76a3eb, branch hardening-chaos). Published kl 0.8.0 / sl 0.6.0; host load 20–48, absolute latencies inflated.

| id | sev | where | one-line | status |
|---|---|---|---|---|
| C2-03 | S2 | kl pulse/shim | lost or regenerated per-project cursor → re-seed at head, push allowed with pending | fixing (fix-lineage-integrity, with R2-07) |
| C2-04 | S2 | kl pulse | after chain rollback, a plain retry is allowed (denial counted as a briefing) | fixing (fix-lineage-integrity) |
| C2-05 | S2 | kl lineage | wall-clock string compare; +3 s skew drops every inferred edge | fixing (fix-lineage-integrity, with R2-04) |
| C2-01 | S3 | kl storage | no downgrade guard; 0.5/0.6 rebuild nulls project_key; all checks pass | fixing (fix-protocol) |
| C2-02 | S3 | sl CLI | unlocked cli-claims.json RMW loses tokens under 40-way concurrency | fixing (sl fix-0.6.1 / 0.6.2) |
| C2-06 | S3 | sl leases | per-process wall clock; 15 min skew steals live lease | fixing (sl, doc + guard) |
| C2-07 | S3 | sl idempotency | F09 returns across 0.4→0.6 upgrade (no request_hash on old events) | fixing (sl) |
| C2-08 | S3 | kl openDatabase | BEGIN IMMEDIATE on every open → readers wait on writers; 14 s hold → shim runs unchecked (likely root of "1 pulse in 80 ≥ 10 s") | fixing (fix-protocol) |
| C2-09 | S3 | kl scale | 10k docs: new-actor orient 12.6–17.7 s; reads log never pruned, pending linear | fixing (kl fix-scale) |
| C2-10 | S3 | kl import | concurrent imports write duplicate identical puts | fixing (fix-scale) |
| F12 (wider) | S3 | kl | read-only/full data dir → pulse exit 3, shims fail open | fixing (fix-protocol) |
| F13 | — | kl | RSS growth did not reproduce at 10k (flat 175–177 MB) | closed (not reproduced) |

Passed: kl upgrades 0.5/0.6/0.7→0.8 incl. symlinked paths; sl up/downgrades 0.4/0.5↔0.6; mixed writers; 30/30/40-process storms (no locks, no double claims); kill -9 ×40 all-or-nothing; WAL loss + snapshot restore; sl 10k tickets (sea_next p95 179 ms); wait herd of 50 (one winner).

### Round 2 status
All six tracks reported. Totals: S1 9 (A2-01, A2-02, H2-01, H2-10, R2-01, R2-02, R2-04, R2-05, L2-01), all routed to fixers. Exit rule needs a round 3 on the merged fixes.

### Fix status (2026-11-01 evening)
- sea-lite 0.6.1 merged (831d143): kl ^0.8.0, H2-23, P2-03, P2-05 (sl), P2-07, P2-12, P2-13, C2-02, L2-06 wording. F15 was already fixed in 0.6.0. Deferred to 0.6.2: C2-06, C2-07.
- Round-3 lead: `sl-cli-tokens.sh 40` — 1 of 4 runs had one claim process crash inside a SQLite transaction under load (cause not captured).
- kronicle-lite 0.8.1 merged so far: anchor client (#4, e256ef4), shims (#5, 616ce0d). Pending: fix-0.8.1 (#3, rebasing), fix-lineage-integrity, fix-protocol, fix-scale, fix-anchor-paging.
- mcp-catalog-snap 0.1.1 merged (e580462); isokron-plugins docs-clients merged (6880f88).
