# Plan: local review on the developer's own subscription (PR "L")

- **Goal.** `agent-review local` reviews the committed branch of a clone on the developer's own
  signed-in `claude`, with nothing posted, no GitHub call, no API key and no telemetry, and prints
  the review in the terminal or writes it as Markdown or JSON. Built on PR E's core: a
  `local-git` source connector, an `auth: "subscription"` mode of the Claude Code adapter, two
  profiles (`default`, `isolated`), three sinks, parity tests at levels (a) and (b), the user
  guide, and the owner's level (c) run.
- **Spec.** [2026-11-03-local-review-design.md](../specs/2026-11-03-local-review-design.md):
  D4–D14, D17, decided questions Q2, Q5, Q7, Q9 and open question 4 (profiles), "The `local-git`
  connector", "The result format", "The local mode of the adapter", "Validation, in order", "The
  user guide", acceptance criteria tagged **(L)** and **(G)**, "Refactor order" steps 2 and 3.
- **ADR.** [0019](../adr/0019-a-review-core-behind-source-and-sink-ports-and-a-local-subscription-mode.md)
  decisions 2, 3, 4, 5, 6, 7, 8, 9.
- **Issue.** [#103](https://github.com/niway-dev/wachiman/issues/103).
- **Branch.** `feat/local-review`, stacked on `feat/review-core` (PR E). Base for the PR:
  `feat/review-core`; re-target to `main` once E merges. Every reference to `reviewChange`,
  `ReviewInput`, `ReviewResult`, `CoreDeps`, `ReviewOptions`, `githubReviewInput` and
  `githubReview` means the names PR E introduces
  ([2026-11-04-review-core-extraction.md](2026-11-04-review-core-extraction.md)); read that plan
  first, and start this one only after E's Task 8 is done on the branch below.
- **Worktree.** `/Users/cristiansotomayor-m5-pro/Documents/Workspace/Personal/wachiman/.claude/worktrees/review-core`
  on branch `feat/local-review` (`git -C <worktree> switch feat/local-review`). Commits end with
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- **Release.** A minor release (`feat` commits). The guide's claims wait for the owner's level (c)
  run (Task 11); the PR stays draft until that task is recorded.
- **Working document.** The PR links this file; the shipping commit deletes it.

## What this PR does NOT do

- No `--working-tree`, `--staged` or untracked files: committed `merge-base(base, HEAD) → HEAD`
  only (D6). Next slice, separate spec.
- No host API connector (GitLab, Bitbucket, Gitea) and no posting anywhere.
- No incremental local reviews, threads, memory or ceiling (all GitHub-side state).
- No change to what the model is asked: `RULES`, `FLOW_QUESTIONS`, the data-path questions,
  `SCHEMA` and the "no diff from GitHub" notice stay; level (b) parity is the proof.
- No `--safe-mode` (the populated-profile harness showed it adds nothing), no Docker, no `--bare`.
- No Codex in local mode: `AGENT_REVIEW_PROVIDER=codex` with `local` is a usage error.
- No `--model`/`--effort` flags: `AGENT_REVIEW_MODEL` and `AGENT_REVIEW_EFFORT` as today (D5);
  `--tier` arrives with ADR 0017 (#90), not here.
- No plugin sentinel in the isolation harness (still open in the spec); the guide says so.
- No type checker (the repository has none; CI runs `bun test`).

## Baseline

PR E's final suite on `feat/review-core` (record the numbers here when starting:
`bun test 2>&1 | tail -5`). Every task below ends with `bun test` green, including E's golden
test, which must not change in this PR except where Task 9 says.

## Spec corrections (against the code on `ae19404` plus PR E)

1. **A `git archive` snapshot is not a repository, and the evidence step runs `git grep` in the
   head.** `collectEvidence` (`src/evidence.ts`) runs `git grep` with `repoDir` as its working
   directory; in a plain directory it fails with "not a git repository", every batch logs
   "Call-site evidence skipped", the prompt loses its `<evidence>` section, and level (b) parity
   fails wherever the GitHub side has evidence. Decision: after extracting the archive the
   connector runs `git init -q` and `git add -A -f` in the snapshot (an index, no commit, no
   identity needed), so `git grep` sees exactly the archived files; the `ls-tree` comparison of
   Q5 then compares `git ls-tree -r --name-only <head>` with `git ls-files` in the snapshot.
   Rejected: `git worktree add --detach` (registers the snapshot in the developer's repository; a
   crash leaves a worktree to prune), and `git grep --no-index` (would change the evidence code
   path that GitHub mode runs).
2. **Level (c)'s target.** The spec names kaipu-record #479 at `aac7202`; that pull request has
   65 files and its posted review was not a full first review. The 2026-11-04 smoke test used
   #386 at `8c32901` (6 files, 195 lines, merged, posted CI review was a full first review with
   three findings). Decision: #386 at `8c32901` is the level (c) run; #479 is optional and only
   after #386 passes the kill condition.
3. **`stop: "quota"` should reuse #109's classification, not new text patterns.** The spec
   predates `src/providers/errors.ts`. A subscription's "usage limit" message is already
   `billing`; "Not logged in · Please run /login" (the probe's exact text) matches nothing and
   would be `other`, which throws. Decision: add `/not logged in/i` and `/please run \/login/i`
   to the `auth` patterns; the core's `stop` mapping from PR E then gives `quota` for a usage
   limit and `error` with `rejection.kind: "auth"` for a missing sign-in, which is what the spec
   asks for ("`stop: quota`'s sibling, `error`, and Claude Code's own message").
4. **The Claude Code version on the owner's machine is 2.1.311** (`claude --version` on
   2026-11-04), while the spec's probes say 2.1.318. The guide names the version the level (c)
   run actually used, read from `claude --version` on that day, not the spec's number.
5. **The spec's `--setup-profile <name>` and `--profile isolated` do not say which directory
   `isolated` uses.** Decision below (item 2).

## Decisions made in this plan (decided in plan; one-line reason each)

1. **The subscription child environment** is `buildChildEnv(env, { auth: "subscription", configDir })`:
   the allowlist minus `ANTHROPIC_API_KEY`, plus `USER` (D17), plus the six D10 variables set to
   `"1"`, plus `CLAUDE_CONFIG_DIR` forced to `configDir` when given (the isolated profile) and
   otherwise passed through as today. API-key mode is untouched. Reason: CI parity; the local
   environment is a different, explicit list.
2. **Profile naming.** `--profile default` (the default) or `--profile isolated[:<name>]`, where a
   bare `isolated` means the name `isolated`; `--setup-profile [<name>]` defaults to `isolated`
   too. The directory is `~/.wachiman/claude-<name>`; names match `/^[a-z0-9][a-z0-9-]{0,31}$/`.
   Reason: one default name means the common case needs no name at all, and the spec's
   `claude-<name>` layout stays.
3. **An isolated profile is refused when it holds anything but a sign-in**: `CLAUDE.md`,
   `hooks/`, `skills/`, `agents/`, `commands/`, `.mcp.json`, a `settings.json` with a `hooks`
   key or a non-empty `mcpServers`, or a `.claude.json` with a non-empty `mcpServers`. Wachiman
   lists the names and exits 2; it never reads `.credentials.json`, `.claude.json`'s `oauthAccount`,
   or the keychain. Reason: the word "isolated" must stay true; `--restricted` and
   `--strict-mcp-config` already neutralise these (harness of 2026-11-04), so this is a belt, not
   the braces.
4. **`provider.profile`.** `"ci"` whenever the adapter runs in API-key mode (GitHub mode, dry
   run included); `"default"` or `"isolated"` in local mode per `--profile`. Reason: the profile
   is about which sign-in and whose customisations; a dry run on a laptop with a key is the CI
   path.
5. **The snapshot** is `git archive --format=tar <head>` written with `--output` into a
   `mkdtemp("wachiman-snapshot-")` directory and extracted with the system `tar -xf`, then
   initialised as in spec correction 1. Differences between `ls-tree` and `ls-files` are a
   warning that lists up to 10 paths and names the usual cause (`export-ignore` in
   `.gitattributes`, submodules); the run continues. Reason: Q5 (owner); warn, not refuse, as the
   spec says.
6. **Per-file patches** come from one `git diff -M --inter-hunk-context=1 <merge-base> <head>`
   split on `^diff --git ` lines; a file's `patch` is everything from its first `@@` line to the
   end of its section, with the trailing newline removed (GitHub's shape); a section without an
   `@@` line (binary, 100 % rename, mode-only change) has no `patch`. Counts from `--numstat`
   (`-` becomes 0), `sha` and the rename's `previous_filename` from `--raw` (`-M` on both).
   Reason: D7 and the research probe's 1,397-file parity.
7. **`change.describe`** is ``branch `<head ref>` of <dir name> against <base ref> (merge-base <sha7>)``,
   `title` the head ref, `description` the commit subjects of `<merge-base>..<head>` joined by
   newlines, `author` the `%an` of the head commit. Reason: spec step 6; `pr.json` always exists.
8. **Exit codes of `local`.** 0 when a report was produced (complete or partial, `stop: quota`
   included); 1 when no call produced output (auth, unclassified error, every batch failed) after
   printing the reason; 2 for usage errors, `ANTHROPIC_API_KEY` set, a refused profile, no
   merge-base, detached or unborn `HEAD`, an unknown `--input` format. Reason: a partial report is
   a result, not a failure; the guide says what each code means.
9. **`Ctrl-C`.** `local` installs a `SIGINT` handler that removes the snapshot and the run
   directory and exits 130; the child `claude` receives the signal with the process group. Reason:
   company code must not stay in `/tmp` after an interrupted run.
10. **Terminal output** prints the "prompt for your agent" block only with `--agent-prompt`;
    Markdown always ends with it; JSON never (it is derivable). Reason: the spec says "on request"
    for the terminal.
11. **`--input` validation at runtime** is the format constant plus the presence and types of the
    required top-level fields (`change.describe`, `change.head.sha`, `change.base.sha`, `files`,
    `instructions`, `scope`); full schema validation stays test-side. Reason: no dependency, and
    the core already tolerates optional fields.
12. **Level (b) uses the connector's snapshot as the head directory on both sides.** Reason: the
    test is about the inputs the connectors build; the same `headDir` removes evidence-path
    noise. A separate connector test proves `git grep` works in a snapshot.
13. **Force-full-review flag.** `AGENT_REVIEW_FULL_REVIEW=1` is honoured only together with
    `AGENT_REVIEW_DRY_RUN=1`; set without a dry run it is a usage error. In `review()` it makes
    `last` null (the marker is not read), so the run is a full first review printed, not posted.
    Reason: cheap (one config field, one line), and it is what the 2026-11-04 smoke test had to
    patch by hand.
14. **The `local` command runs the pipeline with `trigger` unset** (a person ran it), the ceiling
    does not apply, `totalBudgetUsd = config.budgetUsd` (default $3, an API-equivalent
    estimate), `batchBudgetUsd` as today. Reason: D12 keeps the estimate guard; work limits bound
    the run.

## File map

| File | Change |
| --- | --- |
| `src/providers/claude-code.ts` | `auth` and `configDir` options; `buildChildEnv(env, opts)`; `SUBSCRIPTION_ENV`; `buildClaudeArgs({ sessionPersistence })`; preflight refusal |
| `src/providers/claude-code.test.ts` | subscription env, args, preflight, stub-binary child env |
| `src/providers/errors.ts`, `errors.test.ts` | two `auth` patterns |
| `src/providers/index.ts` | `getProvider(name, { auth?, configDir? })` passthrough |
| `src/profiles.ts`, `src/profiles.test.ts` | new: `profileDir`, `parseProfile`, `inspectIsolatedProfile`, `setupProfile` |
| `src/connectors/local-git.ts`, `src/connectors/local-git.test.ts` | new: `resolveRefs`, `snapshotHead`, `localFiles`, `splitPatches`, `localInstructions`, `localChange`, `buildLocalInput`, `removeSnapshot` |
| `src/engine.ts` | `instructionFileOf(path, bytes)` extracted from `fileAtBase`; `ReviewFile` rename of `PrFile` (Q8); `review()` reads `config.fullReview` |
| `src/sinks/agent-prompt.ts`, `terminal.ts`, `markdown.ts`, `json.ts`, `src/sinks/sinks.test.ts` | new |
| `src/local.ts`, `src/local.test.ts` | new: `parseLocalArgs`, `runLocal`, `localUsage` |
| `src/cli.ts`, `src/cli.test.ts` | `local` and `--setup-profile`; `GH_TOKEN`/`GITHUB_REPOSITORY` not required for them; USAGE |
| `src/config.ts`, `src/config.test.ts` | `fullReview` |
| `scripts/record-pr-fixture.ts` | new: writes a parity fixture from `gh` |
| `test/fixtures/parity/pr-88.json` (+ one more) | new |
| `test/parity.test.ts` | new: level (b) always (skips without the commits), level (a) with `WACHI_PARITY=1` |
| `.github/workflows/ci.yml` | `fetch-depth: 0` so level (b) runs in CI |
| `docs/local-review.md` | new: the guide |
| `docs/cli.md`, `docs/configuration.md`, `docs/providers/claude-code.md`, `docs/architecture.md`, `docs/formats/README.md`, `README.md` | entries |
| `docs/adr/0019-…md`, `docs/specs/2026-11-03-local-review-design.md` | status |

## Tasks

Conventions: tests that create git repositories pass
`-c user.name=t -c user.email=t@example.com` on every `git commit` (the owner's global git has
`user.useConfigOnly`), use `mkdtempSync` under `tmpdir()` and remove it in `afterAll`. Shell
stubs for `claude` and `gh` are written by the test with `writeFileSync` + `chmodSync(0o755)`
into a temp `bin/` directory placed first on `PATH`, the pattern of
`src/providers/claude-code.test.ts` ("ClaudeCodeProvider with a stub binary") and
`src/cli.test.ts` (`run()`).

### Task 1: the subscription mode of the Claude Code adapter (D4, D10, D17)

- [ ] Tests in `src/providers/claude-code.test.ts`, new `describe("subscription mode")`:
  - `test("the child environment drops the API key, adds USER and the no-telemetry switches")`:
    `buildChildEnv({ PATH: "/p", HOME: "/h", USER: "me", ANTHROPIC_API_KEY: "sk-ant-x", ANTHROPIC_BASE_URL: "http://x", GH_TOKEN: "t", CLAUDE_CONFIG_DIR: "/c" }, { auth: "subscription" })`
    equals exactly `{ PATH: "/p", HOME: "/h", USER: "me", CLAUDE_CONFIG_DIR: "/c", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1", DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1", CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: "1" }`
    (`toEqual`, so an extra name fails).
  - `test("a configDir forces CLAUDE_CONFIG_DIR even when the parent has another one")`:
    with `configDir: "/iso"` the child has `CLAUDE_CONFIG_DIR: "/iso"`.
  - `test("api-key mode is unchanged")`: `buildChildEnv(env)` equals today's result for the same
    input (keep the existing test; add one assertion that `USER` is absent in api-key mode).
  - `test("subscription args carry --no-session-persistence and nothing else new")`:
    `buildClaudeArgs({ …, sessionPersistence: false })` contains it; without the option it does not;
    every other flag is in both (compare the arrays minus the one flag).
  - `test("preflight refuses to start when ANTHROPIC_API_KEY is set in subscription mode")`:
    with a stub binary, `new ClaudeCodeProvider({ model, requireApiKey: false, auth: "subscription", binary })`,
    `process.env.ANTHROPIC_API_KEY = "sk-ant-test"` (restore after), `preflight()` throws
    `UsageError` whose message is exactly
    `ANTHROPIC_API_KEY is set. The local review runs on your signed-in \`claude\`; unset the variable, or run the GitHub mode.`
    and the stub was **not** run (the `--version` probe comes after the check: a key must not
    start anything).
  - `test("the spawned child in subscription mode sees USER and the switches and none of the key names")`:
    reuse the stub binary of "the spawned child sees none of the poisoned variables" (it prints
    its environment); run with `auth: "subscription"`; assert `USER`, the six switches and
    `--no-session-persistence` in the args, and none of `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`,
    `GH_TOKEN`, `GITHUB_TOKEN`, `HTTPS_PROXY`.
  - `test("leaksSecret in subscription mode keeps the key-shape check")`.
- [ ] Run `bun test src/providers/claude-code.test.ts` → **expected failure** (unknown option,
  missing names).
- [ ] Implement in `src/providers/claude-code.ts`:

  ```ts
  export type ClaudeAuth = "api-key" | "subscription";
  /** D10: set in every local call; what each one switches off is in docs/providers/claude-code.md. */
  export const SUBSCRIPTION_ENV = {
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1",
    DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1",
    CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: "1",
  } as const;
  export function buildChildEnv(env, opts: { auth?: ClaudeAuth; configDir?: string } = {}) { … }
  ```

  Subscription: skip `ANTHROPIC_API_KEY`, add `USER` when set, spread `SUBSCRIPTION_ENV`, then
  `if (opts.configDir) child.CLAUDE_CONFIG_DIR = opts.configDir`. `buildClaudeArgs` gains
  `sessionPersistence?: boolean` (default true) and emits `--no-session-persistence` when false.
  The constructor gains `auth?: ClaudeAuth` (default `"api-key"`) and `configDir?: string`;
  `preflight()` checks the key refusal first in subscription mode (throw `UsageError` from
  `../config`); `run()` and the `--version` probe use the new env builder; `modelLabel()`
  unchanged. `getProvider(name, options)` passes `auth` and `configDir` through (Codex ignores
  them; `local` refuses Codex anyway).
- [ ] `src/providers/errors.ts`: add `/not logged in/i` and `/please run \/login/i` to `auth`;
  `errors.test.ts`: `classifyProviderError("Not logged in · Please run /login")` is `"auth"`.
- [ ] Docs: `docs/providers/claude-code.md` "The child environment" gets a second table "In local
  mode (`auth: "subscription"`)" with the differences and a sentence that the OAuth token is never
  read, only found by the binary through `HOME`, `USER` and `CLAUDE_CONFIG_DIR`.
- [ ] `bun test` → green. Commit: `feat(providers): a subscription mode for the Claude Code adapter`.

### Task 2: profiles under `~/.wachiman` (open question 4)

- [ ] Create `src/profiles.test.ts`:
  - `parseProfile("default")` → `{ kind: "default" }`; `parseProfile("isolated")` → `{ kind: "isolated", name: "isolated" }`;
    `parseProfile("isolated:work")` → `{ kind: "isolated", name: "work" }`; `parseProfile("Work")`,
    `parseProfile("isolated:")`, `parseProfile("isolated:../x")` throw `UsageError`.
  - `profileDir("work", "/home/me")` is `/home/me/.wachiman/claude-work`.
  - `inspectIsolatedProfile(dir)`: an empty directory → `[]`; a directory with `CLAUDE.md`,
    `hooks/`, `skills/`, `agents/`, `commands/`, `.mcp.json` → six names; `settings.json` with
    `{"hooks":{}}` → `["settings.json (hooks)"]`; `settings.json` with `{"mcpServers":{"a":{}}}`
    → `["settings.json (mcpServers)"]`; `.claude.json` with `{"mcpServers":{"a":{}}}` →
    `[".claude.json (mcpServers)"]`; `.credentials.json` present → `[]` and the test asserts the
    function never opened it (wrap `readFileSync` through an injected `read` and record the paths).
  - `setupProfile({ name: "work", home, env: { CLAUDE_CONFIG_DIR: "/elsewhere", PATH, HOME, USER }, spawn })`
    with a recording `spawn`: creates `<home>/.wachiman/claude-work` with mode `0o700`, calls
    `spawn("claude", [], { cwd: <an empty mkdtemp dir>, env, stdio: "inherit" })` where `env`
    has `CLAUDE_CONFIG_DIR: <home>/.wachiman/claude-work` (not `/elsewhere`), the six switches,
    `USER`, no `ANTHROPIC_API_KEY`; removes the empty cwd afterwards; returns the lines it
    printed (before: what to do — `/login`, then `/exit`; after: "Wachiman did not check whether
    the sign-in succeeded; run `agent-review local --profile isolated:work` to find out").
  - `setupProfile` with a populated directory → throws `UsageError` listing the names (it refuses
    to launch).
- [ ] Run → **expected failure** (module missing).
- [ ] Implement `src/profiles.ts` with those five exports. `setupProfile` builds the environment
  with `buildChildEnv(env, { auth: "subscription", configDir })` from the adapter, which is why a
  `claude` shell function cannot override `CLAUDE_CONFIG_DIR`: the binary is spawned directly,
  no shell. The default `spawn` is `spawnSync` with `stdio: "inherit"`.
- [ ] `bun test` → green. Commit: `feat(local): isolated Claude profiles under ~/.wachiman`.

### Task 3: the `local-git` connector (D6, D7, D8, D14, Q5)

- [ ] First, in `src/engine.ts`: extract `instructionFileOf(path: string, bytes: Buffer): InstructionFile`
  from `fileAtBase` (the `MAX_INSTRUCTION_BYTES` cut with the `�` trim) and make
  `fileAtBase` call it; export `spawnGit` from `src/evidence.ts` if it is not exported (it is:
  `export const spawnGit`). Run the fake files → golden unchanged.
- [ ] Create `src/connectors/local-git.test.ts` with a helper `repo()` that builds a temp
  repository: `main` with `CLAUDE.md` ("RULES-FROM-BASE"), `src/a.ts` (3 lines), `img.png`
  (bytes `89 50 4E 47 00 01`), `src/old.ts`; a branch `feat/x` that edits `src/a.ts`, adds
  `src/b.ts`, renames `src/old.ts` → `src/new.ts` unchanged, changes `img.png`, edits
  `CLAUDE.md` ("RULES-FROM-HEAD"), and a later commit on `main` after the branch point (so the
  merge-base is not the tip of `main`). Checked out at `feat/x`.
  - `test("resolves the base, the merge-base and the head ref")`: `resolveRefs(dir, undefined)`
    gives `{ baseRef: "main", baseSha, mergeBase, headRef: "feat/x", headSha }` where
    `mergeBase` is the branch point, not `main`'s tip; with `origin/HEAD` pointing at `main` (make
    a bare clone and `git remote set-head origin main`) the default base is `origin/main`; with
    neither, a `UsageError` names `--base`.
  - `test("refuses a detached HEAD, an unborn HEAD and a base with no merge-base")` (three repos;
    the last has `--orphan`).
  - `test("the file list matches git: counts, patches, renames, binary")`: `localFiles(dir, mergeBase, headSha)`
    equals `[{ filename: "CLAUDE.md", additions: 1, deletions: 1, patch: <from git diff>, sha }, { filename: "img.png", additions: 0, deletions: 0, sha }, { filename: "src/a.ts", … }, { filename: "src/b.ts", … }, { filename: "src/new.ts", additions: 0, deletions: 0, previous_filename: "src/old.ts", sha }]`
    sorted by `filename` (GitHub's order); `img.png` and `src/new.ts` have no `patch` key at all
    (`"patch" in f` is false). For the files with a patch, assert it equals the output of
    `git diff -M --inter-hunk-context=1 <mb> <head> -- <file>` from the first `@@` line, trailing
    newline removed (computed in the test, so the split is checked against git itself).
  - `test("a patch keeps the no-newline marker and ends without a newline")` (a file without a
    final newline).
  - `test("instructions come from the merge-base, never the head")`: `localInstructions(dir, mergeBase, warn)`
    has `CLAUDE.md` with "RULES-FROM-BASE" and `baseSha === mergeBase`; the old focus path is read
    with the deprecation warning; a 70 KB file is cut with the warning (reuse the wording of
    `readBaseInstructions`).
  - `test("the snapshot holds the committed head, not the working tree, and git grep works in it")`:
    edit `src/a.ts` in the working tree without committing; `snapshotHead(dir, headSha)` → the
    snapshot's `src/a.ts` has the committed content; `spawnGit(["grep", "-n", "-F", "-e", "<a line>", "--", "*.ts"], { cwd: snapshot.dir, timeoutMs: 5000 })`
    has `status 0` and finds it; `snapshot.missing` and `snapshot.extra` are empty.
  - `test("export-ignore makes the snapshot differ from ls-tree, and that is a warning")`: add
    `.gitattributes` with `secret.txt export-ignore` and a committed `secret.txt`;
    `snapshot.missing` is `["secret.txt"]`; `buildLocalInput` passes it to `warn` as
    `The snapshot lacks 1 file(s) that the head commit has (export-ignore in .gitattributes, or a submodule): secret.txt`.
  - `test("buildLocalInput: the change, the scope and the cleanup")`: `buildLocalInput({ repoDir: dir, base: undefined, paths: ["src"], warn, log })`
    returns `{ input, snapshotDir }` with `input.format`, `change.kind === "branch"`,
    `change.describe === "branch \`feat/x\` of <basename(dir)> against main (merge-base <sha7>)"`,
    `change.title === "feat/x"`, `change.description` = the branch's commit subjects, newest last,
    `change.author === "t"`, `change.base.sha === mergeBase`, `change.base.ref === "main"`,
    `change.head.ref === "feat/x"`, `change.identifier` undefined, `input.scope` `["src"]` (a
    word that matches nothing is dropped with a log line, as `resolveScope` does),
    `input.headDir === snapshotDir`, no `since`, no `conversation`; `removeSnapshot(snapshotDir)`
    deletes it. The input validates against `docs/formats/review-input.v1.schema.json` once
    `headDir` is removed (use `test/support/json-schema.ts`).
- [ ] Run → **expected failure**. Implement `src/connectors/local-git.ts`:

  ```ts
  export interface LocalRefs { baseRef: string; baseSha: string; mergeBase: string; headRef: string; headSha: string }
  export function resolveRefs(repoDir: string, base: string | undefined, git = spawnGit): LocalRefs
  export function localFiles(repoDir: string, mergeBase: string, head: string, git = spawnGit): ReviewFile[]
  /** Splits one `git diff -M --inter-hunk-context=1` output per file: GitHub's `patch` shape. */
  export function splitPatches(diff: string): Map<string, string | undefined>
  export function localInstructions(repoDir: string, mergeBase: string, warn, git = spawnGit): BaseInstructions
  export function snapshotHead(repoDir: string, head: string, git = spawnGit): { dir: string; missing: string[]; extra: string[] }
  export function removeSnapshot(dir: string): void
  export function buildLocalInput(p: { repoDir: string; base?: string; paths: string[]; log; warn; git? }): { input: ReviewInput; snapshotDir: string; refs: LocalRefs }
  ```

  `resolveRefs`: `git symbolic-ref -q --short HEAD` (empty → detached → `UsageError`
  "HEAD is detached; check out a branch, or pass --input"); `git rev-parse --verify -q HEAD`
  (fails → unborn); base default: `git symbolic-ref -q --short refs/remotes/origin/HEAD` →
  `origin/<x>`, else `main` if `git rev-parse --verify -q main` succeeds, else `UsageError`
  "No base branch found; pass --base <ref>"; `git merge-base <base> HEAD` (fails → `UsageError`
  "`<base>` and HEAD have no common ancestor"). No fetch, ever.
  `localFiles`: three `git diff -M --inter-hunk-context=1` calls (`--numstat`, `--raw`, plain)
  over `<mergeBase> <head>`; every name from `core.quotepath=off` (already in `spawnGit`); build
  the records per decision 6; sort by `filename`.
  `snapshotHead`: `mkdtempSync`, `git archive --format=tar --output=<dir>/.snapshot.tar <head>`,
  `spawnSync("tar", ["-xf", ".snapshot.tar"], { cwd: dir })`, delete the tar, `git init -q`,
  `git add -A -f`, compare `ls-tree` with `ls-files`; return `realpathSync(dir)`.
  Every `git` call goes through the injected runner with `spawnGit`'s minimal environment and a
  60 s timeout; a non-zero status throws an `Error` with the command and stderr.
- [ ] `bun test` → green. Commit: `feat(local): a local-git connector that builds the review input from a clone`.

### Task 4: `PrFile` becomes `ReviewFile` (Q8, the rename half)

- [ ] Rename the interface in `src/engine.ts` to `ReviewFile`, keep `export type PrFile = ReviewFile`
  with a `@deprecated` comment for one release, update `src/formats.ts` and internal uses
  (`sed`-style, then read the diff). Tests and the golden are unchanged (a type rename has no
  runtime effect).
- [ ] `bun test` → green. Commit: `refactor(engine): PrFile is ReviewFile; the old name stays as an alias`.

### Task 5: the three sinks and the agent prompt block (D5, D16, Q7)

- [ ] Create `src/sinks/sinks.test.ts` using `test/fixtures/formats/review-result.example.json`
  (from PR E) plus `big()`: the same result with 300 findings (so the Markdown is far above
  `MAX_BODY_CHARS`).
  - `agentPrompt(result)`: starts with
    `Read the review of <sha7> below. For each finding, open the cited file at the cited line, decide whether it is valid against the current code, and fix the ones that are. Report the ones you reject with the reason. Run the repository's checks after the fixes.`
    then a blank line, then one numbered entry per finding, each
    `N. path:line · <label without the ** markers> ` on the first line and the body indented by
    three spaces; a `line: 0` finding prints `path` alone; `info` findings are included; the
    engine's HTML-comment neutralisation applies (`neutralise`).
  - `renderMarkdown(result, { profileNote })`: contains every one of the 300 findings' titles (no
    cut), the headline `# Wachiman review of <describe>, at <sha7>`, the coverage line (`all N
    files reviewed` or `Partial: reviewed X of N; not reviewed: a (reason), b`), the profile line
    (`Profile: default — …` / `Profile: isolated — …` / `Profile: ci`), the count line from
    `countLine`, each finding as `### <label>` + `` `path:line` `` + body, the `Verified: <checked>
    — <example>` line only for the finding that has `verification`, `## Summary`, the contracts
    block (`renderContracts` with no room), the coverage-by-batch table, the cost line containing
    `API-equivalent estimate` and `not a bill`, `stop: complete`, the provider label, the engine
    version, and ends with the fenced agent prompt block.
  - `renderTerminal(result, { profileNote, agentPrompt: false })`: no ANSI; first line
    `Wachiman · review of <describe>, at <sha7>: all N files reviewed.`; second `profile: …`;
    third the count line; then each finding as `path:line  <emoji label>` with the body indented
    by four spaces; `Not reviewed:` list; `Summary:`; the estimate line with the same wording as
    Markdown; no agent prompt; with `agentPrompt: true` the block is appended after a blank line.
  - `renderJson(result)`: `JSON.parse(renderJson(result))` deep-equals `result`; ends with `\n`.
  - A result with `stop: "quota"` renders `stop: quota — the account's usage limit ended the
    run; N file(s) not reviewed: …` in both terminal and Markdown; with `rejection.kind: "auth"`
    the line quotes the provider's text through `oneLine`.
- [ ] Run → **expected failure**. Implement `src/sinks/agent-prompt.ts` (`agentPrompt`),
  `src/sinks/markdown.ts` (`renderMarkdown`), `src/sinks/terminal.ts` (`renderTerminal`),
  `src/sinks/json.ts` (`renderJson`). They import `label`, `countLine`, `neutralise`,
  `renderContracts`, `oneLine` (export it from `engine.ts`; it is module-private today) and read
  only the `ReviewResult`. No sink computes an anchor; the local sinks ignore `anchor`.
- [ ] `bun test` → green. Commit: `feat(local): terminal, Markdown and JSON renderings of a review result`.

### Task 6: the `local` command (D9, D11, D12, the (L) criteria)

- [ ] Create `src/local.test.ts`:
  - `parseLocalArgs(["--base", "main", "src", "docs", "--format", "markdown", "--output", "r.md", "--profile", "isolated:work", "--agent-prompt"])`
    → `{ base: "main", paths: ["src", "docs"], format: "markdown", output: "r.md", profile: { kind: "isolated", name: "work" }, agentPrompt: true, input: undefined }`;
    defaults: `format: "terminal"`, `profile: { kind: "default" }`; `--format x`, `--input` with a
    missing file, `--output` without a value, `--base` without a value → `UsageError`.
  - The end-to-end tests spawn `src/cli.ts` the way `src/cli.test.ts` does, with a temp `bin/`
    first on `PATH` holding two stubs:
    - `gh`: `#!/bin/sh\necho called >> "$CANARY"; exit 99` — the canary path is baked into the
      script text (the child environment is allowlisted, so no variable reaches it).
    - `claude`: a shell script that handles `--version` (prints `9.9.9 (Claude Code)`), and
      otherwise appends its arguments and environment (`env`) to a log file, copies stdin (the
      prompt) to `<log>.prompt`, and prints a canned result JSON with
      `structured_output: { files_reviewed: [every file of the repo's branch], files_skipped: [], findings: [{ path: "src/a.ts", line: 2, severity: "fix", topic: "bug", confidence: "high", title: "T", body: "B" }], contracts: [], thread_replies: [], summary: "ok" }`,
      `total_cost_usd: 0.01`, `num_turns: 3`, `duration_ms: 10`, `subtype: "success"`,
      `is_error: false`. A second variant, `claude-quota`, prints `is_error: true, subtype:
      "error", result: "usage limit reached"`. A third, `claude-edit`, first appends a line to
      `<repo>/src/a.ts` in the **working tree** (path baked in), then behaves like the first.
    The repository is the one from Task 3's helper (copy the helper into `test/support/temp-repo.ts`
    in this task and import it from both tests).
  - `test("local reviews the branch, prints progress on stderr and the report on stdout, and never calls gh")`:
    exit 0; stderr has, before the prompt log's timestamp, the lines `base: main (<sha7>)`,
    `merge-base: <sha7>`, `head: feat/x (<sha7>)`, `files: 5 (0 excluded)`, `batches: 1`; stdout
    starts with `Wachiman · review of branch`; the `gh` canary file does not exist; the stub's
    env log has `USER`, the six switches, no `ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL`/`GH_TOKEN`;
    the args log has `--no-session-persistence`, `--restricted`, `--strict-mcp-config`,
    `--tools Read,Glob,Grep`; `--add-dir` values are under the temp dir and none is the repo
    itself.
  - `test("the review runs against the snapshot, not the working tree")`: with `claude-edit`,
    the recorded prompt's diff shows the committed `src/a.ts` lines and not the appended one;
    the first `--add-dir` directory's `src/a.ts` (read by the stub into the log before it exits:
    `cat "$ADD_DIR/src/a.ts" >> log`) holds the committed content.
  - `test("--format json writes only the result on stdout")`: `JSON.parse(stdout)` has
    `format === "wachiman.review-result/1"`, `provider.profile === "default"`,
    `change.kind === "branch"`, `execution.costUsdEstimate === 0.01`; stderr still has the
    progress lines.
  - `test("--output writes the Markdown file and prints the path")`.
  - `test("ANTHROPIC_API_KEY set: exit 2 before any call")`: stderr contains the exact message of
    Task 1; the `claude` stub log does not exist.
  - `test("the snapshot and the run directory are removed on success and on a thrown error")`:
    read the `--add-dir` values from the stub log; after exit none exists; repeat with a `claude`
    stub that exits 3 with garbage on stdout (the adapter throws "claude did not run") → exit 1,
    directories gone.
  - `test("a usage-limit rejection ends with stop: quota, exit 0, and lists what was not reviewed")`:
    two batches (`AGENT_REVIEW_BATCH_LINES=1`), the quota stub; stdout has `stop: quota` and the
    second batch's files under "not reviewed"; `claude` was called once (the loop stopped).
  - `test("--input reviews a ReviewInput file and snapshots its head from --repo-dir")`: write the
    branch fixture of PR E with `change.head.sha` set to the temp repo's head; stdout shows
    `head: <sha7>` and no `merge-base:` line; a file whose `format` is `/2` → exit 2.
  - `test("--profile isolated refuses a populated profile and uses the directory otherwise")`:
    `HOME` set to a temp dir; with `CLAUDE.md` in `<home>/.wachiman/claude-isolated` → exit 2
    naming it; without → the stub's env log has `CLAUDE_CONFIG_DIR=<home>/.wachiman/claude-isolated`
    even though the test's env sets `CLAUDE_CONFIG_DIR=/elsewhere`; stdout's profile line says
    `isolated`.
  - `test("--setup-profile launches claude in an empty directory with the forced config dir")`
    (stub records cwd and env; cwd is empty and is not the repo).
  - `test("codex is refused in local mode")`: `AGENT_REVIEW_PROVIDER=codex` → exit 2.
  - `test("--help lists local and --setup-profile; GH_TOKEN is not required for them")`.
- [ ] Run → **expected failure**. Implement:
  - `src/local.ts`: `parseLocalArgs(argv)`, `localUsage`, and
    `runLocal(args, env, io: { stdout: (s) => void; stderr: (s) => void; engineVersion: string })`:
    load config (`loadConfig(env)`; refuse `provider !== "claude-code"`), throw `UsageError` on
    `ANTHROPIC_API_KEY` (before the provider is built: the adapter's own check is the second
    line of defence), resolve the profile (`inspectIsolatedProfile` → refuse), build the provider
    with `auth: "subscription"` and `configDir`, `preflight()`, then either `buildLocalInput` or
    read `--input` (validate per decision 11; `snapshotHead(repoDir, change.head.sha)`; refuse
    when `git cat-file -e <sha>` fails), print the resolved refs and counts to stderr, install the
    `SIGINT` handler, call `reviewChange(input, reviewOptionsOf(config, config.budgetUsd, profile), { provider, log: stderr, warn: stderr, engineVersion })`,
    render per `--format`, write `--output` or stdout, and in `finally` remove the snapshot.
    Exit code per decision 8 (returned, not `process.exit`, so tests can call `runLocal` directly
    too).
  - `src/cli.ts`: `local` and `--setup-profile` branch before the `GH_TOKEN` requirement; USAGE
    gains the two lines; the `local` mode passes `extractRepoDir`'s directory as the clone.
- [ ] `bun test` → green. Commit: `feat(cli): agent-review local reviews the committed branch on the signed-in claude`.

### Task 7: parity levels (a) and (b) (D13)

- [ ] `scripts/record-pr-fixture.ts <pr> [repo]` (default `niway-dev/wachiman`): with `gh`,
  reads `pulls/<pr>` (head sha, base ref), `compare/<base.sha>...<head.sha>` →
  `merge_base_commit.sha`, the files list (`listFiles`'s jq), the instruction files at the
  merge-base through `readBaseInstructions(gh, repo, mergeBase, warn)`, and writes
  `test/fixtures/parity/pr-<pr>.json` as `{ pr, repo, headSha, mergeBase, baseRef, meta: { title, body, author }, files, instructions }`.
  Run it for #88 (`feat/data-path-questions`, many files, a `docs/adr/` file) and for #105
  ("keep restored and renamed rows in incremental re-review", a smaller one); commit both
  fixtures. Note the merge-base and head in
  the commit message.
- [ ] `test/parity.test.ts`:
  - Level (b), `describe("prompt parity between the github and local-git connectors")`, one
    `test` per fixture, `test.skipIf(!hasCommits)` where `hasCommits` is
    `git cat-file -e <headSha>` and `<mergeBase>` in the repository root (`join(import.meta.dir, "..")`);
    the skip message says to `git fetch --unshallow`. Steps: `snapshotHead(root, headSha)`;
    `localFiles(root, mergeBase, headSha)`; `localInstructions(root, mergeBase, …)`; build the
    local input with `buildLocalInput`-equivalent pieces but **override** `change` with
    `githubReviewInput(fixture…).change` (same metadata on both sides, per the spec); build the
    GitHub input with `githubReviewInput({ …fixture, headDir: snapshot.dir, scope: [], since: null, rebased: false, threads: [] })`;
    run `reviewChange` on each with a `FakeProvider` that answers "all reviewed" for every call;
    assert `requests.length` equal and each `requests[i].prompt` byte-identical after replacing
    `addDirs[0]` with `<RUN_DIR>`; and `localInput.files` deep-equals `fixture.files` restricted
    to the keys `filename, additions, deletions, patch, previous_filename` for every file where
    GitHub sent a patch. List the local-only patches (`console.log`), never fail on them (Q2).
  - Level (a), `describe.skipIf(process.env.WACHI_PARITY !== "1")`: `gh pr list --state merged --limit 20 --json number`
    for this repository, take the first 10 whose head and merge-base commits exist locally,
    record each through the same code as the script (in memory), compare `filename, additions,
    deletions, patch` where GitHub has a patch, and print a table: pr, files, equal, local-only,
    differing. Any differing file fails the test with the first 40 lines of a unified diff of
    the two patches.
  - `.github/workflows/ci.yml`: `fetch-depth: 0` on the `test` job's checkout (one line) so level
    (b) runs in CI; `test/review-on-push.test.ts` does not read `ci.yml`, so no test changes.
- [ ] Run level (b) locally → **expected pass** (if a prompt differs, the difference is in the
  connector: a count, a patch's trailing newline, a rename, the instruction cut; fix the
  connector, never the test). Run level (a) once: `WACHI_PARITY=1 bun test test/parity.test.ts`
  and paste the table into the PR body.
- [ ] `bun test` → green. Commit: `test(local): prompt parity between the GitHub and local-git connectors`.

### Task 8: a supported way to force a full review in a GitHub dry run (decision 13)

- [ ] `src/config.test.ts`: `AGENT_REVIEW_FULL_REVIEW=1` with `AGENT_REVIEW_DRY_RUN=1` →
  `fullReview: true`; without the dry run → `UsageError` naming both variables; unset → false.
- [ ] `src/engine.fake.test.ts`: a pull request whose last review marker equals the head, with
  `fullReview`, is reviewed in full (one provider call, no "Already reviewed"), and the dry-run
  log contains the printed review; no `gh` POST.
- [ ] Implement: `EngineConfig.fullReview: boolean`; in `review()`,
  `const last = config.fullReview ? null : lastReviewedSha(gh, repo, pr);`. Golden unchanged
  (the prompt for a full review is the existing one).
- [ ] `docs/configuration.md`: a row under engine settings and a sentence under "Dry run".
- [ ] `bun test` → green. Commit: `feat(cli): a dry run can ignore the previous-review marker`.

### Task 9: documentation

- [ ] `docs/local-review.md`, the spec's eight sections, in this order and with these facts:
  1. Who it is for; the promise verbatim (D11): "Wachiman sends no telemetry and makes no GitHub
     requests in local mode; your code is sent to your configured Claude account for the review."
  2. Before you run it on someone else's code: Consumer terms (personal Pro or Max: the training
     setting must be off, 30-day retention, link to Anthropic's privacy controls page) versus
     Team or Enterprise commercial terms (no training, 30 days or zero retention); the local
     transcript and why `--no-session-persistence` is set; what leaves the machine (the diff,
     the files the model reads, the instructions, the prompt) and what does not (nothing to
     GitHub; no telemetry with the switches); a 6-line request template for an employer.
  3. Install: Bun, a signed-in `claude` (the tested version from Task 11), a clone of this
     repository; no `gh`, no token, no key; the launcher
     `bun --no-env-file --config=<engine>/bunfig.toml <engine>/src/cli.ts local --repo-dir <clone>`
     and why it runs from the engine's directory (links `docs/cli.md`).
  4. Run: `--base`, paths, `--repo-dir`, `--input`, `--format`, `--output`, `--agent-prompt`,
     `--profile`, `--setup-profile`; what the first stderr lines are; how long a run takes (from
     Task 11); `Ctrl-C` removes the snapshot.
  5. Read the report: labels (link `docs/cli.md`), confidence, the coverage list, the estimate
     line and what it is not, the agent prompt block and how to use it.
  6. Limits: work limits and the estimate guard; what a quota stop looks like; no incremental
     state, threads or memory; committed changes only.
  7. What is verified and what is not, one row per claim with the Claude Code version: telemetry
     switches (the 2026-11-04 proxy probe: Datadog intake gone, `api.anthropic.com` only; Statsig
     and Sentry never seen, so unproven), populated-profile isolation (the 2026-11-04 harness:
     `CLAUDE.md`, skills, commands, agents, hooks, user MCP, account connectors all absent with
     Wachiman's flags; **plugins untested**), `--safe-mode` (not adopted), OAuth cost reporting
     (`total_cost_usd` and `--max-budget-usd` held on 2.1.318 in the probe; the Task 11 run on the
     version it used), what the wire showed in Task 11. Rows Task 11 has not filled say "not yet
     run".
  8. Troubleshooting: `ANTHROPIC_API_KEY is set`; not signed in (`stop: error`, the binary's own
     "Not logged in" text, `--setup-profile`); no merge-base; detached `HEAD`; the snapshot
     warning; **the shell-function pitfall**: a `claude` shell function or alias that sets
     `CLAUDE_CONFIG_DIR` does not affect Wachiman (it spawns the binary from `PATH` without a
     shell), but it does affect a `claude` the developer runs by hand to sign in, which is why
     `--setup-profile` exists; check with `type claude`.
- [ ] `docs/cli.md`: `local` and `--setup-profile` in the command list, options table, "What it
  prints" (not posts), exit codes 0/1/2 per decision 8, the environment table ("`GH_TOKEN` and
  `GITHUB_REPOSITORY`: not read by `local`").
- [ ] `docs/configuration.md`: `AGENT_REVIEW_FULL_REVIEW`; a "Local mode" paragraph: which
  settings apply (`BUDGET_USD`, `BATCH_*`, `MODEL`, `EFFORT`, `MAX_TURNS`, `CALL_TIMEOUT_S`,
  `EXCLUDE`) and which do not (`AUTO_BUDGET_USD`, `THREADS_BUDGET_USD`, `OPERATOR`, `MENTION`,
  `TRIGGER`, `ON_PROVIDER_UNAVAILABLE`).
- [ ] `docs/architecture.md`: in "The review core and its ports" (PR E), the `local-git`
  connector (the seven steps, the snapshot and its index, spec correction 1) and the three sinks;
  invariants: "The local mode never constructs a `gh` function (a test runs it with a `gh` that
  exits 99)", "The snapshot and the run directory are removed on every exit path".
- [ ] `docs/providers/claude-code.md`: the subscription table (Task 1) and a "Profiles" paragraph.
- [ ] `README.md`: one paragraph "Review locally on your own subscription" linking the guide.
- [ ] `docs/adr/0019-…md` status: "decisions 2–9 implemented by PR #<L>; level (c) recorded at
  <benchmarks link>"; `docs/specs/2026-11-03-local-review-design.md`: status, tick every **(L)**
  box with its test name, the **(G)** boxes after Task 11, and the spec corrections above as
  amendments.
- [ ] `bun test` → green. Commit: `docs: the local review guide and the command reference`.

### Task 10: final checks before un-drafting

- [ ] `bun test` twice; `WACHI_UPDATE_GOLDEN=1` regenerate and `git status` shows no fixture
  change (the GitHub prompt did not move in this PR).
- [ ] `WACHI_PARITY=1 bun test test/parity.test.ts` once more on the final code; paste the table.
- [ ] A real smoke run with the stub-free binary on this repository itself, no key, `default`
  profile, `--format markdown --output /tmp/wachiman-self.md`, on a small branch (for example the
  plan branch against `main`): read the file, check the estimate line, delete it. This spends a
  little of the owner's plan; ask before running if the owner is not the one executing.

### Task 11: level (c), run by the owner (D13, the (G) criteria)

Not a code task. The owner runs it; the implementer prepares the exact commands and the
benchmarks directory skeleton.

- [ ] Target: kaipu-record #386 at `8c329018f237c675384a12e55145f9a382762832` (6 files; posted
  CI review of 2026-10-27: three `consider` findings — a bug, a tests, a cleanup finding). Base:
  its merge-base with `main` at the time; with the local clone at `8c32901` checked out on a
  temporary branch, `--base main` resolves to the same merge-base only if `main` has not been
  rewritten; print it and compare with `gh api repos/niway-dev/kaipu-record/compare/main...8c32901 --jq .merge_base_commit.sha`
  before the run. If they differ, pass `--base <that sha>`.
- [ ] Once per profile (`default`, then `isolated` after `--setup-profile`), on the owner's
  subscription, with `claude --version` recorded, through a logging proxy (`HTTPS_PROXY` is not
  in the child allowlist; use the same system-level proxy as the 2026-11-04 probe, or `lsof -i`
  sampling, and say which):
  `bun --no-env-file --config=bunfig.toml src/cli.ts local --repo-dir <kaipu clone> --format markdown --output <benchmarks>/<date>-local-review-level-c/<profile>.md`
  plus `--format json --output <profile>.json` on the same commit (a second run; note both costs).
- [ ] Record in the `wachiman-benchmarks` repository under
  `<date>-local-review-level-c/README.md`: the engine commit, the Claude Code version, the
  profile, the two reports, `execution.costUsdEstimate`, calls, turns, wall-clock, `stop`, the
  hosts the wire showed, the sessions directory of the profile before and after (must be
  unchanged: `--no-session-persistence`), and the comparison with the posted review: each
  posted finding matched by path and defect to a local finding or marked missed; local-only
  findings listed. State the kill condition's verdict: the posted review has no Medium-or-higher
  finding, so the condition cannot trigger on #386; say so, and whether a second run on #479 is
  wanted.
- [ ] Fill section 7 of `docs/local-review.md` from the record; tick the **(G)** boxes in the
  spec; link the record from the ADR. Commit: `docs: level (c) results for the local review`.
- [ ] Un-draft the PR.

## Risks

- **The patch split diverges from GitHub on an edge the probe did not have** (a file both
  renamed and edited, a mode change, a symlink, CRLF). Level (a) on 10 pull requests of this
  repository and level (b) on two fixtures catch the common ones; the parity table in the PR body
  shows the rest. A difference is a connector bug, never a test to relax.
- **`git archive` honours `export-ignore`**, so a repository that exports a subset would be
  reviewed without those files. The warning names them; the guide says what to do (remove the
  attribute on a temporary branch, or wait for `--working-tree`).
- **A quota exhaustion on a real subscription may look different** from "usage limit"
  (`billing`). Task 11 is the only place that can show it; until then the terminal says
  `stop: error` with the binary's own text, which is honest.
- **The isolated profile's sign-in is keyed to the directory path**; moving `~/.wachiman`
  invalidates it. The guide says so.
- **Stacked PR.** Until E merges, this PR's diff includes E's; re-target to `main` after the
  merge and rebase once.

## Stop condition

Stop and ask the owner if:

- Level (b) prompts differ and the cause is in the core, not the connector (the extraction
  changed something the golden did not see).
- `git grep` in the snapshot behaves differently from a checkout for any evidence test (then the
  `git init` approach is wrong and `git worktree` must be reconsidered, which is a Q5 reopen).
- The subscription run reports no `total_cost_usd` or ignores `--max-budget-usd` on the version
  used (ADR 0019's reopen condition).
- Level (c) finds fewer than half of a posted review's Medium-or-higher findings on any run.

## Not in this plan

- `--working-tree` and `--staged` (next slice, its own spec).
- A plugin sentinel for the isolation harness, and re-running the harness per Claude Code
  version (the guide names the version tested and says plugins are untested).
- The source-neutral wording of the "no diff from GitHub" notice and the "pull request's
  budget" skip reason (a golden re-record; decide with the level (b) and (c) results).
- Cleanup of the `threads` and `answer` run directories (GitHub-only; see PR E's list).
- `--tier` for local runs (arrives with ADR 0017 / #90).
- A `docs/formats/` example of a hand-written `--input` file beyond the test fixtures.
