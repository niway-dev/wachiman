# Plan: distributed-repo review, phase 1

Working document. It builds phase 1 of the
[distributed-repo review design](../specs/2026-11-13-distributed-repo-review-design.md) and is
deleted by the last pull request of the stack.

- **Phase 0:** run on 2026-11-19 and passed the owner's bar (tracker NIW2-761 holds the result).
  The phase 0 harness, a hidden trial variable, is not part of this stack.
- **Defaults taken for the open questions:** all six spec defaults. The manifest is
  `workspace.manifest.json`, found walking up from the reviewed repository or listed in the
  per-user file. The only accepted `format` is `workspace/1`. The per-user file is
  `<wachiman home>/workspaces.json`. `local` reads `HEAD` only and reports uncommitted changes. The
  size gate is unchanged. `pinned` reads a literal `ref` or a JSON key path, and falls back to
  `tip` for anything else.

## Stack

Three layers, bottom first. Each one is a pull request in a native stack.

### Layer 1: the workspace core (`src/workspace/`)

Pure modules, plus git reads on fixture repositories. No CLI and no engine wiring.

1. `manifest.ts`: read and validate `workspace.manifest.json`. That covers the `format` major,
   unique member `dir`s and contract names, and at least one provider and one consumer per
   contract. A missing or unknown `visibility` counts as private. A `dir` or glob that holds `..`,
   is absolute, or resolves outside the coordinator is refused.
2. `user-file.ts`: read `workspaces.json`. That covers `distributedRepo`, the `members.<dir>.dir`
   and `watch` keys, and `versions`. Unknown keys are ignored.
3. `discover.ts`: find the workspace for a repository. First the per-user file, matched by
   `repo` against the normalised `origin` and then by `dir`; otherwise a walk up to the manifest.
   Then match contracts against the changed paths: both sides of a rename, deleted paths, and the
   source-of-truth paths when the reviewed member holds the source. Then choose the members and
   paths to read.
4. `versions.ts`: resolve `pinned`, `local` and `tip` with the precedence of the spec. Each
   result carries its rule source, its fallback reason, the SHA, the age of `FETCH_HEAD` for
   `tip`, and whether there are uncommitted changes.
5. `snapshot.ts`: `git archive` of the resolved commit, restricted to tracked paths that the
   engine's own glob matcher selects from `git ls-tree`. Symlinks are dropped and listed. No
   `.git`. Nothing is fetched.
6. `docs/formats/workspace-manifest.md`: the keys Wachiman reads, in both files.

### Layer 2: the review (engine, local CLI, result, renderers)

1. `wachiman local` gets `--distributed-repo`, `--no-distributed-repo` and `--sibling <dir>`, with
   the exit-2 rules. A run turned on by the per-user default prints its default-on line.
2. Engine: only the batches holding a file that triggered a contract get the snapshots as
   `--add-dir` and the contract prompt section. Every other prompt is byte-identical. The
   verifier gets every snapshot.
3. References into a sibling are `{member, sha, path, line}`. Each one is kept only if that line
   exists in that member's snapshot, and the result counts the ones removed.
4. Result `/2`: `siblings[]`, `workspaceContractsApplied[]`, `noWorkspaceContractApplied`,
   `privateContext`, and optional `member`/`sha` on references. The published schema changes in
   the same commit.
5. Terminal and Markdown print the sibling lines, "no contract applied" and the private-context
   line. The GitHub sink refuses a result that carries `privateContext`.
6. Tests: byte-identical prompts without the flag, even with `kind: distributed` and a manifest
   present; the canary test for the GitHub mode; and the fixture acceptance cases (palette source
   in `desktop-app`, copy in `web-site`, the source of truth not cloned).

### Layer 3: ask, history, loop, docs

1. History stores `siblings` and `privateContext` with the result.
2. `wachiman ask` re-creates the stored snapshots by SHA, labels the answer, and follows the flag
   rules of the spec's "`ask` and history" section.
3. The review loop prints the private-context line.
4. The no-fetch test: a `git` wrapper that fails on `fetch`, `pull` and `clone`, and a `gh` stub
   that throws.
5. Documentation in `docs/local-review.md`, the help text, and the spec's status. This plan is
   deleted.
