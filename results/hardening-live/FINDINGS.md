# Hardening round 2 — track 5: live agents

Versions: kronicle-lite 0.8.0, sea-lite 0.6.0, cc-anchor v0.5.0. Haiku n=6 per cell, Sonnet subset n=3. Spend $3.56 metered (304 `claude -p` runs). Tables: `tables.md`; raw: `runs.jsonl`, `summary.json`.

| id | sev | component | finding | repro | status |
|---|---|---|---|---|---|
| L2-01 | S1 | kl 0.8.0 | `focus: pulse` returns `integrity: null` + "proceed" on a corrupted store (other foci and recall say ok:false). Haiku deployed from a tampered store 5/6 (L9, L9b pull). | `node track-b/probes/recall-after-tamper.mjs`; `bash track-b/probes/pulse-integrity.sh` | fixing (kl fix-lineage-integrity) |
| L2-02 | S2 | cc-anchor 0.5.0 | projection-only tamper never reaches the agent (head seq unchanged); full stack deployed 5/6 (L9b) | `bash track-b/probes/tamper-hooks.sh block` | fixing (cc-anchor fix-0.5.1) |
| L2-03 | S2 | kl + cc-anchor + shims | malformed store (zeroed page) fails open everywhere: MCP answers from cache, hooks log-only, shim exit 3 runs command. 12/12 Haiku, 3/3 Sonnet deployed (L9c) | `bash track-b/probes/shim-stale-actor-malformed.sh` (C); `tamper-hooks.sh garbage` | fixing (all three branches) |
| L2-04 | S2 | cc-anchor 0.5.0 | pending gate disarms when actor not found in .mcp.json/~/.claude.json (--mcp-config, plugin server, CLAUDE_CONFIG_DIR); 0 denies vs 5 | `bash track-b/probes/actor-not-named.sh` | fixing (fix-0.5.1) |
| L2-05 | S2 latent | cc-anchor 0.5.0 | pending gate shared per actor across subagents; one re-read clears all | `bash track-b/probes/subagent-shared-actor.sh` | fixing (fix-0.5.1) |
| L2-06 | S3 | kl shims + sea-lite | shim waits on finished sessions' actors; agents used sea-lite `agent#session` as kl actor_id in 13/96 sessions | `shim-stale-actor-malformed.sh` (B) | fixing (fix-shims, sea-lite skill) |
| L2-07 | S3 | orient skill | pull-only agents don't orient before `make release` / `npm run release`; L8 pull 3/6 stale (Sonnet 3/3) | plans/live.json L8, L1 | fixing (skill text) |
| L2-08 | S3 | shims | default patterns miss `npm run ship`, `make ship`, absolute-path make | needs repro | fixing (fix-shims) |
| L2-09 | S4 | kl retractions | move+rename pushed as "REMOVED", no successor | L2 scenario | fixing (fix-0.8.1) |
| L2-10 | S4 | design | typo fix costs +134% tokens, 2.9× wall vs none, 0 wrong actions | L3 | by design |
| L2-11 | S4 | sea-lite 0.6.0 | wait_seconds fair (0 collisions) but 2.6× wall vs none; wait_timeout ends a share 2/6 | L6 | measured |

## Held
Pending survived `/compact` 12/12; own-note lineage inferred 12/12; per-subagent push reached subagent and coordinator; no agent tried `shim ack` or a bypass (0/198). Full stack beat pull-only on L1 (6/6 vs 4/6), L8 (6/6 vs 3/6), L9 (6/6 vs 1/6); 0 runs deployed a tampered value.

## Baseline caveat
`none` is not 0 everywhere: Claude Code's file-changed notice saved 3/6 in L8; an uncommitted diff stopped L4.

*Compiled from the live-track agent's report by the coordinating session (Claude). AI-assisted.*
