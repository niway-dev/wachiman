# ADR 0061: Bun is the development toolchain: `bun fmt`, `bun lint` and `bun check`, with a ratchet for what already exists

- **Status:** accepted 2026-11-21. Implemented by the pull request that adds this file. Extends
  [ADR 0002](0002-typescript-on-bun-zero-dependencies.md) (TypeScript on Bun): the runtime
  dependencies stay as they are, and the one new package is a development dependency. Leaves
  [ADR 0028](0028-the-npm-package-installs-bun-itself-behind-a-node-launcher-and-no-windows-executable.md)
  (the Bun that consumers receive) untouched. Makes room for
  [ADR 0053](0053-local-reviews-run-the-repository-formatters-and-linters-it-already-installed.md),
  which has local reviews run the formatter and linter a repository already has.
- **Date:** 2026-11-21

## Context

This repository had no formatter, no linter and no typecheck: `package.json` ran `bun test` and
nothing else. Style was kept by habit and by review, a mistake that a linter finds in a second
(an unused variable, an empty `catch`) reached review, and a type error was invisible unless a
test happened to hit it.

Bun now ships all three: `bun fmt` (output compatible with Prettier), `bun lint` (ESLint's and
typescript-eslint's rules, ESLint plugins, custom rules through the ESLint plugin API) and `bun
check` (a typechecker that reads `tsconfig.json`). One binary and one config file
(`bunfig.toml`) cover them.

Two facts shape the decision:

- `bun lint` is not in a stable Bun yet. Bun 1.4.5 (the stable release on 2026-11-19) has `bun fmt`
  and `bun check`; `bun lint` first appears in the canary `1.4.5-canary.20261121.1`.
- Neither `bun fmt`, `bun lint` nor `bun check` has a baseline mode. A repository that adopts them
  with existing violations has to fix everything in the same change, or switch the check off.

## Decision

1. **Bun is the development toolchain.** Format, lint and typecheck run with `bun fmt`,
   `bun lint` and `bun check`, configured in `bunfig.toml` (`[fmt]`, `[lint]`, `[lint.rules]`) and
   in a root `tsconfig.json`.
2. **Exact versions, run through `bunx bun@<version>`.** `fmt` and `check` run on Bun 1.4.5.
   `lint` runs on the canary `1.4.5-canary.20261121.1` until a stable release has `bun lint`.
   `package.json` and `scripts/ratchet.ts` name the versions, and a test fails if they disagree.
   Both the developer's own Bun and the one CI installs are irrelevant to the result.
3. **The consumer runtime does not change.** The `bun` dependency (1.3.4, ADR 0028), the Bun the
   launcher starts, and the Bun the CI test shards install (setup-bun 1.3.4) stay as they are. The
   `[fmt]` and `[lint]` sections in the shipped `bunfig.toml` are ignored when the engine runs
   (checked on 1.3.4: the engine starts with `--config` pointing at the file); the file carries no
   `preload` and no `env`, so ADR 0028's isolation of the reviewed checkout is unchanged.
4. **Formatter scope.** JavaScript, TypeScript, JSON and YAML, at a print width of 140 (the code
   already runs wide: at 80 columns nearly every file would change). Markdown and TOML are left
   alone, and so is everything a test compares byte for byte or a program reads as it is:
   `fixtures/` directories (golden prompts, recorded pull requests, snapshots), `templates/`, and
   `.claude/`. The formatting commit changes layout only: each changed script transpiles to the
   same code before and after, and each changed JSON or YAML file parses to the same value.
5. **Lint rules.** Bun's recommended rules, plus `no-empty` and `max-depth` (limit 4, ESLint's own
   default; nine existing places are deeper and go to the baseline). Both are errors.
   A custom rule, `local/comments-point-to-docs`, allows a code comment only as a pointer to a document
   or a tool directive ([code comments](../code-comments.md)); existing comments go to the baseline.
6. **Typecheck.** `strict`, over `src/`, `scripts/` and `test/`, with two exact development
   dependencies: `@types/bun` 1.3.4 (the declarations match the runtime consumers get; without
   them `bun check` cannot see `Bun`, `bun:test` or `node:` modules) and `@types/node` 26.6.6.
   `@types/bun` depends on `bun-types`, which asks for any `@types/node`; left unpinned, a new
   release could change the type errors with no change in the repository. A test requires every
   development dependency to be an exact version. `bun.lock` is not committed (the repository
   ignores it), so these two pins are what keep the typecheck baseline stable across installs.
7. **A ratchet for what already exists.** `scripts/ratchet.ts` counts `bun lint` diagnostics by
   rule and file, and `bun check` errors by code and file, and compares them with the committed
   `scripts/ratchet-baseline.json`. A count that rises (or appears) fails and names the rule and
   file. A count that falls passes and is reported; `bun run ratchet:update` records it. A tool
   that crashes exits 2: it never passes as clean. `bun run lint` and `bun run check` are the
   ratcheted gates; `lint:raw` and `check:raw` show everything.
8. **CI.** Three jobs run beside the test shards and do not wait for them: format check, lint and
   ratchet, typecheck and ratchet. Actions are pinned by SHA like the existing ones.
   The aggregate `test` check still means "the test shards passed" and does not wait for them.
   `main` has no required-status-check list today; if one is added, `format`, `lint` and
   `typecheck` belong in it.
9. **The formatting commit is hidden from blame.** It is one commit with no logic change, and its
   SHA is in `.git-blame-ignore-revs`. The SHA survives only a **merge commit**: this pull request
   is merged with "Create a merge commit", never squashed or rebased, because either would give
   the commit a new SHA and leave the entry pointing at nothing. If it is squashed by mistake,
   the dead entry is removed in a follow-up and blame shows the squash commit on the reformatted
   lines.

## Alternatives rejected

- **Biome.** A good tool in one binary, but it is a second ecosystem beside Bun: its own config,
  its own rule names, and its own plugin model for custom rules instead of the ESLint plugin API
  that Bun's linter and most of the ecosystem use. Bun already provides all three tools.
- **oxlint with oxfmt.** Fast, with a compatible plugin API, but it is two more binaries to install
  and keep current. `bun lint` reads the same plugin API and the same kind of rules without
  adding a second toolchain.
- **ESLint with Prettier.** The most established choice and the one with the most plugins, but it
  brings a large tree of packages into a repository whose engine has no runtime dependencies
  (ADR 0002), two configuration files, and slower runs. Bun's tools accept ESLint plugins and
  Prettier's options, so what we would gain from it stays reachable.
- **Fixing every existing violation in this change.** It would put a large, risky edit of working
  code in the same pull request as the tooling. The ratchet makes the tools enforce from the first
  day without that.
- **`bun lint --suppress-all`** (Bun's own suppressions file). It exists only in the canary, is
  tied to ESLint's file format, and records no per-file counts for the typecheck. A ratchet that
  covers both tools with one rule is simpler to explain and to test.
- **A linter pinned to the latest canary.** A moving canary would change results with no change
  in the repository. The pin is exact.

## Consequences

- One formatting commit rewrites about 300 files (11,400 lines added, 4,160 removed). `git blame`
  skips it through `.git-blame-ignore-revs`; GitHub honours that file, and locally
  `git config blame.ignoreRevsFile .git-blame-ignore-revs` turns it on.
- The baseline started at 116 lint diagnostics (before the comment rule, which adds its own count, kept in
  `scripts/ratchet-baseline.json` under `local/comments-point-to-docs`; see [code comments](../code-comments.md)) in 50 files and 155 type errors in 46 files. They
  are real findings, not noise, and each fix lowers the baseline in the same pull request.
  Renaming or moving a file with a baseline entry looks like a rise in the new path; update the
  baseline in that pull request.
- A fall is reported but does not fail the run. Until the baseline is updated, the same count can
  come back without a rise being seen. The rule is that the pull request that fixes something
  runs `bun run ratchet:update` and commits the lower baseline; a reviewer who sees a fix
  without a baseline change can ask for it.
- `@types/bun` and `@types/node` are development dependencies. They are not published (the
  package `files` list is unchanged) and the runtime still has `bun`, `chalk` and `@clack/prompts` only.
- The lint job runs a canary Bun. If that build disappears or changes behaviour, the job fails
  until the pin moves; a failure there is a tooling failure, not a code failure.
- `bun run ratchet:update` records a rise as readily as a fall. The baseline is the gate, so a
  reviewer reads a change to `scripts/ratchet-baseline.json` as closely as code; a rise there is
  new debt accepted on purpose. The baseline is keyed by file path, so a rename also needs it.
- A developer needs network access the first time `bunx bun@<version>` runs for a version; Bun
  caches it afterwards.
- Printing and sorting choices (width 140, no import sorting) are tuned to today's code. Changing
  the width later is another formatting commit.

## Non-goals

- Changing the Bun consumers receive, the Bun the launcher uses, or the Bun the test shards use.
- Formatting Markdown, or the files a test compares byte for byte.
- Further custom lint rules. The toolchain makes them possible (ESLint plugin API); a rule is added when a
  pattern we do not want has recurred. The one exception so far is the comment rule in decision 5.
- Type-aware lint rules (`--type-aware`), and `bun test --check`.
- A pre-commit hook.

## Reopen when

- A stable Bun release ships `bun lint`: move the lint pin to it, drop the canary, and make this
  ADR's version line say so.
- The canary pin breaks (the build is removed, or the rules change under the same version).
- The baseline reaches zero for a tool: drop that part of the ratchet and run the plain tool.
- The Bun consumers receive moves to 1.4 or later: the test shards and the development tools can
  then share one Bun, and `bunx` indirection can go.
- `bun fmt` and Prettier diverge on a file in a way that matters to a contributor's editor.
