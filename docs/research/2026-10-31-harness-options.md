# Harness options for Wachi Reviewer: OpenCode, Pullfrog's MCP, Claude Code Review, `claude -p` knobs

- **Date:** 2026-10-31. **Method:** repo files you listed; official docs and npm registry; Pullfrog source (v0.1.109) and logs
  (`/tmp/bench/46{3..7}`). No paid API calls, no repo edits. Tags: **[official]** vendor docs, **[source]** code/logs, **[derived]** my
  arithmetic, **[secondary]** blogs/news, **[unverified]**.

## In one minute

1. **OpenCode: do not add it now.** It is real, MIT, multi-provider, with a usable permission model. But `opencode run` has no documented
   structured-output flag or dollar cap, subscription billing through it is prohibited by Anthropic [official], and you would lose
   `--restricted`, `--json-schema`, `--max-budget-usd`, `total_cost_usd` and the isolation harness you built. Its one gain is non-Claude,
   non-OpenAI models, which no measurement has asked for.
2. **Subscription billing, if wanted, goes through Claude Code, not OpenCode.** Anthropic allows an end user to sign in to the *unmodified
   Claude Code binary* with their own plan. Your adapter drops `CLAUDE_CODE_OAUTH_TOKEN` today (see Q1).
3. **Pullfrog's MCP is not where its money goes.** From 5 logged runs I estimate **~10–25%** of the $1.14–$2.20 per run is MCP overhead
   [derived, wide error bars]; 75–90% is context re-read over 25–45 turns. Not worth it for Wachi: the engine already does for free
   what those tools do for tokens, and MCP adds an unauthenticated tool server beside GitHub tokens.
4. **Claude Code Review is a different tier.** $15–25 per review [official blog], Anthropic infrastructure, Team/Enterprise, no BYO key,
   no model choice. Complementary for orgs already paying; overlapping only on the idea "Claude reviews my PR".
5. **Knobs today:** `--max-turns` exists and parses in 2.1.316 even though `--help` hides it. `--max-budget-usd` is already your harness
   dollar cap, but it is soft (overshoots by up to one response), so the engine stays the hard stop.

## Q1. OpenCode as a harness

**What it is.** Open-source coding agent, MIT, repo under `anomalyco/opencode` (the `sst/opencode` URL lands there), ~223k stars
[official: https://github.com/sst/opencode]. npm `opencode-ai` latest **1.19.5, published 2026-10-28** [registry]; Pullfrog pins 1.18.29
[source: `package.json`]. 75+ providers through AI SDK and models.dev, plus local models [official: https://opencode.ai/docs/providers/].
A second generation exists: Pullfrog supports V1 (`opencode-ai`) and V2 (`@opencode/cli`). The log line `opencode: V1 (default)` is
**Pullfrog's choice of OpenCode generation for non-Claude models**; for Claude models it picks `agent: claude`, the Claude Code CLI
[source: `agents/opencodeShared.ts:287`, run log]. So Pullfrog did not run OpenCode on your PRs. V2 behaviour: [unverified].

**Non-interactive mode** [official: https://opencode.ai/docs/cli/]. `opencode run [message..]` with `--model provider/model`, `--agent`,
`--format default|json`, `--dir`, `--session/--continue/--fork`, `--variant` (reasoning effort), `--attach <url>` (a running `opencode serve`),
`--auto` ("auto-approve permissions that are not explicitly denied"). `--format json` is "raw JSON events"; the schema is not documented
(a secondary source shows NDJSON `step_start`/`text` events). No token or cost fields are documented for `run`. CI env: `OPENCODE_PERMISSION`,
`OPENCODE_CONFIG_CONTENT` (inline JSON), `OPENCODE_PURE` (no external plugins), `OPENCODE_CONFIG_DIR`.

**Structured output.** No `--schema` flag for `run` found. The **SDK** has `format: {type:"json_schema", schema, retryCount}` (default retry 2),
result in `structured_output`, failure as `StructuredOutputError` [official: https://opencode.ai/docs/sdk, read through a search summary; the page's
table says `outputFormat` and its example says `format`, so check the types]. Pullfrog drives OpenCode through `@opencode-ai/sdk/v2` against a
server, not through `run` [source: `agents/opencode1.ts`]. A LiteLLM doc says its OpenCode harness just asks for one JSON object [secondary].
Cost to you: an adapter is SDK plus a local server process (more moving parts than one `spawnSync`), or prompt-based JSON with your own validation.

**Tool restriction and permissions** [official: https://opencode.ai/docs/permissions/, /agents/]. Actions `allow|ask|deny`, wildcard rules,
**last match wins**. The docs' recipe for your case: `{"permission":{"*":"deny","read":"allow","grep":"allow","glob":"allow"}}`; per-agent
overrides under `agent.<name>.permission`. Defaults are permissive (most tools `allow`; `external_directory`, `doom_loop` `ask`; `.env` reads ask),
and an `ask` has no responder headless. `steps` caps iterations per agent and then **forces a text-only reply** instead of failing. No dollar cap found.
Not settled by docs [unverified]: whether `deny` *removes* the tool from the model's list (Claude Code's bare `--disallowedTools` does) or only rejects
calls; how to allow the head without opening `external_directory` wholesale; whether `AGENTS.md`/`CLAUDE.md` in the head auto-load. Project config and
`.opencode/` plugins load from the cwd up to the git root [official: config page], so you would need the same empty-scratch-cwd trick and a new
isolation test. Pullfrog does not trust `permission` alone: it also installs a `tool.execute.before` gate plugin [source: `opencode1.ts:42-45`].

**Authentication to Anthropic.**
- OpenCode takes an API key (`/connect`, stored in `~/.local/share/opencode/auth.json`, or env). Its provider docs: "There are plugins that allow you
  to use your Claude Pro/Max models with OpenCode. **Anthropic explicitly prohibits this**"; the bundled plugins were removed in 1.3.0 [official].
- Anthropic [official: https://code.claude.com/docs/en/legal-and-compliance]: OAuth is "intended exclusively for purchasers of Claude Free, Pro,
  Max, Ultra, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications";
  developers "including those using the Agent SDK, should use API key authentication"; no routing "through Free, Pro, Max, or Ultra plan credentials on
  behalf of their users". The same page says this does not prevent "an end user from signing in to the unmodified Claude Code binary with their own
  Claude subscription". Press dates the enforcement to Jan–Feb 2026 [secondary: https://www.theregister.com/software/2026/02/20/anthropic-clarifies-ban-on-third-party-tool-access-to-claude/5014546].
  One low-authority blog claims OpenCode regained subscription access "via the Agent SDK" [secondary: cellcog.ai]; I would not rely on it.
- **Subscription billing via OpenCode is therefore not available.** The permitted route is Claude Code: `claude setup-token` gives
  `CLAUDE_CODE_OAUTH_TOKEN`, documented for the official Action [official: https://code.claude.com/docs/en/github-actions]. **Gap in your adapter**
  [source: `claude-code.ts:46-56,163`]: `CHILD_ENV_ALLOWLIST` lacks it, `preflight()` demands `ANTHROPIC_API_KEY`, and `--bare` never reads OAuth
  credentials [official: headless page]. The research note says users may set their own OAuth secret, but the code would drop it. Settle that
  mismatch before promising it. Policy fit is your call; this is not legal advice.

**Cost, pinning, install.** Cost: `opencode stats` exists [official]; Pullfrog reads per-turn `costUsd` and tokens from OpenCode sessions
[source: `opencodeSession.ts:275`], so the SDK exposes them, but who prices them is [unverified]. Pin by exact npm version plus `autoupdate:false`.
No vendor checksum manifest like `downloads.claude.ai/.../manifest.json` found. Platform package `opencode-linux-x64` is **214 MB unpacked**
[registry]. Install time on `ubuntu-latest`: not measured.

| | Claude Code adapter today | OpenCode adapter |
| --- | --- | --- |
| Models | Claude only | 75+ providers, local |
| Subscription billing | Possible via Claude Code OAuth (not wired) | **Prohibited** for Anthropic |
| Speed | Baseline | No evidence either way |
| Read-only tool list | `--tools Read,Glob,Grep` removes all others | deny-all + 3 allows; removal unverified |
| Ignore branch config | `--restricted`, `--strict-mcp-config`, scratch cwd, tested in `test/provider-isolation.test.ts` | `OPENCODE_PURE` + scratch cwd; new harness needed |
| Structured output | `--json-schema` flag | SDK `json_schema` or prompt-based |
| Cost cap and report | `--max-budget-usd`, `total_cost_usd` | none found; `steps` only |
| Binary provenance | vendor SHA-256 manifest, optional pinned hash | npm, 214 MB, no manifest found |

**Recommendation:** skip; reopen if a benchmark shows a non-Claude, non-OpenAI model beating current precision at lower cost. A spike needs five checks:
planted `AGENTS.md`/`.opencode/` do not load from a scratch cwd; denied `bash` is absent from the tool list; `json_schema` validates your `SCHEMA`; cost and tokens
appear in the result; `external_directory` can be limited to the head.

## Q2. Pullfrog's MCP use

**How the agent reaches GitHub** [source: `mcp/server.ts`, `agents/claude.ts:138-155,1245-1320`].
- The Pullfrog action (Node) starts a **FastMCP HTTP server in-process** on `127.0.0.1`: first free port from 3764 plus a random 0–49 offset,
  endpoint `/mcp`. It writes `{"mcpServers":{"pullfrog":{"type":"http","url":…}}}` to a temp file and launches `claude` with `--mcp-config`,
  `--dangerously-skip-permissions`, `--disallowedTools …`, `--agents …`, `--output-format stream-json`.
- **No authentication on the endpoint**: the config has no headers and I found no token check [source; not verified at runtime]. GitHub installation
  and git tokens live in the server's `ToolContext`, not the agent's env. Exceptions on purpose: a role-scoped `gh` token and a read-only shell token.
  The `claude` process inherits all of `process.env` (`claude.ts:1290-1295`), unlike your allowlist.
- ~40 tool names exist in `mcp/*.ts` (`select_mode`, `report_progress`, `checkout_pr`, `git`, `create_pull_request_review`, `resolve_review_thread`, `shell`, issue, label, push and PR tools…).

**What a review actually calls** (log `»` lines; all `anthropic/claude-opus-5-5` on the Claude Code harness):

| Run | Cost | Turns | MCP calls | Native calls |
| --- | --- | --- | --- | --- |
| #463 | $2.20 | 39 | select_mode, checkout_pr, git, create_pull_request_review (1 each) + **shell 16** | Read 12, TodoWrite 3, Write 2 |
| #464 / #465 / #466 | $1.23 / $1.15 / $1.14 | 30 / 30 / 25 | the same four | Read 9–13, Grep 6–7, TodoWrite 0–4, Write/Edit 1 each |
| #467 | $1.96 | 45 | the same four + a second review post | Read 14, Grep 18, TodoWrite 4, Write, Edit |

Flow: `select_mode("Review")` returns the playbook; `checkout_pr` fetches the PR and writes a diff file and an impact file; the agent reads
the diff with native `Read`; one `git`; one `create_pull_request_review`. `report_progress` was **never called**: the harness renders the progress
comment from `TodoWrite` itself (prompt: "don't call report_progress for intermediate status"). So progress-comment updates cost no extra tokens;
only the 3–4 `TodoWrite` calls do, mostly batched with other calls. The 16 `shell` calls in #463 are the MCP shell replacing the disabled `Bash`.

**Token cost of the MCP layer.**
- Pullfrog sets `ENABLE_TOOL_SEARCH=false` on purpose ("unset, first-party routes defer every MCP tool behind ToolSearch, a turn spent before the
  first Pullfrog call") [source: `claude.ts:1315-1317`]. So **every tool schema is in every request**, cached after the first.
- Schema size: description strings in `mcp/*.ts` total ~6.4k chars (~1.6k tokens), but that misses parameter schemas. I assume **6k–12k tokens**
  for the ~30 tools registered in a review [derived guess, not measured]. The playbook prompt in the log is ~20 KB (~5k tokens) [derived].
- Price fit [derived]: the five cost tables match $0.30 / $3.75 / $15 per M tokens (cache read / write / output) within ~5% (#465: $1.150 computed,
  $1.1485 logged). The model is Opus-class, so these rates are inferred; the shares below are ratios, so they survive that.
- #465 [derived]: cache read 1.93M tokens ≈ **50%**, cache write 110k ≈ **36%**, output 10.8k ≈ **14%**. Average cached context is ~64k
  tokens per turn (#463: ~108k), so each extra turn costs ~$0.02–0.03 just to re-read it.

| Component (run #465, $1.15) | Estimate | Share |
| --- | --- | --- |
| Tool schemas, 6k–12k tokens × (1 write + 29 reads) | $0.07–0.15 | 6–13% |
| Playbook prompt, ~5k tokens, same arithmetic (part is MCP instructions) | ~$0.06 | ~5% |
| Round trips: 4 MCP calls, at most 3 extra turns | ≤ $0.06 | ≤ 5% |
| **MCP total** | **$0.12–0.28** | **~10–25%** |
| Reading code, reasoning, growing context | the rest | **~75–90%** |

#463 ($2.20) has a lower schema share (4–8%, bigger context) but 16 shell round trips add turns; not broken out. Not measured: tool-result sizes
(`checkout_pr`, impact file) and Pullfrog's Stop-hook retries. Treat the table as an order of magnitude.

**Is MCP worth it for a reviewer whose engine posts?**

*For:* on-demand context (linked issue, commit info, check-suite logs, prior review comments) without guessing at prefetch; a typed `create_review`
tool validates shape at call time (Pullfrog adds a coverage pre-flight and 422 retries on it); thread reply/resolve inside one session.

*Against, and stronger:*
- Each of those is deterministic engine code for you already: batches, `batchGaps` coverage, retry with attempt ids, posting, threads (ADR 0008).
  An MCP version moves control to the model and bills tokens for it.
- Security: GitHub tokens in a process beside a prompt-injectable agent, over an unauthenticated loopback port. Pullfrog compensates with
  `--dangerously-skip-permissions`, managed-settings denies, a PreToolUse gate and role mirroring [source]. Your "no interactive tools" stance
  and ADR 0001 decision 7 need none of that.
- Spend control: tool calls are the unbounded part; your per-batch caps work because the tool list is three reads.
- Cost: ~10–25% on a $1–2 run. On your ~$0.06 batches a fixed 6k–12k-token schema block would be a *larger* share [derived].

*Middle path, zero cost:* if a measured precision gap traces to missing context, have the engine write it to the scratch dir beside
`pr.json`/`threads.json` (linked issue text, the impact `git grep` from backlog #43, check-run summary). No schema tokens, no new credentials.
Reopen MCP only if the context must be chosen by the model at run time from a large space.

## Q3. Claude Code's own Code Review

Facts [official: https://code.claude.com/docs/en/code-review, /code-review-costs, /code-review-customize] unless marked.
- **Launch:** 2026-03-09, research preview in beta, Team and Enterprise [official: https://claude.com/blog/code-review].
- **How it works:** several agents read the diff and surrounding code in parallel; a **verification step** filters false positives; results are
  deduplicated and ranked (🔴 Important, 🟡 Nit, …). Reads only, "without building or running your code". Runs on **Anthropic infrastructure**;
  "Reviews don't run in self-hosted environments".
- **Price:** no flat price; token-based **usage credits**, billed to the organization, separate from plan usage; org monthly cap, reviews are skipped
  when it runs out. "Generally average $15–25" and about 20 minutes come from the official **blog**; the docs give no number. Three levels (Quick,
  Standard, Deep) set depth and cost.
- **Configurable:** by text only. `REVIEW.md` (root and subdirectories) and `CLAUDE.md`: recalibrate severity, cap nits, skip paths, add checks,
  include up to 8 files. Read from the base/default branch, never from the PR; some rules need a protected branch. **No model choice**; format fixed.
- **BYO key / own Actions:** **no.** Not available with Zero Data Retention, HIPAA configuration or CMEK; GitHub only (incl. GHES).
- **Posts:** inline comments, a summary in the review body, a check run "Claude Code Review" that never fails. Never approves or blocks; resolves
  its own old threads; answers `@claude review` / `@claude review always` from people with write access.
- **The overlapping option you can self-host:** `anthropics/claude-code-action` with the `code-review` plugin on your own `ANTHROPIC_API_KEY`, in your
  runner, `claude_args: --max-turns N`, `--comment` to post inline [official: https://code.claude.com/docs/en/github-actions]. The docs' comparison
  table lists it beside Code Review and local `/code-review`.

**Competitor or complementary?** Both, at different price points.
- *Complementary:* an org on Team/Enterprise can run Anthropic's deep review on critical repos and Wachi everywhere else. Wachi's live three-batch
  review cost $0.19 (`docs/providers/claude-code.md`) versus $15–25. Wachi adds what Anthropic's cannot: BYO key, data kept in the consumer's
  GitHub, a second provider (Codex), precision from `Verdict:` replies, per-PR budgets.
- *Competing:* for a Team/Enterprise customer who just wants "Claude reviews PRs", the managed product needs no workflow and has a verification
  step. That is a data point for your deferred decision on a model verification pass (`2026-10-30-pullfrog-and-coderabbit.md`): Anthropic made
  verification a core stage. It does not prove it pays at your price point; only your precision numbers can.

## Q4. `claude -p` knobs

Checked against the CLI reference [official: https://code.claude.com/docs/en/cli-reference] and the local binary **2.1.316** (`claude --help` and
option-parse probes, $0). Your pin is 2.1.304; I did not install it to compare.

| Flag | Exists? | What it does | Your adapter |
| --- | --- | --- | --- |
| `--max-turns N` | Yes. **Hidden in local `--help`** but registered (`--max-turns abc` errors "must be a number") | "Print mode only. Exits with an error when the limit is reached. No limit by default." Subtype `error_max_turns`, no `result` text [official: agent-loop] | **Not used** |
| `--max-budget-usd` | Yes | Stops at estimated spend (print mode). Client-side estimate; "Spend can pass the cap" by up to one response; cap enforcement needs ≥ 2.1.217. Subtype `error_max_budget_usd` | Used |
| `--output-format json` | Yes | `total_cost_usd`, `modelUsage`, `num_turns`, `session_id`, `structured_output`; costs are "client-side estimates" | Used |
| `--json-schema` | Yes | Validated `structured_output`; absent if none valid; subtype `error_max_structured_output_retries` exists | Used |
| `--tools`, `--allowedTools`, `--disallowedTools` | Yes | `--tools` restricts built-ins (no effect on MCP; default set omits Glob/Grep on macOS/Linux/WSL, so naming them is right); `--allowedTools` only auto-approves; a bare `--disallowedTools` name removes the tool from context | Used (`--allowedTools` is redundant) |
| `--add-dir`, `--settings` | Yes | File access without most `.claude/` discovery; settings file or inline JSON ≤ 2 MiB | Used |
| `--restricted` | Yes, ≥ 2.1.248 | Drops command/code tools and WebFetch unless named; confines file tools to working dirs; only managed settings and `--settings` load | Used |
| `--bare` | Yes | Skips hooks, skills, plugins, MCP, memory, CLAUDE.md; never reads OAuth or keychain; docs say it "will become the default for `-p`" | Not used (your docs: not needed) |
| `--strict-mcp-config` | Yes | Only MCP servers from `--mcp-config` | Used |
| `--no-session-persistence` | Yes (print mode) | No transcript saved to disk | **Not used**; Codex adapter does the equivalent (`--ephemeral`) |
| `--safe-mode`, `--fallback-model` | Yes | All customizations off with normal auth/tools; switch model when the primary is overloaded | Not used; a silent fallback would make runs non-comparable (ADR 0004 logic) |

**A turn cap per batch.** Add `--max-turns <n>` in `buildClaudeArgs`, fed by an engine/env input (not the PR, per ADR 0001 decision 6), for example
`WACHIMAN_BATCH_MAX_TURNS`. Counting rule: each tool-call turn plus one final text-only turn, so a cap that is too small yields `error_max_turns` with
**no** `structured_output`. Reference points: your live batch took 4 turns for 4 files; Pullfrog runs 25–45. Start with headroom such as files × 2 + 4 [my
suggestion, untested]. Two code gaps [source: `claude-code.ts:215-219`]: `terminalReason` maps only `/budget/` to `"budget"` and every other non-success to
`"error"`, so `error_max_turns` would look like a generic failure and could be retried or miscounted; add a `"turns"` reason or map it to `"budget"`.
And confirm your `JSON.parse(run.stdout)` path survives the non-zero exit the flag causes [unverified].

**A dollar cap enforced by the harness.** It already is, through `--max-budget-usd`, but "enforced" means *soft*: the check runs after each response
arrives, so a call can overshoot by up to one response [official: agent-loop, "Budget headroom"], and the figure is an estimate that can differ from the bill.
No CLI flag gives a hard stop. For a firmer ceiling: (1) keep `--max-budget-usd` and keep the engine's remaining-budget arithmetic (it already allows a small
total overshoot, `architecture.md` §7); (2) add `--max-turns` as an independent, exact bound; (3) add a wall-clock kill via `spawnSync`'s `timeout`, as the
Codex adapter does (15 min), because neither flag bounds a hung network call. Your regex catches `error_max_budget_usd` already (it contains "budget").
## Not verified

Speed difference between harnesses; OpenCode install time, V2, and whether `deny` removes a tool; Pullfrog's MCP endpoint without auth at runtime; MCP schema
token counts and the price table behind the cost fit (estimates); any flag on your pinned 2.1.304 (I used current docs and local 2.1.316); the legal reading of
"ordinary use" for CI under a subscription token (quoted, not interpreted).
## Sources

Official: code.claude.com/docs/en/{cli-reference,headless,agent-sdk/agent-loop,legal-and-compliance,code-review,code-review-costs,code-review-customize,github-actions};
https://claude.com/blog/code-review; opencode.ai/docs/{cli,permissions,agents,config,providers,sdk}; https://github.com/sst/opencode; npm `opencode-ai`.
Secondary: theregister.com (link above); cellcog.ai/blog/opencode-claude-subscription. Local: Pullfrog source, bench logs, repo docs/ADRs/adapter.
