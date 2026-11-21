👮 **Wachiman** · 🟠 **1 to fix in this PR** · 2 to consider · whole PR at `e7ab617`

| At a glance | |
| --- | --- |
| **Findings** | 🔴 0 blockers · 🟠 1 to fix · 🟡 2 to consider · ⚪ 0 for your information (3) · 1 Important · 2 Nit |
| **Risk** | Low: no risk facts reported, no risky paths |
| **Coverage** | 16 of 16 files reviewed, whole pull request |
| **Read first** | `init/run.ts`, `setup/prompt.ts`, `setup/run.ts`, `profile-list.ts`, `init/prompt.ts` |

### To fix (1)

| | Where | Finding |
| --- | --- | --- |
| 🟠 Fix · Important · 🧪 tests | [`run.test.ts:114`](https://github.com/niway-dev/wachiman/blob/e7ab617c15866d2d375e5c444a41a3369c0294ca/src/setup/run.test.ts#L114) | The "Ctrl-C" case sends the literal text "^C", not Ctrl-C |

### To consider (2)

| | Where | Finding |
| --- | --- | --- |
| 🟡 Consider · Nit · ⚡ perf | [`github-login.ts:6`](https://github.com/niway-dev/wachiman/blob/e7ab617c15866d2d375e5c444a41a3369c0294ca/src/init/github-login.ts#L6) | \`gh api user\` blocks the prompt session for up to 10 s with no feedback, and can suggest the wrong host's login |
| 🟡 Consider · Nit · 📝 docs | [`setup/prompt.ts:40`](https://github.com/niway-dev/wachiman/blob/e7ab617c15866d2d375e5c444a41a3369c0294ca/src/setup/prompt.ts#L40) | Stale comment on \`declined\` |

<details><summary>What the change connects to (4 closed, 0 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Closed, with the lines they rest on**
- init suggests the operator from `gh api user` before asking for it (`src/init/prompt.ts:61`) — A muted line says "Signed in to GitHub as https://github.com/<login>; press Enter to use it." and the prompt default is that login. If it fails: A missing `gh`, a non-zero exit or a timeout gives `undefined` and the prompt has no default. `spawnSync` blocks the event loop for up to 10 s with no spinner. The failure is silent, which is accepta… Evidence: `src/init/github-login.ts:4-12`, `src/init/prompt.ts:61-66`, `src/init/run.ts:6-8`.
- Picking an account saves the binding without a confirm step, and a detected `~/.claude-<name>` directory is registered as an external profile (`src/setup/prompt.ts:137`) — One line, `local reviews of <repo> (...) will use the account "<name>"...; saved in <home>/config.json`, replaces the summary. If it fails: A name or directory that changed meanwhile fails under the lock in `save`. The `catch` in the run reports the effects and rethrows, so the failure is visible. The detected rows are filtered with the… Evidence: `src/setup/prompt.ts:120-126`, `src/setup/prompt.ts:137-141`, `src/setup/prompt.ts:185-189`, `src/setup/run.ts:152-158`, `src/setup/run.ts:251-271`, `src/accounts/commands.ts:250-265`.
- A re-run of init that finds an identical workflow skips the write and the question (`src/init/run.ts:201`) — "<path> is unchanged: it already holds what init would write." Then init goes on to settings and setup. A differing file gets "Replace the existing workflow? A .bak copy is kept." with a default of yes. If it fails: A file with CRLF line endings, for example after git autocrlf, compares as different and falls to the replace prompt. That is safe. A read error propagates as a normal exception. Evidence: `src/init/write.ts:30-50`, `src/init/write.ts:116-120`, `src/init/run.ts:198-218`, `src/init/run.ts:233-234`.
- A failed sign-in after setup saves ends the session with a neutral warning and keeps exit code 1 (`src/setup/run.ts:211`) — The session closes with "Saved. One step left: sign in to Claude (...)" instead of "Stopped.". For the default profile the shell-alias note is added. If it fails: When `closing` is passed but the prompter is owned by the setup run, the warning is written to `deps.closing` and never shown. Only tests do that. In production, init passes a shared prompter and the… Evidence: `src/setup/run.ts:172-179`, `src/setup/run.ts:205-228`, `src/accounts/commands.ts:612-618`, `src/init/run.ts:89-115`, `src/cli.ts:195-204`.

</details>

<details><summary>What the reviewer checked</summary>

The change is mostly sound. Dropping the binding confirm, the unchanged-workflow re-run, the neutral closing warning and the step totals all trace through consistently, and the docs match the code. The one real problem is in the tests: the \"Ctrl-C\" case in `src/setup/run.test.ts` sends the literal text `^C` and only passes through the end-of-input path. The `gh api user` call in init blocks the prompt for up to 10 s with no spinner, and one comment in `src/setup/prompt.ts` is stale. The command-contract spec in `docs/specs/` (outside this part, so not reported as a finding) still describes the old `Bind <repo> to <profile>?` question and the tag and workflow-file prompts.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost (estimate) |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 1 | 16 | 740 | 4 | reviewed | 17 | $0.56 |

</details>

<details><summary>Details of findings with no thread (1)</summary>

**Stale comment on `declined` (confidence high)** ([`setup/prompt.ts:40`](https://github.com/niway-dev/wachiman/blob/e7ab617c15866d2d375e5c444a41a3369c0294ca/src/setup/prompt.ts#L40))

The comment says `declined` means "the person said no to setting up this repository or to the final question". This change removes the final question. `declined` is now returned only from "Set up this repository?" at line 97. Update the comment so it does not suggest a second decline point.

</details>

<sub>Answer a finding in its thread: `Verdict: correct` or `Verdict: wrong`, and why.</sub>

<sub>Claude Sonnet 5.5 via Claude Code 2.1.304 · effort high · review · PR so far $0.56 over 1 automatic run · 16 in / 13k out / 580k cache read / 92k cache write · Claude subscription: API-equivalent estimate, not a bill · $0.56</sub>

<!-- wachi:auto -->

<!-- wachi:review -->

<!-- agent-review sha=e7ab617c15866d2d375e5c444a41a3369c0294ca -->