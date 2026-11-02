# kronicle-lite 0.8.1 candidate vs 0.8.0 — Track A, 20 seeds

Builds (git archive + tsup, `track-a/setup-kl-081.sh`): 0.8.0 = `7e50702` (main), 0.8.1 = branch
`fix-0.8.1` @ `52f48b5` (first run, both arms side by side, `S*.json` here) and @ `8bf1e71` (final head,
`081-final/`). Same adapter as the next-release arm (MCP stdio, FileChanged-hook sync, the agent never
declares lineage). Cells: S1, S5, S7 (+ `note` variant), S8, S11.

| cell | 0.8.0 | 0.8.1 @ 52f48b5 | 0.8.1 @ 8bf1e71 (final) |
|---|---|---|---|
| S1 | 20/0/0/0, nextSessionPass 20 | 20/0/0/0, nextSessionPass 20 | 20/0/0/0, nextSessionPass 20 |
| S5 | 20/0/0/0 | 20/0/0/0 | 20/0/0/0 |
| **S7** (quiet = yes) | **10/20** | **6/20** | **6/20** |
| S7note | 10/20 (derived retractions 10) | 6/20 (derived 14) | 6/20 (derived 14) |
| S8 | 20/0/0/0, falseAlarm 0 | 20/0/0/0, falseAlarm 0 | 20/0/0/0, falseAlarm 0 |
| S11 | 20/0/0/0 | 20/0/0/0 | 20/0/0/0 |

## S7: the measured price of raw-text equivalence

- Quiet on 0.8.0: `whitespace_trim`, `whitespace_double`, `line_ending_norm`, `numbered_list_renumber`,
  `markdown_emphasis` (5 templates × 2 seeds).
- Quiet on 0.8.1: `whitespace_trim`, `whitespace_double`, `line_ending_norm` (3 templates × 2 seeds).
  `numbered_list_renumber` (`1)` → `1.`) and `markdown_emphasis` (`*skip*` → `_skip_`) are now
  retractions, by design: hardening round 2 (R2-01..03) showed the Markdown-tree rule hid real changes
  in the raw text agents copy (glob `*` → `_`, a renumbered port after a paragraph line, a backslash
  hard break). The other five templates (typo, Oxford comma, smart quotes, terminal period,
  hyphenation) were already delivered on 0.7.0–0.8.0.
- S7note derived retractions 10 → 14: the note-derived retraction follows the runbook retraction on
  the two newly delivered templates (2 templates × 2 seeds). Mean touch bytes 1608 → 1812 (S7),
  2217 → 2506 (S7note).
- No other cell moved: S1/S5/S8/S11 grades and flags identical on every seed.
