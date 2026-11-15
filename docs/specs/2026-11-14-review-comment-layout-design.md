# One fixed layout for the review comment, its inline findings and its notices

- **Status:** draft 2026-11-14. The owner answered open questions 1 to 4 on 2026-11-14; open
  questions 5 and 6 run on their defaults unless the owner says otherwise.
- **ADR:** [ADR 0055](../adr/0055-the-review-comment-is-rendered-in-fixed-slots-from-a-view-model.md) (new).
- **Issue:** [NIW2-810](https://linear.app/niway/issue/NIW2-810/wachiman-one-fixed-layout-for-every-comment-on-a-pull-request-summary)

## Summary (one minute)

Today the review body answers nothing at the top: a count line that does not add up, a risk map
that can read only "**Low.**", the findings to fix listed only inline, several batch paragraphs,
and a footer of eleven values in one small line. This spec gives the review comment and the
comments that stand in for it (inline findings, not-reviewed notices, rebase notices) one fixed order: a
status line, an "At a glance" table, the findings to act on as a table, then optional detail
collapsed, then a short cost line that stays the machine contract. Everything is still rendered
by code from data the engine already has. **No prompt, schema or model call changes, so a review
costs the same.** The build is four pull requests, each protected by golden Markdown files and
parser round-trip tests instead of more string assertions.

| # | Decision | Why | ADR |
| --- | --- | --- | --- |
| 1 | The review body has fixed slots in a fixed order; an empty slot is omitted, never moved | A reader learns where to look once | 0055 (new) |
| 2 | The first line is a computed status: Not reviewed > Partial > Blocker > Fix > Needs investigation > none; partial coverage always shows beside it | The answer comes first; a failure never looks like "no findings" | 0055 |
| 3 | "before merge" is said only for Blocker; Fix is "to fix in this PR"; there is no ✅ | ADR 0003 defines Fix as not blocking; a green check reads as approval, which ADR 0031 point 5 and ADR 0033 reject | reuses 0003, 0031, 0033 |
| 4 | An "At a glance" two-column table: findings (adds up, Info included), risk with its top reason, needs a person, coverage, earlier threads, read first, how to answer | Two columns stay narrow; every row is a question a reader asks | 0055 |
| 5 | Blocker and Fix findings of this pull request are listed in the body as a table, whatever their anchor; Consider too, collapsed above eight rows | A skimmer must see what to fix without opening threads | 0055 |
| 6 | Pre-existing and Needs investigation (inconclusive) keep their own slots, routed by origin as the engine does today; a slot holding a Blocker or Fix is visible and never dropped; PR Confidence is a row of the glance table; the verifier and instructions notices keep a visible slot | They carry origin and uncertainty, not severity | reuses 0030, 0033 |
| 7 | "Where" links to the file and line at the head SHA, never to a thread | Threads do not exist when the body is rendered; on the 422 fallback they never exist | 0055 |
| 8 | The re-review row uses only computable numbers: new findings, unresolved bot threads, replies that look addressed | The engine has no complete finding ledger; "2 fixed" would be a guess | 0055 |
| 9 | The risk row never claims a checklist: "Low: no risk facts reported, no risky paths"; no colour on the level; facts stay outside `<details>` | The level is path rules plus facts the model chose to report | reuses 0031 |
| 10 | Model-written prose (the batch summaries) moves into "What the reviewer checked", collapsed | It is per batch, not a summary of the pull request | 0055 |
| 11 | The footer is one shortened `<sub>` line that keeps "<model> via" first and the run cost last, plus a collapsed "Run details" table above it | Keeps the spend ceiling, the model reader and the benchmark parser working; adds the Wachiman version | 0055, keeps 0012, 0036 |
| 12 | Inline label: `👮 **Wachiman** · <Important or Nit> · <severity emoji + word> · <topic emoji + word> — <title>`; confidence moves to a `<sub>` line | The owner keeps the Important/Nit word, the vocabulary of Claude Code's own Code Review; the title reads on the first line | 0055, reuses 0030 decision 7 |
| 13 | A not-reviewed notice says who acts, where, and what was spent; a $0 refusal (billing, auth) that is the latest bot notice is edited in place, every other notice stays a new review | 68 identical no-credit reviews in three days; notices that spent money must stay separate for the ceiling | 0055, keeps 0012 |
| 14 | A rebase or base-merge with no new changes stays a new one-line review with one wording | It must advance the head marker; editing an older review would rewrite its marker and its cost | 0055 |
| 15 | The format is protected by a view model, golden Markdown files and parser round-trip tests, not by string assertions spread over tests | ~280 test lines assert on today's strings; the next change would move them all again | 0055 |

### Open questions

1. **Run details collapsed or visible?** Answered 2026-11-14, provisionally: collapsed. The owner
   is not yet sure; the cost amount has always sat in the small footer line, and it still does
   (the `<sub>` line keeps PR so far and this run). Revisit after the first week of real reviews
   in the new layout; tracked in Linear.
2. ~~Keep the topic emoji inline?~~ Answered 2026-11-14: keep it, so ADR 0003 stays intact.
3. ~~Split the finding body with `suggestion` blocks?~~ Answered 2026-11-14: no. It changes what
   the model is asked for, and nothing in this design may move the model; see "Out of scope".
4. ~~A one-paragraph summary of the whole pull request?~~ Answered 2026-11-14: no, not for now.
   It needs an extra model call per review.
5. **A rebase-only push: a one-line review or nothing?** Default: one line. The line advances the
   head marker, so the next review does not re-read the same changes.
6. **Where does "how to answer a finding" appear?** The `Verdict: correct` / `Verdict: wrong` reply
   is the owner's existing convention, read by `src/precision.ts` to measure how often the reviewer
   is right; no posted comment mentions it today. Default: one row in the review body's glance
   table, nothing on each inline comment.

### Out of scope

- Any change to the prompt, the output schema or the number of model calls. The owner's rule
  (2026-11-14): a format change never moves the model. The model's recall is measured per release
  on Martian's 50 pull requests ([history](https://github.com/niway-dev/wachiman-benchmarks/blob/main/martian/history.md));
  a split finding body with `suggestion` blocks or a whole-PR summary would start there, as their
  own design.
- Failures that leave no way to comment: GitHub unreachable, GitHub rate limit, GitHub 5xx. They
  fail the job and stay in its log.
- The local loop summary of [PR #243](https://github.com/niway-dev/wachiman/pull/243) (open; it
  renders the laptop loop summary from code). This spec reuses its table vocabulary and does not
  change it.
- The local terminal and Markdown sinks, except the shared label (decision 12), which they render
  too.
- The other comments the engine posts keep their format: ask answers (`ASK_FOOTER`,
  `readAskCost`), thread replies (their `<sub>this run … · PR so far …</sub>` line), the ceiling
  notice (`CEILING_NOTICE`) and the PR Confidence comment. The round-trip tests still run their
  readers, to prove this change does not break them.

### Failures this must protect against

1. The spend ceiling stops counting because the cost moved or the last `$` in the `<sub>` line is
   no longer the run cost (`readAutoCost`, `src/engine.ts`; ADR 0012).
2. Size fitting drops the cost line, the markers or the findings before the prose
   (`trimMiddle`, `src/engine.ts`; ADR 0036 point 5), or the 422 fallback loses its
   split point (`moveCommentsToBody`, `src/engine.ts`, splits on `### Summary`).
3. A comment posted before the change can no longer be read by the new code (ceiling, `parseLabel`,
   the model reader in `src/precision.ts`), or a comment posted after it cannot be read by an
   older engine after a rollback.
4. `wachiman-benchmarks/scripts/parse.ts` stops reading labels, headings, footer or coverage rows
   (lines 33, 142-146, 278-290, 316), and the comparison with other reviewers breaks silently.
5. A model-written title with `|`, a newline or a backtick breaks a table row or injects Markdown
   (`neutralise`, `src/engine.ts`, escapes only HTML comments).
6. A re-review shows "nothing to fix" while earlier Fix threads are still open (the prompt tells the
   model not to repeat findings with an open thread, `src/engine.ts`).
7. A partial review, a failed verifier or an inconclusive Blocker reads as reassuring.
8. Editing a notice in place erases spend the ceiling must count (`automaticSpend`,
   `src/engine.ts`) or the head marker a rebase notice must advance
   (`src/engine.ts`).

### Acceptance criteria

- [ ] `bun test` passes, and the review body for each golden scenario equals its file in
      `src/review-format/fixtures/` byte for byte: first review, re-review with open threads,
      zero findings, many findings, partial, verifier failed, inconclusive Blocker, pre-existing,
      Blocker outside the diff, 422 fallback, size-trimmed body, title containing `|` and a newline,
      no credit, key rejected, timeout after spending, rebase with no changes.
- [ ] A round-trip test renders each golden scenario and reads it back: `readAutoCost` returns the
      run cost, `parseLabel` returns severity, topic and confidence, the model reader returns the
      model, for both the new format and three bodies posted before the change.
- [ ] The first line of every golden body matches the status precedence of decision 2; no golden
      body contains "before merge" unless it has a Blocker, and none contains ✅.
- [ ] The Findings row's total equals the sum of its parts in every golden body.
- [ ] In the size-trimmed and 422 golden bodies, the `<sub>` cost line, every hidden marker and
      every Blocker/Fix row survive; in a golden body whose never-dropped slots alone pass the
      limit, the To fix table ends with "and N more, on their lines" and the body fits.
- [ ] A re-review golden body with no new Fix but open earlier bot threads never contains
      "Nothing to fix".
- [ ] `wachiman-benchmarks/scripts/parse.ts` reads the new golden bodies and the old raw bodies, in
      a benchmarks pull request merged with the same release.
- [ ] Every golden body passes `markdownlint-cli2` default rules, with the same disables as the
      local loop summary.
- [ ] A no-credit refusal on two consecutive pushes leaves one notice on the pull request; a timeout
      on two consecutive pushes leaves two, and the ceiling counts both.
- [ ] Screenshots of the four golden scenarios rendered by GitHub are in the Evidence of each build
      pull request.

## Detail

### What is wrong today (evidence)

A survey of every Wachiman review on niway-dev/wachiman and of the 400 most recent pull requests
on niway-dev/kaipu-record (618 bodies, 2026-11-14) found:

1. **No answer at the top.** The reader gets a count line, then a risk map, then lists, then one
   paragraph per batch.
   [wachiman #213](https://github.com/niway-dev/wachiman/pull/213#pullrequestreview-5884126338)
   is 13.5k characters.
2. **The count does not add up.** "18 finding(s): 3 to fix, 13 to consider" hides two Info
   findings (same review).
3. **The findings to fix are not in the body.** Only inline. The only Blocker of
   [kaipu-record #569](https://github.com/niway-dev/kaipu-record/pull/569#pullrequestreview-5854512760)
   sat under "Outside the diff".
4. **A bare risk level.** [wachiman #238](https://github.com/niway-dev/wachiman/pull/238#pullrequestreview-5902349558)
   reads "Risk map / **Low.**" and nothing else about risk.
5. **Five axes in one inline title.** `Nit · 🟡📝 Consider · docs: <title> (confidence medium)`;
   the emoji are glued together and the confidence trails the title
   ([example](https://github.com/niway-dev/wachiman/pull/188#discussion_r4545177824)).
6. **Cost scattered.** In the coverage table, in the footer and in "PR so far"; the footer is
   eleven values in one `<sub>` line, and the Wachiman version is not shown at all.
7. **Notices without a next step, and noisy.** "Top up, then re-run this job" does not say who or
   where; the vendor text is quoted next to it; 68 no-credit reviews were posted between
   2026-11-04 and 2026-11-06
   ([first](https://github.com/niway-dev/kaipu-record/pull/498#pullrequestreview-5763868427),
   [example](https://github.com/niway-dev/kaipu-record/pull/496#pullrequestreview-5764123832)); a
   key-rejected notice still shows "PR so far $0.42"
   ([kaipu-record #600](https://github.com/niway-dev/kaipu-record/pull/600#pullrequestreview-5870302755)).
8. **Rebase noise.** 21 "Rebased onto" / "Brought up to date" reviews, four in one day on
   [kaipu-record #546](https://github.com/niway-dev/kaipu-record/pull/546#pullrequestreview-5810618247).
9. **Failures with no comment.** No timeout, rate-limit, network or 5xx notice was ever posted; the
   job failed instead.

### What other reviewers do

Researched 2026-11-14 (GPT-6.1 Terra), first-party sources where available:

- CodeRabbit opens with a walkthrough; Qodo Merge labels a 1–5 review effort; Sourcery offers a
  quiet profile that posts only the highest priority
  ([CodeRabbit](https://coderabbit-docs.pages.dev/getting-started/quickstart/),
  [Qodo](https://docs.qodo.ai/qodo-documentation/code-review/qodo-merge/features/custom-compliance),
  [Sourcery](https://docs.sourcery.ai/reviews/configure/)).
- Copilot and Cursor Bugbot attach committable fixes or "Fix in" links to inline comments
  ([Copilot](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-code-review?tool=xcode),
  [Bugbot](https://docs.cursor.com/bugbot)). Declined for now (open question 3): it changes the
  model's output.
- No public convention was found for showing model, cost or version in a comment.
- Guidance on scannable text: front-load the answer, consistent headings, lists for independent
  items, tables to compare the same fields
  ([ONS](https://service-manual.ons.gov.uk/content/writing-for-users/structuring-content),
  [GOV.UK](https://www.gov.uk/government/publications/govuk-content-principles-conventions-and-research-background/govuk-content-principles-conventions-and-research-background)).
  Meaning must not rest on colour or emoji alone
  ([WCAG 1.4.1](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)). None of these
  sources measures AI review comments or ADHD readers specifically.
- GitHub documents tables, `<details>` and alerts in comments
  ([formatting](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting)).
  Rendering in email notifications and the mobile app was not verified.

### The review body

Slots, in order. An empty slot is omitted.

| # | Slot | Visible | Source |
| --- | --- | --- | --- |
| 1 | Status line (brand first, ADR 0010) | yes | computed |
| 2 | Instructions-changed notice, verifier notices | yes | computed |
| 3 | At a glance table, with a PR Confidence row when graded | yes | computed |
| 4 | To fix (Blocker, Fix) | yes | findings |
| 5 | Needs investigation (inconclusive Blocker/Fix) | yes | findings |
| 6 | To consider | collapsed above eight rows | findings |
| 7 | Needs a person (up to three, with the model's why) | yes | risk map |
| 8 | Risk facts | yes | risk map |
| 9 | Pre-existing | visible if it holds a Blocker or Fix, else collapsed | findings |
| 10 | For your information (Info) | collapsed | findings |
| 11 | What the change connects to | collapsed | contracts |
| 12 | What the reviewer checked (batch prose) | collapsed | model |
| 13 | Coverage by batch | collapsed | computed |
| 14 | Run details | open question 1 | computed |
| 15 | `<sub>` cost line | yes | computed |
| 16 | Hidden markers | — | computed |

The Findings row counts this pull request's findings by severity and adds the other origins after
the total: `… (9) · 2 pre-existing · 1 needs investigation`.

Size fitting drops whole slots from a named list, in this order: 12, 11, 13, 14, 10, 9 (only when
it holds no Blocker or Fix), then 6. Slot 6 keeps its rows that have no inline thread (outside the
diff) and shrinks the rest to a count: "11 more to consider, on their lines (see Files changed)".
There is no link to a thread, for the reason of decision 7. Slots 1–5, 7, 8, 15 and 16 are never
dropped.

If the never-dropped slots alone pass `MAX_BODY_CHARS`, the To fix and Needs investigation tables
keep the rows that fit, Blockers first, and end with "and N more not shown because of GitHub's
size limit", adding "they are on their lines" only for rows that have a thread. The cost line and
the markers are always kept.

The 422 fallback creates no inline comment, so no row is "on its line". Each finding is listed once,
in its slot's table, and the model's body for each row follows in a collapsed "Details of each
finding" section, numbered like the rows. Size fitting there drops Consider bodies before Fix
bodies.

Status line, built from parts joined by ` · `:

1. The lead, the first that applies: `⛔ Not reviewed: <reason>`, `⚠️ Partial: N of M files not
   reviewed`, `🔴 N blockers before merge`, `🟠 N to fix in this PR`, `Needs investigation: N`,
   `No new findings to fix` (unresolved bot threads remain), `Nothing to fix` (none remain).
2. A Partial lead under a Blocker or Fix lead: the second one follows the first.
3. Earlier threads: when unresolved bot threads remain, `N earlier threads open` always follows.
   So "Nothing to fix" never appears while an earlier bot thread is unresolved.
4. `🟡 N to consider`, when there are any.
5. The scope, always last: `whole PR at <sha>` or `changes since <sha> at <sha>`.

Example, with the real data of wachiman #238 (the version and duration in Run details are
illustrative):

```markdown
👮 **Wachiman** · Nothing to fix · 🟡 6 to consider · whole PR at `d6f4431`

| At a glance | |
| --- | --- |
| **Findings** | 🔴 0 blockers · 🟠 0 to fix · 🟡 6 to consider · ⚪ 3 for your information (9) |
| **Risk** | Low: no risk facts reported, no risky paths |
| **Needs a person** | 1 trade-off, in `0051-…-from-wachiman.md:27` |
| **Coverage** | 4 of 4 files reviewed, whole pull request |
| **Read first** | `pr-template-command-design.md` and 3 ADRs |
| **Answer a finding** | Reply in its thread with `Verdict: correct` or `Verdict: wrong` and why |

### To consider (6)

| | Where | Finding |
| --- | --- | --- |
| 🟡 Consider · 📝 docs | `pr-template-command-design.md:175` | `base` field of `.github/pr-template.json` is shown but never defined |
| … | … | … |

### Needs a person

- `0051-…-from-wachiman.md:27` · trade-off — Judging a PR against its own head template …

<details><summary>For your information (3)</summary> … </details>
<details><summary>What the reviewer checked</summary> … </details>
<details><summary>Coverage by batch</summary> … </details>
<details><summary>Run details</summary>

| Run | |
| --- | --- |
| **Wachiman** | 1.15.0 |
| **Model** | Claude Sonnet 5.5, effort high |
| **Runner** | Claude Code 2.1.304 on GitHub Actions |
| **Operation** | Automatic review, 1 batch, 3 min 10 s |
| **This run** | $0.28 |
| **PR so far** | $0.28 over 1 automatic run |
| **Tokens** | 14 in · 9.8k out · 204k cache read · 39k cache write |
| **Billing** | Claude subscription: the dollars are an API-equivalent estimate, not a bill |

</details>

<sub>Claude Sonnet 5.5 via Claude Code 2.1.304 · Wachiman 1.15.0 · PR so far $0.28 · this run $0.28</sub>
```

Displayed paths keep the file name and the line; a name longer than 40 characters keeps its first
and last words around `…`. The link carries the full path.

### Inline finding

```markdown
👮 **Wachiman** · Nit · 🟡 Consider · 📝 docs — `base` field of `.github/pr-template.json` is shown but never defined

<the model's body, unchanged>

<sub>Confidence medium</sub>
```

Pre-existing and inconclusive findings never open an inline thread (the engine routes them to the
body first); their rows in the body and in the local sinks carry `Pre-existing` or `Needs
investigation` before the severity. `parseLabel` reads both the new inline line and the old one.

Rollback: an engine older than this change cannot parse the new label, so its verdict statistics
(`judge` in `src/precision.ts`) skip findings posted by the newer engine. This loss is accepted: it
affects only the precision report, never the spend ceiling, and the brand stays first on the line
as ADR 0010 requires.

### Not-reviewed and rebase notices

```markdown
👮 **Wachiman** · ⛔ **Not reviewed**: the Anthropic account has no credit

| What to do | |
| --- | --- |
| **Who** | The repository owner, who holds the `ANTHROPIC_API_KEY` secret |
| **Fix** | Add credit to that Anthropic account, then re-run the "Wachiman review" job in the Actions tab, or push again |
| **Spent** | Nothing this run · PR so far $0.42 |
| **Provider said** | `Credit balance is too low` |

<sub>Claude Opus 5.5 via Claude Code 2.1.304 · Wachiman 1.15.0 · PR so far $0.42 · this run $0.00</sub>
```

The "Who" and "Fix" rows branch on the auth type the code already distinguishes (subscription token
or API key, `src/engine.ts`). Timeouts, turn limits and budget stops say what was spent.

```markdown
👮 **Wachiman** · No new changes to review: the branch was updated from `main` (`9c07227` → `e66e523`). The previous review still applies.

<sub>Wachiman 1.15.0 · PR so far $1.12 · this run $0.00</sub>
```

### How the format is protected

Today ~280 test lines in ~28 files assert on rendered fragments with `toContain` and `toBe` (a
grep count, not a run). Every format change moves them. The build replaces that with three layers:

1. **A view model.** `buildReview` first builds a typed `ReviewView` (status, glance rows, finding
   rows per slot, notices, run details, cost line) from the engine's data; a separate
   `renderReview(view)` turns it into Markdown. Behaviour tests assert on the view ("the status is
   Partial", "this Blocker is in To fix"), which does not move when wording changes.
2. **Golden Markdown files.** One file per scenario, compared byte for
   byte, regenerated with an update flag as the golden prompts already are
   (`WACHI_UPDATE_GOLDEN=1`). A format change is one diff of the golden files, reviewed by eye.
   The local loop summary of PR #243 already works this way (ten golden files).
   The scenario list starts from the survey's catalogue of the 618 posted bodies: each pattern
   found there (clean, to fix, partial, 422 fallback, no credit, auth, timeout, turn limit, budget,
   size gate, rebase, verifier notice, instructions changed) gets one golden file, plus one per
   acceptance criterion it does not cover. Inputs never seen before get their own files too: an
   unknown stop reason, a missing cost, empty model text, a title with `|` or a newline. Each
   renders a safe fallback; none throws, drops a finding or drops the cost line.
3. **Round-trip contract tests.** Every reader of a posted comment (`readAutoCost`, `parseLabel`,
   the model reader, the partial marker, the benchmarks parser, and the unchanged `readAskCost`,
   ceiling-notice and reply-footer readers) runs against every golden body and
   against real bodies posted before the change, one per catalogue pattern (both repositories are
   public). This is the test that proves the ceiling and
   the benchmark still work, which no amount of string assertions shows.

String assertions that only restate the layout are deleted in the pull request that moves them to
a golden file.

### Build: four pull requests

| PR | Scope | Main risk | Protection |
| --- | --- | --- | --- |
| 1 | Inline label, count line that adds up, the shared label in the local sinks, `parseLabel` dual read | Benchmark parser and verdict replies | Round-trip tests on old and new labels |
| 2 | View model, review body slots, named drop list for size fitting, 422 fallback split point, cell escaping, `parse.ts` in benchmarks | Ceiling and partial marker under trimming | Golden files incl. trimmed and 422 bodies |
| 3 | Run details table, new `<sub>` line with the Wachiman version, ceiling and model reader on both formats | Spend ceiling, rollback | Round-trip tests on old and new footers |
| 4 | Notice template, edit in place for $0 refusals, rebase one-liner | Spend records and head marker | Two-push scenarios in golden tests |

The build is larger than PR #243 (+1,845 / −41 lines, 29 files), which added a renderer and touched
no existing parser. No figure for the build's agent cost has been measured.

### Cost per review

Unchanged. Every slot is rendered from data the engine already returns; the prompt, the output
schema and the number of model calls stay the same. The two ideas that would change this (a split
finding body, a whole-PR summary) were declined on 2026-11-14.

## Sources and unverified claims

- Survey: 618 bot bodies from niway-dev/wachiman and niway-dev/kaipu-record, collected 2026-11-14
  (Sonnet 5.5 medium). Counts above come from it.
- Code facts: a read of `main` at `6b99963` (Haiku 5.5 high). Code is cited by symbol and file;
  line numbers drift between branches.
- Sizes: the largest of the 618 bodies is about 26k characters, and a finding row in the body adds
  about 200 characters (Opus 5.5 attack, measured on the raw bodies; the row size is an estimate).
- Attacks on the first proposal: GPT-6.1 Sol medium and Opus 5.5, 2026-11-14. Every point they
  marked BREAKS or MISLEADS is answered by a decision above (2, 3, 6, 7, 8, 9, 10, 11, 13, 14) or
  a failure to protect against.
- Unverified: rendering in GitHub email notifications and the mobile app; the agent cost of the
  build.
