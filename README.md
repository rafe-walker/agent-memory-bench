# agent-memory-bench

An open, reproducible benchmark for **memory and coordination tools for coding agents**: what a tool
shows the agent after something goes wrong (a runbook changed, a doc was retired, the store was
tampered with, two sessions grabbed the same path, the context was compacted), and what that costs in
context bytes and latency.

Two tracks share one set of scenario specs (`scenarios/*.yaml`):

| | Track A (this directory: `track-a/`) | Track B (`track-b/`) |
|---|---|---|
| What runs | Each tool's documented best-practice loop, driven directly (MCP over stdio, CLIs, hook scripts with recorded Claude Code payloads) | A live headless agent in the fixture repo while faults are injected |
| Graded on | Exactly what the tool puts in front of the agent | What the agent then does (stub-binary logs, git state) |
| Judge | Fixed string/regex rules (`track-a/lib/grade.mjs`) — never an LLM | Deterministic, from logs — never an LLM |
| Cost | $0, no API keys, ~1 h full / < 2 min CI subset | Budget-capped |

Results: **[`results/track-a/REPORT.md`](results/track-a/REPORT.md)** and **[`results/track-b/REPORT.md`](results/track-b/REPORT.md)** (tables, per-scenario findings,
where each tool wins and loses, ranked development priorities). Raw per-seed records sit next to it.

## Run it

```sh
npm run track-a:setup   # pinned arms into .arms/ (npm, uv, git); needs node>=20, uv, rg, jq, curl
npm run track-a         # full: 13 arms × 14 scenarios, 20 seeds → results/track-a/
node track-a/contention.mjs --reps 3   # S15 → results/track-a/S15.{json,md} (then npm run track-a:report)
npm run track-a:ci      # CI subset (7 arms, 3 seeds, S12 at 300 docs) → results/track-a-ci/
npm run track-a:report  # re-render REPORT.md from results after editing track-a/analysis.mjs
node track-a/run.mjs --arms kronicle-lite,native --scenarios S1,S7 --seeds 5   # any slice
```

## mcp-bench (Unreleased)

[`mcp-bench/`](mcp-bench/README.md) is the agentic task benchmark for MCP servers: headless `claude -p`
stream-json runs, task specs with setup / independent state verifier / cleanup, paired baseline-vs-variant
trials in randomized AB/BA blocks, **expected tokens per verified success** with success rate, p50/p95
tokens/wall time, turns, tool calls and duplicate-side-effect rate (JSON + markdown), resolved model IDs, and a
verifier SDK that reads through an independent surface, never the agent's narrative. Budget-capped (`--max-total-usd`), `--dry-run`, model/turn overrides, and a fake-claude
test double so CI never calls a model. Ships a local smoke task and three PostHog sandbox templates.
`--isolation linux-sandbox` runs each attempt's agent in [agent-sandbox](https://github.com/rafe-walker/agent-sandbox)
(own uid, bwrap, netns cage, model gateway as the token meter) behind a verified signed preflight; `--purpose publish`
refuses `--isolation dev` (#19).

```sh
cd mcp-bench && npm ci && npm test
node bin/mcp-bench.mjs run tasks/local-notes/task.yaml --model haiku --n 1 --max-total-usd 0.25
```

## Scenarios

| id | fault | the tool should… |
|---|---|---|
| S1 | stale runbook: a fact changed after the agent read it | tell the agent its belief X is now Y |
| S2 | two sources disagree (CLAUDE.md vs a newer ADR) | show both and flag the conflict |
| S3 | parallel collision: claim race (a), edit inside another's claimed path (b), out-of-the-box identity (c), concurrent creates (d) | give exactly one holder and tell the others who holds it |
| S4 | compaction: a decision made mid-conversation | bring it back verbatim after compaction (a); also with an over-long MEMORY.md (b) |
| S5 | a retired/deleted doc | stop serving it and say so |
| S6 | the store edited behind the tool | refuse or flag the tampered text |
| S7 | benign edits (10 IsoKron templates: typo, whitespace, quotes…) | **stay quiet** (false-positive control) |
| S8 | a section moved / file renamed | keep the fact's identity without a removal alarm |
| S9 | a wrong fact planted by another actor | flag it as untrusted, or at least show who wrote it |
| S10 | a secret written into memory | refuse/redact before it is stored |
| S11 | two repos sharing one store (default config) | keep them apart (S11c: claims) |
| S12 | 1k–10k docs | find the needle; report latency and bytes |
| S13 | a lease expiring during a long task | keep the claim alive while the agent works, or tell it before it acts |
| S14 | planning cost: author 1 epic + 20 tickets with 39 links | few calls/tokens, exact graph, no duplicates on re-run, nothing left behind by an invalid plan (measured, not graded) |
| S15 | contention: two scripted agents, 4 tickets whose scopes all overlap (Track B T3's pattern), time-compressed (`track-a/contention.mjs`) | finish the backlog with few calls and no idle agent (measured, not graded) |

Every scenario is seeded (mulberry32, ported from IsoKron's eval harness). Randomized cells run 20
seeds and report Wilson and exact Clopper–Pearson 95% intervals; deterministic cells (S13, claim-less
tools) run fewer repetitions and say so.

## Arms

no-memory baseline · native Claude Code conventions (CLAUDE.md / AGENTS.md / auto memory, loader simulated
from the published docs) · kronicle-lite 0.7.0 (npm; full and `--core`) · basic-memory 1.0.0 ·
@modelcontextprotocol/server-memory 2.0.1 · cc-anchor 0.4.0 (git tag `v0.4.0`) · sea-lite 0.5.0 (npm) alone and
with cc-anchor hooks · beads 1.3.2 · mcp_agent_mail 0.3.4 · Backlog.md 1.55.3 · task-master-ai 0.43.1. Not run
(with reasons): claude-mem, mem0/OpenMemory, Claude Code agent teams — see the report. The pre-release run
(kronicle-lite 0.5.0 + 0.6.0, sea-lite 0.4.0, cc-anchor 0.3.0) is archived in `results/prerelease/`, and
**[`results/RELEASE-RERUN.md`](results/RELEASE-RERUN.md)** compares it with the released versions per scenario.

Each adapter (`track-a/arms/*.mjs`, ≤ ~150 lines) uses the tool the way its README says, and lists its
setup steps in `meta.setupSteps`. Corrections from tool authors are welcome: an arm that is used wrongly
is a bug in the benchmark.

## Principles

- **What the tool shows, not what we hope the agent does.** Track A never asks a model anything.
- **Push vs pull is reported, not hidden.** A pull-only tool gets credit for a correct answer on re-lookup
  (🟡), a push of the change with old → new words gets ✅; the `delivery` column says which happened.
- **Null results and losses are published.** Native CLAUDE.md is re-read at session start and is fresh
  there; a solo repo may not need any tool; our own tools' false alarms and leaks are in the tables.
- **Bytes are a first-class cost.** `tools/list` size and per-touchpoint response bytes for every arm.

## Layout

```
scenarios/            shared specs (YAML) — fixture, fault, touchpoints, expected signal, grading rule
track-a/run.mjs       runner + aggregation        track-a/lib/   rng, stats (Wilson/Clopper–Pearson), MCP client, grader, report
track-a/arms/         one adapter per tool        track-a/scenarios/  knowledge, coordination, scale drivers
track-a/analysis.mjs  hand-written findings spliced into REPORT.md
results/track-a/      REPORT.md, summary.json, meta.json, S*.json (per-seed records)
track-b/              live-agent track (separate)
```

License: Apache-2.0.
