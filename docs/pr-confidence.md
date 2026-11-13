# PR Confidence

A trial feature of the GitHub review. After a full review of a pull request, Wachiman writes a
grade into the pull request description: does the diff do what the title and body say? It is
off by default. Design: [ADR 0033](adr/0033-a-fidelity-grade-the-engine-computes-from-checked-claims.md). `wachiman local` produces it only when given `--confidence <file>` (see [Grade a pull request on your laptop](#grade-a-pull-request-on-your-laptop)).

In one paragraph: one extra small model call lists the claims in the title and body ("Retries
failed uploads"). The review batches say which claim each changed file serves and cite the lines
that show it. The engine checks the cited lines exist and decides the letter. The model proposes;
it never states the grade.

## What the grade means

The first row that matches wins.

| Grade | When |
| --- | --- |
| `cannot say` | The run did not finish, a spend ceiling stopped it, files were left unread, the text was too long to read in full, a batch or claims call ended on a turn or time limit (even when it returned usable output), the review of a new commit has not finished, or the title and body changed while the review ran |
| C | The text makes no checkable claim, a claim is contradicted, or a Blocker finding is open |
| B | A claim has no cited evidence, a changed file is unexplained, a Fix finding is open, or the risk level is high (a high risk fact such as auth, money, data migration or an irreversible change, or a file on a high-risk path) |
| A- | A medium risk fact, a risk fact the engine dropped, a place that needs a person, or a Consider finding is open. A file on a medium-risk path alone does not: the grade stays A |
| A | None of the above |

A file is explained when a confirmed claim covers it, or a fixed rule does: a lockfile, a
generated file, a formatting-only change, or a test of a confirmed claim. Generated includes the
build output the engine skips by default (`dist`, `build` and `out` directories, `*.map`,
`worker-configuration.d.ts`). A snapshot (`*.snap`) is a test of its source file, explained when a
confirmed claim covers that source. Every other file is named as unexplained, including a path the
repository's own `exclude` setting skips.

Every A and A- is marked **trial**. A means every claim has cited evidence and no change is
unexplained. It does not mean the pull request is safe to merge unread.

## What it is not

It is not an approval, a change request or a check status, and it never blocks a merge. It does
not measure code quality. It is a line in the description for the person reading the pull request.

## When it is written, and when it says "cannot say"

- Only a **full review** is graded: the first review of a pull request, or a review of the whole
  pull request. An incremental review (new commits only) or a review of given paths reads part of
  the change, so it writes `cannot say`.
- **Known limitation of this slice.** After the first review, every push is reviewed
  incrementally, so after a push the block shows `cannot say` ("This review covered only part of the
  pull request") until a review of the whole range runs: the rebase fallback, or a new review of the
  whole pull request. Files that were not read fail closed instead of being assumed fine.
- At the start of every push run, before the push wait and with no model call, the block is reset
  to `cannot say` for the new commit. A run cancelled by a newer push, or one that fails, leaves
  no letter from an older commit.
- Right before writing, the engine reads the pull request again. If the head moved, or the title
  and body are no longer the text the claims were read from, the block says `cannot say`.
- The write is best-effort: a failure is a warning and never fails the review. Nothing is written in
  a dry run.
- GitHub has no compare-and-swap for a description: Wachiman reads the body and then writes it, so an
  author edit or a newer reset that lands in the milliseconds between the two can be overwritten.
  The commit and the digest stamped in the block let a reader notice that the block and the text no
  longer match.
- Wachiman edits only its own block, between two marker comments. The rest of the description is
  kept byte for byte, and the block is removed before the claims are read.

## Turn it on

- Reusable workflow: `pr_confidence: true` in the caller's `with:`.
- Copied workflow: `WACHIMAN_CONFIDENCE: 1` in the workflow `env:`.
- Command line: `WACHIMAN_CONFIDENCE=1`. The reset step is `wachiman reset-confidence <pr>`.

Cost: one extra model call per full review, capped at $0.15 and counted in the review's cost and
footer. The title, body and diff are untrusted data in every prompt.

## Not built yet

- The human-check thread (slice 2b): "Your check: pending" is a placeholder; nothing records that a
  person looked.
- Plus signs (slice 2c): a refutation check on each claim. The block says it was not performed.

The result carries it as `fidelity` in `/2` of the [review result](formats/README.md); `/1` does not.

## Grade a pull request on your laptop

`wachiman local --commit <sha> --confidence pr.json --format json` grades a committed change with your
own signed-in `claude`. The file is `{ "title": string, "body": string, "number"?: number, "url"?: string }`:
the pull request's title and description. The change is treated as that pull request, the claims call
uses the same budget as the Action's, and nothing is posted. It works with `--base`, `--from`, `--commit`
or `--input`, not with `--working-tree` or paths.

With `--format json` the grade is the `fidelity` field of the `/2` result (the flag makes `/2` the
default; `--result-version 1` is refused because `/1` never carries it). With `terminal` or `markdown`,
the rendered block follows the report.
