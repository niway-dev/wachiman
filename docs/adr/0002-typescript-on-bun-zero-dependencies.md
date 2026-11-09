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
