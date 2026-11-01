# Release re-run: before (pre-release builds) vs after (released versions)

*2026-11-01.* **Before** = the pre-release runs archived in `results/prerelease/`: kronicle-lite 0.5.0 (npm) and 0.6.0 (unreleased), sea-lite 0.4.0 (unreleased), cc-anchor 0.3.0 and its unreleased push-hook branch. **After** = the released versions: **kronicle-lite 0.7.0** and **sea-lite 0.5.0** from npm, **cc-anchor 0.4.0** from the git tag `v0.4.0` (b95500a). Competitors are at the same versions in both runs. Same seeds, same adapters and fixtures (one exception: Track B T7, fixture fixed). Full reports: [Track A](track-a/REPORT.md), [Track B](track-b/REPORT.md).

## Summary (95% CIs)

| scenario | before | after | verdict |
|---|---|---|---|
| A · S4a decision survives compaction (kronicle-lite) | 0/20 ✅ [0–16%] | 20/20 ✅ [84–100%] | fixed (carried notes) |
| A · S8 file renamed (kronicle-lite) | 10/20 ✅ [30–70%], 10 🟡 | 20/20 ✅ [84–100%] | fixed (no removal alarm) |
| A · S9 poisoned note (kronicle-lite) | 0.5.0: 0/20 ✅ (🟡) | 20/20 ✅ [84–100%] | fixed (authority tags; already in 0.6.0*) |
| A · S10 secret written to memory (kronicle-lite) | 0.5.0: 0/20 ✅ [0–16%] | 20/20 ✅ [84–100%] | fixed (write-time refusal; already in 0.6.0*) |
| A · S11 two repos, one store (kronicle-lite) | 0/20 ✅ (🟡) | 20/20 ✅ [84–100%] | fixed (project-scoped recall) |
| A · S7 benign edits stay quiet (kronicle-lite) | 0.5.0: 4/20 [8–42%] | 10/20 [30–70%] | better than 0.5.0; by design below the withdrawn unreleased classifier (20/20) |
| A · S1, S5, S6 change / retirement / tamper (kronicle-lite) | 20/20 each | 20/20 each | unchanged |
| A · S2 contradiction flagged (any arm) | 0/140 | 0/120 | unchanged: nobody |
| A · S3a–d collisions (sea-lite ± cc-anchor) | 20/20 each, S3d 1 crash | 20/20 each, 0 crashes | first-start crash fixed |
| A · S13 lease through a long task | sea-lite 🟡 3/3; + cc-anchor ✅ 3/3 | same | unchanged |
| A · S14 plan 1 epic + 20 tickets (sea_apply) | ~4.8k tokens | ~1.6k (~0.4k templated) | 3–12× cheaper |
| A · S15 contention (sea-lite, poll) | — | A does all 4, B gives up 3/3 | no `wait_seconds` in 0.5.0 |
| B · T1 stale runbook, pull-only kronicle-lite | 0/9 [0–30%] | 8/10 [49–94%], *p* < 0.001 | fixed by the 0.7.0 orient skill, 2× tokens |
| B · T1 stale runbook, kronicle-lite + cc-anchor push | 10/10 [72–100%] | 10/10 [72–100%] | unchanged (now released) |
| B · T1 no memory / native | 0/8, 0/9 | 0/10, 0/10 | unchanged |
| B · T6 benign typo, push arm | 6/6, 315k tok, 28 s | 6/6, 324k tok, 31 s (none: 175k, 15 s) | same; typo is pushed by design |
| B · T3 parallel agents, sea-lite + cc-anchor | 8/8 [68–100%], 156 s | 10/10 [72–100%], 170 s | no collisions; 3.3× wall of no tool |
| B · T7 coordinator + subagents (push arm) | 1/6 [3–56%] | 5/6 [44–97%] | fixture fix mostly; push reached the coordinator 0/6 |

## Regressions

No graded success rate of ours went down. What got worse:

1. **kronicle-lite per-call latency ~2×** (median p50 ratio 2.0× full / 1.75× `--core` over 28 timings, vs 1.16–1.27× for unchanged arms on the same box): orient-with-cursor 14 → 36 ms, recall 2.8 → 7.8 ms, 10k-doc recall 4.0 → 6.4 ms.
2. **kronicle-lite `tools/list` 12.1 → 14.1 KB** (vs 0.5.0); `--core` 9.6 → 10.4 KB (vs 0.6.0).
3. **Track B pull-only cost:** T1 tokens 232k → 448k per run, wall 21 → 36 s (the price of orienting before every world-changing command).
4. **cc-anchor 0.4.0 scope guard** p50 0.41 → 0.61 s per Edit (Track A S3b); Track B T3 sea-lite wall 156 → 170 s, tokens 1.26M → 1.37M per run.
5. **S7 vs the unreleased cosmetic classifier** (kl-next branch): 20/20 → 10/20 quiet, deliberately (it hid 27/38 real changes); Track B T6 shows the cost (+85% tokens vs no memory, no wrong action).

Found by this re-run and still open: kronicle-lite's `pulse` answers "within threshold; proceed" with `retractions: null` over a real supersession (both pull-only T1 failures and the T7 failure; same on 0.5.0); cc-anchor 0.4.0's single cursor hands the push to the first subagent (T7, 0/6 to the coordinator); sea-lite 0.5.0 has no blocking wait (S15, T3).

Spend: Track B **$1.17** metered for 88 graded runs (118 `claude -p` invocations) + $0.07 smoke test; cap was $8. Track A $0.

## Track A (deterministic, 20 seeds per randomized cell; S13 3 repetitions)

Cell = yes/partial/no · score ((yes + ½·partial)/n) · Wilson 95% CI of the ✅ rate. * = unreleased build. *p* = two-sided Fisher exact test of ✅ counts, first "before" vs after. ▲/▼ = score up/down vs that build. Cells that are n/a on both sides are omitted.

| scenario | tool | before | after | change | p |
|---|---|---|---|---|---|
| S1 | kronicle-lite | 0.5.0: 20/0/0 · 100% · ✅ 84%–100%<br>0.6.0*: 20/0/0 · 100% · ✅ 84%–100% | 0.7.0: 20/0/0 · 100% · ✅ 84%–100% | = | 1.000 |
| S1 | kronicle-lite --core | 0.6.0*: 20/0/0 · 100% · ✅ 84%–100% | 0.7.0: 20/0/0 · 100% · ✅ 84%–100% | = | 1.000 |
| S2 | kronicle-lite | 0.5.0: 0/20/0 · 50% · ✅ 0%–16%<br>0.6.0*: 0/20/0 · 50% · ✅ 0%–16% | 0.7.0: 0/20/0 · 50% · ✅ 0%–16% | = | 1.000 |
| S2 | kronicle-lite --core | 0.6.0*: 0/20/0 · 50% · ✅ 0%–16% | 0.7.0: 0/20/0 · 50% · ✅ 0%–16% | = | 1.000 |
| S3a | sea-lite | 0.4.0*: 20/0/0 · 100% · ✅ 84%–100% | 0.5.0: 20/0/0 · 100% · ✅ 84%–100% | = | 1.000 |
| S3a | sea-lite + cc-anchor | 0.4.0* + 0.3.0*: 20/0/0 · 100% · ✅ 84%–100% | 0.5.0 + 0.4.0: 20/0/0 · 100% · ✅ 84%–100% | = | 1.000 |
| S3b | sea-lite | 0.4.0*: 20/0/0 · 100% · ✅ 84%–100% | 0.5.0: 20/0/0 · 100% · ✅ 84%–100% | = | 1.000 |
| S3b | sea-lite + cc-anchor | 0.4.0* + 0.3.0*: 20/0/0 · 100% · ✅ 84%–100% | 0.5.0 + 0.4.0: 20/0/0 · 100% · ✅ 84%–100% | = | 1.000 |
| S3c | sea-lite | 0.4.0*: 20/0/0 · 100% · ✅ 84%–100% | 0.5.0: 20/0/0 · 100% · ✅ 84%–100% | = | 1.000 |
| S3c | sea-lite + cc-anchor | 0.4.0* + 0.3.0*: 20/0/0 · 100% · ✅ 84%–100% | 0.5.0 + 0.4.0: 20/0/0 · 100% · ✅ 84%–100% | = | 1.000 |
| S3d | sea-lite | 0.4.0*: 19/0/0 ⚠1 · 100% · ✅ 83%–100% | 0.5.0: 20/0/0 · 100% · ✅ 84%–100% | errors 1 → 0 | 1.000 |
| S3d | sea-lite + cc-anchor | 0.4.0* + 0.3.0*: 20/0/0 · 100% · ✅ 84%–100% | 0.5.0 + 0.4.0: 20/0/0 · 100% · ✅ 84%–100% | = | 1.000 |
| S4a | kronicle-lite | 0.5.0: 0/0/20 · 0% · ✅ 0%–16%<br>0.6.0*: 0/0/20 · 0% · ✅ 0%–16% | 0.7.0: 20/0/0 · 100% · ✅ 84%–100% | ▲ 0% → 100% | <0.001 |
| S4a | kronicle-lite --core | 0.6.0*: 0/0/20 · 0% · ✅ 0%–16% | 0.7.0: 20/0/0 · 100% · ✅ 84%–100% | ▲ 0% → 100% | <0.001 |
| S4a | cc-anchor | 0.3.0*: 20/0/0 · 100% · ✅ 84%–100% | 0.4.0: 20/0/0 · 100% · ✅ 84%–100% | = | 1.000 |
| S5 | kronicle-lite | 0.5.0: 20/0/0 · 100% · ✅ 84%–100%<br>0.6.0*: 20/0/0 · 100% · ✅ 84%–100% | 0.7.0: 20/0/0 · 100% · ✅ 84%–100% | = | 1.000 |
| S5 | kronicle-lite --core | 0.6.0*: 20/0/0 · 100% · ✅ 84%–100% | 0.7.0: 20/0/0 · 100% · ✅ 84%–100% | = | 1.000 |
| S6 | kronicle-lite | 0.5.0: 20/0/0 · 100% · ✅ 84%–100%<br>0.6.0*: 20/0/0 · 100% · ✅ 84%–100% | 0.7.0: 20/0/0 · 100% · ✅ 84%–100% | = | 1.000 |
| S6 | kronicle-lite --core | 0.6.0*: 20/0/0 · 100% · ✅ 84%–100% | 0.7.0: 20/0/0 · 100% · ✅ 84%–100% | = | 1.000 |
| S7 | kronicle-lite | 0.5.0: 4/0/16 · 20% · ✅ 8%–42%<br>0.6.0*: 4/0/16 · 20% · ✅ 8%–42% | 0.7.0: 10/0/10 · 50% · ✅ 30%–70% | ▲ 20% → 50% | 0.096 |
| S7 | kronicle-lite --core | 0.6.0*: 4/0/16 · 20% · ✅ 8%–42% | 0.7.0: 10/0/10 · 50% · ✅ 30%–70% | ▲ 20% → 50% | 0.096 |
| S8 | kronicle-lite | 0.5.0: 10/10/0 · 75% · ✅ 30%–70%<br>0.6.0*: 10/10/0 · 75% · ✅ 30%–70% | 0.7.0: 20/0/0 · 100% · ✅ 84%–100% | ▲ 75% → 100% | <0.001 |
| S8 | kronicle-lite --core | 0.6.0*: 10/10/0 · 75% · ✅ 30%–70% | 0.7.0: 20/0/0 · 100% · ✅ 84%–100% | ▲ 75% → 100% | <0.001 |
| S9 | kronicle-lite | 0.5.0: 0/20/0 · 50% · ✅ 0%–16%<br>0.6.0*: 20/0/0 · 100% · ✅ 84%–100% | 0.7.0: 20/0/0 · 100% · ✅ 84%–100% | ▲ 50% → 100% | <0.001 |
| S9 | kronicle-lite --core | 0.6.0*: 20/0/0 · 100% · ✅ 84%–100% | 0.7.0: 20/0/0 · 100% · ✅ 84%–100% | = | 1.000 |
| S10 | kronicle-lite | 0.5.0: 0/0/20 · 0% · ✅ 0%–16%<br>0.6.0*: 20/0/0 · 100% · ✅ 84%–100% | 0.7.0: 20/0/0 · 100% · ✅ 84%–100% | ▲ 0% → 100% | <0.001 |
| S10 | kronicle-lite --core | 0.6.0*: 20/0/0 · 100% · ✅ 84%–100% | 0.7.0: 20/0/0 · 100% · ✅ 84%–100% | = | 1.000 |
| S11 | kronicle-lite | 0.5.0: 0/20/0 · 50% · ✅ 0%–16%<br>0.6.0*: 0/20/0 · 50% · ✅ 0%–16% | 0.7.0: 20/0/0 · 100% · ✅ 84%–100% | ▲ 50% → 100% | <0.001 |
| S11 | kronicle-lite --core | 0.6.0*: 0/20/0 · 50% · ✅ 0%–16% | 0.7.0: 20/0/0 · 100% · ✅ 84%–100% | ▲ 50% → 100% | <0.001 |
| S11c | sea-lite | 0.4.0*: 20/0/0 · 100% · ✅ 84%–100% | 0.5.0: 20/0/0 · 100% · ✅ 84%–100% | = | 1.000 |
| S11c | sea-lite + cc-anchor | 0.4.0* + 0.3.0*: 20/0/0 · 100% · ✅ 84%–100% | 0.5.0 + 0.4.0: 20/0/0 · 100% · ✅ 84%–100% | = | 1.000 |
| S13 | sea-lite | 0.4.0*: 0/3/0 · 50% · ✅ 0%–56% | 0.5.0: 0/3/0 · 50% · ✅ 0%–56% | = | 1.000 |
| S13 | sea-lite + cc-anchor | 0.4.0* + 0.3.0*: 3/0/0 · 100% · ✅ 44%–100% | 0.5.0 + 0.4.0: 3/0/0 · 100% · ✅ 44%–100% | = | 1.000 |

**Controls and competitors (same versions both runs):** 3 cell(s) differ:

| scenario | arm | before | after |
|---|---|---|---|
| S2 | basic-memory | 0/19/1 · 48% · ✅ 0%–16% | 0/17/3 · 43% · ✅ 0%–16% |
| S8 | basic-memory | 16/0/4 · 80% · ✅ 58%–92% | 18/0/2 · 90% · ✅ 70%–97% |
| S3d | task-master | 15/0/5 · 75% · ✅ 53%–89% | 16/0/4 · 80% · ✅ 58%–92% |


**Context cost: `tools/list` (bytes the agent pays every session)**

| tool | before | after |
|---|---|---|
| kronicle-lite (full) | 0.5.0: 10 tools, 12.1 KB (~3111 tok); 0.6.0: 10 tools, 13.3 KB (~3407 tok) | 0.7.0: 10 tools, 14.1 KB (~3605 tok) |
| kronicle-lite `--core` | 0.6.0: 6 tools, 9.6 KB (~2467 tok) | 0.7.0: 6 tools, 10.4 KB (~2664 tok) |
| sea-lite (full) | 0.4.0: 14 tools, 59.3 KB (~15180 tok) | 0.5.0: 15 tools, 31.7 KB (~8128 tok) |
| sea-lite `--core` | 0.4.0: (no core profile) | 0.5.0: 9 tools, 11.7 KB (~2989 tok) |

**S12 retrieval at scale (kronicle-lite)**

| docs | before | after |
|---|---|---|
| 1000 full | 0.5.0: 20/20 hit · p50 2.2 ms · 1.7 KB/query · ingest 3.6 s · store 43.92× corpus<br>0.6.0: 20/20 hit · p50 3.0 ms · 2.2 KB/query · ingest 3.8 s · store 44.09× corpus | 0.7.0: 20/20 hit · p50 3.0 ms · 1.3 KB/query · ingest 3.8 s · store 44.29× corpus |
| 1000 --core | 0.6.0: 20/20 hit · p50 3.1 ms · 2.2 KB/query · ingest 4.6 s · store 44.01× corpus | 0.7.0: 20/20 hit · p50 3.0 ms · 1.3 KB/query · ingest 3.7 s · store 44.4× corpus |
| 10000 full | 0.5.0: 20/20 hit · p50 4.0 ms · 1.7 KB/query · ingest 33.5 s · store 33.24× corpus<br>0.6.0: 20/20 hit · p50 9.1 ms · 2.2 KB/query · ingest 36.4 s · store 33.16× corpus | 0.7.0: 20/20 hit · p50 6.4 ms · 1.3 KB/query · ingest 37.5 s · store 33.51× corpus |
| 10000 --core | 0.6.0: 20/20 hit · p50 8.1 ms · 2.2 KB/query · ingest 35.2 s · store 33.18× corpus | 0.7.0: 20/20 hit · p50 8.6 ms · 1.3 KB/query · ingest 38.0 s · store 33.76× corpus |

**S14 planning cost (sea-lite paths)**

| path | before (0.4.0) | after (0.5.0) |
|---|---|---|
| sea-lite/apply | 1 call(s), ~4810 tok (written 5.3 KB, returned 13.4 KB); exact 3/3, atomic 3/3 | 1 call(s), ~1618 tok (written 5.3 KB, returned 996 B); exact 3/3, atomic 3/3 |
| sea-lite/apply-template | – | 1 call(s), ~404 tok (written 617 B, returned 996 B); exact 3/3, atomic 3/3 |
| sea-lite/per-item | 60 call(s), ~20187 tok (written 13.8 KB, returned 65.0 KB); exact 3/3, atomic 0/3 | 60 call(s), ~16743 tok (written 13.8 KB, returned 51.6 KB); exact 3/3, atomic 0/3 |

**S15 contention (T3 pattern, scripted, time-compressed)** — no pre-release 0.4.0 run exists; the reference is the unreleased `wait` branch build.

| build · mode | n | wall s | done A / B | runs where an agent gave up | tool calls | model turns |
|---|---|---|---|---|---|---|
| sea-lite wait@987d4ea · sleep+retry | 3 | 9.07 | 4 / 0 | 3/3 | 15 | 20 |
| sea-lite wait@987d4ea · wait_seconds | 3 | 8.78 | 2 / 2 | 0/3 | 10 | 10 |
| sea-lite 0.5.0 · sleep+retry | 3 | 9.07 | 4 / 0 | 3/3 | 15 | 20 |
| sea-lite 0.5.0 · wait_seconds | – | not in the release | | | | |

## Track B (live headless `claude -p`, Haiku 5.5)

Success = all steps with the right values (T3: all 4 tickets, no collision). Cost = mean tokens · $ · wall per run. *p* = Fisher exact, success before vs after.

| scenario | arm | before success (95% CI) | after success (95% CI) | p | before cost | after cost |
|---|---|---|---|---|---|---|
| T1 | no memory | 0/8 = 0% (0%–32%) | 0/10 = 0% (0%–28%) | 1.000 | 182k tok · $0.0043 · 16 s | 175k tok · $0.0042 · 15 s |
| T1 | native CLAUDE.md | 0/9 = 0% (0%–30%) | 0/10 = 0% (0%–28%) | 1.000 | 143k tok · $0.0036 · 17 s | 153k tok · $0.0037 · 14 s |
| T1 | kronicle-lite pull-only 0.5.0 → 0.7.0 | 0/9 = 0% (0%–30%) | 8/10 = 80% (49%–94%) | <0.001 | 232k tok · $0.0063 · 21 s | 448k tok · $0.0113 · 36 s |
| T1 | kronicle-lite + cc-anchor push: 0.5.0 + push-hook (unreleased) → 0.7.0 + 0.4.0 | 10/10 = 100% (72%–100%) | 10/10 = 100% (72%–100%) | 1.000 | 318k tok · $0.0084 · 32 s | 354k tok · $0.0093 · 32 s |
| T6 | no memory | 6/6 = 100% (61%–100%) | 6/6 = 100% (61%–100%) | 1.000 | 174k tok · $0.0040 · 15 s | 175k tok · $0.0042 · 15 s |
| T6 | kronicle-lite + cc-anchor push (as T1) | 6/6 = 100% (61%–100%) | 6/6 = 100% (61%–100%) | 1.000 | 315k tok · $0.0085 · 28 s | 324k tok · $0.0086 · 31 s |
| T3 | no memory (BACKLOG.md) | 7/8 = 88% (53%–98%) | 6/10 = 60% (31%–83%) | 0.314 | 1087k tok · $0.0283 · 60 s | 796k tok · $0.0213 · 51 s |
| T3 | sea-lite + cc-anchor guard: 0.4.0 + 0.3.0 → 0.5.0 + 0.4.0 | 8/8 = 100% (68%–100%) | 10/10 = 100% (72%–100%) | 1.000 | 1263k tok · $0.0274 · 156 s | 1373k tok · $0.0284 · 170 s |
| T3 | beads 1.3.2 (unchanged) | 6/8 = 75% (41%–93%) | 9/10 = 90% (60%–98%) | 0.559 | 916k tok · $0.0222 · 59 s | 804k tok · $0.0203 · 53 s |
| T7 | cc-anchor shared cursor: push-hook (unreleased) → 0.4.0; fixture fixed | 1/6 = 17% (3%–56%) | 5/6 = 83% (44%–97%) | 0.080 | 157k tok · $0.0142 · 65 s | 147k tok · $0.0179 · 66 s |
| T7 | cc-anchor next-cycle per-subagent cursors (unreleased; not re-run) | 0/6 = 0% (0%–39%) | not re-run | – | 109k tok · $0.0165 · 67 s | – |

Track B after-run metered cost: $1.17 over 88 graded runs.

## Generated check: every compared cell whose score or success is lower after

Graded outcomes only (costs are in the Regressions section at the top). Includes the no-tool and competitor controls, whose versions did not change.

- Track B T3, no memory (BACKLOG.md) — control, version unchanged: 7/8 → 6/10, Fisher p = 0.314.
