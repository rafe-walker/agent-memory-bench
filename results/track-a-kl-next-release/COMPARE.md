# kronicle-lite next-release (0.8.0 candidate) vs 0.7.0, lineage, shims — Track A, 20 seeds

Builds (git archive + tsup, `track-a/setup-kl-*.sh`): 0.7.0 = `f66f096`, lineage = `d791abf`,
shims = `48ce09e`, next-release = `b6c82e0` (lineage + shims merged; the shim gate on version-bound
reconciliation; bounded lineage inference). The 0.8.0 version-bump commit on top changes no behavior.
Same adapters as before: the agent never declares lineage (`remember` passes its cursor), S16 uses
`shim install --commands terraform` with a stub terraform.

New in this branch: S1/S7 flags `derivedRetractions` / `derivedPending` (count of `derived`
retractions and derived Pending items in the touch view; never graded); S7 variant `note` (the agent
saves a deploy-target note after its two reads; the default S7 cell is unchanged); S16 variant
`reread` (after the denial the agent re-reads, no `shim ack`).

## Knowledge cells

| cell | run | y/p/n/na | flags | touch B (mean) |
|---|---|---|---|---|
| S1 | 0.7.0 | 20/0/0/0 | nextSessionStaleCopy 20, nextSessionPass 0, staleUnmarked 0, pushedNew 20, derivedRetractions 0, derivedPending 0 | 2451 |
| S1 | lineage | 20/0/0/0 | nextSessionStaleCopy 0, nextSessionPass 20, staleUnmarked 0, pushedNew 20, derivedRetractions 20, derivedPending 20 | 3238 |
| S1 | next-release | 20/0/0/0 | nextSessionStaleCopy 0, nextSessionPass 20, staleUnmarked 0, pushedNew 20, derivedRetractions 20, derivedPending 20 | 3238 |
| S5 | 0.7.0 | 20/0/0/0 | served 0, noticed 20 | 3096 |
| S5 | lineage | 20/0/0/0 | served 0, noticed 20 | 3599 |
| S5 | next-release | 20/0/0/0 | served 0, noticed 20 | 3599 |
| S7 | 0.7.0 | 10/0/10/0 | alarm 10, derivedRetractions 0, derivedPending 0 | 1440 |
| S7 | lineage | 10/0/10/0 | alarm 10, derivedRetractions 0, derivedPending 0 | 1608 |
| S7 | next-release | 10/0/10/0 | alarm 10, derivedRetractions 0, derivedPending 0 | 1609 |
| S7note | 0.7.0 | 10/0/10/0 | alarm 10, derivedRetractions 0, derivedPending 0 | 1846 |
| S7note | lineage | 10/0/10/0 | alarm 10, derivedRetractions 10, derivedPending 10 | 2217 |
| S7note | next-release | 10/0/10/0 | alarm 10, derivedRetractions 10, derivedPending 10 | 2217 |
| S8 | 0.7.0 | 20/0/0/0 | retrievable 20, falseAlarm 0 | 1042 |
| S8 | lineage | 20/0/0/0 | retrievable 20, falseAlarm 0 | 1042 |
| S8 | next-release | 20/0/0/0 | retrievable 20, falseAlarm 0 | 1042 |
| S11 | 0.7.0 | 20/0/0/0 | leak 0, falseRetraction 0 | 1488 |
| S11 | lineage | 20/0/0/0 | leak 0, falseRetraction 0 | 1488 |
| S11 | next-release | 20/0/0/0 | leak 0, falseRetraction 0 | 1488 |

Per-seed grades, next-release vs 0.7.0: identical on every seed of S1, S5, S7, S7note, S8, S11.
**S1 next-session stale copy: 0.7.0 20/20 → next-release 0/20** (`nextSessionPass` 0 → 20).

### Derived-retraction noise

- **S7 (default)**: 0 derived retractions, 0 derived Pending items on all 20 seeds (no note is
  written); grades 10/0/10, same seeds as 0.7.0 (the 10 "alarms" are the real one-character edits
  0.7.0 already reports: typo, comma, smart quote, missing period, hyphenation).
- **S7note**: 10 derived retractions, exactly on those 10 real-edit seeds; 0 on the 10 format-only
  seeds. Grades unchanged (those seeds alarm on the runbook retraction anyway). This is the
  within-session over-approximation: the note is about the deploy target, but the agent also read
  the edited section in the same session, so the note is marked as derived from it. The session
  bound does not (and is not meant to) remove it; lineage and next-release are identical here.
- **S1**: 1 derived retraction per seed (the signal: the note copies the changed value).
- **No session (never oriented)** — `track-a/noise-inferred-lineage.mjs`: 300 docs, 2,000 reads
  over 7 days (978 distinct blocks), one note, then 50 random previously-read blocks superseded:

  | build | inferred edges | truncated | changes that marked the note stale |
  |---|---|---|---|
  | lineage `d791abf` | 978 | — | 50 / 50 |
  | next-release | 200 | `derived_from_inferred_truncated: true` | 8 / 50 |

## S16 exec-time gate

| cell | run | y/p/n | flags |
|---|---|---|---|
| S16a | shims 48ce09e | 20/0/0 | denied 20, staleRan 0, retryRanNew 20, pulse ≥10 s (timed out → fail open) 0 |
| S16b | shims 48ce09e | 20/0/0 | denied 20, staleRan 0, retryRanNew 20, pulse ≥10 s (timed out → fail open) 0 |
| S16control | shims 48ce09e | 0/0/20 | denied 0, staleRan 20, retryRanNew 0, pulse ≥10 s (timed out → fail open) 0 |
| S16reread | shims 48ce09e | 0/19/1 | denied 19, staleRan 1, retryRanNew 0, pulse ≥10 s (timed out → fail open) 1 |
| S16a | next-release | 19/0/1 | denied 19, staleRan 1, retryRanNew 19, pulse ≥10 s (timed out → fail open) 1 |
| S16b | next-release | 20/0/0 | denied 20, staleRan 0, retryRanNew 20, pulse ≥10 s (timed out → fail open) 0 |
| S16control | next-release | 0/0/20 | denied 0, staleRan 20, retryRanNew 0, pulse ≥10 s (timed out → fail open) 0 |
| S16reread | next-release | 20/0/0 | denied 20, staleRan 0, retryRanNew 20, pulse ≥10 s (timed out → fail open) 0 |
| S16a | next-release (rerun 1) | 19/0/1 | denied 19, staleRan 1, retryRanNew 19, pulse ≥10 s (timed out → fail open) 1 |
| S16b | next-release (rerun 1) | 20/0/0 | denied 20, staleRan 0, retryRanNew 20, pulse ≥10 s (timed out → fail open) 0 |
| S16control | next-release (rerun 1) | 0/0/20 | denied 0, staleRan 20, retryRanNew 0, pulse ≥10 s (timed out → fail open) 0 |
| S16reread | next-release (rerun 1) | 19/0/1 | denied 19, staleRan 1, retryRanNew 19, pulse ≥10 s (timed out → fail open) 1 |
| S16a | next-release (rerun 2, KRONICLE_SHIM_TIMEOUT=60) | 20/0/0 | denied 20, staleRan 0, retryRanNew 20, pulse ≥10 s (timed out → fail open) 0 |
| S16b | next-release (rerun 2, KRONICLE_SHIM_TIMEOUT=60) | 20/0/0 | denied 20, staleRan 0, retryRanNew 20, pulse ≥10 s (timed out → fail open) 0 |
| S16control | next-release (rerun 2, KRONICLE_SHIM_TIMEOUT=60) | 0/0/20 | denied 0, staleRan 20, retryRanNew 0, pulse ≥10 s (timed out → fail open) 0 |
| S16reread | next-release (rerun 2, KRONICLE_SHIM_TIMEOUT=60) | 20/0/0 | denied 20, staleRan 0, retryRanNew 20, pulse ≥10 s (timed out → fail open) 0 |

- **S16reread** (re-read, no ack): shims 0/19/1 → next-release 20/0/0: the version-bound gate lets
  the retry run with the new value after a recall alone; on the shims build the retry is refused
  until `shim ack`.
- S16a / S16b / control: same behavior as shims (a, b refused at exec with the diff; control runs
  stale).
- **Every NO outside `control` is the same thing on both builds**: one `kronicle-lite pulse` call
  took ≥ 10 s, the shim's timeout (`KRONICLE_SHIM_TIMEOUT`, default 10 s) fired and the command ran
  unchecked (fail open, as documented). 1 of 80 cells on shims, 1–2 of 80 per next-release run,
  0 of 80 with a 60 s timeout; normal pulses take 0.2–1.6 s. Not reproduced in 220 isolated
  S16-like iterations outside the harness. Open item (pre-existing in `shims`), not a regression of
  the version-bound gate.

## tools/list

Full 14,418 B (0.7.0) → 15,462 B; `--core` 10,655 B → 10,879 B. Identical to `lineage`: shims are
CLI-only and the bounded inference adds nothing to tools/list (`lean()` output schemas).
