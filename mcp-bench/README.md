# mcp-bench

Paired agentic task benchmark for MCP servers (the **Agentic** tier of the audit SOP, Phase 4).
Each attempt is one headless `claude -p --output-format stream-json` session against a fresh start
state, graded by an **independent state verifier** — never by the agent's own claim.

Reports per arm: verified success rate (95% Wilson), **expected tokens per verified success**
(= total tokens across *all* attempts ÷ verified successes), p50/p95 tokens / turns / time, the
provider token split (input / cache read / cache creation / output), tool calls with request and
result bytes, tool errors, API retries, timeouts; plus paired deltas of each variant against the
baseline arm. Output: `results.json`, `REPORT.md`, `attempts.jsonl`, and a gzipped transcript per attempt.

## Run it

```sh
cd mcp-bench && npm ci
npm test                                           # fake claude only; never calls a model
node bin/mcp-bench.mjs validate tasks/*/*/task.yaml tasks/*/task.yaml
node bin/mcp-bench.mjs run tasks/posthog/insight-update/task.yaml --dry-run          # plan, argv, missing env, worst-case $
node bin/mcp-bench.mjs run tasks/local-notes/task.yaml --model haiku --n 1 --max-total-usd 0.25   # ~$0.002 live smoke test
node bin/mcp-bench.mjs run tasks/posthog/*/task.yaml --arms direct,wire-proxy --n 5 --models haiku,sonnet \
     --max-turns 25 --max-total-usd 10 --out results/posthog-$(date +%F)
node bin/mcp-bench.mjs report results/…/results.json
```

Cost controls: `--max-total-usd` is **required** for a real run and is checked before every attempt
against the per-attempt cap (`--max-budget-usd`, passed to `claude --max-budget-usd`); `--max-turns`
and `--model` override the spec (use a small model for smoke tests); `--dry-run` validates specs and
prints the schedule and exact argv without starting anything. `--claude-bin` (or `MCP_BENCH_CLAUDE`)
picks the CLI.

## Paired trials

For each model and trial index every selected arm runs once, in a seeded random order
(`--seed`), sequentially (the sandbox is shared state). The first arm in `--arms` (or in the spec)
is the baseline. Attempts whose **setup** failed never reached the agent and are excluded (reported
as setup errors); everything else — timeouts, agent errors, verifier errors — stays in the denominator.

## Task spec (YAML or JSON)

| key | meaning |
|---|---|
| `id`, `description`, `tags` | identity |
| `prompt` | the task; `{{run_tag}}`, `{{arm}}`, `{{trial}}` and `{{state.*}}` (what setup wrote) are filled per attempt |
| `model`, `max_turns` (20), `max_budget_usd` (0.5), `timeout_sec` (600), `script_timeout_sec` (120) | limits (CLI overrides win) |
| `mcp_servers` | `{name: {command,args,env} | {type,url,headers}}`. Use `${VAR}` placeholders for secrets — claude expands them from the agent env, so values never land on disk. `${TASK_DIR}` is filled by the harness. Literal keys are rejected. |
| `allowed_tools`, `disallowed_tools`, `builtin_tools` | `--allowedTools`, `--disallowedTools`, `--tools` (`[]` = no built-in tools) |
| `env`, `env_passthrough` | literal agent env; names copied from the harness env (the agent env is otherwise scrubbed to PATH/proxy/auth) |
| `requires_env` | names the harness must have (run refuses, dry-run flags them) |
| `setup`, `verifier`, `cleanup` | shell commands run in the spec's directory with the full harness env plus `BENCH_TASK`, `BENCH_ARM`, `BENCH_TRIAL`, `BENCH_MODEL`, `BENCH_RUN_TAG`, `BENCH_RUN_DIR`, `BENCH_WORKDIR` (agent cwd), `BENCH_STATE` (JSON file setup writes); the verifier also gets `BENCH_ANSWER_FILE` (agent's final text, for read-only tasks graded against ground truth the verifier fetches itself). Cleanup always runs. |
| `arms` | `{name: overrides}`; an arm may override only how the agent reaches the server (`mcp_servers`, tools, env, `extra_args`, `append_system_prompt`, `prompt_prefix`/`prompt_suffix`) |

Verifier contract: the last stdout line that parses as `{"pass": bool, "details": …}` wins;
otherwise exit 0 = pass, 1 = fail; any other exit or a timeout is a `verifier_error` (never a pass).

## Shipped tasks

- `tasks/local-notes/` — a bundled stdio MCP server (no deps), arms `terse` vs `verbose` results. Live smoke test.
- `tasks/posthog/{dashboard-create,insight-update,list-paginate}/` — **templates**, not run in CI.
  Need `POSTHOG_AUDIT_KEY` (sandbox project key only) and `POSTHOG_PROJECT_ID`; optional `POSTHOG_HOST`,
  `MCPBENCH_N_INSIGHTS` (3), `MCPBENCH_N_ITEMS` (25). Setup/verifier/cleanup use the REST API directly
  (`_lib/ph.py`, stdlib). The `wire-proxy` arm is a placeholder until mcp-wire-proxy's CLI is final
  (`MCP_WIRE_PROXY_BIN`, `MCP_WIRE_PROXY_RULES`).
