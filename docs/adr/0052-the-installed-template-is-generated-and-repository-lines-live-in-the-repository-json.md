# ADR 0052: The installed template is generated; repository lines live in the repository JSON

- **Status:** proposed 2026-11-14. Not implemented.
- **Date:** 2026-11-14
- **Issue:** [NIW2-776](https://linear.app/niway/issue/NIW2-776/wachiman-build-install-check-and-format-the-pr-description-template)

## Context

Repositories already add their own lines to the template: this repository has an AI-disclosure and
a CLA checkbox at the top ([#227](https://github.com/niway-dev/wachiman/pull/227)); kaipu-record
keeps a CLA reminder comment ([#617](https://github.com/niway-dev/kaipu-record/pull/617)). An
update of the template must not lose them, and `status` must tell an outdated copy from one
someone edited.

Wachiman has two install patterns: `wachiman init` writes a versioned file, refuses to replace it
without `--force` and keeps a backup (`src/init/write.ts`); `wachiman skills install` records a
hash per file and leaves modified files alone (`src/skills/install.ts:151`).

## Decision

1. **`.github/pull_request_template.md` is generated** from the catalog and
   `.github/pr-template.json`, with a first-line stamp holding the catalog version and a sha256 of
   the rest of the file. It is not edited by hand.
2. **A repository's own lines live in `preamble`** in `.github/pr-template.json`, rendered at the
   top of the template.
3. **Adopting an unmanaged file** works on blocks: the parts the catalog knows (guide comments,
   status rows, sections, collapsed blocks, the Wachiman block, the footer) are replaced by the
   catalog's; unknown rows, sections and blocks become custom entries; every other block goes to
   `preamble`. A comment counts as a guide comment only beside a known element or when it matches
   the hand-copied template that preceded the catalog, in either of its two shapes (guides in the cells, or
   in one comment above the status table). Adoption keeps a backup, prints what moved
   and drops nothing outside the template's structure.
4. **A hand-edited file is never replaced without `--force`**, and `--force` keeps a timestamped
   backup in `.git/wachiman/backups`, outside the working tree, so `--commit` cannot stage it. A managed file is regenerated without a backup.
5. **`install` writes files only.** `--commit` is opt-in: one commit containing only the files the
   command wrote, a default `docs:` message, hooks run, nothing pushed. `init` does not commit
   (`src/init/run.ts:150`); `--commit` touches only template files, never code, so the review loop's
   rule of never editing code ([ADR 0034](0034-a-review-loop-driven-by-the-cli-that-never-edits-code.md))
   still holds.

## Alternatives rejected

- **A marked local block inside the Markdown.** Works, but leaves two places to edit (the block and
  the JSON) once the JSON exists.
- **A three-way merge of the whole file** (copier style). Conflicts someone must resolve, for a file
  that is generated anyway.
- **Opening the PR from the command.** Needs an account, a branch name and a push; the caller's
  tooling already does that.

## The stamp hashes a normalized body

The sha256 covers a normalized form of everything below the stamp line, not the raw bytes. A
repository's Markdown formatter (a pre-commit or pre-push hook running Prettier or oxfmt) rewrites
the padding of table cells, the width of separator rows, runs of blank lines and trailing spaces,
and an editor or a Windows checkout changes line endings. With a raw hash, one formatter run would
turn `status` into "edited by hand" and make `install` refuse the file, though nobody changed a
word. The normalization ignores exactly those things (trailing spaces, runs of spaces inside table
rows, separator dashes and alignment colons, runs of blank lines, CRLF) and nothing else: spaces in
other text and inside comments count, so a changed word, a deleted line or a changed guide comment
still reads "edited by hand". The same normalization is used wherever the file is compared with what
the repository asks for (current against outdated, the no-op check of `install`, adoption).

The generated Markdown is also what Prettier 3 and oxfmt print with default options, so a formatter
has nothing to rewrite in the first place; the normalization is the second line of defence for a
repository whose formatter is configured differently.

Consequence: a formatter-only rewrite of the installed file is not an edit. `status` stays `current`
and `install` writes nothing.

## Consequences

- One place to change a repository's template: its JSON. `status` reports missing, unmanaged,
  current, outdated or edited by hand.
- The stamp is an HTML comment that GitHub copies into every new PR description; `check` and
  `format` ignore it.
- A contributor who edits the Markdown directly sees `status` say "edited by hand", and the next
  install refuses until they move the change into the JSON or pass `--force`.

## Non-goals

- Syncing many repositories at once. The command works on the repository it runs in.

## Reopen if

- A repository needs lines inside a section, not only at the top, and the catalog's custom sections
  cannot express them.
- Contributors keep editing the Markdown by hand instead of the JSON.
