👮 **Wachiman** · review of the whole pull request, at `6e85e8b`: all 35 files reviewed.

8 finding(s): 1 to fix, 7 to consider; 8 on their lines. Reply in a comment's thread to answer it.

### Risk map

**High.**

- `auth` · `src/workspace/run.ts:259` — The committed files of a sibling clone, private ones included, are written to a temporary directory, and the provider is given that directory to read, so private code reaches the model provider.
- `public-contract` · `src/formats.ts:282` — Result /2 gains optional fields (siblings, workspaceContractsApplied, privateContext, removedSiblingReferences), findings gain `references`, and citations gain `member` and `sha`; `toResultV1` now throws for a distributed run.
- `public-contract` · `src/local.ts:712` — With `--format json` and no explicit version, the result version silently becomes 2 when siblings or contracts exist, and an explicit `--result-version 1` exits 2.
- `config-or-ci` · `src/local.ts:541` — A per-user `workspaces.json` default of `on` can turn the mode on for runs without the flag, so each run reads sibling clones on the laptop.
- `public-contract` · `src/workspace/versions.ts:100` — `pinned` now has a documented outcome for a contract with no sides, so a hand-added member's rule fallback text (a `ResolvedVersion.fallback`) shows in the result rows and stderr lines.

**Needs a person:**

- `src/verify.ts:293` (`tradeoff`) — A sibling line may serve as the verifier's `disproof` and drop a finding. The sibling is read at a pinned, local or tip commit, which may not be what the reviewed repository runs against. Whether a sibling snapshot should be strong enough to refute a finding is a product decision.
- `src/workspace/run.ts:259` (`tradeoff`) — `--sibling` snapshots the member's whole tracked tree (`**`) and hands it to the provider in every batch. That gives the model the most context, but it costs more tokens and sends private repository content in full. Whether to cap it, or to scope it to the contract's paths by default, is a product decision.

**Read first:** `src/workspace/run.ts`, `src/local.ts`, `src/formats.ts`, `src/workspace/versions.ts`, `src/distributed.ts`.

### Summary

**Batch 1 of 6.** I read all 14 files of this part, plus `src/workspace/run.ts`, `snapshot.ts` and `versions.ts` for the calls into them. The wiring holds up. Both `reviewBatchBackingOff` callers pass `options`, so the distributed context reaches every batch call, including the retries. The verifier schema is used for the provider call and for validation alike. The `/1` fallback conditions in `local.ts`, `formats.ts` and `help.ts` agree with each other. I found two issues. The sibling-reference regex never matches a path containing a bracket, parenthesis, comma, semicolon or quote, so such a reference stays in the text unchecked and uncounted. The sibling preparation step has no overall time bound and blocks Ctrl-C while it runs. I also noted one small duplication. I did not read the tests or the schema, which belong to other parts.

**Batch 2 of 6.** I read the five files of this part against their callers (`local.ts`, `discover.ts`, `versions.ts`, `snapshot.ts`, `distributed.ts`, `formats.ts`). `run.ts` does what its header says. Only `local.ts` calls it, the mode is decided before any paid step, and snapshots are released on every exit, including a throw inside `prepareDistributed`. I found no blocker or wrong-result bug. I left three \"consider\" items: version resolution repeats per contract before grouping and the whole step has no overall time bound; a stderr test would not catch a newline in a hostile name; and hand-added `--sibling` members always report a `pinned`→`tip` fallback. The tests match the code they exercise, and the schema's `dependentRequired` wording in the `formats.test.ts` assertions matches `src/json-schema.ts`. I did not read the engine, `verify.ts` or `sibling-references.ts`, which are in other parts, so I could not check the counts in the engine-level assertions of `distributed.fake.test.ts`, such as `removedSiblingReferences` being 8.

**Batch 3 of 6.** I found nothing to flag in these five test files. I cross-checked their expected strings and arguments against `src/local.ts`, `src/distributed.ts`, `src/sinks/common.ts`, `src/engine.ts` and `src/workspace/*`, and they match. That covers the stderr lines, the prompt section and member lines, the sibling text, the refusal messages, the flag parsing, the snapshot directory names and the `homeRelative` behaviour in the default-on test. I did not run any tests. The control-character fixtures in `src/local-distributed.test.ts` are real `\^[` escapes; the diff rendering mangled them. The import-graph test correctly finds `src/local.ts` as the only importer of `./workspace/*` outside `src/workspace`.

**Batch 4 of 6.** I found no defects in this part. All five test files match the code they exercise. I checked the sibling-reference, verifier-citation, sink and discovery expectations against the source and fixtures. That covered the count of 14 in `settleModelText`, the rendered sibling lines, the neutralisation expectations and the `walkUp`/`ceiling` options. The one finding is a "consider": a reference whose commit is under 7 hex characters is left in the text, uncounted, and `src/sibling-references.test.ts` records that as intended. I only read the code; I ran nothing.

**Batch 5 of 6.** I found nothing to flag in this part. The tests in src/workspace/run.test.ts assert what their names say, and they match the behaviour of src/workspace/run.ts and src/workspace/versions.ts. The docs in docs/cli.md and docs/formats/README.md match local.ts and distributed.ts for the `/2` default, the exit-2 rule, the default-on line and the `noWorkspaceContractApplied` omission. The fixture fits the field shapes in src/distributed.ts, but I did not read the schema file, so I did not check it against the schema. Nothing was built or run.

**Batch 6 of 6.** The schema additions match what `src/distributed.ts`, `src/workspace/run.ts` and `src/verify.ts` produce, with one wording error. `Sibling.contracts` is documented as holding `--sibling` for a hand-added member, but the code emits an empty array. I found nothing else to flag. The `Sibling` required fields, the omission of `dir` and the `member`/`sha` pairing on `Citation` all match the code. Every keyword used (`dependentRequired`, `minLength`, `const`, `$ref`) is one `src/json-schema.ts` checks. I did not read the fixture or the schema test in full, because they belong to other parts.

<details><summary>What the change connects to (14 closed, 0 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Closed, with the lines they rest on**
- A distributed-repo run prepares sibling snapshots (decideDistributed, then prepareDistributed) before the review (`src/local.ts:539`) — stderr lines `distributed-repo: on`, `workspace:`, `contracts:` and one `sibling:` line each. The terminal and Markdown reports gain a Workspace block and a private-context line. JSON switches to /2 when siblings or contracts exist. If it fails: A sibling that is not cloned, not watched or unreadable becomes a row with a status and a stderr warning, and the review goes on. A git failure in the middle of the plan releases the snapshots and re… Evidence: `src/local.ts:539-555`, `src/local.ts:636-645`, `src/local.ts:730-734`, `src/workspace/run.ts:175-287`, `src/workspace/versions.ts:67`, `src/workspace/snapshot.ts:40`.
- Each provider batch gets the sibling section and `--add-dir` snapshots when one of its files triggered a contract (`src/engine.ts:5366`) — The model may cite `member@sha:path:line` in finding text. `settleModelText` then checks those references. If it fails: A sibling whose status is not readable is listed as 'Not read' or 'not cloned: not checked' and no directory is added. Evidence: `src/engine.ts:3670-3674`, `src/engine.ts:3715-3719`, `src/engine.ts:5366-5377`, `src/engine.ts:5391`, `src/distributed.ts:174-212`.
- The verifier gets every readable sibling snapshot and a schema whose citations may name `member` and `sha` (`src/engine.ts:4133`) — A sibling line can serve as `checked`, `disproof` or `originEvidence`, and sinks print it as `member@sha7:path:line`. If it fails: An unknown member or sha gives a null citation, so a `refuted` verdict is downgraded and a `supported` one needs another checked line. Sibling lines count as evidence for `origin: introduced` like an… Evidence: `src/engine.ts:4133-4148`, `src/engine.ts:4157-4163`, `src/verify.ts:296-321`, `src/verify.ts:419-425`, `src/verify.ts:457-463`, `src/sinks/common.ts:26-32`.
- Every model-written text of the result is passed through `settleModelText` in a distributed run (`src/engine.ts:3882`) — The result and every report show the replacement text, and a count line in the Workspace block. If it fails: A reference the regex cannot parse is left in the text unchecked and uncounted (see the finding at sibling-references.ts:32). Evidence: `src/engine.ts:3877-3904`, `src/engine.ts:3925-3929`, `src/engine.ts:3985-3995`, `src/engine.ts:4003`, `src/engine.ts:4015`, `src/sibling-references.ts:29-35`, `src/sibling-references.ts:159-192`.
- `githubReview` refuses a result that carries siblings, applied contracts or a private context (`src/engine.ts:4353`) — A thrown Error naming the members (through `plainText`) instead of a posted review. If it fails: The throw is loud, so there is no silent leak. Other places that output a result remain unguarded, but none builds one from a local result today. Evidence: `src/engine.ts:4310-4324`, `src/engine.ts:4353`.
- prepareDistributed resolves one commit per (contract, member) and snapshots each sibling into a temporary directory (`src/workspace/run.ts:175`) — stderr lines from `distributedLines` (local.ts:740) and warnings, all passed through `withoutControl`; the result carries the sibling rows without `dir`. If it fails: `snapshotSibling` throws: that row becomes `unreadable` with a warning, and the review goes on. `resolveVersion` finds no sha: `unreadable` row plus warning. A thrown error from the resolver: the sna… Evidence: `src/workspace/run.ts:189-197`, `src/workspace/run.ts:253-275`, `src/workspace/run.ts:278-281`, `src/local.ts:639-645`, `src/local.ts:730-734`, `src/workspace/snapshot.ts:95-126`.
- decideDistributed reads the per-user file, and a manifest only when the mode is asked for or an entry says `on` (`src/workspace/run.ts:73`) — The exit-2 usage errors fire before openLocalSession and before anything is paid for (local.ts:541-555). A `distributed-repo: on (...)` line goes to stderr. If it fails: A git failure in `rev-parse`/`remote get-url` falls back to `repoDir` and no origin, so the repository is matched by directory only. A missing or invalid per-user manifest produces a warning and is s… Evidence: `src/workspace/run.ts:73-121`, `src/workspace/discover.ts:81-122`, `src/local.ts:541-555`.
- Sequence of synchronous git calls (rev-parse, status, ls-tree, cat-file --batch) over all planned siblings (`src/workspace/run.ts:226`) — A silent pause before the `contracts:` stderr line. In the worst case several minutes, or more with many contracts and a hanging or slow `git status`. Ctrl-C kills only the current git child, because the handler cannot run during synchronous code. If it fails: A timed-out `git status` gives `uncommittedUnknown` and a warning. A timed-out `rev-parse origin/HEAD` falls back to `local`. A timed-out `ls-tree` makes the row `unreadable`. The review goes on in e… Evidence: `src/workspace/versions.ts:67-74`, `src/workspace/versions.ts:162-186`, `src/workspace/snapshot.ts:40`, `src/workspace/snapshot.ts:111`, `src/local.ts:576-580`, `src/evidence.ts:348-355`.
- Tests drive `wachiman local --distributed-repo` end to end through `decideDistributed` and the batch prompt section, with a stub `claude` and a canary `gh` (`src/local-distributed.test.ts:131`) — stderr lines, the JSON result /2 fields, and the terminal and Markdown workspace lines. The expected strings match src/local.ts:552-553, src/local.ts:742-758, src/sinks/common.ts:197-227 and src/distributed.ts:145-211. If it fails: A provider that exits 3 with garbage output: the test asserts a non-zero exit and that the sibling snapshot directories are gone. `releaseSiblings` in `finally` at src/local.ts:732 supports this. Evidence: `src/local.ts:541-555`, `src/local.ts:730-734`, `src/distributed.ts:174-212`, `src/sinks/common.ts:197-227`, `src/workspace/snapshot.ts:112`.
- The canary test calls `review()` for a pull request with a manifest, a cloned sibling and a per-user default of `on`, and calls `githubReview()` on distributed… (`src/github-mode-canary.fake.test.ts:167`) — No behaviour change on the GitHub path. A distributed result handed to the GitHub sink throws. If it fails: The `refuseDistributed` throw is not caught here. That fits its stated purpose of failing loudly. Evidence: `src/engine.ts:4315-4324`, `src/local.ts:40`.
- Sinks print sibling rows, references, private-context line and sibling citations from a ReviewResult (tested in src/sinks/distributed.test.ts and src/sinks/sin… (`src/sinks/distributed.test.ts:161`) — The terminal, Markdown report and agent prompt show the sibling lines. A hostile manifest name cannot inject an escape sequence, a heading or a code-span break. Evidence: `src/sinks/common.ts:186`, `src/sinks/common.ts:197-213`, `src/sinks/common.ts:235-236`, `src/sinks/agent-prompt.ts:17`, `src/distributed.ts:117-130`, `src/sinks/terminal.ts:41-55`, `src/sinks/markdown.ts:45-64`.
- findWorkspace takes an options object ({ walkUp, ceiling }) instead of a positional ceiling; discover tests updated (`src/workspace/discover.test.ts:143`) — A run that did not ask for the mode reads no manifest it was not told about. Evidence: `src/workspace/discover.ts:81-122`.
- prepareDistributed turns the changed files into applied contracts and read-only sibling snapshots, and release() removes them (`src/workspace/run.ts:175`) — Each sibling is a row of the context with a status (read, not-cloned, not-watched, uncommitted-not-read, unreadable). The row reaches stderr via distributedLines and the result via distributedResultFields. If it fails: A snapshot failure becomes an 'unreadable' row plus a warning, and the review goes on (run.ts:271-275). A throw in the plan loop calls release() before rethrowing (run.ts:278-281). The per-sibling er… Evidence: `src/workspace/run.ts:175-287`, `src/local.ts:636-645`, `src/workspace/run.test.ts:219-227`, `src/workspace/run.test.ts:315-341`, `src/workspace/run.test.ts:392-403`.
- Docs say --result-version 1 exits 2 when a distributed run lists a sibling or applied a contract, and that the default becomes /2 (`docs/cli.md:242`) — Exit 2, with a message that names --no-distributed-repo (src/formats.ts:369). Evidence: `src/local.ts:643`, `src/local.ts:712`, `src/formats.ts:369`, `src/local-distributed.test.ts:413-419`, `docs/cli.md:242`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost (estimate) |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 6 | 14 | 900 | 4 | reviewed | 18 | $0.57 |
| Batch 2 of 6 | 5 | 917 | 4 | reviewed | 25 | $0.58 |
| Batch 3 of 6 | 5 | 972 | 2 | reviewed | 27 | $0.44 |
| Batch 4 of 6 | 5 | 610 | 2 | reviewed | 26 | $0.50 |
| Batch 5 of 6 | 5 | 861 | 2 | reviewed | 18 | $0.34 |
| Batch 6 of 6 | 1 | 218 | 1 | reviewed | 17 | $0.21 |

</details>

<sub>Not counted against the spend limit: the ledger could not be reached.</sub>

<sub>Claude Sonnet 5.5 via Claude Code 2.1.304 · effort high · review · 6 batches · PR so far $2.64 over 1 automatic run · 132 in / 72k out / 3.4M cache read / 396k cache write · Claude subscription: API-equivalent estimate, not a bill · $2.64</sub>

<!-- wachi:auto -->

<!-- wachi:review -->

<!-- wachiman sha=6e85e8b3587b86e89d247fbe4ecb03e07cd00516 -->

<!-- wachi:attempt id=de30ee26-293f-437e-8cf0-f5a206ed55e6 -->
