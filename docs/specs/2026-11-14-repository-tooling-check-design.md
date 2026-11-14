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
(`wachiman local`) it runs those tools in check mode on the changed files, with the binaries and
configs of the developer's own checkout, and reports each failure as a finding with the command
that fixes it; `--fix-format` runs that command. In Actions, where the consumer's tools are usually
not installed, it tells the model which tools are enforced and how, and flags one shape
deterministically: Markdown tables a Prettier-family formatter would rewrite.

| # | Decision | Why | ADR |
| --- | --- | --- | --- |
| 1 | A detector reads the repository's formatter and linter configs and where they are enforced (hooks, scripts, CI) | Both later steps need the same facts; reading files is free and deterministic | — |
| 2 | `wachiman local` runs the detected tools in check mode on the changed files, from the checkout's root with its own `node_modules/.bin`; nothing is fetched | A real check is the only reliable answer; no network, no new dependency | 0053 (new) |
| 3 | Tools run by default only on the developer's own work: every commit between the base and `HEAD` authored by the configured `user.email`, for ranges and working-tree reviews alike. Otherwise `--run-tooling` is needed | Running a repository's tools runs its code (configs, plugins, local rules); that is consent the developer gives for their own branch, not for someone else's | 0053 (new) |
| 4 | A formatter failure is a `fix` finding, topic `rules`, on line 0 of the file, with the exact fix command; linters report errors only, and only on lines the change added | It breaks the hook or CI, so it is not style; old warnings are not the change's fault | — |
| 5 | `--fix-format` runs the formatter's write mode on the files that failed, in the working tree, and never commits; linters are never auto-fixed; `loop` never sets it | The owner asked for a self-fix; formatter output is mechanical and safe to apply, linter fixes can change behaviour | 0053 (new) |
| 6 | Actions: the prompt gets an "enforced tooling" section, and the rule becomes "skip what the formatter fixes silently; report a file the enforced formatter would reject" | The model cannot run the tool there, but it can know the tool exists | — |
| 7 | Actions and local: a deterministic notice for a Markdown table whose separator cells are narrower than their column, or whose rows are not padded to equal width, in a file a Prettier-family formatter covers with `proseWrap` other than `never` | The exact failure that happened, caught without the tool; narrow on purpose | — |

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
- dprint. Its plugins are URLs it downloads on first use, which would break the no-network rule;
  revisit when a consumer uses it.
- Linter auto-fix, type checkers, test runners.
- Installing a missing tool. A tool that is configured but not installed is reported as "not
  checked", never fetched.

## Failures this must protect against

1. A changed file the repository's formatter rejects passes review with no finding (the incident).
2. Reviewing someone else's branch locally executes code that branch added: a JavaScript config, a
   plugin named in a JSON config, or a local rule file a config imports.
3. Pre-existing lint warnings or errors in a touched file are reported as the change's.
4. A tool that is configured but not installed, times out, crashes or rejects its own config
   produces a finding instead of "not checked".
5. `--fix-format` rewrites a file the change did not touch, or a file whose working-tree copy has
   edits the reviewed commit does not (it would format text nobody reviewed and mix it into
   unrelated work).
6. A file the formatter ignores (`ignorePatterns`, `.prettierignore`, `biome.json` `files`) is
   reported, because the check passed the file explicitly.
7. Checking makes a network call or adds a dependency to Wachiman.
8. The deterministic table notice fires on a table the formatter prints as it is: in a file no
   Prettier-family formatter covers, with `proseWrap: never` (globally or through an
   `overrides` entry), in a file the formatter ignores, inside a fenced code block, or on a file
   the real tool already checked.
9. The prompt section grows the prompt for repositories with no detected tooling.

## Acceptance criteria

- [ ] The detector recognises, at the reviewed head: oxfmt (`.oxfmtrc.json`, `.oxfmtrc.jsonc`),
      Prettier (`.prettierrc*`, `prettier.config.*`, a `prettier` key in `package.json`), Biome
      (`biome.json`, `biome.jsonc`), ESLint (`eslint.config.*`, `.eslintrc*`) and oxlint
      (`.oxlintrc.json`). For each it records the config path, the file extensions it covers
      (a built-in table per tool), the `proseWrap` setting where the tool has one, and where it is
      enforced: `lefthook.yml`, `.husky/*`, `.pre-commit-config.yaml`, `package.json` scripts, and
      `.github/workflows/*` steps that name the tool or a script that does. Fixture tests cover
      each tool.
- [ ] Where tools run: the working directory is the checkout's root (`--repo-dir`), so the tool
      finds the same `node_modules/.bin`, configs and plugins the developer's hooks use; a
      monorepo binary is looked up from the root's `node_modules/.bin` only. The files passed are
      the changed files' working-tree paths. A file whose working-tree content differs from the
      reviewed content is not passed and is listed as "not checked: edited since the review". The
      reviewed content is the head commit for a range, the index for `--working-tree staged`, and
      the working tree for `--working-tree all`.
- [ ] The consent rule of decision 3: tools run when every commit between the base and `HEAD`
      has the configured `user.email` as author. A `--working-tree` review applies the same check
      to the branch it sits on (no commits since the base passes). An unset or empty `user.email`
      never passes. Otherwise the summary says "tooling: not run, the branch has commits by
      others; pass --run-tooling to run it", and no tool runs. A developer with several
      identities passes `--run-tooling`. `--no-tooling` turns the step off. Tests: a range with
      one foreign commit, an unset `user.email`, a working-tree review on a colleague's branch.
- [ ] Per-file results, per tool: Prettier `--list-different` (exit 0 clean, 1 files listed, 2
      error); oxfmt `--list-different --no-error-on-unmatched-pattern`; Biome
      `format --reporter=json`; ESLint `--format json`; oxlint `--format json`. Every file is
      passed to the tool, which applies its own ignore files; the engine does not reimplement
      ignore rules. An exit code or output outside the documented ones counts as a crash: "not
      checked", with the first stderr line, and no finding.
- [ ] A formatter failure becomes a `fix` finding, topic `rules`, line 0, titled
      "`<tool>` rejects this file", whose body names where the tool is enforced and the fix
      command. A linter error becomes a `fix` finding on its line only when that line is an added
      line; warnings are dropped.
- [ ] A tool not installed, timed out (60 seconds per tool), crashed or not run under decision 3
      adds one summary line and no finding. The review's exit code does not change because of a
      tool that did not run.
- [ ] The summary lists every detected tool with its outcome (passed, N files rejected, not
      checked: reason), in terminal and Markdown output for both result versions. Result version
      2 gains an additive `tooling` array with the same facts, and
      `docs/formats/review-result.v2.schema.json` and `docs/formats/README.md` describe it.
      Version 1 is unchanged, so a v1 JSON consumer sees tool findings but cannot tell "passed"
      from "not checked"; the docs page says to use `--result-version 2` for that.
- [ ] `--fix-format` runs the write mode of each formatter that failed, on its failed files only,
      in the working tree; prints the changed files; never stages or commits. In an interactive
      terminal without the flag, the end of the review offers the same action and defaults to no.
- [ ] `loop` does not run the tooling step in this slice: its stop rule keys line-0 findings on
      the file's blob, so any edit would release a formatter finding whether or not it fixed the
      format. The developer runs `wachiman local` (or the hook) for tooling. `loop` never passes
      `--fix-format`.
- [ ] Modes: the tooling step runs only for the default range (`--base`) and `--working-tree`.
      `--commit`, `--from` and `--input` skip it with the summary line "tooling: not run for this
      mode"; `--input` has no checkout, and for the other two the head of the review is not the
      working tree's head.
- [ ] Prompt per mode. Actions, and any local review where no tool ran: the "Enforced tooling"
      section and the new sentence below. Local, when a tool ran: the section lists the tools that
      ran and says their results are already reported, so the model reports none for those
      files. `loop`: neither the section nor the new sentence; its prompt keeps today's sentence.
      A model finding on line 0 of a file a tool already rejected is dropped as a duplicate.
- [ ] When the detector finds tooling, the batch prompt gets an "Enforced
      tooling" section (tool, config, where enforced, file types covered), and the sentence
      "Skip praise, style a formatter would catch" becomes "Skip praise and style the enforced
      formatter fixes silently; a changed file it would reject breaks the hook or CI, so report
      it". With no tooling detected the prompt is byte-identical to today's (test).
- [ ] The table notice: for each changed `.md`/`.mdx` file covered by oxfmt or Prettier whose
      `proseWrap` is not `never`, a table outside fenced code blocks whose separator cells are
      narrower than their column, or whose rows differ in display width (emoji and East Asian
      wide characters count as two columns), yields one `consider` finding, topic `rules`, on
      the table's first line, worded the same every time, like `adrNotices`. It is skipped for a
      file the real tool checked in this run (the tool's result wins), for a file matching an
      entry of the tool's ignore list or an `overrides` glob (matched with `Bun.Glob`; a pattern it
      cannot read skips the notice: a missed notice is cheaper than a false one). Tests: the
      template file of kaipu-record#617 is flagged; its oxfmt output is not; a table inside a code
      fence is not; a file with `proseWrap: never` is not; a file in `.prettierignore` is not.
- [ ] Docs: `docs/` gains a page on what is detected, what runs, the consent rule and
      `--fix-format`; `wachiman local --help` lists `--fix-format`, `--run-tooling` and
      `--no-tooling`; README and `docs/cli.md`, which say the CLI never edits code, gain the one
      exception and its limits.

## Detail

### Why the laptop and not Actions

On the laptop the repository's dependencies are installed: the developer pushes from there and the
hooks need them. In Actions the reusable workflow checks the code out and runs the engine; the
consumer's `node_modules` is absent, and fetching the tools would add network calls and time to
every review. The prompt section and the table notice are what Actions can do for free.

### The consent rule

Running a repository's formatter or linter runs code from that repository: ESLint flat configs are
JavaScript, a JSON `.prettierrc` or `.oxlintrc.json` can name plugins that load JavaScript, and a
JavaScript config can import any local rule file. A rule keyed on "the config file did not change"
misses a changed plugin or rule file it imports, so this spec does not try to decide which files are
code. It keys on whose work it is instead. On a branch whose commits are all the developer's own, the
tools are the ones their hooks already run on commit and push. A range with commits by
anyone else needs `--run-tooling`, a deliberate choice the summary names. Authorship comes from
the commits' author email, which a hostile branch can forge; the rule protects against reviewing a
colleague's branch by accident, not against a forged author, and the docs page says so.

### Why `--fix-format` does not reopen ADR 0034

[ADR 0034](../adr/0034-a-review-loop-driven-by-the-cli-that-never-edits-code.md) rejected "the CLI
applies the fixes" because a reviewer that writes code is a different product. A formatter's write
mode is not a review fix: its output is decided by the repository's own tool, it touches only files
that tool rejected, it refuses a file with edits the review did not see, it never commits, and it
runs only when asked. Fixes for findings, and linter fixes, stay with the author or their agent.

### Why not reimplement the formatters

Prettier's Markdown, CSS and YAML printers are thousands of rules; a partial copy would disagree
with the real tool and produce false alarms. The one deterministic check here (decision 7) covers
the shape that actually broke a repository. Measured on 2026-11-14: Prettier 3 and oxfmt, with
default options, both print that template's status table padded, with rows of about 300
characters, well past the default `printWidth`. Prettier prints a too-wide table compact only when
`proseWrap` is `never`, which is why the notice reads that setting. Everything else is the real
tool on the laptop, or the model's judgement in Actions.

### The template Wachiman itself installs

`wachiman pr-template` (NIW2-776) generates a Markdown file into consumer repositories. Its output
must already be in the form Prettier and oxfmt print, and its stamp must survive a formatter
rewrite; that requirement lives in the pr-template spec, not here (NIW2-795).
