# Review dataset: every Wachiman, Pullfrog and CodeRabbit review already posted on GitHub

One structured copy of the reviews the three tools posted on the benchmark replays and on
kaipu-record, so past results can be queried (`duckdb`, `jq`, a spreadsheet) instead of re-read as
markdown. Everything comes from the GitHub API through `gh`. No model ran to build it.

- **Built:** 2026-11-02.
- **Scope:** the six `niway-dev/kaipu-bench-*` repositories (all pull requests, any state) and every
  `niway-dev/kaipu-record` pull request that has a Wachiman review (112 of 467), which includes the
  field-run PRs #439 #449 #478 #479 #482 #483 #484.
- **Private repositories** that run Wachiman were read too. Their data is **not** in this
  repository; only counts are (see [Privacy](#privacy)).

## Files

| File | One row per | What it holds |
| --- | --- | --- |
| [`findings.csv`](findings.csv) / [`findings.jsonl`](findings.jsonl) | posted finding | tool, source repo, bench PR, original kaipu-record PR, round, run label, model, version, run id, review id, comment id, `placement` (`inline` or `body`), path, line, commit, severity, topic, confidence, the tool's own labels, title, replies, date, URL. The JSONL also has the comment `body`. |
| [`contracts.jsonl`](contracts.jsonl) | contract entry | The "What the change connects to" entries parsed from Wachiman review bodies. |
| [`reviews.csv`](reviews.csv) | Wachiman review | Model, effort, version, batches, cost from the review footer and from the log, finding and contract counts, the `Confidence rule` line of the log. |
| [`run-logs.csv`](run-logs.csv) | Actions run with a saved log | Workflow ref, version, model, effort, calls, turns, cost and duration summed from the per-batch result lines. |
| [`runs.csv`](runs.csv) | bench PR (bench repos) or bot review (kaipu-record) | **The run map for the owner to review.** Tool, model, version, round tag, the label the analysis docs use (W-R1, W4, S7, PF-v1, CR-v2…), original PR, date, `confidence`, `basis`. |
| [`labels.csv`](labels.csv) | finding that matched a verdict | The owner's verdict ID from the analysis docs (E/A/N/X/SN/NS for the replays, F for the field run), the verdict text, the match score and why. |
| [`ambiguous.md`](ambiguous.md) | — | Findings in an analysed set that could not be matched with enough evidence, with their best candidates. |
| [`raw/`](raw) | pull request | The API snapshots: `pr.json`, `review-comments.json`, `reviews.json`, `issue-comments.json`, `runs.json`, `meta.json` and `logs/run-<id>.log.gz`. Per repository, `_index.json` and `_runs.json`. |
| `normalize-report.json` | — | Header lines that did not parse (none), counts seen per tool, and per-repository aggregates. |

### Columns of `findings.csv`

- `tool`: `wachiman`, `pullfrog` or `coderabbit`. Wachiman is recognised by its brand
  (`👮 **Wachiman** ·`) or, for engines before v1.3, by its bare label posted by `github-actions[bot]`.
- `severity`, `topic`, `confidence`: **Wachiman only**, from its exact header
  `👮 **Wachiman** · 🟠🐛 **Fix · bug: <title> (confidence medium)**`. Severity is
  `blocker|fix|consider|info`. Confidence is empty before v1.4.0.
- `native_severity`, `native_category`, `native_tags`: **the other tools' own words, kept raw**, with no
  mapping to Wachiman's scale. CodeRabbit: `Minor` / `Functional Correctness` / `Quick win`. Pullfrog posts
  no labels, so they are empty (a leading `Nit:` or `Correction:` is kept). The v1.0.x Wachiman posted
  `**Note (correctness): …**`; that is stored here as `Note` / `correctness`, with `severity` and `topic` empty.
- `placement`: `inline` is a review comment on a line. `body` is a finding that only lives in a review body:
  Wachiman's "Outside the diff" and "For your information" lists (and the "GitHub refused them inline" list),
  and CodeRabbit's "Outside diff range comments". `body_section` names the section.
- `original_pr`: the kaipu-record PR a replay copies, from the head ref `replay/pr-463/head-r4`; for
  kaipu-record rows, the PR itself. `round`: `r2`…`r9` from the title (`[replay]` is `r1`).
- `run_label`: from [`runs.csv`](runs.csv). `version`: from the run log (`Uses: …review.yml@refs/tags/v1.4.0`),
  else from the doc. `model`: from the log (`AGENT_REVIEW_MODEL`), else the review footer.
- `line` is the line on the head the comment was posted on; `original_line` is the line GitHub recorded when
  it was posted (they differ after a push). Whole-file findings have no line.
- A thread reply is not a finding. `replies` counts the replies in the finding's thread.

## Re-run

```sh
gh auth switch --hostname github.com --user csdev19

# 1. Snapshot. Idempotent: a PR whose updated_at did not change is skipped; --refresh forces a re-fetch.
bun scripts/benchmark-dataset/fetch.ts --out docs/benchmark/dataset/raw --logs \
  --repos niway-dev/kaipu-bench-wachi,niway-dev/kaipu-bench-wachi-v2,niway-dev/kaipu-bench-pullfrog,niway-dev/kaipu-bench-pullfrog-v2,niway-dev/kaipu-bench-coderabbit,niway-dev/kaipu-bench-coderabbit-v2
bun scripts/benchmark-dataset/fetch.ts --out docs/benchmark/dataset/raw --logs --only-wachiman \
  --workflows "Agent review,Pullfrog" --repos niway-dev/kaipu-record \
  --keep niway-dev/kaipu-record#439,niway-dev/kaipu-record#449,niway-dev/kaipu-record#478,niway-dev/kaipu-record#479,niway-dev/kaipu-record#482,niway-dev/kaipu-record#483,niway-dev/kaipu-record#484

# 2. Tables, in this order (normalize reads runs.csv; labels reads findings.jsonl and runs.csv).
bun scripts/benchmark-dataset/runs.ts      --raw docs/benchmark/dataset/raw --out docs/benchmark/dataset/runs.csv
bun scripts/benchmark-dataset/normalize.ts --raw docs/benchmark/dataset/raw --out docs/benchmark/dataset
bun scripts/benchmark-dataset/labels.ts    --dataset docs/benchmark/dataset

bun test scripts/benchmark-dataset
```

`fetch.ts` waits out the GitHub rate limit by itself (the first full pass of kaipu-record spent it).
`labels.ts` reads the analysis docs with `git show origin/docs/field-run-kaipu-workspaces:<path>`
(`--docs-ref` changes the ref) because `2026-11-02-field/` is not on `main` yet; it falls back to the
working tree. After that branch merges, pass `--docs-ref main`.

## Row counts

### Public repositories

| Repository | PRs snapshotted | Wachiman | Pullfrog | CodeRabbit |
| --- | --- | --- | --- | --- |
| kaipu-bench-wachi | 60 | 282 (258 inline, 24 body) | — | — |
| kaipu-bench-wachi-v2 | 5 | 0 (see below) | — | — |
| kaipu-bench-pullfrog | 5 | — | 7 | — |
| kaipu-bench-pullfrog-v2 | 6 | — | 9 | — |
| kaipu-bench-coderabbit | 10 | — | — | 15 |
| kaipu-bench-coderabbit-v2 | 6 | — | — | 6 |
| kaipu-record | 112 of 467 | 278 (266 inline, 12 body) | 34 | 27 (20 inline, 7 body) |
| **Total** | 204 | **560** | **50** | **48** |

**658 findings** in total. Also: **392 contract entries** (59 reviews), **206 Wachiman reviews**,
**223 run logs** with parsed cost/model/version, **311 rows in `runs.csv`**.

Wachiman reviews by version: the 60 bench reviews are v1.3.0 (15) and v1.4.0 (45).
kaipu-record has 16 reviews on v1.4.0, 21 on v1.3.0, 70 on v1.2.x, 23 on the floating `v1` tag and 16 whose
version is unknown (no log).

### Verdict join

`labels.csv` has **285** rows. Of the 658 findings, 314 are outside the analysed sets (see
[What is missing](#what-is-missing)), and 344 are in them: **285 matched, 59 are in
[`ambiguous.md`](ambiguous.md)**.

| `label_kind` | Rows |
| --- | --- |
| `expected` (E) | 106 |
| `additional` (A) | 48 |
| `new` (N, X, SN, NS, NF) | 40 |
| `field` (F) | 91 |
| `false-positive` | 0 (no doc marks a finding Invalid) |

### Private adoption repositories (counts only)

Wachiman is wired into these repositories. The data is in `~/Documents/Workspace/Personal/wachiman-data/`, outside
any git repository. Only the counts below are public. Findings are Wachiman's own; "Note" is the v1.0.x label with
no severity.

| Repository | PRs with a Wachiman review | Reviews | Findings | Findings by severity | Logs saved (expired) | Cost on the footers |
| --- | --- | --- | --- | --- | --- | --- |
| niway-dev/gymtrack-monorepo | 7 of 73 | 7 | 9 | note 9 | 7 | $0.19 |
| csdev19/csdev-monorepo | 4 of 42 | 4 | 4 | consider 3, fix 1 | 4 | $0.40 |
| csdev19/invisible-assistant | 62 of 309 | 66 | 56 | note 51, info 3, consider 1, fix 1 | 119 saved, 39 expired (all repos) | $1.24 |
| niway-dev/fidelity-card | 0 of 14 | 0 | 0 | — | — | — |

By topic: gymtrack-monorepo correctness 3, security 2, other 4; csdev-monorepo docs 2, security 1, question 1;
invisible-assistant correctness 11, other 19, adr 13, rules 7, security 4, docs 2.

Repositories whose workflow references Wachiman (found by reading `.github/workflows/` of every repository in
`gh repo list niway-dev` and `gh repo list csdev19`, default branches): kaipu-record, kaipu-bench-wachi,
kaipu-bench-wachi-v2, gymtrack-monorepo, csdev-monorepo, invisible-assistant, fidelity-card. fidelity-card has
the workflow and no review yet. Other branches were not scanned.

## Privacy

`niway-dev/wachiman` is public. **Nothing from a private repository is committed here**: no code, comment
bodies, titles, paths or PR titles. `fetch.ts`, `runs.ts` and `normalize.ts` write wherever `--out` points, so
the private pass uses an `--out` outside the repository, and only the per-repository figures from its
`normalize-report.json` (`aggregate`) were copied into this README. Check `git status` before adding anything from
a private run.

kaipu-record, kaipu-bench-* are public, so their raw snapshots are committed.

## Contracts

Recoverable, with one loss. The block `What the change connects to (N closed, M open)` in a Wachiman review
body (v1.4.0 and later; 45 of 45 bench reviews and 14 of 16 kaipu-record v1.4.0 reviews have one) is parsed back
into `action`, `location`, `failure_mode`, `status`, `evidence[]`, `open_question`, `candidates[]` and
`evidence_checked` (false when the review printed "A citation did not resolve in the head").

The review prints only one of `visible_effect`, `before_after` and `equivalent_path` per entry (the first that
exists), so they cannot be told apart: `contracts.jsonl` has a single `effect` field. The action is cut at 160
characters and each sentence at 280 when rendered. No review had its contracts cut for size (`contracts_hidden`
is 0 everywhere). v1.3.0 and earlier reviews have no contracts.

## Run map

`runs.csv` is derived, and the owner should check it. `confidence` says how:

- `derived`: tool, model, version and date come from the snapshots and the run logs; the label comes from a doc that
  names it (`basis` gives the doc). 248 rows.
- `guessed`: 63 rows. Labels that no doc gives (`W-set2-R1…R3` and `CR-set2` for the five bug-catalogue PRs #402
  #255 #276 #269 #184, replayed in bench PRs #46–#60 and coderabbit #6–#10; `W-v2` for the failed wachi-v2 repo),
  Pullfrog and CodeRabbit round numbers on kaipu-record (`PF-1`, `CR-2`: the field docs name rounds by commit, I
  numbered them in order), and 16 kaipu-record Wachiman reviews whose version is unknown.
- Labels follow each doc generation: baseline `W-R1…R3`, `PF-v1/v2`, `CR-v1/v2` (2026-11-01); `W4…W6` (2026-11-02);
  `S7…S9` (2026-11-02-e1-sonnet). The field run uses its docs' own names (`Full`, `Inc-4`, `W-i1`, `R0`…`R5`),
  keyed by commit in `FIELD_ROUNDS` in `scripts/benchmark-dataset/runs.ts`, each with the doc line it comes from.
- The version read from a log agreed with the doc in every case that had both.

## How the join works (and why 59 are left)

For a replay finding, the candidates are the verdicts whose run column in the primary doc for that run says the
run found it. For a field finding they are the verdicts of the same bot on the same PR. A candidate scores a path
match (+3), a line within 8 of a line the verdict names (+4), word overlap with the title and the start of the
text, and a round or commit match for the field docs. A match needs a score of 5.5, wording that agrees with the
location (a path-and-line hit alone is not enough: the same line can host several findings) and a lead of 1.5 over
the runner-up, or a lead of 3. Anything else goes to `ambiguous.md`. The F12a/b/c claims are one Pullfrog comment
in the doc and are labelled together (`F12a|F12b|F12c`).

`shares_verdict_with` lists other findings of the same run matched to the same verdict: the same defect posted
twice. No label says `duplicate` because the docs' duplicate prose is not machine-readable.

## What is missing

- **314 findings are outside the analysed sets**: all kaipu-record PRs other than the seven field PRs, and the
  bench replays of #402 #255 #276 #269 #184 (no analysis doc). They have no `labels.csv` row and are not in
  `ambiguous.md`.
- **kaipu-bench-wachi-v2**: all five runs failed before posting (`agent-review.yml` failed, no job logs).
  Its PRs are in `raw/` and have no findings. Also without any comment: coderabbit #1 #3 #5 (v1) and #1 #4 #5 (v2)
  (CodeRabbit posted a walkthrough only), pullfrog-v2 #1 (setup PR), and 30 of the 112 kaipu-record PRs have a
  Wachiman review with no finding.
- **Logs**: no public log is expired. 17 runs have none because they never started a job (`not-found`), 53 were
  skipped by their `if:`. 39 private-repository logs are past the 90-day retention. All public logs are kept in
  full (1.7 MB gzipped), so nothing was reduced to extracted lines.
- **Runs**: `gh run list` returns at most 1000 runs; kaipu-record is listed per workflow (`Agent review`,
  `Pullfrog`) to get past that, so its CI runs are not in `_runs.json`. Cost and duration come from the logs when
  one exists and from the review footer otherwise.
- **Pullfrog and CodeRabbit in kaipu-record** are only snapshotted on PRs that also have a Wachiman review.
  Pullfrog's "Technical details" blocks inside a comment are not split into findings. CodeRabbit findings raised
  in thread replies or in "Follow-up comments" are not captured (field doc: #482 F17, #483 F19). CodeRabbit's
  walkthrough issue comments are in `raw/` only.
- **Pullfrog cost, model and version** are not parsed: its logs are saved in `raw/` but the log reader looks for
  Wachiman's lines only, and a search of one Pullfrog log found no model or cost line. The `model` for Pullfrog
  rows comes from the doc (`derived` from the doc, not from data).
- **Wachiman's `thread_replies`** ("Looks addressed") are not findings and are not extracted.
- The verdict docs are the owner's reading of the code; this dataset does not re-check any verdict.
