# What Wachiman does on your machine

This page lists everything Wachiman installs, runs, reads, writes and sends over the network, so
you can check it against the code. If the code does something that is not on this list, treat that
as a bug and report it privately ([SECURITY.md](../SECURITY.md#reporting-a-vulnerability)).

Last checked against the code: 2026-11-23, version 1.19.0. Every statement names the file or
function that shows it. A statement marked **not verified** is one the code alone cannot prove;
[What is not verified](#what-is-not-verified) collects them.

Paths are relative to the repository root. `src/`, `bin/`, `skills/`, `templates/` and `bunfig.toml`
ship in the npm package; `scripts/`, `docs/`, `test/` and `.github/` do not (`files` in
`package.json`).

## What installing adds

`npm i -g wachiman` (or `bun add -g wachiman`) puts the `wachiman` package in your global package
folder. Its `package.json` declares three runtime dependencies and no `postinstall` of its own:

| Dependency | Version | What it is for |
| --- | --- | --- |
| `bun` | 1.3.4 | The runtime that runs Wachiman's TypeScript (`bin/launcher-args.js` starts it) |
| `chalk` | 5.6.2 | Terminal colors |
| `@clack/prompts` | 1.9.0 | Terminal prompts |

**The `bun` dependency runs an install script.** The npm package `bun` has a `postinstall`
(`node install.js`). It is not code from this repository. In the copy of 1.3.4 I read, it first looks
for the platform package `@oven/bun-<platform>` that npm installs as an optional dependency. If that
is missing, it runs `npm install @oven/bun-<platform>@1.3.4` in a temporary folder, and if that fails
it downloads the same package's tarball from `registry.npmjs.org`. Treat it as install-time tooling
that contacts the npm registry. With `--ignore-scripts`, npm skips it and Wachiman uses a Bun that
is already on your `PATH` (`bin/launcher-args.js`, function `findBun`). Wachiman never runs
the Bun install commands it prints when Bun is missing (`bin/launcher-args.js`); it only shows them.

**Files Wachiman writes outside the repository you are in.** Nothing else is written outside a
repository, apart from temporary folders (below):

| Path | Written by | What it holds |
| --- | --- | --- |
| `~/.wachiman/` (or `$WACHIMAN_HOME`) `config.json` | `wachiman setup`, `wachiman profile`, `wachiman project` (`src/accounts/config.ts`, `src/accounts/commands.ts`, `src/setup/run.ts`) | Which Claude profile each project uses; profile names and directories |
| `~/.wachiman/claude-<name>/` | `wachiman profile create` (`src/profiles.ts`) | A Claude Code configuration folder that `claude` fills when you sign in. Wachiman does not write your sign-in into it |
| `~/.wachiman/history/<repo>/` | `wachiman local --history` (or `WACHIMAN_HISTORY=1`) and always `wachiman loop`, `wachiman history --verdict` (`src/history/store.ts`, `src/loop/state.ts`) | Past review results, including finding text, your verdicts, loop state |
| `~/.wachiman/index.sqlite`, `~/.wachiman/dashboard.html` | `wachiman status`, `wachiman dashboard` (`src/store/index.ts`, `src/store/command.ts`) | A rebuildable index of the history, and the static dashboard page |
| `~/.wachiman/ledger/credentials.json` (mode 0600) | `wachiman ledger connect` (`src/ledger-read/credentials.ts`) | The ledger URL and a **read token, in plain text** |
| `~/.wachiman/ledger/<account>/<day>.json`, `pull.json` | `wachiman ledger pull`, `--refresh` (`src/ledger-read/files.ts`) | Spend entries downloaded from the ledger. No token |
| `~/.wachiman/memory/…`, `~/.wachiman/memory-candidates/…`, `~/.wachiman/memory-choice/…` | `wachiman memory` (`src/memory/personal.ts`, `src/memory/candidates.ts`) | Your personal review memory and unproposed memory entries, keyed by your `origin` URL |
| `~/.agents/skills/` and each `~/.claude*/skills/` | `wachiman skills install` (`src/skills/install.ts`) | Copies of the `wachiman-review`, `wachiman-loop` and `wachiman-audit` skills, marked as Wachiman's. It lists `~/.claude-*` folder names to find them |
| A path you pass with `--output` or `--out` | `wachiman local`, `ask`, `dashboard` | The report you asked for |

Inside the repository, `wachiman init` writes the caller workflow, `.wachiman.yml`, an agent-pointer
block in `AGENTS.md` or `CLAUDE.md`, and optionally the PR template (`src/init/`);
`wachiman upgrade` rewrites release pins in files of the repository (`src/upgrade/command.ts`);
`wachiman memory` edits `.wachiman/memory/` (`src/memory/`). None of them commits or pushes, except
`memory propose` (see the table below).

Temporary folders: a review writes the diff and run material to folders made with `mkdtemp` under
your system temp folder and removes them afterwards (`src/engine.ts`, `src/local-ask.ts`,
`src/connectors/`). In GitHub Actions, `src/cost.ts` appends to `$GITHUB_STEP_SUMMARY`.

## Who it talks to

Wachiman's own code makes two kinds of network request: `curl` calls to the spend ledger
(`src/ledger.ts`) and `fetch` calls to the ledger for `ledger pull` (`src/ledger-read/pull.ts`).
Everything else goes through a program it starts: `claude`, `codex`, `gh`, `git`, `npm` or `bash`
running `curl`. This is the complete list I found. How it was found, and how to repeat it, is in
[How to check it yourself](#how-to-check-it-yourself); `test/egress.test.ts` fails when a source
file has a network call site that this table does not cite.

`wachiman local` and `wachiman ask` on your laptop use only the first two rows below, plus the
`claude` version and sign-in checks. They never call GitHub, `gh` or the ledger.

| Destination | When | What is sent | Where in the code |
| --- | --- | --- | --- |
| The model provider, through the `claude` CLI (Anthropic by default) | `wachiman local`, `wachiman loop`, `wachiman ask`; every review, thread-reply and question job in GitHub Actions | The prompt: the diff, the repository's instruction files, and the files the agent reads with read-only tools. In Actions also the pull request title and body, and your API key or subscription token, which Wachiman passes to `claude` only. `claude` sends it, not Wachiman | `src/providers/spawn.ts`, `src/providers/claude-code.ts`, `src/providers/index.ts` |
| `claude` run for checks, not reviews | `wachiman doctor`, `setup`, `profile create`, `profile login`, `profile add` | `claude --version` and `claude auth status`; `claude auth login` only when you run a sign-in command. What `claude` itself contacts is **not verified** | `src/accounts/confirm.ts`, `src/accounts/commands.ts`, `src/doctor/checks.ts`, `src/doctor/run.ts`, `src/setup/run.ts`, `src/profiles.ts` |
| OpenAI, through the `codex` CLI | Only with `--provider codex` on the command line. The reusable workflow does not use it | The prompt; `OPENAI_API_KEY` is passed to `codex` as `CODEX_API_KEY` | `src/providers/codex.ts` |
| GitHub, through the `gh` CLI | Actions jobs (the job's own token); `wachiman pr-state` and `--wait`; `wachiman pr-template check --pr` and `risk`; `wachiman init` (one optional `gh api user`); `wachiman reset-confidence`; the accuracy script `src/precision.ts` and the developer script `scripts/questions-firing.ts` | Reads of pull request data (diff, metadata, threads, reviews, check runs). In Actions, posts the review, comments and thread replies | `src/engine.ts` (`defaultGh`, `runGh`), `src/pr-state-wait.ts`, `src/pr-template/gh.ts`, `src/init/github-login.ts`, `src/precision.ts`, `scripts/questions-firing.ts` |
| Your git remote `origin`, through `git` and `gh` | Only `wachiman memory propose` (without `--personal`) | `git ls-remote` and `git fetch` to learn whether the team has memory; `git push origin HEAD:refs/heads/wachiman/memory` with one commit holding the memory entry, and a draft pull request. Your own git credentials | `src/memory/propose.ts` |
| The spend ledger at your `ledger_url` | Only in GitHub Actions, only when the workflow input `ledger_url` is set, only through `wachiman-platform.yml` with `id-token: write`. On a laptop the engine skips it and says so | `POST /v1/reserve`, `/v1/settle`, `/v1/record`: amounts, trigger, PR number, per-call token and cost rows, and the job's OIDC token as bearer. Details in the next section | `src/ledger.ts` (`defaultCurl`, `reserve`, `settle`, `record`), `src/engine.ts` (`spendReserve`, `spendSettle`), `src/config.ts` |
| GitHub's OIDC token service (`ACTIONS_ID_TOKEN_REQUEST_URL`) | Same conditions as the row above, before each ledger call | The job's request token, with the ledger URL as the audience | `src/ledger.ts` (`requestIdToken`) |
| The ledger you connected, for reading | `wachiman ledger pull`, and `wachiman dashboard --refresh` or `wachiman status --refresh` | `GET /v1/entries?from=…&to=…` with your read token. Redirects are refused, so the token is not sent elsewhere | `src/ledger-read/pull.ts`, `src/ledger-read/credentials.ts`, `src/cli.ts` (`refreshLedger`) |
| The npm registry, through `npm` or `bun` | `wachiman upgrade` and `wachiman upgrade --check` run `npm view wachiman version`; `upgrade` (not `--check`) then runs `npm install -g wachiman@<version>` or `bun add -g wachiman@<version>` | The package name and version | `src/upgrade/command.ts` |
| `downloads.claude.ai` | Only in the Actions workflow, to install the pinned Claude Code binary, which is checked against a SHA-256 before it is installed | The version and platform in the URL | `src/install-claude-code.sh` (run by `.github/workflows/review.yml`) |
| `registry.npmjs.org` and the npm registry | At `npm i -g wachiman`, by the `bun` package's install script | Package names and versions | Not in this repository: `bun@1.3.4`'s `install.js`. See above |
| GitHub, for `actions/checkout`, and the host `oven-sh/setup-bun` downloads Bun from | Only in the Actions workflow | Not verified: both are third-party actions pinned by commit SHA | `.github/workflows/review.yml` |
| The npm registry, through `npm` | Developer scripts only: `scripts/dev-build.sh`, `scripts/verify-package.sh` (not in the npm package) | Package names | `scripts/dev-build.sh`, `scripts/verify-package.sh` |

Other places a program is started, with no network use that I found: `git` for local reads of your
repository (`src/connectors/`, `src/evidence.ts`, `src/workspace/`), `tar` to unpack `git archive`
(`src/connectors/local-git.ts`), and Bun itself (`bin/launcher-args.js`).

Web addresses in the code that Wachiman prints or writes but never requests: `github.com` links in
review comments and help text, `bun.sh` in an install hint (`bin/launcher-args.js`),
`code.claude.com` in `wachiman doctor` (`src/doctor/render.ts`), `claude.dev` in a comment of the
file `wachiman init` writes (`src/init/settings.ts`), `ledger.example.com` in a help example, and
`localhost` and `127.0.0.1`, which the ledger URL check accepts for tests (`src/config.ts`).

## The spend ledger

**Why it exists.** A team can set a daily or weekly spend budget across its reviews, and see a chart
of what reviews cost. The ledger is the service that keeps that count, so Wachiman asks it for room
before a review and tells it the spend afterwards. That is rate limiting of spend, and nothing else.

**It is off unless you turn it on.** Without `ledger_url`, no ledger call of any kind is made and no
OIDC token is requested (`spendReserve` in `src/engine.ts` returns before any request when
`config.ledgerUrl` is unset). `ledger_url` comes only from the workflow input or
`WACHIMAN_LEDGER_URL`; a pull request cannot set it from `.wachiman.yml` (`src/repo-settings.ts` has
no such key). It must start with `https://` (`http://localhost` and `http://127.0.0.1` are allowed
for tests; `src/config.ts`). It is used only when `GITHUB_ACTIONS` is `true`, so `wachiman local`
never sends to it (`spendReserve`).

**Exactly what it sends**, as `src/ledger.ts` builds it:

- On reserve: the amount it wants, optional caller limits, the trigger, whether the run is forced,
  and the pull request number.
- On settle and on record: the amount spent and one row per model call: `operation`, `label`,
  `model`, `turns`, `duration_ms`, input, output and cache token counts, `cost_usd`, `costKnown`,
  `terminal_reason` and `auth` (`ledgerCall` in `src/cost.ts`). `label` is a step name set by the
  engine (`batch 2/3`, `claims`, `verifier`, `memory match`, `threads`, `question`).
- The job's GitHub OIDC token, as a bearer token. GitHub puts its own claims in that token, such as
  the repository name; the ledger uses them to know which repository is calling
  ([ledger-api.md](ledger-api.md)). What those claims contain is GitHub's behavior, **not verified**
  here.

It sends no code, diff, file contents, pull request title or finding text. The one free-text field
is `terminal_reason`. For a call that died without a result it holds `no result:` and the first 120
characters of the error message (`src/engine.ts`), which could in principle name a path or a
provider error. The curl arguments carry the token and body through standard input, not the command
line (`curlConfig` in `src/ledger.ts`).

**You can point it at any ledger.** `ledger_url` is a plain setting, and
[ledger-api.md](ledger-api.md) is the contract a ledger implements. Wachiman does not require the
ledger run by its authors.

**Without it, everything works.** Reviews run under their normal budgets. If a ledger is set but
cannot be reached, the review still runs unless `ledger_unavailable` is `stop`. What the hosted
ledger does with the data it receives is not in this repository: **not verified**.

## What it reads

**Environment variables.** Wachiman reads the `WACHIMAN_*` settings
([configuration.md](configuration.md); the older `CLAUDE_REVIEW_*` names still work with a warning,
`src/config.ts`), `HOME`, `PATH`, `TMPDIR`, `TERM`, `LANG` and `LC_*`, and `NO_COLOR`/`FORCE_COLOR`
for output. For the providers it reads `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`,
`CLAUDE_CONFIG_DIR`, `OPENAI_API_KEY` and `CODEX_HOME`. In Actions it reads `GITHUB_ACTIONS`,
`GITHUB_REPOSITORY`, `GH_TOKEN`, `GITHUB_STEP_SUMMARY`, and for the ledger
`ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN`. It reads `WACHIMAN_LEDGER_URL`
and `WACHIMAN_LEDGER_TOKEN` for `ledger pull`. The full list of names is the output of the grep
in [How to check it yourself](#how-to-check-it-yourself).

**What the model's child process gets.** Claude Code is started with an allowlisted environment
(`CHILD_ENV_ALLOWLIST` and `buildChildEnv` in `src/providers/claude-code.ts`): `PATH`, `HOME`,
`TMPDIR`, `TERM`, `LANG`, `LC_*`, `CLAUDE_CONFIG_DIR`, `CI`, `GITHUB_ACTIONS`, and the credential.
In Actions that is `ANTHROPIC_API_KEY`, or `CLAUDE_CODE_OAUTH_TOKEN` instead (never both). It never
receives `GH_TOKEN`, `ANTHROPIC_BASE_URL`, proxy variables, `NODE_OPTIONS` or `BUN_*`. In local mode
`ANTHROPIC_API_KEY` is dropped, and the run refuses to start if it is set. Local mode also adds `USER`
and sets six switches to `1`: `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_TELEMETRY`,
`DISABLE_ERROR_REPORTING`, `DISABLE_AUTOUPDATER`, `CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY` and
`CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL` (`SUBSCRIPTION_ENV`). Wachiman does not set
those switches in Actions. Codex gets only `PATH`, `TMPDIR`, `TERM`, `LANG`, `LC_*`, `CI`,
`GITHUB_ACTIONS`, its own `HOME` and `CODEX_HOME`, and the key as `CODEX_API_KEY`
(`src/providers/codex.ts`). Details: [providers/claude-code.md](providers/claude-code.md).

**Files it reads.** From your repository: the committed or staged files of the change under review;
the instruction files `CLAUDE.md`, `AGENTS.md` and `.github/wachiman.md`, read at the base commit,
not the head; `.wachiman.yml`; `.wachiman/memory/`. From the Wachiman home: the files listed above,
and a per-user `workspaces.json` when you use sibling repositories
(`src/workspace/user-file.ts`). From a managed profile folder it reads `settings.json` only to warn
if it holds hooks or MCP servers (`inspectIsolatedProfile` in `src/profiles.ts`).

**What it does not read.** I found no code in `src/` that reads the macOS Keychain, or the sign-in
or token files of Claude Code or `gh`. Claude Code finds its own sign-in through `HOME`, `USER` and
`CLAUDE_CONFIG_DIR`. `wachiman profile remove` says the Keychain entry is not touched
(`src/accounts/commands.ts`). The one credential Wachiman reads and stores itself is the ledger read
token you give to `wachiman ledger connect`.

## What runs

- **The provider CLI as a child process.** `claude` (or `codex`) runs in an empty scratch folder with
  the repository as a readable directory. For Claude Code, `Bash` is denied in
  `src/providers/claude-code.settings.json`, and the call uses `--restricted`,
  `--strict-mcp-config` and `--tools Read,Glob,Grep` (`buildClaudeArgs` in
  `src/providers/claude-code.ts`). This is a tested configuration, not a sandbox
  ([SECURITY.md](../SECURITY.md)). Codex reads through shell commands in its own read-only sandbox
  and is not used by the workflow.
- **`gh`, `git`, `npm`, `bun` and `bash`/`curl`** as listed in the table above, each started when
  its command or mode runs.
- **No background process.** The launcher (`bin/launcher-args.js`) runs Bun with the package's
  engine and exits with its code. I found no daemon, scheduled task, login item or file watcher in
  `src/`, `bin/` or `scripts/`; the only long-running mode is `wachiman pr-state --wait`, which
  stops at its timeout.
- **No auto-update.** `wachiman upgrade` changes your install only when you run it, and refuses
  installs it cannot identify (`planCliUpgrade` in `src/upgrade/command.ts`). The Claude Code
  updater is switched off in local mode.

## Telemetry

**Wachiman itself sends no analytics or telemetry.** I searched `src/`, `bin/`, `scripts/` and
`templates/` for network call sites (the commands below); every one is in the table above, and none
sends usage data.

Claude Code, Codex and Bun may send their own. In local mode Wachiman sets the Claude Code switches
listed above. They are not verified by a packet capture: a logging proxy on 2026-11-04 saw one
telemetry destination disappear and only `api.anthropic.com` remain, and could say nothing about two
others ([local-review.md](local-review.md#7-what-is-verified-and-what-is-not)). In Actions,
Wachiman sets none of those switches, so Claude Code runs there with its own defaults.

If Wachiman ever collects usage data to improve the tool, it will be listed on this page before the
release that adds it, it will be possible to turn it off, and local review will keep working with it
off.

## What is not verified

- **What Claude Code and Codex send on the wire.** No packet capture of a whole local or Actions
  review has been run ([local-review.md](local-review.md#7-what-is-verified-and-what-is-not)).
- **Claude Code plugins.** Whether an installed plugin reaches a review is untested.
- **The code of transitive dependencies.** I did not audit `bun`, `chalk`, `@clack/prompts` or what
  they pull in. `bun`'s install script is described above from the copy of 1.3.4 in a local cache,
  not from a fresh install.
- **The hosted ledger's handling of data.** It is not in this repository. Only the client and the
  contract are.
- **Third-party actions and GitHub's OIDC token claims.** Not read here.
- **Windows.** The code paths for Windows (`spawnShell`, allowlist extras) were read, not run.
- **That this list stays complete.** `test/egress.test.ts` catches new call sites that match its
  patterns. It cannot catch a network call built in a way those patterns miss.

## How to check it yourself

Find the network surface of the source:

```sh
grep -rnE 'fetch\(|curl|wget|https?://' src bin scripts templates --include='*' | grep -v '\.test\.ts' | grep -v fixtures
grep -rnE '"(gh|git|npm|npx|claude|codex|ssh)"|ls-remote|"push"|Bun\.connect|WebSocket|node:(net|http|https|dns|tls)' src bin scripts | grep -v '\.test\.ts'
grep -rhoE '(process\.)?[eE]nv\.[A-Z][A-Z0-9_]+' src bin | sort -u
grep -rnE 'homedir\(\)|WACHIMAN_HOME|mkdirSync|writeFileSync|appendFileSync|renameSync' src bin | grep -v '\.test\.ts'
```

Run the test that keeps this page honest:

```sh
bun test test/egress.test.ts
```

Compare the published package with the tag. `npm pack` runs no scripts, and the tarball has only
the files in `package.json` `files`:

```sh
npm pack wachiman@<version> --pack-destination /tmp/wachiman-pack
mkdir /tmp/wachiman-pack/x && tar -xzf /tmp/wachiman-pack/wachiman-<version>.tgz -C /tmp/wachiman-pack/x
git clone --depth 1 --branch v<version> https://github.com/niway-dev/wachiman.git /tmp/wachiman-pack/tag
diff -r /tmp/wachiman-pack/x/package/src /tmp/wachiman-pack/tag/src
```

An empty diff for `src/` (and likewise `bin/`, `templates/`, `skills/`) means the package matches the
tag. Release builds carry provenance (`publishConfig.provenance` in `package.json`), which you can
check with `npm audit signatures`; I did not verify that for this release.
