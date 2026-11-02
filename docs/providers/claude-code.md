# Claude Code adapter

`AGENT_REVIEW_PROVIDER=claude-code` (the default). Implemented in `src/providers/claude-code.ts`;
its settings file is `src/providers/claude-code.settings.json`. It runs `claude -p` once per batch.

Requirements: the `claude` binary on the `PATH` (the reusable workflow and the copy template pin
version 2.1.304), and `ANTHROPIC_API_KEY` in the environment. A dry run
(`AGENT_REVIEW_DRY_RUN=1`) does not require the key and uses whatever login the machine has.
`preflight()` runs before any call is paid for and fails if the binary does not answer
`--version`, the settings file is missing, or `ANTHROPIC_API_KEY` is unset and it is not a dry run.

## How the binary is verified

The reusable workflow does not pipe the official install script into a shell. It runs
`src/install-claude-code.sh`, which downloads the pinned version directly:

1. It reads the expected SHA-256 for the runner's platform (`linux-x64` on `ubuntu-latest`) from
   `https://downloads.claude.ai/claude-code-releases/<version>/manifest.json`
   (`.platforms["<platform>"].checksum`). This is the same manifest the official installer uses.
2. It downloads `.../<version>/<platform>/claude` and computes its SHA-256.
3. If the two differ the step fails and nothing is installed. Otherwise the binary goes into
   `$RUNNER_TEMP/claude-bin`, which is added to `PATH`.

The manifest and the binary are served from the same origin. This check proves the download is
intact and is what the publisher released for that version; it does not protect against a
compromised publisher. To pin the hash independently, set the optional `claude_code_sha256` input
in the caller file. When it is set, the manifest is not used:

```yaml
    with:
      claude_code_version: 2.1.304
      claude_code_sha256: ea0f135784631619a7a409d07322ecec964f9cc4fd377508ed1ba3f141f27912 # linux-x64
```

The hash is for one platform; GitHub's `ubuntu-latest` runners are `linux-x64`. When the version
moves, the hash must move with it: download the binary once, run `sha256sum claude`, and compare
it with the manifest before committing the new value. Known values for 2.1.304:

| Platform | SHA-256 |
| --- | --- |
| `linux-x64` | `ea0f135784631619a7a409d07322ecec964f9cc4fd377508ed1ba3f141f27912` |
| `linux-arm64` | `c487117526509ab6d2ee6013e14f181faf68d6d6afe6bb0d4b2b4a9feca5ecb3` |

The copy template runs the same script from the copied `src/` folder; set `CLAUDE_CODE_SHA256`
on its install step to pin the hash. The script installs only the binary; it does not run
`claude install`, so no launcher or shell integration is set up.

## What the adapter does

| Engine asks for | Adapter passes |
| --- | --- |
| Tools `read`, `glob`, `grep` | `--tools Read,Glob,Grep` and `--allowedTools Read,Glob,Grep` |
| A spend cap | `--max-budget-usd <n>` |
| The head and extra directories | `--add-dir <head>` and `--add-dir <dir>` for each; the process itself starts in an empty scratch directory (see "Start outside the head") |
| An output schema | `--output-format json --json-schema <schema>` |
| The prompt via stdin | The prompt, preceded by the absolute paths of the head and the scratch files, on stdin, never as an argument (a large diff would exceed Linux's 128 KB limit) |
| The model | `--model <AGENT_REVIEW_MODEL>` |
| The reasoning effort | `--effort <AGENT_REVIEW_EFFORT>` (default `high`, always passed; Claude Code's own default changed in 2.1.94; not in v1.3.0, the latest release when this page was written) |

Always added by the adapter, whatever the engine asks: `--restricted`, `--strict-mcp-config`,
`--settings <claude-code.settings.json>` and `--disallowedTools
Bash,Read(//proc/**),Grep(//proc/**),Glob(//proc/**)`. The settings file denies the same set.

## The child environment

The adapter builds the `claude` process environment from an allowlist (`CHILD_ENV_ALLOWLIST` and
`buildChildEnv` in `src/providers/claude-code.ts`), not from a copy of the parent's environment.
Only these variables are passed, and only when they are set:

| Variable | Why |
| --- | --- |
| `PATH` | Finds `claude` and the tools it launches |
| `HOME` | Where Claude Code keeps its state |
| `TMPDIR` | Temporary files |
| `TERM` | Terminal capabilities |
| `LANG` and every `LC_*` | Locale |
| `ANTHROPIC_API_KEY` | The credential the agent exists to use |
| `CLAUDE_CONFIG_DIR` | A non-default Claude Code configuration folder, if the operator set one |
| `CI`, `GITHUB_ACTIONS` | Tell Claude Code it runs unattended |

Nothing else reaches the agent. In particular it never receives `GH_TOKEN` or `GITHUB_TOKEN` (the
engine posts, not the agent), `ANTHROPIC_BASE_URL` or any `*_PROXY` variable (which could send the
API key to another host), `NODE_OPTIONS`, `NODE_EXTRA_CA_CERTS`, `BUN_*` or `LD_PRELOAD`. The same
list is used for the `claude --version` probe. A test feeds a poisoned environment through a stub
binary and checks that none of those names arrive. If a runner needs another variable (for
example a corporate proxy), it has to be added to the list in code, on purpose.

The engine itself runs with `bun --no-env-file`, so a `.env` file in the reviewed head cannot add
variables to the engine process either; see [SECURITY.md](../../SECURITY.md).


The footer label is built from the model name and `claude --version`, for example "Claude Sonnet
5.5 via Claude Code 2.1.304". Credential detection (`leaksSecret`) matches the exact
`ANTHROPIC_API_KEY` and anything shaped like an Anthropic key; the engine throws and posts nothing
when any text matches. An encoded key would pass that check.

## Start outside the head

`run` creates an empty directory under the system temp directory, starts `claude` there, and
deletes it afterwards. The head (`request.cwd`) is passed as `--add-dir`, and `locatePrompt`
(`src/providers/locate.ts`) tells the model where the head is and to read files by absolute path.
The engine turns any absolute path the model reports back into a repository-relative one
(`relativisePaths` in `src/engine.ts`). The review and the answer use the same `run`.

*Why:* Claude Code discovers `CLAUDE.md` (and `.claude/`) from its working directory and parents.
A pull request must not supply instructions next to the base-commit rules the engine puts in the
prompt, and starting elsewhere removes the question instead of relying on one flag. A directory
passed with `--add-dir` does not load `CLAUDE.md` unless `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD`
is set, so that variable is not in `CHILD_ENV_ALLOWLIST` (a test pins this). Codex uses the same
layout (see [Codex](codex.md)).

Caveat: the scratch directory lives under the temp directory, and Claude Code also reads
`CLAUDE.md` from parent directories. A `CLAUDE.md` in the runner's temp directory or above it would
load. Hosted runners have none.

## What each hardening flag is for

- `--restricted`: removes the built-in tools that run commands or code, and `WebFetch`, unless
  `--tools` names them; ignores user, project and local settings, so the reviewed branch's own
  `.claude/` settings and hooks do not load. Managed settings and an explicit `--settings` still
  apply.
- `--strict-mcp-config`: no MCP servers other than those passed explicitly (none are).
- `--tools Read,Glob,Grep`: the only tools that exist.
- `--settings` and `--disallowedTools`: deny `Bash` and reads of `/proc`.
- `--max-budget-usd`: a soft, client-side cap. A call can overshoot it. How the engine adds up
  these caps across batches and retries: [costs.md](../costs.md).

## What is verified and what is not

Verified:

- The head's instruction files are not auto-loaded (Claude Code 2.1.304, darwin-arm64, SHA-256
  `b9ac5374839f14abf3f1f45610637c332b5daee5ce0d1634726cef87aab78e6a`). Command, from the
  repository root, with the pinned binary installed outside the repository:

  ```sh
  CLAUDE_CODE_VERSION=2.1.304 CLAUDE_INSTALL_DIR=/tmp/wachi-cc bash src/install-claude-code.sh
  WACHI_PROVIDER_ISOLATION=1 WACHI_CLAUDE_BIN=/tmp/wachi-cc/claude bun test test/provider-isolation.test.ts
  ```

  `test/provider-isolation.test.ts` runs the real adapter against a local mock Messages API
  (`test/support/mock-anthropic.ts`, a separate process that records every request body) with a
  head holding `CLAUDE.md`, `AGENTS.md`, `.claude/CLAUDE.md` and `src/CLAUDE.md`, each with a
  sentinel string. `ANTHROPIC_BASE_URL` reaches the child only through the harness's wrapper
  script; the adapter's allowlist is unchanged. Result: 7 tests pass. No sentinel appears in any
  request before a tool result, for the review and the answer calls; a sentinel appears only after
  the model's `Read` of that file (data, as intended). Controls in the same file: the binary with
  no hardening and the head as its working directory sends `SENTINEL_CLAUDE` and
  `SENTINEL_DOTCLAUDE` (so the harness can see an auto-load); started in an empty directory with
  the head as `--add-dir` it sends none, even without `--restricted`; with
  `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` it sends them again. `AGENTS.md` never appeared:
  Claude Code does not load it by itself, only a loaded `CLAUDE.md` that imports it could.
  Before this change the same harness also passed on `--restricted` alone (the head as working
  directory), so the scratch directory is defence in depth, not the fix for a reproduced leak; it
  also stops depending on one flag's behaviour in a later version.

- A prompt on stdin is accepted with `-p --restricted --strict-mcp-config --tools Read,Glob,Grep
  --output-format json`: a $0 local check with a fake key reached the API and ended in an
  `api_error` at cost 0.
- The hardened invocation (`--restricted --strict-mcp-config --tools Read,Glob,Grep --settings`)
  has run through the reusable workflow in a live review of a private repository: three batches,
  all files reviewed, $0.19 in total, normal posting.
- A live run of the batched engine (one batch, four files, four turns, about $0.07) reviewed every
  file and posted normally.

Not verified:

- That the binary installed by `src/install-claude-code.sh` runs a full review on a hosted runner.
  The download, hash check and mismatch failure were tested in a shell; the first run of the
  workflow after this change is the real test.
- That the `/proc` deny rules do anything under `--restricted`. `--restricted` confines file
  tools to the working directories, which may already exclude `/proc`, but nothing here proves
  it. The rules stay because they cost nothing.
- Claude Code versions other than 2.1.304 against the harness below (a one-off `--restricted`
  probe on 2.1.314 loaded nothing either, but the harness was not run on it). `--bare` and
  `--safe-mode` were not evaluated and are not applied: the harness showed they are not needed.
- The hardening flags against a hostile branch. Stage 2 of the plan is to test them with hostile
  fixtures; until then none of this is a guarantee against a malicious branch.

This is not a sandbox. The trust assumption in [SECURITY.md](../../SECURITY.md) is what makes the
tool acceptable: everyone who can push to a repository that runs it is trusted.
