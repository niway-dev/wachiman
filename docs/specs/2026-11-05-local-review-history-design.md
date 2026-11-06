# An opt-in local review history that tracks findings across runs

- **Status:** accepted and implemented by the PR that closes #103 (supersedes draft #117); every
  acceptance criterion below is met and ticked. The four open questions were answered with their
  recommendations (a, a, a, a). The claims about the code were checked by reading `main` at `f70f3d4` (the merged local mode, #111 and #112) on
  2026-11-05 and is marked *verified*; claims about other tools come from their documentation as
  fetched that day (linked inline; what could not be fetched is marked *unverified*). No model
  call was made for this design.
- **Issue:** [#103](https://github.com/niway-dev/wachiman/issues/103) (the local mode; this is
  its next slice).
- **Creates:** [ADR 0020](../adr/0020-an-opt-in-on-laptop-review-history-with-deterministic-finding-tracking.md)
  (an opt-in, on-laptop review history with deterministic finding tracking). ADR numbers 0014 and
  0015 are reserved by #80, 0017 and 0018 by #90; #99 carries a draft numbered 0019, which
  collides with the merged ADR 0019 and is #99's problem to renumber.
- **Reuses:** ADR 0019 (the local mode, the `local-git` connector, the sinks, the public result
  format and its additive-only rule), ADR 0011 (how GitHub mode recognises earlier work: the
  signed marker and the content comparison, all GitHub-side), ADR 0007 (learned memory, not
  implemented: this spec takes none of it), ADR 0001 (trust model as amended by 0019), the
  precision verdict vocabulary of `docs/precision.md`.
- **Plan:** a working document, deleted by the shipping commit; git keeps it.
- **Evidence:** the research notes in [How other tools track a finding](#how-other-tools-track-a-finding-across-runs);
  the hub's [local store migration rules](https://github.com/csdev19/general-knowledge/blob/main/architecture/local-store-migration.md)
  (version the on-disk format from day one, move a file aside instead of overwriting it).
- **Written on:** Claude Fable 5.1, from the owner's decisions of 2026-11-05.

## Summary (one minute)

A developer who runs `agent-review local` on the same branch twice gets, today, two unrelated
reports: nothing says which findings are new, which were already reported at the last commit,
and which disappeared because the code changed. The GitHub mode has that memory (the marker and
the compare API, ADR 0011); the local mode has none, by design, because a local run reviews the
whole range every time and keeps nothing on disk.

This slice adds a **history that is off unless the developer turns it on** (`--history` or
`AGENT_REVIEW_HISTORY=1`), **lives only on the laptop** (`~/.wachiman/history/`, mode 0700/0600,
no export anywhere), and **tracks a finding across runs deterministically**: same repository, same
file (renames followed), and either the same cited line (its text, wherever the line
moved) or, with the same topic, the same normalised title. Each later run of the same repository labels every finding
**new** or **still open**, and settles the earlier ones as **probably fixed** (the cited code
changed and the finding was not repeated in a run that reviewed that file), **not repeated**
(the code did not change, the reviewer just did not say it again) or **unknown** (the file was not
reviewed, so nothing can be said). The developer can record a **verdict** on a finding (`correct`,
`wrong`, `partial`, the vocabulary `docs/precision.md` already uses on GitHub), which is what
makes "was the reviewer right" measurable on code that can never feed the benchmarks.

The privacy promise of the guide stays true and grows one clause: no transcript on disk, and no
history unless you turn it on.

| # | Decision | Why | ADR |
| --- | --- | --- | --- |
| D1 | **Opt-in, and off means off.** The history is read or written only when `--history` is given or `AGENT_REVIEW_HISTORY=1`; otherwise `local` neither opens `~/.wachiman/history` nor creates it. GitHub mode never touches it | Owner's decision 3. The guide's promise ("no transcript kept on disk") must stay checkable; a feature that silently writes employer code to `~` would break it. GitHub has its own state (ADR 0011) and runs on a fresh runner where a history would be lost anyway | 0020 (new) |
| D2 | **Nothing leaves the machine.** No export command, no upload, no hook into `wachiman-benchmarks`; the history directory is 0700 and each file 0600. The guide says the history holds the review text, which quotes code, and is as sensitive as a `--output` report | Owner's decision 2: it is used on employer code | 0020 |
| D3 | **One immutable file per run, state derived by replay.** `~/.wachiman/history/<repo-key>/runs/<utc-timestamp>-<sha7>.json` holds the full public `ReviewResult` plus a `tracking` record per finding (its id, fingerprint parts, and the status it was given against the earlier runs) and the list of earlier findings this run settled. `history` reads the files in order and replays; there is no index file to corrupt. Verdicts are an append-only `verdicts.jsonl` beside `runs/` | A run file is written once and never edited, so a crash cannot leave half a state. The `ReviewResult` is stored as is: the public format gains no field, and a later tool can read the files with the published schema | 0020 |
| D4 | **The repository key is readable and stable across clones:** `<basename>-<hash8>`, where `hash8` is the first 8 hex digits of SHA-256 over the credential-stripped `origin` fetch URL (normalised: trimmed, lowercase host, no trailing `/` or `.git`), or over the real path of `git rev-parse --git-common-dir` when there is no `origin`. The run file records which one keyed it, the stripped URL and the clone path | A hash alone makes `ls ~/.wachiman/history` opaque; a name alone collides (two `api` repositories). Keying by remote makes every clone and worktree of one repository share one history, which is what "what did Wachiman find in this repo" means; a path fallback keeps throwaway repositories working. Credentials in an `https://user:token@` URL never reach the hash input or the file | 0020 |
| D5 | **A finding's identity is deterministic, in two tiers, never a model call.** Same repository key, same path (a rename in the later run's `files[].previous_filename` is followed), and then (a) the same **line hash**, with any `topic`: SHA-256 of the cited line's text with all whitespace removed, valid only when that stripped text is at least 8 characters and occurs exactly once in the file at that head; or (b) the same **title key** and the same `topic`: the title lowercased, backticks and punctuation removed, every digit run replaced by `#`, whitespace collapsed. A `line: 0` finding has no line hash and matches by (b) only. Severity and confidence are not part of the identity | SonarQube matches by rule plus line hash first, then rule plus line plus message, then block moves ([Sonar's process steps](https://docs.sonarsource.com/sonarqube-server/discovering/analysis-overview/process-steps)); GitHub code scanning matches `partialFingerprints.primaryLocationLineHash` ([SARIF support](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning)); Semgrep hashes path, rule and matched content so a moved match survives ([remove duplicates](https://docs.semgrep.dev/semgrep-code/remove-duplicates)). Wachiman has no rule id; `topic` guards only the weaker title tier, because the model's topic for one cited line drifts between runs (a real run labelled the same line `bug` three times, then `cleanup`; amended 2026-11-06, ADR 0020). The uniqueness rule stops `}` or `return null;` from matching every brace in the file. A model call to judge sameness is excluded from this slice by the owner | 0020 |
| D6 | **Statuses and their exact rules.** For a run N of repository R, against the open set after the previous runs of R (D3): a finding of N with a match in the open set is **`open`** (carries the first id and the first head); without one it is **`new`**. An open finding T absent from N is **`probably-fixed`** when N's `coverage.reviewed` contains T's path (rename-followed) and the cited region changed, that is, T's line hash does not occur in that file at N's head (for a `line: 0` finding: the file's blob `sha` in N's `files` differs from the one recorded with T); **`not-repeated`** when N reviewed the file and the region did not change; and stays **`unknown`** (still open, unsettled) when N did not review the file: not in `coverage.reviewed` because of a scope, an exclude, a skip, a quota stop, or because the file is no longer in the change; it also stays **`unknown`** when T's last-seen head is not an ancestor of (or equal to) N's head, because the key has no branch and a review of branch B says nothing about a finding seen on branch A (checked with `git merge-base --is-ancestor`; a commit git cannot resolve counts as not an ancestor). A `probably-fixed` or `not-repeated` finding that matches again in a later run is **`open`** again, with a `reopened` count | Owner's decision 4: "probably fixed" only when the cited region changed and the finding is absent in a later run that covered the file; partial coverage marks nothing fixed. SARIF's `baselineState: absent` and Sonar's "no match means Fixed" both infer a fix from absence; both gate it on the same scope, which is why `coverage.reviewed` is the gate here. `not-repeated` is the honest name for a reviewer that stopped mentioning unchanged code; it is also the number that measures the reviewer's consistency | 0020 |
| D7 | **The developer's verdict reuses the precision vocabulary:** `agent-review history --verdict <id> correct\|wrong\|partial [--reason <text>]`, appended to `verdicts.jsonl` with a timestamp; the listing shows it and counts `correct`, `partial`, `wrong`, `unjudged` the way `src/precision.ts` does. A verdict is keyed by the finding's first id and applies to every later match. In this slice | Owner's question: it is what makes "was the reviewer right" measurable locally. Reusing `docs/precision.md`'s words keeps a local count comparable with the GitHub one. A `--reject` flag would be a second vocabulary for the same judgement. Cost: one command, one append-only file, one column in the listing | 0020 |
| D8 | **Retention: 30 days by default,** `AGENT_REVIEW_HISTORY_DAYS=<n>` to change it, `0` to keep forever. Pruning runs at every save, for the repository being written, and deletes run files older than the limit and the verdicts whose first id no longer resolves. `agent-review history --forget [--repo-dir <dir>] \| --all` deletes on request | Owner's proposal. Pruning at save time means a repository never reviewed again keeps its files until `--forget`, which the guide says; the alternative (prune every repository at every save) deletes data of a repository the developer did not touch, which is a surprise | 0020 |
| D9 | **The report shows the status when the history is on.** Terminal and Markdown label each finding `new` or `open since <sha7>` with its id, and add a "Since the last run" block that lists what this run settled (`probably-fixed`, `not-repeated`) and how many stay `unknown`. The JSON sink writes the `ReviewResult` unchanged; stderr gets a `This run (history):` list (label, location, title, id per finding) and then the same block | The value is in the report the developer is already reading. `--format json` on stdout "is the result alone" (`docs/cli.md`, *verified*), so the status cannot go there without a format change; stderr keeps that promise | 0020 |
| D10 | **`agent-review history [--repo-dir <dir>] [--since <n>d] [--all-repos] [--json]`** lists, per repository, every tracked finding with its status, first and last head, run count, verdict; `--json` prints the replayed state. It needs no clone and no `claude`: it reads files and local git metadata only (the key comes from `git rev-parse` and `git remote get-url` in `--repo-dir`) | The listing is the "what did Wachiman find this month and what did I fix" answer; a read-only command that works without the clone means the history can be read after the branch is gone | 0020 |
| D11 | **The history file format is internal and versioned:** `wachiman.history-run/1`. A file with another version, or one that does not parse, is moved aside as `<name>.unreadable-<unix-seconds>` with one warning and skipped; it is never overwritten or deleted silently. No JSON Schema is published for it | The hub's local-store rules (version from day one; move aside, never overwrite; log every move). A public schema would be a compatibility promise for a file that only this engine reads; the embedded `ReviewResult` already has one | 0020 |
| D12 | **GitHub mode never reads or writes the history**, by construction: `review()` never constructs the history store, and the store module is imported by `src/local.ts` and the `history` command only | GitHub has its own state (the marker, the threads, ADR 0011); a runner's home is discarded; and a history on CI would duplicate what the pull request already shows | 0020 |

## Open questions

Each with options, the strongest argument against the recommendation, and the recommendation.

1. **Should a `--history` run also skip files it already reviewed at the same blob (a local
   incremental review)?**
   - (a) No: a local run reviews the whole range every time (ADR 0019, "no memory between runs"),
     and the history only labels.
   - (b) Yes: files whose blob `sha` equals the one at the last run, with no finding open on them,
     are left out of the batches, which saves most of the second run's cost.
   - Against (a): on a 60-file branch the second run costs as much as the first, and the
     developer who turned the history on would expect the tool to use it.
   - **Recommendation: (a) for this slice.** (b) changes what the model is asked (the batch lists
     and the "files in this change" sentence), so it breaks prompt parity with GitHub mode (ADR
     0019 validation level b) and needs its own design, the local counterpart of ADR 0011. The
     status labels are useful without it. Named as the reopen condition of ADR 0020.

2. **Should a run at the same head as the previous run replace it or add a second file?**
   - (a) Add a second file: every run is a fact; two runs at one head are two samples of the
     reviewer's consistency.
   - (b) Replace: one file per head, the latest wins, the directory stays small.
   - Against (a): a developer who re-runs after a `stop: quota` gets two files for one commit,
     and the listing's "run count" inflates.
   - **Recommendation: (a).** The second sample is exactly the data that shows a finding that
     comes and goes on unchanged code (`not-repeated` at the same head). The listing shows the
     head once with its run count. Retention bounds the directory.

3. **Where does the `--verdict` reason go, and is it ever used by the engine?**
   - (a) Stored and listed only; the engine never reads verdicts to change a review.
   - (b) Verdicts feed the review: a `wrong` verdict suppresses the finding in later runs of
     the same repository.
   - Against (a): the developer who marked a finding `wrong` sees it again at every run.
   - **Recommendation: (a).** (b) is learned memory, which ADR 0007 decides is proposed as a
     reviewable pull request on the repository, not hidden state on a laptop; a suppressed finding
     also hides from the `not-repeated` and `probably-fixed` counts. The listing shows a repeated
     `wrong` as `open · verdict: wrong`, which is the useful signal (a persistent false positive).

4. **Should the history ever be readable by the benchmark harness?**
   - (a) No, by construction: no export, and the harness never reads `~/.wachiman`.
   - (b) An explicit `history --export <file>` the developer runs by hand, for a repository they
     own.
   - Against (a): on the owner's own repositories the local runs are benchmark data going to
     waste.
   - **Recommendation: (a) in this slice**, per decision 2. `--format json --output` already
     gives a developer the result of a run they want to keep elsewhere; adding an export to the
     history command makes the promise harder to state. Reopen if the owner wants local runs of
     an owned repository in the benchmarks.

## Out of scope

- A model call to decide whether two findings are the same (owner: deterministic only).
- Any change to the public formats: `wachiman.review-result/1` gains no field; the history file
  wraps it.
- A local incremental review that skips files or lines based on the history (open question 1).
- Suppressing findings from verdicts (open question 3; ADR 0007's territory).
- Export, sync between machines, a shared team history, anything that leaves the laptop.
- GitHub mode (D12), the working tree (`--working-tree` is its own next slice, ADR 0019
  decision 8), host API connectors.
- Matching across repositories, or a finding that moved between files (a function extracted
  into another module is a `probably-fixed` in the old file and a `new` in the other).
- A GUI or a web page over the history; `history --json` is the seam for one.

## Failures this must protect against

- **The history is written when the developer did not ask.** D1: no flag and no variable means
  no `open`, `mkdir` or `stat` under `~/.wachiman/history`. A test runs `local` without the flag
  on a temporary `HOME` and asserts the directory does not exist afterwards.
- **Employer code in a world-readable file.** D2: the directory is created 0700 and every file is
  written 0600 (`openSync` with mode, then `renameSync` from a temporary name in the same
  directory). A test reads the modes back.
- **A finding is called fixed because the file was not looked at.** D6's gate on
  `coverage.reviewed`: a scoped run (`local src/`), an exclude, a skip, a `stop: quota` and a file
  that left the change all leave the finding `unknown`. Each is a test case.
- **A moved line is reported as new, or a fixed line as still open.** D5's line hash is of the
  line's text, not its number; a shifted file keeps the status `open`. A changed cited line with
  the same title keeps `open` by tier (b); a changed line and a different title is `probably-fixed`
  plus a `new`, which is the honest reading.
- **A common line matches the wrong finding.** D5's uniqueness and length rule: the hash is only
  computed for a line that is at least 8 non-whitespace characters and occurs once in the file.
- **A credential in the remote URL reaches the disk.** D4 strips `user:password@` before hashing
  and before recording the URL; a test uses `https://me:ghp_x@github.com/o/r.git`.
- **An unreadable or newer file breaks every later run.** D11: moved aside with a warning, never
  deleted or overwritten.
- **A crash during a save leaves a half file that the replay then trusts.** D3: write to
  `<name>.tmp` in the same directory, `fsync`, `rename`; a file without the final `}` is moved
  aside by D11 on the next read.
- **GitHub mode starts writing to `~`.** D12: `review()` has no path to the store; a test in
  `src/engine.fake.test.ts` or `src/cli.test.ts` runs a GitHub-mode review with a temporary `HOME`
  and asserts `~/.wachiman` was not created.
- **The run file holds the snapshot path.** `ReviewResult.change.snapshot` is the temporary
  directory of the run (*verified*: `snapshot?: string` in `src/formats.ts`); it is useless after
  the run and leaks nothing but a `/tmp` name. It is kept as is: the result is stored unchanged.

## Acceptance criteria

Checkable predicates; **all are met** by the implementing PR.

- [x] `agent-review local` without `--history` and without `AGENT_REVIEW_HISTORY=1` never creates
  or reads `~/.wachiman/history` (test: temporary `HOME`, the directory is absent after the run,
  and a pre-existing history directory's mtime is unchanged).
- [x] With `--history`, a run writes exactly one file
  `~/.wachiman/history/<repo-key>/runs/<utc-timestamp>-<sha7>.json`, mode 0600, under
  directories of mode 0700, whose `result` deep-equals the `ReviewResult` the JSON sink prints
  for the same run and whose `format` is `wachiman.history-run/1`.
- [x] The repository key is `<basename>-<hash8>` from the credential-stripped `origin` URL, and
  from the common git directory's real path when there is no `origin`; two clones of one remote
  share a key; the recorded `remote` never contains `@`-delimited credentials.
- [x] `titleKey` and `lineHash` are pure functions with the exact rules of D5, proved by a table
  test (whitespace, backticks, digit runs, a duplicated line, a 7-character line, `line: 0`).
- [x] The status rules of D6 hold on a table of two-run scenarios built from temporary
  repositories and the stub `claude` of `src/local.test.ts`: unchanged (open), line moved (open),
  file renamed (open), title reworded with the same line (open), line edited and finding absent
  (probably-fixed), line unchanged and finding absent (not-repeated), scoped run that excludes the
  file (unknown), `stop: quota` before the file's batch (unknown), file left the change (unknown),
  `line: 0` with a changed blob (probably-fixed), reopened after probably-fixed (open, `reopened: 1`).
- [x] The terminal and Markdown reports of a `--history` run label each finding `new` or
  `open since <sha7>` with its id and carry the "Since the last run" block; `--format json` on
  stdout is byte-identical with and without `--history` for the same stubbed run; stderr gets
  this run's labels and ids, then the block.
- [x] `agent-review history --repo-dir <dir>` lists every tracked finding of that repository with
  status, first head, last head, run count and verdict; `--all-repos` lists every key; `--since 7d`
  keeps findings seen in the last 7 days; `--json` prints the replayed state; exit 0; a missing
  history prints one line and exits 0.
- [x] `agent-review history --verdict <id> wrong --reason "..."` appends one line to
  `verdicts.jsonl` (mode 0600) and the next listing shows `verdict: wrong`; an id that resolves to
  no finding exits 2; the counts line matches `precision.ts`'s four words.
- [x] `agent-review history --forget --repo-dir <dir>` removes that key's directory;
  `--forget --all` removes `~/.wachiman/history`; both print what they removed; neither touches
  `~/.wachiman/claude-*`.
- [x] A save with `AGENT_REVIEW_HISTORY_DAYS=30` deletes run files of that repository whose
  timestamp is older than 30 days and the verdicts whose first id no longer resolves; `0` deletes
  nothing; a non-integer is a usage error (exit 2) before any call.
- [x] A run file that is not JSON, or has another `format`, is renamed `<name>.unreadable-<unix-seconds>`
  with one warning on stderr, and the run proceeds.
- [x] A GitHub-mode review with a temporary `HOME` creates nothing under it.
- [x] `docs/local-review.md`'s promise reads "no transcript is kept on disk, and no history unless
  you turn it on", with a section that says what the history holds, where, who can read it, and
  how to delete it; `docs/cli.md` documents `--history`, `history` and the exit codes;
  `docs/configuration.md` lists the two variables under "Local mode"; `docs/architecture.md`'s
  invariants gain "the history is written only with `--history` or `AGENT_REVIEW_HISTORY=1`, only
  by `local` and `history`, never by GitHub mode".

## Detail

### What the code gives the design today (verified on `f70f3d4`)

| Fact | Where | Consequence |
| --- | --- | --- |
| `runLocal` holds the snapshot (`input.headDir`) until its `finally` | `src/local.ts` | The line hash is computed from the snapshot right after `reviewChange` returns, before `removeSnapshot`; the history module receives `headDir` and never needs the clone for the cited line |
| `ReviewFile` carries `sha` (head blob) and `previous_filename` (a `-M` rename) | `src/engine.ts`, `localFiles` in `src/connectors/local-git.ts` | The `line: 0` rule uses `sha`; rename following uses `previous_filename` of the later run's files |
| `coverage.reviewed` lists the files a returned review covered; `skipped` holds closed reasons and "not reached" | `src/formats.ts`, the schema | D6's gate; a `stop: quota` leaves the unreached files in `skipped` |
| Findings are deduplicated by `path:line:topic` | `dedupeFindings`, `src/engine.ts` | Two findings of one run never share path, line and topic, so a run's tracking ids are unique once the title key is added |
| `ResultFinding` allows unknown fields (`additionalProperties: true`) | the schema | The history could annotate findings in place, but D3 keeps the result untouched and puts tracking beside it, so the stored result still validates with no extra field |
| `~/.wachiman/claude-<name>` is created 0700 by `setupProfile` | `src/profiles.ts` | `~/.wachiman` exists with the right mode on a machine with an isolated profile; the store creates it the same way when absent |
| The terminal sink prints `location  label` then the indented body; Markdown prints `### label`, the location, the body, then `Verified:` | `src/sinks/terminal.ts`, `markdown.ts` | The status and id go on the label line (terminal) and as one line under the location (Markdown), mirroring `Verified:` |
| `--format json` on stdout is the result alone | `docs/cli.md`, `src/local.ts` | D9: nothing is added to stdout in JSON mode |
| `src/precision.ts` reads `correct`, `partial`, `wrong`, `unjudged` | `docs/precision.md` | D7 reuses the words; the local count is built the same way |

### The run file

```jsonc
{
  "format": "wachiman.history-run/1",
  "savedAt": "2026-11-05T14:03:22.000Z",
  "engine": { "version": "1.7.0" },
  "repository": {
    "key": "kaipu-record-3f9a1c2e",
    "name": "kaipu-record",
    "keyedBy": "remote",                       // or "path"
    "remote": "https://github.com/niway-dev/kaipu-record",   // credentials stripped; absent when keyed by path
    "path": "/Users/me/src/kaipu-record"       // the common git directory's parent at save time
  },
  "result": { "format": "wachiman.review-result/1", "...": "the ReviewResult, unchanged" },
  "tracking": [                                // one per result.findings[i], same order
    {
      "id": "a1b2c3d4e5",                      // sha256(key, head sha, path, line, topic, titleKey), 10 hex
      "status": "new",                         // or "open"
      "firstId": "a1b2c3d4e5",                 // the id of the first sighting; equals id when new
      "firstHead": "5d6e7f8…",                 // full sha of the first sighting
      "runs": 1,                               // sightings so far, this one included
      "reopened": 0,
      "titleKey": "off by one in the loop over items",
      "lineHash": "9c1f…",                     // absent for line 0, a short line, or a duplicated line
      "lineText": "returnitems[i+1];",         // the stripped line itself, so a later run can look for it
      "blobSha": "e3b0…",                      // files[].sha of the finding's file at this head
      "matchedBy": "line"                      // "line" | "title" | absent when new
    }
  ],
  "settled": [                                 // earlier open findings this run decided about
    { "firstId": "0f0e0d0c0b", "status": "probably-fixed", "path": "src/a.ts", "title": "…", "lastHead": "1a2b3c4…" },
    { "firstId": "77aa88bb99", "status": "not-repeated", "path": "src/b.ts", "title": "…", "lastHead": "1a2b3c4…" }
  ],
  "unknown": 3,                               // open findings whose file this run did not review
  "unknownIds": ["…"]                          // their first ids, so a replay can mark them unknown
}
```

Reports and the listing show a finding's **first id** (stable across runs), which is also what
`--verdict` takes; the per-run `id` stays in the file. A tracked finding's state between runs is
`open`, `probably-fixed`, `not-repeated` or `unknown` (`new` is only the label a run gives its own
sightings). A file counts as reviewed only when it is in both `coverage.reviewed` and
`coverage.expected`; a finding with no line hash is compared by its file's blob `sha`.

`verdicts.jsonl`, one JSON object per line: `{ "at": "…", "firstId": "…", "verdict": "wrong",
"reason": "…" }`. The last line for a `firstId` wins.

### Matching, step by step

Inputs: the replayed open set of the repository (every tracked finding whose last status is
`new`, `open` or `unknown`, plus the `probably-fixed` and `not-repeated` ones so they can reopen),
the new `ReviewResult`, its `files` (for `previous_filename` and `sha`), and `headDir`.

1. For each finding of the new result, compute `titleKey`, `lineHash` (from
   `<headDir>/<path>` at `line`, under the uniqueness and length rule) and `blobSha`.
2. Build the rename map from the new input's files: `previous_filename → filename`.
3. For each new finding, in result order, look for a tracked finding with the same path (after
   mapping the tracked path through the rename map) and a `lineHash` equal to the new one, with
   any topic (tier a); failing that, the same topic and the same `titleKey` (tier b). A tier a
   match that changes topic stays under its first id, and the run stores the latest topic. Tier a runs over every new
   finding before tier b starts over the ones left, so a title match never takes a tracked
   finding that a later finding matches by line. The first match in
   first-seen order wins and is removed from the candidate pool, so one old finding cannot
   satisfy two new ones. A match that was `probably-fixed` or `not-repeated` becomes `open`
   with `reopened + 1`.
4. Every tracked finding left in the pool: if its last-seen head is not an ancestor of (or equal
   to) this run's head, count it under `unknown` (another branch); else if its (rename-mapped) path is in
   `coverage.reviewed`, compute whether the region changed (its `lineHash` is not found in the
   file at `headDir`; for a `line: 0` finding, the new `files[].sha` differs from its `blobSha`;
   a file absent from the snapshot counts as changed) and settle it `probably-fixed` or
   `not-repeated`; otherwise count it under `unknown`.
5. Write the run file; prune by D8.

The replay for `history` applies the same transitions from the files in `savedAt` order, so the
listing and the report agree by construction.

### The report, with the history on

Terminal, one finding:

```text
src/a.ts:12  🟠 Fix · bug (confidence high)  open since 5d6e7f8 · 3 runs · id a1b2c3d4e5
    The loop reads items[i + 1] on the last element.
```

The block after the findings:

```text
Since the last run (1a2b3c4, 2026-11-04 18:02):
  probably fixed  src/b.ts:40  Unchecked cast of the response  (id 0f0e0d0c0b)
  not repeated    src/c.ts:7   Missing await on save            (id 77aa88bb99)
  unknown         2 finding(s) in files this run did not review (run without paths to settle them)
```

Markdown: the same facts as a line under the location (`History: open since \`5d6e7f8\`, 3
runs, id \`a1b2c3d4e5\``) and a `## Since the last run` section before the summary.

### The `history` listing

```text
kaipu-record-3f9a1c2e  /Users/me/src/kaipu-record  (4 runs, 2026-10-28 → 2026-11-05)
  status          first    last     runs  id          finding
  open            5d6e7f8  9a8b7c6  3     a1b2c3d4e5  src/a.ts:12  Fix · bug  Off-by-one in the loop over items
  probably-fixed  5d6e7f8  1a2b3c4  2     0f0e0d0c0b  src/b.ts:40  Fix · bug  Unchecked cast of the response
  not-repeated    1a2b3c4  1a2b3c4  1     77aa88bb99  src/c.ts:7   Consider · tests  Missing await on save   verdict: wrong
  unknown         5d6e7f8  5d6e7f8  1     …
verdicts: 1 correct, 0 partial, 1 wrong, 5 unjudged
```

### How other tools track a finding across runs

Fetched on 2026-11-05 by a Haiku research agent; each line links what was read. What is marked
*unverified* was not read in full.

- **SARIF 2.1.0** ([spec](https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/sarif-v2.1.0-os.html)):
  a result may carry `partialFingerprints` and `fingerprints` (§3.27.17, §3.27.16; their full
  definitions were not read, so the hashing guidance is *unverified*). `baselineState` (§3.27.24)
  takes `new` (not in the baseline run), `unchanged`, `updated` (in both, changed in a way the tool
  finds significant) and `absent` (in the baseline, not in this run). D6's `new`/`open` map onto
  `new`/`unchanged`; `probably-fixed` and `not-repeated` split SARIF's `absent` by whether the code
  changed, which SARIF leaves to the tool.
- **GitHub code scanning** ([SARIF support](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning),
  [about alerts](https://docs.github.com/en/code-security/code-scanning/managing-code-scanning-alerts/about-code-scanning-alerts)):
  results are matched across runs by `partialFingerprints`, of which only
  `primaryLocationLineHash` is used, and the `ruleId` must stay the same; the pages do not say
  what the hash contains. Alerts are open, closed or dismissed, per branch; "you can fix the
  problem in the code, or you can dismiss the alert". D5's `topic` is the `ruleId` analogue;
  D7's verdict is the dismissal with a reason.
- **SonarQube** ([process steps](https://docs.sonarsource.com/sonarqube-server/discovering/analysis-overview/process-steps)):
  the line hash is "calculated based on the content of the first line the issue is reported on,
  excluding the white spaces"; matching tries same rule and line hash, then same rule, line number
  and message, then same rule with the block moved; no match means Fixed, a match of a Fixed
  issue reopens it. D5's tier (a) is Sonar's first rule; tier (b) replaces "line number and
  message" with the title key because a model's line numbers drift; block-move matching is not
  needed since tier (a) already ignores the line number.
- **Semgrep `--baseline-commit`** ([CLI reference](https://docs.semgrep.dev/cli-reference),
  [remove duplicates](https://docs.semgrep.dev/semgrep-code/remove-duplicates)): "only show
  results that are not found in this commit hash"; the finding id hashes the file path, the rule
  name and the rule pattern with metavariable values substituted, so a moved match keeps its id;
  the page says the calculation "is subject to change at any time". That is the reason D11
  versions the history format: a change to D5's hash rule is a `/2`.

Takeaways applied: every tool infers "fixed" from absence in a later run of the same scope, never
from observation, so D6 names it `probably-fixed` and gates it on `coverage.reviewed`; every tool
hashes content, not line numbers, so moved code keeps its identity; none publishes the hash as a
stable contract, so Wachiman keeps the file format internal and versioned.
