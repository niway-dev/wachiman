# ADR 0028: The npm package `wachiman` requires Bun and ships the source behind a Node launcher; a Windows executable is a second artifact

- **Status:** accepted 2026-11-09; decisions 1, 2 and 4 (the npm package, the Node launcher, the
  source path) are implemented by the npm packaging slice (branch `feat/npm-package`); decision 3
  (the Windows executable) is implemented by the Windows executable slice (branch
  `feat/windows-exe`): the build script, the smoke rows W1 to W3, W5 and W6, the `windows-exe` CI
  job and the release jobs. Its tier is **built and smoke-tested**; promotion to "supported" waits
  for those rows to be green on `windows-latest` on a published commit and for the owner's one real
  run (row W7), and is a docs-only change. Not yet published to npm: the first publish happens
  when the release workflow runs on a release that contains the npm slice.
  **Amends** draft
  [ADR 0026 in PR #135](https://github.com/niway-dev/wachiman/pull/135) (PR #135, unmerged): keeps its
  decisions 1 (package `wachiman`, trusted publishing), 3 (`skills install`) and 5 (zero
  dependencies); **replaces** its decision 2 (`npx` unsupported) and decision 4 (the source
  installer goes after one release); **partly reopens** its rejected alternative "compiled
  binaries" for Windows only. Whichever of #135 and this record merges first, the other's
  rebase adds the cross-reference in the Status line. Amends [ADR 0001](0001-distribution-and-trust.md)
  as draft 0026 already does (npm taken up with provenance); consistent with
  [ADR 0002](0002-typescript-on-bun-zero-dependencies.md) (Bun stays the runtime; the launcher
  is one dependency-free file) and [ADR 0023](0023-one-name-for-every-surface-people-type.md).
- **Date:** 2026-11-09
- **Spec:** [The Wachiman CLI and verified reviews](../specs/2026-11-09-cli-and-verified-reviews-design.md),
  decisions 1–4; [command contract §7](../specs/2026-11-09-cli-command-contract.md).
- **Issue:** [#134](https://github.com/niway-dev/wachiman/issues/134)
- **Numbering:** 0028 because open branches hold 0014–0015, 0017–0018, 0021–0022, 0024–0026
  and 0027.

## Context

`wachiman local` is installed from a clone by `scripts/install-local.sh`, which symlinks a bash
wrapper. Draft ADR 0026 chose an npm package of the TypeScript source run by Bun and declared
`npx` unsupported, because the engine uses Bun APIs. On 2026-11-08 the owner set the direction:
Bun as an installed prerequisite is acceptable on Linux, macOS and Windows; npm installation is
required; a standalone Windows executable is desirable; compiled binaries on every OS are not a
requirement. The 2026-11-08 draft spec that proposed per-platform compiled binaries delivered
through npm optional packages is therefore research, not the plan.

Facts read, not tried: Bun compiled executables load `.env` and `bunfig.toml` by default and
have `--no-compile-autoload-dotenv` and `--no-compile-autoload-bunfig` to turn that off;
`import.meta.dir` in an executable starts with `/$bunfs/root/`; npm installs a Node shim for
every `bin` on every OS and runs it with Node.

## Decision

1. **The package `wachiman` requires Bun** (`engines.bun >= 1.3`) and ships the source as it is:
   `src/`, `skills/`, `templates/`, `bunfig.toml`, the licence. No bundle, no build step, no
   runtime dependency.
2. **The `bin` is a dependency-free Node launcher**, `bin/wachiman.js`, for both names
   (`wachiman`, `agent-review`). It finds `bun` (`bun.exe` on Windows) on `PATH`, runs
   `bun --no-env-file --config=<pkg>/bunfig.toml <pkg>/src/cli.ts <args>` with inherited stdio,
   exits with the child's code (130 on `SIGINT`), and when Bun is missing prints the Bun install
   line and exits 2. It sets and unsets no environment variable and translates none into a
   flag. `npx wachiman` and `npm i -g wachiman` are therefore supported wherever Bun is installed.
3. **A Windows executable, `wachiman.exe`,** is built from the same source with
   `bun build --compile --target bun-windows-x64 --no-compile-autoload-dotenv
   --no-compile-autoload-bunfig`, with the version as a build-time define and the settings JSON,
   skills and templates embedded. It is attached to the GitHub Release with a SHA-256 and a
   build attestation. Its tier is **built and smoke-tested** until the Windows acceptance rows
   pass on `windows-latest`; only then may the documentation say "Windows: supported". No macOS
   or Linux executable is built.
4. **The source path stays supported for contributors:** `bin/wachiman` (bash) and
   `scripts/install-local.sh`, with `WACHIMAN_DIR`. The wrapper removes env-to-flag translation and API-key stripping so all entry points
   apply the same explicit in-process local-auth refusal (ADR 0029). Announce both changes.
5. **Publishing is gated and tokenless:** the publish job runs on the release tag, `needs:` the
   CI job on the tagged SHA, and uses npm trusted publishing (`id-token: write`, provenance);
   no `NPM_TOKEN` secret exists.

## Alternatives rejected

- **Per-platform compiled binaries delivered through npm optional packages** (the 2026-11-08
  draft). Removes the Bun prerequisite, which the owner no longer requires; costs a six-target
  matrix, a signing question on two platforms and a second packaging layout. Kept as research.
- **`bin` pointing at `src/cli.ts` with a `#!/usr/bin/env bun` shebang** (draft 0026's shape).
  Works on POSIX; on Windows it depends on npm's shim parsing the shebang into a `bun` call,
  which was not verified and gives no place to pass `--no-env-file --config=`. The Node launcher
  makes the isolation flags explicit and testable.
- **A Node-compatible build.** A bundler, a dependency, a second runtime to test; ADR 0002.
- **Retiring the source installer after one release** (draft 0026 decision 4). Running
  unreleased source is how the owner develops; a public package does not replace it.
- **A macOS or Linux executable now.** Nobody asked; each adds a signing and a smoke row for no
  stated user.

## Consequences

- Every installation path needs Bun except the Windows executable. The documentation says so in
  one sentence and `doctor` reports the Bun it found.
- The release workflow gains two jobs (publish, Windows build) and the owner must configure the
  npm trusted publisher (unverified steps: the npm account, 2FA, that the name is still free).
- `package.json` changes name; the release-please component is mapped so tags and the
  changelog do not change (to verify at implementation).
- The Windows executable needs three source changes (version define, embedded settings written
  to a temp file, embedded assets) that are no-ops under `bun src/cli.ts`.
- Draft ADR 0026 and this record must be reconciled by whichever lands second.

## Non-goals

- Compiled binaries for macOS or Linux; Homebrew, winget, Scoop, Docker.
- Auto-update or an update check.
- Signing the Windows executable in the first release (documented as unsigned).

## Reopen when

- Users without Bun are the main support cost on macOS or Linux: build the executable for that
  platform, with the same tier rule.
- The Windows rows cannot be made green: report the precise blocker and keep native Windows
  support pending an owner decision; WSL is an interim option, not a silent replacement of scope.
- npm trusted publishing cannot be made to work from this repository: publish with a token
  under a protected environment and say so in the README.
