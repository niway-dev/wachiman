# Upgrading, migrating and rolling back

This page is for repositories that call the reusable workflow. If you copied the files into your
repository instead, the copy never updates by itself: see [setup-copy.md](setup-copy.md).

There is no upgrade command and no uninstall command. Wachiman has two commands, `review` and
`comment` ([cli.md](cli.md)), and both run inside a workflow you own. The version that runs with
your key is whatever your caller file names.

## What chooses the code that runs

One line in your caller file, usually `.github/workflows/agent-review.yml`:

```yaml
jobs:
  review:
    uses: niway-dev/wachiman/.github/workflows/review.yml@v1.3.0
```

The part after `@` is the ref. The reusable workflow checks the engine out at the same commit as
the workflow file itself (`job.workflow_sha`), so the workflow and the engine always match. Each run
writes `Engine niway-dev/wachiman@<sha>, run from engine/ ...` into its job summary. To see which
tag that is, compare the SHA with the tag's commit:

```sh
git ls-remote https://github.com/niway-dev/wachiman 'refs/tags/v1.3.0'
```

The template in this repository may name an older tag than the latest release, so take the tag from
the [Releases page](https://github.com/niway-dev/wachiman/releases), not from the template.

## What each kind of ref gives you

| Ref | What it is | Consequence |
| --- | --- | --- |
| Exact tag, `@v1.3.0` | A release tag. The project's recommendation ([install.md](install.md)). | Readable in your file. It changes only when you edit the file. See the limits below. |
| Full commit SHA, `@<40 characters>` | A commit. GitHub accepts it. | Does not depend on any tag rule. Unreadable by itself, so keep the version in a trailing comment, such as `# v1.3.0`. |
| Floating tag, `@v1` | A tag the maintainer moves to each compatible release. | Not recommended. A release reaches your repository, and runs with your key, before you have read it. |

### What an exact tag guarantees, and what it does not

This repository protects `v*` tags with a ruleset that forbids moving or deleting them, with one
exception: a repository admin can bypass it, and the release process itself uses that bypass to move
the floating `v1` tag ([releasing.md](releasing.md)). So:

- An exact tag stays where it is only while the ruleset holds and no admin uses the bypass. You
  cannot enforce that from your repository. A commit SHA does not rely on it, which makes it the
  stronger pin against a moved tag.
- Pinning the workflow does not pin everything it uses. `claude_code_version`, `bun_version` and
  `model` have defaults inside the workflow at that tag, so a new tag can change them. If you pass
  one of those inputs yourself, your value wins at any tag.
- Claude Code is downloaded when the job runs. The installer checks it against a SHA-256 taken from
  the publisher's manifest, which proves the download is intact but comes from the same place as the
  binary. Pass `claude_code_sha256` to pin the hash yourself
  ([providers/claude-code.md](providers/claude-code.md)).
- The model behind `claude-sonnet-5-5` is run by Anthropic, not by this repository. Its behaviour
  is not part of the pin.
- Anyone who can push a branch to your repository can edit the `uses:` line in it
  ([SECURITY.md](../SECURITY.md)).

## Moving to a new release

1. **Read what changed.** Read the release on the Releases page and [CHANGELOG.md](../CHANGELOG.md).
   The changelog lists `feat`, `fix`, `perf`, `revert`, `refactor` and `security` commits. It hides
   `docs`, `test`, `ci`, `build`, `style` and `chore` commits, so a change to a workflow can be
   missing from it. A section named "Security" appears only when a commit used that type.
2. **Compare what runs.** The exact differences in inputs, defaults, permissions and triggers are
   in the workflow and the template. In a clone of this repository:

   ```sh
   git diff v1.2.1 v1.3.0 -- .github/workflows/review.yml templates/agent-review-caller.yml
   ```

   Or open `https://github.com/niway-dev/wachiman/compare/v1.2.1...v1.3.0`. Engine defaults are in
   `src/config.ts`. Look for a changed default budget, a new input, a different `permissions` block
   or a changed trigger, because those change what the review costs or what it can touch.
3. **Change the ref** in your caller file to the new tag, through your normal review process.
4. **Check the next pull request.** After the change reaches your default branch, open or ready a
   pull request. Confirm that the job summary names the engine commit you expect and that the
   review footer shows the Claude Code version you expect.

The project's release rule is that a policy change (what reviews ask for, a default budget that
changes cost, a trigger or permission change) is not shipped by moving a tag. It ships as a new
major version or as a pull request to each consumer ([releasing.md](releasing.md)). That is the
maintainer's rule, not something a workflow enforces, so do the comparison above.

### Review on every push (`synchronize`)

Since the release that adds ADR 0011, the templates list `synchronize` and the reusable workflow has
a `review_on_push` input (default `true`). **Bumping the pin alone does not turn this on.** The
trigger lives in your caller file, and a reusable workflow cannot add one. A caller written earlier
lists `types: [opened, ready_for_review]`, so it keeps reviewing only on open and on `/wachi review`
until you edit it:

```yaml
on:
  pull_request: { types: [opened, ready_for_review, synchronize] }
```

Each push then reviews only the new commits and can spend up to `budget_usd` ([costs.md](costs.md)).
Pass `review_on_push: false` only after you move to a release that has the input: a workflow that is
given an input the pinned release does not declare fails. If you copied the files instead, edit the
`types` list in your copy of the workflow by hand; nothing updates it.

## Dependabot for the caller file

Dependabot is optional, and it is off until you add a configuration file. Releases do not arrive in
your repository on their own. With the file below, Dependabot opens a pull request when a newer ref
exists:

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
```

- The update pull request changes the ref in the `uses:` line. For a commit SHA pin, this
  repository's own Dependabot configuration shows that it rewrites the SHA and the trailing version
  comment together.
- `interval: weekly` means up to a week between a release and its pull request. A shorter interval
  is available.
- The entry covers every action in `.github/workflows/`, not only this one.
- The reusable workflow skips pull requests opened by `dependabot[bot]`, so the update pull request
  is not reviewed and costs no model spend.
- Read the release notes and run the comparison above before you merge. Merging is the decision.

"Nothing runs with your key before you merge" holds for the Dependabot pull request because its
review job is skipped. It does not hold for every change to the file. GitHub runs a `pull_request`
workflow from the pull request's own merge result, so a pull request pushed by a person that edits
the `uses:` line runs the new version's review job on that pull request, with your key, before it
merges. Comment-triggered runs use the file on the default branch, so they keep the old ref until
the change merges.

## Rolling back

Edit one thing: the ref in the `uses:` line of your caller file, back to the previous release (an
exact tag or a SHA). Merge it as you would any change. The previous release is still exactly what it
was, unless the tag was moved (see above), so you do not wait for the maintainer.

Check these as well:

- **Inputs you added.** If the newer release introduced an input and you set it, remove it. GitHub
  is expected to reject a `with:` input that the pinned workflow does not declare; that is GitHub's
  behaviour and was not tested for this page.
- **Inputs you overrode.** An explicit `claude_code_version`, `claude_code_sha256` or `bun_version`
  stays in force at any tag, so rolling the tag back does not roll those back.
- **When it takes effect.** Comment-triggered runs use the file on your default branch, so they
  follow the change as soon as it merges. The automatic review fires only on `opened` and
  `ready_for_review`, so an open pull request picks up the change at its next such event.
- **What stays.** Reviews and comments already posted stay on their pull requests. How a release
  older than v1.2.1 reads reviews that a newer one wrote was not tested for this page, so do not
  roll back past v1.2.1 without checking one pull request.

## Names that changed

| Before | Now | Status |
| --- | --- | --- |
| `CLAUDE_REVIEW_<NAME>` environment variables | `AGENT_REVIEW_<NAME>` | Both read. The old one prints `CLAUDE_REVIEW_<NAME> is deprecated; use AGENT_REVIEW_<NAME>.` and loses to the new one. `AGENT_REVIEW_COMMENT_AUTHOR` has no old name. The reusable workflow sets only the new names, so this matters for copy installs and direct CLI use. |
| `.github/claude-review.md` | `.github/agent-review.md` | The old file is read only when the new one is missing, with a warning. Rename it. |
| `<!-- claude-review sha=… -->` marker | `<!-- agent-review sha=… -->` | Both are read, so pull requests reviewed under the old name keep their incremental state. |
| Default `mention` `@agent-review` (v1.0.0 and v1.1.0) | `/wachi` (v1.2.0 and later) | `@agent-review` and `@claude` still start a run. If you set `mention` yourself, your value stays. |
| `/wachi` only | `/wachiman` also accepted by the parser (v1.3.0) | With the default `mention` it also starts the job. With a custom `mention` it does not: see [troubleshooting.md](troubleshooting.md). |
| Comments with no brand line | Every posted comment opens with `👮 **Wachiman**` (v1.3.0) | The engine recognises its own comments by hidden signatures and not by this text, so older comments stay valid. |
| A caller that names an earlier repository path in `uses:` | `niway-dev/wachiman/.github/workflows/review.yml` | The project was renamed along the way. The links in [CHANGELOG.md](../CHANGELOG.md) show the earlier names. Whether GitHub redirects an old path in `uses:` was not checked for this page. Name the current one. |

### Reviews written before signatures

Releases before v1.2.1 wrote reviews and finding comments without hidden signatures. Since v1.2.1
the engine accepts an unsigned review as its own only if it was submitted before 2026-11-01 (UTC)
and comes before the first signed review on that pull request. It accepts an unsigned finding
comment only if it was created before the same date. Any other unsigned item is treated as written
by another workflow in the repository, which also posts as `github-actions[bot]`.

In practice, a pull request last reviewed by a release before v1.2.1, before that date, continues
incrementally. One whose only reviews are unsigned and were posted after that date is reviewed in
full on the next run, because the engine finds no review it trusts.

## Moving from a copied install

Copying the files is a one-time snapshot. A copy made before ADR 0011 reviews only on open; add
`synchronize` to its `pull_request` types, and copy the new `src/` as well, because the push review
needs the engine that compares rebased changes. To switch to the reusable workflow, add the caller file
from [install.md](install.md), then remove the copied files listed in [uninstall.md](uninstall.md).
Run only one of the two while you test, or each pull request gets two reviews.
