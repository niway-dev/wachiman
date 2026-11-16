# ADR 0015: A local repository index, rebuilt on the runner every run

- **Status:** proposed 2026-11-02. Not implemented. It adds vendored tree-sitter WASM, so it
  needs the measured experiment that [ADR 0002](0002-typescript-on-bun-zero-dependencies.md)'s
  2026-10-31 amendment requires.
- **Spec:** [reader, judge and local index](../specs/2026-11-02-reader-judge-and-local-index-design.md)
- **Issue:** #79

## Context

v1.4.0 gives each batch call-site evidence from `git grep`. Measured on kaipu, `git grep` misses
aliased consumers: `libraryChanged` → `onLibraryChanged`, 0 of 2. Hosted reviewers get this
context from a server-side code graph, and ADR 0001 rules a server out. Aider shows the local
version: tree-sitter tags, a graph of files and references, personalized PageRank, and a token
budget, rebuilt when the code changes. The owner's philosophy: index what is possible locally,
explore at the least cost.

## Decision

1. **Build the index on the runner, every run, from the checked-out head.** It holds tree-sitter
   definitions and references, with kind and position. `git grep` stays the floor for languages
   without a grammar.
2. **Rank for the pull request's files** (personalized PageRank) and cut each slice to a token
   budget.
3. **Use it twice:** to group related files into the same batch before reading, and to give each
   call a slice. It replaces `evidence.json`'s text match where a grammar exists.
4. **Do not persist it.** The GitHub Actions cache, keyed by the base SHA, is allowed later only if
   build time on large repositories is measured to hurt.
5. **Fall back, never fail.** If the build passes its time limit, the review continues on
   `git grep`.

## Alternatives rejected

- **A hosted graph:** ruled out by ADR 0001.
- **An index committed to the consumer's repository:** noise in every PR, and merge conflicts.
- **`git grep` only:** measured misses on aliases and property-named handlers.

## Consequences

- About 5 MB of vendored WASM for TS/TSX, Go, Python, Java and Rust, and 12.3 MB with Kotlin and
  Swift (measured 2026-10-31). The files are pinned by hash.
- A few seconds per run. The index-backed batch grouping changes which files share a batch, so
  results move. It is measured before it is on by default.

## Non-goals

- Type resolution or cross-file bindings.
- An index used outside a review run.

## What would reopen this

The index finds nothing on the benchmark that `git grep` and v1.4.0's evidence did not. Or its
build time on a large repository exceeds its limit in most runs.
