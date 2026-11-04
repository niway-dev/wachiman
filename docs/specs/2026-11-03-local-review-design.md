# Local review on the developer's own Claude subscription: a review core behind source and sink ports

- **Status:** draft for discussion, 2026-11-03. **Nothing here is built.** The owner approved the
  direction and the decisions in the table on 2026-11-03 ([#103](https://github.com/niway-dev/wachiman/issues/103));
  on the same day the owner answered the first draft's questions; 4, 5 and 9 are still open. Every claim about the code below was checked by reading
  `main` at `dce32d9` on 2026-11-03 (marked *verified*); claims about Claude Code's behaviour on a
  subscription are read from its documentation or its `--help`, not run (marked *inferred* or
  *unverified*). The first draft made no model call. The revision of the same day records the
  owner's answers to its open questions and one probe of seven Haiku calls on the owner's
  subscription (about $0.002 API-equivalent), in [The subscription probe](#the-subscription-probe-2026-11-03).
- **Issue:** [#103](https://github.com/niway-dev/wachiman/issues/103).
- **Creates:** [ADR 0019](../adr/0019-a-review-core-behind-source-and-sink-ports-and-a-local-subscription-mode.md)
  (a review core behind source and sink ports, and a local mode on the developer's own
  subscription; amends ADR 0001). ADR numbers 0014 and 0015 are reserved by #80, 0017 and 0018 by
  #90.
- **Reuses:** ADR 0001 (trust model, provider adapter boundary), ADR 0002 (Bun, zero dependencies),
  ADR 0003 (labels), ADR 0006 (instructions from the base commit), ADR 0009 (evidence by the
  engine, judgement by the model), ADR 0011 and 0012 (GitHub-only, untouched), ADR 0016 (data-path
  questions, reused unchanged). Composes with #90's `tier` (ADR 0017, draft) as said in decision D5.
- **Evidence:** [research 2026-11-03](../research/2026-11-03-greptile-skills-and-local-review.md)
  (#102: terms, data and telemetry facts, the diff parity probe); GPT-6.1 Sol's read-only review of
  difficulty and shape (2026-11-03, an input that was spot-checked, not a source of truth); the
  hub's [ports and adapters pattern](https://github.com/csdev19/general-knowledge/blob/main/architecture/domain-layer-contracts.md).
- **Written on:** Claude Fable 5.1, from the owner's brief of 2026-11-03; revised on Claude
  Opus 5.5 the same day.

## Summary (one minute)

A developer runs Wachiman on their own laptop against the branch they are on, signed in to the
unmodified `claude` binary with their own subscription, and gets the review in the terminal, a
Markdown file or a JSON file. Nothing is posted to GitHub, Wachiman sends no telemetry, and no API key exists.
The owner's use: reviewing an employer's code locally, where a local tool is far easier to approve
than a CI job with a key.

Today `review()` in `src/engine.ts` is one function that reads a pull request from GitHub, plans
and runs the batches, and posts the result; the only seam is the provider adapter. The two new
needs, another source of changes and another destination for the result, are the same shape as
the ones a GitLab or Bitbucket connector would have. So the design cuts two more seams: a **review
core** that consumes a neutral, versioned **review input** and returns a versioned **review
result**; **source connectors** that build the input (`github`, today's API path, and `local-git`,
new); and **sinks** that consume the result (GitHub posting, today; terminal and Markdown file,
new). The model provider stays the Claude Code adapter.

The local connector reads the clone, so it already works for a repository hosted anywhere. Host
API connectors matter only for posting and for CI, and are out of scope here; the input format is
designed so that one can fill it cheaply.

| # | Decision | Why | ADR |
| --- | --- | --- | --- |
| D1 | **Ports and adapters.** A review core, `reviewChange(input, options, deps)`, independent of where the change comes from and where the result goes. Source connectors produce `ReviewInput`; sinks consume `ReviewResult`; the provider adapter is unchanged | One pipeline for every source, so a local review and a GitHub review of the same commits send the same prompts (validation level b). The hub's ports-and-adapters page is the pattern; this spec records only its application | 0019 (new) |
| D2 | **The input format is the seam for other hosts.** `ReviewInput` carries what the core reads and nothing GitHub-specific; what a host cannot provide is optional (blob SHAs, title, description, author, conversation). The *verified* field usage is in [What the engine reads](#what-the-engine-reads-from-a-file-and-a-pull-request-the-0-check) | GitLab's merge request changes API gives per-file diffs, like GitHub's files list; Gitea's too. A connector fills the same fields from a different call. The `local-git` connector already covers every host for a local run | 0019 |
| D3 | **Behaviour-preserving extraction first.** One pull request moves the pipeline into the core with GitHub mode unchanged, gated by a golden test: the fake-provider tests' recorded prompts (`FakeProvider.requests[].prompt`) are byte-identical before and after. The local connector and sinks come in the next pull request | A refactor and a feature in one diff cannot be reviewed for "unchanged". The fake provider already records every request (*verified*, `src/engine.fake.test.ts`) | 0019 |
| D4 | **Local runs use the signed-in `claude`, never an API key.** The adapter gets an explicit `auth: "subscription"` mode: it refuses to start when `ANTHROPIC_API_KEY` is set in the environment (a usage error naming the variable), strips it from the child environment, and never reads or forwards OAuth tokens or `~/.claude` credentials. A dry run keeps today's behaviour | Claude Code's terms allow the developer's own unmodified binary signed in by Anthropic's flow, and forbid intermediating credentials (research, "Is a subscription allowed?"). With a key present, `claude -p` bills the key (Sol, *inferred from docs*); a developer would be billed without knowing | 0019 |
| D5 | **Defaults.** Any signed-in Claude account; the guide explains Consumer terms (personal Pro or Max: training setting must be off, 30-day retention) against Team or Enterprise commercial terms. Model Sonnet 5.5 at effort `high` (today's `DEFAULT_MODELS` and `DEFAULT_EFFORT`, *verified*) until #90's `tier` exists; then `local` takes `--tier` with the engine's own table and no local table, and `--model`/`--effort` leave with ADR 0017. Output: terminal always, `--output report.md` for a file with every finding and a copy-paste "prompt for your agent" block | Owner's decision. The tier is the engine's knob (ADR 0017); a local-only model table would be a second place to measure | 0019; composes with 0017 |
| D6 | **First slice: the committed branch only**, `merge-base(base, HEAD) → HEAD`, from an immutable snapshot of `HEAD` (`git archive` into a temporary directory, deleted afterwards). The diff, the files the agent reads, the call-site evidence and the citation checks all use that snapshot. `--working-tree` (staged and unstaged, tracked files) is the next slice, designed in a follow-up, not "someday" | The engine assumes one state: the prompt says the checkout *is* the head, evidence greps it, `repoLineCounter` counts its lines (*verified*: `buildBatchPrompt`, `gatherEvidence`, `reviewBatch`). A working tree edited during a 15-minute review would break that silently | 0019 |
| D7 | **The local diff is `git diff -M --inter-hunk-context=1 <merge-base> HEAD`**, with `--numstat` for the counts, parsed into the same per-file records GitHub sends | The probe reproduced GitHub's patches on 1,397 files of 64 pull requests with that flag (research); hunk grouping was the only systematic difference | 0019 |
| D8 | **Instructions come from the merge-base commit**, read with `git show <merge-base>:<path>`, never from the head or the working tree | ADR 0006 decision 3 and today's `readBaseInstructions` (*verified*: base, never head). Same rule, different reader | reuses 0006 |
| D9 | **No GitHub call in local mode**, by construction: the core has no `gh` dependency, and the local command never constructs one. A test runs `local` with a `gh` stub that throws | The promise below has to be checkable, not asserted | 0019 |
| D10 | **The telemetry switches are set in the child environment** of every `claude` call in local mode: `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, `DISABLE_TELEMETRY=1`, `DISABLE_ERROR_REPORTING=1`, `DISABLE_AUTOUPDATER=1`, `CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY=1`, plus `--no-session-persistence`. None of them passes today's allowlist (*verified*: `CHILD_ENV_ALLOWLIST`), so they must be added on purpose | What they switch off is documented (research, "Telemetry"); whether they hold on the wire is *unverified* and is part of validation level c. `--no-session-persistence` keeps the transcript, which holds the employer's code, off `~/.claude/projects/` | 0019 |
| D11 | **The promise is the honest one:** "Wachiman sends no telemetry and makes no GitHub requests in local mode; your code is sent to your configured Claude account for the review." | Claude Code's own metrics and error reports are a separate claim with separate switches, and the model call is the review | 0019 |
| D12 | **Cost in local mode is an estimate, and the limits are work limits** (the probe confirmed OAuth mode reports `total_cost_usd` and enforces `--max-budget-usd`, after the call that crosses it). `total_cost_usd` is an API-equivalent figure, labelled so in every output; the run is bounded by calls, turns per call, time per call and total minutes. A quota or auth stop ends the run with a partial report whose coverage section lists what was not reviewed; the run never waits for a window to reset | A subscription has no dollar meter the engine can read (Sol, *inferred from docs*; the probe confirmed the estimate is reported). Pretending the estimate is a bill would mislead the developer and their employer | 0019 |
| D13 | **Validation in three levels** before the guide makes any claim: (a) input parity, `local-git` against `github` on known pull requests, same `ReviewFile[]`; (b) prompt parity, the same commits through the core with the fake provider, batch prompts byte-identical between sources; (c) one real local review on the subscription on known kaipu-record commits (#479 at `aac7202`) compared with the posted GitHub review | Owner's idea. (a) and (b) cost $0; (c) is the only paid step and the only one that can show what OAuth-mode `claude -p` reports | 0019 |
| D14 | **Files GitHub omits a patch for are reviewed locally** (owner's decision, 2026-11-03). The connector sets `patch` only when git produced a text diff; binary files get none, like GitHub's | Locally the diff exists; dropping it to imitate a limit GitHub does not document would hide real lines. The batch size caps already give an oversized file its own batch | 0019 |
| D15 | **Both formats are public and versioned.** `agent-review local --input <file> --repo-dir <clone>` reviews a `ReviewInput` JSON written by any producer; `--format terminal\|markdown\|json` picks the sink, and the JSON sink writes `ReviewResult` as is. JSON Schemas for both ship in `docs/formats/`. Inside `/1` only optional fields are added; removing, renaming or retyping a field is `/2`, and the core refuses a version it does not know. `headDir` is never in the file: the core snapshots `head.sha` from `--repo-dir` | Owner's decision: the formats are the seam for other hosts and tools (an editor, a dashboard, the benchmark harness), and a standard result lets runs from different sources be compared. Against, accepted: a compatibility promise before a second producer exists; the additive-only rule is its cost | 0019 |
| D16 | **The GitHub review is one rendering of `ReviewResult`.** `buildReview` becomes the GitHub sink; terminal, Markdown and JSON render the same object | A fact the result carries reaches every destination; no sink computes its own | 0019 |
| D17 | **The subscription child environment passes `USER`** | Probe: on macOS, `claude -p` with today's allowlist and no `USER` answers "Not logged in"; with `USER` it signs in. CI never noticed because it uses a key | 0019 |

## Open questions

The owner answered the first draft's eight questions on 2026-11-03. Decided:

- **Q1, formats: public now** (D15). The first draft recommended an in-process type; the owner
  chose a public input file and asked for the output to be standardised the same way.
- **Q2, files GitHub sends no patch for: reviewed locally** (D14). The parity test lists them as
  "local only", not as differences.
- **Q3, subscription bounds: answered by the probe** ([below](#the-subscription-probe-2026-11-03)).
  OAuth mode reports `total_cost_usd` and enforces `--max-budget-usd`, so D12 keeps both the
  estimate guard and the work limits. Still unknown: what a quota exhaustion looks like in the JSON
  result (a probe cannot trigger it cheaply), and whether D10's switches hold on the wire. Both
  stay in validation level (c).
- **Q6, scope words, `adrNotices` and the confidence rule: in the core**, so GitHub and local
  runs behave the same.
- **Q7, "how this was verified": yes.** `ReviewResult` findings reserve an optional
  `verification?: { checked: string; example?: string }`, and the Markdown and terminal sinks print
  it as one line under the finding when present. Asking the model for it changes the output schema
  the model answers, which this spec leaves alone; it is #90's decision or its own issue.
- **Q8, `PrFile`: alias in the extraction** (`export type ReviewFile = PrFile`), rename in the
  local-connector pull request.

Still open, with a recommendation each:

4. **Laptop isolation: what must be proven before the guide claims it?** A developer's `~/.claude`
   holds things a CI runner's empty home never has: a global `CLAUDE.md`, hooks that run shell
   commands on tool events, plugins and skills, MCP servers, and the claude.ai connectors of the
   account (Gmail, Linear, Drive, …). Loaded into a review, the first would steer it, the second
   would run code on the reviewer's machine, and the last two could send the employer's code to
   another service. The probe showed one property: under `--restricted`, a `CLAUDE.md` in a parent
   of the working directory is not loaded (the control run without `--restricted` loaded it), and
   `--safe-mode` keeps sign-in working. Hooks, plugins, MCP servers and the account's connectors
   are untested.
   - *Claim isolation from the flags' documentation.* Against: ADR 0001 allows claims "only for
     behaviours that tests show".
   - *Extend the harness to a populated HOME, then claim what it shows.* Against: about a day's
     work and one fixture per kind. That is the price of the claim.
   - **Recommendation:** extend the harness (global `CLAUDE.md`, a settings hook that writes a
     file, a plugin skill, a local MCP server, each with a sentinel; the account's connectors
     checked by asking the child to list its tools), run it with and without `--safe-mode`, adopt
     `--safe-mode` if it adds a property and costs nothing, pin the tested Claude Code version.
     Reject `--bare` (it disables the keychain sign-in).
5. **Snapshot mechanism.** A review takes minutes, and during it the agent reads files from disk
   while the prompt holds a diff computed at the start. A developer who keeps editing, or switches
   branch, makes the two disagree: findings cite lines that are no longer there, and the citation
   checks reject correct findings or accept wrong ones. In CI this cannot happen because the
   checkout is fresh and nobody edits it. The snapshot is a copy of the exact commit in a
   temporary directory that the diff, the agent, the evidence and the checks all read, deleted
   afterwards; it also leaves the developer free to keep working. `git archive HEAD | tar -x` runs
   no hooks and touches no index, but honours `export-ignore` attributes. `git worktree add
   --detach` runs `post-checkout` hooks unless `core.hooksPath` is overridden, and leaves worktree
   metadata in the clone. A temporary index (`GIT_INDEX_FILE`, `git checkout-index`) runs no hooks
   and ignores export attributes, but is the least familiar. **Recommendation:** `git archive`,
   with the connector comparing the snapshot's file list to `git ls-tree -r HEAD` and warning on
   any file missing. Smudge filters (LFS) give pointer files in all three, as GitHub's API does.
9. **Should the local mode replace the CI reviewer?** (Owner, 2026-11-03.) Local runs cost the
   developer nothing extra on a plan they already pay for and need no key.
   - *Local only.* Against: Claude Code's terms allow a subscription for the subscriber's own use,
     so a reviewer that reviews everyone's pull requests (contributors, teammates without a plan)
     still needs an API key in CI. A local review runs only when the developer remembers to and
     leaves no record on the pull request; CI's incremental reviews, threads, ceiling and verdict
     history (ADR 0011, 0012) have no local counterpart. ADR 0001's product is the Action.
   - *CI only (today).* Against: a review arrives after the push, and where CI with a key is not
     allowed (the owner's employer) there is no review at all.
   - **Recommendation:** both, with distinct jobs. Local is the review before the pull request,
     on the author's account; CI is the record on the pull request, for everyone. Where CI is not
     allowed, local is the whole product, and nothing in the core assumes otherwise.

## Out of scope

- Host API connectors (GitLab, Bitbucket, Gitea) and posting to them. The format is designed so
  they fit; none is built.
- `--working-tree`, `--staged`, untracked files. Next slice, after the committed-branch slice has
  run on real work.
- Incremental local reviews, local thread follow-up, learned memory, the automatic ceiling
  (ADR 0007, 0008, 0011, 0012): all GitHub-side state. A local run reviews the whole requested
  range every time.
- Running the developer's agent on the findings. The report ends with a prompt to paste; Wachiman
  starts nothing.
- Any change to what the model is asked (`RULES`, `FLOW_QUESTIONS`, the data-path questions, the
  output schema). Prompt parity (b) is the test that this held.
- The Codex adapter in local mode. #90 proposes removing it; this spec does not depend on either
  outcome.

## Failures this must protect against

- **A developer is billed on an API key without knowing.** `ANTHROPIC_API_KEY` inherited from a
  shell profile makes `claude -p` use the key (*inferred from Claude Code's docs*). D4 refuses to
  start.
- **Wachiman touches the OAuth token.** It never reads `~/.claude`, the keychain or
  `CLAUDE_CONFIG_DIR`'s contents; it passes `HOME` and `CLAUDE_CONFIG_DIR` through, as today, and
  nothing else. A test asserts the local child environment has no `ANTHROPIC_*` variable.
- **A GitHub request in local mode** (a leaked `gh` call, a fetch). D9's stub test.
- **Telemetry that the promise denies.** D10's variables; level (c) watches the wire once.
- **The diff and the files the agent reads disagree** because the developer kept editing. D6's
  snapshot.
- **The developer's own `~/.claude` customisations steer the review** (a global `CLAUDE.md`, a
  hook that runs a command, an MCP server with network access). Open question 4's harness
  decides what is claimed; until then the guide says so.
- **The reviewed repository runs code in the engine or the agent** (`bunfig.toml` `preload`,
  `.env` with `ANTHROPIC_BASE_URL`, `.claude/` hooks). Today's answer, kept: engine-owned working
  directory, `--no-env-file`, `--config=`, scratch directory for `claude`, `--restricted`,
  `--strict-mcp-config`.
- **A quota stop reported as a complete review.** D12: `stop: "quota"` and a coverage list.
- **Company code left in temporary directories.** Today `reviewBatch` writes `pr.json`,
  `threads.json` and `evidence.json` to a `mkdtemp` directory and never removes it (*verified*:
  no `rmSync` in `reviewBatch`; the adapter removes only its own scratch directory). The core
  removes its run directory on success and on failure in both modes; the snapshot is removed too.
- **A finding cites a line that does not exist**, which the developer's agent would then "fix".
  Today's `checkOutput` and `citationProblem` run against the snapshot, unchanged.
- **The GitHub path changes by accident.** D3's golden prompts and the existing fake-`gh` tests.

## Acceptance criteria

Checkable predicates; each names the pull request it belongs to (E = extraction, L = local
slice, G = guide).

- [ ] (E) `src/engine.ts` exports `reviewChange(input: ReviewInput, options, deps): ReviewResult`
  and `review()` calls it; `review()` keeps `gh`, the marker, `compareFiles`, `rebaseDelta`,
  `ceilingRoom`, `openThreads`, `buildReview`, `refuseLeak`, `postReview` and the reply posting.
- [ ] (E) A golden test records every `FakeProvider.requests[].prompt` of the existing fake tests
  on `main` before the extraction and asserts byte identity after it. Every existing test passes
  unchanged.
- [ ] (E) `ReviewInput` and `ReviewResult` carry a `format` string (`wachiman.review-input/1`,
  `wachiman.review-result/1`); JSON Schemas for both are in `docs/formats/`; a round-trip test
  (`JSON.parse(JSON.stringify(x))` deep-equals `x`, `headDir` excepted) passes and validates each
  fixture against its schema; the core rejects an unknown `format` with a usage error.
- [ ] (E) The core has no `GhFn` in its dependencies: the type of `reviewChange`'s `deps` does not
  include `gh`.
- [ ] (L) `agent-review local [--base <ref>] [paths…] [--repo-dir <dir>] [--input <file>]
  [--format terminal|markdown|json] [--output <file>]` exists; with `--format json` stdout holds
  only the `ReviewResult` and progress goes to stderr; with `--input`, the file's `change.head.sha`
  is snapshotted from `--repo-dir` and no local diff is computed; `--base` defaults to the upstream's default branch when resolvable, else `main`; the
  command prints the resolved base ref, the merge-base SHA and the head SHA before any call.
- [ ] (L) With `ANTHROPIC_API_KEY` set, `local` exits 2 before any call with a message that names
  the variable and says the local mode uses the signed-in `claude`.
- [ ] (L) A test runs `local` with a `gh` stub that throws on any call and the run completes.
- [ ] (L) A test asserts the local child environment contains none of `ANTHROPIC_API_KEY`,
  `ANTHROPIC_BASE_URL`, `GH_TOKEN`, and contains the D10 variables and `USER` (D17); a test asserts the `claude`
  arguments include `--no-session-persistence`.
- [ ] (L) The review runs against a snapshot: a test edits a tracked file in the working tree
  after the snapshot is taken and asserts the prompt's diff and the agent's `--add-dir` both show
  the committed content.
- [ ] (L) The run directory and the snapshot are removed on success and on a thrown error (a test
  with a failing fake provider).
- [ ] (L, level a) An opt-in test (`WACHI_PARITY=1`, needs `gh` and network) builds the input for
  at least 10 merged pull requests of this repository with both connectors and asserts equal
  `filename`, `additions`, `deletions` and `patch` wherever GitHub sent a patch, and reports the
  files where only the local connector has one.
- [ ] (L, level b) For a recorded pull request fixture and a local clone at the same commits, the
  fake provider receives byte-identical prompts per batch from both connectors, with the same
  `change` metadata in both inputs.
- [ ] (L) Every cost figure in the terminal and Markdown output is labelled an API-equivalent
  estimate; a run ended by a quota or auth error prints `stop: quota` and lists every file not
  reviewed.
- [ ] (L) The Markdown report holds every finding (no `MAX_BODY_CHARS` cut), each with path,
  line, label, confidence and body, and ends with the "prompt for your agent" block that lists
  each finding's `path:line` and the reviewed head SHA.
- [ ] (G, level c) One local run on kaipu-record #479 at `aac7202` (base: its merge-base with
  `main` at the time) on the owner's subscription; the report is compared with the posted review
  (findings matched by path and defect) and the comparison, the reported `total_cost_usd`, the
  wall-clock time and what the wire showed are recorded in the benchmarks repository before the
  guide claims anything.
- [ ] (G) `docs/local-review.md` states, for each of: telemetry switches, populated-HOME
  isolation, `--safe-mode`, OAuth cost reporting, whether it was verified and on which Claude Code
  version.

## Detail

### What the engine reads from a file and a pull request (the $0 check)

Read on `main` at `dce32d9`, no execution. This grounds which fields of the input are required.

| Field | Where it is read | Consequence for the format |
| --- | --- | --- |
| `PrFile.filename` | everywhere: filtering, risk, module key, batch lists, coverage, dedupe, evidence, questions, inline anchoring | **required** |
| `PrFile.additions`, `deletions` | `sizeOf` for batch packing (`planBatches`), the file lists in the prompt (`everyFile`, the batch list), `withOwnChange` recount | **required**; `git diff --numstat` gives them; binary shows `-` and becomes 0, as GitHub reports |
| `PrFile.patch` present | `planBatches` (character cap), `annotateDiff` (the numbered diff), `commentableLines` in `buildReview` (inline vs body), `addedLinesOf` for evidence and for `selectQuestions`, `changeSignature`, `ownChangeSince` | **optional**, as today |
| `PrFile.patch` absent | `planBatches` counts 0 characters; `annotateDiff` prints "(no diff from GitHub: binary or too large; read the file itself)"; `batchGaps` accepts a closed skip reason only for such a file; `buildReview` anchors nothing inline; evidence and questions see no added lines | The notice's wording names GitHub and must become source-neutral in the extraction ("no diff: binary or too large") **without changing GitHub mode's prompt**, so the golden test must be taken *after* that wording change is agreed, or the wording stays and parity (b) accepts it. Recommendation: change the wording in the extraction PR and re-record the golden prompts in the same PR, with the diff reviewed |
| `PrFile.sha` | **only** `rebaseDelta` (`was.sha && was.sha === f.sha`, identical blobs after a rebase); produced by `listFiles` and `compareFiles` | **optional**; the core never reads it. The `local-git` connector can fill it from `git diff --raw` cheaply, and GitLab's changes API cannot |
| `meta.headRefOid` | the prompt's first line ("checked out at its head commit"), the review headline, the marker, `postReview`'s `commit_id` | **required** as `change.head.sha` |
| `meta.title`, `meta.body`, `meta.author.login` | written to `pr.json` per batch; the prompt says "The pull request's title, body and author are in `pr.json`"; `FLOW_QUESTIONS` names the pull request body as the author's claim to verify | **optional**. Absent, the connector writes `pr.json` with the branch name as title, the commits' subjects as description and `git log -1 --format=%an` as author, so the file always exists and the prompt sentence stays true |
| `pr`, `repo` | the prompt's first line ("reviewing pull request #N in owner/repo"), log lines, `pr.json` is not keyed by them | The prompt needs one sentence that describes the change; `change.describe` carries it ("pull request #479 in niway-dev/kaipu-record" or "branch `feat/x` of `kaipu-record` against `main`") |
| `baseSha` (`gh api pulls/N --jq .base.sha`) | `readBaseInstructions` (ADR 0006) and `rebaseDelta` | **required** as `change.base.sha`; for a pull request it is `base.sha` today (the base branch tip, not the merge-base, see ADR 0006's status line); for the local connector it is the merge-base |
| `since`, `rebased`, threads | the scope sentence of the prompt, thread instructions, `buildReview`'s headline | **optional**, GitHub-only today |
| `instructions` | rendered once into the context and into every batch prompt | **required** (may be empty: "The base commit has none of these files") |
| `repoDir` | the agent's `--add-dir`, `gatherEvidence`'s `git grep`, `repoLineCounter`, `relativisePaths` | **required** as `headDir`: the checkout (GitHub mode) or the snapshot (local) |

Network, *verified*: the engine reaches the network through `defaultGh` (`spawnSync("gh", …)`) and
the provider only; `spawnGit` runs `git` in the head with a minimal environment. There is no other
sender. A core without `gh` in its dependencies therefore makes no request of its own.

Today's dry run is close to a subscription run, *verified*: `getProvider` passes
`requireApiKey: !options.dryRun`, so `AGENT_REVIEW_DRY_RUN=1` on a signed-in machine already
runs `claude -p` on the machine's own login (`docs/configuration.md`, "a dry run uses the
machine's own provider login"). It still reads GitHub and still forwards an inherited key. D4 is
the explicit version of that path with the two holes closed.

### The core and its ports

```
                       ReviewInput                         ReviewResult
  github connector ───────────┐                       ┌──────► GitHub sink (buildReview, refuseLeak, postReview, replies)
                              ├──► reviewChange() ────┤
  local-git connector ────────┘      │                └──────► terminal sink, Markdown sink (later: JSON)
                                     ▼
                              ProviderAdapter (Claude Code, unchanged)
```

**In the core** (today's names, all source-neutral, *verified*): `resolveScope`, `filterFiles`
with `DEFAULT_EXCLUDE` and the configured exclude, `planBatches`, `renderInstructions`,
`assignThreads` (over an optional, possibly empty conversation), per batch `gatherEvidence`,
`selectQuestions`, `buildBatchPrompt`, `runProvider`, `relativisePaths`, `checkOutput`,
`batchGaps` and the one retry, the budget arithmetic (`spent`, `MIN_BATCH_USD`, `attempt`),
`mergeOutputs`, `enforceConfidenceRule`, `adrNotices`, `dedupeFindings`, the "not reached" skips,
and the per-batch `BatchReport`s. The core also decides each finding's anchor
(`commentableLines`), so a sink does not need the patches.

**In the GitHub orchestration** (`review()`, unchanged behaviour): `gh pr view`, `listFiles`,
`lastReviewedSha`, `compareFiles`, `rebaseDelta` and `ownChangeSince`, the "Already reviewed" and
"Nothing to review" bodies, `ceilingRoom` (which also sets the total budget the core receives),
`readBaseInstructions` through `gh`, `openThreads`, and after the core: `buildReview`,
`refuseLeak`, `postReview`, the reply POSTs. `threadReplies`, `answer` and `comment` are untouched.

**Why the cut is there.** Everything in the core is already a pure function or a function of
`Deps` without `gh`; everything left outside either calls `gh` or renders GitHub Markdown. Sol's
table of GitHub dependencies (its section 1) was checked against the code and agrees, with one
correction: `resolveScope` and `adrNotices` are not GitHub-specific and move in (Q6, decided: core).

**The extraction pull request** does only this: it introduces the two types, moves the body of
`review()` from `filterFiles` to `buildReview` into `reviewChange`, builds the input in `review()`,
and converts the result into `buildReview`'s input. The prompt text is unchanged except for the
"no diff from GitHub" notice if the owner agrees to re-record the golden prompts in the same pull
request. No new command, no new connector, no new flag.

### The input format

A public JSON file format (D15), with a TypeScript type of the same shape; the schema in
`docs/formats/` and the round-trip test fix it. `format` is the only
versioning: a connector writes the version it produces, the core refuses a version it does not
know. Fields marked *opt* are optional.

```ts
interface ReviewInput {
  format: "wachiman.review-input/1";
  change: {
    kind: "pull-request" | "branch";           // "merge-request" later, if a host needs the word
    /** One sentence for the prompt's first line and the report's headline. */
    describe: string;
    repository: { name: string; url?: string }; // "owner/name" or the clone's directory name
    base: { sha: string; ref?: string };        // base.sha today; the merge-base for local-git
    head: { sha: string; ref?: string };
    title?: string; description?: string; author?: string;   // opt: pr.json content
    identifier?: string;                        // opt: "#479", "!12"
  };
  files: ReviewFile[];                          // today's PrFile: filename, additions, deletions, patch?, sha?
  instructions: BaseInstructions;               // read from change.base.sha by the connector (ADR 0006)
  headDir: string;                              // in memory only: the snapshot the core made from --repo-dir
  scope: string[];                              // the words after `review`, or the local paths
  since?: { sha: string; rebased: boolean };    // opt: incremental context, GitHub only today
  conversation?: Thread[];                      // opt: open threads for the model to answer, GitHub only today
}
```

Why these are optional: a host that cannot give blob SHAs (GitLab's changes API gives diffs and
paths) still fills everything the core reads; a connector that has no title (a local branch) still
produces a `pr.json`. Why `describe` is a string the connector writes: the core must not know the
vocabulary of each host to write one sentence, and prompt parity (b) requires that two connectors
given the same `describe` produce the same prompt.

**How a host connector fills it.** GitHub: `gh pr view` and the files list, as today. GitLab:
`GET /projects/:id/merge_requests/:iid/changes` gives per-file `diff`, `new_path`, `old_path` and
flags; counts need a per-file scan of the diff; no blob SHAs. Gitea: `GET /repos/{owner}/{repo}/pulls/{index}/files` gives patches and counts, like GitHub. Bitbucket: one raw diff for the
pull request, split per file. None of these is built; the point is that each fills the same
fields with one or two calls, and `local-git` serves the developer on all of them.

**The `local-git` connector**, first slice:

1. Resolve `--base` (default: the upstream's `HEAD` ref if `origin/HEAD` resolves, else `main`,
   printed) and `HEAD`; refuse a detached or unborn `HEAD` with a usage error. No fetch is made.
2. `git merge-base <base> HEAD`; refuse when none exists.
3. Snapshot: `git archive --format=tar <head>` extracted into a `mkdtemp` directory (open
   question 5); compare with `git ls-tree -r --name-only <head>` and warn on differences.
4. Files: `git diff -M --inter-hunk-context=1 --numstat <merge-base> <head>` for counts and
   renames, `git diff -M --inter-hunk-context=1 <merge-base> <head>` for patches, split per file;
   `patch` unset where git printed "Binary files differ"; `sha` from `git diff --raw`. Renamed
   files keep the new path as `filename`, as GitHub does.
5. Instructions: `git show <merge-base>:<path>` for each of `INSTRUCTION_PATHS` (and the old
   focus path), cut at `MAX_INSTRUCTION_BYTES` with the same warning.
6. `change`: `kind: "branch"`, `describe` = "branch `<head ref>` of `<dir name>` against
   `<base ref>` (merge-base `<sha7>`)", `title` = head ref, `description` = the range's commit
   subjects, `author` = `%an` of the head commit.
7. After the run, the snapshot and the run directory are deleted, on every path.

The connector runs `git` with the same minimal environment as `spawnGit` (*verified*: `-c
core.fsmonitor=false`, `core.quotepath=off`), in the clone, reading only.

### The result format

```ts
interface ReviewResult {
  format: "wachiman.review-result/1";
  change: ReviewInput["change"] & { snapshot?: string };
  engine: { version: string };                                  // readVersion()
  provider: { label: string; model: string; effort: string };  // the footer's facts
  coverage: {
    expected: string[]; reviewed: string[];
    skipped: { path: string; reason: string }[];                // closed reasons and "not reached"
    excluded: number; partial: boolean;
  };
  findings: (Finding & {
    anchor: "diff" | "outside";
    verification?: { checked: string; example?: string };       // reserved (Q7); filled once the model is asked
  })[];                                                         // after dedupe, confidence rule, adrNotices
  contracts: Contract[];                                        // merged, evidence-checked
  summary: string;
  batches: BatchReport[];
  threadReplies: ThreadReplyOutput[];                           // empty without a conversation
  instructionChanges: { files: string[]; baseSha: string };
  execution: {
    costUsdEstimate: number;                                    // "API-equivalent estimate"
    calls: number; turns: number; durationMs: number;
    stop: "complete" | "budget" | "turns" | "timeout" | "quota" | "error";
    notices: string[];                                          // the warnings the engine logged
  };
}
```

`buildReview` becomes a pure function of this (plus `since`, `rebased`, `scoped`, `mention`,
`automatic`, which the GitHub orchestration still knows), and its output is unchanged. The
Markdown sink renders the same facts without `MAX_BODY_CHARS`, with every finding, and the
terminal sink prints the headline, the count line, each finding as `path:line label title` with
its body indented, the coverage list and the estimate line. Progress goes to stderr so that a
future `--format json` on stdout stays parseable.

**The "prompt for your agent" block** (from the research, Greptile's output idea 1), at the end
of the Markdown report and printed by the terminal sink on request:

```
Read the review of <head sha7> below. For each finding, open the cited file at the cited line,
decide whether it is valid against the current code, and fix the ones that are. Report the ones
you reject with the reason. Run the repository's checks after the fixes.

1. src/a.ts:42 · 🟠🐛 Fix · bug: <title> (confidence high)
   <body>
...
```

It is text, no extra model call, and Wachiman does not launch anything.

### The local mode of the adapter

`ClaudeCodeProvider` gets `auth: "api-key" | "subscription"` (today's behaviour is `"api-key"`,
plus the dry-run exception). In `"subscription"` mode, *all new*:

- `preflight()` throws a usage error when `ANTHROPIC_API_KEY` is set: "ANTHROPIC_API_KEY is set.
  The local review runs on your signed-in `claude`; unset the variable, or run the GitHub mode."
  It never checks for a token, never reads `~/.claude` or `CLAUDE_CONFIG_DIR`; if sign-in is
  missing, the first call fails and the run ends with `stop: "quota"`'s sibling, `"error"`, and
  Claude Code's own message.
- `buildChildEnv` drops `ANTHROPIC_API_KEY` and adds D10's variables; `HOME`, `PATH`, `TMPDIR`,
  locale and `CLAUDE_CONFIG_DIR` pass as today, and `USER` is added (D17), because they are how
  the binary finds its own sign-in.
- `buildClaudeArgs` adds `--no-session-persistence`; `--safe-mode` only after open question 4.
- `leaksSecret` keeps the key-shape check (there is no exact key to match).
- Everything else is the same: `--restricted`, `--strict-mcp-config`, `--settings`, `--tools
  Read,Glob,Grep`, the scratch working directory, `--max-budget-usd`, `--max-turns`, the
  `SIGKILL` timeout.

**Composition with #90's `tier`.** Until ADR 0017 lands, `local` reads `AGENT_REVIEW_MODEL` and
`AGENT_REVIEW_EFFORT` like the CLI does today, defaults Sonnet 5.5 and `high`. When the tier
exists, `local --tier <economy|standard|deep>` uses the engine's table, and the local default is
the same as the workflow's default tier at that time; a tier with a judge role runs the judge
call on the same subscription, counted in `execution.calls`. Nothing about the tier is decided
here.

### The subscription probe (2026-11-03)

Seven calls of `claude -p --model haiku` on Claude Code 2.1.318, macOS, signed in with the owner's
subscription, no `ANTHROPIC_API_KEY`, from an empty working directory whose parent held a
`CLAUDE.md` with a codeword. Each call had `--restricted --strict-mcp-config --tools Read
--no-session-persistence --output-format json`, a child environment built with `env -i`, and D10's
variables. Total: about $0.002 API-equivalent, from the plan.

| Run | Result |
| --- | --- |
| `env -i` with `PATH`, `HOME`, `TERM`, `CLAUDE_CONFIG_DIR` | `"Not logged in · Please run /login"`, `is_error: true`, cost 0 |
| … plus `USER` | Signs in; `total_cost_usd` 0.00048 (D17) |
| `--restricted`, asked for the codeword | `NONE`: the parent `CLAUDE.md` was not loaded |
| … plus `--safe-mode` | `NONE`, signed in |
| Control without `--restricted` | `PELICAN`: the parent `CLAUDE.md` loads without it |
| `--max-budget-usd 0.000001` | `subtype: error_max_budget_usd`, `total_cost_usd` 0.00011: enforced after the first call, which overshoots |
| After all runs | No transcript under `projects/`; Claude Code created an empty `memory/` directory there |

What this does not show: hooks, plugins, MCP servers and the account's claude.ai connectors in a
populated home (open question 4), the shape of a quota stop, Linux (where the sign-in is not in a
keychain), and the network traffic.

### Validation, in order

| Level | What | Cost | Answers |
| --- | --- | --- | --- |
| a | `local-git` vs `github` on at least 10 merged pull requests of this repository (public): equal `ReviewFile[]` where GitHub has a patch; list the rest | $0 | The connector reproduces the probe inside the engine's own parsing, and the D14 "local only" list is real |
| b | Same commits through `reviewChange` with the fake provider from both connectors (same `change` metadata): `requests[i].prompt` byte-identical per batch | $0 | The core is source-independent; the only inputs that reach the prompt are the ones the format carries |
| c | One local run on kaipu-record #479 at `aac7202` on the owner's subscription, compared with the posted review; record `total_cost_usd`, turns, minutes, the exit shape, and what left the machine (a proxy or packet capture on the laptop, one run) | one review's worth of the owner's plan | The shape of a quota stop and the real run's estimate, whether D10's switches hold on the wire, and whether findings match the API run on the same commits |

Kill condition for (c): if the local run on the same commits finds fewer than half of the posted
review's Medium-or-higher findings, the extraction or the connector changed something that (a)
and (b) did not catch, and the local slice does not ship until the difference is explained.

### The user guide, `docs/local-review.md` (contents only; ships with the implementation)

1. **Who this is for and what it does.** One paragraph; the honest promise (D11) verbatim.
2. **Before you run it on someone else's code.** The permission request: Consumer terms on a
   personal Pro or Max account (training setting off, 30-day retention, link to the privacy
   controls) versus Team or Enterprise commercial terms (no training, 30 days or zero retention);
   Claude Code's local transcripts and why `--no-session-persistence` is set; what leaves the
   machine and what does not. A short template of the request to an employer.
3. **Install.** Bun, a signed-in `claude` (tested version named), a clone of this repository; no
   `gh`, no token, no API key; the launcher command and why it runs from the engine's directory.
4. **Run.** `agent-review local`, `--base`, paths, `--output`; what the first lines print (base,
   merge-base, head, file count, batches); how long a run takes (from level c); how to stop one.
5. **Read the report.** The labels (link to `docs/cli.md`), confidence, the coverage list, the
   estimate line and what it is not, the agent prompt block and how to use it.
6. **Limits.** Work limits and the estimate guard; what a quota stop looks like; no incremental
   state, threads or memory; committed changes only in this slice.
7. **What is verified and what is not**, per claim, with the Claude Code version: telemetry
   switches, populated-HOME isolation, `--safe-mode`, OAuth cost reporting (filled from levels a
   to c and open question 4).
8. **Troubleshooting.** `ANTHROPIC_API_KEY is set`; not signed in; no merge-base; detached HEAD;
   a snapshot that differs from `ls-tree`.

### Refactor order

1. **PR E, extraction** (behaviour-preserving): types, `reviewChange`, `review()` as connector
   plus sink, golden prompts, run-directory cleanup in both modes (a behaviour change, called out
   in the PR). Ships as a patch release; `docs/architecture.md` gets a section "The review core
   and its ports" and the pipeline diagram grows the two seams.
2. **PR L, local slice:** `local-git` connector, snapshot, subscription mode, terminal and
   Markdown sinks, the `local` command, levels (a) and (b) as tests, `docs/cli.md` and
   `docs/configuration.md` entries. Ships as a minor release.
3. **PR G, guide and evidence:** level (c) recorded in the benchmarks repository, the populated-
   HOME harness, `docs/local-review.md`, this spec's status updated.
4. **Next slice, separate spec:** `--working-tree`.
