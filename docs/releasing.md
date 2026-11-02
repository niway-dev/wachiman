# Releasing

For the maintainer. A consumer's caller file names a tag of this repository's reusable workflow
(`review.yml@v1.3.0`), and that workflow runs with the consumer's API key. So a tag is a trust
decision: whoever controls it controls code that runs with the key. Exact tags are meant never to
move, and a repository ruleset enforces that for everyone except repository admins (see
[Tag protection](#tag-protection-and-its-limits)).

Releases are automated with [release-please](https://github.com/googleapis/release-please). Your
job is to read and merge the release pull request. Nothing is published to npm; that stays
deferred.

The latest release is the version in `.release-please-manifest.json` and the newest entry of
[CHANGELOG.md](../CHANGELOG.md); this page does not repeat it so that it cannot go stale. The
pre-release tags `v1.0.0-rc.1` and `v1.0.0-rc.2` stay as history and are never deleted.

## Tag protection and its limits

Two repository rulesets exist (they live in the repository's settings, not in this tree, so
re-read them with `gh api repos/niway-dev/wachiman/rulesets` before relying on this section; the
facts below were read on 2026-11-01):

| Ruleset | Applies to | Rules | Who can bypass |
| --- | --- | --- | --- |
| `main: changes only through pull requests` | `refs/heads/main` | A pull request is required (with zero required approving reviews), no deletion, no force-push | Nobody |
| `release tags: no update or deletion except by repository admins` | `refs/tags/v*` | No update, no deletion, no non-fast-forward | The repository role Admin, always |

What this means:

- A `v*` tag that exists cannot be moved or deleted by an account without the Admin role. That is
  what stands behind "an exact tag does not move".
- An account with the Admin role can bypass it, and so can anything that holds such an account's
  token. The release job's tokens (`RELEASE_PLEASE_TOKEN`, optionally `RELEASE_TAG_TOKEN`) are
  that kind of token, because they move the floating `v1` tag. So the guarantee is "protected
  from everyone except the maintainers", not "immutable". A consumer who needs more than that
  pins a commit SHA (below).
- The ruleset has no rule restricting creation, so it does not stop someone with write access
  from creating a new `v*` tag that does not exist yet.
- Nothing here is a separate GitHub "immutable releases" setting; this page does not claim one.

Tracking issue for the floating tag: [#8](https://github.com/niway-dev/wachiman/issues/8).

## How a release happens

1. Changes land on `main` with Conventional Commit titles (see the README, "Commit messages").
2. On every push to `main`, `.github/workflows/release-please.yml` opens or updates one pull
   request titled `chore: release X.Y.Z`. It bumps `package.json` and adds a section to
   `CHANGELOG.md` from the commits since the last release. `feat:` is a minor bump, `fix:` a
   patch, and `feat!:` or a `BREAKING CHANGE:` footer a major one. The other types are listed in
   `release-please-config.json`; see release-please's documentation for which of them can start a
   release on their own.
3. You review the notes and merge that pull request.
4. On the merge, release-please creates the exact tag `vX.Y.Z` and a GitHub Release with the same
   notes.
5. The last workflow step moves the floating major tag (`v1`) to the release commit, for callers
   that still use it. Recommended installs pin the exact tag and are not affected.

Configuration: `release-please-config.json` and `.release-please-manifest.json`. The config has
no `extra-files`, so release-please edits only `package.json`, the manifest and `CHANGELOG.md`:
every other place that names a version is updated by hand (see the checklist below).

## What release notes show

Only some commit types reach the notes. In `release-please-config.json`, `feat`, `fix`, `perf`,
`revert`, `refactor` and `security` are shown; `chore`, `docs`, `style`, `test`, `build` and `ci`
are hidden. A consumer reading the notes therefore does not see a change that was committed as
`docs:` or `ci:`, even when it changes something a consumer cares about: a workflow default, a
budget, a permission, the caller template, or a security statement.

When a release includes such a change, use a visible type for the commit (`fix:`, `feat:`), or
add a line to the release notes by hand. Do that last, right before merging the release pull
request: release-please regenerates the pull request when new commits land on `main`, so earlier
manual edits can be overwritten. The same pass is where to remove duplicate entries: the 1.3.0 section of
`CHANGELOG.md` lists each of its features twice.

## The alias step

After a stable release of `1.x.y` the workflow runs, with `RELEASE_TAG_TOKEN` or, when that is not
set, `RELEASE_PLEASE_TOKEN`:

```sh
git tag -f v1 <release-sha>
git push -f origin v1
```

It skips pre-releases (a tag containing `-`). Only callers on the floating `@v1` get the new
release at once; recommended installs pin `@v1.x.y` and the exact tag is not touched by this step.
If neither secret is set, or the push fails, the step does not fail the run: it prints a warning
and the two commands above in the run summary. Run them as a repository admin. This is the only
manual tag instruction.

If the alias moved to a release that turns out to be bad, point it back with the same two
commands, using the SHA of the last good release, as a repository admin. Do not delete the bad
exact tag; ship the fix as a new release.

## Secrets (in the `production` environment, created by the owner)

| Secret | Used for | Without it |
| --- | --- | --- |
| `RELEASE_PLEASE_TOKEN` | Opens the release PR and creates the tag and Release, so that CI runs on the release PR (events made with `GITHUB_TOKEN` do not start workflows) | Falls back to `GITHUB_TOKEN`: the release PR still opens, but CI does not run on it, so close and reopen it, or push to it, to start checks |
| `RELEASE_TAG_TOKEN` (optional) | Overrides the token used to move the `v1` tag, for owners who want a separate, narrower one. When absent, `RELEASE_PLEASE_TOKEN` moves the tag | Nothing changes: `RELEASE_PLEASE_TOKEN` is used |

One secret, `RELEASE_PLEASE_TOKEN`, is enough. Because it moves a tag the ruleset protects, it must
be a fine-grained personal access token owned by a repository admin, with:

- Resource owner and repository access: only `niway-dev/wachiman`.
- Repository permissions: **Contents: Read and write**, **Pull requests: Read and write**
  (**Metadata: Read** is added automatically).
- A short expiry; put the renewal date in your calendar. An expired token shows up as the alias
  warning, not as a failed release.

Treat it as a credential that can move or delete release tags. These secrets belong to the
maintainer's release process; they do not appear in any consumer setup.

Add it under Settings, Environments, `production` (create it if missing), "Add environment
secret". The release job declares `environment: production`; repository-level secrets are still
readable, but an environment secret with the same name takes precedence. Do not add required
reviewers or a wait timer to this environment: the job runs on every push to `main` and would block
on them.

## Rules

- `v1` moves only for backward-compatible releases: bug fixes and additions that keep every
  input, secret and behaviour of `v1.x` working. A breaking change is `feat!:` and makes the
  next release `2.0.0`, which does not move `v1`; the alias step then creates and moves `v2`.
- A policy change (what reviews ask for, default budgets that change cost, trigger or permission
  changes) never rides a tag move. Ship it under a new major version, or as a pull request to
  each consumer.
- Exact tags (`v1.3.0`) are never moved by policy, and the ruleset enforces that except for
  admins. Commit SHAs cannot move.
- Never create or edit `v*.*.*` tags by hand: release-please owns them.

## Pinning: what each reference gives a consumer

- `@v1.2.3` is the recommended pin: protected by the `v*` ruleset (with the admin bypass above),
  readable in the caller, and updated through a Dependabot pull request that the consumer reads
  first when the consumer has Dependabot enabled for GitHub Actions. A consumer undoes a bad
  release by editing the tag back, without waiting for the maintainer.
- `@v1` follows every compatible release without the consumer's consent. It is kept for callers
  that installed it and is not offered in the docs or the template (ADR 0001, amendment of
  2026-10-26).
- `@<40-character-sha>` is accepted by GitHub. It does not depend on any tag, so it holds even if
  a tag is moved or deleted, which the admin bypass makes possible. The cost is readability in the
  caller and the need to update it deliberately; this repository does the same for third-party
  actions and lets Dependabot rewrite the SHA together with a version comment.

## Hotfix

1. Branch from `main`, fix, and open a pull request titled `fix: ...`.
2. Merge it. The release pull request updates itself to the next patch version.
3. Merge the release pull request. Dependabot offers the fix to each consumer that has it enabled;
   `v1` moves to it for the callers that still use the floating tag.

If `main` has unreleased work that must not ship yet, hold the release PR unmerged only if the
other changes are already acceptable to ship, because it contains everything on `main`. There is
no maintenance branch: if one is ever needed, add a second release-please configuration for it.

## Before merging a release pull request

1. Confirm the release is backward compatible; if not, it is `2.0.0`.
2. Check that the caller template in `templates/` still matches the workflow's inputs.
3. Check that the exact tag named in `templates/agent-review-caller.yml` and in the install docs
   is the release you are about to cut. release-please does not edit those files.
4. Check that the defaults in `src/config.ts` and the reusable workflow's inputs still agree (the
   workflow always passes its inputs, so the workflow defaults are the ones consumers get), and
   that the docs that quote them ([configuration](configuration.md), [costs](costs.md)) still
   match.
5. Read the release notes against the list in "What release notes show" above: anything that
   changes trust, spend, permissions or defaults must be visible to a consumer.
6. If the release changes the pinned Claude Code version (`claude_code_version`) or its checksum
   (`claude_code_sha256`), re-run the opt-in isolation harness against that binary
   (`test/provider-isolation.test.ts`, described in
   [the Claude Code provider](providers/claude-code.md)) and keep the version and hash together.
7. Check that CI is green on the release pull request.

## Consumer upgrades

What a consumer does with a new release is in [upgrading](upgrading.md); undoing one is editing
the pin back to the previous exact tag.
