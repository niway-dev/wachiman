# Repository review instructions

How a repository tells Wachiman what to look for, and what that can and cannot change. This page
describes `v1.3.0`. There is no YAML configuration file and no policy folder yet; see
[What does not exist yet](#what-does-not-exist-yet).

In one paragraph: Wachiman reads up to three plain-text files from your repository, at the pull
request's **base commit**, and puts them in front of the model as instructions for that review.
The engine does not parse or enforce them. They guide the model; they do not change the labels,
the budgets or the engine's rules.

## The files

| File | Read from | Notes |
| --- | --- | --- |
| `.github/agent-review.md` | the base commit | The focus file: what this repository's reviews should look at. Read first. |
| `.github/claude-review.md` | the base commit | The old name. Read only when `.github/agent-review.md` does not exist there; the job log says to rename it. |
| `CLAUDE.md` | the base commit | Repository root only. |
| `AGENTS.md` | the base commit | Repository root only. |

All of them are optional. If none exists at the base commit, the prompt says so and the review
runs on the engine's defaults.

Only these paths are read. `CLAUDE.md` or `AGENTS.md` files in subdirectories are not loaded as
instructions, and there is no search for others.

## Base commit, not the head

A pull request cannot change the rules it is reviewed under. The engine fetches each file from the
base commit that GitHub reports for the pull request (`base.sha`), through the contents API, and
never from the pull request's head. The prompt also says that the head's copies of these files are
content under review, and must not be followed as instructions. If the base has no focus file, the
head's is not used instead.

What this means in practice:

- **Your instruction changes apply after they merge.** A pull request that adds or edits one of
  these files is reviewed under the old versions. When it touches any of the four paths, the
  review body says so: "Review instructions changed: … the change takes effect after merge."
- **For a stacked pull request**, the base commit is the commit GitHub reports for that pull
  request's own base branch, not the point where it left the default branch. Choosing the
  merge-base instead is part of the proposed [ADR 0006](adr/0006-repository-review-policy.md) and
  is not implemented.
- **The questions you ask on a pull request** (`/wachi <question>`) read the same files from the
  same base commit. See [reviews.md](reviews.md).

## What wins when they disagree

The engine does not rank the files or merge them. It pastes them, in this order, into the prompt
under a heading that names the base commit:

1. the focus file (or the old-named one),
2. `CLAUDE.md`,
3. `AGENTS.md`.

Each sits in its own `<instruction-file>` block. If two of them contradict each other, the model
decides. Keep each rule in one place.

Above all of them sit the engine's own rules, which the instructions are told never to change:

- the **severity tests** (a Blocker must name the input, state or trust boundary that fails;
  a Fix must be specific; Consider is judgement; Info asks for no reply),
- the **evidence rules** (cite the line behind every premise of a Blocker or a Fix; suggest a fix
  only for the failure shown; check all callers of a shared contract),
- the **output format**, a fixed schema.

Only one part of that is held by code:

- **Held by the schema:** the label set. The output schema allows four severities and nine topics
  ([reviews.md](reviews.md)), and the engine's label tables have no others. A rule saying "use
  severity `critical`" or "add a `style` topic" cannot work.
- **Not enforced:** everything else. The prompt tells the model that instructions do not change
  the severity tests or the evidence rules, but no code checks that the model obeys. A rule such
  as "never report anything about tests" is an instruction the model may follow; the engine does
  not verify it, and it does not mark the review when the model followed it. The proposal that
  would make a downgrade explicit and visible (`severity_overrides`, ADR 0006) is not
  implemented.

## What the instructions are for

Good instructions say what is true about this repository that a stranger reading the diff would
not know. The `rules` topic exists for this: a violation of `CLAUDE.md`, `AGENTS.md` or a
repository convention is reported as `📜 rules`.

Write rules the model can check from the code in front of it:

- **Name the place and the harm.** "Anything under `payments/` must never log card numbers or
  tokens; a log call that receives a request or a payment object is a violation" is checkable.
  "Be careful with payments" is not.
- **Say why.** A rule with its reason lets the model tell a real violation from a lookalike.
- **State what is already decided.** "The retry loop in `queue/worker.ts` is intentionally
  unbounded; it is capped by the job timeout" stops a repeated, rejected finding.
- **Point to the conventions you enforce by hand** (naming, error handling, where migrations go)
  rather than restating a formatter's job. The prompt already tells the model to skip style a
  formatter would catch.
- **Keep it short.** The files go into the prompt of every batch call and of every question, so a
  long file is paid for again each time.

Invented example for a `.github/agent-review.md` (illustrative; not from a real repository):

```markdown
# Review focus

## Payments
- Code under `src/payments/` must not log request bodies, card data or tokens. Report any log call
  that receives a request, a payment object or an error that wraps one. Why: logs ship to a
  third-party service.
- Money amounts are integers in cents. A float in an amount calculation is a bug.

## Migrations
- A file in `db/migrations/` must be reversible, or say in a comment why it cannot be. A migration
  that drops a column in the same pull request that stops writing it is a bug.

## Already decided
- `src/queue/worker.ts` retries without a limit on purpose; the job timeout caps it. Do not report
  it.

## Decision records
- Our decision records live in `docs/decisions/`, not `docs/adr/`. Read them before judging a
  change to the queue or payments code, and report code that contradicts one.
```

To see whether a rule works, open a small pull request that breaks it. The review does not list
which instruction files it read.

## Limits

- **Size.** Each file is cut at 64 KiB (65,536 bytes) at the base commit. The prompt tells the
  model the rest is not shown, and the job log gets "… at the base commit is over 64 KB: cut."
  Nothing appears in the review itself. A file too large for GitHub's contents API arrives empty
  and is treated as cut.
- **A missing file is fine; a failed read is not.** A 404 means the file is absent and the others
  are still read. Any other error from the contents API (permissions, rate limit, network) stops
  the run with an error, and no review is posted. The engine never reviews without rules that
  exist, and it does not fall back to the head's copy. A rerun when the error clears fixes it.
- **The ADR directory is fixed.** The prompt names `docs/adr/` as where decisions live, and the
  engine's "Edits an accepted decision record" notice is added only for changed files under a
  `docs/adr/` directory at any depth. If your records live elsewhere, say so in the focus file so
  the model can find them; the notice for edits will not appear. This is
  [issue #5](https://github.com/niway-dev/wachiman/issues/5).
- **Risk order and excluded files are not set here.** Which files are read first, and which are
  dropped (lockfiles, build output, generated files), are fixed in the engine. The reusable
  workflow has no input for either. `AGENT_REVIEW_EXCLUDE` adds exclusions only in the
  copy-the-files install; see [configuration.md](configuration.md) and
  [setup-copy.md](setup-copy.md).
- **Budgets and batch sizes come from the workflow, never from these files.** These instruction
  files cannot raise a budget. A pull request can change its caller workflow, which is why
  everyone who can push must be trusted with the key.
- **The model provider receives these files.** They are part of every prompt. Do not put secrets
  in them. See [faq.md](faq.md) for where code goes.

## What does not exist yet

[ADR 0006](adr/0006-repository-review-policy.md) proposes a policy folder (`.github/wachi/`) with
a `wachi.yml` file, `rules/*.md`, `learned/*.md`, a `policy_dir` workflow input and
`severity_overrides`. Its status is **proposed**, and none of it is implemented. [ADR
0007](adr/0007-learned-memory-by-draft-pr.md) (a `/wachi learn` command) is proposed and not
implemented either. Do not create those files expecting them to be read.

What is implemented is what this page describes: the focus file, `CLAUDE.md` and `AGENTS.md`,
read from the base commit. Check an ADR's status line before relying on what it describes.
