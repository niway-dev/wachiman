# Codex adapter

`AGENT_REVIEW_PROVIDER=codex`. Implemented in `src/providers/codex.ts`. It runs `codex exec` once
per batch, so the review can be done by an OpenAI model such as GPT Sol. Default model:
`gpt-6.1-sol`. Decision record: ADR 0004.

> **CLI only. Not available in the reusable workflow.** The reusable workflow installs only Claude
> Code and accepts only `ANTHROPIC_API_KEY`. The `provider` input is passed through to the engine,
> but with no `codex` binary and no `OPENAI_API_KEY` in the job, setting it to `codex` can only
> fail at the engine's preflight check. The only supported way to run this adapter is the command
> line ([cli.md](../cli.md)), from a machine or job you set up yourself.
>
> It also differs from the supported Claude Code adapter in two ways that matter before you use it:
>
> - **Cost:** Codex has **no per-call dollar cap**. The adapter ignores the cap the engine passes
>   and prices each call afterwards from token counts. See [Models and cost](#models-and-cost) and
>   [costs.md](../costs.md).
> - **Isolation:** the model reads through shell commands inside Codex's sandbox, and it can run
>   code from the reviewed branch there. The sandbox has been checked on macOS only. See
>   [What is not covered](#what-is-not-covered) and [SECURITY.md](../../SECURITY.md).

**Status:** the engine side is built and was verified end to end in a dry run (below). Adding it to
the reusable workflow needs a Codex install step, an `OPENAI_API_KEY` secret and the Linux and
API-key checks listed under "What is not covered"; none of that exists yet.

Requirements: the `codex` binary on the `PATH`, and `OPENAI_API_KEY` in the environment. A dry run
(`AGENT_REVIEW_DRY_RUN=1`) does not require the key and uses the machine's own Codex login
(`$CODEX_HOME`, else `~/.codex`). A dry run is not free: it skips posting to GitHub but still calls
Codex, so it spends whatever that login is billed for. `preflight()` fails before any call is paid for if the binary does
not answer `--version`, the key is unset outside a dry run, or the model has no known price.

## Why it is hardened differently from Claude Code

Claude Code can be given only read tools (`Read`, `Glob`, `Grep`). Codex cannot: its model reads by
running shell commands (`cat`, `rg`, `nl`) inside Codex's sandbox. So this adapter relies on the
sandbox and on isolation, and each measure below exists because a test showed the default was not
enough.

| Measure | How | What it stops | Verified |
| --- | --- | --- | --- |
| Read-only sandbox | `--sandbox read-only`, `approval_policy="never"` | Writes; network access from the model's commands | `curl https://example.com` failed with "Could not resolve host" |
| Start outside the head | `--cd` an empty scratch directory; the prompt names the head's absolute path | Project config (`.codex/config.toml`), project skills (`.agents/skills/`) and `AGENTS.md` loading from the reviewed branch | A skill planted in the head was loaded and obeyed when the session started inside the head, and was not loaded from the scratch directory |
| Fresh homes | `HOME` and `CODEX_HOME` point at new scratch directories (not in a dry run) | The runner's or a developer's global `AGENTS.md`, user skills and config | With the real `CODEX_HOME`, the developer's global instructions loaded; `--ignore-user-config` does not stop that |
| No inherited environment in the shell | `shell_environment_policy.inherit="none"` **and** `--disable shell_snapshot --disable unified_exec` | The key or a token reaching `env` in the model's shell | With `inherit="none"` alone, a planted variable still reached the shell; with the two features disabled it did not |
| Allowlisted process environment | `PATH`, `TMPDIR`, `TERM`, `LANG`, `LC_*`, `CI`, `GITHUB_ACTIONS`, the adapter's `HOME`/`CODEX_HOME`, and the key as `CODEX_API_KEY` | `GH_TOKEN`, `OPENAI_BASE_URL`, proxies, `NODE_OPTIONS` | Unit test |
| Features off | `--disable` for apps, browser use (three), computer use, hooks, image generation, in-app browser, multi-agent, plugins, remote plugins, skill dependency install | Network paths, other agents, and code the branch controls | Flags passed; each feature's effect not tested one by one |
| No web search | `web_search="disabled"` | Network | Flag passed |
| No rules or session files | `--ignore-rules`, `--ephemeral`, `--ignore-user-config` | Execpolicy files; transcripts left on the runner | Flags passed |
| Time limit | `AGENT_REVIEW_CALL_TIMEOUT_S` (default 900 s) per call, then `SIGKILL`; reported as `timeout`. There is no turn cap: `codex exec` has no equivalent of `--max-turns`, so `AGENT_REVIEW_MAX_TURNS` is ignored | A call that never ends; Codex has no spend cap | Unit test |
| Key in output | `leaksSecret`: the exact key or any `sk-…` shape anywhere in the answer | Posting the key | Unit test |

### Review instructions

The prompt carries the base commit's `CLAUDE.md`, `AGENTS.md` and focus file (see
[architecture](../architecture.md)). Codex does not auto-load the head's `AGENTS.md`: the session
starts in an empty scratch directory (row "Start outside the head" above), so the only copies the
model meets are the ones it opens on purpose, and the prompt calls those content under review. The
adapter needs no flag for this. The `--cd` check above covered a skill; a planted `AGENTS.md` was
not tested separately. The Claude Code adapter now follows the same design (empty scratch working
directory, the head as a readable directory, the prompt naming its absolute path), through the
shared `locatePrompt` in `src/providers/locate.ts`; Codex was not run for that change.

### What is not covered

- **The key is readable inside the sandbox.** The read-only sandbox lets commands read any file the
  user can, and on Linux that includes `/proc/<pid>/environ` of the Codex process, which holds
  `CODEX_API_KEY`. The network is closed, so the remaining way out is the answer itself:
  `leaksSecret` stops the literal key and key-shaped strings, not an encoded one. The trust
  assumption of the consumer's caller file (only trusted people push) still carries this, as it
  does for the Claude Code adapter.
- **The model can run the branch's code.** Nothing but the prompt stops it from running a test or a
  script in the head. The sandbox keeps that run without network and without writes. The prompt
  tells it to only read.
- **Codex's Linux sandbox on GitHub runners is not verified yet.** All checks above ran on macOS
  (Seatbelt). The workflow follow-up must repeat the network and environment checks on
  `ubuntu-latest` before the provider is offered to consumers.
- **`CODEX_API_KEY` authentication is not verified yet.** Locally the CLI was logged in with a
  ChatGPT account. The first CI run with an API key is the check.

## Models and cost

Codex reports tokens, not dollars, and the engine's budgets are in dollars. The adapter prices
each call from its `turn.completed` usage: uncached input, cached input and output, each at its own
price per million tokens. Reasoning tokens are counted inside output.

**There is no dollar cap on a Codex call.** The engine passes every provider a cap
(`AGENT_REVIEW_BATCH_BUDGET_USD`, or what is left of `AGENT_REVIEW_BUDGET_USD`), and this adapter does
not use it. Two things limit spend: the time limit on each call (15 minutes by default, then `SIGKILL`), and the
engine's running total, which stops new calls once the total budget is used. A single call can cost
more than the per-batch figure. Only completed turns are counted, so a call killed by the time limit
can have spent more than it reports. The footer's cost is an estimate from the table below, not an
invoice. See [costs.md](../costs.md).

| Model | Input | Cached input | Output | Source |
| --- | --- | --- | --- | --- |
| `gpt-6.1-sol` | $2 | $0.10 | $10 | Published list price, October 2026 |
| `gpt-6-sol` | $2 | $0.10 | $10 | Same list price |

Any other model needs `AGENT_REVIEW_PRICE_PER_MTOK="input,cached_input,output"`. These prices are
what the code holds, not a current quote: check them against OpenAI's pricing page before relying
on a budget.

The model ID is pinned, not "the latest Sol": a review that silently changes model breaks the
precision comparisons in `docs/precision.md`. A ChatGPT login does not serve every model to Codex:
with Codex 0.153.4 and a ChatGPT account, `gpt-6.1-sol` and `gpt-6-sol` were refused ("not supported
when using Codex with a ChatGPT account"), and `gpt-5.6-sol` worked. An API key is expected to
serve them; this is part of the CI check above.

`AGENT_REVIEW_EFFORT` (default `high`) sets `model_reasoning_effort`. It is passed through as is:
Codex may refuse `xhigh` or `max` for some models, so choose a value the model accepts.
`AGENT_REVIEW_REASONING_EFFORT` still works as a deprecated alias.

## Verified run

A dry run of the whole engine on a pull request in a consumer repository (6 files, 264 changed
lines). `<owner>/<repo>` and `<pr>` stand for that repository and pull request:

```sh
AGENT_REVIEW_DRY_RUN=1 AGENT_REVIEW_PROVIDER=codex AGENT_REVIEW_MODEL=gpt-5.6-sol \
AGENT_REVIEW_PRICE_PER_MTOK="2,0.1,10" AGENT_REVIEW_OPERATOR=<login> \
GH_TOKEN=$(gh auth token) GITHUB_REPOSITORY=<owner>/<repo> \
bun --no-env-file --config=bunfig.toml src/cli.ts review <pr> --repo-dir <checkout of the head>
```

| Turns | Duration | Cost | Findings |
| --- | --- | --- | --- |
| 7 | 61 s | $0.15 | 1 (`🟠🧪 Fix · tests`), citing the spec line it rests on |

The structured answer matched the schema, the two-axis label rendered, and the footer read
"GPT-5.6 Sol via Codex 0.153.4".
