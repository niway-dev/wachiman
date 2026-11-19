# ADR 0006: Repository review policy lives in the repository, read from the base commit

- **Status:** proposed 2026-10-30. The policy folder, `wachi.yml` and severity overrides are not
  implemented. The `learned/` location is superseded by
  [ADR 0056](0056-repository-memory-lives-in-wachiman-memory-and-changes-only-through-one-draft-pull-request.md),
  proposed 2026-11-18: memory lives in `.wachiman/memory/`, and an `exception` entry may mute a
  Consider or Info finding, which narrows the rule here that a learned lesson has no authority. The prerequisite of this ADR, issue #10, is fixed on `main`: the engine reads the focus file,
  `CLAUDE.md` and `AGENTS.md` from the pull request's base commit (`readBaseInstructions`), but
  from `base.sha`, not the merge-base of decision 3.
- **Date:** 2026-10-30
- **Spec:** [2026-10-30-review-memory-and-threads-design.md](../specs/2026-10-30-review-memory-and-threads-design.md)

## Context

Today a consumer tells Wachi what matters in two ways. The focus file `.github/agent-review.md`
is appended to the prompt, and the model is told to read `CLAUDE.md`. Both are read from the
pull request head (#10), so a pull request can rewrite the instructions it is reviewed under.
ADR 0001 decision 4 says the review policy is versioned separately and changes only by pull
request. The mechanism for that was never built.

The owner wants Wachi to accumulate a repository's rules over time without a server and
without keeping user data. Rules written on purpose by a tech lead must stay apart from rules
Wachi proposes, and must win over them. A downgrade of a finding's severity has to be
deliberate and visible, because a downgrade buried in prose silently mutes findings later.

## Decision

1. **Location.** The policy is a folder in the consumer's repository, `.github/wachi/` by
   default. The reusable workflow input `policy_dir` sets it. The location is never read from
   a file in the repository.
2. **Contents.**
   - `wachi.yml`: reference config with rule globs, a doc-to-code map, excludes and severity
     overrides. It never holds budgets or batch sizes; those stay workflow inputs (ADR 0001
     decision 6).
   - `rules/*.md`: intentional rules.
   - `learned/*.md`: lessons (ADR 0007).
   - `wachi.yml` is parsed with `Bun.YAML` against a strict schema, so ADR 0002 holds.
3. **Base, not head.** Every policy file, plus `CLAUDE.md` and `AGENTS.md`, is read from the
   exact base commit of the pull request. For a stacked pull request whose base is not the
   default branch, it is read at the merge-base with the default branch. The head's copies are
   content under review. A missing or invalid policy never falls back to the head.
4. **Authority.**
   - Engine constraints always apply: the severity tests, the evidence rules and the
     invariants.
   - Intentional rules add criteria.
   - Learned lessons are examples with no authority.
   - Prompt order is not the enforcement. The engine renders each layer in its own labelled
     section and rejects what a layer may not do.
5. **No downgrade in prose.** A rule or lesson cannot lower a severity. The only way is a
   `severity_overrides` entry with `paths`, `topic`, a `max` severity and a `reason`.
   - An entry without a reason is a config error.
   - The `security` topic cannot be overridden.
   - When a rule's text tries to downgrade, the engine does not apply it. The review body
     points to the key instead.
6. **Day one.** A new install has no learned lessons. `CLAUDE.md` and `AGENTS.md` from base
   are the initial rules.

## Alternatives rejected

- **Keep reading from the head.** This is #10: the pull request picks its own rules.
- **A hosted memory store**, even a per-tenant Durable Object with client-side encryption. It
  is a hosted service, with availability, breach and data-protection duties, and ADR 0001
  lists that as a non-goal. The repository already provides storage, history, review and
  access control.
- **One flat `.coderabbit.yaml`-style file.** Long prose rules in YAML are hard to review, and
  a single file merges intentional and learned content.
- **Let rules lower severity.** It is convenient, and it is the path by which a repository
  ends up muting the findings it most needs.
- **A repository file that names the policy folder.** A pull request could point it at a
  folder it controls.

## Consequences

- A pull request that legitimately changes the policy is reviewed under the old policy until
  it merges. The review body says so.
- The engine needs the base commit's files. The workflow fetches them via the contents API or
  a shallow fetch of `base.sha`.
- The focus file `.github/agent-review.md` keeps working, read from base, and is treated as
  an intentional rule with a deprecation notice.
- Overrides show up in review: each one is a YAML entry with a reason, and the review body
  lists the overrides that applied.

## Non-goals

- Policy fetched from a URL at run time (ADR 0001).
- Org-wide shared policy. A consumer can vendor it into each repository.
- Executable rules or plugins.

## Reopen if

- A consumer needs one policy across many repositories and vendoring it per repository proves
  unworkable.
- Reading from base blocks a common workflow. For example, a team that reviews policy changes
  only by trying them on the same pull request.
