# Review formats

The review core (`reviewChange` in `src/engine.ts`, [ADR 0019](../adr/0019-a-review-core-behind-source-and-sink-ports-and-a-local-subscription-mode.md))
reads one format and writes another. Both are public, so a tool other than Wachiman can produce a
change to review or read a review's result.

| Format | Schema | What it is |
| --- | --- | --- |
| `wachiman.review-input/1` | [review-input.v1.schema.json](review-input.v1.schema.json) | A change to review: what changed (`change`), the per-file diffs (`files`), the instructions read from the base commit (`instructions`), the scope, and optionally the incremental context (`since`) and the open threads (`conversation`) |
| `wachiman.review-result/1` | [review-result.v1.schema.json](review-result.v1.schema.json) | What the core found: coverage, findings (each with its `anchor`), contracts, the summary, per-batch reports, thread replies, and how the run went (`execution`: cost estimate, calls, turns, why it stopped) |

The JSON Schemas are the contract; the TypeScript types in `src/formats.ts` follow them.

## Versioning

- The `format` string is the only version. A producer writes the version it produces; the core
  refuses a `format` it does not know with a usage error.
- Inside `/1`, only optional fields are added. Removing, renaming or retyping a field, or making
  an optional field required, is `/2`.
- A `/1` reader accepts unknown fields on a finding, a contract, a batch report and `execution`,
  where later `/1` writers are expected to add them; everywhere else an unknown field is invalid.

## What is never in a file

`headDir`, the directory holding the checkout or snapshot of `change.head.sha`, is part of the
input in memory only. A connector sets it when it hands the input to the core; it is not in the
schema, and a file that carries it is invalid.

## Producers and consumers on `main`

Only the GitHub connector (`githubReviewInput`) and the GitHub sink (`githubReview`) exist. No
command reads or writes these files yet; the local connector and the terminal, Markdown and JSON
sinks are the next pull request (spec [2026-11-03-local-review-design.md](../specs/2026-11-03-local-review-design.md)).

Example files that validate against the schemas: `test/fixtures/formats/`; `src/formats.test.ts`
checks them.
