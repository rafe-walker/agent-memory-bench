# kronicle-lite `lineage` vs 0.7.0 — Track A S1/S5/S7/S8/S11 (20 seeds)

`tools/list` (from the run reports): 14.1 KB → 15.1 KB.

Same adapter both sides (`track-a/arms/kronicle-lite-lineage.mjs`; the agent loop never declares lineage, `remember` passes its cursor as before, so lineage is inferred by the tool). Before = `f66f096` (0.7.0), after = `lineage@8740063`. Built with `track-a/setup-kl-lineage.sh`.

| scenario | before y/p/n | after y/p/n | per-seed grade changes | secondary flags before → after |
|---|---|---|---|---|
| S1 | 20/0/0 | 20/0/0 | 0 | pushedNew 20→20, staleUnmarked 0→0, nextSessionPass 0→20, nextSessionStaleCopy 20→0 |
| S5 | 20/0/0 | 20/0/0 | 0 | served 0→0, noticed 20→20 |
| S7 | 10/0/10 | 10/0/10 | 0 | alarm 10→10 |
| S8 | 20/0/0 | 20/0/0 | 0 | retrievable 20→20, falseAlarm 0→0 |
| S11 | 20/0/0 | 20/0/0 | 0 | leak 0→0, labeled 0→0, falseRetraction 0→0 |

**Gate: S1 next-session stale copy served unmarked 20/20 → 0/20** (`nextSessionStaleCopy`); `nextSessionPass` 0/20 → 20/20. No other grade moved on any seed.

**Bytes the agent sees (mean per call)**

| cell · view | before | after |
|---|---|---|
| S1 · sessionStart | 1816 B | 1816 B |
| S1 · read0 | 1374 B | 1374 B |
| S1 · touch | 2451 B | 3238 B |
| S1 · read | 1373 B | 1373 B |
| S1 · nextSession | 80 B | 80 B |
| S1 · nextRead | 1373 B | 1373 B |
| S1 · nextRead2 | 3136 B | 4280 B |
| S5 · touch | 3096 B | 3599 B |
| S5 · read | 3889 B | 3889 B |
| S7 · touch | 1440 B | 1608 B |
| S7 · read | 1374 B | 1374 B |
| S8 · touch | 1042 B | 1042 B |
| S8 · read | 1386 B | 1386 B |
| S11 · touch | 1488 B | 1488 B |
| S11 · read | 1373 B | 1373 B |
| S11 · nextSession | 80 B | 80 B |

S1/S5/S7 touch views grow by the `derived` retraction and the `Pending` section (an item already listed under Retractions is one line); S1 `nextRead2` grows by the hit's `stale_derived` entry. Quiet cells (S7 format-only seeds, S8, S11) are byte-identical.
