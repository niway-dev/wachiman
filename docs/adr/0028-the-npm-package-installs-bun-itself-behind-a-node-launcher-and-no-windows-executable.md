# ADR 0028: The npm package `wachiman` installs Bun itself and ships the source behind a Node launcher; there is no Windows executable

- **Status:** accepted 2026-11-09, amended 2026-11-09 (the Windows executable was tried and
  abandoned; Bun now comes with the package). Decisions 1, 2, 4 and 5 (the npm package, the Node
  launcher with its bundled Bun, the source path, gated publishing) are implemented by the npm
  packaging slice (branches `feat/npm-package` and `feat/npm-bundled-bun`). Not yet published to
  npm: the first publish happens when the release workflow runs on a release that contains this
  slice. **Windows is not tested in CI, and is expected to work wherever Node and Bun run:** the `windows-latest` job was removed
  (see Decision 3).
  **Amends** draft
  [ADR 0026 in PR #135](https://github.com/niway-dev/wachiman/pull/135) (PR #135, unmerged): keeps its
  decisions 1 (package `wachiman`, trusted publishing) and 3 (`skills install`); **replaces** its
  decision 2 (`npx` unsupported), decision 4 (the source installer goes after one release) and
  decision 5 (zero dependencies: the package now has the runtime, and since 2026-11-13 the approved terminal packages of ADR 0002). Whichever of #135 and
  this record merges first, the other's rebase adds the cross-reference in the Status line.
  Amends [ADR 0001](0001-distribution-and-trust.md) as draft 0026 already does (npm taken up with
  provenance); **amends** [ADR 0002](0002-typescript-on-bun-zero-dependencies.md) (its "no
  runtime dependencies" now allows the pinned `bun` package, and, by the amendment of 2026-11-13, the
  libraries the owner approves one by one; Bun stays the runtime and the engine has no dependency of its own); consistent with
  [ADR 0023](0023-one-name-for-every-surface-people-type.md). Supersedes
  decision 3 of the [design spec](../specs/2026-11-09-cli-and-verified-reviews-design.md), which
  proposed a Windows executable.
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

The first version of this record added a Windows `wachiman.exe` (a `bun build --compile` output
attached to the GitHub Release) next to the npm package. It was built on the branch
`feat/windows-exe` (PR #149) and then **abandoned on 2026-11-09** by the owner's decision. A
compiled executable plus the Node launcher was too much to build, release and keep working: it
meant a second launch path, embedded assets and its own release job. It also showed three
failures that appear only on Windows, none with a confirmed cause: Ctrl-C handling, a `ENOENT`
on `config.json.lock`, and the evidence step on the golden prompt. What Windows users need is
not an executable but a package that does not ask them to install Bun first.

Facts read or measured: `npm install -g bun` and the official `bun` npm package install a
working `bun.exe` through a `postinstall` script from per-platform packages
(`@oven/bun-<platform>`); the package's `bin/bun.exe` is a placeholder that cannot run until that script runs, so an
install with `--ignore-scripts` leaves a file that exists and does not work (in bun@1.3.4 an empty file that cannot be run, `ENOEXEC`); npm links every `bin` on POSIX and creates
`.cmd` and `.ps1` shims on Windows, and either way the launcher runs with Node. Measured for Bun 1.3.4: the platform
download is 23 MB (macOS arm64) to 42 MB (Windows x64) compressed and 60 to 115 MB unpacked.

## Decision

1. **The package `wachiman` depends on the official npm package `bun` at one exact version**
   (`dependencies.bun`, pinned to the Bun version CI tests, currently 1.3.4; `engines.bun >= 1.3`
   and `engines.node >= 20` stay). The package ships the source as it is: `src/`, `skills/`,
   `templates/`, `bunfig.toml`, the licence. No bundle, no build step, and no install hook of
   Wachiman's own. The engine has no dependency of its own (ADR 0002); this one is its runtime.
2. **The `bin` is a Node launcher**, `bin/wachiman.js`, for both names (`wachiman`,
   `agent-review`). It picks a Bun in this order and runs
   `bun --no-env-file --config=<pkg>/bunfig.toml <pkg>/src/cli.ts <args>` with inherited stdio,
   exiting with the child's code (130 on `SIGINT`):
   1. the bundled Bun, `bin/bun.exe` of the `bun` package resolved from the launcher's own
      location (never from the working directory);
   2. otherwise a Bun on `PATH`, scanning absolute entries only on every OS, so a `bun` in the
      reviewed repository is never run.
   A candidate is accepted only if `<candidate> --version` exits 0 within 15 seconds and
   reports 1.3 or later, because the placeholder left by `--ignore-scripts` exists but cannot run. If
   neither works, the launcher prints one of three messages (no Bun found, a Bun found that did not run, or a
   Bun found but older than 1.3, naming its version), each with the install commands, and exits 2. It sets and unsets no
   environment variable, translates none into a flag, and never downloads or installs anything.
   `npm i -g wachiman`, `bun add -g wachiman` and `npx wachiman` are the install paths, written
   to work in Git Bash and in PowerShell; Windows is not tested in CI (Decision 3).
3. **There is no Windows executable.** It was tried and abandoned (Context). Windows is served by
   the same Node launcher and bundled Bun as every other OS. It is not tested
   in CI and is expected to work wherever Node and Bun run: a `windows-latest` job was tried and removed by the owner's decision
   because it produced failures unrelated to the product, mostly runner-speed timeouts. If the
   package does not work there, the launcher prints the install commands.
4. **The source path stays supported for contributors:** `bin/wachiman` (bash) and
   `scripts/install-local.sh`, with `WACHIMAN_DIR`. The wrapper removes env-to-flag translation and API-key stripping so all entry points
   apply the same explicit in-process local-auth refusal (ADR 0029). Announce both changes.
5. **Publishing is gated and tokenless:** the publish job runs on the release tag, `needs:` the
   CI job on the tagged SHA, and uses npm trusted publishing (`id-token: write`, provenance);
   no `NPM_TOKEN` secret exists.

## Alternatives rejected

- **A standalone Windows `wachiman.exe`** (the first version of this record, branch
  `feat/windows-exe`, PR #149). Removes the Node and Bun prerequisites, but adds a second
  launcher, embedded assets and a release job, and showed three Windows-only failures with no
  confirmed cause (Ctrl-C handling, `config.json.lock` `ENOENT`, evidence on the golden prompt).
  Too complex for the one user need, which is "install without a separate Bun step".
- **Requiring the user to install Bun first** (this record's first decision). Simple, and the
  launcher already found Bun on `PATH`, but every Windows user hit a second install and a
  restart of the terminal. Kept as the fallback, not the main path.
- **A launcher that downloads Bun or runs the official installer.** A second network step Wachiman
  would own and have to verify; it also would run code the user did not ask for. The `bun`
  package does the download under npm's own controls.
- **Per-platform compiled binaries delivered through npm optional packages** (the 2026-11-08
  draft). Costs a six-target matrix, a signing question on two platforms and a second packaging
  layout. Kept as research.
- **`bin` pointing at `src/cli.ts` with a `#!/usr/bin/env bun` shebang** (draft 0026's shape).
  Works on POSIX; on Windows it depends on npm's shim parsing the shebang into a `bun` call,
  which was not verified and gives no place to pass `--no-env-file --config=`. The Node launcher
  makes the isolation flags explicit and testable.
- **A Node-compatible build.** A bundler, a dependency, a second runtime to test; ADR 0002.
- **Retiring the source installer after one release** (draft 0026 decision 4). Running
  unreleased source is how the owner develops; a public package does not replace it.
- **Accepting a bundled file because it exists.** With `--ignore-scripts` the file exists and
  cannot run; only a successful `--version` proves it runs.

## Consequences

- Installing `wachiman` downloads Bun (23 to 42 MB compressed, 60 to 115 MB unpacked, per OS,
  for Bun 1.3.4). The documentation says so plainly, next to the install command.
- **Supply chain.** The `bun` package is published by oven-sh (maintainers jarred and robobun,
  repository oven-sh/bun) and runs its own `postinstall` at install time to put the platform
  binary in place. Wachiman's provenance covers Wachiman's files, not that binary download.
  Users who do not accept that install with `--ignore-scripts` and bring their own Bun; the
  launcher then falls back to it. Newer npm versions warn when a dependency has install scripts;
  if a future npm blocks them by default, the placeholder and the fallback apply. pnpm 10 already
  blocks dependency build scripts by default (documented pnpm behavior, not tested here), which is why
  the PATH fallback matters.
- The exact `bun` pin moves with CI's `bun-version` (a test checks they match); a Bun upgrade is a
  deliberate commit, and a package release is needed to ship it.
- The release workflow gains a publish job; the owner must configure the npm trusted publisher
  (unverified steps: the npm account, 2FA, that the name is still free).
- `package.json` changes name; the release-please component is mapped so tags and the
  changelog do not change (to verify at implementation).
- The `exe` branch of `src/install-kind.ts` stays in the type but nothing builds that layout.
- Draft ADR 0026 and this record must be reconciled by whichever lands second.

## Non-goals

- Compiled binaries or executables for any OS; Homebrew, winget, Scoop, Docker.
- Auto-update or an update check.
- Downloading or installing Bun from the launcher.
- Verifying the Bun binary's checksum beyond what npm and the `bun` package do.

## Reopen when

- A user needs an install without Node (a no-Node Windows machine, say): reopen the executable,
  starting from the three recorded Windows failures, and decide the tier rule then.
- Users without a working bundled Bun are the main support cost (for example npm blocks
  dependency install scripts by default): reconsider a launcher-side download with a checksum,
  or per-platform optional packages.
- Windows support is wanted again: adding a Windows CI job back is allowed only with an owner
  decision. WSL is an interim option, not a silent replacement of scope.
- npm trusted publishing cannot be made to work from this repository: publish with a token
  under a protected environment and say so in the README.
