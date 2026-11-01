# Scenario specs

One YAML per fault. Each spec is the contract both tracks share: a tiny seeded fixture repo, a fault
script, the agent touchpoints at which the signal is looked for, and the expected signal with its
deterministic grading rule. Values in `{braces}` come from `track-a/lib/fixtures.mjs` `makeWorld(seed)`
(mulberry32, ported from IsoKron `apps/isokron-cli/src/eval/rng.ts`), so a seed reproduces byte-identical
fixtures in Track A and Track B. Grading regexes live in `track-a/lib/grade.mjs` (ids in `rule:`).
No grade is ever produced by an LLM.

Track A drives each tool's documented best-practice loop directly (no agent) and grades what the tool
puts in front of the agent. Track B runs a live agent on the same fixture and grades its actions from
stub logs (`track_b:` hints).
