# ADR 0032: One ask core for the pull request and the laptop, grounded in the review, with checked references

- **Status:** proposed 2026-11-11. **Not implemented.** Amends one non-goal of
  [ADR 0008](0008-thread-follow-up-authority.md) ("Resolving or replying to human threads"): a
  human thread is answered when, and only when, its comment invokes the mention; resolving stays
  a non-goal. ADR 0008's reopen conditions (false-resolution rate, the two-reply cap) are not
  met; the amendment is the owner's direction of 2026-11-11. Reuses
  [ADR 0012](0012-automatic-thread-replies-and-a-per-pr-ceiling.md) (a per-PR ceiling),
  [ADR 0019](0019-a-review-core-behind-source-and-sink-ports-and-a-local-subscription-mode.md)
  (one core, local promise) and [ADR 0020](0020-an-opt-in-on-laptop-review-history-with-deterministic-finding-tracking.md).
- **Date:** 2026-11-11
- **Spec:** [A risk map on every review, and questions about the change](../specs/2026-11-11-risk-map-and-ask-design.md)
- **Issue:** #170

## Context

`/wachiman <anything that is not a review command>` already answers on a pull request
(`answer`, `src/engine.ts:3592`): one call over the title, body and diff, operator only, posted as
free text, in English. It does not see the review that ran, and the local CLI has no way to ask
(`localUsage`, `src/local.ts:63`).

The owner wants to ask about a teammate's change from the laptop, from a pull request comment and
from the review panel (#170), and asked what Wachiman adds over asking Claude Code. A format
alone adds little. What a chat agent lacks is the review result, references the engine has
checked, and the same answer on both surfaces.

Other tools scope chat by where the comment is written
([Qodo](https://docs.qodo.ai/code-review/chat-with-qodo-in-your-pull-requests.md),
[Graphite](https://graphite.com/docs/graphite-chat)). Anthropic's Code Review limits triggers to
commenters with write access ([docs](https://code.claude.com/docs/en/code-review)).

## Decision

1. **One core** answers a question, or explains the change when none is given. Three entries use
   it: a pull request comment, a line comment, and `wachiman ask` on the laptop.
2. **The prompt carries the latest review result** (findings, contracts, risk map, coverage).
   With none available the answer says no review was used.
3. **References are structured output.** The engine keeps a reference only if its path and line
   exist at the head commit, and states how many it removed.
4. **A line comment that invokes the mention is answered in its thread**, scoped to that file and
   line first. Wachiman never resolves a human thread and never answers one that does not invoke it.
5. **Authority.** The operator may always ask. `askers: write` lets collaborators with write
   access ask. Default `operator`. No other commenter is ever answered.
6. **Cost.** One call per question, capped by `answer_budget_usd`. Non-operator questions spend
   from a per-PR ask ceiling and are refused, with a comment, once it is reached.
7. **No stored conversation.** On GitHub a follow-up reads the thread it is in. On the laptop the
   developer's agent converses and calls `wachiman ask --format json`.
8. **Local** `ask` uses subscription auth and makes no GitHub request.

## Alternatives rejected

- **Leave questions to the developer's agent, ship only a skill.** No engine work. Rejected: it
  gives nothing on the pull request, and neither the review context nor checked references are
  guaranteed.
- **A conversation Wachiman keeps (sessions, memory).** Better follow-ups. Rejected: needs stored
  state or a service (ADR 0001 non-goal), and competes with the agent the developer already has.
- **Anyone who can comment may ask.** Most convenient on open repositories. Rejected: a stranger
  could spend the operator's money and feed the model crafted text.
- **Write collaborators by default.** Matches the owner's first stated default. Rejected as the
  default only: an upgrade would silently widen who can spend. It is one setting away.
- **Free-text answers with references in prose.** Simplest. Rejected: references cannot be
  checked reliably once they are prose.

## Consequences

- The caller workflow templates' author check must admit write collaborators when opted in.
- `comment` now also handles `pull_request_review_comment` events that invoke the mention.
- The CLI command contract and `docs/cli.md` gain `ask`.
- Answers get longer prompts (the review result); the per-question budget may need raising.
- The `wachiman-review` skill gains a section for follow-up questions.

## Non-goals

- Resolving any thread from an answer.
- Answering questions about code outside the change's repository, or running code to answer.
- Diagrams and visual explainers.
- Editing code as a result of a question.

## Reopen if

- The operator marks answers wrong more often than review findings.
- More than a few references per answer are removed by the check: the output shape is not
  working.
- Non-operator questions regularly hit the ask ceiling, or a repository needs askers who lack
  write access.
