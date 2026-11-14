# Design: `wachiman pr-template`, a PR description template built from a section catalog

- **Date:** 2026-11-14
- **Issue:** [NIW2-776](https://linear.app/niway/issue/NIW2-776/wachiman-build-install-check-and-format-the-pr-description-template),
  a slice of item 1 of
  [NIW2-742](https://linear.app/niway/issue/NIW2-742/wachiman-check-the-description-format-in-ci-grade-every-review-round)
- **Status:** proposed. Nothing in this spec is implemented.

## Summary (one minute)

Wachiman gets its own PR description template and a command to show, install, report, check and
reorder it in any repository. The template is not a Markdown file someone copies: it is generated
from a JSON catalog of sections that Wachiman defines (`templates/pr/sections.json`). A repository
that wants something different writes a small `.github/pr-template.json` that adds catalog
sections, drops optional ones, or adds its own lines (a CLA checkbox, for instance). Some sections
are locked: the Risk row, `## Needs you`, the Wachiman block where the review writes its summary,
and the footer. No repository can drop them. The checker is a TypeScript port of the owner's
existing Python checker, with its rule lists moved into the catalog and its tests kept as the
contract. `install` writes files only; `--commit` makes the commit for whoever trusts the tool.

| # | Decision | Why | ADR |
| --- | --- | --- | --- |
| 1 | Wachiman owns the template; it ships in the npm package | The consumer runs it, so it is public. Wachiman also reads the description: the Wachiman block lives in it, and the fidelity grade checks its claims | 0050 (new) |
| 2 | The template is generated from a JSON section catalog; a repository's choice is `.github/pr-template.json` | One source for the Markdown and the rules, so they cannot disagree; customisation is bounded by what the catalog allows | 0050 (new) |
| 3 | Locked sections: Risk row, Needs you, the Wachiman block, the footer | They are what Wachiman and the reviewer depend on in every PR | 0050 (new) |
| 4 | The checker is a TypeScript port of `pr_body.py`; its tests become fixtures; its risk rules are ported literally | Consumers cannot run a script from a private repository; the product stays TypeScript on Bun ([ADR 0002](../adr/0002-typescript-on-bun-zero-dependencies.md)) | 0050 (new) |
| 5 | A PR is checked against its own `.github/pr-template.json`; locked sections come from Wachiman, never from the repository | Whoever changes the template wants to see it working in that PR; locked sections stop a PR from removing the rules that matter | 0051 (new) |
| 6 | The installed `.github/pull_request_template.md` is generated, stamped and never hand-edited; repository lines live in the repository JSON as a `preamble` | One place to edit; `status` can tell current, outdated and hand-edited apart | 0052 (new) |
| 7 | `install` writes files only; `--commit` is opt-in and makes one commit with the files it wrote | Nobody is forced; pushing and opening the PR stay with the caller's tooling | 0052 (new) |
| 8 | `format` reorders a description to the template's order, without deleting or rewriting text | Helps an author or agent meet the format without making it rigid | — |

## Open questions

1. **Sandbox repository for the end-to-end run.** Default: the build thread asks the owner before
   creating a private repository on the owner's personal account, and uses it only for the run in
   the last acceptance criterion.
2. **Where a repository's choice lives once `.wachiman.yml` exists.** The repository settings file
   (ADR 0048 in open PR [#232](https://github.com/niway-dev/wachiman/pull/232)) is for
   settings; the template definition is content, so it stays in `.github/pr-template.json`.
   Default: keep it separate; revisit if `.wachiman.yml` grows a section for templates.
3. **Which PostHog parts the default adopts.** Default: an `Agent context` collapsed block (how
   autonomous the change was, agent and model, skills used) replaces the "Written by" part of the
   footer; "files to review closely" waits until the risk map can fill it.

## Out of scope

- Running the check in CI, including the `pull_request` `edited` event (the next slice of NIW2-742).
- Grading each review round and team rules (other items of NIW2-742).
- Unifying the ported risk rules with the engine's `RISK_RULES` (item 5 of NIW2-742). Until then
  Wachiman holds two rule tables on purpose.
- An interactive template configurator. The JSON contract defined here is what it will edit.
- Opening pull requests or pushing. The caller does that.
- Switching the owner's private skills to the new command (a separate issue, after a release).

## Failures this must protect against

1. A first install over an existing template drops the repository's own lines (the wachiman copy
   has an AI-disclosure and a CLA checkbox at the top; kaipu-record keeps a CLA reminder comment,
   [kaipu-record#617](https://github.com/niway-dev/kaipu-record/pull/617)).
2. An update overwrites a template someone edited by hand.
3. A PR removes a rule that matters (the Risk row, the footer) in the same PR whose description it
   would have failed.
4. A template, or a comment in it, contains the literal breaking-change footer text; a squash
   merge copies the description into the commit body and the release tool cuts a major.
5. Footer placeholders written as `<model>` and `<sha>` render as invisible HTML tags on GitHub.
6. The port disagrees with `pr_body.py` on a case its test suite covers, or computes a different
   risk floor (authentication must stay High, CI workflows Medium).
7. `--commit` sweeps unrelated staged changes into the template commit, or skips hooks.
8. A custom template is reported "outdated" only because it differs from the default.
9. `format` loses text it does not recognise.
10. An older `wachiman` without the command is called by a skill that expects it.

## Acceptance criteria

- [ ] `templates/pr/sections.json` defines every section of the default template; `show`,
      `install` and `check` exit 2 with a message naming the section when
      `.github/pr-template.json` drops a locked section, and exit 2 naming the problem when the
      JSON does not parse or names an unknown section. None of them falls back to another version.
- [ ] `wachiman pr-template show` prints the default template; with `.github/pr-template.json` it
      prints that repository's template.
- [ ] `wachiman pr-template install` writes `.github/pull_request_template.md` generated from the
      catalog plus `.github/pr-template.json`; it refuses a hand-edited or unmanaged file without
      `--force`, and `--force` keeps a `.bak-<stamp>` copy.
- [ ] Installing over an unmanaged template replaces the template's own structure with the
      catalog's and keeps everything else, as described in "Adopting an unmanaged file"; the
      fixture made from this repository's copy keeps both checkboxes in `preamble`, drops the old
      guide comment and the old footer, and leaves no `<model>` or `<sha>` in the output.
- [ ] `install --commit` creates one commit containing only the files it wrote, with the message
      `docs: install the Wachiman PR description template` (or `docs: update the PR description
      template to version N`); without `--commit` nothing is committed; it never pushes and never
      passes `--no-verify`.
- [ ] `wachiman pr-template status` prints one of missing, current, outdated, edited by hand or
      unmanaged; exits 0 only for current; `--json` prints `{state, version, installedVersion}`.
- [ ] `wachiman pr-template check` passes every case of the Python checker's suite, ported as
      fixtures, plus: a custom required section missing; an optional section dropped; a
      description without a locked section fails whatever the JSON says.
- [ ] `check --pr <n>` on a PR that changes `.github/pr-template.json` uses that PR's version and
      prints `checked against the template in this pull request`.
- [ ] `check` reports the breaking-change marker anywhere in the body, comments included, and
      `install` refuses a template that contains it.
- [ ] `wachiman pr-template format` reorders sections and status rows to the template's order, adds
      missing required headings empty, moves unknown sections into Notes; on every fixture the
      output contains every line of the input.
- [ ] `wachiman pr-template risk [--base <ref>]` matches `pr_body.py risk` on the ported risk
      fixtures; `RISK_RULES` in `src/engine.ts` is unchanged.
- [ ] `wachiman init` offers to install the template (`--pr-template` / `--no-pr-template` for
      scripts).
- [ ] `docs/pr-template.md` says why the template exists and how to install, customise, check and
      format it; `wachiman pr-template --help` links it.
- [ ] End to end, with `scripts/dev-build.sh` on the build branch: in an empty sandbox repository,
      install Wachiman, run `wachiman-dev pr-template install --commit`, push, have an agent open a
      feature PR, and `wachiman-dev pr-template check --pr <n>` exits 0. Screenshots of the PR page
      go in the Evidence.

---

## Detail

### Why Wachiman has a template at all

A reviewer decides faster when every PR answers the same questions in the same place: what needs
the owner, what changed, why, what proves it, how risky it is. The format grew in the owner's
private skills (merged there on 2026-11-13) and was copied by hand into three repositories,
including this one ([#227](https://github.com/niway-dev/wachiman/pull/227)). The other
repositories never got it, and nothing said so.

Wachiman has its own reason to care. The review writes its summary into the description between
`<!-- wachiman:confidence:start -->` and `<!-- wachiman:confidence:end -->`
(`src/fidelity/digest.ts:9`), and the fidelity grade
([ADR 0033](../adr/0033-a-fidelity-grade-the-engine-computes-from-checked-claims.md)) checks the
claims the description makes. A template that always carries that block, in the same place, is
part of what Wachiman reviews.

The structure takes from the template the owner already uses and from
[PostHog's](https://github.com/PostHog/posthog/blob/master/.github/pull_request_template.md):
a short body that stands alone, release status stated plainly, and agent context (who or what
wrote the change) declared.

### The catalog

`templates/pr/sections.json` ships in the package (`templates/` is already in `files`,
[ADR 0028](../adr/0028-the-npm-package-installs-bun-itself-behind-a-node-launcher-and-no-windows-executable.md)).
Illustrative shape; the build fixes the exact field names:

```jsonc
{
  "version": 1,
  "sections": [
    { "id": "type",       "kind": "status-row", "label": "Type",     "locked": false, "default": true },
    { "id": "risk",       "kind": "status-row", "label": "Risk",     "locked": true,  "rule": "risk-floor" },
    { "id": "needs-you",  "kind": "section",    "heading": "Needs you", "locked": true, "rule": "not-empty" },
    { "id": "decisions",  "kind": "section",    "heading": "Decisions", "required": false, "default": true },
    { "id": "screenshots","kind": "section",    "heading": "Screenshots", "required": true, "default": false },
    { "id": "changes",    "kind": "details",    "summary": "Changes", "rule": "max-rows:7" },
    { "id": "agent-context", "kind": "details", "summary": "Agent context", "default": true },
    { "id": "wachiman",   "kind": "block",      "start": "<!-- wachiman:confidence:start -->", "locked": true },
    { "id": "footer",     "kind": "footer",     "text": "Describes commit {sha}.", "locked": true, "rule": "commit-is-head" }
  ]
}
```

Each section carries its guide comment (the text that tells the author what goes there). The
order in the catalog is the order in the template. `default: true` sections make up the default
template; `default: false` sections are offered by the catalog for a repository to add.

A repository's choice, `.github/pr-template.json`:

```jsonc
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

`preamble` is the repository's own lines, rendered at the top. Without this file the repository
gets the default.

### The installed file

```markdown
<!-- wachiman:pr-template version=1 sha256=<hash of everything below this line> -->
- [ ] **Outside contributors only:** I have read CLA.md and I accept it.

| | |
|---|---|
| **Type** | <!-- One of: Feature, Fix, Refactor, Docs, Chore, CI --> |
…
<!-- wachiman:confidence:start -->
<!-- wachiman:confidence:end -->

<sub>Describes commit {sha}.</sub>
```

Placeholders are `{sha}`-style, which GitHub shows as text, never `<sha>`. Example issue keys in
guide comments are neutral (`ABC-123`). The first comment names `wachiman pr-template check`, not
any private repository.

### Status

| State | Meaning | `install` without `--force` |
| --- | --- | --- |
| missing | No `.github/pull_request_template.md` | Writes it |
| unmanaged | A file with no stamp | Adopts it (below), and prints what moved |
| current | Stamp hash matches the file, and regenerating gives the same file | Nothing to do |
| outdated | Stamp hash matches, but regenerating gives a different file (new catalog version or a changed `pr-template.json`) | Rewrites it |
| edited by hand | The file no longer matches its stamp hash | Refuses; `--force` keeps a backup |

"Outdated" compares against what the repository asked for (its JSON), never against the default,
so a custom template is not outdated only because it is custom.

### Adopting an unmanaged file

Recognition works on blocks, not lines. The old file is split into the template's own structure
and the rest:

| Part of the old file | What happens |
| --- | --- |
| Guide comments, the status table, `##` sections, `<details>` blocks, the Wachiman block and the footer whose label, heading or summary the catalog knows | Replaced by the catalog's version; the old wording is not kept |
| A status row, `##` section or `<details>` block the catalog does not know | Becomes a `custom` entry in `.github/pr-template.json`, optional, in its old position |
| Any other line (checkboxes, notes, a CLA reminder) | Goes to `preamble`, in its old order |

The command prints each moved line or block. Nothing outside the template's own structure is
dropped.

### Writing files

The file writes reuse the protections of `src/init/write.ts` (refuses symlinks, temp file and
rename), generalised so its names and messages are not about workflows. Backups differ from
`init`: a managed file (current or outdated) is regenerable, so rewriting it makes no backup; only
`--force` over a hand-edited or unmanaged file writes `<file>.bak-<stamp>`. The backup is never
staged or committed by `--commit`.

### The checker

`pr_body.py` (owner's private skills, about 680 lines, standard library) has three subcommands:
`risk`, `check` and `strip`. `check` enforces headings and their order, the seven status rows, a
non-empty Needs you, no ADR cited by bare number, no `!` title or breaking-change marker without
`--allow-breaking` (comments included), stated Risk not below the computed floor, a footer whose
commit equals the PR head, and the allowed collapsed blocks and their order (Changes at most seven
rows). Its fixed lists (`HEADINGS`, `REQUIRED_HEADINGS`, `STATUS_ROWS`, `DETAILS`) become catalog
entries; its rule codes (`heading-missing`, `heading-order`, `heading-unknown`,
`status-row-missing`, `needs-you-empty`, `adr-bare-number`, `breaking-change`, `risk-unstated`,
`risk-unverified`, `risk-below-floor`, `footer-missing`, `footer-head-mismatch`,
`details-unknown`, `details-order`, `changes-too-many-rows`) are kept so output stays familiar.

`risk` is ported literally, including the per-repository `.github/pr-risk.toml` extension (patterns
that can only raise the level). The engine's path weights disagree with it on authentication and CI
workflows; that stays until item 5 of NIW2-742.

`check --pr <n>` reads title, body, head, commits and changed files through `gh`, as the Python
script does. With a file, it reads the body from disk and the rest from git.

### Format

`format [<file>]` prints a reordered description: sections and status rows in template order,
missing required headings added empty, unknown `##` sections moved into Notes, the Wachiman block
and footer moved to the end. `--write` rewrites the file. It never edits a PR on GitHub; an agent
pipes the output to `gh pr edit`.

### Which template a PR is checked against

The PR's own `.github/pr-template.json`, with the catalog of the installed Wachiman. See ADR 0051
for why this departs from the base-commit rule of
[ADR 0006](../adr/0006-repository-review-policy.md).

### Commands

```text
wachiman pr-template show    [--from <json>]
wachiman pr-template install [--from <json>] [--force] [--commit]
wachiman pr-template status  [--json]
wachiman pr-template check   [<file>] [--pr <n>] [--repo <owner/name>] [--title <t>] [--head <sha>] [--base <ref>] [--allow-breaking]
wachiman pr-template format  [<file>] [--write]
wachiman pr-template risk    [--base <ref>]
wachiman pr-template strip   <file>
```

`--from <json>` copies the given definition into `.github/pr-template.json` before generating.
The command registers in `src/cli.ts` and `src/help.ts` like `skills`.

### State of the art

- [copier](https://copier.readthedocs.io/en/stable/updating/) and [cruft](https://github.com/cruft/cruft)
  record the template version in the repository and have a check that exits non-zero when it is
  behind; they write the working tree and never open PRs.
- [terraform-docs](https://terraform-docs.io/user-guide/configuration/output/) replaces only the
  text between its markers; the Wachiman block follows that pattern.
- [repo-file-sync-action](https://github.com/BetaHuhn/repo-file-sync-action) opens a PR per
  repository and overwrites; it keeps no local lines.
- GitHub's [organisation defaults](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file)
  apply only where a repository has no file of its own and report nothing.
- [Danger](https://danger.systems/js/) and
  [pr-description-checker-action](https://github.com/jadrol/pr-description-checker-action) check
  the body in CI; re-running on edits needs the `edited` event.
- No maintained tool found does both install and check.

### Sources and unverified claims

- The hand copies and the gap: [wachiman#227](https://github.com/niway-dev/wachiman/pull/227),
  [kaipu-record#617](https://github.com/niway-dev/kaipu-record/pull/617), and the owner's account
  in NIW2-776.
- The PostHog template was read through a page summary, not verbatim; the build reads it again
  before writing the default guide comments.
- The risk-rule disagreement: `src/engine.ts:437-449` and `src/risk.ts:56-60` against the Python
  rules (read 2026-11-13).
