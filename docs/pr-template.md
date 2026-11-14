# The PR description template

`wachiman pr-template` gives a repository one pull request description template, checks that a
description follows it, and puts a description back in order when it does not. It makes no model
call. Design: [the design spec](specs/2026-11-14-pr-template-command-design.md); the decisions
are [Wachiman owns the template, built from a section catalog](adr/0050-wachiman-owns-the-pr-description-template-built-from-a-section-catalog.md),
[a pull request is checked against its own template](adr/0051-a-pull-request-is-checked-against-its-own-template-and-locked-sections-come-from-wachiman.md)
and [the installed template is generated](adr/0052-the-installed-template-is-generated-and-repository-lines-live-in-the-repository-json.md).

## Why there is a template

A reviewer decides faster when every pull request answers the same questions in the same place:
what needs the owner, what changed, why, what proves it, and how risky it is. Without a template
each author invents an order, and the reader has to hunt.

Wachiman also reads the description. The review writes its summary into the description, between
`<!-- wachiman:confidence:start -->` and `<!-- wachiman:confidence:end -->`, and the fidelity grade
([PR Confidence](pr-confidence.md)) checks the claims the description makes against the diff. A
template that always carries that block, in the same place, is part of what Wachiman reviews.

The template is not a Markdown file to copy. It is generated from a section catalog that ships
with Wachiman (`templates/pr/sections.json`) plus an optional file of your own,
`.github/pr-template.json`. One source produces both the Markdown and the rules `check` applies, so
they cannot disagree.

## See it and install it

```sh
wachiman pr-template show
wachiman pr-template install
```

`show` prints the template this repository would get and writes nothing. With
`.github/pr-template.json` it prints your repository's template; `--from <json>` previews a
definition from another file.

`install` writes `.github/pull_request_template.md`. The only other file it writes is
`.github/pr-template.json`, when it adopts an existing template or copies a definition with
`--from`. It writes files only: it never pushes and never opens a pull request. Review the result
and commit it yourself, or let `install` make the commit:

```sh
wachiman pr-template install --commit
```

`--commit` makes one commit, with the message `docs: install the Wachiman PR description template`
(or `docs: update the PR description template to version N` for a file that already had a stamp).
The commit contains only the files `install` wrote in that run, so anything else you have staged
stays out. Git hooks run; `--no-verify` is never passed.

`wachiman init` can do the same step. `init --pr-template` installs the template after its workflow
work and never commits. `--no-pr-template` skips it. On a terminal, `init` asks, and the default is
yes. A script that gives neither flag gets no template. If the template is refused (for example,
someone edited it by hand) `init` says so and finishes the rest.

### The stamp and the status

The first line of the installed file is a stamp: the template version and a hash of everything
below it. The stamp is how Wachiman tells a file it generated from one someone edited.

```sh
wachiman pr-template status
wachiman pr-template status --json
```

`status` prints one of these states and exits 0 only for `current`. `--json` prints
`{"state", "version", "installedVersion"}`.

| State | What it means | What `install` does |
| --- | --- | --- |
| `missing` | There is no `.github/pull_request_template.md` | Writes it |
| `current` | The file matches what this Wachiman generates from your `.github/pr-template.json` | Nothing |
| `outdated` | The stamp is intact, but regenerating gives a different file: a newer catalog, or you changed `.github/pr-template.json` | Rewrites it, with no backup, because the file can be generated again |
| `edited by hand` | The file no longer matches its stamp | Refuses. `--force` replaces it and keeps a `.bak-<timestamp>` copy |
| `unmanaged` | A template with no stamp, written by someone | Adopts it (see below) |
| `invalid` | `.github/pr-template.json` does not parse or breaks a rule of the catalog | Refuses, and says which rule. Nothing falls back to another version |

"Outdated" compares against what your repository asked for, never against the default. A custom
template is not outdated only because it is custom.

Do not edit the generated file. Put your own lines in `.github/pr-template.json` and run `install`
again.

## Customise it

`.github/pr-template.json` is your repository's choice. Every key is optional:

```json
{
  "base": "default",
  "add": ["screenshots"],
  "drop": ["decisions"],
  "custom": [
    { "id": "migration-notes", "kind": "section", "heading": "Migration notes", "required": false, "after": "evidence" }
  ],
  "preamble": [
    "- [ ] **Outside contributors only:** I have read CLA.md and I accept it."
  ]
}
```

- `base` is the starting set. `default` is the only one today.
- `add` turns on a catalog section that is not in the default.
- `drop` removes an optional section of the default.
- `custom` adds a section of your own. `kind` is `status-row`, `section` or `details`; `after` is
  the `id` it follows (an unknown `id` is an error). A custom `heading`, label or summary cannot
  reuse a locked one.
- `preamble` is your own lines, rendered at the top of the template, above the status table. A CLA
  checkbox is the usual case.

After editing the file, run `wachiman pr-template install`. It regenerates the template and
`status` goes back to `current`. Without the file, a repository gets the default.

### The catalog

Locked sections are in every template. No repository can drop them, and a description without one
fails `check` whatever your JSON says. They are what Wachiman and the reviewer depend on in every
pull request.

| Part | What it is | Default | Notes |
| --- | --- | --- | --- |
| Status table: `Type`, `Issue`, `Rollout`, `Release`, `Evidence`, `Decisions` | Rows of the table at the top | Yes | Required |
| Status table: `Risk` | The risk of the change, with a reason | Yes | **Locked.** Cannot be below the floor `risk` computes |
| `## Needs you` | What only the owner can do or decide | Yes | **Locked.** Must not be empty; write "Nothing. Merge when checks are green." |
| `## What`, `## Why`, `## Evidence` | The answers a reviewer reads first | Yes | Required |
| `## Screenshots` | Before and after, on screen | No | `add` it; required once added |
| `## Decisions` | The decisions taken, each linked to its record | Yes | Optional; `drop` it |
| `Changes` (collapsed) | One row per change | Yes | At most seven rows |
| `How to test`, `Not verified`, `Checks`, `Agent context`, `Notes` (collapsed) | Detail for the reader who wants it | Yes | Optional |
| `Rollback` (collapsed) | How to undo | No | `add` it |
| The Wachiman block | The markers where the review writes its summary | Yes | **Locked** |
| The footer, `Describes commit {sha}.` | Which commit the description is about | Yes | **Locked.** The sha must be the head commit |

Placeholders are written `{sha}`, never `<sha>`: GitHub shows the first as text and hides the
second as an unknown HTML tag.

### Adopting a template you already have

If the repository already has a `.github/pull_request_template.md` without a stamp, `install`
adopts it instead of overwriting it:

- The template's own structure (guide comments, the status table, the sections, the collapsed
  blocks, the Wachiman block and the footer that the catalog knows) is replaced by the catalog's
  version. The old wording is not kept.
- A status row, `##` section or collapsed block the catalog does not know becomes a `custom`
  entry in `.github/pr-template.json`, optional, in its old position.
- Every other line (a checkbox, a note, a CLA reminder) moves to `preamble`, in its old order.

Nothing outside the template's own structure is dropped. `install` prints each line or block it
moved and each comment it treated as a guide comment, so a comment of yours that was misread as
guidance is visible. The old file is kept as `.github/pull_request_template.md.bak-<timestamp>`.

Adoption refuses when `.github/pr-template.json` already exists, unless you pass `--force`: both
files then get a backup and what the old file adds is merged into the JSON (new entries are
appended, existing ones are kept). `install --from <json>` copies a definition into
`.github/pr-template.json` first, and refuses to replace a different existing one without
`--force`. A `.bak` file is never staged or committed by `--commit`.

## Check a description

```sh
wachiman pr-template check body.md --title "feat: add login"
wachiman pr-template check --pr 42
```

`check` reports problems on stderr, one per line, as `<code>: <message>`, and prints `ok` when
there are none. Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | The description passes |
| `1` | It has at least one finding |
| `2` | A usage or configuration problem: a bad flag, an invalid `.github/pr-template.json`, a file that cannot be read, `git` or `gh` missing or failing |

**With a file**, `check` reads the description from disk and needs `--title`. It reads
`.github/pr-template.json` from the working tree, and compares the footer with `--head` (default:
`HEAD`) and the Risk row with the floor of the branch against `--base` (default: `origin/main`).

**With `--pr <n>`**, it reads the title, body, head commit, commits and changed files through `gh`
(`--repo <owner/name>` picks the repository; otherwise `gh` uses the one in the directory). It
reads `.github/pr-template.json` at the pull request's **head commit**, never from the working
tree, so a pull request that changes the template is checked against the template it brings. When
it does, `check` prints `checked against the template in this pull request`, and says what the base
branch's template (or the default, if the base has none) would report. The locked sections always
come from Wachiman, so a pull request cannot remove a rule that matters in the same change that
would have failed it. The risk rules file (below) is read from the base branch for the same reason.

The findings:

| Code | What it catches |
| --- | --- |
| `heading-missing`, `heading-order`, `heading-unknown` | A required heading is absent, headings are out of order, or a heading the template does not have |
| `section-missing`, `block-missing` | A section or the Wachiman block is not there |
| `status-row-missing` | A status table row is missing |
| `needs-you-empty` | `## Needs you` has nothing in it |
| `adr-bare-number` | An ADR is cited by its number alone; say what it decides and link it |
| `breaking-change` | The breaking-change footer text or a `!` in the title, anywhere in the body, comments included. A squash merge copies the description into the commit and the release tool would cut a major. `--allow-breaking` turns it off for a change that is meant to be breaking |
| `risk-unstated`, `risk-unverified`, `risk-below-floor` | The Risk row has no level, the floor could not be computed, or the stated level is below the floor |
| `footer-missing`, `footer-head-mismatch` | No footer commit, or a commit that is not the head |
| `details-unknown`, `details-order`, `changes-too-many-rows` | A collapsed block the template does not have, in the wrong order, or a Changes block with more than seven rows |

`check` looks at structure, not truth. It does not read whether the description is right; that is
what the review's fidelity grade is for.

## Put a description in order

```sh
wachiman pr-template format body.md
wachiman pr-template format body.md --write
```

`format` prints the description reordered to the template: sections and status rows in template
order, missing required headings added empty, unknown `##` sections moved into Notes, and the
Wachiman block and footer at the end. It never deletes or rewrites text; every line of the input
is in the output. Without a file it reads standard input. `--write` rewrites the file instead of
printing. It never edits a pull request on GitHub: pipe the output to `gh pr edit` yourself.

`strip` is the opposite step, for posting:

```sh
wachiman pr-template strip body.md
```

It prints the description without the guide comments and without the stamp, and keeps the Wachiman
block markers.

## Risk

```sh
wachiman pr-template risk
wachiman pr-template risk --base origin/develop
```

`risk` prints the lowest level the branch's diff allows (🟢 Low, 🟡 Medium or 🔴 High) and the rule
and file that set it, for example `🔴 High: authentication, sessions or permissions
(src/auth/login.ts)`. Files under `docs/` and test directories, and Markdown and plain-text files, never set a default risk. `--base` defaults
to `origin/main`; no fetch is made. `check` uses the same floor, and an author may raise the level
but never lower it.

A repository can add rules in `.github/pr-risk.toml`. The patterns can only raise the level:

```toml
[high]
paths = ["^vault/"]

[medium]
content = ["feature_flag"]
```

`paths` match file names; `content` matches added or removed lines. Patterns are regular
expressions (a leading `(?i)` makes one case-insensitive). The file is read from the base branch,
not from the pull request, so a pull request cannot lower its own floor. A file that does not parse
is reported and ignored.

**Known limit.** The risk rules here are a literal port of the checker this template grew with.
They differ from the review engine's own path weights on authentication and CI workflows (here
authentication is always High and a CI workflow is Medium) until the two tables are unified. Treat
the two as separate for now.

## Using it from a coding agent

1. `wachiman pr-template show` (or read `.github/pull_request_template.md`) to see the sections.
2. Write the description in that order. Start the Risk row from `wachiman pr-template risk`.
3. `wachiman pr-template format body.md --write` to put the sections in order.
4. `wachiman pr-template strip body.md` to remove the guide comments, and post that output.
5. `wachiman pr-template check body.md --title "<title>"` before opening the pull request, or
   `wachiman pr-template check --pr <n>` after.
6. To change a description that is already open, edit it and apply it with `gh pr edit <n>
   --body-file <file>`; `wachiman` does not edit a pull request on GitHub.

An older `wachiman` that does not have this command fails with `Unknown command "pr-template"` and
exit 2. A script that depends on it should check `wachiman --version` first.

## Where the files go

| File | Written by | Edit it? |
| --- | --- | --- |
| `.github/pull_request_template.md` | `install` | No. It is generated; `status` reports a change as `edited by hand` |
| `.github/pr-template.json` | You (or `install` when it adopts a template or copies `--from`) | Yes |
| `.github/pr-risk.toml` | You | Yes |
| `.github/pull_request_template.md.bak-<timestamp>` | `install` | A backup. Delete it when you no longer need it |
