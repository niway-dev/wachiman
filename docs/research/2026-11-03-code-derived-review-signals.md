# Code-derived review signals: what the data-path questions taught, and where to take it

- **Date:** 2026-11-03
- **Status:** idea backlog from the owner's conversation after the A/B. Nothing here is decided
  or built beyond what is marked **done**. Ideas that change the engine go through a spec and an
  ADR first.
- **Related:** [ADR 0016](../adr/0016-data-path-questions-chosen-by-the-engine.md) (the data-path
  questions); #90 (draft: engine-extracted obligations, a spend tier, memory from contracts, which
  builds on ADR 0016); the
  [field run](https://github.com/niway-dev/wachiman-benchmarks/blob/main/2026-11-02-field/README.md)
  and the
  [A/B](https://github.com/niway-dev/wachiman-benchmarks/blob/main/2026-11-03-data-path-questions-ab/README.md)
  in wachiman-benchmarks.

## In one minute

- **What we learned.** The model had the code of #479's High bug in front of it in both arms of the
  A/B. Without the question it checked "is it locked, does it fail safely", said yes, and approved
  the code. With the question it checked "is the target still what we mean to delete", and found
  that `sourceMatches` was computed but unused. **The model answers the question it is asked.**
  Naming the property to compare, the moment, and where to look turned 2 of 10 into 7 of 10, at
  lower cost per batch ($0.52 against $0.59, 5.9 turns against 7.7).
- **Why it is cheap.** The engine picks the questions with plain code (patterns in the added lines)
  before any model call. Code costs nothing per review. A precise question also seems to make the
  model stop sooner. That is an inference from fewer turns, not measured directly.
- **The direction:** compute more of the review's context with code, and leave the model the
  judgement. The more the engine hands over as facts, the less the model spends finding them.
- **The caveat that stays:** the five questions were written from the same 10 bugs. They show the
  tool *can* improve. Held-out bugs decide whether these questions generalise.

## 1. Intent can be read from code

A diff states its intent in its operations, before any model reads it:

| Operation in the added or removed lines | What it signals | Example question it could select |
| --- | --- | --- |
| `unlink`, `rm`, `DELETE`, `.delete(`, `splice`, `shift`, `pop`, `filter` that drops items | data leaves | Is the target still what we mean? What if the delete fails? |
| `push`, `unshift`, `insert`, `set` on a shared map or store | data enters shared state | Who else writes this key? Is there a cap? |
| a `catch` returning a default | a failure becomes a value | Is "unreadable" told apart from "missing"? |
| `await` between a read and a write | a window for another call | Two calls at once? |
| a timeout, retry, poll, probe | waiting | What bounds the whole operation? |
| the diff removes more lines than it adds in a module others import | a dependency or contract changes | Which callers relied on what was removed? |
| a dependency version or import path changes | behaviour from outside changes | What changed in the dependency that this code uses? |
| a function gains I/O, a clock or global state (pure → impure) | testability and ordering change | Which callers assumed it was pure? |

**Done:** the first five rows, as the five ADR 0016 questions (regex triggers in
`src/questions/`). **Ideas:** the other rows.

## 2. Accumulating more patterns

Sources, roughly by how directly they turn into a detector plus a question:

1. **Our own misses.** Every field run and replay produces misses with a fix commit. The loop is:
   miss → name the property the model failed to compare → question and detector → A/B on the batch
   that held the miss → a held-out check. This is how the first five were made.
2. **Bug taxonomies with names.** CWE gives stable names and examples. Candidates: CWE-367 TOCTOU
   (destructive steps), CWE-362 race condition (overlapping calls), CWE-703 and CWE-755 (improper
   handling of exceptional conditions: a read error as empty), CWE-400 and CWE-834 (unbounded
   resource use and loops: unbounded waits).
3. **Books on failure in production.** *Release It!* (stability antipatterns: integration points,
   unbounded result sets, cascading failures; stability patterns: timeouts, circuit breakers,
   bulkheads). *Designing Data-Intensive Applications* (lost updates, write skew, read-modify-write
   cycles, clock assumptions).
4. **Design principles.** SOLID, KISS, YAGNI, pure versus impure functions. These are harder to
   detect mechanically and produce more opinion than defect. Use them as questions only where a
   concrete, checkable property exists (for example, "a function became impure and its callers
   cache its result").
5. **Mining fix commits at scale.** wachiman-benchmarks already has SZZ scripts (`mining/`): find
   the commit that introduced a bug from the commit that fixed it. Group the fixed bugs by
   operation type to rank which patterns pay off first.

Each new question has to earn its place the same way: it fires on few files outside its pattern,
and an A/B shows it finds something without new invalid findings or a cost rise.

## 3. oxlint as the detector engine, and "bug → lint rule"

Two separate ideas:

1. **AST detectors instead of regex.** Today's triggers are regular expressions over added lines,
   and each module documents its misses (for example, `read-error-as-empty` needs the write in the
   same added lines). An AST, with scopes and data flow inside a function, would make triggers more
   precise: "this `catch` returns a value that reaches this `writeFile`". oxlint parses JS and TS
   very fast and supports custom rules. **To verify:** the current state of oxlint's JS plugin
   API, and whether a plugin can run on a diff's files and report matches without failing a
   build.
2. **Turn a found bug into a rule in the consumer's repository.** Some engineers ask an AI to
   write a lint rule after each bug, so the next occurrence costs nothing. Wachiman could propose
   the rule as a follow-up when a finding is confirmed (a "Fixed in <sha>" reply). The cheapest
   review is the one that never needs the model. **Open:** where the rule lives (the consumer's
   oxlint config), and how to avoid a rule that only matches one historical line.

ADR 0002 (zero dependencies) applies to the engine. An oxlint-based detector would be an optional
binary or a consumer-side tool, and that needs its own decision.

## 4. Metrics on everything

Per question, per review, kept in wachiman-benchmarks for our repositories, and as aggregate counts
only for private adoption data:

- firing rate per file and per batch, on data PRs and on UI, docs or CI PRs;
- whether the batch's `contracts` answered the question, and with what status;
- findings attributed to a question, and how many were confirmed by a later fix;
- cost and turns per batch with and without questions;
- for re-reviews: cost and turns against the size of the delta.

The engine already logs the selected question ids per batch (`Data-path questions for part …`).
The usage dashboard spec (`docs/specs/2026-10-31-usage-dashboard-design.md`) is the natural home.
Public repositories that adopt Wachiman would give the largest sample, with their consent.

## 5. A/B tests as a routine, on the Claude Code subscription

- **Done once:** the 2026-11-03 A/B ran on the owner's Claude Code login, with no API key. Its
  $11.11 is the provider's reported, API-equivalent cost; the subscription's usage limits are the
  real constraint.
- **Workaround used:** the provider passes an allowlist of environment variables to `claude`, and
  `USER` is not on it. A local Claude Code login reads the macOS keychain, which needs `USER`. The
  harness wraps `claude` to restore it (`harness/claude-with-user.sh` in the A/B folder).
  **Idea:** pass `USER` when no `ANTHROPIC_API_KEY` is set, so a local run needs no wrapper.
- **Idea:** make the harness a script in wachiman-benchmarks that takes two engine refs and a list
  of batches (`batches.tsv`), and run it on every PR that changes the prompt or the questions.
- **Held-out next:** the kaipu-record bug catalogue (15 bugs with their introducing and fixing
  commits, none used to write the questions). Count how many fall in the five families, then run
  the same A/B. About $15–20 of reported cost at the A/B's rate.

## 6. Re-reviews: cost follows turns, not the diff

From #89's diagnosis: none of the field run's 19 re-reviews sent a whole diff, so a delta-only diff
would have saved nothing. Cost follows turns (about $0.04 each), and median turns per run doubled
from 7 to 14 in v1.4.0. #90 adds that cache reads are 92–95 % of an agentic run's tokens. Levers,
in the order to try:

1. **A turn cap proportional to the delta.** For example, 6 to 8 turns for a 20-line fix. Small to
   build and measurable with the same logs.
2. **Inherit the previous review's conclusions.** Give the re-review the earlier `contracts` and
   summary for the files it touches, and ask it to read only the new hunks and what they reach.
   Risk: an earlier wrong conclusion is inherited.
3. **A stable prompt prefix**, so the provider cache can be reused across pushes. It only helps if
   pushes land within the cache's lifetime.
4. **Wait for a quiet period** before re-reviewing. #482 had five rounds in about 90 minutes.

## 7. Open items outside the engine

- **kaipu-record part 4 (#483) is not on `main`.** It merged into the part-3 branch 21 seconds
  after that branch merged. `feature/niw2-601-workspaces-part-3-settings` still points at the merge,
  and a test merge into `main` has no conflicts. A PR from that branch is all it takes, after
  checking the API migration's deploy order.
- **A cs19.dev post** about the field run and the A/B. It waits for the owner's own hook and lesson.
