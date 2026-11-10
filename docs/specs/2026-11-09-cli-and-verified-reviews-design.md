# The Wachiman CLI and verified reviews: install, accounts, setup, doctor, one review motor

> **Default configuration update 2026-11-10:** The default is now Opus 5.5 at effort `high`, with verification off. Enable verification explicitly with `verify: true`, `AGENT_REVIEW_VERIFY=1`, or `local --verify`. This supersedes statements below about the 2026-11-09 defaults; historical decisions remain for context.

- **Status:** proposed 2026-11-09. **Nothing in this document is implemented or tested unless a
  row says "implemented" and names the file.** Written on Claude Fable 5.1 as the canonical
  design that replaces the 2026-11-08 draft
  (`design/local-cli-distribution`, `docs/specs/2026-11-08-local-cli-distribution-and-project-setup-design.md`,
  992 lines, contradictory sections, kept only as research). The owner's direction of
  2026-11-08 and 2026-11-09 takes precedence over every earlier packaging recommendation.
- **Date:** 2026-11-09
- **Issue:** [#134](https://github.com/niway-dev/wachiman/issues/134) (local install as a
  package), [#137](https://github.com/niway-dev/wachiman/issues/137) (verifier). #79 (reader,
  judge, local index) is **not** taken up: its gates are not met and this design builds no
  reader/judge split.
- **Companion documents (the detail; this file makes the decisions):**
  - [CLI command contract](2026-11-09-cli-command-contract.md): every command, flag, default,
    environment variable, precedence rule, prompt and exit code.
  - [Review and configuration types](2026-11-09-review-and-config-types.md): every external and
    internal contract as TypeScript-like discriminated types, JSON examples, the `/1` to `/2`
    migration and the security invariants.
  - Plan: completed slices are retained in git history; the Windows executable slice was canceled.
- **Creates:** ADR 0028 (the npm package requires Bun and ships the source behind a Node
  launcher; a Windows executable is a second artifact), ADR 0029 (named account profiles,
  external configuration directories, project bindings in the home directory), ADR 0030
  (`wachiman.review-result/2` with verification and origin, and an explicit downgrade to `/1`).
  **Numbering:** `main` holds up to 0023; open branches hold 0014–0015 (#80), 0017–0018 (#90),
  0021–0022 (#124, #129), 0024–0026 (#135), 0027 (#138). 0028 is the first free number.
- **Reuses:** ADR 0001 (trust model; "an npm package now" was deferred, not refused; provenance
  designed together with npm), ADR 0002 (TypeScript on Bun, zero runtime dependencies), ADR 0003
  (two label axes), ADR 0019 (review core behind ports; the subscription mode and its promise),
  ADR 0020 (repository identity for the history), ADR 0023 (one name), draft ADR 0026 (#135:
  npm package `wachiman`, `skills install`, trusted publishing; reconciled, see section 2), draft
  ADR 0027 (#138: one verifier call per pull request; reconciled, see section 5).
- **Reads before deciding (Step 2 of the design procedure):** every ADR title on `main` and the
  full text of 0001, 0002, 0019, 0020, 0023, draft 0026 and draft 0027; `src/cli.ts`,
  `src/local.ts`, `src/profiles.ts`, `src/providers/claude-code.ts`, `src/config.ts`,
  `src/history/store.ts`, `src/connectors/local-git.ts`, `bin/wachiman`,
  `scripts/install-local.sh`, `templates/*.yml`, `docs/formats/*.json`; the verifier
  implementation on branch `feat/findings-verifier` (read by git show) (`src/verify.ts` and its `engine.ts`,
  `config.ts`, `formats.ts` changes); Laqi's `apps/cli/src/init/{args,options,prompt,run}.ts`;
  the hub page `conventions/tool-doctor-pattern.md`; Claude Code's
  [legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance) (read
  2026-11-09, quoted in section 4).

## Summary (one minute)

`wachiman local`, `history`, `--commit` and `--from` stay exactly as they are. Around them, five
things change. **Install:** the CLI ships as the npm package `wachiman`; it requires Bun on
Linux, macOS and Windows (the owner accepts that), its `bin` is a dependency-free Node launcher
that finds `bun` and runs the TypeScript source with the isolation flags the bash wrapper passes
today, so `npm i -g wachiman` and `npx wachiman` work wherever Bun is installed; a standalone
`wachiman.exe` for Windows is built from the same source as a second artifact and is "built and
smoke-tested", never "supported", until the Windows rows pass. The source wrapper and
`scripts/install-local.sh` stay for contributors. **Accounts:** `--profile` grows from
`default | isolated[:name]` into named profiles kept in `~/.wachiman/config.json`: `managed`
(today's isolated sign-in) and `external` (a developer-owned `CLAUDE_CONFIG_DIR`, optionally with
an explicit `claude` path); a project is bound to a profile by a command, the binding lives in the
home directory keyed by the repository identity the history already uses, and a profile that
cannot be confirmed stops the run before any call. Wachiman never reads, copies or moves a
credential: the user signs into the official, unmodified `claude` binary, and the only check is
`claude auth status`. **Setup and init:** `wachiman setup` is the guided machine-local wizard
(profile, binding, doctor); `wachiman init` is the project wizard that can write the maintained
GitHub caller workflow from `templates/` and explains that Actions keeps its own API-key secret;
a local-only answer writes no workflow. Prompts and flags feed one resolver; without a TTY the
flags are mandatory and nothing waits. **Doctor:** `wachiman doctor` explains, without a model
call, which binary and profile a run would use and why, whether the sign-in is confirmed, and
what would fail; it never claims the Claude subprocess made no network request. **One review
motor:** the GitHub Action and the local CLI run the same `reviewChange` with the verifier of
ADR 0027 inside it; they differ only in connector, authentication and sinks. The report keeps the
familiar label words (Important, Nit, Pre-existing) as a display layer over the data, which
encodes severity, topic, origin and verification status separately, in a new result format `/2`
with an explicit downgrade to `/1`; committed JSON output keeps `/1` as its default.

| # | Decision | Why | ADR |
| --- | --- | --- | --- |
| 1 | **The npm package `wachiman` requires Bun** (`engines.bun >= 1.3`) and ships the TypeScript source (`src/`, `skills/`, `templates/`, `bunfig.toml`); no bundle, no runtime dependency | Owner's direction 2026-11-08: Bun as a prerequisite is acceptable on every OS; the engine uses `Bun.Glob` and runs on nothing else (ADR 0002). Keeps draft ADR 0026 decisions 1, 3, 5 | 0028 (new), amends draft 0026 (#135) |
| 2 | **The package `bin` is a dependency-free Node launcher** (`bin/wachiman.js`): it finds `bun` (`bun.exe` on Windows) on `PATH`, runs `bun --no-env-file --config=<pkg>/bunfig.toml <pkg>/src/cli.ts <args>` with `stdio: inherit`, exits with the child's code, and translates no environment variable into a flag | npm's shims run Node on every OS, so `npx wachiman` and `npm i -g` work the same on Windows without trusting cmd-shim's shebang handling; the isolation flags that `bin/wachiman` passes today keep working for a package install. Replaces draft 0026 decision 2 ("`npx` unsupported") | 0028 |
| 3 | **A Windows `wachiman.exe`** is built with `bun build --compile --target bun-windows-x64 --no-compile-autoload-dotenv --no-compile-autoload-bunfig`, attached to the GitHub Release with a SHA-256 and a build attestation, and labelled **built and smoke-tested** until the Windows rows of the acceptance criteria pass on `windows-latest`; macOS and Linux get no binary in this design | The owner wants a standalone Windows executable; a compiled binary proves nothing about `tar`, paths or the Claude binary on Windows, so the tier is earned by rows, not asserted | 0028 |
| 4 | **The source path stays:** `bin/wachiman` (bash) and `scripts/install-local.sh` remain supported for contributors running a clone; `WACHIMAN_DIR` keeps its meaning there | Public installation does not replace running unreleased source (parent review of the draft, item 5) | 0028 |
| 5 | **Account profiles are named and global**, in `~/.wachiman/config.json` (`version: 1`): `managed` (Wachiman-created bare sign-in under `~/.wachiman/claude-<name>`, today's `isolated`) or `external` (a developer-owned `CLAUDE_CONFIG_DIR`, optional absolute `binary`); `default` stays "the shell's `claude`, as is" | Several accounts on one machine is what Anthropic documents `CLAUDE_CONFIG_DIR` for; a work directory is populated by nature and must be used in place (the macOS Keychain entry is keyed to the path) | 0029 (new) |
| 6 | **Project bindings live in the home directory**, keyed by `repositoryKey` from `src/history/store.ts` (normalised `origin` URL hashed, else the git common dir); **nothing in the reviewed repository is ever read for account or binary selection** | A committed file that names a binary would let an untrusted branch choose what executes; workstation paths must not leak into repositories; clones and worktrees of one repository share the binding | 0029 |
| 7 | **Precedence:** `--profile` flag > project binding > `WACHIMAN_PROFILE` > `defaultProfile` in the config > built-in `default`; one stderr line names the chosen profile and the rung, and the rung it overrode. **The bash wrapper stops translating `WACHIMAN_PROFILE` into `--profile` in the first slice**, so every entry point runs the same in-process resolver | A binding is a deliberate per-project act; an exported variable is ambient and may be forgotten. The wrapper's translation would make the variable beat the binding and send an employer's code to a personal account | 0029 |
| 8 | **Strict failure, never fallback:** a corrupt `config.json`, a binding to a profile that does not exist, a missing directory, a binary that does not answer `--version`, or an `auth status` that is not a confirmed `claude.ai` sign-in stops `local` with exit 2; setup reports its saved binding and failed doctor summary with exit 1, and explicit login may repair a signed-out profile before any model call, naming the fix | Sending code to the wrong account is the worst outcome this design can produce; a silent fallback is exactly that | 0029 |
| 9 | **Atomic, locked writes:** every write to `config.json` is read-modify-write under an exclusive lock file (`config.json.lock`, `O_EXCL`, bounded wait), then a temp file and `rename`; mode `0600` where modes exist | Two worktrees running `setup` at once must not lose each other's entries; a half-written file must never be read as "no profiles" | 0029 |
| 10 | **Credentials are never read, copied or moved; sign-in happens in the official, unmodified `claude`.** `profile login` spawns the profile's binary (by path, no shell) with `CLAUDE_CONFIG_DIR=<dir>` from an empty temp directory and never reads the result; the only auth check is `claude auth status` (exit code, `authMethod`, `configDirectory`), run with a bounded timeout and output cap | Anthropic's legal page (section 4): developers "may not collect, store, or intermediate Claude.ai credentials or session tokens", and nothing "prevent[s] an end user from signing in to the unmodified Claude Code binary with their own Claude subscription". Wachiman is designed to follow this boundary; absence of credential handling alone is not a blanket compliance guarantee | 0029, reuses 0019 |
| 11 | **Actions stays API-key billed; local stays subscription.** `init` says so when it writes the workflow; no design here moves a subscription credential to a runner, and `local` keeps refusing `ANTHROPIC_API_KEY` | ADR 0019 decision 4 and the same legal page: Wachiman never routes requests through plan credentials on anyone's behalf | reuses 0019 |
| 12 | **`wachiman setup` is the guided machine-local wizard**: choose or register a profile, confirm the repository scope, write only the home-local binding, end with a doctor summary and the suggested `wachiman local` line; never a model call. Non-interactive: `setup --profile <name>`; without a TTY and without `--profile` it exits 2 and never picks the first profile | The owner asked for a project-level setup that chooses between two custom-directory work accounts; profile subcommands alone did not fulfil it (parent review, item 1) | 0029 |
| 13 | **`wachiman init` is the project wizard**: it asks how Wachiman will run here (GitHub Actions, this machine only, or both), writes `.github/workflows/wachiman-review.yml` from `templates/wachiman-review-caller.yml` with the operator login and a bundled known-published workflow ref, shows the file before writing, refuses to overwrite without `--force`, has `--dry-run`, and for "this machine only" writes nothing and hands over to `setup` | The owner asked for an Astro/Laqi-style init with visible defaults, cancellation, preview and explicit overwrite; a local-only choice must not create a workflow | — (spec) |
| 14 | **One options resolver per wizard**, Laqi's shape: prompts translate answers into the same raw-flag object the parser produces, and one pure `resolve*Options` decides; prompts are built on `node:readline` (numbered choices, Ctrl-C and Escape cancel with exit 130), **no `@clack` dependency** | ADR 0002 keeps zero runtime dependencies; the pattern, not the library, is what prevents prompt and flag drift | reuses 0002 |
| 15 | **`wachiman doctor` diagnoses and installs nothing**: declared checks (presence, version, access), one evidence string each, required versus optional, `--json`, exit 1 on a failed required check, no model call; it reports what the Claude subprocess answered and **never claims that subprocess made no network request** | The hub's tool-doctor pattern; the parent review's item 4: a throwing `fetch` stub in the parent process proves nothing about a child process | — (spec) |
| 16 | **One review motor:** GitHub and local both call `reviewChange` (ADR 0019) with the verifier step of ADR 0027 inside it; the modes differ in connector (`githubReviewInput` or `buildLocalInput`), authentication (`api-key` or `subscription`) and sinks only. No second orchestration engine, no agent fan-out, no recursion: the verifier is one bounded `claude -p` with Read/Glob/Grep | Every benchmark stays valid for every mode; the owner wants a lightweight product (draft, architecture note) | reuses 0019, 0027 |
| 17 | **The verifier is a hypothesis falsifier over evidence, not over summaries:** it receives each candidate with the base/head code around its line and diff hunks, works in the immutable head snapshot with read-only base access, must cite `checked[]` lines, and returns `supported`, `refuted` (with a checkable `disproof`) or `inconclusive`, plus `origin: introduced | pre-existing | unknown`. A budget, quota or timeout stop leaves every unanswered candidate `inconclusive` with the stop as its reason; nothing is dropped without a disproof whose snapshot-qualified citation exists in the selected base/head | ADR 0027 decisions 2–4 and 8, with two reconciliations: the verdict words become the ones the owner asked for, and "true but not caused by this change" becomes `supported` + `pre-existing` instead of `refuted`, so a real pre-existing bug is shown under "Pre-existing" rather than hidden | amends draft 0027 (#138), see section 5 |
| 18 | **Report labels:** the sinks print the familiar words **Important** (severity `blocker` or `fix`), **Nit** (`consider` or `info`) and **Pre-existing** (origin `pre-existing`) in front of today's severity and topic label; the data keeps `severity`, `topic`, `confidence`, `origin` and `verification` as separate fields; a verified finding shows its reason and the lines checked | The owner asked for the familiar labels; ADR 0003's two axes stay the data model, the words are presentation | reuses 0003 |
| 19 | **`wachiman.review-result/2`:** adds the top-level `verification` block and the per-finding `origin` and `verification` fields, retypes the reserved `/1` `verification` stub, and ships with committed JSON output defaulting to `/1`, a pure `toResultV1()` downgrade (`--result-version 1`) that drops those fields and maps `provider.profile`. **No key is added to `/1`**: its root and `provider` object are `additionalProperties: false`, so an "additive" top-level key would fail every existing `/1` validator | The verifier implementation adds `verification` at the root; `docs/formats/README.md` says a new required-shape change is `/2`; pretending it is additive would break the one external consumer (`wachiman-benchmarks`) silently | 0030 (new) |
| 20 | **Named profiles do not change the result's `provider.profile` enum** in `/1` (`ci | default | isolated`): managed maps to `isolated`, external and built-in default to `default`; `/2` adds `provider.account` with the profile name, kind and rung | Keeps `/1` stable; `/2` carries the detail the preamble already prints | 0030 |
| 21 | **Working-tree review (slice 6):** `local --working-tree staged|all` reviews a stable snapshot (a temporary index/object database, filter-free content capture, `git write-tree` and raw blob materialization) against `HEAD`; `staged` is the current index, `all` adds unstaged tracked edits and deletions, excluding all untracked files; the synthetic head is the tree id and the result says `kind: "working-tree"` | The owner asked for explicit semantics now so the connector can grow without a second snapshot mechanism; ADR 0019 listed uncommitted changes as a non-goal and this reopens it deliberately, in a later slice | reuses 0019 (reopens its non-goal in slice 6) |
| 22 | **No automatic issue publication, no telemetry, no update check, no uninstall command** in this design: removal is `npm uninstall -g wachiman`, `wachiman skills uninstall` and a documented `rm` of `~/.wachiman` | The owner wants the minimal coherent set, not every conceivable command; an update check is a network call the local promise forbids unless asked, and none was asked | — |

## Open questions

Each has the default the plan uses. They are defaults needing validation, not user decisions.

1. **Does `init` chain into `setup` when the answer is "this machine only" or "both"?** Default:
   yes, interactively, after an explicit confirm ("Run `wachiman setup` now? [Y/n]"); with
   `--yes` or without a TTY it prints the `setup --profile <name>` line instead and exits 0.
2. **Which `claude` version first reports `configDirectory` in `auth status`?** The draft read
   2.1.268 from the CLI reference. Default: treat the field as required for `external` profiles;
   an older binary makes an external profile `unverified`, which decision 8 turns into exit 2 for
   a review and a failed required auth check for `doctor`. **Probe before slice 0 ships** (section 8).
3. **Is `--no-compile-autoload-*` available on the Bun version CI pins (1.3.4)?** Read in Bun's
   compiler docs on 2026-11-08, not tried. Default: the Windows slice pins the first Bun that has
   both flags and `doctor` prints the Bun version the launcher found.
4. **Base evidence delivery.** Default: when verification has candidates, the connector
   materialises the immutable base once per review, lazily, alongside the existing head snapshot.
   The provider receives read-only access to both through the existing allowed-directory
   mechanism. Removed/renamed code can then be cited at `base` as well as `head`. If base evidence
   cannot be made available, mark origin `unknown`; absence of a nearby changed line is not proof
   of pre-existence. Snapshot files remain data and are never executed.
5. **Package `files` for the Windows executable's embedded assets.** Default: the executable
   embeds `src/providers/claude-code.settings.json`, `skills/`, `templates/` and the version with
   `--asset` and a `--define`; the npm package needs none of that because it ships the files.
6. **Release-please component rename.** Default: `package.json` `name` becomes `wachiman`; the
   component stays `agent-review`, mapped in `release-please-config.json`, so tags and the
   changelog do not change. Verify against release-please's documentation at implementation.

## Out of scope

- A hosted service, a Wachiman-held key, telemetry, an update check, crash reporting.
- Compiled binaries for macOS or Linux, Homebrew, winget, Scoop, Docker.
- The GitHub App, the ledger, the panel (#135's other parts); the reader/judge split and the
  local index (#79, #80); spend tiers (#90).
- Reading, copying, caching or moving any Claude credential, token, `.claude.json` or Keychain
  item; supporting a `claude` that is a shell function, alias, `.cmd`/`.bat`/`.ps1` shim or
  wrapper script.
- Any change to the batch prompt, the data-path questions or the evidence step.
- A competitive cost or quality claim for the verifier: arm 2 of the Martian plan measures it;
  this design only makes the measurement run the product.
- A claim that every `claude -p` use is compliant unconditionally: section 4 states the exact
  conditions this design relies on and what would break them.
- Publishing or editing GitHub issues from the CLI.

## Failures this must protect against

Input for tests. Each names the mechanism.

- **Code goes to the wrong Claude account.** `resolveProfile` is one pure function with a table
  test over every combination of flag, binding, variable and default; it prints the profile, its
  kind, its directory, its binary and the rung before any call; an unresolvable, unconfirmed or
  signed-out profile is exit 2 before any call; no code path substitutes another profile.
- **The bash wrapper makes `WACHIMAN_PROFILE` beat a binding.** Slice 0 removes the translation
  from `bin/wachiman`; an integration test runs the wrapper with a binding and a conflicting
  exported variable and asserts the binding wins (fake provider, no call).
- **A repository chooses the binary or the account.** A fixture repository with
  `.wachiman.json`, `.wachiman/config.json` and a `package.json` `wachiman` key naming another
  binary and profile has no effect on resolution; the spawned path is the profile's.
- **A `bunfig.toml` or `.env` in the reviewed repository reaches the engine.** The Node launcher
  passes `--no-env-file --config=<pkg>/bunfig.toml` (test: the launcher's argv); the Windows
  executable is built with the two `--no-compile-autoload-*` flags and smoke-tested from a
  directory holding a sentinel `preload` and a sentinel `.env`.
- **A `.cmd` shim or a relative path is stored as the binary.** `profile add` and `setup` refuse
  them with the documented message; the resolver refuses a stored value that is not an absolute
  existing executable at run time too (the file may have moved).
- **Secrets are read by mistake.** `doctor`, `profile` and `setup` open exactly one file inside a
  managed profile (`settings.json`, today's inspection) and nothing inside an external one; a
  test with an injected `read` records every path opened.
- **A corrupt or half-written config is read as empty.** The reader validates `version`, the
  shape and every path; any problem is exit 2 naming the file and the field; writes go through a
  lock and a temp-file rename.
- **Two `setup` runs lose each other's entries.** Read-modify-write under the lock; a test runs
  two writers concurrently and asserts both projects are present.
- **`doctor` claims the account check was offline.** The JSON row for the auth check carries
  `networkObserved: "unknown"`; the text says "Wachiman made no network request; what `claude
  auth status` does is not observed". A test asserts the string.
- **`init` overwrites a workflow someone edited.** Without `--force` an existing target is exit 2
  with a diff-free message; with `--force` the previous file is copied to
  `<name>.yml.bak-<timestamp>` first; `--dry-run` writes nothing and prints the file.
- **A prompt hangs in CI or under an agent.** Non-TTY stdin or stdout, or `CI=true`, or `--yes`,
  disables every prompt; a missing mandatory value is exit 2 with the flag's name.
- **The verifier drops a real bug on a bare "refuted".** `applyVerdicts` drops only with a
  `disproof` whose snapshot-qualified path and line exist (the existing branch checks head references; base/head qualification is planned here);
  everything else degrades to `inconclusive`.
- **The verifier hides a pre-existing real bug.** `supported` with `origin: pre-existing` is kept
  and listed under "Pre-existing"; it is never a drop.
- **A budget or quota stop silently un-verifies.** Every candidate without a usable verdict gets
  `inconclusive` with `reason: "not verified: <stop>"`; the footer says how many.
- **A `/2` result is handed to a `/1` reader.** `--result-version 1` (the committed-review default) runs `toResultV1()`, which
  is tested to validate against `review-result.v1.schema.json`; the history store reads both.
- **The Windows build is called supported because it compiled.** The tier is in the release
  notes and in `doctor`; promotion needs the Windows rows green on `windows-latest`.

## Acceptance criteria

Each is a predicate someone can check and becomes a `## Proof` row in the shipping PR. **None has
run.** Rows marked **(win)** are the Windows promotion rows.

Accounts and bindings:

- [ ] `wachiman profile add work-a --config-dir <abs> [--binary <abs>]` writes one entry to
      `~/.wachiman/config.json` (mode `0600`), refuses a relative path, a missing directory, a
      non-executable file, a `.cmd`/`.bat`/`.ps1` path and the names `default` and `isolated`;
      it opens no file inside the directory.
- [ ] `wachiman profile create personal` behaves as today's `--setup-profile personal` and
      registers a `managed` entry; `--setup-profile` still works and prints the new spelling.
- [ ] `wachiman profile login work-a` spawns the profile's binary by path, no shell, with
      `CLAUDE_CONFIG_DIR=<dir>` and `buildChildEnv`'s subscription environment, from an empty
      temp directory, `stdio: inherit`; it never reads the outcome.
- [ ] `wachiman setup --profile work-a` in a clone writes a binding keyed by `repositoryKey`;
      a second clone and a `git worktree` of the same `origin` resolve to the same profile;
      `wachiman project show` prints the profile and the rung; `project unbind` removes it.
- [ ] Without a TTY and without `--profile`, `wachiman setup` exits 2 and writes nothing.
- [ ] The precedence table is a table test over every combination; with a binding to `work-a`
      and `WACHIMAN_PROFILE=personal`, `wachiman local` prints
      `profile: work-a (external, <dir>; chosen by project binding; WACHIMAN_PROFILE=personal ignored)`.
- [ ] `bin/wachiman` (bash) no longer appends `--profile`; the integration test above passes
      through the wrapper.
- [ ] `--profile isolated:personal` and `--profile personal` select the same managed profile when
      `~/.wachiman/claude-personal` exists and no entry is registered; nothing is moved.
- [ ] A profile whose directory is missing, whose binary does not answer `--version`, or whose
      `claude auth status` is not a confirmed `claude.ai` sign-in stops `local` with exit 2 before
      any model call; a test asserts no provider call was attempted.
- [ ] A corrupt `config.json` (invalid JSON, wrong `version`, relative path) stops `local`,
      `setup`, `doctor` and `profile` with exit 2 naming the file and field.
- [ ] Two concurrent `setup --profile` writes on different repositories keep both bindings.
- [ ] The fixture repository with planted configuration files has no effect on resolution.

Doctor:

- [ ] `wachiman doctor` exits 0 when a review would start and 1 otherwise; `--json` prints one
      document with every check, status, evidence and fix; no model call is made.
- [ ] The auth row's JSON has `networkObserved: "unknown"` and the text never says "offline".
- [ ] `doctor` reports: version and install kind (`npm`, `source`, `exe`); Bun version (launcher
      and source) or "embedded" (exe); platform and tier; `git`; `tar`; the resolved profile with
      kind, directory, binary path and `--version`; the `auth status` result (`authMethod`,
      `configDirectory` match or `unverified`); `ANTHROPIC_API_KEY` present as a failure;
      `CLAUDE_CONFIG_DIR` exported as a notice for `default`; the project binding and rung.
- [ ] `doctor --profile <name>` checks one; `doctor --all-profiles` checks each.

Setup and init:

- [ ] `wachiman setup` on a TTY lists registered profiles with the default marked, offers to
      register an external directory or create a managed one, shows name, kind, directory,
      binary and repository scope before saving, saves only the binding, ends with the doctor
      summary and the `wachiman local` line, and makes no model call.
- [ ] Escape or Ctrl-C before the final setup/workflow save exits 130 with no pending config
      changes; cancellation after an explicit completed write/login reports those effects accurately.
- [ ] `wachiman init --mode github --operator me --dry-run` prints the rendered workflow and
      writes nothing; without `--dry-run` it writes `.github/workflows/wachiman-review.yml`
      with `operator: me` and the bundled known-published workflow ref; a second run without `--force` exits 2; with
      `--force` a `.bak-<timestamp>` copy exists.
- [ ] `wachiman init --mode local` writes no file under `.github/` and prints the `setup` line.
- [ ] Without a TTY, `wachiman init` without `--mode` exits 2; `--mode github` without
      `--operator` exits 2.

Review motor and report:

- [ ] `wachiman local --verify --format json --result-version 2` writes `wachiman.review-result/2` with a
      `verification` block and per-finding `origin` and `verification`; it validates against
      `review-result.v2.schema.json`.
- [ ] `--result-version 1` writes a document that validates against `review-result.v1.schema.json`
      and contains no `verification`, `origin` or `account` key.
- [ ] A fake-provider test: three candidates return `refuted` with an existing disproof,
      `refuted` with a non-existent line, and `supported` with `origin: pre-existing`; the report
      drops the first, degrades the second to `inconclusive`, and lists the third under
      "Pre-existing" with its reason and checked lines.
- [ ] A fake-provider test where the verifier call stops on budget: usable returned verdicts
      survive; only unanswered candidates are `inconclusive` with `reason` starting `not verified:` and the footer counts them.
- [ ] The terminal and Markdown sinks print `Important`, `Nit` or `Pre-existing` before the
      severity and topic label; the GitHub review groups "Pre-existing" findings in the body.
- [ ] `test/parity.test.ts` still shows GitHub and local building the same prompt for the same
      change, with the verifier on in both.

Distribution:

- [ ] `npm pack` of this repository yields a tarball whose `bin` is `bin/wachiman.js`, whose
      `files` include `src/`, `skills/`, `templates/`, `bunfig.toml` and `LICENSE`, and no
      `node_modules`.
- [ ] On a clean container with Node and Bun, `npm i -g <tarball>` then `wachiman --version`
      prints the version and `npx wachiman doctor --json` runs; without Bun the launcher prints
      the Bun install line and exits 2.
- [ ] The launcher's argv to `bun` begins `--no-env-file --config=<pkg>/bunfig.toml <pkg>/src/cli.ts`
      and the launcher sets or unsets no environment variable (unit test on the pure argv
      builder).
- [ ] The publish job uses npm trusted publishing (no `NPM_TOKEN` secret), `needs:` the CI job on
      the tagged SHA, and the package page shows provenance.
- [ ] `wachiman skills install` copies both skills into `~/.agents/skills` and every Claude
      config directory the script covers today, refuses `~/.wachiman`, and `skills uninstall`
      removes only what it installed (marker file).

Windows executable (**(win)**, promotion rows for decision 3):

- [ ] `bun build --compile --target bun-windows-x64 --no-compile-autoload-dotenv --no-compile-autoload-bunfig`
      produces `wachiman.exe`; `wachiman.exe --version` prints the release version; `local --help`
      run from a directory with a sentinel `bunfig.toml` `preload` and a sentinel `.env` shows
      neither effect.
- [ ] `wachiman.exe local --input <fixture> --repo-dir <fixture clone>` with the fake provider
      produces the same `ReviewResult` as `bun src/cli.ts` on Linux, with forward-slash paths in
      every finding.
- [ ] The executable writes the embedded settings JSON to a temp file, passes it as
      `--settings`, removes it after the call; the bytes equal
      `src/providers/claude-code.settings.json` at the build commit.
- [ ] `bun test` passes on `windows-latest` for the suites that need no real `claude`.
- [ ] Ctrl-C during a fake-provider run exits 130 and removes the snapshot directory.
- [ ] A profile with `--binary C:\...\claude.exe` runs; `claude.cmd` is refused.
- [ ] One real `local` run on the owner's Windows machine, recorded with the Claude Code version
      (the owner's decision when; the only paid row).

## 1. What I understood, and the assumptions

The owner wants: keep `local`, `history`, `--commit`, `--from`; a real install through npm that
may require Bun, plus a standalone Windows executable; a guided `init` like Laqi's and Astro's
(visible defaults, cancellation, preview, explicit overwrite) that can generate the maintained
Actions YAML, while a local-only choice writes none; a `setup` that binds a project on this
machine to one of several Claude accounts, two of which live in custom configuration directories
and one of which may need an explicit binary path; a `doctor` that explains resolution,
dependencies and sign-in without a model call; one review motor for GitHub and local with a
verifier that reads code, not summaries; the familiar Important/Nit/Pre-existing words on the
report with severity, origin and verification encoded separately; an explicit format migration;
and the documents sufficient to implement, not another list of options.

Assumptions, each marked:

- *Assumption:* the two work accounts are already signed in through the official `claude` in
  their own directories. Their names and paths are placeholders here; no private directory was
  read or listed.
- *Assumption:* "Windows" means native Windows (PowerShell, Git for Windows); WSL is covered by
  the Linux path and is not the end state.
- *Assumption:* the owner's "Important / Nit / Pre-existing" are display words, not a replacement
  of ADR 0003's severity and topic axes. If the owner meant to replace the axes, that is a new ADR
  superseding 0003, and this design does not make it.
- *Assumption:* the verifier implementation in the `findings-verifier-impl` worktree is the code
  that will merge (PR #138's design and branch `feat/findings-verifier:src/verify.ts`); this design reconciles
  with it rather than inventing a parallel verifier.

## 2. What the repository already says, and how this reconciles with it

- **ADR 0001** deferred npm and named provenance as the thing to design with it. Taken up here
  through trusted publishing (draft 0026 already did; kept).
- **ADR 0002** chose Bun and zero dependencies. Decision 1 keeps both; decision 2's launcher is
  one dependency-free file, decision 14 refuses `@clack`.
- **ADR 0019** decisions 4 and 5 (subscription adapter; the promise "no telemetry, no GitHub
  request; the code goes to the developer's configured Claude account") are kept word for word.
  Its non-goal "uncommitted changes" is reopened deliberately by decision 21, in a late slice.
- **ADR 0020**'s `repositoryKey` is reused for bindings (decision 6).
- **ADR 0023** kept the package name `agent-review` because nobody typed it; draft 0026 already
  drops that non-goal; kept.
- **Draft ADR 0026 (#135, unmerged):** decisions 1 (package `wachiman`, trusted publishing),
  3 (`skills install`) and 5 (zero dependencies) are **kept**. Decision 2 ("`npx` unsupported")
  is **replaced** by the Node launcher of decision 2 here. Decision 4 ("the script stays one
  release, then goes") is **replaced** by decision 4 here (the source path stays). Its rejected
  alternative "compiled binaries" is **partly reopened**: a Windows executable only, as a second
  artifact, because the owner asked for it; macOS and Linux binaries stay rejected. ADR 0028
  records this; if #135 merges first, 0026's Status line gets a pointer to 0028, and if 0028
  merges first, #135's rebase adds it.
- **Draft ADR 0027 (#138, unmerged) and its implementation:** kept entirely except the verdict
  vocabulary and the treatment of "not caused by this change" (section 5). ADR 0030 and the plan
  name the exact renames so the implementation branch and this design converge in one place.
- **`docs/formats/README.md`:** "Removing, renaming or retyping a field … is `/2`". The reserved
  `/1` `ResultFinding.verification: { checked: string; example?: string }` is retyped by the
  verifier, so `/2` is the honest version.
- **`src/history/store.ts`:** `HISTORY_RUN_FORMAT = "wachiman.history-run/1"` embeds a result;
  the reader will accept a `/2` result inside it (internal format; the plan says how).
- **`skills/wachiman-review/SKILL.md`** lists profiles with `ls -d ~/.wachiman/claude-*` and
  relies on the wrapper's `WACHIMAN_PROFILE` translation. Both change: it calls
  `wachiman profile list --json` and `wachiman project show --json`, and passes nothing when a
  binding exists.
- **No `docs/roadmap.md` exists**; the backlog label holds #134 and #137 on this topic.
- **Hub:** `conventions/tool-doctor-pattern.md` shapes `doctor` (declare, check, never install;
  presence, version, access; one check that proves the chain; non-zero exit). No hub page covers
  multi-account Claude Code or interactive CLI wizards; the reusable parts of sections 3 and 4
  are candidates for a hub page after the first release.

## 3. The install surfaces

| Surface | How it runs | Who it is for | Status |
| --- | --- | --- | --- |
| `npm i -g wachiman` / `npx wachiman` | Node launcher → `bun --no-env-file --config=<pkg>/bunfig.toml <pkg>/src/cli.ts` | every user with Bun installed, all three OSes | planned (slice 4) |
| `wachiman.exe` from GitHub Releases | compiled Bun executable, assets embedded | Windows users without Bun; the owner's Windows machine | planned (slice 5), tier "built and smoke-tested" |
| `bin/wachiman` from a clone, `scripts/install-local.sh` | bash wrapper → `bun … src/cli.ts` | contributors running unreleased source | implemented today; wrapper loses the profile translation in slice 0 |
| Reusable workflow `niway-dev/wachiman/.github/workflows/review.yml@vX` | the engine's own checkout on the runner | GitHub Actions consumers | implemented today; unchanged |

The launcher's one job is to make the install portable; it never changes the environment, never
translates a variable into a flag, and never downloads anything. Its argv builder is a pure
function (`launcherArgs(pkgDir, argv)`) so the isolation flags are tested without spawning.
Bun missing: it prints `wachiman needs Bun 1.3 or later: https://bun.sh` and exits 2.

The Windows executable needs three source changes, each small: the version comes from a
build-time define with `readVersion()` as the source fallback; the settings JSON is imported with
`{ type: "file" }`, written to a `0600` temp file per call and removed with the scratch directory;
templates and skills are read through `Bun.embeddedFiles` when `import.meta.dir` starts with
`/$bunfs/`. None of this changes behaviour under `bun src/cli.ts`.

## 4. Accounts, sign-in and the compliance line

### 4.1 What Anthropic's page says (read 2026-11-09)

The [official policy](https://code.claude.com/docs/en/legal-and-compliance) distinguishes
ordinary end-user subscription use through the official binary from third-party collection or
intermediation of account credentials. It also states conditions for embedding/running Claude
Code in products. The design uses that documented distinction; it is not a product-specific
approval from Anthropic and does not establish that every usage volume or deployment is allowed.

### 4.2 Where this design stands, and what it does not claim

The local mode is a developer running the official, unmodified `claude` on their own machine
with their own subscription, from a tool that never sees the sign-in. Concretely:

- Sign-in completes through Anthropic's own flow: `profile login` starts the official binary and
  the developer logs in inside it. Wachiman never reads `.credentials.json`, `.claude.json` or
  the Keychain, never receives a token, and stores only a directory path and an optional binary
  path.
- Wachiman does not offer "Claude.ai login into its own application": there is no Wachiman login,
  no Wachiman server, no request routed through anyone else's plan.
- The GitHub Action keeps the API key: Wachiman never puts a plan credential on a runner, and
  `local` refuses `ANTHROPIC_API_KEY` so a run is never billed to a key by accident.
- The only authentication check is `claude auth status`, a documented command of the binary that
  prints its own view of the sign-in. Wachiman treats it as the single source of truth and never
  "confirms" an account by other means.

What this design does **not** claim: that `claude -p` on a subscription is permitted for every
volume or purpose ("ordinary, individual usage" is Anthropic's wording for the advertised
limits), that the page cannot change, or that a shared or employer-managed `CLAUDE_CONFIG_DIR`
is the developer's to use. `doctor` prints the page's URL in its header line so the person
running it can read the current text. If the page changes to forbid this shape, the local mode's
`subscription` auth is the one switch to turn off (ADR 0019's reopen condition).

### 4.3 The profile model

Terms: a **profile** is a name, a kind, a Claude configuration directory and an optional binary
path. `default` is not a record: the shell's `claude`, with whatever `CLAUDE_CONFIG_DIR` the
environment has (today's behaviour). A **managed** profile is a directory Wachiman created under
`~/.wachiman/claude-<name>` and keeps as a bare sign-in (today's `isolated`; the populated check
stays because the report says "isolated"). An **external** profile is a directory the developer
already uses for an account; Wachiman itself never opens credential files or writes configuration into it; the official
Claude process may read/write its own state, which setup must disclose; the report never calls it isolated. A **binding** is the profile a repository uses,
stored in the home directory under the repository identity.

The config file, resolution, the auth check contract, the lock and the strict-failure rules are
specified exhaustively in the [types document](2026-11-09-review-and-config-types.md) (sections
"Account configuration" and "Security invariants") and the
[command contract](2026-11-09-cli-command-contract.md) ("Profile resolution").

### 4.4 Isolation claims per kind

| Kind | Populated check | What the report says | Hardening flags |
| --- | --- | --- | --- |
| `default` | none | today's text: your own `claude` and its configuration; CLAUDE.md, skills, hooks, MCP servers and connectors were shown not to reach the review on 2026-11-04; plugins untested | all |
| managed | refused if populated (today) | today's text: a profile that holds only a sign-in | all |
| external | none | `external profile <name> (<dir>): a directory you also use interactively; the same harness result applies; plugins untested` | all |

## 5. One review motor, and the verifier as a falsifier

### 5.1 The pipeline, shared

```
connector (githubReviewInput | buildLocalInput | workingTreeInput*)   → ReviewInput
  → filterFiles → planBatches → one claude -p per batch, riskiest first (bounded coverage)
  → mergeOutputs → enforceConfidenceRule → dedupeFindings
  → selectCandidates (severity > info)
  → materialise base once if needed → buildVerifyPrompt (candidates + base/head snippets + hunks)
  → one claude -p (VERIFY_SCHEMA, reserve budget, Read/Glob/Grep, no sub-agents)
  → applyVerdicts (drop only with an existing disproof; else degrade; origin recorded)
  → enforceConfidenceRule → anchors → ReviewResult (/2)
  → sink (githubReview | terminal | markdown | json)
```

`*` planned, decision 21. Everything from `filterFiles` to `ReviewResult` is one function,
`reviewChange`, called by both modes with the same `ReviewOptions`; the modes pass different
`provider` auth (`api-key` or `subscription`), a different connector and different sinks. No mode
has its own loop, retry policy or budget logic.

### 5.2 What the verifier is and is not

It is a **hypothesis falsifier**: each candidate finding is a claim about specific lines; the
verifier reads those lines in the immutable head snapshot, the immutable base snapshot made
available read-only, the hunks that changed them, and anything else it needs with Read/Glob/Grep, and tries to prove the claim
wrong. It does **not** read batch summaries or the reviewer's prose as evidence (ADR 0009); it
must list `checked[]` lines; its `reason` is a brief evidence-linked explanation shown to the developer, not private chain of thought; it never adds a finding; it runs once per review with its own reserve budget
(`verify_budget_usd`, at most half the total), its own model (`verifier_model`, default
`claude-opus-5-5`, effort `high`), and the same `--restricted --strict-mcp-config --tools
Read,Glob,Grep` restrictions as a batch, so it cannot spawn agents or run code.

### 5.3 Reconciliation with the implementation in `findings-verifier-impl`

| Implementation today (`feat/findings-verifier:src/verify.ts`) | This design | Why |
| --- | --- | --- |
| `VERDICTS = ["refuted", "confirmed", "unconfirmed"]` | `["supported", "refuted", "inconclusive"]`; `confirmed → supported`, `unconfirmed → inconclusive` | The owner's words; one vocabulary everywhere (schema, JSON, report) |
| `refuted` covers both "the claim is false" and "this change neither causes it nor makes it reachable" | `refuted` is "the claim is false for this code"; a true claim the change did not introduce is `supported` with `origin: "pre-existing"` | A real pre-existing bug is information the author wants under "Pre-existing", not a dropped finding |
| No `origin` | `VerifierVerdict.origin?: "introduced" \| "pre-existing" \| "unknown"`; missing or unsupported attribution remains `unknown` | Separate encoding of origin, as the owner asked |
| `status: "verified" \| "failed" \| "nothing"` with `entries: []` on `failed` | `status: "verified" \| "partial" \| "failed" \| "nothing" \| "skipped"`; usable verdicts survive, and only unanswered candidates get an `inconclusive` entry with `reason: "not verified: <stop>"` | A stop must not erase the statuses; the owner asked for preserved unverified statuses |
| `ResultVerification` added at the root of a `/1` result | the same block at the root of a `/2` result; `toResultV1()` removes it | The `/1` root is closed (`additionalProperties: false`) |
| Per-finding outcome only in `entries` | also on the finding: `verification: { status, reason, checked, disproof? }` and `origin` | The sinks render per finding without joining on ids |
| `--verify` / `AGENT_REVIEW_VERIFY` off by default | on by default, `--no-verify` and `AGENT_REVIEW_VERIFY=0` turn it off | The owner turned it on before the arm 2 gate (ADR 0027 amendment, 2026-11-09) |

Reuse the candidate selection, budget reserve, fail-open policy and reporting structure from
the existing branch. Extend its evidence validation to snapshot-qualified citations and causal
origin attribution as specified in the types contract; do not treat the original head-only
check as a complete implementation of this design.

### 5.4 Labels

The data model is ADR 0003's two axes plus confidence, now plus `origin` and `verification`. The
display adds one word in front, computed by one function `tierWord(finding)`:

| Word | Rule |
| --- | --- |
| `Pre-existing` | `origin === "pre-existing"` (checked first) |
| `Important` | severity `blocker` or `fix` |
| `Nit` | severity `consider` or `info` |

Terminal and Markdown: `Important · 🟠🐛 Fix · bug: <title> (confidence high, supported)`.
GitHub: inline comments keep today's label with the word prefixed; `Pre-existing` findings go in
the body under "### Pre-existing", not inline, so the author's diff is not annotated for code they
did not write. A finding with `verification.status === "inconclusive"` shows `(inconclusive)` and,
when severity is `fix` or above, is rendered in an explicitly inconclusive section, with actionable high-severity assertions
softened through the confidence rule. Do not label uncertainty as a verified Nit.

## 6. Setup, init and doctor: the wizard shape

One pattern for both wizards, taken from Laqi:

```
parse<Cmd>Args(argv) → Raw<Cmd>Flags            pure; unknown flag → usage error
interactive = !flags.yes && stdin.isTTY && stdout.isTTY && env.CI !== "true"
if interactive: promptFor<Cmd>(flags, io) → Raw<Cmd>Flags | null (cancelled → exit 130)
resolve<Cmd>Options(flags, context) → { ok, options } | { ok: false, error }   pure
run<Cmd>(options, deps)                       the only impure half; writes under confirm
```

Prompts are built on `node:readline` (`createInterface`, `question`, raw-mode key read for
Escape), numbered choices with the default marked `(default)`, text inputs showing the default in
brackets, a confirm before every write that shows exactly what will be written and where. The
screen handling is deliberately plain (one question at a time, no repaint), which avoids the
cursor arithmetic Laqi moved to `@clack/core`, and keeps ADR 0002's zero dependencies. If plain
readline proves too poor in practice, adopting `@clack/core` is a one-line ADR 0002 amendment, not
a redesign; the resolver boundary makes the swap invisible to tests.

The [command contract](2026-11-09-cli-command-contract.md) gives every question, its default, the
flag it maps to, and the non-TTY rule. `doctor`'s checks are declared as data in
`src/doctor/checks.ts` and listed in the types document.

## 7. Staged delivery

Slices, each one pull request with its own proof table, ordered by risk (account selection first,
packaging last). The completed implementation plan is retained in git history.

0. Account model: config store, resolver, wrapper fix, `profile`, `project show|unbind`,
   `setup --profile`, `doctor` core. Runs through `bin/wachiman` as today.
1. Wizards: readline prompts, `setup` interactive, `init` with templates, dry-run and overwrite.
2. Result `/2`, labels and origin, verifier reconciliation and `--verify` for `local`
   (depends on #138's implementation merging or being folded in).
3. Skills as a subcommand and skill text updates.
4. npm packaging: launcher, `package.json`, release publish job, docs.
5. Windows executable: source changes, build job, smoke rows, tier.
6. Working-tree review (`--working-tree`), after 0–2.

## 8. Probes to run before or during slice 0 (facts nobody has checked)

- Which Claude Code version first prints `configDirectory` in `claude auth status --json`, and
  whether the flag is `--json` or the default output. Run against the pinned CI version and the
  owner's local version; record both.
- Whether `claude auth login` exists on the pinned version, or `profile login` must fall back to
  the interactive `claude` plus `/login` (today's `setupProfile`).
- Whether `bun build --compile` on Bun 1.3.4 accepts `--no-compile-autoload-dotenv` and
  `--no-compile-autoload-bunfig` (read in docs, not tried).
- Whether npm's Windows shim for a `#!/usr/bin/env node` launcher passes arguments with spaces
  intact (`cmd-shim` behaviour); the launcher test on `windows-latest` answers it.
- Whether `wachiman-benchmarks`' `pair.ts` validates results against `/1` strictly (it is the
  one known external consumer of the JSON).
- Whether `wachiman` is still free on npm (404 on 2026-11-07 per #135).

## 9. Sources

- Claude Code, Legal and compliance: https://code.claude.com/docs/en/legal-and-compliance
  (quoted in section 4; read 2026-11-09).
- Claude Code, CLI reference (`auth login|status`, `--settings`, `--restricted`,
  `--strict-mcp-config`): https://code.claude.com/docs/en/cli-reference (read for the 2026-11-08
  draft; `configDirectory` version to re-verify).
- Claude Code, Authentication (several accounts with `CLAUDE_CONFIG_DIR`, credential storage per
  OS): https://code.claude.com/docs/en/authentication
- Bun, single-file executables: https://bun.com/docs/compiler/executables (autoload flags,
  `--asset`, `Bun.embeddedFiles`, `/$bunfs/`, Windows targets; read 2026-11-08, not tried).
- npm, trusted publishers: https://docs.npmjs.com/trusted-publishers
- Laqi, `apps/cli/src/init/{args,options,prompt,run}.ts` (the one-resolver pattern; read
  2026-11-09).
- general-knowledge hub, `conventions/tool-doctor-pattern.md`.
- This repository at `b3f60be` and the branches `design/three-modes` (#135),
  `design/findings-verifier` (#138), branch `feat/findings-verifier` (`src/verify.ts`, read by git show).


## 10. Review and implementation boundary

Fable wrote the first implementation-spec draft; the parent reviewed and reconciled the command,
wire-format and ADR contracts against the source and feat/findings-verifier. The review record is
[here](../audits/2026-11-09-cli-spec-review.md). Only documents changed. All runtime acceptance
rows remain unchecked; no install, compilation, auth subprocess or model review was executed.
Exact compiler flags, Windows end-to-end behaviour and npm publishing prerequisites remain
implementation probes, not unsettled product scope. When a mechanism fails a probe, document
its concrete replacement under the same accepted requirement; do not silently omit the feature.
