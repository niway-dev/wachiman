👮 **Wachiman** · ⚠️ **Partial: 52 of 82 files not reviewed** · 2 to fix in this PR · 1 question for you · 11 to consider · whole PR at `711da9e`

> ⚠️ **Partial review: 30 of 82 files reviewed.** 52 not reviewed: 42 because the pull request's budget was spent, 10 because a call ran out of its budget. They are listed under "Files not reviewed". Ask `/wachiman review <paths>` for the rest.

| At a glance | |
| --- | --- |
| **Findings** | 🔴 0 blockers · 🟠 2 to fix · 🟡 11 to consider · ⚪ 2 for your information (15) · 2 Important · 13 Nit |
| **Risk** | At least high: 52 files were not reviewed; top fact `irreversible` at `adopt.ts:97`, see Risk facts |
| **Needs a person** | 1 trade-off, in `run.test.ts:327` |
| **Coverage** | 30 of 82 files reviewed, whole pull request; 52 not reviewed, listed under Files not reviewed. Ask `/wachiman review <paths>` for the rest |
| **Read first** | `adopt.ts`, `cli.ts`, `args.ts`, `run.test.ts`, `catalog.ts` |

### To fix (2)

| | Where | Finding |
| --- | --- | --- |
| 🟠 Fix · Important · 🐛 bug | [`format.ts:362`](https://github.com/niway-dev/wachiman/blob/711da9ee6faf7775d0cbf396674413c8c19c7993/src/pr-template/format.ts#L362) | \`format --write\` can silently replace invalid UTF-8 bytes with U+FFFD |
| 🟠 Fix · Important · 🐛 bug | [`strip.ts:51`](https://github.com/niway-dev/wachiman/blob/711da9ee6faf7775d0cbf396674413c8c19c7993/src/pr-template/strip.ts#L51) | strip also removes a repository comment that follows a guide comment under a heading |

<details><summary>To consider (11)</summary>

| | Where | Finding |
| --- | --- | --- |
| 🟡 Consider · Nit · 📝 docs | [`gh.ts:24`](https://github.com/niway-dev/wachiman/blob/711da9ee6faf7775d0cbf396674413c8c19c7993/src/pr-template/gh.ts#L24) | Comment says no decision depends on a message, but \`ghFileAt\` decides on error text |
| 🟡 Consider · Nit · 🐛 bug | [`install.ts:240`](https://github.com/niway-dev/wachiman/blob/711da9ee6faf7775d0cbf396674413c8c19c7993/src/pr-template/install.ts#L240) | If the template write fails after the JSON was written, the repository is left half-updated |
| 🟡 Consider · Nit · 🐛 bug | [`pr-risk.ts`](https://github.com/niway-dev/wachiman/blob/711da9ee6faf7775d0cbf396674413c8c19c7993/src/pr-template/pr-risk.ts) | \`DEFAULT_EXCLUDE\` does not exclude \`*.test.ts\` or \`*.spec.ts\`, so sample text in a TypeScript test can set the risk floor to High |
| 🟡 Consider · Nit · 🧹 cleanup | [`strip.ts`](https://github.com/niway-dev/wachiman/blob/711da9ee6faf7775d0cbf396674413c8c19c7993/src/pr-template/strip.ts) | A minor issue in \`strip.ts\` (the old body does not say which) |
| 🟡 Consider · Nit · 🧹 cleanup | [`run.ts:116`](https://github.com/niway-dev/wachiman/blob/711da9ee6faf7775d0cbf396674413c8c19c7993/src/init/run.ts#L116) | The partial-install report in \`init\` depends on parsing install's stderr text |
| 🟡 Consider · Nit · 🐛 bug | [`run.ts:132`](https://github.com/niway-dev/wachiman/blob/711da9ee6faf7775d0cbf396674413c8c19c7993/src/init/run.ts#L132) | \`init\`'s clock is not passed to the template install |
| 🟡 Consider · Nit · 🐛 bug | [`run.ts:140`](https://github.com/niway-dev/wachiman/blob/711da9ee6faf7775d0cbf396674413c8c19c7993/src/init/run.ts#L140) | An explicit \`--pr-template\` that fails still exits 0 |
| 🟡 Consider · Nit · 🐛 bug | [`adopt.ts:97`](https://github.com/niway-dev/wachiman/blob/711da9ee6faf7775d0cbf396674413c8c19c7993/src/pr-template/adopt.ts#L97) | Text under a custom section is moved to the top of the template, away from its heading |
| 🟡 Consider · Nit · 🧪 tests | [`check-run.test.ts`](https://github.com/niway-dev/wachiman/blob/711da9ee6faf7775d0cbf396674413c8c19c7993/src/pr-template/check-run.test.ts) | \`check-run.test.ts\` writes \`body.md\` into the shared temp directory and never removes it |
| 🟡 Consider · Nit · 🧪 tests | [`catalog.test.ts`](https://github.com/niway-dev/wachiman/blob/711da9ee6faf7775d0cbf396674413c8c19c7993/src/pr-template/catalog.test.ts) | The \`<sha>\` footer case never reaches the branch it names |
| 🟡 Consider · Nit · 🧪 tests | [`catalog.test.ts`](https://github.com/niway-dev/wachiman/blob/711da9ee6faf7775d0cbf396674413c8c19c7993/src/pr-template/catalog.test.ts) | The broken-catalog table drops its case names |

</details>

### Questions for you (1)

- [`run.test.ts:327`](https://github.com/niway-dev/wachiman/blob/711da9ee6faf7775d0cbf396674413c8c19c7993/src/init/run.test.ts#L327) · trade-off — The interactive template question defaults to Yes, so pressing Enter adopts and replaces a team's existing PR template. Only a `.bak` copy and the prompt wording protect it. Whether the default should be No for an existing file is a product decision.

### Risk facts

- `irreversible` · [`adopt.ts:97`](https://github.com/niway-dev/wachiman/blob/711da9ee6faf7775d0cbf396674413c8c19c7993/src/pr-template/adopt.ts#L97) — Adoption rewrites an existing unmanaged template: its own wording is replaced by the catalog's and unknown lines are moved into `.github/pr-template.json`. Only the `.bak` copy keeps the original.
- `public-contract` · [`args.ts:13`](https://github.com/niway-dev/wachiman/blob/711da9ee6faf7775d0cbf396674413c8c19c7993/src/init/args.ts#L13) — `wachiman init` gains the flags `--pr-template` and `--no-pr-template`, and the interactive flow gains a new question.
- `public-contract` · [`cli.ts:353`](https://github.com/niway-dev/wachiman/blob/711da9ee6faf7775d0cbf396674413c8c19c7993/src/cli.ts#L353) — A new top-level `pr-template` command is added, with exit codes 0, 1 and 2 documented in the help.
- `public-contract` · [`run.test.ts:320`](https://github.com/niway-dev/wachiman/blob/711da9ee6faf7775d0cbf396674413c8c19c7993/src/init/run.test.ts#L320) — `wachiman init` gains an interactive PR-template question, default yes, that adopts and replaces an existing `.github/pull_request_template.md` (with a `.bak` copy). Scripted answer sequences and the `--pr-template` and `--no-pr-template` flags change as a result.

<details><summary>For your information (2)</summary>

| | Where | Finding |
| --- | --- | --- |
| ⚪ Info · Nit · 🏛️ adr | [`0052-…-json.md`](https://github.com/niway-dev/wachiman/blob/711da9ee6faf7775d0cbf396674413c8c19c7993/docs/adr/0052-the-installed-template-is-generated-and-repository-lines-live-in-the-repository-json.md) | Edits an accepted decision record |
| ⚪ Info · Nit · 🧪 tests | [`catalog.test.ts:368`](https://github.com/niway-dev/wachiman/blob/711da9ee6faf7775d0cbf396674413c8c19c7993/src/pr-template/catalog.test.ts#L368) | Some validation branches have no test |

</details>

<details><summary>What the change connects to (13 closed, 0 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Closed, with the lines they rest on**

- `wachiman init` now optionally installs the PR description template (flag `--pr-template`, `--no-pr-template`, or a terminal question) after the workflow work (`src/init/run.ts:116`) — stderr lines `wrote <file>...` from install, or `pr-template: not installed: <reason>` / `only part of the install was done`. In a fancy session the closing line says whether the template is in place (line 184). If it fails: Any throw from runInstall (UsageError, PrTemplateConfigError, fs errors) is caught and reported; init still returns 0 and the rest of init continues. A failure between the JSON write and the template… Evidence: `src/init/run.ts:116-146`, `src/init/run.ts:182-184`, `src/init/run.ts:193`, `src/init/run.ts:208`, `src/pr-template/install.ts:188-257`, `src/pr-template/install.ts:216-220`, `src/init/prompt.ts:60-66`, `src/wizard/interactive.ts:25`.
- `wachiman pr-template` is dispatched from main (`src/cli.ts:353`) — New command, new help pages and a new row in the root help. If it fails: An unknown subcommand is a UsageError (run.ts:46). check, risk and strip handle their own tool errors with exit 2. Evidence: `src/cli.ts:297-302`, `src/cli.ts:328`, `src/cli.ts:353-356`, `src/pr-template/run.ts:42-87`, `src/help.ts:464`, `src/help.ts:575-581`, `src/pr-template/catalog.ts:14`.
- The init write mechanism is moved to src/pr-template/write.ts, and src/init/write.ts becomes thin wrappers (`src/init/write.ts:13`) — No change for init besides cleanup of a failed temporary file. If it fails: The temp-file write failing now unlinks the temp file in `finally`; an unlink error is swallowed as before. Evidence: `src/pr-template/write.ts:34-53`, `src/pr-template/write.ts:72-129`, `src/init/write.ts:13`, `src/init/write.ts:21-22`.
- `wachiman pr-template check --pr <n>` reads the PR's template from its head commit and the risk extension and base template from the base branch (`src/pr-template/check-run.ts:227`) — Findings are printed to stderr as `wachiman pr-template: <code>: <message>` and 'ok' goes to stdout. The exit code is 0, 1 for findings, or 2 for a UsageError or ToolError. If it fails: Every gh failure in the unconditional steps (ghPrView, the head template, the base extension) exits 2 with a visible message. A diff gh will not serve gives risk-unverified unless Risk is stated High… Evidence: `src/pr-template/check-run.ts:232-263`, `src/pr-template/check-run.ts:265-286`, `src/pr-template/gh.ts:148-158`, `src/pr-template/check.ts:276-277`.
- `loadRepoChoice` validates `.github/pr-template.json` against the catalog, and `resolveTemplate` places its custom entries (`src/pr-template/catalog.ts:345`) — A bad choice file throws PrTemplateConfigError, which is a UsageError, so check, install and the other commands exit 2 and name the offending key. If it fails: There is no fallback to the default template, and the error is visible. Evidence: `src/pr-template/catalog.ts:402-411`, `src/pr-template/resolve.ts:25-52`.
- checkDescription computes the risk floor with computeRisk when files are passed and no risk is (`src/pr-template/check.ts:271`) — risk-below-floor, risk-unstated or risk-unverified findings appear in the check result. If it fails: computeRisk errors are not caught in checkDescription. The caller supplies the files, so a failure while computing the floor is the caller's to report (the caller was not read). When neither files, r… Evidence: `src/pr-template/check.ts:268-282`, `src/pr-template/check.ts:62-71`, `src/pr-template/check-run.ts:313-317`.
- `pr-template format <file> --write` replaces the file through a temporary file (`src/pr-template/format.ts:322`) — stderr says `reordered <file>.` or `already in the template's order; nothing changed.` The file keeps its mode. If it fails: If the file changed since it was read, it throws UsageError and the exit code is 2. If the tmp write fails, the `finally` unlink removes the tmp and the target is untouched. The unlink can only hit a… Evidence: `src/pr-template/format.ts:322-339`, `src/pr-template/format.ts:354-362`, `src/pr-template/format.ts:379-383`, `src/pr-template/write.ts:87-112`.
- `pr-template install` overwrites the template and JSON, with backups for hand-made files, and optionally commits (`src/pr-template/install.ts:188`) — stderr says `wrote <path>; the earlier file is kept as <bak>`. With `--commit` the hash goes to stdout. If it fails: A refused or changed target throws UsageError (exit 2). If the template write fails after the JSON was written, the repository is left half-updated (see the finding). If `git add` or `git commit` fai… Evidence: `src/pr-template/install.ts:188-257`, `src/pr-template/install.ts:260-276`, `src/pr-template/write.ts:72-129`, `src/pr-template/render.ts:282-302`, `docs/adr/0052-the-installed-template-is-generated-and-repository-lines-live-in-the-repository-json.md:32-35`.
- `gh pr view`, `gh api contents`, `gh pr diff` and git reads through the injectable runner (`src/pr-template/gh.ts:107`) — `check-run` reports a ToolError as `error: ...` with exit 2, or as a warning for the risk and commit-message reads. If it fails: A fetch of the risk extension from the base branch that fails raises ToolError, so the risk floor is never lowered silently (check-run.ts:247-251). A failed diff fetch becomes `riskError`. A symlink… Evidence: `src/pr-template/gh.ts:26-30`, `src/pr-template/gh.ts:44-48`, `src/pr-template/gh.ts:77-85`, `src/pr-template/gh.ts:148-158`, `src/pr-template/check-run.ts:232-251`.
- `runPrTemplate` runs `git rev-parse --show-toplevel` in the given directory to find the root where the managed files are read and written (`src/pr-template/run.ts:34`) — Run from a subdirectory, `install` writes `.github/pull_request_template.md` at the repository top level, where GitHub reads it. If rev-parse fails inside a subdirectory, it writes under the subdirectory with no message. If it fails: A rev-parse failure other than 'not a repository' (for example `safe.directory` rejection) is indistinguishable from 'no git', so the managed file can land in the wrong place silently. This only affe… Evidence: `src/pr-template/run.ts:33-37`, `src/pr-template/run.ts:50`, `src/pr-template/gh.ts:26-30`, `src/pr-template/gh.ts:44-48`.
- The default runner for `check`, `strip` and `risk` is built from `defaultRunner`, with `cwd` defaulting to the repository root (`src/pr-template/run.ts:54`) — `check <file>` from a subdirectory finds the file relative to the directory given and the template at the top level. If it fails: A missing tool returns code 127 from `defaultRunner`, which surfaces as a `ToolError` and exit 2 in `runCheck` and `runRisk`. `runStrip` makes no git or gh call. Evidence: `src/pr-template/run.ts:50-54`, `src/pr-template/check-run.ts:168-180`, `src/pr-template/check-run.ts:227-234`, `src/pr-template/gh.ts:148-152`.
- init calls runInstall (PR description template) after the workflow write, or after the workflow is declined (`src/init/run.ts:132`) — stderr lines `wrote .github/pull_request_template.md`, or `pr-template: not installed: <reason>`, or `only part of the install was done` with the files written and not written; the fancy session's closing line differs when only the template was installed. If it fails: Install refusals and errors are caught and printed (run.ts:134-144), so they are visible but do not change the exit code. A partial install leaves `.github/pr-template.json` without the template, and… Evidence: `src/init/run.ts:116-146`, `src/init/run.ts:180-185`, `src/init/run.test.ts:555-586`, `src/init/run-fancy.test.ts:53-59`.
- writeManagedFile replaces an existing target by rename, after a backup copy (`src/pr-template/write.ts:107`) — A UsageError says the file changed, or that a file appeared, and names the backup when one was made. If it fails: A change between the identity check and the rename is not covered (an inherent race). A backup made before a failed replace stays on disk and the error message names it. Evidence: `src/pr-template/write.ts:84-127`, `src/init/write.ts:13-22`, `src/pr-template/install.ts:241-244`.

</details>

<details><summary>What the reviewer checked</summary>

**Batch 1 of 13.** I found no blocker or bug in this part. `init` now optionally installs the template, and the shared write code in `src/pr-template/write.ts` keeps the old `init` behaviour. I read the adopt.ts rules against the loader's checks (name, guide, `after` and preamble rules) and found no adoption output the loader would reject. I only read the code and did not run it. The four findings are all at "consider":

- The partial-install report in `init` depends on parsing install's stderr text.
- `init`'s clock is not passed to the template install.
- An explicit `--pr-template` that fails still exits 0.
- Text under a custom section is moved to the top of the template, away from its heading.

**Batch 2 of 13.** I found no defects in `src/pr-template/catalog.ts` or `src/pr-template/check-run.ts`. The catalog and choice validation agrees with `resolveTemplate`. `run.ts` passes `fileBase` and the root consistently to `runCheck`, `runStrip` and `runRisk`. Every `gh` or `git` failure that matters is reported: it either exits 2 or becomes a `risk-unverified` finding, so the risk floor is never silently lowered. Two small inconsistencies are not worth a finding. `checkFile` reads the risk extension at the merge base, while `checkPr` reads it from the base branch tip. `checkFile` also treats an unreadable extension as `riskError`, where `checkPr` exits 2. The tests for these files are in other parts, so I did not review them.

**Batch 3 of 13.** I read both files in full and found nothing to report. I checked them against the catalog (`src/pr-template/catalog.ts`), `templates/pr/sections.json` (the footer text `Describes commit {sha}.`) and `LEVELS` in `src/pr-template/pr-risk.ts`. The footer pattern, line numbering, the locked-entry merge and the risk comparison all hold up.

**Batch 4 of 13.** I found one issue to fix and two to consider in this part. I read the four files in full, along with the code they call (`write.ts`, `describe.ts`, `check-run.ts`, `render.ts`, `run.ts`). The overwrite paths are safe: `format --write` and `install` both re-check the target just before replacing it, and `install` makes backups through the shared `writeManagedFile`.\n\n- **Fix, `format.ts:362`:** `format --write` reads the file as UTF-8, so invalid bytes become U+FFFD. It then writes that text back with no backup, and the \"no line lost\" guard cannot see it. This happens only when the file is out of order.\n- **Consider, `gh.ts:24`:** the comment says no decision depends on an error message, but `ghFileAt` decides a file is absent by matching `404` or `not found` in stderr.\n- **Consider, `install.ts:240`:** if the template write fails after the JSON was written, the repository is left half-updated. The error does not say so or tell the user to run `install --force`.\n\nI checked `legacy-guides.ts` for stale or wrong content and found none. I did not compare its texts with the version-0 fixture.\n\nADR 0052 still reads \"proposed … Not implemented\" while this code implements it. That is a docs matter outside this part's files."

**Batch 5 of 13.** I read all four files in full, plus `check-run.ts`, `gh.ts`, `catalog.ts` and the tests for `pr-risk` and `resolve`. I found no defect that blocks the merge. `resolve.ts` handles `after` chains correctly and `render.ts` stays consistent with the catalog's checks. The one remark is a `consider` on `pr-risk.ts`: `DEFAULT_EXCLUDE` does not exclude `*.test.ts` or `*.spec.ts`, so sample text in a TypeScript test can set the risk floor to High. `run.ts` has one silent fallback: a failed `git rev-parse` sends the managed files to the given directory instead of the repository top level. I cover it in a contract entry, not a finding.

**Batch 6 of 13.** I found one bug and one minor issue, both in `src/pr-template/strip.ts`. The bug: `isGuide` skips over comments when it looks for the preceding content line. So a repository's own comment placed after a guide comment under a heading is also stripped, which contradicts the file's header and how `adopt.ts` treats the second comment. `src/pr-template/write.ts` re-checks the target's identity before the rename and links new files into place, so its destructive steps are safe. The init changes and the tests in this part are consistent with `src/init/run.ts`. Nothing else came up.

**Batch 7 of 13.** Both test files are accurate against catalog.ts, check-run.ts, gh.ts and check.ts. I traced every assertion I could and found no wrong expectation. The diff shows `Bell\^G` at catalog.test.ts:169, but the file contains the real escape `\^G`, so that case does test a control character. The findings are all about test quality: `check-run.test.ts` writes `body.md` into the shared temp directory and never removes it, the `<sha>` footer case never reaches the branch it names, the broken-catalog table drops its case names, and a few validation branches have no test (listed in one info note).

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost (estimate) |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 13 | 8 | 709 | 4 | reviewed | 25 | $0.65 |
| Batch 2 of 13 | 2 | 757 | 4 | reviewed | 12 | $0.25 |
| Batch 3 of 13 | 2 | 706 | 4 | reviewed | 5 | $0.17 |
| Batch 4 of 13 | 4 | 865 | 4 | reviewed | 11 | $0.47 |
| Batch 5 of 13 | 4 | 881 | 4 | reviewed | 12 | $0.40 |
| Batch 6 of 13 | 8 | 860 | 4 | reviewed | 19 | $0.44 |
| Batch 7 of 13 | 2 | 806 | 2 | reviewed | 14 | $0.43 |
| Batch 8 of 13 | 10 | 957 | 2 | 10 file(s) left: budget spent | 4 | $0.18 |
| Batch 9 of 13 | 25 | 945 | 2 | not run: budget spent | 0 | $0.00 |
| Batch 10 of 13 | 5 | 876 | 2 | not run: budget spent | 0 | $0.00 |
| Batch 11 of 13 | 1 | 615 | 2 | not run: budget spent | 0 | $0.00 |
| Batch 12 of 13 | 4 | 985 | 2 | not run: budget spent | 0 | $0.00 |
| Batch 13 of 13 | 7 | 705 | 4 | not run: budget spent | 0 | $0.00 |

</details>

<details><summary>Files not reviewed (52)</summary>

**Because the pull request's budget was spent (42)**

- `README.md`
- `docs/adr/0052-the-installed-template-is-generated-and-repository-lines-live-in-the-repository-json.md`
- `docs/cli.md`
- `docs/pr-template.md`
- `docs/specs/2026-11-14-pr-template-command-design.md`
- `src/pr-template/fixtures/check/valid-custom.md`
- `src/pr-template/fixtures/check/valid-decisions.md`
- `src/pr-template/fixtures/check/valid.md`
- `src/pr-template/fixtures/format/custom-template.expected.md`
- `src/pr-template/fixtures/format/custom-template.json`
- `src/pr-template/fixtures/format/custom-template.md`
- `src/pr-template/fixtures/format/in-order.expected.md`
- `src/pr-template/fixtures/format/in-order.md`
- `src/pr-template/fixtures/format/missing-required.expected.md`
- `src/pr-template/fixtures/format/missing-required.md`
- `src/pr-template/fixtures/format/repo-comment.expected.md`
- `src/pr-template/fixtures/format/repo-comment.md`
- `src/pr-template/fixtures/format/sections-shuffled.expected.md`
- `src/pr-template/fixtures/format/sections-shuffled.md`
- `src/pr-template/fixtures/format/status-rows-shuffled.expected.md`
- `src/pr-template/fixtures/format/status-rows-shuffled.md`
- `src/pr-template/fixtures/format/unknown-details.expected.md`
- `src/pr-template/fixtures/format/unknown-details.md`
- `src/pr-template/fixtures/format/unknown-section-new-notes.expected.md`
- `src/pr-template/fixtures/format/unknown-section-new-notes.md`
- `src/pr-template/fixtures/format/unknown-section.expected.md`
- `src/pr-template/fixtures/format/unknown-section.md`
- `src/pr-template/fixtures/format/wachiman-middle.expected.md`
- `src/pr-template/fixtures/format/wachiman-middle.md`
- `src/pr-template/fixtures/golden/custom-choice.json`
- `src/pr-template/fixtures/golden/custom-template.md`
- `src/pr-template/fixtures/golden/default-template.md`
- `src/pr-template/fixtures/golden/load.ts`
- `src/pr-template/format.test.ts`
- `src/pr-template/gh.test.ts`
- `src/pr-template/install.test.ts`
- `src/pr-template/pr-risk.test.ts`
- `src/pr-template/render.test.ts`
- `src/pr-template/resolve.test.ts`
- `src/pr-template/run.test.ts`
- `src/pr-template/strip.test.ts`
- `templates/pr/sections.json`

**Because a call ran out of its budget (10)**

- `src/pr-template/check.test.ts`
- `src/pr-template/describe.test.ts`
- `src/pr-template/fixtures/adopt/team-template.md`
- `src/pr-template/fixtures/adopt/version-0-formatted.md`
- `src/pr-template/fixtures/adopt/version-0.md`
- `src/pr-template/fixtures/check/block-with-review.md`
- `src/pr-template/fixtures/check/breaking-in-comment.md`
- `src/pr-template/fixtures/check/custom-template.json`
- `src/pr-template/fixtures/check/diffs/three-files.diff`
- `src/pr-template/fixtures/check/load.ts`

</details>

<details><summary>Details of findings with no thread (2)</summary>

**Edits an accepted decision record** ([`0052-…-json.md`](https://github.com/niway-dev/wachiman/blob/711da9ee6faf7775d0cbf396674413c8c19c7993/docs/adr/0052-the-installed-template-is-generated-and-repository-lines-live-in-the-repository-json.md))

This pull request edits an accepted decision record. If the change supersedes a decision, say so in the record.

**Some validation branches have no test (confidence medium)** ([`catalog.test.ts:368`](https://github.com/niway-dev/wachiman/blob/711da9ee6faf7775d0cbf396674413c8c19c7993/src/pr-template/catalog.test.ts#L368))

`loadRepoChoice` throws `"<id>" is both added and dropped` (`catalog.ts:368`), but no test covers it. `rollback` is the id that would reach it, because `screenshots` is required and fails earlier. The same applies to a custom `status-row` or `details` entry that repeats the name of another custom entry of the same kind (`catalog.ts:397`), and to the catalog rule that a `block` or `footer` must be locked (`catalog.ts:232`, `catalog.ts:236`).

</details>

<sub>Answer a finding in its thread: `Verdict: correct` or `Verdict: wrong`, and why.</sub>

<sub>Claude Sonnet 5.5 via Claude Code 2.1.304 · effort high · review · 13 batches · PR so far $3.01 over 1 automatic run · 110 in / 87k out / 2.7M cache read / 454k cache write · Claude subscription: API-equivalent estimate, not a bill · $3.01</sub>

<!-- wachi:auto -->

<!-- wachi:review -->

<!-- wachi:partial sha=711da9ee6faf7775d0cbf396674413c8c19c7993 state=eyJyIjpbIlJFQURNRS5tZCIsImRvY3MvYWRyLzAwNTItdGhlLWluc3RhbGxlZC10ZW1wbGF0ZS1pcy1nZW5lcmF0ZWQtYW5kLXJlcG9zaXRvcnktbGluZXMtbGl2ZS1pbi10aGUtcmVwb3NpdG9yeS1qc29uLm1kIiwiZG9jcy9jbGkubWQiLCJkb2NzL3ByLXRlbXBsYXRlLm1kIiwiZG9jcy9zcGVjcy8yMDI2LTExLTE0LXByLXRlbXBsYXRlLWNvbW1hbmQtZGVzaWduLm1kIiwic3JjL3ByLXRlbXBsYXRlL2NoZWNrLnRlc3QudHMiLCJzcmMvcHItdGVtcGxhdGUvZGVzY3JpYmUudGVzdC50cyIsInNyYy9wci10ZW1wbGF0ZS9maXh0dXJlcy9hZG9wdC90ZWFtLXRlbXBsYXRlLm1kIiwic3JjL3ByLXRlbXBsYXRlL2ZpeHR1cmVzL2Fkb3B0L3ZlcnNpb24tMC1mb3JtYXR0ZWQubWQiLCJzcmMvcHItdGVtcGxhdGUvZml4dHVyZXMvYWRvcHQvdmVyc2lvbi0wLm1kIiwic3JjL3ByLXRlbXBsYXRlL2ZpeHR1cmVzL2NoZWNrL2Jsb2NrLXdpdGgtcmV2aWV3Lm1kIiwic3JjL3ByLXRlbXBsYXRlL2ZpeHR1cmVzL2NoZWNrL2JyZWFraW5nLWluLWNvbW1lbnQubWQiLCJzcmMvcHItdGVtcGxhdGUvZml4dHVyZXMvY2hlY2svY3VzdG9tLXRlbXBsYXRlLmpzb24iLCJzcmMvcHItdGVtcGxhdGUvZml4dHVyZXMvY2hlY2svZGlmZnMvdGhyZWUtZmlsZXMuZGlmZiIsInNyYy9wci10ZW1wbGF0ZS9maXh0dXJlcy9jaGVjay9sb2FkLnRzIiwic3JjL3ByLXRlbXBsYXRlL2ZpeHR1cmVzL2NoZWNrL3ZhbGlkLWN1c3RvbS5tZCIsInNyYy9wci10ZW1wbGF0ZS9maXh0dXJlcy9jaGVjay92YWxpZC1kZWNpc2lvbnMubWQiLCJzcmMvcHItdGVtcGxhdGUvZml4dHVyZXMvY2hlY2svdmFsaWQubWQiLCJzcmMvcHItdGVtcGxhdGUvZml4dHVyZXMvZm9ybWF0L2N1c3RvbS10ZW1wbGF0ZS5leHBlY3RlZC5tZCIsInNyYy9wci10ZW1wbGF0ZS9maXh0dXJlcy9mb3JtYXQvY3VzdG9tLXRlbXBsYXRlLmpzb24iLCJzcmMvcHItdGVtcGxhdGUvZml4dHVyZXMvZm9ybWF0L2N1c3RvbS10ZW1wbGF0ZS5tZCIsInNyYy9wci10ZW1wbGF0ZS9maXh0dXJlcy9mb3JtYXQvaW4tb3JkZXIuZXhwZWN0ZWQubWQiLCJzcmMvcHItdGVtcGxhdGUvZml4dHVyZXMvZm9ybWF0L2luLW9yZGVyLm1kIiwic3JjL3ByLXRlbXBsYXRlL2ZpeHR1cmVzL2Zvcm1hdC9taXNzaW5nLXJlcXVpcmVkLmV4cGVjdGVkLm1kIiwic3JjL3ByLXRlbXBsYXRlL2ZpeHR1cmVzL2Zvcm1hdC9taXNzaW5nLXJlcXVpcmVkLm1kIiwic3JjL3ByLXRlbXBsYXRlL2ZpeHR1cmVzL2Zvcm1hdC9yZXBvLWNvbW1lbnQuZXhwZWN0ZWQubWQiLCJzcmMvcHItdGVtcGxhdGUvZml4dHVyZXMvZm9ybWF0L3JlcG8tY29tbWVudC5tZCIsInNyYy9wci10ZW1wbGF0ZS9maXh0dXJlcy9mb3JtYXQvc2VjdGlvbnMtc2h1ZmZsZWQuZXhwZWN0ZWQubWQiLCJzcmMvcHItdGVtcGxhdGUvZml4dHVyZXMvZm9ybWF0L3NlY3Rpb25zLXNodWZmbGVkLm1kIiwic3JjL3ByLXRlbXBsYXRlL2ZpeHR1cmVzL2Zvcm1hdC9zdGF0dXMtcm93cy1zaHVmZmxlZC5leHBlY3RlZC5tZCIsInNyYy9wci10ZW1wbGF0ZS9maXh0dXJlcy9mb3JtYXQvc3RhdHVzLXJvd3Mtc2h1ZmZsZWQubWQiLCJzcmMvcHItdGVtcGxhdGUvZml4dHVyZXMvZm9ybWF0L3Vua25vd24tZGV0YWlscy5leHBlY3RlZC5tZCIsInNyYy9wci10ZW1wbGF0ZS9maXh0dXJlcy9mb3JtYXQvdW5rbm93bi1kZXRhaWxzLm1kIiwic3JjL3ByLXRlbXBsYXRlL2ZpeHR1cmVzL2Zvcm1hdC91bmtub3duLXNlY3Rpb24tbmV3LW5vdGVzLmV4cGVjdGVkLm1kIiwic3JjL3ByLXRlbXBsYXRlL2ZpeHR1cmVzL2Zvcm1hdC91bmtub3duLXNlY3Rpb24tbmV3LW5vdGVzLm1kIiwic3JjL3ByLXRlbXBsYXRlL2ZpeHR1cmVzL2Zvcm1hdC91bmtub3duLXNlY3Rpb24uZXhwZWN0ZWQubWQiLCJzcmMvcHItdGVtcGxhdGUvZml4dHVyZXMvZm9ybWF0L3Vua25vd24tc2VjdGlvbi5tZCIsInNyYy9wci10ZW1wbGF0ZS9maXh0dXJlcy9mb3JtYXQvd2FjaGltYW4tbWlkZGxlLmV4cGVjdGVkLm1kIiwic3JjL3ByLXRlbXBsYXRlL2ZpeHR1cmVzL2Zvcm1hdC93YWNoaW1hbi1taWRkbGUubWQiLCJzcmMvcHItdGVtcGxhdGUvZml4dHVyZXMvZ29sZGVuL2N1c3RvbS1jaG9pY2UuanNvbiIsInNyYy9wci10ZW1wbGF0ZS9maXh0dXJlcy9nb2xkZW4vY3VzdG9tLXRlbXBsYXRlLm1kIiwic3JjL3ByLXRlbXBsYXRlL2ZpeHR1cmVzL2dvbGRlbi9kZWZhdWx0LXRlbXBsYXRlLm1kIiwic3JjL3ByLXRlbXBsYXRlL2ZpeHR1cmVzL2dvbGRlbi9sb2FkLnRzIiwic3JjL3ByLXRlbXBsYXRlL2Zvcm1hdC50ZXN0LnRzIiwic3JjL3ByLXRlbXBsYXRlL2doLnRlc3QudHMiLCJzcmMvcHItdGVtcGxhdGUvaW5zdGFsbC50ZXN0LnRzIiwic3JjL3ByLXRlbXBsYXRlL3ByLXJpc2sudGVzdC50cyIsInNyYy9wci10ZW1wbGF0ZS9yZW5kZXIudGVzdC50cyIsInNyYy9wci10ZW1wbGF0ZS9yZXNvbHZlLnRlc3QudHMiLCJzcmMvcHItdGVtcGxhdGUvcnVuLnRlc3QudHMiLCJzcmMvcHItdGVtcGxhdGUvc3RyaXAudGVzdC50cyIsInRlbXBsYXRlcy9wci9zZWN0aW9ucy5qc29uIl0sInQiOltdfQ -->