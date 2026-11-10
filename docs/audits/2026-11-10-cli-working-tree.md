# Audit brief — working-tree CLI slice 6

Branch: `feat/cli-working-tree`. Base: `ba73c01` (main, 1.10.1).
Implementation is prepared for review; this is not an approval or merge-readiness verdict.

## Intent

> “ejecutemos el slice 6 entonces”

The owner asked for tracked-only `staged|all` local review, with immutable isolated capture,
result/input `/2`, history and meaningful isolation/race/regression tests. This overrides the
old spec's inclusion of untracked files. The full NIW2-687 ticket could not be retrieved:
Linear installation was confirmed but its tools never became callable. Criteria here are
reconstructed from the owner's continuation, not quoted from the ticket.

Delivered beyond the feature: a project-local verify skill records the fake-provider proof
procedure required by cs-capture-evidence. No global skills were changed.

## State

The implementation uses the existing review engine. No real model call, registry publish or
merge was performed. PR readiness is blocked on independent review: the delegated Sonnet 5.5
implementation attempt failed immediately with “Claude API rate limit reached. Try again later.”
The parent implemented directly and did not switch the failed delegate to another provider.

## What changed

| File | Consequence |
| --- | --- |
| `src/connectors/working-tree.ts` | Disposable Git directory/index/objects, read-only alternates, raw tracked capture, pre/post manifest, textual symlinks, cleanup callback. Portable input trees also materialize raw blobs. |
| `src/local.ts` | Explicit selector, mutually exclusive ranges, `/2` default, `/1` refusal before probes, raw base snapshots during verification and cleanup after history. |
| `src/formats.ts`, input/result `/2` schemas | Explicit working-tree kind and mode/baseCommit/tree metadata; `/1` remains committed-only. |
| `src/history/index.ts` | Fingerprint matches remain available; missing findings involving temporary trees stay unknown without commit-ancestry probes. |
| CLI/spec/ADR docs | Tracked-only semantics, explicit unsupported cases and canceled exe scope; final-slice plan retired into git history. |

## Decisions

| Decision | Alternative rejected | Why | Owner | Status |
| --- | --- | --- | --- | --- |
| Exclude all untracked paths | Old spec's non-ignored untracked inclusion | Explicit current instruction | user | settled |
| Isolated Git directory owns temporary index and objects | Point individual writes at the source Git directory with environment overrides | Writes always target the disposable repository | agent | open to review |
| Materialize raw blobs and textual symlinks | Archive extraction and archive attributes | Avoid attribute transformations, exclusions and live symlinks | agent | open to review |
| Explicitly refuse split/sparse indexes and gitlinks | Partial silent capture | Fail closed on unsupported index content | agent | open to review |
| Missing ephemeral-tree findings stay unknown | Inferring fixed or ancestry from trees | Old temporary objects are gone after annotation | agent | open to review |
| No Windows exe or status command changes | Expanding scope into #149 or #153 | Owner excluded them | user | settled |

## Evidence and gaps

Observed on macOS: capture/schema tests and CLI fake-provider tests pass. The initial full run
on installed Bun 1.4.2 reported 1453 pass, 8 skip, 1 fail (unchanged wizard Backspace behavior).
The same failure was reproduced on an archived main checkout. A pinned Bun 1.3.4 full run is
also recorded in the PR proof; consult its final counts there. The first npm-exec attempt at
the pinned run had PATH-dependent doctor/package failures, so the binary was installed as
`/tmp/wachiman-bun-1.3.4/bun` and PATH set explicitly for the actual run.

Captured CLI output uses a fake Claude binary and isolated HOME, exits 0, prints result `/2`,
explicit tree metadata and complete coverage for one tracked edit. No inference about model
quality or real account behavior follows from that proof.

Not verified: native Windows/Linux execution, real Claude, adversarial concurrent filesystem
replacement at syscall granularity, independent review, live tracker acceptance/status.

## Surfaced, not caused

- Bun 1.4.2 wizard Backspace failure reproduces on main; outside this slice.
- Linear tools and Claude review quota were unavailable; do not treat unavailable checks as passes.
- Global review-ledger persistence proposal remains unauthorized and untouched.

## Where to attack

1. Filesystem containment and race detection: parent lstat checks and leaf O_NOFOLLOW are not
   an OS-level openat sandbox. Inspect replacement races, unsupported paths and cleanup failures.
2. Raw materialization, executable modes, symlink text and index-only evidence fidelity.
3. Alternate object reads and accidental configured Git command execution or source writes.
4. Working-tree input validation, version defaults, and mixed committed/ephemeral history.
5. Large repositories: all tracked file contents are held in memory; no scalability claim is made.

These are starting points, not the boundary.

## Reference material

- [Canonical design](../specs/2026-11-09-cli-and-verified-reviews-design.md)
- [Command contract](../specs/2026-11-09-cli-command-contract.md#521---working-tree-semantics-implemented-slice-6)
- [Types](../specs/2026-11-09-review-and-config-types.md)
- [Format schemas](../formats/README.md)
