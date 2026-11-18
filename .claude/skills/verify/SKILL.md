---
name: verify
description: Capture Wachiman CLI evidence without calling a real model.
---

# Verify the local CLI

Use the hub's HTTP and CLI recipe: capture commands, output, exit codes and
runtime as text under git-ignored `.evidence/<topic>/`. Never invoke the real
provider or read credentials for a verification run.

For working-tree review:

1. `bun test src/connectors/working-tree.test.ts`: real temporary repositories,
   staged/all, races, byte and index isolation, unsafe Git configuration,
   symlink parents, conflicts, split/sparse indexes, gitlinks and history.
2. `bun test src/local.test.ts -t working-tree`: real CLI subprocesses with a
   fake Claude executable and isolated HOME, output versions, input files,
   cleanup after errors/interruption. No model or GitHub call.
3. `bun test src/formats.test.ts`: both published versions and schema checks.
4. `bun test`: committed-mode and all other regressions. Record exit and counts.

Copy durable proof counts into the PR; text captures stay uncommitted. A local
macOS run does not establish native Linux or Windows compatibility. Do not
claim merge readiness without the independent review and current-head CI.

## Project onboarding

1. `bun test src/wizard src/init src/setup src/cli-wizards.test.ts src/cli-accounts.test.ts`:
   fixture homes, local/GitHub/both, cancellation, current-session defaults, subdirectories,
   worktrees, required-check failures and stdout contracts. No real credentials or models.
2. Run that suite on pinned Bun 1.3.4 as well as the local Bun when they differ. The synthetic
   editing fixture declares its own TERM; a real PTY is still needed to demonstrate a redraw.
3. For a terminal capture, use a temporary Git repository, scripted input and the test
   fake toolchain. Record whether the input is scripted or a real PTY. Capture local, both,
   invalid-answer and plain-output states before and after; keep exact output as text.
4. `bun test` on a stable tree, with no concurrent source edits. Record exit, counts and runtime.
5. `npm pack --ignore-scripts --pack-destination <evidence-dir>`, then run
   `scripts/verify-package.sh --tarball <packed-file>` and again with `--without-bun`.
   `--bundled-bun` additionally downloads the real dependency; none of these publishes.

Shell suggestions are parsed with a real POSIX shell by the command tests without invoking
Wachiman. Generated PowerShell strings do not establish native Windows validation.

## Review comment format and user-facing Markdown: before and after

Any change to what a reader sees on GitHub (the review body, an inline finding, a notice, a
published document) carries a before/after capture in its pull request. Internal documents that no
end user reads do not need one.

1. Write a manifest under `.evidence/<topic>/manifest.json`: one scenario per state the change
   touches, each with a `before` and an `after` source. Before is what is posted today (a real
   comment by id) or the file at the merge base; after is the new output: a golden file, the
   engine's output for a fixture, or the spec's example at the design head. Use the same data on
   both sides; when a template has a placeholder, `fill` it with the posted text. The script's
   header documents every source type.
2. `bun .claude/skills/verify/scripts/before-after.ts .evidence/<topic>/manifest.json --out .evidence/<topic> --png`.
   GitHub's own Markdown endpoint renders both sides, so a table, a `<details>` or a `<sub>` line
   looks as it will on the pull request. It writes `index.html` (side by side or stacked, dark or
   light, and a button that copies the Evidence table) and `<id>-before.png` / `<id>-after.png`.
   The text goes to api.github.com: only public text, never local review data.
3. Look at every PNG before using it. Then put the copied table in the pull request body and
   attach the images: `gh pr edit <n> --attach '<file>#<alt>'` for each, which rewrites the
   `./<file>.png` references in place. The images are never committed.
4. Each caption says where its side came from (a posted comment and its date, or a file at a
   commit). A capture proves how GitHub renders that Markdown, not that the engine produces it:
   until the engine emits the new format, the after side is the spec's example, and the Evidence
   row says so.
