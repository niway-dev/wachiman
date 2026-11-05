# Plan: an opt-in local review history that tracks findings across runs

- **Goal.** `agent-review local --history` (or `AGENT_REVIEW_HISTORY=1`) saves each run's result
  on the developer's laptop and labels every finding `new` or `open since <sha7>`, settling the
  earlier ones as `probably-fixed`, `not-repeated` or `unknown`; `agent-review history` lists a
  repository's tracked findings with their status and the developer's verdicts; nothing leaves the
  machine; off means nothing is read or written.
- **Spec.** [2026-11-05-local-review-history-design.md](../specs/2026-11-05-local-review-history-design.md):
  D1–D12, open questions 1–4 (all answered by their recommendations unless the owner says
  otherwise), "The run file", "Matching, step by step", "The report, with the history on", "The
  `history` listing", and every acceptance criterion.
- **ADR.** [0020](../adr/0020-an-opt-in-on-laptop-review-history-with-deterministic-finding-tracking.md)
  decisions 1–9.
- **Issue.** [#103](https://github.com/niway-dev/wachiman/issues/103).
- **Branch.** `feat/local-history` from `main` (which holds the merged local mode, #111 and
  #112). Work in a worktree:
  `git -C <main checkout> worktree add .claude/worktrees/local-history-impl -b feat/local-history origin/main`.
  Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. A hook blocks
  commits in the main checkout: always `git -C <worktree>`.
- **Release.** A minor release (`feat` commits).
- **Working document.** The PR links this file; the shipping commit deletes it.
- **Reader.** A Sonnet or Opus implementer with no memory of the design conversation. Read the
  spec's one-minute block and "Matching, step by step" first, then `src/local.ts`,
  `src/formats.ts`, `src/sinks/terminal.ts`, `src/sinks/markdown.ts`, `src/local.test.ts` (the
  `stubs()` and `local()` helpers) and `test/support/temp-repo.ts` (`branchRepo`, `commit`,
  `git`). Every test name below is the exact string to use.

## What this PR does NOT do

- No model call to decide whether two findings are the same (owner's rule): `src/history/` never
  imports a provider.
- No change to the public formats: `wachiman.review-result/1` gains no field; `src/formats.ts`
  and `docs/formats/` are untouched. The golden-prompt tests must not change.
- No skipping of files or lines based on the history (spec open question 1): a `--history` run
  sends the same prompts as a run without it. A test proves it.
- No suppression of findings from verdicts (open question 3).
- No export, sync, or benchmark hook (D2, open question 4).
- Nothing in GitHub mode: `review()` and `src/engine.ts` are untouched.
- No working-tree review, no host connectors.

## Baseline (recorded 2026-11-05 on `main` at `f70f3d4`)

`bun test`: **700 pass, 8 skip, 1 fail, 709 tests across 32 files** (41 s). The one failure is
pre-existing: `test/support/golden-prompts.ts` reports "engine.fake: 79 prompts recorded, fixture
has 78" (the golden count in `src/engine.fake.test.ts`), reproduced alone with
`bun test src/engine.fake.test.ts` (76 pass, 1 fail). It is not this PR's to fix; record it in
the PR body, and "green" below means every test except that known one passes and no new failure
appears. If `main` fixes it before this PR starts, re-record the numbers here.

## Decisions made in this plan (one-line reason each)

1. **Module layout.** `src/history/fingerprint.ts` (pure: `titleKey`, `lineHashOf`,
   `findingId`), `src/history/store.ts` (paths, key, read, write, prune, forget, verdicts),
   `src/history/match.ts` (pure: `reconcile`, `replay`), `src/history/command.ts` (the `history`
   command and its listing), and `src/history/index.ts` re-exporting what `local.ts` and `cli.ts`
   need. Reason: the pure parts get table tests with no filesystem; the store is the only module
   that touches `~`.
2. **Settings are read in `src/history/store.ts`, not in `loadConfig`.** `historySettings(env,
   args)` returns `{ enabled, days }`; `AGENT_REVIEW_HISTORY_DAYS` accepts `0` and a non-negative
   integer, anything else is a `UsageError`. Reason: `loadConfig`'s `number()` rejects `0`
   (*verified*, `value <= 0`), and GitHub mode must not even see the variable.
3. **The save happens inside `runLocal`'s `try`, after `reviewChange` and before the report is
   rendered,** so the sinks receive the annotation and the snapshot still exists. On `Ctrl-C`
   (`state.interrupted`) nothing is saved. Reason: spec "What the code gives the design today".
4. **Timestamps.** `savedAt` is `new Date().toISOString()`; the file name is that string with
   `:` and `.` replaced by `-`, plus `-<sha7>.json`. An injectable `now()` keeps the tests
   deterministic. Reason: a file name must sort by time on every filesystem.
5. **The id.** `findingId(key, headSha, path, line, topic, titleKey)` is the first 10 hex of
   SHA-256 over those six joined by `\n`. Reason: short enough to type after `--verdict`, unique
   within a run because `dedupeFindings` already keeps one finding per `path:line:topic`.
6. **The line hash** reads `<headDir>/<path>` as UTF-8, splits on `\n`, takes line `line` (1-based),
   strips every whitespace character (`/\s/g`), and returns `undefined` when the file or line is
   missing, the stripped text is shorter than 8 characters, or the same stripped text occurs on
   more than one line of the file; else SHA-256 hex. "Region changed" for a tracked finding is
   `!fileLines.some((l) => strip(l) === strippedOriginal)`, which needs the original stripped text:
   store it as `lineText` beside `lineHash` (it is one line of code the finding body already
   quotes). Reason: a hash cannot be searched for; the stripped line can.
7. **Rename following** uses only the later run's `files[].previous_filename`: a tracked path `p`
   is mapped to `f.filename` when `f.previous_filename === p`. Chains across more than one run
   are followed because each run stores the mapped path in its own records. Reason: the data the
   connector already gives (*verified*, `localFiles`).
8. **Candidate order.** Tracked findings are offered to new findings in first-seen order
   (`firstHead` run order, then result order), and a match removes the candidate. Reason: a
   deterministic, stated rule beats a best-score rule nobody can predict.
9. **The listing's columns** are fixed-width plain text; `--json` is the replayed state
   (`{ format: "wachiman.history-state/1", repositories: [...] }`). Reason: readable in a
   terminal, scriptable with `jq`.
10. **`--forget` asks nothing.** It prints what it removed; there is no confirmation prompt.
    Reason: the CLI is non-interactive everywhere else; the developer typed the word.
11. **Unreadable files** are detected on read (`JSON.parse` fails, `format` is not
    `wachiman.history-run/1`, or `result.format` is not `wachiman.review-result/1`) and renamed
    with `renameSync` to `<name>.unreadable-<unix-seconds>`; one `warn` line per file. Reason: the
    hub's local-store rule 6.

## Task 0: the branch and the baseline

- [ ] Create the worktree and branch as above; `bun test 2>&1 | tail -5` and compare with the
  baseline; note any difference in the PR body.
- [ ] Commit nothing yet.

## Task 1: fingerprints (`src/history/fingerprint.ts`)

- [ ] Create `src/history/fingerprint.test.ts` with `describe("titleKey")`:
  - `test("lowercases, drops backticks and punctuation, collapses whitespace")`:
    ``titleKey("Off-by-one in `items[i + 1]`:  the last element")`` is
    `"off by one in items i # the last element"` — note: `-` and `+` are punctuation (removed, the
    gap collapses), `[`/`]` removed, `1` becomes `#`.
  - `test("every digit run becomes one #")`: `titleKey("Line 120 reads 3 bytes")` is
    `"line # reads # bytes"`.
  - `test("is stable under reordering of whitespace only")`: `titleKey("a  b\tc")` equals
    `titleKey("a b c")`.
- [ ] `describe("lineHashOf")`, with a temporary directory and a file written by the test:
  - `test("hashes the cited line without whitespace")`: file `"const a = 1;\n  return items[i + 1];\n"`,
    `lineHashOf(dir, "f.ts", 2)` equals `{ hash: sha256hex("returnitems[i+1];"), text: "returnitems[i+1];" }`
    (compute the expected with `node:crypto` in the test).
  - `test("undefined for line 0, a missing file, a missing line")`.
  - `test("undefined for a line under 8 characters once stripped")`: `"  }\n"`, `"return;"`.
  - `test("undefined for a line that occurs more than once in the file")`: two identical
    `return null;` lines, both `undefined`.
- [ ] `describe("findingId")`: `test("ten hex digits, stable, and different for a different line")`.
- [ ] `bun test src/history/fingerprint.test.ts` → **expected failure** (module missing).
- [ ] Implement:

  ```ts
  export function titleKey(title: string): string
  export function lineHashOf(headDir: string, path: string, line: number): { hash: string; text: string } | undefined
  export function findingId(key: string, headSha: string, path: string, line: number, topic: string, titleKey: string): string
  export const stripWhitespace = (s: string) => s.replace(/\s+/g, "");
  ```

  `titleKey`: lowercase; remove `` ` ``; replace `/\d+/g` with `#`; replace every character that
  is not `[a-z0-9#]` with a space; collapse `/\s+/g` to one space; trim. Use `createHash("sha256")`
  from `node:crypto`.
- [ ] `bun test` → green. Commit: `feat(history): deterministic fingerprints for findings`.

## Task 2: the store (`src/history/store.ts`)

- [ ] Create `src/history/store.test.ts` (temporary `HOME` per test via `mkdtempSync`; clean up in
  `afterAll`):
  - `describe("historySettings")`: `test("off by default, on with --history or AGENT_REVIEW_HISTORY=1")`;
    `test("days defaults to 30, accepts 0, refuses a non-integer or a negative")` (`"x"`, `"-1"`,
    `"1.5"` throw `UsageError` whose message names `AGENT_REVIEW_HISTORY_DAYS`).
  - `describe("repositoryKey")`, on repositories from `test/support/temp-repo.ts` (`emptyRepo`,
    `git(dir, "remote", "add", "origin", url)`):
    - `test("basename plus 8 hex of the normalised origin URL, credentials stripped")`:
      `https://me:ghp_x@GitHub.com/o/r.git/` and `https://github.com/o/r` give the same key, the
      returned `remote` is `https://github.com/o/r`, and the key starts with `r-`.
    - `test("ssh and alias remotes are normalised to host and path")`: `git@github-csdev:o/r.git`
      and `ssh://git@github-csdev/o/r.git` give the same key (normalise `git@host:path` to
      `ssh://git@host/path`, then lowercase the host, strip the user part, strip `.git` and `/`).
      Note: an SSH alias host is not the same as `github.com`; do not try to resolve it.
    - `test("without origin, the common git directory's real path keys it")`: `keyedBy: "path"`,
      no `remote`; a worktree of the same repository (`git worktree add`) gives the same key.
  - `describe("writeRun / readRuns")`:
    - `test("creates the directories 0700 and the file 0600, atomically")`: after `writeRun`, no
      `*.tmp` remains, `statSync(dir).mode & 0o777` is `0o700` for `~/.wachiman`,
      `~/.wachiman/history`, `<key>` and `<key>/runs`; the file is `0o600`; `readRuns` returns
      it with `format: "wachiman.history-run/1"`.
    - `test("runs come back in savedAt order")`: three writes with injected `now()` values out of
      order on disk (write the later one first).
    - `test("an unreadable file is moved aside with a warning and the rest is read")`: a file with
      `not json`, one with `format: "wachiman.history-run/2"`; both renamed
      `*.unreadable-<digits>`, two `warn` lines, the good file still read.
  - `describe("prune")`: `test("deletes runs older than the limit and the verdicts that no longer resolve")`
    (days 30, one run at `now - 31d`, one at `now - 1d`, two verdicts); `test("0 keeps everything")`.
  - `describe("verdicts")`: `test("appends one JSON line, 0600, and the last line for an id wins")`.
  - `describe("forget")`: `test("removes one key's directory, or the whole history, and never a claude-* profile")`
    (create `~/.wachiman/claude-isolated/` first and assert it survives both).
- [ ] `bun test src/history/store.test.ts` → **expected failure**.
- [ ] Implement:

  ```ts
  export const HISTORY_RUN_FORMAT = "wachiman.history-run/1";
  export interface HistorySettings { enabled: boolean; days: number }
  export function historySettings(env: Record<string, string | undefined>, flag: boolean): HistorySettings
  export function historyRoot(home: string): string            // <home>/.wachiman/history
  export function repositoryKey(repoDir: string, git?: GitRunner): { key: string; name: string; keyedBy: "remote" | "path"; remote?: string; path: string }
  export interface HistoryRun { format: typeof HISTORY_RUN_FORMAT; savedAt: string; engine: { version: string }; repository: …; result: ReviewResult; tracking: Tracking[]; settled: Settled[]; unknown: number }
  export function writeRun(root: string, run: HistoryRun): string   // returns the path
  export function readRuns(root: string, key: string, warn: (l: string) => void): HistoryRun[]
  export function listKeys(root: string): string[]
  export function prune(root: string, key: string, days: number, now: () => Date): { runs: string[]; verdicts: number }
  export function appendVerdict(root: string, key: string, v: VerdictLine): void
  export function readVerdicts(root: string, key: string): Map<string, VerdictLine>
  export function forget(root: string, key?: string): string[]     // what was removed
  ```

  Use `spawnGit` from `src/evidence.ts` for `git remote get-url origin` and
  `git rev-parse --git-common-dir`; `realpathSync` the latter. Write with
  `openSync(tmp, "w", 0o600)`, `writeSync`, `fsyncSync`, `closeSync`, `renameSync`. Create
  directories with `mkdirSync(p, { recursive: true, mode: 0o700 })` then `chmodSync(p, 0o700)`
  (the `umask` can widen a mode given to `mkdirSync`; `src/profiles.ts` does the same,
  *verified*). The `Tracking`, `Settled` and `VerdictLine` types follow the spec's "The run file".
- [ ] `bun test` → green. Commit: `feat(history): an on-laptop store of local review runs`.

## Task 3: matching and replay (`src/history/match.ts`)

- [ ] Create `src/history/match.test.ts`. Build inputs by hand (no git, no files): a
  `TrackedFinding[]` open set, a `ReviewResult` with `findings`, `coverage.reviewed` and
  `change.head.sha`, a `files: ReviewFile[]`, and a `regionChanged(path, tracked) => boolean`
  callback injected so the pure module never reads the disk. `describe("reconcile")`, one test per
  spec scenario, each asserting the `tracking` of every new finding and the `settled` list exactly:
  - `test("a finding with no match is new")`.
  - `test("the same line text at another line number is open, matched by line")` (`matchedBy: "line"`,
    `runs: 2`, `firstHead` unchanged).
  - `test("a renamed file keeps its findings open")` (files carry `previous_filename`).
  - `test("a reworded title on the same line is open, matched by line")`.
  - `test("the same title on an edited line is open, matched by title")`.
  - `test("absent, file reviewed, region changed: probably-fixed")`.
  - `test("absent, file reviewed, region unchanged: not-repeated")`.
  - `test("absent, file not in coverage.reviewed: unknown, counted")` (scope, skip and quota are
    all "not in reviewed"; one test with the file in `coverage.skipped` and one with it absent
    from `expected` entirely).
  - `test("a line-0 finding matches by title only and is probably-fixed when the blob changed")`.
  - `test("a settled finding that matches again is open with reopened 1")`.
  - `test("one old finding satisfies at most one new finding")` (two new findings with the same
    title key on the same path and topic, one tracked: the first is `open`, the second `new`).
  - `test("severity and confidence are not identity")`.
- [ ] `describe("replay")`: `test("replays three runs and a verdict into the state the listing shows")`,
  with `runs: HistoryRun[]` built from `reconcile`'s outputs and one verdict; assert each
  tracked finding's `status`, `firstHead`, `lastHead`, `runs`, `verdict`, and the counts
  `{ correct, partial, wrong, unjudged }`.
- [ ] `bun test src/history/match.test.ts` → **expected failure**.
- [ ] Implement:

  ```ts
  export type Status = "new" | "open" | "probably-fixed" | "not-repeated" | "unknown";
  export interface TrackedFinding { firstId: string; firstHead: string; path: string; line: number; topic: Topic; severity: Severity; title: string; titleKey: string; lineHash?: string; lineText?: string; blobSha?: string; status: Status; lastHead: string; lastSeenAt: string; runs: number; reopened: number }
  export function reconcile(p: { open: TrackedFinding[]; result: ReviewResult; files: ReviewFile[]; key: string; fingerprint: (f: ResultFinding) => { titleKey: string; lineHash?: string; lineText?: string; blobSha?: string }; regionChanged: (path: string, t: TrackedFinding) => boolean }): { tracking: Tracking[]; settled: Settled[]; unknown: number }
  export function replay(runs: HistoryRun[], verdicts: Map<string, VerdictLine>): { findings: (TrackedFinding & { verdict?: VerdictLine })[]; counts: { correct: number; partial: number; wrong: number; unjudged: number } }
  ```

  Follow the spec's "Matching, step by step" literally; the rename map is
  `new Map(files.filter(f => f.previous_filename).map(f => [f.previous_filename!, f.filename]))`.
- [ ] `bun test` → green. Commit: `feat(history): match findings across runs and replay the state`.

## Task 4: `local --history` (D1, D6, D8, D9)

- [ ] Tests in `src/local.test.ts`, new `describe("--history")`, using the existing `local()`
  helper (it already gives a temporary `HOME`, the stub `claude` and a `branchRepo`):
  - `test("without the flag, nothing under ~/.wachiman is created or read")`: run `local("ok")`;
    `existsSync(join(home, ".wachiman"))` is false. Then create `<home>/.wachiman/history/x/runs/`
    with one valid run file, run again without the flag, and assert the file's `mtimeMs` and the
    directory listing are unchanged and the report carries no `id ` and no "Since the last run".
  - `test("--history saves one run file, 0600, whose result is the JSON sink's output")`: run with
    `["--history"]`; find the one file under `<home>/.wachiman/history/*/runs/`; `mode & 0o777`
    is `0o600`; `JSON.parse(file).result` deep-equals `JSON.parse` of a second run's `--format json`
    stdout minus `change.snapshot`, `execution.durationMs` and `engine.version`-independent
    fields (compare `findings`, `coverage`, `summary`, `change.head`).
  - `test("AGENT_REVIEW_HISTORY=1 is the same switch")`.
  - `test("the prompts are byte-identical with and without --history")`: compare `read("prompt")`
    of two runs (same stub, same repo).
  - `test("--format json on stdout is unchanged with --history, and the block goes to stderr")`.
  - `test("a second run labels the finding open since the first head, with its id")`: run twice
    with `--history` on the same repo; the second terminal report contains
    `open since ${sha7(repo.head)}` and `id ` followed by 10 hex; the first contains `new`.
  - `test("a finding absent after its line changed is probably-fixed; unchanged, not-repeated")`:
    use a second stub variant whose `OK_RESULT` has no findings (add `"none"` to `Variant`, same
    script, `findings: []`). Run A (`ok`, `--history`), then `commit(repo.dir, { "src/a.ts": <A_HEAD with line 2 edited> }, "fix")`
    and run B (`none`, `--history`): stderr/report says `probably fixed  src/a.ts:2`. Repeat on a
    fresh repo without the edit: `not repeated`.
  - `test("a scoped run and a quota stop leave the finding unknown")`: run A `ok`, then run B
    `none` with the path `src/b.ts` only → `unknown 1`; and run B with variant `quota` → `unknown 1`,
    no `probably fixed`.
  - `test("AGENT_REVIEW_HISTORY_DAYS prunes old runs at save time, and a bad value exits 2 before any call")`:
    plant a run file whose `savedAt` is 40 days ago; run with `--history`; it is gone and the new
    one exists. With `AGENT_REVIEW_HISTORY_DAYS=x`: exit 2, `calls()` empty.
  - `test("Ctrl-C saves nothing")`: variant `interrupt` with `--history`; no file under `runs/`.
- [ ] Tests in `src/sinks/sinks.test.ts`: `test("the history annotation labels each finding and adds the since-the-last-run block")`
  for `renderTerminal` and `renderMarkdown` with an `opts.history` object built by hand (two
  findings, one `new`, one `open since`; one `probably-fixed`, one `not-repeated`, `unknown: 2`);
  assert the exact lines of the spec's "The report, with the history on". `renderJson` takes no
  option and is untouched.
- [ ] `bun test src/local.test.ts src/sinks/sinks.test.ts` → **expected failure**.
- [ ] Implement:
  - `src/local.ts`: `LocalArgs.history: boolean`, parsed from `--history` (no value); in
    `runLocal`, `const settings = historySettings(env, args.history)` right after the provider
    check (so a bad `AGENT_REVIEW_HISTORY_DAYS` exits 2 before `preflight`); after `reviewChange`
    and the `state.interrupted` check, when `settings.enabled`:
    `const annotation = saveRun({ root: historyRoot(env.HOME), repoDir, input, result, engineVersion, days, warn: io.stderr })`
    (a new function in `src/history/index.ts` that does: `repositoryKey`, `readRuns`,
    `readVerdicts`, `replay` → open set, `reconcile` with `fingerprint` from `lineHashOf(input.headDir, …)`
    and `regionChanged` reading `<headDir>/<path>`, `writeRun`, `prune`, and returns the
    `HistoryAnnotation` the sinks take). Pass `history: annotation` to `renderTerminal` and
    `renderMarkdown`; for `json`, write `sinceLastRunText(annotation)` to `io.stderr`.
  - `src/sinks/common.ts`: `export interface HistoryAnnotation { byIndex: Map<number, { status: "new" | "open"; firstHead: string; runs: number; id: string; verdict?: string }>; settled: Settled[]; unknown: number; lastRun?: { head: string; savedAt: string } }`,
    `historyLabel(a)` (`new · id …` or `open since <sha7> · <n> runs · id …`, plus ` · verdict: <v>`
    when present) and `sinceLastRunText(a)`.
  - `src/sinks/terminal.ts` and `markdown.ts`: an optional `history?: HistoryAnnotation` in `opts`;
    the label line gains two spaces and `historyLabel`; the block goes after the findings and
    before "Not reviewed" (terminal) and as `## Since the last run` before `## Summary` (Markdown).
  - `localUsage` and the `USAGE` text in `src/cli.ts` mention `--history`.
- [ ] `bun test` → green. Commit: `feat(local): --history saves the run and labels findings against earlier runs`.

## Task 5: the `history` command (D7, D8, D10)

- [ ] Tests in a new `src/history/command.test.ts`, through the CLI (`Bun.spawnSync` of
  `src/cli.ts` as `src/cli.test.ts`'s `run()` does, with `HOME` set to a temporary directory
  seeded by `writeRun` with runs built by `reconcile` in the test):
  - `test("lists a repository's findings with status, heads, runs, id and verdict")`: exact
    column header and one row per finding as in the spec's listing; exit 0.
  - `test("--repo-dir resolves the key from the clone; --all-repos lists every key")`.
  - `test("--since 7d keeps findings seen in the last 7 days")`.
  - `test("--json prints the replayed state")`: `JSON.parse(stdout).format` is
    `"wachiman.history-state/1"`.
  - `test("no history prints one line and exits 0")`.
  - `test("--verdict appends a line and the listing shows it; an unknown id exits 2")`: run
    `history --verdict <id> wrong --reason "x" --repo-dir <dir>`; `verdicts.jsonl` has one line,
    mode `0o600`; the listing's row ends with `verdict: wrong` and the counts line reads
    `verdicts: 0 correct, 0 partial, 1 wrong, N unjudged`; `--verdict zzzzzzzzzz correct` exits 2
    with a message naming the id; `--verdict <id> maybe` exits 2 naming the three words.
  - `test("--forget removes one repository or everything, and never a profile")`.
  - `test("history never runs claude and never calls gh")`: stub both on `PATH` with scripts that
    leave a canary; neither canary exists after a listing.
- [ ] `bun test src/history/command.test.ts` → **expected failure**.
- [ ] Implement `src/history/command.ts`: `historyUsage`, `parseHistoryArgs(argv)`
  (`--repo-dir` is extracted by `extractRepoDir` in `cli.ts` as for `local`; options `--since <n>d`,
  `--all-repos`, `--json`, `--forget`, `--all`, `--verdict <id> <word>`, `--reason <text>`; a
  usage error for an unknown option, for `--all` without `--forget`, for `--since` not matching
  `/^\d+d$/`), and `runHistory(args, repoDir, env, io): number`. Wire `mode === "history"` in
  `src/cli.ts`'s `main` before the pull-request commands, next to `local`, and add it to `USAGE`.
  Resolve the key with `repositoryKey(repoDir)` unless `--all-repos` or `--forget --all`.
- [ ] `bun test` → green. Commit: `feat(cli): agent-review history lists, judges and forgets local runs`.

## Task 6: GitHub mode stays out (D12)

- [ ] Test in `src/cli.test.ts`: `test("a GitHub-mode review with a temporary HOME creates nothing under it")`:
  reuse the stub-binary pattern of "a missing agent binary is an engine error" or the fake-`gh`
  path of `src/engine.fake.test.ts` (whichever already runs `review` end to end through the CLI);
  set `HOME` to a fresh `mkdtempSync` directory and `AGENT_REVIEW_HISTORY=1`; after the run
  `readdirSync(home)` is empty. The point: the variable is ignored outside `local`.
- [ ] `grep -rn "history" src/engine.ts src/cli.ts` shows only the `history` command dispatch in
  `cli.ts` and nothing in `engine.ts`. Record the grep output in the PR body.
- [ ] `bun test` → green. Commit: `test(cli): GitHub mode never touches the local history`.

## Task 7: documentation and the status lines

- [ ] `docs/local-review.md`: the promise block becomes "… your code is sent to your configured
  Claude account for the review. No transcript is kept on disk, and no history unless you turn it
  on." The employer request text gains the same clause. A new section "Keep a history of your
  runs (optional)" after section 5: what `--history` saves (`~/.wachiman/history/<name>-<hash>/runs/…`,
  the full result including the finding text that quotes code, mode 0600), what the statuses mean
  and why "fixed" says "probably", `history`, `--verdict`, `--forget`, retention, and that nothing
  is exported. Section 6's "No memory between runs" becomes "No memory between runs unless
  `--history`: the history labels, it never changes what is reviewed". Section 8 gains the row
  for an unreadable run file.
- [ ] `docs/cli.md`: `--history` in the `local` table; a `### history` subsection with its options
  and exit codes (`0` listed or nothing to list, `2` usage error, including an unknown verdict
  id); the `USAGE` lines.
- [ ] `docs/configuration.md` "Local mode": `AGENT_REVIEW_HISTORY` and `AGENT_REVIEW_HISTORY_DAYS`
  under **Apply**, and a sentence that GitHub mode ignores both.
- [ ] `docs/architecture.md`: in "The review core and its ports", one paragraph on where the
  history sits (after the core, beside the sinks, local only); in "Invariants a change must
  keep": "The history under `~/.wachiman/history` is written only with `--history` or
  `AGENT_REVIEW_HISTORY=1`, only by `local` and `history`, never by GitHub mode, and never leaves
  the machine."
- [ ] `docs/formats/README.md`: one sentence that a history run file embeds a
  `wachiman.review-result/1` under `result`, and that the wrapper format is internal.
- [ ] ADR 0020 status → "accepted 2026-…; implemented by #<this PR>"; the spec's status line says
  which criteria the PR met and ticks them; `docs/specs/2026-11-03-local-review-design.md`'s "Out
  of scope" bullet on local memory gains "(the history of ADR 0020 labels findings; it still
  reviews the whole range)".
- [ ] Delete this plan file in the final commit. Commit: `docs: the local review history, and
  remove its plan`.

## Task 8: verification before the PR leaves draft

- [ ] `bun test 2>&1 | tail -5`: the baseline's counts plus every new test, with only the
  pre-existing golden failure (or none, if `main` fixed it).
- [ ] A real run on this repository with the owner's signed-in `claude`, twice on one branch
  with a one-line fix in between: record in the PR body the two commands, the labels printed, the
  `history` listing, and the file modes (`ls -la ~/.wachiman/history/*/runs`). Then
  `history --forget --repo-dir .` and confirm the directory is gone.
- [ ] Open the PR against `main` titled `feat: an opt-in local review history that tracks findings across runs`,
  body: summary, the decisions used from the spec, the baseline note, the grep of Task 6, the
  real-run record, "Refs #103", links to the spec and ADR 0020, ending with
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
