# kronicle-lite 0.8.1 candidate vs 0.8.0 — Track A, 20 seeds

Builds (git archive + tsup, `track-a/setup-kl-081.sh`): 0.8.0 = `7e50702` (main). 0.8.1 = branch
`fix-0.8.1`, three builds:
- `52f48b5`: first run, side by side with 0.8.0 (`S*.json` in this directory);
- `8bf1e71`: whitespace runs inside a line still collapsed (`081-final/`);
- `9018cdc`: **final rule**, strict whitespace, rebased on main `e256ef4`
  (`081-strict/` for S7, `081-strict-rest/` for S1/S5/S8/S11). Later commits on the branch change tests only.

Same adapter as the next-release arm (MCP stdio, FileChanged-hook sync, the agent never declares lineage).

| cell | 0.8.0 | 0.8.1 @ 52f48b5 / 8bf1e71 | **0.8.1 final (strict whitespace)** |
|---|---|---|---|
| S1 | 20/0/0/0, nextSessionPass 20 | 20/0/0/0, nextSessionPass 20 | 20/0/0/0, nextSessionPass 20 |
| S5 | 20/0/0/0 | 20/0/0/0 | 20/0/0/0 |
| **S7** (quiet = yes) | **10/20** | 6/20 | **4/20** |
| S7note | 10/20 (derived retractions 10) | 6/20 (derived 14) | 4/20 (derived 16) |
| S8 | 20/0/0/0, falseAlarm 0 | 20/0/0/0, falseAlarm 0 | 20/0/0/0, falseAlarm 0 |
| S11 | 20/0/0/0 | 20/0/0/0 | 20/0/0/0 |

## S7: the measured price of raw-text equivalence, which is deliberate

- Quiet on 0.8.0: `whitespace_trim`, `whitespace_double`, `line_ending_norm`, `numbered_list_renumber`,
  `markdown_emphasis` (5 templates × 2 seeds).
- Quiet on final 0.8.1: `whitespace_trim` and `line_ending_norm` only (2 templates × 2 seeds).
- **`whitespace_double` alarms by decision, not by accident.** The coordinator chose the strict rule
  after round 2, on the founding rule that a false format-only is far worse than a false alarm. Only a
  line break counts as reflow; two spaces → one and a tab → a space inside a line are retractions,
  because agents copy commands out of unfenced prose, where a double space or a tab can matter
  (round-2 cases W01 and W06). The intermediate builds (`52f48b5`, `8bf1e71`) still collapsed in-line
  runs and were quiet on `whitespace_double` (6/20).
- `numbered_list_renumber` (`1)` → `1.`) and `markdown_emphasis` (`*skip*` → `_skip_`) are now
  retractions, by design. Hardening round 2 (R2-01..03) showed the Markdown-tree rule hid real changes
  in the raw text agents copy: a glob `*` → `_`, a renumbered port after a paragraph line, a backslash
  hard break. The other five templates (typo, Oxford comma, smart quotes, terminal period, hyphenation)
  were already delivered on 0.7.0–0.8.0.
- S7note derived retractions 10 → 16: in this variant the agent saves a note after its two reads, so the
  note is marked derived from the edited block, and its derived retraction follows each newly delivered
  runbook retraction. Mean touch bytes: S7 1608 → 1911, S7note 2217 → 2645.
- No other cell moved: S1, S5, S8 and S11 grades and flags are identical on every seed.
