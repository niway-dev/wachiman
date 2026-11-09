# Plan: the Wachiman CLI and verified reviews

- **Status:** working document, 2026-11-09. Implements
  [the canonical design](../specs/2026-11-09-cli-and-verified-reviews-design.md) through the
  [command contract](../specs/2026-11-09-cli-command-contract.md) and the
  [types](../specs/2026-11-09-review-and-config-types.md). The shipping pull request of the
  last slice deletes this file; git keeps it.
- **Nothing here has been built, run or tested.** Each slice is one pull request with a
  `## Proof` table whose rows are the acceptance criteria of the design that the slice covers.
- **Rules for every slice:** TypeScript on Bun, no runtime dependency (ADR 0002); tests are
  behaviour tests of the public functions named, not mirrors of private ones; every `spawnSync`
  is injectable; no model call in any test; English in code, comments, commits and docs.

## Order and dependencies

```
0 account model + doctor core ──┬── 1 wizards (setup interactive, init)
                                ├── 3 skills subcommand
                                └── 4 npm packaging ── 5 Windows executable
#138 (verifier impl) ──────────── 2 result /2, labels, verifier reconciliation, local --verify
0 + 2 ─────────────────────────── 6 working-tree review
```

Slice 2 depends on the verifier implementation (`findings-verifier-impl` worktree, branch
`feat/findings-verifier`) being merged or folded into the same pull request. Slices 0, 1, 3, 4
do not depend on it. Slice 5 depends on 4. Slice 6 depends on 0 and 2.

## Slice 0: account model, resolver, wrapper fix, `profile`, `project`, `setup --profile`, `doctor`

Goal: account selection becomes a pure, tested function with a strict store; everything runs
through `bin/wachiman` and `bun src/cli.ts` as today.

Files:

| File | Change |
| --- | --- |
| `src/accounts/config.ts` (new) | `WachimanConfigV1`, `readConfig` (strict, types §1.2), `updateConfig` (lock + temp + rename, §1.3), `wachimanHome(env)` (`WACHIMAN_HOME` else `join(os.homedir(), ".wachiman")`) |
| `src/accounts/resolve.ts` (new) | `resolveProfile` (§1.4), `profileLine(resolved)` for stderr, name parsing (`default`, `isolated`, `isolated:<n>`, registered) |
| `src/accounts/confirm.ts` (new) | `confirmProfile` (§1.4): `--version`, `auth status`, timeouts, output caps, method rules, `networkObserved: "unknown"` |
| `src/accounts/commands.ts` (new) | `profile list\|create\|add\|login\|remove\|default`, `project show\|unbind`, `setup` non-interactive path; `--json` documents `ProfileList`, `ProjectShow` |
| `src/profiles.ts` | keep `inspectIsolatedProfile`, `populatedProfileError`, `setupProfile` (now also registers the managed entry); `parseProfile` becomes a thin adapter that returns a name for `resolveProfile`; `profileDir` uses `wachimanHome` |
| `src/doctor/checks.ts`, `src/doctor/run.ts`, `src/doctor/render.ts` (new) | `DoctorCheck[]`, `DoctorReport`, text and JSON renderers |
| `src/local.ts` | replace the isolated-profile block with `resolveProfile` + `confirmProfile`; print the `profile:` line; pass `configDir` and `binary` to the provider; map kind → `/1` `provider.profile` |
| `src/providers/claude-code.ts` | the constructor's `binary` option is used by the local mode for an external profile's path (no longer "for tests" only); `preflight` reports the path it will run |
| `src/cli.ts` | dispatch `setup`, `doctor`, `profile`, `project`; `--setup-profile` prints the alias notice; `readVersion` unchanged; `HOME` checks replaced by `wachimanHome` |
| `src/history/store.ts` | `historyRoot` uses `wachimanHome`; `repositoryKey` exported as is (reused for bindings) |
| `bin/wachiman` | delete env-to-flag translation and API-key stripping; all commands use the same in-process account/auth policy |
| `skills/wachiman-review/SKILL.md` | list profiles with `wachiman profile list --json`; read the binding with `wachiman project show --json`; pass `--profile` only when no binding exists |
| `docs/cli.md`, `docs/local-review.md` | the new commands, the precedence, the wrapper change; "Windows: not yet" stays |

Checks (behaviour tests, no mirrors):

- `resolveProfile` table test: every rung with a resolving value, a non-resolving value and no
  value; asserts the chosen profile, the rung, `overridden`, and the failure on the rung that
  failed (never a fall-through).
- `readConfig` over each corruption of types §1.2 → `corrupt` with the field named; absent →
  `absent`; unknown extra fields survive `updateConfig`.
- `updateConfig` with two concurrent writers (two Bun processes on one temp home) keeps both
  entries; a held lock past the timeout throws naming the pid.
- `confirmProfile` with a fake spawn: exit 1 → auth failure with the login fix; `api_key` →
  failure; missing `configDirectory` → `unverified`; mismatch → `differs`; records opened paths
  (none under the directory).
- `profile add` refusals: relative, missing, under `~/.wachiman`, `.cmd`, non-executable,
  reserved names, name collision with a managed directory.
- `profile remove` without `--delete-dir` leaves the directory; `--delete-dir` on external is a
  usage error.
- `setup --profile x` on a fixture repository writes the binding keyed by `repositoryKey`; a
  worktree of the same origin resolves to it; no file under the repository changes (fs
  recorder); without a TTY and without `--profile` → exit 2, no write.
- The planted-configuration fixture has no effect on resolution.
- `local` with a binding and `WACHIMAN_PROFILE` set prints the `profile:` line with the ignored
  value; an unconfirmed profile exits 2 before any provider call (fake provider asserts zero
  calls).
- Wrapper integration: run `bin/wachiman local --input <fixture> --repo-dir <clone>` with a
  binding and a conflicting `WACHIMAN_PROFILE` under a fake `claude` on `PATH` that records its
  `CLAUDE_CONFIG_DIR`; the binding's directory wins.
- `doctor --json` on a machine fixture: every row present; `auth` row has `networkObserved:
  "unknown"`; `ANTHROPIC_API_KEY` set → `fail`; exit codes 0/1.

Proof rows: the "Accounts and bindings" and "Doctor" criteria of the design.

## Slice 1: wizards (`setup` interactive, `init`)

Files:

| File | Change |
| --- | --- |
| `src/wizard/prompt.ts` (new) | `node:readline` prompts: `select(label, choices, defaultIndex)`, `text(label, default, validate)`, `confirm(label, default)`; Escape/Ctrl-C/Ctrl-D → `null`; `PromptIO` injectable |
| `src/wizard/interactive.ts` (new) | `isInteractive(flags, env, streams)` |
| `src/setup/args.ts`, `options.ts`, `prompt.ts`, `run.ts` (new) | Laqi's four files for `setup`: parse → prompt → resolve → run; the run calls slice 0's functions |
| `src/init/args.ts`, `options.ts`, `prompt.ts`, `render.ts`, `run.ts` (new) | the same for `init`; `renderCallerWorkflow`; `.bak` copy on `--force`; `--dry-run` |
| `templates/wachiman-review-caller.yml` | no change; the renderer finds `operator: EDIT-THIS-github-login` and `review.yml@v…` as anchors; a header comment line is added to the rendered output: `# Generated by wachiman init <version> on <date>; Actions is billed through the ANTHROPIC_API_KEY secret; local runs use your signed-in claude.` |
| `src/cli.ts` | dispatch `init`; `setup` gains the interactive path |
| `docs/install.md` | "Three steps" gains `wachiman init` as the first option, the manual copy stays |

Checks:

- `resolveInitOptions`: every flag combination; `--version` mandatory when DEFAULT_WORKFLOW_REF is
  absent; an unrelated/unreleased CLI version never becomes an Actions tag; `--path` outside `.github/workflows/` refused; operator regex.
- `renderCallerWorkflow` on the real template: both anchors replaced, nothing else changed (diff
  equals two lines plus the header); a template without an anchor throws.
- Scripted prompts (`PromptIO` with scripted input): registration+binding save atomically only
  after final confirmation; cancellation before save leaves config unchanged; completed login,
  managed-directory creation or a workflow write is accurately reported on later cancellation; defaults taken by Enter equal the printed defaults.
- `init --mode github --operator me --dry-run`: stdout is the rendered file, nothing written;
  existing target without `--force` → 2; with `--force` → `.bak-*` exists and the new file is
  written.
- `init --mode local` writes nothing under `.github/`.
- Non-TTY: `init` without `--mode` → 2; `--mode github` without `--operator` → 2; `--mode both`
  writes the workflow and prints the `setup` line.

Proof rows: "Setup and init" criteria.

## Slice 2: result `/2`, labels and origin, verifier reconciliation, `local --verify`

Depends on `feat/findings-verifier` (`src/verify.ts`, the `engine.ts`, `config.ts`, `formats.ts`,
`cost.ts` changes).

Files:

| File | Change |
| --- | --- |
| `src/verify.ts` | snapshot-qualified evidence, origin unknown unless substantiated, invalid/duplicate verdict reconciliation; rename `VERDICTS` to `supported \| refuted \| inconclusive`; `VerifierVerdict.origin`; prompt text: `refuted` = false claim; true-but-pre-existing = `supported` + `pre-existing`; `applyVerdicts` annotates findings with `origin`, `verification`, `tier` and returns `VerificationEntryV2[]`; unanswered selected candidates → `inconclusive`, `reason: "not verified: <stop>"` |
| `src/engine.ts` | lazily acquire/release immutable base snapshot once when verification has candidates; `verifyFindings`: `partial` status with `stop`; pass the stop into `applyVerdicts`; `tierWord(finding)`; `buildReview` prints the tier word and groups `Pre-existing` in the body |
| `src/formats.ts` | separate /1 and /2 format constants, /1 committed JSON default; `ReviewResultV2` types; `toResultV1` (pure, rejects working-tree /1); result reader accepts `/1` and `/2` on read |
| `docs/formats/review-result.v2.schema.json` (new), `docs/formats/README.md` | the schema; the table gains `/2`; the versioning text explains the bump |
| `src/sinks/common.ts`, `terminal.ts`, `markdown.ts`, `json.ts` | `plainLabel` prefixed with the tier word and `(… , <status>)`; a "Pre-existing" section; the verification reason and `checked` lines under each verified finding; `renderJson(result, version)` |
| `src/local.ts` | `--verify`/`--no-verify`, `--result-version`; `verify:` stderr line; a second `ClaudeCodeProvider` as `deps.verifier` on the same profile |
| `src/history/store.ts` | `writeRun` embeds `/2`; `readRuns` accepts `/1` and `/2` |
| `test/fixtures/formats/` | a `/2` example and its `/1` downgrade |
| `docs/cli.md`, `docs/reviews.md`, `docs/review-policy.md` | the labels, the verification line, the flags |

Checks:

- Fake-provider test: candidates `refuted` (existing disproof), `refuted` (bad disproof),
  `supported` + `pre-existing`, `supported` with severity one step down, no verdict; assert
  drop, degrade to `inconclusive` with `claimed: "refuted"`, `Pre-existing` section, severity
  move, and `inconclusive` for the unanswered one.
- Verifier call stop (fake provider returns `terminalReason: "budget"` with two verdicts):
  `status: "partial"`, every other candidate `inconclusive` with `not verified: budget`, footer
  counts.
- Verifier failure: `status: "failed"`, every candidate `inconclusive`, findings posted, footer
  line.
- `toResultV1(result)` validates against the `/1` schema (the repository's existing schema
  check in `formats.test.ts`); the `/2` output validates against the new schema.
- `--result-version 1` without `--format json` → 2.
- `test/parity.test.ts`: GitHub and local prompts equal with `verify` on in both.
- Terminal and Markdown snapshots show `Important · …`, `Nit · …`, `Pre-existing · …`.

Proof rows: "Review motor and report" criteria.

## Slice 3: `skills install|uninstall`

Files: `src/skills/install.ts` (new; copies, marker file, refusals), `src/cli.ts` dispatch,
`scripts/install-local.sh` (keeps linking skills for contributors; prints that package users run
`wachiman skills install`), `docs/local-review.md` §3.

Checks: copies land in every target directory of a fixture home; `~/.wachiman` refused; a copy
without a marker is left and warned; `uninstall` removes only marked copies.

## Slice 4: npm packaging and release

Files:

| File | Change |
| --- | --- |
| `bin/wachiman.js`, `bin/launcher-args.js` (new) | the Node launcher (contract §7); `launcherArgs` in `bin/launcher-args.js` so Node and Bun both import it, as a single dependency-free JS module shipped with the launcher and imported by Bun tests (no hand-duplicated implementation) |
| `package.json` and deterministic pack staging/manifest | `name: wachiman`, `bin`, `files`, `engines`, `publishConfig` (types §7) |
| `release-please-config.json` | component mapping so tags stay `vX.Y.Z` (design open question 6) |
| `.github/workflows/release.yml` (new) or a gated job in `release-please.yml` | on the release tag: `needs:` CI on the tagged SHA; `npm publish` with trusted publishing (`id-token: write`), npm CLI ≥ 11.5.1 |
| `src/cli.ts` | `readVersion()` accepts `name === "wachiman"` as well as `agent-review` |
| `src/install-kind.ts` (new) | `detectInstall`, `readAsset` (source and npm layouts; exe branch added in slice 5) |
| `README.md`, `docs/local-review.md` §3, `docs/releasing.md`, `docs/uninstall.md` | install through npm; Bun as a prerequisite; the contributor path; removal steps |

Checks: `launcherArgs` unit test; a container test (CI job) with Node and Bun: `npm i -g` of the
exact packed tarball, `wachiman --version`, and an npm exec invocation forced to that installed
artifact (no registry download); doctor runs against fixture dependencies; without Bun: exit 2 and the
install line; `npm pack --json` file list checked after explicit test-file exclusions.
Windows Node+Bun launcher and local fake-provider coverage must pass in this slice before npm
Windows is advertised. Move common Windows portability fixes (paths/env/temporary files) here
as needed; slice 5 verifies the additional compiled-executable path, not basic OS support.

Release gate: a workflow cannot use needs across workflow files. Use explicit verify jobs on
the tagged SHA in the same workflow (or a reusable verify workflow), and ensure release-please
credentials actually trigger the tag event; GITHUB_TOKEN-created events do not chain normally.
Publishing authority and provenance come only after artifact tests. Check the packed npm files,
not merely the source tree. No registry write is part of the implementation test run.

Proof rows: "Distribution" criteria.

## Slice 5: Windows executable

Files:

| File | Change |
| --- | --- |
| `src/cli.ts` | version from `WACHIMAN_VERSION` define when present |
| `src/providers/claude-code.ts` | settings imported `with { type: "file" }` in the exe branch; written to a `0600` temp file per call; removed in the same `finally` as the scratch directory |
| `src/install-kind.ts` | exe branch: `Bun.embeddedFiles` |
| `src/connectors/local-git.ts`, `src/evidence.ts`, `src/contracts.ts` | repository-relative paths through `path.posix`; OS paths through `path` (the W6 row of the 2026-11-08 draft) |
| `src/providers/claude-code.ts` | per-platform child allowlist (`USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `SystemRoot`, `TEMP`, `TMP`, `USERNAME`, `PATHEXT`, `ComSpec` on win32), each name justified in a comment and added only when the Windows harness fails without it |
| `.github/workflows/release.yml` | `windows-latest` job: `bun build --compile --target bun-windows-x64 --no-compile-autoload-dotenv --no-compile-autoload-bunfig --define WACHIMAN_VERSION=…`, smoke rows, `SHA256SUMS`, `actions/attest-build-provenance`, asset upload |
| `.github/workflows/ci.yml` | `bun test` on `windows-latest` for suites that need no real `claude` |
| `README.md`, `docs/local-review.md` | the tier table; "Windows: built and smoke-tested; WSL is the supported path meanwhile" |

Checks: the Windows rows of the design's acceptance criteria. Promotion to "supported" is a
later docs-only pull request that cites the green rows.

## Slice 6: working-tree review

Files: `src/connectors/local-git.ts` (`workingTreeInput`: temporary index/object database, filter-free
content capture, concurrency detection, symlink containment, `write-tree`, archive/diff), `src/local.ts` (`--working-tree`), `src/formats.ts` (`wachiman.review-input/2`
with `kind: "working-tree"`; reader accepts both), `docs/formats/review-input.v2.schema.json`,
`docs/cli.md`, `docs/local-review.md`, ADR 0019's Status line (its non-goal is reopened by this
slice; the shipping PR adds the pointer).

Checks: a fixture repository with staged, unstaged and untracked (ignored and not) files;
`staged` reviews only the index; `all` includes the untracked non-ignored file and not the
ignored one; a file edited during the run (simulated between snapshot and review) does not change
the input; `--history` tracks a finding across two working-tree runs without commit-ancestry calls on tree ids;
reject --result-version 1 before model calls, unborn HEAD and conflicted index; assert the real
index, worktree and object database are unchanged and that repository-configured filters never execute.

## Documentation at the end

- `docs/architecture.md`: one paragraph on the account layer and the verifier step in the flow;
  the "one motor" sentence.
- `docs/cli.md` is regenerated from the contract; `docs/local-review.md` §3 and §8 follow.
- ADR Status lines: 0028, 0029, 0030 move from "proposed" to "accepted; implemented by …" in the
  pull requests that implement them; ADR 0019's Status line records slice 6; draft ADR 0026's
  Status line (on #135) gets the pointer to 0028 when both are on `main`.
- This plan is deleted by the last shipping pull request.
