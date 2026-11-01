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
