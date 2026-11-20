# Review formats

The review core (`reviewChange` in `src/engine.ts`, [ADR 0019](../adr/0019-a-review-core-behind-source-and-sink-ports-and-a-local-subscription-mode.md))
reads one format and writes another. Both are public, so a tool other than Wachiman can produce a
change to review or read a review's result.

| Format | Schema | What it is |
| --- | --- | --- |
| `wachiman.review-input/1` | [review-input.v1.schema.json](review-input.v1.schema.json) | A change to review: what changed (`change`), the per-file diffs (`files`), the instructions read from the base commit (`instructions`), the scope, and optionally the incremental context (`since`), the open threads (`conversation`), the repository's path rules (`pathRules`) and whether the change edits them (`pathPolicyChanged`) |
| `wachiman.review-input/2` | [review-input.v2.schema.json](review-input.v2.schema.json) | Adds explicit `working-tree` changes: the head is a tree id, with `workingTree.mode`, `baseCommit` and `tree`; committed `/2` inputs are also accepted |
| `wachiman.review-result/1` | [review-result.v1.schema.json](review-result.v1.schema.json) | What the core found: coverage, findings (each with its `anchor`), contracts, the summary, per-batch reports, thread replies, and how the run went (`execution`: cost estimate, calls, turns, why it stopped) |
| `wachiman.review-result/2` | [review-result.v2.schema.json](review-result.v2.schema.json) | The same result with the verifier's answer: each finding's `origin` (`introduced`, `pre-existing`, `unknown`), its `verification` (`supported`, `refuted`, `inconclusive`, `unverified`, with the reason and the lines checked in the `base` or `head` snapshot), its display `tier` (deprecated), and its `priority` (`must`, `should`, `could`, `fyi`) with a `rank` from 0 to 100, both derived by the engine after verification; a root `verification` record; `provider.account` (a label, a kind and a rung, never a path); for a GitHub pull request review with PR Confidence on, a root `fidelity` (claims, unexplained files, grade and reasons; see [PR Confidence](../pr-confidence.md)); a root `arm` (`word` or `priority`) while the priority trial runs; a root `pathPolicyChanged` when the change edits the repository's path rules; and, in `riskMap.pathReasons`, `rule: true` on a file a path rule matched; when the repository has [memory](../cli.md#memory), a root `memory` (the revision and files loaded) and, when an exception muted something, a root `muted` (each finding not posted, with the id of the entry); for a [distributed-repo review](workspace-manifest.md) (`wachiman local --distributed-repo`), a root `siblings` (per sibling: member, repository, visibility, version rule and where it came from, fallback reason, commit, when it was last fetched, status such as `not-cloned`, `not-watched` or `unreadable`), `workspaceContractsApplied`, `noWorkspaceContractApplied`, `privateContext` (the members read that are not `public`) and `removedSiblingReferences`, and on a finding `references` (`member`, full `sha`, `path`, `line`, each one checked against that member's snapshot) |
| `wachiman.dashboard/1` | [dashboard.v1.schema.json](dashboard.v1.schema.json) | What `wachiman dashboard --json` prints: spend per day and repository, findings by severity and verdict, loop rounds and PR Confidence grades, from the local index. A figure the run files do not record is marked `not recorded`. See [the local dashboard](../local-dashboard.md). Unlike the formats above it is an output only: no command reads it |

The JSON Schemas are the contract; the TypeScript types in `src/formats.ts` follow them. A local
history run file embeds a `wachiman.review-result/2` under `result` (and reads `/1` files written
before it); the wrapper around it (`wachiman.history-run/1`) is internal and has no schema.

The two files that group repositories for a distributed-repo review, `workspace.manifest.json`
and `workspaces.json`, are inputs read by Wachiman, not review formats: see
[workspace-manifest.md](workspace-manifest.md).

## Versioning

- The `format` string is the only version. A producer writes the version it produces; the core
  refuses a `format` it does not know with a usage error.
- Inside a version, only optional fields are added. Removing, renaming or retyping a field, or
  making an optional field required, is the next version.
- A reader accepts unknown fields on a finding, a contract, a batch report and `execution`, where
  later writers are expected to add them; everywhere else an unknown field is invalid.
- **Why `/2` exists.** The `/1` root and `provider` are closed, so a root `verification` block or a
  `provider.account` would make every existing `/1` validator reject the file, and each finding
  gains three required fields. `/2` carries them; `/1` is unchanged
  ([ADR 0030](../adr/0030-review-result-2-carries-verification-and-origin-with-an-explicit-downgrade-to-1.md)).
- **Which version a command writes.** The core produces `/2`. `wachiman local --format json`
  writes `/1` for a committed change, by `toResultV1` (src/formats.ts): the same findings, no
  `/2`-only field, and one line in `execution.notices` saying what the verifier did.
  `--result-version 2` writes `/2`; with `--history` each finding also carries an optional `id`, the
  one `wachiman history --verdict` accepts ([ADR 0034](../adr/0034-a-review-loop-driven-by-the-cli-that-never-edits-code.md)).
  Changing the default is a separately announced major release.
  A working-tree review defaults to `/2` and has no `/1` form.
  A distributed-repo review also writes `/2` by default and has no `/1` form: `/1` has no place for
  the siblings or the `privateContext` label, and a downgrade that dropped the label would hide it
  ([ADR 0042](../adr/0042-what-a-run-may-read-depends-on-where-its-output-goes.md)). Those fields
  are optional additions to `/2` (as `riskMap` and `memory` were), and a run without the mode
  writes exactly what it wrote before. `--result-version 1` with the mode is exit 2.

## What is never in a file

`headDir`, the directory holding the checkout or snapshot of `change.head.sha`, is part of the
input in memory only. A connector sets it when it hands the input to the core; it is not in the
schema, and a file that carries it is invalid.

## Producers and consumers

- **Input.** The GitHub connector (`githubReviewInput`) and the `local-git` connector
  (`buildLocalInput`, `src/connectors/local-git.ts`) build it in memory. `wachiman local
  --input <file> --repo-dir <clone>` reads one from a file: it checks the format and the fields
  the core reads, refuses a file that carries `headDir`, and snapshots `change.head.sha` from the
  clone ([the local review guide](../local-review.md)).
- **Result.** The GitHub sink (`githubReview`) renders it as a pull request review;
  `wachiman local --format json` writes it as is, and `--format terminal` and `markdown`
  render it (`src/sinks/`).

Added by [#112](https://github.com/niway-dev/wachiman/pull/112) (not merged); spec
[2026-11-03-local-review-design.md](../specs/2026-11-03-local-review-design.md).

Example files that validate against the schemas: `test/fixtures/formats/`; `src/formats.test.ts`
checks them.
