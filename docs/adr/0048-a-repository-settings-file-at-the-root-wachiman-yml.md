# ADR 0048: A repository settings file at the root, `.wachiman.yml`

- **Status:** accepted 2026-11-13 by the owner. Implemented by the pull request that adds this
  file (`feat/init-project-kind`). Implements the `wachiman init` step "Project type".
- **Date:** 2026-11-13

## Context

`wachiman init` now asks what kind of repository this is: a monorepo or a single project (a
"distributed repository" is listed as coming soon and cannot be picked). The answer is about the
repository, not about a person or a machine, so it has to travel with the repository and be seen
by everyone who clones it. Today nothing in Wachiman reads it: it is metadata, recorded now so a
later feature (per-package review focus, for instance) can start from an answer that already exists.

Wachiman has no place for a setting like this. Review focus lives in `.github/wachiman.md` as free
text; bindings live in the home directory. Both `local` mode (no workflow at all) and `github` mode
(no `~/.wachiman` on the runner) have to see the same answer.

## Decision

1. **The answer is stored in `.wachiman.yml` at the repository root**, a new settings file, committed
   like any other file. Its first and only key is `kind: monorepo` or `kind: single`, with two
   comment lines that say what the file is and that the key is metadata for now.
2. **`init` writes it when the kind is known.** The kind is known from `--project-kind
   monorepo|single` or from the question on a terminal. Without a terminal and without the flag,
   `init` does not create or change the file, so scripted `init --yes` calls behave as before.
3. **`init` never overwrites a different answer silently.** The same `kind:` leaves the file
   untouched. A different or missing `kind:` replaces only the top-level `kind:` line (or appends
   one) and keeps every other line. On a terminal that is a confirmation; without one it needs
   `--force`.
4. **The file is read and written with plain string handling.** `init` only creates the file or
   replaces one line, so no YAML library is added.
5. **There is one file in one place.** Only the root `.wachiman.yml` is read or written; a second location is never accepted. It is YAML so it can carry comments, and it is not a workflow because it is not under `.github/workflows/`.

## Alternatives rejected

- **A local binding under `~/.wachiman`.** It is per machine and per person, and a `github`-mode
  repository is never bound there, so the answer would be lost for every clone and for CI.
- **An input of the reusable workflow.** It would change the workflow's public contract for a
  value nothing reads, and `local` mode has no workflow to carry it.
- **A `wachiman.yml` inside `.github/`.** Tried first and rejected: in local mode it sat alone in a folder that
  reads as GitHub Actions configuration, where nothing else of Wachiman's exists.
- **Both locations, like Renovate.** It raises the question of which one wins when both exist, and
  the answer would have to be documented, tested and explained to every user. One place needs none.
- **JSON (`.wachiman.json`).** No comments, and the file will carry commented optional keys.
- **A file inside `.github/workflows/`.** GitHub parses every YAML file there as a workflow, so a
  settings file would show up as a broken workflow.

## Consequences

- A repository that ran `init` with a kind has one more committed file. `init` prints the
  `git add` for it next to the workflow and, in `local` mode, a line that says to commit it.
- `--dry-run` never writes it; it prints `would write .wachiman.yml (kind: X)` on stderr
  and stdout stays the workflow only.
- Changing the kind later is `wachiman init --project-kind <kind> --force` (or editing the line).
- When this ADR was accepted the file was not read by any engine or CLI path. [ADR 0049](0049-model-and-effort-in-wachiman-yml-read-from-the-base-commit.md)
  adds two keys, `model` and `effort`, and makes the engine read the file from the base commit in
  Actions and from the merge-base locally, as the rule below required. `kind` is still metadata only.

## Non-goals

- The file does not choose an account, a profile or a binary, now or later. Those stay in the
  home directory, as [the named-profiles ADR](0029-named-account-profiles-external-config-directories-and-home-kept-project-bindings.md)
  decides.
- A distributed repository is not implemented. The choice is shown as coming soon and `--project-kind
  distributed` is refused with that message.
- No settings schema, no validation of unknown keys, and no merging beyond the `kind:` line. (ADR 0049 adds `model` and `effort` and validates only those; unknown keys are still ignored.)

## Reopen when

- A feature needs a second key, or needs the engine to read the file in CI: decide the schema,
  its limits and whether it is read from the base commit like `.github/wachiman.md`. (Met by ADR 0049 for `model` and `effort`.)
- Distributed repositories get an implementation: add the value and what it means.
- The file starts being used to select an account, a profile or a binary: that contradicts this
  decision and needs a new one.
