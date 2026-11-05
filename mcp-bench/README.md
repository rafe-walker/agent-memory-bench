# mcp-bench

Paired agentic task benchmark for MCP servers (the **Agentic** tier of the audit SOP, Phase 4).
Each attempt is one headless `claude -p --output-format stream-json` session against a fresh start
state, graded by an **independent state verifier** — never by the agent's own claim.

Headline per arm: **expected tokens per verified success** (= total tokens across *all* attempts,
failures included ÷ verified successes), always next to the verified success rate (95% Wilson),
p50/p95 tokens per trial with n, wall time p50/p95, turns, tool calls, and the
**duplicate-side-effect** and unexpected-mutation rates the verifier reports. Also: the provider token
split (input / cache read / cache creation / output), tool request/result bytes, tool errors, API
retries, timeouts, the **resolved model IDs** (from the CLI's init event, whatever alias was asked
for), and paired deltas of each variant against the baseline arm. Token fields are provider-reported
only; estimates (tool result bytes ÷ 4) live in separate `estimated` fields and are marked "est.". Output: `results.json`, `REPORT.md`, `attempts.jsonl`, and a gzipped transcript per attempt.

## Run it

```sh
cd mcp-bench && npm ci
npm test                                           # fake claude only; never calls a model
node bin/mcp-bench.mjs validate tasks/*/*/task.yaml tasks/*/task.yaml
node bin/mcp-bench.mjs run tasks/posthog/insight-update/task.yaml --dry-run          # plan, argv, missing env, worst-case $
node bin/mcp-bench.mjs run tasks/local-notes/task.yaml --model haiku --n 2 --max-total-usd 0.25   # ~$0.004 live smoke test
node bin/mcp-bench.mjs run tasks/posthog/*/task.yaml --purpose before-after --arms direct,wire-proxy \
     --model <frozen model id> --max-turns 25 --max-total-usd 15 --out results/posthog-$(date +%F)
node bin/mcp-bench.mjs report results/…/results.json
node bin/mcp-bench.mjs cleanup results/…                    # replay cleanups a SIGKILLed run never ran
```

Cost controls: `--max-total-usd` is **required** for a real run and is checked before every attempt
against the per-attempt cap (`--max-budget-usd`, passed to `claude --max-budget-usd`); `--max-turns`
and `--model` override the spec (use a small model for smoke tests); `--dry-run` validates specs and
prints the schedule and exact argv without starting anything. `--claude-bin` (or `MCP_BENCH_CLAUDE`)
picks the CLI.

## Paired trials

Trials run in **randomized AB/BA blocks** (`--seed`): for k arms a block is k trials whose arm orders
are the k rotations of a random permutation (a Latin square), in random order, so every arm runs in
every position equally often. n not divisible by k is flagged as unbalanced. Every attempt gets its
own setup and cleanup (start state reset per trial) and runs sequentially (the sandbox is shared).
The first arm in `--arms` (or in the spec) is the baseline.

`--purpose` sets the trial count: `smoke` 5, `before-after` 10, `publish` 20 (20–30 only for a
published number; `publish` refuses n < 20 and small models). Pass a frozen model ID, not an alias,
for anything published; dry-run warns on aliases and the report flags a model change mid-run. Attempts whose **setup** failed never reached the agent and are excluded (reported
as setup errors); everything else — timeouts, agent errors, verifier errors — stays in the denominator.
An attempt with no `result` event (crash, timeout, kill, output cap) only has per-message usage, whose
`output_tokens` is ~0; the report counts these per arm ("no result event") and marks expected tokens
per verified success with ≥ when they are included, since that figure is then a lower bound.

## Task spec (YAML or JSON)

| key | meaning |
|---|---|
| `id`, `description`, `tags` | identity |
| `prompt` | the task; `{{run_tag}}`, `{{arm}}`, `{{trial}}` and `{{state.*}}` (what setup wrote) are filled per attempt |
| `model`, `max_turns` (20), `max_budget_usd` (0.5), `timeout_sec` (600), `script_timeout_sec` (120) | limits (CLI overrides win) |
| `mcp_servers` | `{name: {command,args,env} | {type,url,headers}}`. Use `${VAR}` placeholders for secrets — claude expands them from the agent env, so values never land on disk. `${TASK_DIR}` is filled by the harness. Literal keys are rejected. |
| `allowed_tools`, `disallowed_tools`, `builtin_tools` | `--allowedTools`, `--disallowedTools`, `--tools` (`[]` = no built-in tools) |
| `env`, `env_passthrough` | literal agent env; names copied from the harness env (the agent env is otherwise scrubbed to PATH/proxy/auth) |
| `secret_env`, `plain_env` | redaction of captured streams before anything is written. Default is redact: model credentials and every `env_passthrough` or `${VAR}`-referenced value are scrubbed unless `plain_env` lists the name (use it for paths you want readable in transcripts). `secret_env` is always redacted, and so is any name that looks like a credential (`KEY`, `TOKEN`, `SECRET`, `PASSW`, `CREDENTIAL`, `AUTH`, `COOKIE`), even if `plain_env` lists it. `env`/`env_passthrough` may not set the model (`ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_*_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL`). |
| `requires_env` | names the harness must have (run refuses, dry-run flags them) |
| `setup`, `verifier`, `cleanup` | shell commands run in the spec's directory with the full harness env plus `BENCH_TASK`, `BENCH_ARM`, `BENCH_TRIAL`, `BENCH_MODEL`, `BENCH_RUN_TAG`, `BENCH_RUN_DIR`, `BENCH_WORKDIR` (agent cwd), `BENCH_STATE` (JSON file setup writes). The agent's transcript and final text are not on disk while the verifier runs. Cleanup always runs; if the runner is SIGKILLed first, the attempt's `runs/<id>/CLEANUP_PENDING.json` journal stays behind and `mcp-bench cleanup <out>` (or the next `run` into the same `--out`) replays it with the original `BENCH_RUN_TAG`. Run tags end in a per-invocation nonce, so a rerun with the same `--seed` never reuses a killed run's tags. |
| `arms` | `{name: overrides}`; an arm may override only how the agent reaches the server (`mcp_servers`, tools, env, `extra_args`, `append_system_prompt`, `prompt_prefix`/`prompt_suffix`) |

Verifier contract: the last stdout line that parses as `{"pass": bool, "details": …}` wins;
otherwise exit 0 = pass, 1 = fail; any other exit or a timeout is a `verifier_error` (never a pass).
`details.duplicates` / `details.unexpected_mutations` (integers) feed the side-effect rates.

## Verifier SDK

`verifier/mcpbench_verify.py` (stdlib only): `Verifier()` with `assert_exists`, `assert_absent`,
`assert_equals`, `assert_count`, `assert_no_duplicates` (counts extra copies),
`assert_no_unexpected_mutations(before, after, allowed_ids, ignore_fields)`, and a bounded
`assert_eventually(probe, timeout_s, interval_s)`; `finish()` prints the verdict line. Rules:
read through an **independent surface** (the REST API, a database, the file system — never the MCP
tool under test) and **never read the agent's narrative**; a read-only task is graded through a
required write-back (see `posthog/list-paginate`).

## Shipped tasks

- `tasks/local-notes/` — a bundled stdio MCP server (no deps), arms `terse` vs `verbose` results; verifier reads the files on disk. Live smoke test.
- `tasks/posthog/{dashboard-create,insight-update,list-paginate}/` — **templates**, not run in CI.
  `list-paginate` marks every tagged annotation across pages (missing marks = pagination stopped early).
  Need `POSTHOG_AUDIT_KEY` (sandbox project key only) and `POSTHOG_PROJECT_ID`; optional `POSTHOG_HOST`,
  `MCPBENCH_N_INSIGHTS` (3), `MCPBENCH_N_ITEMS` (25). Setup/verifier/cleanup use the REST API directly
  (`_lib/ph.py`, stdlib). The `wire-proxy` arm is a placeholder until mcp-wire-proxy's CLI is final
  (`MCP_WIRE_PROXY_BIN`, `MCP_WIRE_PROXY_RULES`).
