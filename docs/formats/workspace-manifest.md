# Workspace manifest and per-user workspace file

Two files tell a distributed-repo review which repositories belong together. Wachiman reads only
the keys below and ignores every other key; the workspace kit that creates the coordinator folder
owns the manifest. Names in the examples are invented. Design:
[the distributed-repo review spec](../specs/2026-11-13-distributed-repo-review-design.md),
[ADR 0043](../adr/0043-sibling-references-carry-the-member-and-the-commit.md) (snapshots) and
[ADR 0044](../adr/0044-contracts-name-a-source-of-truth-and-a-version-rule.md) (contracts and version rules).
The code is `src/workspace/`.

## `workspace.manifest.json`

Lives in the coordinator folder. Wachiman looks for it in this order:

1. The entries of the per-user file, in order. An entry matches when its manifest lists the
   reviewed repository, by `repo` against the normalised `origin` first, then by `dir` (where the
   repository is cloned).
2. Otherwise, the first `workspace.manifest.json` found walking up from the repository's parent
   folder. If that manifest does not list the repository, there is no workspace and the review
   runs as before.

A per-user entry whose manifest file does not exist, or is invalid, is skipped with a warning that
names its path, so a broken entry never fails the review of a repository that is not in it. An
invalid manifest found by walking up is refused.

```json
{
  "format": "workspace/1",
  "members": [
    { "dir": "api-client",      "repo": "acme/api-client",      "visibility": "public"  },
    { "dir": "billing-service", "repo": "acme/billing-service", "visibility": "private" }
  ],
  "contracts": [
    {
      "name": "billing-api",
      "sides": [
        { "member": "billing-service", "role": "provider", "paths": ["src/routes/**"] },
        { "member": "api-client",      "role": "consumer", "paths": ["src/billing/**"] }
      ],
      "sourceOfTruth": { "member": "api-client", "paths": ["docs/billing-api.md"] },
      "version": { "rule": "pinned", "pin": { "file": "package.json", "key": ["dependencies", "@acme/billing-types"], "tag": "v{version}" } }
    }
  ]
}
```

| Key | Meaning |
| --- | --- |
| `format` | Must be exactly `workspace/1`. Any other value is refused with a message naming it. |
| `members[].dir` | The member's folder, relative to the coordinator. Unique. |
| `members[].repo` | `owner/name`, matched (case-insensitively) to the reviewed repository's `origin`. |
| `members[].visibility` | `public` or `private`. Anything else, or no value, counts as `private`. |
| `members[].version` | Optional version rule for every contract that reads this member. |
| `contracts[].name` | Unique. |
| `contracts[].sides[]` | `member`, `role` (`provider` or `consumer`) and `paths` (globs relative to the member). At least one provider and one consumer. |
| `contracts[].sourceOfTruth` | `member` and `paths`: the file both sides must match. It may be a third member. |
| `contracts[].version` | Optional version rule; the default is `pinned`. |

A contract applies to a review when a changed path (the new and the old path of a rename, and
deleted paths) matches the reviewed member's side, or the source-of-truth paths when the reviewed
member holds the source.

Refused, with the key named: a `dir` or a path glob that is absolute or has a `..` segment (also
inside braces), a member `dir` whose real path (after following links) is outside the coordinator,
a repeated `dir` or contract `name`, and a contract that names a member the manifest does not list.

## `workspaces.json`

`<Wachiman home>/workspaces.json` (`~/.wachiman/workspaces.json` unless `WACHIMAN_HOME` is set).
Never committed. A missing file is an empty list; a key Wachiman does not know is ignored; a known
key it cannot read is refused.

```json
{
  "version": 1,
  "workspaces": [
    {
      "manifest": "/Users/dev/acme/workspace.manifest.json",
      "distributedRepo": "off",
      "members": { "api-client": { "dir": "/Users/dev/other-clones/api-client", "watch": false } },
      "versions": { "billing-api": { "rule": "local" } }
    }
  ]
}
```

| Key | Meaning |
| --- | --- |
| `version` | Must be `1`. |
| `workspaces[].manifest` | Absolute path of a manifest. The entry applies to repositories that manifest lists, found by `repo` against `origin`, then by folder. |
| `workspaces[].distributedRepo` | `on` or `off` (default `off`): the default when no flag is given. |
| `workspaces[].members.<dir>.dir` | Absolute path of the clone, when it is not `<coordinator>/<dir>`. |
| `workspaces[].members.<dir>.watch` | `false` leaves a cloned member out; it is reported as not watched. |
| `workspaces[].versions` | Version rules keyed by contract name or member `dir`. |

## Version rules

A rule is an object: `{ "rule": "pinned" | "local" | "tip" }`, with, for `pinned`, either
`"ref": "<ref>"` (a literal ref of the sibling) or `"pin": { "file", "key", "tag" }`. `key` is an
array of literal keys, never a dotted string (package names contain dots). `tag` has `{version}`
replaced by the pinned version. The rule for a (contract, member) is the first match of:
per-user file by contract, per-user file by member, manifest contract, manifest member, then the
default `pinned`. The report records the source as `user-file`, `manifest` or `default`.

| Rule | What is read | When it cannot be resolved |
| --- | --- | --- |
| `pinned` | When the reviewed repository is a consumer and the sibling a provider: the commit of the `ref`, or of the tag the reviewed head pins (the JSON file is read from the reviewed head commit, not the working tree; the value must be an exact version, no range) | No pin declared, a file, key or value that is not an exact version, the tag or ref not in the sibling's local refs, or any other direction: read `tip`, and say why |
| `local` | The sibling's `HEAD` commit | Uncommitted changes to tracked files are not read and are flagged `uncommitted`; a sibling with no commit is unreadable |
| `tip` | The commit `refs/remotes/origin/HEAD` points to, with the modification time of `FETCH_HEAD` as `fetchedAt` (`unknown` when there is none) | No `origin/HEAD` recorded: read `local`, and say why |

Wachiman never fetches, pulls or clones a sibling, so `tip` is as fresh as the user's last fetch.
When a fallback chain runs (`pinned` to `tip` to `local`), the single `fallback` text lists every
reason in order.

## What a snapshot holds

For each sibling read, the files that the chosen globs select among the commit's tracked files,
written to a temporary directory with no `.git`. Untracked files, uncommitted edits and everything
outside the globs are absent. Symbolic links and submodules are dropped; the links are listed.
