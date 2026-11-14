# Design: warn when a change fails the repository's own formatter or linter

- **Date:** 2026-11-14
- **Issue:** [NIW2-796](https://linear.app/niway/issue/NIW2-796/wachiman-should-warn-when-a-change-fails-the-repositorys-own-formatter)
- **Status:** proposed. Nothing in this spec is implemented.

## Summary (one minute)

A pull request in a consumer repository added a Markdown file whose tables were not in the form the
repository's formatter (oxfmt) prints. Wachiman reviewed it and reported no problem: the prompt
tells the model to skip "style a formatter would catch", and nothing tells it which formatter the
repository enforces. The repository's CI skipped its format job for a docs-only change, so the
first thing that failed was the pre-push hook, on every branch, after merge
([kaipu-record#617](https://github.com/niway-dev/kaipu-record/pull/617), worked around in
[kaipu-record#636](https://github.com/niway-dev/kaipu-record/pull/636)).

Wachiman learns which formatters and linters a repository enforces, from its files. On the laptop
(`wachiman local`) it runs those tools in check mode on the changed files, using the binaries the
repository already installed, and reports each failure as a finding with the command that fixes it;
`--fix-format` runs that command. In Actions, where the consumer's tools are usually not installed,
it tells the model which tools are enforced and how, and flags one shape deterministically:
Markdown tables a Prettier-family formatter would rewrite.

| # | Decision | Why | ADR |
| --- | --- | --- | --- |
| 1 | A detector reads the repository's formatter and linter configs and where they are enforced (hooks, scripts, CI) | Both later steps need the same facts; reading files is free and deterministic | — |
| 2 | `wachiman local` runs the detected tools in check mode on the changed files, only from `node_modules/.bin` (or a binary on `PATH` for dprint), never fetched | A real check is the only reliable answer; no network, no new dependency | 0053 (new) |
| 3 | A tool whose config executes code (`*.js`, `*.mjs`, `*.cjs`, `*.ts` configs) runs only when the reviewed change does not touch that config | Reviewing someone else's branch must not run code that branch added | 0053 (new) |
| 4 | A formatter failure is a `fix` finding, topic `rules`, on line 0 of the file, with the exact fix command; linters report errors only, and only on lines the change added | It breaks the hook or CI, so it is not style; old warnings are not the change's fault | — |
| 5 | `--fix-format` runs the formatter's write mode on the files that failed, in the working tree, and never commits; linters are never auto-fixed | The owner asked for a self-fix; formatter output is safe to apply, linter fixes can change behaviour | 0053 (new) |
| 6 | Actions: the prompt gets an "enforced tooling" section, and the rule becomes "skip what the formatter fixes silently; report a file the enforced formatter would reject" | The model cannot run the tool there, but it can know the tool exists | — |
| 7 | Actions and local: a deterministic notice for a Markdown table whose rows are not padded to equal width, in a file a Prettier-family formatter covers | The exact failure that happened, caught without the tool; narrow on purpose | — |

## Open questions

1. **Running the tools in Actions.** The reusable workflow could install the consumer's
   dependencies (an `install-command` input) and run the same check as local. Default: not in this
   slice; the notice and the prompt cover Actions until a consumer asks.
2. **Severity when the tool is enforced only in CI, not in a hook.** Default: still `fix`; a red CI
   job blocks merge just as a hook blocks push.

## Out of scope

- The consumer's CI skipping its own format job on docs-only changes. That is the consumer's
  workflow (kaipu-record NIW2-793); Wachiman does not grade other jobs.
- Running a tool's full-repository check. Only changed files are checked, so problems already on
  the base branch are not reported as the change's.
- Linter auto-fix, type checkers, test runners.
- Installing a missing tool. A tool that is configured but not installed is reported as "not
  checked", never fetched.

## Failures this must protect against

1. A changed file the repository's formatter rejects passes review with no finding (the incident).
2. Reviewing an untrusted branch locally executes code that branch added, through a JavaScript
   config of ESLint, Prettier or another tool.
3. Pre-existing lint warnings or errors in a touched file are reported as the change's.
4. A tool that is configured but not installed, times out or crashes produces a finding instead of
   "not checked".
5. `--fix-format` rewrites a file the change did not touch, or a file whose working-tree copy has
   edits the reviewed snapshot does not (it would format text nobody reviewed and mix it into
   unrelated work).
6. A file the formatter ignores (`ignorePatterns`, `.prettierignore`, `biome.json` `files.ignore`)
   is reported, because the check passed the file explicitly.
7. Checking needs a network call or adds a dependency to Wachiman.
8. The deterministic table notice fires on a Markdown file no Prettier-family formatter covers.
9. The prompt section grows the prompt for repositories with no detected tooling.

## Acceptance criteria

- [ ] The detector recognises, at the reviewed head: oxfmt (`.oxfmtrc.json`, `.oxfmtrc.jsonc`),
      Prettier (`.prettierrc*`, `prettier.config.*`, a `prettier` key in `package.json`), Biome
      (`biome.json`, `biome.jsonc`), dprint (`dprint.json`, `.dprint.json`), ESLint
      (`eslint.config.*`, `.eslintrc*`) and oxlint (`.oxlintrc.json`). For each it records the
      config path, whether the config executes code, and where it is enforced: `lefthook.yml`,
      `.husky/*`, `.pre-commit-config.yaml`, `package.json` scripts, and `.github/workflows/*`
      steps that name the tool or a script that does. Fixture tests cover each tool.
- [ ] `wachiman local` runs each detected, installed tool once per review over the changed files
      it covers: `oxfmt --check`, `prettier --check`, `biome format` (check mode), `dprint check`,
      `eslint --format json`, `oxlint --format json`, with the snapshot as working directory and
      a 60-second limit per tool. Files the tool ignores are not passed (or the tool's
      no-error-on-unmatched flag is used where it has one).
- [ ] A formatter failure becomes a `fix` finding, topic `rules`, line 0, titled
      "`<tool>` rejects this file", whose body names where the tool is enforced and the fix
      command. A linter error becomes a `fix` finding on its line only when that line is an added
      line; warnings are dropped.
- [ ] A tool not installed, timed out, crashed, or skipped by decision 3 adds one line to the
      summary ("oxfmt: not checked, not installed") and no finding. Exit codes of the review do
      not change because of a tool that did not run.
- [ ] `--fix-format` runs the write mode of each formatter that failed, on its failed files, in
      the working tree; refuses a file whose working-tree content differs from the reviewed
      snapshot, naming it; prints the changed files; never stages or commits. In an interactive
      terminal without the flag, the end of the review offers the same action and defaults to no.
- [ ] Actions and local: when the detector finds tooling, the batch prompt gets an "Enforced
      tooling" section (tool, config, where enforced, file types covered), and the sentence
      "Skip praise, style a formatter would catch" becomes "Skip praise and style the enforced
      formatter fixes silently; a changed file it would reject breaks the hook or CI, so report
      it". With no tooling detected the prompt is byte-identical to today's (test).
- [ ] The table notice: for each changed `.md`/`.mdx` file covered by oxfmt, Prettier or dprint,
      a table whose rows differ in length, or whose separator cells are narrower than their
      column, yields one `consider` finding, topic `rules`, on the table's first line, worded the
      same every time, like `adrNotices`. A test replays the template file of kaipu-record#617.
- [ ] Docs: `docs/` gains a page on what is detected, what runs, and the security rule of
      decision 3; `wachiman local --help` lists `--fix-format`.

## Detail

### Why the laptop and not Actions

On the laptop the repository's dependencies are installed: the developer pushes from there and the
hooks need them. In Actions the reusable workflow checks the code out and runs the engine; the
consumer's `node_modules` is absent, and fetching the tools would add network calls and time to
every review. The prompt section and the table notice are what Actions can do for free.

### The security rule

ESLint flat config is always JavaScript; Prettier, oxlint and dprint accept JavaScript or
TypeScript configs too. Running the repository's binary with such a config executes whatever the
config imports. On the developer's own branch that is the same code their hooks already run. On a
branch from someone else (`wachiman local --from <their commit>`), a config the branch added or
changed would run on the reviewer's machine. Decision 3 closes that: such a tool runs only when
the reviewed range leaves its config untouched, which means the config is the one the developer
already runs. Declarative configs (JSON, JSONC, YAML, TOML) are read by the tool, not executed, and
always run.

### Why not reimplement the formatters

Prettier's Markdown, CSS and YAML printers are thousands of rules; a partial copy would disagree
with the real tool and produce false alarms. The one deterministic check here (decision 7) covers
the shape that actually broke a repository and is cheap to state exactly: padded, equal-width
table rows. Everything else is the real tool on the laptop, or the model's judgement in Actions.

### The template Wachiman itself installs

`wachiman pr-template` (NIW2-776) generates a Markdown file into consumer repositories. Its output
must already be in the form Prettier and oxfmt print, and its stamp must survive a formatter
rewrite; that requirement lives in the pr-template spec, not here (NIW2-795).
