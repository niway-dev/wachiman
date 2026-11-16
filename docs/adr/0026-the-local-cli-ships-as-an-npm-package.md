# ADR 0026: The local CLI ships as the npm package `wachiman`

- **Status:** proposed 2026-11-07, not implemented. **Amends** [ADR 0001](0001-distribution-and-trust.md):
  its rejected alternative "An npm package now" ("deferred, not refused") is taken up for the
  local CLI only; the GitHub integration stays by Git ref. **Amends** [ADR 0023](0023-one-name-for-every-surface-people-type.md):
  its non-goal "renaming the package name" is dropped, because the package name is now something
  people type. ADR 0001's reopen condition ("a second maintainer appears: revisit the npm package
  and release provenance together") is **not met**; the owner reopens it because the install
  script is the thing to replace.
- **Date:** 2026-11-07
- **Spec:** [Three ways to run Wachiman](../specs/2026-11-07-three-modes-design.md)
- **Issue:** [#134](https://github.com/niway-dev/wachiman/issues/134)

## Context

`wachiman local` (ADR 0019) is installed by `scripts/install-local.sh`: it symlinks
`bin/wachiman` into `~/.local/bin` and the two skills into every agent skills directory, from a
clone that must not be a temporary worktree. It works for the owner and for nobody who does not
already have the clone. The owner wants a package install (#134).

Constraints: the engine uses Bun APIs and has no runtime dependencies (ADR 0002), so it cannot run
on plain Node and has nothing to bundle; `package.json` is still named `agent-review`
(ADR 0023 kept it); ADR 0001 names release provenance as the thing to design with npm.
`npm view wachiman` returned 404 on 2026-11-07, so the name is free at the time of writing.

## Decision

1. **The package is `wachiman` on npm**, published from this repository's release workflow on
   every release-please tag, with provenance (npm trusted publishing through Actions OIDC, no
   long-lived npm token). `bin` keeps `wachiman` and `agent-review`. `files` ships `src/`,
   `skills/`, `bunfig.toml`, `templates/` and the licence; no build step, because Bun runs the
   TypeScript as it is.
2. **Bun is the runtime, stated plainly.** `bunx wachiman local …` runs without an install;
   `bun add -g wachiman` installs it. `npx` is documented as unsupported (`engines.bun` is
   already declared).
3. **Skills install is a subcommand.** `wachiman skills install [--dir <path>]` copies
   `skills/wachiman-review` and `skills/wachiman-audit` into `~/.agents/skills` and every Claude
   config directory the script covers today, with the same refusal to touch `~/.wachiman`;
   `wachiman skills uninstall` removes only what it installed. Copies, not symlinks, because the
   package directory moves on every upgrade.
4. **The script stays one release, then goes.** `scripts/install-local.sh` remains for
   contributors running from a clone until the package has shipped once; `docs/local-review.md`
   switches to the package.
5. **Zero dependencies still holds for the package.** Nothing is added to `dependencies`; the
   published tarball is this repository's own source, so the provenance attestation covers all
   the code that runs beside the developer's Claude sign-in.

## Alternatives rejected

- **`bun build --compile` binaries on GitHub Releases plus a Homebrew tap.** No Bun requirement
  for the user, which is the strongest argument for it. Rejected because it adds a per-platform
  build matrix, a signed-binary question on macOS (Gatekeeper), a tap repository to maintain, and
  a binary a reader cannot inspect, for a tool whose trust story is "read the source" (ADR 0001
  decision 1). The audience is developers who already run Bun or can install it in one line.
- **Keep the script.** Works only from a clone; cannot be told to a colleague in one line.
- **Publish under a scope (`@niway-dev/wachiman`).** The unscoped name is free; a scope adds
  typing and an organization on npm to administer. Taken only if the unscoped name is gone by
  publish time.
- **Keep the package name `agent-review`.** ADR 0023's reason for keeping it (nobody types it)
  stops holding the moment it is what people install.
- **A Node-compatible build.** It would mean a bundler, a dependency, and a second runtime to
  test; ADR 0002 chose Bun on purpose.

## Consequences

- The release workflow gains a publish job and the repository needs npm trusted publishing
  configured by the owner (unverified steps; spec open question 6).
- `package.json` changes name; release-please's component name (`agent-review`) may change with
  it or be mapped; to decide at implementation.
- A consumer of the GitHub mode is unaffected: distribution by Git ref (ADR 0001) is unchanged.
- The local CLI's version becomes visible (`wachiman --version`), and a local review can record
  the package version in its JSON result.
- If the name is taken before publishing, decision 1 falls to the scoped name.

## Non-goals

- Distributing the GitHub Action or the reusable workflow through npm.
- A Homebrew formula, a Docker image, or a compiled binary.
- Auto-update inside the CLI.

## Reopen if

- A second maintainer appears (ADR 0001's condition): review who can publish and the provenance
  setup together.
- Users without Bun are the main support cost: revisit compiled binaries, starting with macOS
  only.
- npm provenance or trusted publishing cannot be made to work from this repository's workflow:
  publish with a token under a protected environment and say so in the README.
