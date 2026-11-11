# A risk map on every review, and questions about the change

- **Status:** proposed 2026-11-11. **Partly implemented:** the risk map (ADR 0031) on branch
  `feat/risk-map-core` and the stack after it; the ask core, its pull request path and
  `wachiman ask` (ADR 0032) on `feat/ask-core`, `feat/ask-line-comments-and-askers` and
  `feat/local-ask`. Not yet run in a real workflow or against a real provider. Written on Claude
  Fable 5.2.
- **Date:** 2026-11-11
- **Issue:** [#170](https://github.com/niway-dev/wachiman/issues/170)
- **Creates:** [ADR 0031](../adr/0031-a-risk-map-whose-level-the-engine-computes-from-checked-facts.md)
  (risk map), [ADR 0032](../adr/0032-one-ask-core-for-pull-request-and-laptop-grounded-in-the-review.md)
  (ask). **Numbering:** `main` holds up to 0030; open branches hold 0014–0015 (#80), 0017–0018
  (#90), 0021–0022 (#124, #129) and 0024–0026 (#135). 0031 is the first free number.
- **Reuses:** ADR 0003 (labels), ADR 0009 and ADR 0016 (the model proposes, the engine decides),
  ADR 0012 (per-PR ceiling), ADR 0019 (one core behind ports; local promise), ADR 0020 (history),
  ADR 0030 (result `/2`). **Amends:** one non-goal of ADR 0008 (see decision 8).

## Summary (one minute)

Wachiman today finds bugs, on GitHub Actions and on the laptop. The owner's direction of
2026-11-11 is that it should serve the whole review: tell the person reviewing how dangerous the
change is and where their judgement is needed, and answer their questions about it, on the pull
request and on the laptop. This design adds two things on top of the review that already runs.
A **risk map**: a short section in every review with a level (low, medium, high), the checked
facts behind it and the files to read first. And **ask**: one core that answers a question, or
explains the change when no question is given, from a pull request comment, a line comment in the
review panel, or `wachiman ask` on the laptop. Both use the review's own result (findings,
contracts, coverage), and the engine checks every file and line they cite. That is what a chat
agent reading the same diff does not give.

| # | Decision | Why | ADR |
| --- | --- | --- | --- |
| 1 | The risk level is computed by the engine from path rules and model-reported **risk facts**; the model never picks the level | Model-picked scores were close to random in Greptile's published attempt; a rule can be read, tested and corrected | 0031 (new) |
| 2 | Risk facts come from a closed list of kinds, each with a `path:line` the engine checks, reported by the batch calls the review already makes | No extra call; same check as a finding's line; reuses `RISK_RULES` | 0031 (new) |
| 3 | Three named levels with their reasons shown; no number, no gate, no approval | A bare score cannot be argued with; README already refuses approval and merge gating | 0031 (new) |
| 4 | The map is one section at the top of the review and an optional `riskMap` field in result `/2`. "Read first" is in every review, also when there are no facts; then the map is two lines | Same result on both surfaces. Telling the person where to look is the fixed part (owner, 2026-11-11); small changes must still stay quiet | reuses 0030, 0019 |
| 5 | One `ask` core serves the pull request comment, the line comment and `wachiman ask` | One prompt, one format, one set of tests | 0032 (new) |
| 6 | The ask prompt carries the latest review result; with none, the answer says so | This is the difference from a chat agent | 0032 (new) |
| 7 | An answer's references are structured fields; the engine removes any that do not exist at the head commit and says how many | A wrong reference costs the reader more than a missing one | 0032 (new) |
| 8 | A line comment that invokes the mention is answered in its own thread; Wachiman still never resolves a human thread and never answers one that does not invoke it | Owner's request: ask from the review panel. Scope follows where you comment, as in Qodo and Graphite | 0032 (new), amends 0008 |
| 9 | The operator may always ask. `askers: write` opts a repository in to collaborators with write access; nobody else, ever. Non-operator questions spend from a per-PR ask ceiling | The owner reviews teammates' PRs; an upgrade must not widen who can spend | 0032 (new) |
| 10 | No stored conversation. A follow-up on GitHub reads the thread it is in; on the laptop the developer's agent holds the conversation and calls `wachiman ask --format json` | No service (ADR 0001); Claude Code already converses well, so Wachiman supplies checked material instead of competing | 0032 (new) |

## Open questions

1. **Risk map on an incremental review (ADR 0011).** Default: the map of a push-only review covers
   that push and says so; the full map is in the last full review. Alternative: keep facts per file
   in the review marker and recompute the whole-PR level on every push.
2. **Ask ceiling value.** Default: `ask_ceiling_usd: 3` per pull request for non-operator
   questions, on top of `answer_budget_usd` per question.
3. **Command name.** Default: `wachiman ask [question]`; with no question it explains the change.
   Alternative: a separate `explain`. The command contract
   ([spec](2026-11-09-cli-command-contract.md), `docs/cli.md`) gains the command either way.
4. **Language of an answer.** Default: the language of the question; the risk map stays English.
   Today `answer` forces English (`src/engine.ts:3612`).
5. **`askers` default.** This spec keeps `operator` and makes `write` opt-in. The owner's stated
   default in the design conversation was "operator plus write collaborators". Opt-in was chosen
   so an upgrade does not let more people spend; flip the default if that is not a concern.
6. **Do risk facts lower finding quality?** They are added to the batch schema. If the Martian
   run drops beyond its run-to-run spread, the facts move to one separate capped call.

## Out of scope

- Approving, blocking or requiring reviewers from the level; any tie to branch protection.
- Several verifiers voting on a finding, a round cap, bug-class fixes: ideas from the same source,
  each its own design.
- `REVIEW.md` or other repository review policy (ADR 0006, proposed).
- Diagrams, a side panel, visual explainers.
- Questions from people without write access, from forks, or from bots.
- A numeric risk or effort score.

## Failures this must protect against

All of these are risks, not observed events.

- The map says "medium" on every pull request and stops being read.
- A low level is shown while files were not reviewed.
- A fact or an answer cites a file or line that does not exist.
- The map adds a block of text to a one-line change.
- Someone without authority triggers paid runs by commenting, or many questions exhaust the budget.
- Text in a question, a pull request body or the code steers the answer into leaking a secret
  (`refuseLeak` and `neutralise` already guard the existing answer path).
- An answer contradicts an open finding without mentioning it.
- The local command makes a GitHub request, breaking ADR 0019's promise.
- Adding risk facts to the batch schema lowers recall or precision of findings.

## Acceptance criteria

- [ ] `riskLevel(facts, files, coverage)` is a pure function with a unit test per rule in section 2.
- [ ] A review of a change that touches a `RISK_RULES` path posts `### Risk map` with the level,
      at least one reason, and every reason's `path:line` exists at the head commit.
- [ ] A fact whose path or line does not exist is dropped and counted in the run log (unit test).
- [ ] A change with no facts and no rule match renders the map as exactly two lines: the level
      line and "Read first".
- [ ] Every review with at least one reviewed file renders "Read first" (test over the fixtures).
- [ ] A partial review renders the level as "at least <level>" and names the unread files count.
- [ ] `wachiman local --format json` with result `/2` includes `riskMap`; `/1` omits it and the
      `/1` schema test still passes.
- [ ] One Martian run with risk facts in the schema is within the spread of two baseline runs on
      F1; the three numbers are recorded in `wachiman-benchmarks` `martian/history.md`.
- [ ] `/wachiman <question>` as a pull request comment: the prompt contains the latest review's
      findings and risk map (test on the built prompt), and the answer is one comment.
- [ ] The same in a line comment: the reply is posted in that thread, the prompt names that file
      and line, and no thread is resolved (test on the `gh` calls made).
- [ ] An answer with a reference to a missing path or line is posted without it and with the
      notice "N references could not be checked and were removed" (unit test).
- [ ] With `askers: operator`, a write collaborator's question is ignored with a warning; with
      `askers: write` it is answered; a commenter without write access is ignored in both.
- [ ] A non-operator question that would pass `ask_ceiling_usd` is refused with a comment that
      says so, and spends nothing.
- [ ] `wachiman ask "…"` in a repository with a `gh` stub that throws completes (no GitHub
      request), and with no stored review its output states that no review was used.
- [ ] `wachiman ask` with no question prints the five walkthrough sections of section 3 in order.

---

## 1. What sets this apart (the product claim)

The owner asked what Wachiman adds over asking Claude Code about a diff. A fixed format alone adds
little: a saved prompt gives the same sections. Three things a chat agent does not have:

1. **The review that already ran.** Findings with their verification, the contracts block ("what
   the change connects to"), coverage by batch and, locally, the history (ADR 0020).
2. **Checked references.** A finding is dropped when its line is not in the diff
   (`commentableLines`, `src/engine.ts:621`). An answer's reference can point at any line of the
   head, so `checkRefs` (`src/ask.ts`) checks it against the head snapshot's line count instead
   (`src/local-ask.ts`, `src/ask.ts`).
3. **One result on two surfaces**, with a deterministic scope (`--base`, `--from`, `--commit`) and
   a capped cost.

Every decision above is there to keep one of these three.

## 2. Risk map

**Inputs.**

- *Path rules.* `RISK_RULES` (`src/engine.ts:362`) already gives each changed file a weight and a
  reason; it orders batches and fills the "Highest risk" column of the coverage table.
- *Risk facts.* A new optional array in the batch output schema (`SCHEMA`, `src/engine.ts:1216`).
  Each fact: `kind`, `path`, `line`, one sentence. Kinds, closed list: `data-migration`,
  `irreversible` (deletes data, sends something outside), `auth`, `money`, `concurrency`,
  `public-contract` (a shape something outside this change consumes), `config-or-ci`,
  `dependency`.
- *Judgement items.* At most three across the review, kinds `direction`,
  `pattern-others-will-copy`, `tradeoff`: places where the code cannot settle the question and a
  person must. May be empty.
- *Coverage.* Files not reviewed.

**Level.** The highest of: the level of the top path-rule weight (two thresholds), and the fixed
level of each fact kind (`data-migration`, `irreversible`, `auth`, `money`: high; `concurrency`,
`public-contract`, `config-or-ci`: medium; `dependency`: low unless a rule raises it). Unread
files turn the level into a floor ("at least"). Findings do not change the level: the level
describes the change, findings describe defects. The thresholds and the table are constants with
tests; the plan calibrates them on the consumer repositories' merged pull requests before release.

**Rendering** (GitHub body, right after the count line; `## Risk map` in local Markdown):

```markdown
### Risk map

**High.** This change alters stored data and a permission check.

- `data-migration` · `db/migrations/0042_split_name.sql:1` — drops `users.name` after copying it.
- `auth` · `src/api/session.ts:88` — the role check now runs after the handler is chosen.

**Needs a person:** `src/billing/retry.ts:40` (`tradeoff`) — retries are capped at 3; whether a
fourth charge attempt is acceptable is a product call.

**Read first:** `db/migrations/0042_split_name.sql`, `src/api/session.ts`, `src/billing/retry.ts`.
```

(Illustrative; invented paths.) "Read first" is the engine's order: files with facts, then by
`riskScore`. "Read first" is never omitted. With no facts and no rule match the map is two lines:
`**Risk map:** low — no risk facts in this change.` and `**Read first:** …` (largest change first).

The map survives trimming longer than the contracts block and the coverage table
(`trimMiddle`, `src/engine.ts:1182`).

## 3. Ask

**Triggers.**

| Where | Scope given to the model | Reply goes to |
| --- | --- | --- |
| Pull request comment with the mention | whole change | one pull request comment (as today) |
| Line comment with the mention, in the review panel | that file and line first, whole change available | the same thread |
| `wachiman ask [question]` | the local scope flags `local` already has | terminal, Markdown or JSON |

`parseCommand` (`src/engine.ts:238`) keeps routing `review`; everything else is a question.

**Prompt.** The annotated diff and file list, the pull request title and body on GitHub, the
question, the thread's earlier comments when asked in a thread, and the latest review result:
findings with verification and origin, contracts, the risk map, coverage. On the laptop the
latest result is the stored review for the same head when `--history` has one (ADR 0020).

**Output.** Structured: sections with a title, a body and a list of `{path, line}` references.
The engine keeps a reference only if the path exists at the head commit and the line is within
the file; on GitHub it renders it as a permalink at that commit. Removed references are counted
in one notice line. With no question, the sections are fixed:

1. What the change does (two or three sentences).
2. How it is built, in reading order.
3. What it connects to (from the contracts).
4. Open findings and how they bear on the above.
5. What was not covered.

**Authority and cost.** Decision 9. Write access is read with
`gh api repos/{repo}/collaborators/{login}/permission`; the caller workflow templates' author check
changes with it. Each question is one call capped by `answer_budget_usd` (existing, default $1).

**Local.** Subscription auth and no GitHub request, as `local` (ADR 0019 decisions 4 and 5). The
`wachiman-review` skill gains a section: for follow-up questions the agent calls
`wachiman ask --format json` and answers from it. Wachiman does not run the developer's agent, so
ADR 0019's non-goal stands.

## 4. What other tools do (research, 2026-11-11)

Read on the linked pages unless marked.

- **CodeRabbit** posts a walkthrough with a files table, an "estimated review effort" 1–5 and a
  "Merge Risk" level; it does not publish how the risk is computed
  ([docs](https://docs.coderabbit.ai/pr-reviews/walkthroughs)). Chat by `@coderabbitai` mention
  ([docs](https://docs.coderabbit.ai/guides/commands)).
- **Qodo** scopes chat by where the comment is written (a finding, a line, the pull request) and
  needs the tag in every message
  ([docs](https://docs.qodo.ai/code-review/chat-with-qodo-in-your-pull-requests.md)).
- **Greptile** shows a 0–5 merge-confidence score
  ([docs](https://www.greptile.com/docs/code-review/first-pr-review)). Its own account of an
  LLM-assigned severity score is that the ratings were nearly random
  ([blog](https://greptile.com/blog/make-llms-shut-up)).
- **Graphite** has a chat panel on the pull request page, with line selection
  ([docs](https://graphite.com/docs/graphite-chat)).
- **Anthropic's Code Review** product runs only for commenters with write access and has neither
  a risk map nor questions ([docs](https://code.claude.com/docs/en/code-review)). Internally a
  classifier sets a risk tier per change and ties it to how many people approve; explainers are
  written on request
  ([post](https://claude.dev/blog/solving-code-review-at-anthropic/)).
- No tool found publishes a reading order or a "what to keep in mind" list, and no study was found
  on whether reviewers use risk or effort scores. Reports of comment-triggered prompt injection
  against review bots exist but were not read at the source
  ([Kudelski](https://kudelskisecurity.com/research/careful-where-you-code-multiple-vulnerabilities-in-ai-powered-pr-agent),
  unchecked).

What this design takes: scope follows where you comment; write access as the outer limit; a named
level with reasons. What it does differently: the level is a rule over checked facts, and answers
are built on the review result.
