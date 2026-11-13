# ADR 0049: Model and effort in `.wachiman.yml`, read from the base commit

- **Status:** accepted 2026-11-13 by the owner. Implemented by the pull request that adds this
  file (`feat/settings-model-effort`, stacked on `feat/init-project-kind`). Builds on
  [ADR 0048](0048-a-repository-settings-file-at-the-root-wachiman-yml.md) (the settings file) and
  uses the base-commit rule of [ADR 0006](0006-repository-review-policy.md), which reads review instructions from the base commit.
- **Date:** 2026-11-13

## Context

The model and the reasoning effort of a review are chosen in two places today: the `model` and
`effort` inputs of the reusable workflow (always sent to the engine, with defaults in the workflow)
and the `WACHIMAN_MODEL` / `WACHIMAN_EFFORT` environment variables on a laptop. A person who wants a
repository to review under another model has to know both and keep them in step, and `wachiman local`
never sees the workflow's inputs at all.

[ADR 0048](0048-a-repository-settings-file-at-the-root-wachiman-yml.md) created `.wachiman.yml` at the
repository root, visible in every mode, and said that any key that changes spend must be read from
the base commit in Actions. `model` and `effort` are exactly such keys: a stronger model or a higher
effort is a larger bill on the owner's key, and a pull request can edit any file in the repository.

## Decision

1. **`.wachiman.yml` accepts two optional keys**: `model` (any non-empty text, not checked further,
   like `WACHIMAN_MODEL`) and `effort` (`low`, `medium`, `high`, `xhigh` or `max`). Unknown keys are
   ignored. The file is parsed with Bun's built-in `Bun.YAML.parse`, so no dependency is added.
2. **Precedence, highest first:** an explicit workflow input or `WACHIMAN_MODEL` / `WACHIMAN_EFFORT`,
   then `.wachiman.yml`, then the built-in default. An empty value counts as not set.
3. **In Actions the file is read from the pull request's base commit, never from the head**, the way
   the focus file is. A pull request that edits `model` or `effort` is reviewed under the base's
   values, and its edit applies after merge. The workflow inputs `model` and `effort` therefore
   default to empty, so a default in the workflow no longer hides the file; an input set by the
   caller still wins.
4. **Locally the file is read at the commit the instruction files are read at**: the merge-base of
   the range, `HEAD` for a working-tree review, the base of an `--input` file. Not the working tree,
   for the same reason: the change under review does not choose what it is reviewed under.
5. **A broken file never blocks a review.** An unknown `effort`, a `model` that is not text, a file
   that is not a mapping, unparseable YAML or a file over 64 KB, at the base commit (Actions) or at
   the merge-base (local), is ignored with one warning in the job log or on stderr (`ignored
   .wachiman.yml at the base commit <sha>: <reason>; using defaults`), and the run continues on the
   environment and the built-in defaults. The pull request that fixes the file is itself reviewed
   under the defaults, never stopped by the file it fixes. `wachiman doctor` is where the broken
   file is a failure. A missing file is not an error. When both values are already explicit the
   file is not read at all.
6. **The run says where a value came from.** One log line in Actions (`settings: model …, effort …
   from .wachiman.yml at the base commit …`), one on stderr locally, and `(from .wachiman.yml)` in the
   last line of a local terminal or Markdown report. The posted review footer is unchanged.
7. **`wachiman doctor` gets a read-only `settings` row**: the file's `kind`, `model` and `effort`,
   where the effective model and effort would come from, and a required failure when the working
   copy of the file is invalid (it says runs read the file at the base commit or merge-base, so the
   fix takes effect once committed and merged). It also warns about an old `.github/wachiman.yml`:
   when no root `.wachiman.yml` exists the fix is `git mv .github/wachiman.yml .wachiman.yml`; when
   both exist the fix is to merge the old file into the root one, then remove it. Doctor never
   writes or moves anything and reads the working tree.
8. **`init` does not ask for either key.** A new file carries them commented out under a line that
   says the defaults are what Wachiman's benchmarks measure.

## Alternatives rejected

- **Read the file from the head, as CodeRabbit does with its repository configuration.** Simpler and
  it lets a pull request change its own review, but a pull request could then raise the model or the
  effort, and with it the cost, on the owner's key. The base-commit rule already protects the focus
  file for the same reason, and spend is the stronger reason.
- **Keep only workflow inputs and environment variables.** Two places that do not know about each
  other, and nothing a laptop run can read from the repository. A person looking for "where is the
  model set" would have to check the caller workflow and their shell.
- **`init` asks which model and effort.** Wachiman is opinionated: the defaults are the combination its
  benchmarks measure, and an init question invites a change nobody measured. The commented lines
  make the option findable without suggesting it.
- **A key for the verifier's model.** It would be a third spend knob in a file a repository edits
  freely; `verifier_model` stays a workflow input and `WACHIMAN_VERIFIER_MODEL`.

## Consequences

- A repository can set its model and effort in one committed file that works in Actions, in
  `wachiman local` and in `wachiman ask`, and `doctor` explains the result.
- A change to the file takes effect on pull requests opened after it is merged; a pull request that
  edits it is not reviewed under the edit. This is the intended behaviour and is documented.
- A caller that sets `model` or `effort` in its workflow keeps exactly what it had: an explicit
  input wins. A caller that sets nothing now gets the file's value where it used to get the
  workflow's default; with no file the defaults are unchanged (`claude-sonnet-5-5`, `high`).
- Actions makes one more GitHub API call per run (the base commit and the file) unless both values
  are explicit; a GitHub error other than "not found" stops the run, as for the instruction files.
- A bad `.wachiman.yml` at the base does not stop anything: runs warn, use the defaults and carry
  on, so the fixing pull request is reviewable. The cost is that a typo in `effort` is only a
  warning in a log nobody may read, and the repository reviews under the defaults until the fix
  merges; `doctor` reports the working copy as a failure.

## Non-goals

- The verifier's model is not in the file.
- The file never selects an account, a profile or a binary (ADR 0048 and the named-profiles decision
  still hold).
- No budgets, no provider and no other spend setting in the file.
- No reading of the file from the working tree for a run, and no second location.
- No refusal to run because of the file: it is advice about spend, not a gate.

## Reopen when

- A caller needs the pull request's own edit of the file to apply to its review: that would need a
  maintainer's approval step, not a read from the head.
- Another setting that changes spend or behaviour is proposed for the file: each one needs its own
  decision about where it is read from.
- Measured results show a model or effort that should become the default: change the built-in
  default instead of asking every repository to set it.
