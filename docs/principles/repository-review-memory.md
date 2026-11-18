# Repository review memory

**Status: direction recorded 2026-11-17; not an implemented folder-loading feature.**
The intended separation below does not add YAML keys or change instruction precedence.

## Intent

Keep general agent context concise. Store substantial review-specific knowledge in dedicated,
versioned documents that map to the relevant parts of the codebase. A repository settings file
would identify the review document collection; the engine would select the relevant context
instead of loading every document for every change.

The owner describes this as memory that lives with the code: generated from code, reviewable by
maintainers and kept current as the code changes. That is broader than a growing `CLAUDE.md`.
It also differs from a history of past review results.

## Current boundary

At the [collection baseline](README.md#status-and-maintenance), the [settings parser](../../src/repo-settings.ts)
recognizes `kind`, `model`, `effort` and `paths` (the repository's path rules) in root `.wachiman.yml`. It does not implement a setting
that points at a folder of review documents. The [review-policy guide](../review-policy.md)
documents current instruction files. The proposed [repository policy](../adr/0006-repository-review-policy.md)
and [learned-memory decision](../adr/0007-learned-memory-by-draft-pr.md) contain earlier designs;
they are not evidence that the folder or automatic learning is implemented.

The current proposal differs from the earlier policy decision, which rejects selecting its
folder from a repository file. Resolving that trust rule needs a separate design: a pointer and
its target documents must come from an explicitly trusted revision, not be silently replaced by
the change under review. No example configuration is provided until that contract is decided.

## Criteria for a future design

- A small index maps documents to code scope and purpose, with a limit on loaded context.
- Facts cite the code revision and supporting paths. Maintainer rules remain distinguishable
  from generated observations and proposed lessons.
- An update to a supporting function can invalidate a fact; stale documents cannot silently
  remain authoritative. Record how each fact was checked and when it must be rechecked.
- Generated updates are reviewable diffs. They do not silently rewrite the review's own policy.
- Deletion, rename, conflicting instructions, missing documents and unavailable context have
  defined behavior visible in the report.
- Compare this design with the existing focus-file approach on the same changes: relevant
  defects, false positives, context size, latency, cost and maintenance work.

This direction can support multiple model providers. It does not claim that a particular
provider currently offers the best cost-benefit ratio or that the same context works equally
well with every model.
