# ADR 0042: What a run may read depends on where its output goes

- **Status:** proposed 2026-11-13. **Not implemented.** Phase 1 of the
  [distributed-repo review design](../specs/2026-11-13-distributed-repo-review-design.md) builds it,
  after phase 0. Keeps [ADR 0019](0019-a-review-core-behind-source-and-sink-ports-and-a-local-subscription-mode.md)
  decision 5 true: local mode makes no GitHub request and sends no telemetry.
- **Date:** 2026-11-13
- **Spec:** [Distributed-repo review](../specs/2026-11-13-distributed-repo-review-design.md),
  decisions 2 to 4.
- **Tracker:** NIW2-761
- **Numbering:** 0042 because `main` holds up to 0039 (0037 is used twice), #202 reserves 0040 and 0041, and #210,
  #223 and #232 hold 0045 to 0048.

## Context

With `--distributed-repo` a review can read sibling repositories of a multi-repo workspace
([ADR 0044](0044-contracts-name-a-source-of-truth-and-a-version-rule.md)). Some siblings are
private while the reviewed repository, or the place its output goes, may be public. For example, a
public `api-client` and a private `billing-service` in one workspace: a review of the client that
read the service could explain, in ordinary prose, an exception the service makes that nobody
published.

A filter on names and paths cannot stop that. `refuseLeak` (`src/engine.ts:2888`) checks
credential shapes only, and a paraphrase names no private file. An adversarial review of the draft
(2026-11-13) also listed other doors: history and `ask` reuse a stored result with no label
(`src/history/types.ts:46-51`, `src/local-ask.ts:51-75`), the manifest itself names private
members, and an instruction file of the coordinator could reach a prompt.

CodeRabbit is the only reviewer researched that states a rule: in `auto` mode a public repository
links only to public repositories
([docs](https://docs.coderabbit.ai/knowledge-base/multi-repo-analysis)). None states a rule against
quoting a private linked repository in a public comment.

## Decision

1. **The destination is fixed before anything is read.** Every run knows where its output can go:
   the laptop (terminal, Markdown file, JSON on stdout or in a file, history) or a place others can
   read (a pull request, an issue, a comment). The engine decides what may be read from that, not
   from what the model is asked.
2. **A run whose output can reach a place others read never reads a private sibling**, nor the
   manifest's entries for private members. A run whose output stays on the laptop may read any
   cloned sibling.
3. **Visibility is declared, and unknown counts as private.** A member's `visibility` comes from
   the manifest (local mode makes no GitHub call, so it cannot be checked). A missing, misspelled or
   unknown value is private.
4. **Version 1 has only the laptop destination.** `--distributed-repo` exists only on
   `wachiman local` and `wachiman ask`. No GitHub-mode code path reads a manifest or a sibling.
   On `ask` the flag reads nothing the stored review did not read, and an answer grounded in a
   labelled review is labelled with or without the flag (ADR 0043 decision 5).
5. **A result that read a non-public sibling is labelled** `privateContext` (with the members) in
   the result JSON and in history. `ask` answers grounded in it are labelled. The terminal, the
   Markdown report and the review loop print one line: "Built with private context from:
   `<members>`. Do not paste its text into a public place."
6. **Sinks that write outside the laptop refuse a labelled result.** The GitHub sink checks the
   label and refuses before building anything. No such path uses a local result today; the check
   keeps it so when one is added.
7. **The name and path filter is the second line only.** It catches an accidental private name. It
   is never described as a confidentiality guarantee.
8. **What the guarantee covers is stated:** Wachiman's own reads and its automated sinks. A person,
   or their agent, copying a private-context finding by hand into a public place is outside it,
   and the docs say so. The developer already has access to what was read; the rule is about
   where Wachiman puts it.

## Alternatives rejected

- **Read everything on the laptop, no label.** Simplest. Rejected: history and `ask` reuse a
  stored result, so private context flows into later calls with nothing to say where it came from.
- **A name and path filter on public output.** Catches names, not information. A finding can
  disclose private behaviour with only public file names in it.
- **Read by repository visibility only (public sees public, private sees private).** CodeRabbit's
  rule. It is close to decision 2, but "private" is not one audience: two private repositories can
  have different readers. Version 1 avoids the question by having no shared destination.
- **Ask the model to keep private details out of public output.** Not checkable, and the model
  cannot know which sentence came from which repository.

## Consequences

- Every new sink, and every new input to a prompt (an instruction file, the manifest, a
  diagnostic), must state its destination class and whether it can carry private context.
- `ReviewResult` `/2` gains an optional `privateContext` field; history keeps it.
- The guide for the mode explains the label and the manual-copy limit in plain words.
- A remote phase cannot simply add a flag: it needs a public projection of the manifest and an
  answer for audiences, each a new decision.

## Non-goals

- Deciding which private repositories share an audience.
- Detecting whether a sentence carries private information.
- Checking a member's real visibility on its host.
- Any remote run with siblings.

## Reopen if

- A remote run with siblings is designed: it needs a public projection of the manifest and an
  audience rule beyond a visibility flag.
- A real `claude -p` run in ADR 0019's populated-HOME harness shows that a coordinator's
  instruction file reaches the review subprocess: classify that input and block it for any
  destination other than the laptop.
- A labelled result is found in a public place through an automated path: the label is not being
  carried, and the sink check moves earlier.
