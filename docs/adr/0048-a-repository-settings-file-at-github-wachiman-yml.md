# ADR 0048: A repository settings file at `.github/wachiman.yml`

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

1. **The answer is stored in `.github/wachiman.yml`**, a new repository settings file, committed
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
5. **The file is not a workflow.** It lives beside `.github/workflows/`, not in it.

## Alternatives rejected

- **A local binding under `~/.wachiman`.** It is per machine and per person, and a `github`-mode
  repository is never bound there, so the answer would be lost for every clone and for CI.
- **An input of the reusable workflow.** It would change the workflow's public contract for a
  value nothing reads, and `local` mode has no workflow to carry it.
- **A file inside `.github/workflows/`.** GitHub parses every YAML file there as a workflow, so a
  settings file would show up as a broken workflow.
- **`.wachiman.json` at the repository root.** The [CLI design](../specs/2026-11-09-cli-and-verified-reviews-design.md)
  already treats anything read from the reviewed repository as untrusted for choosing an account
  or a binary. A new root config file would invite that use; a file beside the workflows, whose
  contract says it never chooses them, does not.

## Consequences

- A repository that ran `init` with a kind has one more committed file. `init` prints the
  `git add` for it next to the workflow and, in `local` mode, a line that says to commit it.
- `--dry-run` never writes it; it prints `would write .github/wachiman.yml (kind: X)` on stderr
  and stdout stays the workflow only.
- Changing the kind later is `wachiman init --project-kind <kind> --force` (or editing the line).
- The file is not read by any engine or CLI path today. A later feature that reads it needs its
  own decision about what it may influence.

## Non-goals

- The file does not choose an account, a profile or a binary, now or later. Those stay in the
  home directory, as [the named-profiles ADR](0029-named-account-profiles-external-config-directories-and-home-kept-project-bindings.md)
  decides.
- A distributed repository is not implemented. The choice is shown as coming soon and `--project-kind
  distributed` is refused with that message.
- No settings schema, no validation of unknown keys, and no merging beyond the `kind:` line.

## Reopen when

- A feature needs a second key, or needs the engine to read the file in CI: decide the schema,
  its limits and whether it is read from the base commit like `.github/wachiman.md`.
- Distributed repositories get an implementation: add the value and what it means.
- The file starts being used to select an account, a profile or a binary: that contradicts this
  decision and needs a new one.
