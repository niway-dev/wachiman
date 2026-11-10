# CLI command contract: commands, flags, defaults, environment, precedence, prompts, exit codes

> **Default configuration update 2026-11-10:** The default is now Opus 5.5 at effort `high`, with verification off. Enable verification explicitly with `verify: true`, `AGENT_REVIEW_VERIFY=1`, or `local --verify`. This supersedes statements below about the 2026-11-09 defaults; historical decisions remain for context.

- **Status:** proposed 2026-11-09; detail of the
  [canonical design](2026-11-09-cli-and-verified-reviews-design.md). It makes no decision the
  design's table lacks. Every row is marked **implemented** (exists on `main` at `b3f60be`,
  behaviour unchanged), **changed** (exists, behaviour changes), or **planned** (does not exist).
  Nothing planned has been built or run.
- **Replaces, when shipped:** the command list in `docs/cli.md` and section 3 of
  `docs/local-review.md`. Until then those pages describe `main`.
- **Types:** every object named here is defined in
  [review and configuration types](2026-11-09-review-and-config-types.md).

## 1. Grammar

```
wachiman <command> [args…] [options…]
wachiman --help | -h | --version | -v
wachiman --setup-profile [<name>]            # implemented; kept as an alias of `profile create`
```

Rules, as implemented today and kept:

- The command is the first argument. `--help`, `--version` and `--setup-profile` are recognised
  only as the first argument. Every command/subcommand additionally supports `--help`
  before dependency checks or configuration writes; help never invokes Claude.
- Both `--flag value` and `--flag=value` work for every value flag. A boolean flag takes no value;
  `--flag=x` on a boolean is a usage error.
- `--repo-dir <dir>` may appear anywhere after the command on every command that accepts it; it
  is extracted first (`extractRepoDir`) and never taken for a path. A missing directory is a
  usage error.
- An unknown flag or command is a usage error (exit 2) that prints the command's usage.
- Output discipline: the **result** of a command (a report, a JSON document, a rendered file)
  goes to stdout; everything else (progress, the profile line, notices, prompts) goes to stderr.
  `--json` commands print exactly one JSON document on stdout and nothing else there.

Commands:

| Command | Status | Mode | One line |
| --- | --- | --- | --- |
| `review <pr> [paths…]` | implemented | GitHub | review a pull request, post it |
| `comment <pr>` | implemented | GitHub | route the operator's comment |
| `threads <pr>` | implemented | GitHub | answer pending threads |
| `local [paths…]` | changed | local | review a committed range on the signed-in `claude`, print it |
| `history …` | implemented | local | list and judge what `local --history` kept |
| `setup` | planned | machine | bind this repository to an account profile (guided) |
| `init` | planned | project | write the GitHub caller workflow, or hand over to `setup` |
| `doctor` | planned | machine | explain what a run would use and what would fail |
| `profile list\|create\|add\|login\|remove\|default` | planned | machine | manage account profiles |
| `project show\|unbind` | planned | machine | inspect or remove this repository's binding |
| `skills install\|uninstall` | planned | machine | copy the agent skills into place |

Not provided, deliberately: `uninstall`, `update`, `--check-update`, `profile set` (use `remove`
then `add`), `project use` (use `setup --profile <name>`), any command that reads or writes
GitHub issues, any command that opens a browser.

## 2. Exit codes

One table for every command. A command uses only the rows that apply to it.

| Code | Meaning | Who |
| --- | --- | --- |
| 0 | done: posted, printed, written, listed, or nothing to do; `doctor`: every required check passed | all |
| 1 | engine error, nothing posted; `local`: no call returned a review; `doctor`: a required check failed | `review`, `comment`, `threads`, `local`, `doctor`, `setup` (doctor summary failed) |
| 2 | usage error: bad flag or value, missing mandatory value without a TTY, corrupt config, unresolvable or unconfirmed profile, refused overwrite, refused path or name | all |
| 130 | interrupted (Ctrl-C) or cancelled (Escape, Ctrl-C, Ctrl-D); no pending writes are committed; any completed writes are explicitly reported | `local`, `setup`, `init`, `profile login`, `profile remove`, `project unbind` |

`setup` and `init` return 0 after writing; a `setup` whose final doctor summary has a failed
required check still exits 1 (the binding was written; the message says so).

## 3. Environment

| Variable | Read by | Status | Meaning |
| --- | --- | --- | --- |
| `AGENT_REVIEW_*` | engine (`loadConfig`) | implemented | every review setting; listed in `docs/configuration.md`. `local` refuses a provider other than `claude-code` |
| `AGENT_REVIEW_VERIFY`, `AGENT_REVIEW_VERIFY_BUDGET_USD`, `AGENT_REVIEW_VERIFIER_MODEL` | engine | planned (in `findings-verifier-impl`) | the verifier switch, reserve and model; `local --verify` sets the first |
| `AGENT_REVIEW_HISTORY`, `AGENT_REVIEW_HISTORY_DAYS` | `local`, `history` | implemented | history on, retention |
| `ANTHROPIC_API_KEY` | GitHub modes; refused by `local` today and by `setup`, `profile login` when shipped | changed | the CI key. `doctor` reports its presence as a failure for local use |
| `GH_TOKEN`, `GITHUB_REPOSITORY`, `REQUEST`, `AGENT_REVIEW_COMMENT_AUTHOR` | GitHub modes | implemented | unchanged; never read by the local or machine commands |
| `CLAUDE_CONFIG_DIR` | passed through to the child for the `default` profile only | implemented | overridden by the profile's directory for managed and external profiles; `doctor` notes it |
| `WACHIMAN_PROFILE` | resolver | changed | rung 3 of the precedence (below). **The bash wrapper no longer turns it into `--profile`** |
| `WACHIMAN_HOME` | config store, history, managed profiles | planned | replaces `os.homedir()/.wachiman` as the parent directory; for tests and unusual homes. Must be absolute |
| `WACHIMAN_DIR` | `bin/wachiman` (source wrapper) | implemented | the clone to run; meaningless for the npm launcher and the executable, which ignore it with one stderr notice when set |
| `CI` | wizards | planned | `CI=true` disables prompts (as a non-TTY does) |
| `NO_COLOR` | sinks, wizards | planned | no ANSI colour |
| `HOME` | `local`, `history`, `profiles` today | changed | replaced by `os.homedir()` everywhere so Windows (`USERPROFILE`) works; `HOME` unset is no longer an error |

There is deliberately no `WACHIMAN_CLAUDE_BIN`: the only thing that chooses what executes is a
stored profile's `binary`, written by a `profile` command or `setup`, as an absolute path.

## 4. Profile resolution (shared by `local`, `setup`, `doctor`, `project show`)

Status: planned (replaces `parseProfile` + `profileDir` in `src/profiles.ts`).

```
rung 1  --profile <name>                 explicit flag
rung 2  binding for this repository      config.projects[repositoryKey(repoDir).key].profile
rung 3  WACHIMAN_PROFILE                 environment
rung 4  config.defaultProfile            global default
rung 5  built-in "default"               the shell's claude, as is
```

- A name is `default`, `isolated` (managed profile named `isolated`), `isolated:<name>` (managed
  profile `<name>`), or a registered profile name. A registered external profile named like an
  unregistered managed directory is a conflict: `profile add` refuses the name.
- An unregistered `~/.wachiman/claude-<name>` directory resolves as a managed profile `<name>`
  without writing anything (migration).
- A name that resolves to nothing, at any rung, is exit 2: `profile "<name>" (from <rung>) is
  not registered and ~/.wachiman/claude-<name> does not exist; run wachiman profile list`.
  **No rung falls through to a lower rung on failure.**
- The chosen profile is printed on stderr before any call, as one line:
  `profile: <name> (<kind>[, <dir>][, binary <path>]; chosen by <rung>[; <lower rung>=<value> ignored])`.
  Examples: `profile: default (your shell's claude; chosen by built-in default)`,
  `profile: work-a (external, /Users/me/.claude-work-a, binary /opt/claude/claude; chosen by project binding; WACHIMAN_PROFILE=personal ignored)`.
- After resolution and before any model call, `local` runs the **confirmation** (types
  document, `confirmProfile`): directory exists; binary answers `--version`; `claude auth status`
  under the profile's environment reports `authMethod: "claude.ai"` and, for `external` and
  `managed` profiles, `configDirectory` equal to the profile's directory. Any other result is
  exit 2 with the fix. A binary too old to report `configDirectory` makes an external or managed
  profile `unverified`, which is exit 2 for `local` and a failed required auth check for `doctor`.
- `confirmProfile` has a bounded timeout (15 s) and output cap (64 KiB) per subprocess.
  Wachiman itself reads no credential file; managed-profile inspection may read settings.json.
  Auth commands run from an empty directory with the same allowlisted subscription environment
  and explicit engine-owned settings/restrictions as reviews, where the installed CLI supports
  them. Probe their applicability to auth subcommands before shipping; no unrestricted fallback
  that could execute an external profile's apiKeyHelper. Claude itself may read/write its state.

## 5. Commands

### 5.1 `review`, `comment`, `threads` (implemented, unchanged)

As documented in `docs/cli.md`. The verifier runs inside them unless `AGENT_REVIEW_VERIFY` is `0` or `false`
(on by default, ADR 0027 amendment of 2026-11-09). No new flag.

### 5.2 `local` (changed)

```
wachiman local [paths…] [--base <ref> | --from <commit> | --commit <commit> | --input <file> | --working-tree staged|all]
               [--max-depth <n>] [--repo-dir <dir>]
               [--format terminal|markdown|json] [--result-version 1|2] [--output <file>]
               [--profile <name>] [--verify | --no-verify] [--agent-prompt] [--history]
```

| Flag | Default | Status | Rule |
| --- | --- | --- | --- |
| `[paths…]` | whole change | implemented | changed files under these paths |
| `--base <ref>` | `origin/HEAD`, else `main` | implemented | excludes `--from`, `--commit`, `--input`, `--working-tree` |
| `--from <commit>` | none | implemented | `<commit>^ → HEAD`, inclusive; ancestor of HEAD; HEAD a branch |
| `--commit <commit>` | none | implemented | `<commit>^ → <commit>`; first parent of a merge; empty tree for a root |
| `--input <file>` | none | implemented | a `wachiman.review-input/1` or `/2` file; no range flags or paths; `/2` working-tree input requires an existing tree object in the selected clone |
| `--working-tree staged\|all` | none | planned (slice 6) | see 5.2.1; excludes every other range flag and paths are allowed |
| `--max-depth <n>` | 50 | implemented | positive integer; range deeper than it is exit 2 before any call |
| `--format` | `terminal` | implemented | `terminal`, `markdown`, `json` |
| `--result-version 1\|2` | `1` for committed changes; `2` for working-tree review | planned | only with `--format json`; `1` runs `toResultV1()`; with another format it is a usage error |
| `--output <file>` | stdout | implemented | path printed on stderr |
| `--profile <name>` | rung 2–5 | changed | any name of section 4; `default`, `isolated`, `isolated:<name>` keep working |
| `--verify` / `--no-verify` | `AGENT_REVIEW_VERIFY`, else on (ADR 0027 amendment) | planned | the verifier call; `--no-verify` wins over the variable; both flags is a usage error |
| `--agent-prompt` | off | implemented | terminal only |
| `--history` | off, or `AGENT_REVIEW_HISTORY=1` | implemented | save the run |

Pre-call stderr lines (implemented, kept): `mode:`/`base:`, `start:`/`merge-base:`, `depth:`,
`head:`, `files:`, `batches:`; **added**: the `profile:` line of section 4 before them, and
`verify: on (<model>, reserve $<n>)` or `verify: off` after `batches:`.

Refusals (exit 2, before any call), implemented ones kept and these added: an unresolvable or
unconfirmed profile; a corrupt config; `--result-version` without `--format json`; `--verify`
with `--no-verify`.

Exit: 0 when a report was produced (complete, partial, quota-stopped), 1 when no call returned a
review, 2 usage, 130 interrupted (implemented `exitCodeOf`, unchanged).

#### 5.2.1 `--working-tree` semantics (planned, slice 6)

Reviews a **stable snapshot** of uncommitted work against `HEAD`. The connector:

1. Requires an existing `HEAD` commit; an unborn repository or an unmerged index is exit 2.
2. Uses a temporary index and a temporary object database (`GIT_OBJECT_DIRECTORY`, with the real
   object database read-only as an alternate). Resolve the index with `git rev-parse --git-path
   index`; handle split-index references, or refuse them explicitly before any call. The real
   index, worktree and object database are never written.
3. For `staged`, capture the index tree. For `all`, build it from current tracked files,
   deletions and non-ignored untracked regular files. Do not run clean/smudge filters, hooks,
   fsmonitor, external diff drivers or submodule commands from repository configuration.
   Symlinks are captured as link text and never followed outside the repository; gitlinks are
   reported as unsupported snapshot content, just as submodules are today.
4. Freeze the file/index manifest before reading; compare index/file identity and content after
   capture. If files change during capture, abort with a retry message (exit 2), not a mixed
   snapshot. Subsequent edits after capture cannot affect the run.
5. Archive the synthetic tree to the snapshot and compare it with `HEAD`; existing archive
   exclusions remain explicit coverage warnings. Keep temporary objects until review and history
   annotation finish, then remove them on success/error/interrupt. History stores snapshot kind
   and original base commit; future annotation never calls commit-ancestry operations on tree ids.

The `ReviewInput.change` has `kind: "working-tree"`, `base.sha` = `HEAD`, `head.sha` = the tree
id (40 or 64 hex), `head.ref` = `working tree (staged)` or `working tree (all)`, and
`describe` = `the staged changes of <repo>` or `the working tree of <repo>`. Binary and
ignored files follow today's rules. `--history` is allowed: the history key is the repository's;
the run's head is the tree id, so finding tracking across runs works by fingerprint as it does
across commits. The input is `wachiman.review-input/2`; `/1` is unchanged. A reader accepts both.
Working-tree results require `/2`; `--result-version 1` with `--working-tree` (or a working-tree
input file) is exit 2 before any provider call. A Git tree id must never masquerade as a commit.

### 5.3 `history` (implemented, unchanged)

```
wachiman history [--repo-dir <dir>] [--since <n>d] [--all-repos] [--json]
wachiman history [--repo-dir <dir>] --verdict <id> correct|partial|wrong [--reason <text>]
wachiman history [--repo-dir <dir>] --forget [--all]
```

Listing defaults to this repository and all retained runs. `--since` accepts a nonnegative
integer followed by `d`; `--all-repos` lists every stored repository; `--json` emits the existing
`wachiman.history-state/1` format. `--verdict` records only one human judgement and accepts no
listing/forget flags; `--reason` is legal only with it. `--forget` deletes this repository's
history, or every history with `--all`; it accepts no listing/verdict flags and never deletes
account directories. These spellings and destructive semantics are implemented and unchanged.
The history reader accepts either embedded result version when slice 2 ships; old records remain
intact and unknown future embedded versions are skipped, not renamed as corrupt.

### 5.4 `setup` (planned)

```
wachiman setup [--profile <name>] [--repo-dir <dir>] [--yes] [--json]
```

Purpose: bind the repository of `--repo-dir` (default: the current directory) to one account
profile, on this machine, in the home directory; then run the doctor summary. Never a model
call; never a file written under the repository.

| Flag | Default | Rule |
| --- | --- | --- |
| `--profile <name>` | prompt | the profile to bind; a registered name, `default`, `isolated[:<name>]`. Mandatory without a TTY |
| `--repo-dir <dir>` | `.` | must be a git repository |
| `--yes` | off | accept defaults, no prompts (a missing mandatory value is still exit 2) |
| `--json` | off | print the resulting `ProjectShow` document on stdout instead of the summary; diagnostics stay on stderr |

Interactive flow (each question shows its default; cancellation before the final save leaves
the config unchanged; directory creation or a completed Claude login is reported separately):

1. **Repository.** Prints `repository: <name> (<origin url without credentials> | path <dir>)`
   and the existing binding if any (`currently bound to work-a`). Question: `Set up this
   repository? [Y/n]`. No → exit 0, nothing written.
2. **Profile.** Numbered list: registered profiles (name, kind, directory, binary or `PATH`), the
   current binding marked `(current)`, the global default marked `(default)`; then two more
   rows: `Register an existing Claude configuration directory (external)` and `Create a new
   isolated profile (managed)`. Without any registered profile the default is "Register".
   - Register: text `Configuration directory` (absolute; `~` expanded; must exist; must be a
     directory; must not be under `~/.wachiman`); text `claude binary (leave empty for PATH)`
     (absolute existing executable, no `.cmd`/`.bat`/`.ps1`); text `Profile name` (section 4's
     name rule, default from the directory's basename without a leading dot). Then the entry is
     shown as a pending registration; it is not written yet.
   - Create: text `Profile name` (default `isolated`); prepares the proposed managed directory. Creating it and opening Claude for sign-in requires
     an explicit confirmation naming that side effect; no profile or binding is registered yet.
     Authentication is handled by the official binary and cannot be rolled back by the wizard.
3. **Confirm the binding.** Shows: profile name, kind, directory, binary path or `PATH`, the
   repository identity (`keyed by origin: <url>` or `keyed by path: <dir>`) and the scope sentence
   `every clone and worktree of this origin will use it`. Question: `Bind <repo> to <profile>?
   [Y/n]`. No → exit 0, no pending config changes saved; explicitly list any already-created managed
   directory or Claude login.
4. **Write** the pending profile (if any) and binding together in one locked atomic config
   transaction, revalidating concurrent changes under the lock. Print `bound: <repo> → <profile> (home config,
   nothing written in the repository)`.
5. **Confirm the account.** Runs `confirmProfile`. Signed out → `Sign in now? [Y/n]`; yes runs
   `profile login <name>` (section 5.7) and re-checks; no → continue with the warning.
6. **Doctor summary** (section 5.6, compact) and the suggested line:
   `wachiman local --repo-dir <dir>` (no `--profile`, because the binding carries it).

Non-interactive (`--yes`, `CI=true`, or no TTY): `--profile <name>` is mandatory (exit 2 without
it: `setup needs --profile <name> when it cannot ask; run wachiman profile list`); the name must
already resolve (it never registers or creates a profile); steps 3 and 4 run without a question;
step 5 runs the check and reports without prompting; step 6 prints the summary. It never selects
the first profile and never writes a profile entry.

Re-running `setup` on a bound repository keeps the binding unless the person picks another
profile (interactive) or passes `--profile` (non-interactive).

### 5.5 `init` (planned)

```
wachiman init [--mode github|local|both] [--operator <login>] [--version <tag>] [--path <file>]
              [--force] [--dry-run] [--yes] [--repo-dir <dir>]
```

Purpose: a project's first-time setup. For GitHub Actions it writes the maintained caller
workflow from `templates/wachiman-review-caller.yml`. For "this machine only" it writes nothing
and hands over to `setup`. It explains, in the written file's header and on screen, that Actions
is billed through the repository secret `ANTHROPIC_API_KEY`, which the person adds in GitHub,
and that local runs use the signed-in `claude` and never that key.

| Flag | Default | Rule |
| --- | --- | --- |
| `--mode github\|local\|both` | prompt | mandatory without a TTY |
| `--operator <login>` | prompt (default: `git config user.name` is **not** used; no default) | mandatory for `github` and `both` without a TTY; written as `operator:`; must match `^[A-Za-z0-9](?:[A-Za-z0-9]\|-(?=[A-Za-z0-9])){0,38}$` |
| `--version <tag>` | bundled `DEFAULT_WORKFLOW_REF` (a known published immutable ref) | written in `uses: …@<tag>`; must look like `vX.Y.Z` or a 40-hex SHA; must not infer an Actions tag from the CLI version; missing bundled ref makes this flag mandatory |
| `--path <file>` | `.github/workflows/wachiman-review.yml` | relative to `--repo-dir`; must end in `.yml` or `.yaml` and stay under `.github/workflows/` |
| `--force` | off | overwrite an existing target after copying it to `<file>.bak-<YYYYMMDD-HHMMSS>` |
| `--dry-run` | off | print the rendered file to stdout; write nothing; exit 0 |
| `--yes` | off | accept defaults; no prompts |
| `--repo-dir <dir>` | `.` | must be a git repository |

Interactive flow:

1. `How will Wachiman review this repository?` numbered: `1. In GitHub Actions on pull requests
   (default)`, `2. Only on this machine, with my Claude subscription`, `3. Both`.
2. For 1 or 3: `GitHub login of the operator (the one person whose /wachiman comments start a
   run)`: text, no default, validated. `Release tag to pin [<DEFAULT_WORKFLOW_REF>]`: text with default.
   `Workflow file [.github/workflows/wachiman-review.yml]`: text with default.
3. **Preview.** The rendered file is printed to stderr with a one-line header
   (`--- .github/workflows/wachiman-review.yml (new | would overwrite)`). If the target exists and
   `--force` is absent: `A workflow already exists at <path>. Re-run with --force to replace it
   (a .bak copy is kept).` exit 2. Otherwise `Write it? [Y/n]`.
4. **Write.** Then print, on stderr, the two things the person must do in GitHub: add the
   repository secret `ANTHROPIC_API_KEY` (Console key, API-billed), and open the pull request
   that adds the file. Then: `Local runs use your signed-in claude, never this key.`
5. For 2 or 3: `Run wachiman setup now to bind this repository to a Claude account? [Y/n]`; yes
   runs section 5.4 in the same process; no prints the `wachiman setup` line.

Rendering (pure, `renderCallerWorkflow(template, { operator, tag })`): replaces
`operator: EDIT-THIS-github-login` with the login and `review.yml@v1.5.0` (whatever tag the
template carries) with `@<tag>`; nothing else in the template changes, so the maintained
comments and triggers ship as written. A template whose two anchors are not found is an engine
error (exit 1): the template and the renderer are tested together.

Non-interactive: `--mode` mandatory; for `github`/`both`, `--operator` mandatory; `--version`
mandatory only when the bundled workflow ref is absent; no preview question; `--dry-run` prints
and exits 0; an existing target without `--force` is exit 2; `local` mode prints the `setup`
line and exits 0; `both` writes the workflow then prints the `setup` line (it never runs `setup`
without a TTY, because `setup` would need `--profile`).

`init --dry-run` always terminates after rendering and never chains into setup or login.
Local-only mode with GitHub-only flags (`--operator`, `--version`, `--path`, `--force`,
`--dry-run`) is exit 2 rather than silently ignoring them. Validate target ancestors with realpath
and lstat: no symlinked `.github`/`workflows`/target may escape the repository, and backups must
not overwrite an existing backup. Write via an exclusive temporary file plus rename; recheck
target identity before replacement.

`init` writes nothing outside the chosen workflow path and its `.bak` copy. It never commits,
never pushes, never opens a pull request, never creates a secret.

### 5.6 `doctor` (planned)

```
wachiman doctor [--json] [--profile <name> | --all-profiles] [--repo-dir <dir>] [--redact-paths]
```

Checks are declared as data (`DoctorCheck[]` in the types document), run in order, each
producing `{ id, level: "required" | "optional", status: "ok" | "fail" | "warn" | "skip",
evidence, fix? }`. No install, no model call, no Wachiman-owned network request. The Claude
subprocess (`--version`, `auth status`) is run; what it does on the network is **not observed**
and the output says so.

| id | level | Check | Never |
| --- | --- | --- | --- |
| `wachiman` | required | version, install kind (`npm`, `source`, `exe`), path (`process.execPath` or the clone), platform, tier | contact anything |
| `bun` | required (npm, source) / skip (exe) | `bun --version`, `>= 1.3` | |
| `git` | required | `git --version`; minimum 2.30 (the oldest `local-git.ts` was exercised with; to confirm at implementation) | run inside the repository with hooks |
| `tar` | required | `tar --version` (bsdtar or GNU) | extract anything |
| `config` | required | `~/.wachiman/config.json` absent (ok, "no profiles registered") or valid; a corrupt file is `fail` naming the field | |
| `profile` | required | the resolved profile (section 4) with its rung; kind, directory exists, binary path and `--version` | open a file inside an external directory; open `.credentials.json` or `.claude.json` anywhere |
| `auth` | required | `claude auth status` under the profile's environment: `authMethod`, `configDirectory` match or `unverified` (a failed required check); `api_key`, `api_key_helper`, `third_party`, unknown → `fail` with the reason. Row carries `networkObserved: "unknown"` | claim the check was offline; print account e-mail or raw auth JSON |
| `environment` | required | `ANTHROPIC_API_KEY` set → `fail` ("a local run would be refused"); `CLAUDE_CONFIG_DIR` exported → `warn` for `default` only; `WACHIMAN_PROFILE` and what rung it would take | print a value, only presence |
| `project` | optional | the binding for `--repo-dir` (or none), identity key, rung | read repository files other than git metadata |
| `history` | optional | `~/.wachiman/history` exists, modes where enforced, repository count | open a run file |
| `skills` | optional | where `wachiman-review` and `wachiman-audit` are installed and whether they match this version (marker file) | |
| `isolation` | required for managed; optional otherwise | for a managed profile: `inspectIsolatedProfile` result; for external: `warn` "plugins untested, your customisations may apply" | |

Text output: a header line (`Wachiman <version> (<kind>, <path>, <platform>, tier <tier>)`), the
promise line (`Local mode: no telemetry and no GitHub requests by Wachiman; the code goes to the
Claude account of the chosen profile. https://code.claude.com/docs/en/legal-and-compliance`),
then `Required` and `Optional` sections with `✓`/`✗`/`·` rows and the evidence, then
`<n> required check(s) failed.` Exit 0 when none failed, 1 otherwise, 2 for usage.

`--json` prints `DoctorReport` (types document). `--profile <name>` checks that profile instead of
the resolved one; `--all-profiles` repeats the `profile`, `auth` and `isolation` rows per
registered profile and the managed directories found; the two flags together are a usage error.
`--redact-paths` replaces complete paths with stable placeholders (`<home-path-1>`,
`<external-path-1>`), removes origin URLs and boundFrom paths, and applies to nested evidence
and fix text in both outputs. Replacing only the home prefix with `~` is not redaction.

### 5.7 `profile` (planned)

```
wachiman profile list [--json]
wachiman profile create [<name>]                       # managed; today's --setup-profile
wachiman profile add <name> --config-dir <abs> [--binary <abs>] [--note <text>]
wachiman profile login <name>
wachiman profile remove <name> [--delete-dir] [--yes]
wachiman profile default <name> | --none
```

| Subcommand | Rule |
| --- | --- |
| `list` | every registered profile plus unregistered managed directories (`~/.wachiman/claude-*`, marked `unregistered`), the global default marked, and which bindings use each; no model call; opens no credential file. `--json` prints `ProfileList` |
| `create [<name>]` | exactly today's `setupProfile`: name default `isolated`; creates `~/.wachiman/claude-<name>` (`0700`), refuses a populated directory, starts the official `claude` (from `PATH`, no shell) in it from an empty temp dir with the subscription environment, never checks the result; **then** registers `{ kind: "managed" }` under the name. `--setup-profile [<name>]` calls it and prints `--setup-profile is now "wachiman profile create"` once |
| `add` | writes an `external` entry. Refuses: a relative path after expanding a leading `~`, a missing or non-directory `--config-dir`, a directory under `~/.wachiman`, a `--binary` that is relative, missing, not a regular file, not executable (`X_OK`; on Windows not `.exe`), or ends in `.cmd`/`.bat`/`.ps1` (message: "`claude.cmd` is an npm shim that starts Node; give the path of `claude.exe`; `claude doctor` prints it"); the names `default`, `isolated`, a name already registered, or a name whose managed directory exists. Opens no file inside the directory; the same `~` expansion and canonicalisation as the wizard is used |
| `login <name>` | spawns the profile's binary (stored `binary`, else `claude` from `PATH`), by path, no shell, from an empty temp directory, with `buildChildEnv(env, { auth: "subscription", configDir })`, `stdio: inherit`, arguments `["auth", "login"]` when the binary's `--version` is at or above the version that has the subcommand (probe, design section 8), else no arguments plus the printed instruction `run /login, then /exit`. It never reads the outcome; it ends with `run wachiman doctor --profile <name> to see the sign-in state`. For `default` it is a usage error (`sign in with your own claude`) |
| `remove <name>` | removes the entry, clears `defaultProfile` if it names it, and removes every binding that names it (listing them; `--yes` skips the confirm). **Never deletes a directory by default.** `--delete-dir` deletes a **managed** directory only, after a confirm that names it and says the macOS Keychain entry stays (how to remove it in Keychain Access); on an external profile `--delete-dir` is a usage error |
| `default <name>` / `--none` | sets or clears `config.defaultProfile`; the name must resolve |

### 5.8 `project` (planned)

```
wachiman project show [--json] [--repo-dir <dir>]
wachiman project unbind [--repo-dir <dir>] [--yes]
```

`show` prints the repository identity (`name`, `keyedBy`, the origin without credentials or the
path), the binding if any (`profile`, `boundAt`) and the profile the full resolution would
choose with its rung (so an exported `WACHIMAN_PROFILE` that would be ignored is visible). `--json`
prints `ProjectShow`. `unbind` removes the binding after a confirm (or `--yes`); without a binding
it prints `not bound` and exits 0. Binding is `setup --profile <name>`.

### 5.9 `skills` (planned, from draft ADR 0026 decision 3)

```
wachiman skills install [--dir <path>]… [--json]
wachiman skills uninstall [--dir <path>]…
```

`install` copies `skills/wachiman-review` and `skills/wachiman-audit` (from the package, the
clone, or the embedded assets) into `~/.agents/skills` and every `~/.claude/skills`,
`~/.claude-*/skills` and `$CLAUDE_CONFIG_DIR/skills` that exists, plus any `--dir`; it refuses any
target under `~/.wachiman`; it writes a marker `.wachiman-skill.json` (`{ format: "wachiman.skill-install/1", version, installedAt, files: { "<relative-path>": "<sha256>" } }`)
in each copy; an existing copy with a matching ownership marker and unmodified installed-content hashes is replaced; a locally modified marked copy or one without a marker is left in place
with a warning. `uninstall` removes only owned, hash-matching files; preserves edits and unrecognised files with a warning. It never follows a target symlink outside the selected skills directory. Copies, not symlinks.

### 5.10 `--setup-profile [<name>]` (implemented, kept as alias)

Behaves as `profile create [<name>]` and prints the new spelling once.

## 6. Prompt conventions (shared by `setup` and `init`)

- Interactive iff `--yes` is absent, `process.stdin.isTTY && process.stdout.isTTY`, and
  `env.CI !== "true"`. Tests inject `interactive` and the `PromptIO` streams.
- Every question shows its default: numbered lists mark `(default)`; text inputs show `[value]`;
  confirms show `[Y/n]` or `[y/N]`. Enter takes the default.
- Cancellation: Escape, Ctrl-C and Ctrl-D (EOF) cancel pending work and exit 130. Before the final
  config/workflow save, report `cancelled: no configuration changes saved`. After a completed
  write or Claude login, list exactly what completed; never claim it was rolled back.
  In `init --mode both`, cancellation during setup leaves an already-confirmed workflow intact.
- Prompts translate answers into the same `Raw<Cmd>Flags` object the parser produces; one pure
  `resolve<Cmd>Options` validates both; validation errors from prompt answers show the error and ask again until valid or cancelled.
  A bad CLI flag is always exit 2; prompts never override an explicitly supplied invalid value.
- Before any write: a preview or a one-line statement of exactly what will be written, where,
  and a confirm.
- Prompts and progress go to stderr; a `--json` result goes to stdout alone.

## 7. The bash wrapper and the launcher

`bin/wachiman` (implemented, **changed** in slice 0): keeps resolving the clone (or
`WACHIMAN_DIR`), uses `exec bun --no-env-file --config=<dir>/bunfig.toml
<dir>/src/cli.ts "$@"`, and **drops** the block that appends `--profile "$WACHIMAN_PROFILE"`.
The wrapper also stops dropping `ANTHROPIC_API_KEY`: the command's explicit local refusal
must be identical through source, npm and exe entry points. This is an announced compatibility
change: a contributor with an API key exported must unset it for a local subscription run.
GitHub commands continue receiving the API key they require.

`bin/wachiman.js` (planned, slice 4), the npm `bin` for `wachiman` and `agent-review`:

```
#!/usr/bin/env node
args = launcherArgs(pkgDir, process.argv.slice(2))
  // ["--no-env-file", `--config=${pkgDir}/bunfig.toml`, `${pkgDir}/src/cli.ts`, ...argv]
// launcherArgs is imported from the shipped bin/launcher-args.js, shared with Bun tests
bun = process.platform === "win32" ? "bun.exe" : "bun"
r = spawnSync(bun, args, { stdio: "inherit", env: process.env })   // env untouched
if r.error?.code === "ENOENT": stderr "wachiman needs Bun 1.3 or later: https://bun.sh"; exit 2
exit r.status ?? (r.signal === "SIGINT" ? 130 : 1)
```

It sets no variable, unsets none, and never translates `WACHIMAN_PROFILE`.

## 8. Compatibility table

| Today (`main`) | After this design | Status |
| --- | --- | --- |
| `--profile default\|isolated[:<name>]` | same values accepted; plus registered names | compatible |
| `--setup-profile [<name>]` | kept; alias of `profile create` | compatible |
| `WACHIMAN_PROFILE` makes the wrapper add `--profile` | read in-process at rung 3; a binding beats it | **behaviour change**, documented and announced in the changelog |
| `HOME` unset is a usage error for isolated profiles and history | `os.homedir()`; `WACHIMAN_HOME` override | compatible on POSIX; enables Windows |
| `--format json` writes `/1` | committed reviews still default to `/1`; `--result-version 2` opts into `/2`; working-tree reviews require `/2` | compatible for committed consumers; a future default change requires a separately announced major release |
| `ReviewResult.provider.profile` ∈ `ci\|default\|isolated` | unchanged in `/1`; `/2` adds `provider.account` | compatible |
| `scripts/install-local.sh`, `bin/wachiman` | kept for contributors | compatible |
| `skills/wachiman-review/SKILL.md` lists `~/.wachiman/claude-*` | uses `profile list --json`, `project show --json` | docs change |
| `docs/cli.md`, `docs/local-review.md` §3, README "npm: nothing is published", `docs/releasing.md` | rewritten in slice 4 | docs change |


## 9. Example sessions (planned commands, not executed)

```sh
# npm delivery; requires both Node for the launcher and Bun for the engine
npm install -g wachiman
wachiman profile add work-a --config-dir /absolute/path/to/work-a
wachiman profile add work-b --config-dir /absolute/path/to/work-b --binary /absolute/path/to/claude
wachiman setup --profile work-a --repo-dir /absolute/path/to/project
wachiman doctor --repo-dir /absolute/path/to/project
wachiman local --repo-dir /absolute/path/to/project --commit abc1234 --verify
wachiman local --repo-dir /absolute/path/to/project --from abc1234 --verify --format markdown --output review.md
wachiman local --working-tree all --verify --format json --result-version 2
wachiman init --mode github --operator example-login --dry-run
wachiman init --mode github --operator example-login
```

Windows users can run the same command grammar through npm+Node+Bun or wachiman.exe;
profile paths use absolute Windows paths and an actual claude.exe. No POSIX shell alias is used.
`review <pr>` is the GitHub-posting command, not an alias of local. To inspect a PR locally
without GitHub requests, check out its branch and use local with its base, or supply a prepared
PR ReviewInput whose head exists in the clone. A checkout's working-tree changes are included
only with the explicit --working-tree selector. Saving/forwarding a report can disclose reviewed
code; no command automatically creates tracker issues, pushes fixes or publishes the report.
