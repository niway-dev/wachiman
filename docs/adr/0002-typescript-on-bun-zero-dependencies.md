# ADR 0002: TypeScript on Bun, no runtime dependencies

- **Status:** accepted
- **Date:** 2026-10-25

## Context

The engine began inside TypeScript and Bun monorepos and kept that stack when it was extracted into
this repository. The question "why not Python?" will be asked, so the answer is recorded here. The
engine runs in the consumer's CI with a model API key, so the amount and origin of the code that
runs beside the key matters as much as the language.

## Decision

The engine is written in TypeScript and runs on Bun. It has no runtime dependencies: `package.json`
declares none, and there is no `node_modules` to install for a review to run. Tests use `bun test`.

Reasons:

- **One runtime already present** in the maintainer's repositories and CI, so the engine adds no
  second toolchain to them.
- **A typed contract** for the structured output the model returns and for the configuration.
- **A built-in test runner**, and Bun runs TypeScript directly, so there is no build step.
- **The smallest possible set of code that runs with the key.** With no dependencies, the code
  that sees `ANTHROPIC_API_KEY` is this repository's own source plus the runtime, with no
  transitive packages to audit or pin.

## Alternatives rejected

- **Python.** Equally capable. It adds a second runtime to repositories that are otherwise
  Bun-based, and the usual habit of reaching for packages would grow the code that runs with the
  key.
- **Node without Bun.** Slower CI setup, and no built-in TypeScript execution or test runner, so
  it needs a build step or extra tooling.
- **Go or Rust.** A compiled artefact and a release pipeline before there is a second maintainer
  who would benefit from them.

## Consequences

- Bun-specific hazards must be handled explicitly. Bun reads `bunfig.toml` (whose `preload` runs
  code) and `.env` from its working directory; the reusable workflow handles this by running Bun
  from the engine's own checkout with `--no-env-file --config=bunfig.toml` (see
  [architecture](../architecture.md) and [SECURITY.md](../../SECURITY.md)).
- Bun's version is pinned in the workflow (`bun_version`) and in CI, so a new Bun release cannot
  change behaviour under a consumer unannounced.
- Contributors need Bun installed to run the tests.
- The engine uses Bun APIs (`Bun.Glob`), so it does not run on plain Node.

## Non-goals

- A second implementation language for provider adapters. Adapters are TypeScript modules behind
  the `ProviderAdapter` interface.

## Reopen if

- A provider adapter needs a runtime that Bun cannot drive.
- A second maintainer prefers another stack and is willing to carry the migration.
- Bun's release cadence breaks the version pin repeatedly.

## Amendment 2026-10-31

The owner relaxed the rule: a dependency may enter when a measured experiment shows it improves
reviews and the artefact is pinned by hash with a manifest. First candidate: vendored tree-sitter
WASM for the risk map ([spec](../specs/2026-10-31-flow-questions-and-evidence-design.md),
decision 14). `package.json` stays free of runtime dependencies; vendored files count as
dependencies for review and licensing purposes.

## Amendment 2026-11-09

The npm package `wachiman` declares exactly one runtime dependency: the official `bun` package,
pinned to one version, so that npm installs the runtime ([ADR 0028](0028-the-npm-package-installs-bun-itself-behind-a-node-launcher-and-no-windows-executable.md)).
Everything else stays as decided: the engine has no dependency of its own, and the statements above
that `package.json` declares none now read "none besides `bun`".

## Amendment 2026-11-13

The owner changed the rule for libraries. Where the 2026-10-31 amendment let a dependency in after a
measured experiment, the rule is now: **no libraries unless the owner explicitly asks for one.** An
agent never adds a dependency on its own judgment, however small, and a request in a session is
recorded here before the code that uses it merges. Vendored artefacts keep the hash-and-manifest
condition of the 2026-10-31 amendment.

Each approval is a line in the table below: the package, one exact version (no range), why the
owner asked for it, and where it may be imported. A future approval adds a line; nothing else
grants a dependency. Statements above that `package.json` declares "none" or "none besides `bun`"
now read "none beyond this table".

| Package | Version | Why | Where it may be imported |
| --- | --- | --- | --- |
| `bun` | 1.3.4 | The runtime, installed by npm so `npm i -g wachiman` works ([ADR 0028](0028-the-npm-package-installs-bun-itself-behind-a-node-launcher-and-no-windows-executable.md)) | Nowhere: `bin/wachiman.js` runs it, no source file imports it |
| `chalk` | 5.6.2 | Colors for the interactive and help screens, in place of hand-written escape codes | Files under `src/wizard/` only (`style.ts`) |
| `@clack/prompts` | 1.9.0 | The prompt screens (intro, select, text, confirm, spinner, note) of the launcher, `init` and `setup`, in place of hand-rolled arrow-key rendering. Its own packages (`@clack/core`, `sisteransi`, `fast-string-width`, `fast-string-truncated-width`, `fast-wrap-ansi`) resolve at install time within its own version ranges; `bun.lock` is not committed | Files under `src/wizard/` only (`ui.ts`, through a dynamic `import()`) |

The dependency stays out of the code that sees the key, and out of GitHub Actions:

- The review engine, the providers and every other module outside `src/wizard/` never import
  `chalk` or `@clack/*`, directly or through another module. `test/dependencies.test.ts` fails
  when they do, and when anything reachable by static imports from `src/cli.ts` does.
- `src/help.ts`, `src/init/` and `src/setup/` reach the packages only through `src/wizard/`, and
  `src/cli.ts` loads that code with a dynamic `import()` after it knows a terminal is attached.
  Actions run `bun src/cli.ts review ...` with no `node_modules` and consumer repositories copy
  the engine, so `review`, `comment`, `threads` and `reset-confidence` must keep working in a
  checkout where neither package is installed. A clone that never ran `bun install` still runs
  every command; only a terminal screen reports that the packages are missing, and `--yes` or flags
  skip it.
- `scripts/verify-package.sh` installs the packed tarball and loads the real packages from it.

`chalk` does not read `NO_COLOR` on its own (checked on 5.6.2 and 6.0.1). `src/wizard/style.ts`
decides the color level (terminal, `NO_COLOR` non-empty, `TERM=dumb`) and hands chalk that level, so
the packages never decide whether color is allowed.

**Reopen if** a listed package has a vulnerability or a malicious release (remove or pin past it),
if its license stops fitting the FSL terms of [ADR 0013](0013-license-fsl-1-1-alv2.md), or if the
terminal screens are no longer worth carrying a dependency tree.
