# Plan: extract a review core behind source and sink ports (PR "E")

- **Goal.** Move the source-neutral part of `review()` into `reviewChange(input, options, deps)`,
  with `review()` left as the GitHub connector (builds a `ReviewInput`) plus the GitHub sink
  (renders a `ReviewResult` with `buildReview` and posts it). GitHub mode's prompts and posted
  bodies are byte-identical before and after, which a golden test proves. One intended behaviour
  change: each batch's run directory (`pr.json`, `threads.json`, `evidence.json`) is removed after
  the call.
- **Spec.** [2026-11-03-local-review-design.md](../specs/2026-11-03-local-review-design.md):
  decisions D1, D3, D15, D16, decided questions Q6, Q7 (the reserved `verification?`), Q8 (the
  `ReviewFile` alias), the "What the engine reads" table, "The core and its ports", "The input
  format", "The result format", acceptance criteria tagged **(E)**, "Refactor order" step 1.
- **ADR.** [0019](../adr/0019-a-review-core-behind-source-and-sink-ports-and-a-local-subscription-mode.md)
  decisions 1, 3 (the GitHub sink), 9 (formats); amends [0001](../adr/0001-distribution-and-trust.md).
- **Issue.** [#103](https://github.com/niway-dev/wachiman/issues/103).
- **Branch.** `feat/review-core`, base `origin/main` at `ae19404` (v1.6.0). The branch was
  created from `3b97c2c` and fast-forwarded on 2026-11-04 because #109 (provider error
  classification: `src/providers/errors.ts`, `rejection`, `reviewBatchBackingOff`,
  `onProviderUnavailable`) rewrote the batch loop this plan moves. Everything below was read on
  `ae19404`.
- **Worktree.** `/Users/cristiansotomayor-m5-pro/Documents/Workspace/Personal/wachiman/.claude/worktrees/review-core`.
  Run every command there; use `git -C <worktree>` for git (a hook blocks commits in the main
  checkout). Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- **Release.** Ships as a patch release: commit prefixes are `refactor`, `test`, `docs`, and one
  `fix` (the run-directory cleanup). No `feat` in this PR; the formats are published by the docs
  and the types, and the first consumer that reads them is PR L.
- **Working document.** The PR links this file; the shipping commit deletes it (git keeps it).

## What this PR does NOT do

- No new command, flag, connector or sink. `agent-review local`, `local-git`, the terminal,
  Markdown and JSON sinks, `auth: "subscription"`, profiles: all PR L
  ([2026-11-04-local-review-mode.md](2026-11-04-local-review-mode.md)).
- No change to what the model is asked: `RULES`, `FLOW_QUESTIONS`, the data-path questions,
  `SCHEMA`, and the `annotateDiff` notice "(no diff from GitHub: binary or too large; read the
  file itself)" all stay byte-identical (see Spec corrections, item 5).
- No change to `threadReplies`, `answer`, `comment`, `postReview`, `ceilingRoom`, the marker,
  `compareFiles`, `rebaseDelta`, `ownChangeSince`, or the Codex adapter.
- No cleanup of the `agent-threads-` and `agent-answer-` run directories (GitHub-only paths;
  two tests read `threads.json` after the run). Listed under "Not in this plan".
- No type checker. The repository has no `tsconfig.json` and CI runs `bun test` only; do not add
  one here. Type-level claims in this plan are backed by runtime tests.

## Baseline (recorded 2026-11-04 on `ae19404`)

```
bun test v1.4.2 (744846f84)   # CI pins Bun 1.3.4; both must stay green
 590 pass
 7 skip
 0 fail
 1700 expect() calls
Ran 597 tests across 23 files. [9.07s]
```

The 7 skips are the opt-in harnesses (`test/provider-isolation.test.ts`, needs a real binary).
Every task below ends with this suite green plus the golden test of Task 1.

## Spec corrections (where the spec disagrees with the code on `ae19404`)

1. **`ReviewResult.execution` needs `usage`.** The spec's `execution` has `costUsdEstimate`,
   `calls`, `turns`, `durationMs`, `stop`, `notices`. `buildReview`'s footer prints the token
   usage (`costLine({ usage })`) and the fake tests assert it (`… · 2 batches · $0.60`, the
   ceiling tests check tokens). Without `usage` in the result the GitHub sink cannot render
   today's footer. Added as `execution.usage: TokenUsage` (additive inside `/1`).
2. **`execution` needs the provider rejection and a "produced output" count.** Since #109,
   `review()` posts different notices for billing, auth, rate-limit and unclassified rejections,
   and only when no call produced a review. The result carries
   `execution.rejection?: { kind, text }` (the first non-`other` rejection, else the first
   `other`) and `execution.callsWithOutput: number` (how many calls, retries included, returned a
   review; today's `parts.length`). `stop` alone cannot say both.
3. **`instructionChanges` is computed from the whole pull request, not the reviewed files.**
   `review()` calls `changedInstructionFiles(prFiles…)` on every file of the pull request, while
   the core only sees the files it reviews (after the incremental narrowing). A core that
   computed it from `input.files` would stop noticing an instruction file on an incremental
   review. Decision: the core fills `result.instructionChanges` from `input.files` (right for a
   local run, which has no narrowing) and the GitHub sink passes its own value, computed as today,
   to `buildReview`, the way it passes `since` and `rebased`.
4. **"Every existing test passes unchanged" cannot hold with the run-directory cleanup.** Two
   tests in `src/engine.fake.test.ts` read `evidence.json` from `requests[0].addDirs[0]` after
   `review()` returned (lines 1319–1320 and 1342). Once the directory is removed they must read
   it while the provider is being called. The assertions are unchanged; the moment they run is
   not (Task 6).
5. **The `annotateDiff` wording.** The spec's table recommends changing "(no diff from GitHub …)"
   to a source-neutral notice in this PR and re-recording the golden prompts. The owner's brief
   for this plan names the run-directory cleanup as the one intended behaviour change, so the
   wording stays. PR L's prompt-parity test (level b) accepts it, as the spec allows. A later PR
   may change the wording with a golden re-record of its own.
6. **`buildReview` as "a pure function of `ReviewResult`".** Twenty-two call sites in
   `src/engine.test.ts` and three in `src/ceiling.fake.test.ts` construct `buildReview`'s current
   input directly. Decision (see "Decisions made in this plan", item 4): `buildReview` keeps its
   signature; the new `githubReview(result, github)` maps a `ReviewResult` onto it, and
   `buildReview` honours a finding's `anchor` when present. The sink reads only the result and the
   GitHub-side facts; no test changes.
7. **ADR 0019 says the engine "gains two exported types and one function".** It gains the two
   types, `reviewChange`, `ReviewOptions`, `CoreDeps`, `githubReviewInput`, `githubReview`, the
   `ReviewFile` alias and two format constants. Task 7 corrects the ADR's consequences line.
8. **`scripts/prompt-golden.ts` is not mentioned by the spec** but builds a `ReviewContext` by
   hand, and `src/questions/prompt-unchanged.test.ts` pins its output. Changing `ReviewContext`
   (Task 3) requires updating the script so its output stays byte-identical.

## Decisions made in this plan (marked "decided in plan"; one-line reason each)

1. **Golden fixtures are recorded by the three `FakeProvider`s themselves**, through a shared
   `test/support/golden-prompts.ts`, keyed by test file and request order, with the run directory
   and the head directory replaced by placeholders. Reason: the spec names
   `FakeProvider.requests[].prompt` as the oracle; recording where the request is captured covers
   every existing fake test without rewriting any.
2. **Types live in `src/formats.ts`** and are re-exported from `src/engine.ts`; `reviewChange`
   itself stays in `src/engine.ts` (acceptance (E) says `src/engine.ts` exports it). Reason: a
   2,900-line file should not grow by the format types, and type-only imports create no cycle.
3. **`ReviewOptions` carries the knobs, `CoreDeps` the I/O.** `reviewChange(input, options,
   deps)` with `options: ReviewOptions` (budgets, batch sizes, excludes, turn and time limits,
   model, effort, trigger, profile) and `deps: CoreDeps` (provider, log, warn, lineCounter,
   sleep, rateLimitBackoffMs, git, now, costs, engineVersion). `Deps extends CoreDeps` adds `gh`,
   `config`, `repoDir`. Reason: the acceptance criterion is checked by the type of `deps`; the
   knobs are values, not dependencies.
4. **`buildReview` keeps its signature and learns `anchor`.** One line changes:
   `f.anchor ? f.anchor === "diff" : commentable.get(f.path)?.has(f.line)`. `githubReview` passes
   `files` as names only (`{ filename, additions: 0, deletions: 0 }`), so the anchor must come
   from the result. Reason: spec correction 6.
5. **`stop` semantics.** `"quota"` when a call was rejected as `billing` or `rate_limit` (every
   later batch is "not reached"); otherwise, when no call produced output: `turns` or `timeout`
   if a call hit that limit and none hit its spend cap, `budget` if one hit its cap, `error`
   otherwise (an `auth` rejection is `error` with `rejection.kind: "auth"`, as the spec says for
   "not signed in"); otherwise `"complete"` (`coverage.partial` says whether files were left).
   Reason: mirrors today's precedence at `review()` lines 2193–2240 exactly, plus D12's word.
6. **`execution.durationMs` is the wall clock of `reviewChange`** (`Date.now()` at entry and
   exit), `calls` counts `runProvider` calls, `notices` collects every `warn` the core emitted.
   Reason: the simplest honest numbers; per-call durations are already in `deps.costs`.
7. **`engine.version` comes from `deps.engineVersion ?? "unknown"`**, set by `cli.ts` from
   `readVersion()`. Reason: `readVersion` lives in `cli.ts`, which imports `engine.ts`.
8. **`provider.profile` is `"ci"` for every GitHub-mode run in this PR**, dry runs included.
   Reason: PR L introduces the other two values and the rule that picks them.
9. **`CallCost.repo` and `CallCost.pr` come from the change**: `repo = change.repository.name`,
   `pr` = the number in `identifier` when it matches `/^#(\d+)$/`. Reason: the cost log line must
   stay identical in GitHub mode; a local run has neither.
10. **Run directories are still one `mkdtemp` per call**, removed in a `finally` inside
    `reviewBatch`. Reason: the smallest change; the prompt's `${dir}/pr.json` path shape is
    unchanged.
11. **The schema validator in tests is a 60-line subset** (`type`, `properties`, `required`,
    `additionalProperties`, `items`, `enum`, `const`, `minimum`, `$ref` to `#/$defs/…`,
    `oneOf`). Reason: zero dependencies (ADR 0002); the schemas use only that subset.
12. **`ReviewInput.change.repository.url`** is `https://github.com/<repo>` for GitHub. Reason:
    optional field, cheap, lets a JSON consumer link back.

## File map

| File | Change |
| --- | --- |
| `test/support/golden-prompts.ts` | new: `recordPrompt(tag, request)`, `checkGoldenPrompts(tag)`, normalisation |
| `test/fixtures/golden-prompts/README.md` | new: what the fixtures are, how to regenerate |
| `test/fixtures/golden-prompts/{engine.fake,ceiling.fake,threads.fake}.jsonl` | new: one JSON line per recorded request |
| `src/engine.fake.test.ts`, `src/ceiling.fake.test.ts`, `src/threads.fake.test.ts` | `FakeProvider.run` records; `afterAll` checks; Task 6 moves two `evidence.json` reads into the provider step |
| `test/support/json-schema.ts` | new: subset validator |
| `src/formats.ts` | new: `REVIEW_INPUT_FORMAT`, `REVIEW_RESULT_FORMAT`, `ReviewChange`, `ReviewInput`, `ReviewResult`, `ResultFinding`, `ReviewFile`, `assertReviewInputFormat` |
| `src/formats.test.ts` | new: round trip, schema validation of fixtures, unknown format |
| `test/fixtures/formats/review-input.pull-request.json`, `review-input.branch.json`, `review-result.example.json` | new fixtures |
| `docs/formats/README.md`, `docs/formats/review-input.v1.schema.json`, `docs/formats/review-result.v1.schema.json` | new: the public formats |
| `src/engine.ts` | `ReviewContext` (describe, author string, headDir), `CoreDeps`, `ReviewOptions`, `runProvider(cwd)`, `reviewBatch` cleanup, `reviewChange`, `githubReviewInput`, `githubReview`, `buildReview` anchor, `review()` shrinks; re-exports from `formats.ts`; `Thread` type exported |
| `src/cli.ts` | passes `engineVersion: readVersion()` in `deps` |
| `scripts/prompt-golden.ts` | new `ReviewContext` shape; output unchanged |
| `src/review-core.fake.test.ts` | new: `reviewChange` from a hand-built input, no `gh` anywhere |
| `docs/architecture.md` | section "The review core and its ports"; the flow diagram grows the two seams; invariants |
| `docs/adr/0019-…md`, `docs/specs/2026-11-03-local-review-design.md` | status lines: extraction implemented in this PR, the rest not |

## Tasks

Each task: write the failing test, run it and see the expected failure, implement, run the
file, then run the whole suite (`bun test`), then commit. "Suite green" below means
`bun test` reports `0 fail` and the golden test passes.

### Task 1: pin every fake-provider prompt as a golden fixture (no engine change)

**Why first.** D3: the oracle is recorded on unchanged code, before any move.

- [ ] Create `test/support/golden-prompts.ts`:

  ```ts
  import { afterAll, expect } from "bun:test";
  import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
  import { join } from "node:path";
  import type { ProviderRequest } from "../../src/providers/types";

  const DIR = join(import.meta.dir, "..", "fixtures", "golden-prompts");
  const recorded = new Map<string, string[]>();

  /** Paths that differ per run become placeholders, so a prompt compares across machines. */
  export function normalisePrompt(request: ProviderRequest) {
    let text = request.prompt;
    const roots = [request.cwd, ...request.addDirs].flatMap((p) => {
      try { return [p, realpathSync(p)]; } catch { return [p]; }
    });
    // Longest first, so `/private/var/...` is replaced before `/var/...`.
    const unique = [...new Set(roots)].sort((a, b) => b.length - a.length);
    unique.forEach((root) => { text = text.replaceAll(root, root === request.cwd || root === safeReal(request.cwd) ? "<HEAD_DIR>" : "<RUN_DIR>"); });
    return text;
  }
  function safeReal(p: string) { try { return realpathSync(p); } catch { return p; } }

  /** Called by every FakeProvider.run; `tag` is the test file's basename without `.test.ts`. */
  export function recordPrompt(tag: string, request: ProviderRequest) {
    recorded.set(tag, [...(recorded.get(tag) ?? []), normalisePrompt(request)]);
  }

  /**
   * Compares what this file recorded with its fixture, byte for byte, in order. With
   * WACHI_UPDATE_GOLDEN=1 it writes the fixture instead. Run the whole file: a `-t` filter or
   * `.only` changes the order and the count, and the message says so.
   */
  export function checkGoldenPrompts(tag: string) {
    afterAll(() => {
      const prompts = recorded.get(tag) ?? [];
      const path = join(DIR, `${tag}.jsonl`);
      const lines = prompts.map((prompt, i) => JSON.stringify({ n: i + 1, prompt }));
      if (process.env.WACHI_UPDATE_GOLDEN === "1") {
        mkdirSync(DIR, { recursive: true });
        writeFileSync(path, `${lines.join("\n")}\n`);
        return;
      }
      if (!existsSync(path)) throw new Error(`${path} is missing: run WACHI_UPDATE_GOLDEN=1 bun test ${tag}`);
      const expected = readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { n: number; prompt: string });
      expect(prompts.length, `${tag}: ${prompts.length} prompts recorded, fixture has ${expected.length}; run the whole file without -t or .only`).toBe(expected.length);
      prompts.forEach((prompt, i) => {
        if (prompt !== expected[i].prompt) {
          // `toBe` on two long strings prints a readable diff.
          expect(prompt, `${tag} request #${i + 1} differs from the golden prompt`).toBe(expected[i].prompt);
        }
      });
    });
  }
  ```

- [ ] In each of `src/engine.fake.test.ts`, `src/ceiling.fake.test.ts`, `src/threads.fake.test.ts`:
  import `{ checkGoldenPrompts, recordPrompt } from "../test/support/golden-prompts"`; in
  `FakeProvider.run`, right after `this.requests.push(request);`, add
  `recordPrompt("<tag>", request);` with tags `engine.fake`, `ceiling.fake`, `threads.fake`; at
  top level (after the class) add `checkGoldenPrompts("<tag>");`.
- [ ] Run `bun test src/engine.fake.test.ts` → **expected failure**: the `afterAll` throws
  "`…/golden-prompts/engine.fake.jsonl` is missing".
- [ ] Record: `WACHI_UPDATE_GOLDEN=1 bun test src/engine.fake.test.ts src/ceiling.fake.test.ts src/threads.fake.test.ts`.
  Then run the same three files without the variable → **expected pass**. Run them twice more
  to confirm the prompts are deterministic (no timestamps, no random order). If a prompt differs
  between runs, find the nondeterminism before going on (the evidence step's 20 s time box and
  `mkdtemp` names are the suspects; both are covered by the normaliser and the fake clock).
- [ ] Sanity-check the fixtures: `grep -c '"n":' test/fixtures/golden-prompts/*.jsonl` (expect
  about 60–90 lines in total); `grep -l '/var/folders\|/tmp/' test/fixtures/golden-prompts/*.jsonl`
  must print nothing (every machine-specific path was normalised); `du -sh` the directory and
  record the size in the commit message (expected 0.5–2 MB; above 3 MB, stop and ask whether to
  keep full text).
- [ ] Add `test/fixtures/golden-prompts/README.md` (8 lines): what is pinned, that the fixture
  changes only with an intended prompt change, and the regenerate command. Regeneration must be a
  reviewed diff in the same commit as the prompt change.
- [ ] `bun test` → suite green (597 + 0 new tests; the checks run in `afterAll`).
- [ ] Commit: `test: pin every fake-provider prompt as a golden fixture` with a body naming the
  fixture size and that no engine file changed.

### Task 2: the public formats (types, schemas, round-trip test)

- [ ] Create `src/formats.ts`:

  ```ts
  /** The two public, versioned formats of the review core (spec D15, ADR 0019 decision 9). */
  import type { TokenUsage } from "./cost";
  import type { Contract } from "./contracts";
  import type { BaseInstructions, BatchReport, Finding, PrFile, ReviewOutput, Thread } from "./engine";

  export const REVIEW_INPUT_FORMAT = "wachiman.review-input/1";
  export const REVIEW_RESULT_FORMAT = "wachiman.review-result/1";

  /** Q8: an alias in this PR; the rename happens with the local connector. */
  export type ReviewFile = PrFile;

  export interface ReviewChange {
    kind: "pull-request" | "branch";
    /** One sentence for the prompt's first line and every report's headline. */
    describe: string;
    repository: { name: string; url?: string };
    base: { sha: string; ref?: string };
    head: { sha: string; ref?: string };
    title?: string;
    description?: string;
    author?: string;
    /** "#479", "!12". */
    identifier?: string;
  }

  export interface ReviewInput {
    format: typeof REVIEW_INPUT_FORMAT;
    change: ReviewChange;
    files: ReviewFile[];
    instructions: BaseInstructions;
    /** In memory only, never in a file: the checkout or snapshot of `change.head.sha`. */
    headDir: string;
    scope: string[];
    since?: { sha: string; rebased: boolean };
    conversation?: Thread[];
  }

  export type Profile = "ci" | "default" | "isolated";
  export type Stop = "complete" | "budget" | "turns" | "timeout" | "quota" | "error";

  export interface ResultFinding extends Finding {
    /** Whether the line is one a diff-anchored comment can target (`commentableLines`). */
    anchor: "diff" | "outside";
    /** Reserved (spec Q7): filled once the model is asked how it verified a finding. */
    verification?: { checked: string; example?: string };
  }

  export interface ReviewResult {
    format: typeof REVIEW_RESULT_FORMAT;
    change: ReviewChange & { snapshot?: string };
    engine: { version: string };
    provider: { label: string; model: string; effort: string; profile: Profile };
    coverage: {
      expected: string[];
      reviewed: string[];
      skipped: { path: string; reason: string }[];
      excluded: number;
      partial: boolean;
    };
    findings: ResultFinding[];
    contracts: Contract[];
    summary: string;
    batches: BatchReport[];
    threadReplies: ReviewOutput["thread_replies"];
    instructionChanges: { files: string[]; baseSha: string };
    execution: {
      /** `total_cost_usd` summed: an API-equivalent estimate, never a bill on a subscription. */
      costUsdEstimate: number;
      usage: TokenUsage;
      calls: number;
      /** Calls (retries included) that returned a review; 0 means nothing was reviewed. */
      callsWithOutput: number;
      turns: number;
      durationMs: number;
      stop: Stop;
      /** The first provider rejection, when a call was refused (`src/providers/errors.ts`). */
      rejection?: { kind: "billing" | "auth" | "rate_limit" | "other"; text: string };
      notices: string[];
    };
  }

  /** The core refuses a version it does not know (D15). A usage error, not an engine error. */
  export function assertReviewInputFormat(input: { format?: unknown }): asserts input is { format: typeof REVIEW_INPUT_FORMAT } {
    if (input.format !== REVIEW_INPUT_FORMAT) {
      throw new UsageError(`Unknown review input format ${JSON.stringify(input.format)}; this engine reads ${REVIEW_INPUT_FORMAT}.`);
    }
  }
  ```

  `UsageError` is imported from `./config`. In `src/engine.ts` add
  `export type Thread = ReturnType<typeof openBotThreads>[number];` next to `openBotThreads` and
  `export type { ReviewChange, ReviewFile, ReviewInput, ReviewResult, ResultFinding } from "./formats"; export { REVIEW_INPUT_FORMAT, REVIEW_RESULT_FORMAT } from "./formats";`
  at the top. (Type-only cycle `engine ⇄ formats`: fine for Bun.)
- [ ] Write the two schemas in `docs/formats/` (JSON Schema 2020-12, `$id`
  `https://github.com/niway-dev/wachiman/docs/formats/review-input.v1.schema.json` and the
  result's). Mirror the types field for field; `format` is `const`; `headDir` is **absent** from
  the input schema (never in a file) and `additionalProperties: false` at every object, except
  `findings[]`, `contracts[]`, `batches[]` and `execution` where it is `true` so a `/1` reader
  accepts the additive fields a later `/1` writer adds. Put `Finding`, `Contract`,
  `InstructionFile`, `BatchReport` and `Thread` under `$defs`. Write `docs/formats/README.md`
  (30 lines): the two names, the versioning rule (inside `/1` only optional fields are added;
  removing, renaming or retyping is `/2`; the core refuses an unknown `format`), that `headDir`
  is never written, where the fixtures are, and that the JSON Schemas are the contract and the
  TypeScript types follow them.
- [ ] Create `test/support/json-schema.ts`: `validate(schema, value, rootSchema = schema): string[]`
  returning the problems as `path: message` strings, supporting exactly `type` (string or
  array; `integer` means `Number.isInteger`), `const`, `enum`, `minimum`, `properties`,
  `required`, `additionalProperties` (boolean), `items`, `oneOf`, `$ref` of the form
  `#/$defs/<name>`. Throw on any other keyword so a schema cannot silently use something the
  validator ignores (list `$schema`, `$id`, `title`, `description`, `$defs` as allowed
  annotations).
- [ ] Create the three fixtures under `test/fixtures/formats/`: a pull-request input with four
  files (take `prFiles` from `src/engine.fake.test.ts`, including the patch-less `assets/logo.png`),
  an instruction file and a `since`; a branch input with no optional fields; a result with two
  findings (one `anchor: "diff"`, one `"outside"` with a `verification`), one contract, two
  batches, a `rejection`-free `execution` with `stop: "complete"`.
- [ ] Write `src/formats.test.ts`:
  - `test("each fixture validates against its schema")`: `validate(schema, fixture)` is `[]` for
    the three fixtures; and a negative control: the input fixture with `format:
    "wachiman.review-input/2"` yields one problem at `format`.
  - `test("the formats survive a JSON round trip, headDir excepted")`:
    `expect(JSON.parse(JSON.stringify(x))).toEqual(x)` for each fixture, after loading the input
    fixtures with `headDir: "/tmp/head"` added and stripping it before validation.
  - `test("the core refuses an unknown format with a usage error")`:
    `expect(() => assertReviewInputFormat({ format: "wachiman.review-input/2" })).toThrow(UsageError)`
    and the message names `wachiman.review-input/1`.
  - `test("the schemas use only keywords the validator checks")`: `validate(schema, fixture)`
    does not throw for either schema (the validator throws on unknown keywords).
- [ ] Run `bun test src/formats.test.ts` → **expected failure** until the files exist; then
  **expected pass**.
- [ ] `bun test` → suite green.
- [ ] Commit: `docs(formats): publish the review input and result formats with their schemas`.

### Task 3: make the pipeline read its head directory and change description from its context (in place)

No move yet; the golden test proves the prompt is unchanged.

- [ ] In `src/engine.ts`:
  - `ReviewContext` becomes
    `{ describe: string; headSha: string; headDir: string; since: string | null; rebased?: boolean; paths: string[]; dropped: number; everyFile: string; meta: { title?: string; body?: string; author?: string }; instructions: string }`.
    `buildBatchPrompt`'s first line becomes
    ``You are reviewing ${ctx.describe}, checked out at its head commit ${ctx.headSha}.`` and
    `reviewBatch` writes `pr.json` as `{ title: ctx.meta.title, body: ctx.meta.body, author: ctx.meta.author }`.
    In `review()`, build `describe: \`pull request #${pr} in ${repo}\``, `headDir: deps.repoDir ?? process.cwd()`,
    `meta: { title: meta.title, body: meta.body, author: meta.author?.login }`.
  - Split `Deps`:

    ```ts
    /** What the review core needs from outside: the agent and the engine's own I/O. No GitHub. */
    export interface CoreDeps {
      provider: ProviderAdapter;
      log: (line: string) => void;
      warn: (line: string) => void;
      lineCounter?: LineCounter;
      sleep?: (ms: number) => void;
      rateLimitBackoffMs?: number;
      git?: GitRunner;
      now?: () => number;
      costs?: CallCost[];
      /** `readVersion()` from the CLI; "unknown" when absent. */
      engineVersion?: string;
    }
    /** `CoreDeps` plus GitHub and the settings: what `review`, `comment`, `threads` and `answer` need. */
    export interface Deps extends CoreDeps {
      gh: GhFn;
      config: EngineConfig;
      repoDir?: string;
    }
    ```

    Keep every existing doc comment on the moved fields.
  - `runProvider(deps: CoreDeps, limits: Pick<EngineConfig, "maxTurns" | "callTimeoutS" | "model" | "trigger">, cwd: string, what, prompt, dir, budgetUsd, schema?)`:
    `cwd` replaces `deps.repoDir ?? process.cwd()`, `limits.*` replaces `deps.config.*`. Update
    the three callers (`reviewBatch`, `threadReplies`, `answer`): the last two pass
    `deps.config` and `deps.repoDir ?? process.cwd()`.
  - `gatherEvidence(deps: CoreDeps, headDir: string, files, dir)` uses `headDir` instead of
    `deps.repoDir ?? process.cwd()`.
  - `reviewBatch(deps: CoreDeps, limits: Pick<EngineConfig, "maxTurns" | "callTimeoutS" | "model" | "trigger">, ctx, files, threads, part, budgetUsd)`:
    `ctx.headDir` replaces every `deps.repoDir ?? process.cwd()`; the two `deps.config.maxTurns`
    / `deps.config.callTimeoutS` warnings read `limits`. `reviewBatchBackingOff` forwards the
    new parameter (`const [deps, , , , , part] = args;` shifts by one; check the index).
  - `review()` passes `deps` (a `Deps` is a `CoreDeps`) and `config` to both.
- [ ] Update `scripts/prompt-golden.ts`: `ctx = { describe: "pull request #7 in o/r", headSha: …, headDir: "/tmp/head", since: null, … meta: { title: "t", body: "b" }, … }`.
  Run `bun test src/questions/prompt-unchanged.test.ts` → **expected pass** (the fixture is unchanged).
- [ ] Run the three fake files → **expected pass** (golden identical). If the golden differs, the
  first line of the prompt is the only legitimate suspect; `describe` must produce exactly
  `pull request #7 in o/r`.
- [ ] `bun test` → suite green.
- [ ] Commit: `refactor(engine): the batch pipeline reads its head directory and change description from its context`.

### Task 4: extract `reviewChange` and leave `review()` as connector plus sink

- [ ] Add to `src/engine.ts`, above `review()`:

  ```ts
  export interface ReviewOptions {
    /** `min(config.budgetUsd, ceiling room)` in GitHub mode; `config.budgetUsd` for a local run. */
    totalBudgetUsd: number;
    batchBudgetUsd: number;
    batchLines: number;
    batchChars: number;
    /** On top of `DEFAULT_EXCLUDE`. */
    exclude: string[];
    maxTurns: number;
    callTimeoutS: number;
    model: string;
    effort: Effort;
    trigger?: Trigger;
    profile: Profile;
  }

  /** Today's settings as the core's options. */
  export function reviewOptionsOf(config: EngineConfig, totalBudgetUsd: number, profile: Profile = "ci"): ReviewOptions { … }

  /**
   * The review core (ADR 0019 decision 1): from a `ReviewInput` to a `ReviewResult`, with no
   * knowledge of where the change came from or where the result goes. Filtering, scope, batching,
   * instructions rendering, evidence, data-path questions, the prompt, the provider calls, output
   * checks, coverage, the one retry, budget arithmetic, merging, the confidence rule, dedupe, the
   * ADR notices, the anchors and the "not reached" skips are here. Posting is not.
   */
  export function reviewChange(input: ReviewInput, options: ReviewOptions, deps: CoreDeps): ReviewResult
  ```

  Body, in this order (move the code; do not retype it):
  1. `assertReviewInputFormat(input)`; `const started = Date.now()`; `notices: string[]`; wrap
     `warn` so every notice is pushed and forwarded; `calls` counter: wrap `deps` in
     `{ ...deps, warn, costs }` where `costs` is `deps.costs ?? []`, and count calls as
     `costs.length - before` (or count in a local `runProvider` wrapper; either, but `calls`
     must equal the number of `provider.run` invocations, retries included).
  2. `filterFiles(input.files, [...DEFAULT_EXCLUDE, ...options.exclude], input.scope)` → `kept`,
     `dropped`. (The "Nothing to review" exit stays in `review()`: it is a GitHub body. The core
     with `kept.length === 0` returns a result with `coverage.expected: []`, `stop: "complete"`,
     `callsWithOutput: 0`, no calls; `review()` never reaches it in that case.)
  3. `planBatches`, `assignThreads(input.conversation ?? [], batches)`, `everyFile`, the
     `ReviewContext` (`describe: input.change.describe`, `headSha: input.change.head.sha`,
     `headDir: input.headDir`, `since: input.since?.sha ?? null`, `rebased: input.since?.rebased`,
     `paths: input.scope`, `meta: { title, body: input.change.description, author }`,
     `instructions: renderInstructions(input.instructions)`).
  4. The batch loop from `review()` lines 2072–2191 verbatim, with `totalBudget = options.totalBudgetUsd`,
     `batchBudget = options.batchBudgetUsd`, `reviewBatchBackingOff(deps, options, context, …)`.
  5. After the loop, when `parts.length > 0`: `mergeOutputs`, `enforceConfidenceRule` (log line
     unchanged), the `dedupeFindings([...adrNotices(kept names), ...ruled.findings])`, the
     `notRun` and `rejectedFiles` pushes into `files_skipped` with today's exact reason strings.
     Then `anchor`: `const commentable = new Map(kept.map((f) => [f.filename, commentableLines(f.patch ?? "")]))`
     and `findings = merged.findings.map((f) => ({ ...f, anchor: commentable.get(f.path)?.has(f.line) ? "diff" : "outside" }))`.
     Thread replies: `merged.thread_replies.filter((r) => known.has(r.comment_id))` with `known`
     from `input.conversation`.
     When `parts.length === 0`: empty findings, contracts, summary `""`, reviewed `[]`, skipped =
     the `notRun` and `rejectedFiles` entries.
  6. Build the result: `change: input.change`; `engine: { version: deps.engineVersion ?? "unknown" }`;
     `provider: { label: deps.provider.modelLabel(), model: options.model, effort: options.effort, profile: options.profile }`;
     `coverage.expected = kept names`, `reviewed`, `skipped`, `excluded: dropped.length`,
     `partial: expected.some((f) => !reviewedSet.has(f))`; `batches: reports`;
     `instructionChanges: { files: changedInstructionFiles(input.files.map((f) => f.filename)), baseSha: input.instructions.baseSha }`;
     `execution: { costUsdEstimate: spent, usage, calls, callsWithOutput: parts.length, turns: sum of reports' turns, durationMs: Date.now() - started, stop, rejection, notices }`
     with `stop` per decision 5 (`rejection` is `rejection ?? (otherError ? { kind: "other", text: otherError } : undefined)`).
- [ ] Add `githubReviewInput(...)`, exported, pure:

  ```ts
  export function githubReviewInput(p: {
    repo: string; pr: number; headSha: string; baseSha: string;
    meta: { title?: string; body?: string; author?: { login?: string } | null };
    files: PrFile[]; instructions: BaseInstructions; headDir: string; scope: string[];
    since: string | null; rebased: boolean; threads: Thread[];
  }): ReviewInput {
    return {
      format: REVIEW_INPUT_FORMAT,
      change: {
        kind: "pull-request",
        describe: `pull request #${p.pr} in ${p.repo}`,
        repository: { name: p.repo, url: `https://github.com/${p.repo}` },
        base: { sha: p.baseSha }, head: { sha: p.headSha },
        title: p.meta.title, description: p.meta.body, author: p.meta.author?.login ?? undefined,
        identifier: `#${p.pr}`,
      },
      files: p.files, instructions: p.instructions, headDir: p.headDir, scope: p.scope,
      ...(p.since ? { since: { sha: p.since, rebased: p.rebased } } : {}),
      ...(p.threads.length > 0 ? { conversation: p.threads } : {}),
    };
  }
  ```

  Note `baseSha`: `review()` today calls `baseSha(gh, repo, pr)` for the instructions; reuse that
  value (one call, as today; do not add a second `gh` call, the fake `gh`s count calls in the
  ceiling tests).
- [ ] Add `githubReview(result, github)`, exported:

  ```ts
  export function githubReview(result: ReviewResult, github: {
    since: string | null; rebased: boolean; scoped: boolean; mention: string; automatic: boolean;
    /** Computed by the connector from every file of the pull request (spec correction 3). */
    instructionChanges: { files: string[]; baseSha: string };
  }): Review {
    return buildReview({
      output: {
        files_reviewed: result.coverage.reviewed, files_skipped: result.coverage.skipped,
        findings: result.findings, contracts: result.contracts,
        thread_replies: result.threadReplies, summary: result.summary,
      },
      files: result.coverage.expected.map((filename) => ({ filename, additions: 0, deletions: 0 })),
      headSha: result.change.head.sha, since: github.since, rebased: github.rebased, scoped: github.scoped,
      costUsd: result.execution.costUsdEstimate, usage: result.execution.usage,
      operation: github.since ? "re-review" : "review", batches: result.batches,
      modelLabel: result.provider.label, effort: result.provider.effort,
      automatic: github.automatic, mention: github.mention, instructionChanges: github.instructionChanges,
    });
  }
  ```

  In `buildReview`, type `output.findings` as `(Finding & { anchor?: "diff" | "outside" })[]` (the
  parameter type: `output: Omit<ReviewOutput, "findings"> & { findings: (Finding & { anchor?: … })[] }`)
  and change the anchoring line to
  `const onLine = f.anchor ? f.anchor === "diff" : commentable.get(f.path)?.has(f.line);`.
  Nothing else in `buildReview` changes.
- [ ] Rewrite the tail of `review()` (from `const { kept, dropped } = filterFiles(` to the end):
  keep the "Nothing to review" exit, `ceilingRoom`, `readBaseInstructions` (through `gh`, with
  the one `baseSha` call), `openThreads`; then

  ```ts
  const input = githubReviewInput({ repo, pr, headSha, baseSha: base, meta, files, instructions, headDir: deps.repoDir ?? process.cwd(), scope: paths, since, rebased, threads });
  const result = reviewChange(input, reviewOptionsOf(config, Math.min(config.budgetUsd, room)), deps);
  if (result.execution.callsWithOutput === 0) { /* today's lines 2193–2240, reading result.execution.rejection, .stop; `limitError && !budgetError` is `stop === "turns" || stop === "timeout"`, `budgetError` is `stop === "budget"`; the throw's `otherError` is `rejection?.kind === "other" ? rejection.text : undefined` */ }
  const built = githubReview(result, { since, rebased, scoped: paths.length > 0, mention: config.mention, automatic: isAutomatic(config.trigger), instructionChanges: { files: changedInstructionFiles(prFiles.map((f) => f.filename)), baseSha: instructions.baseSha } });
  refuseLeak(deps, [built.body, ...built.comments.map((c) => c.body), ...result.threadReplies.map((r) => r.reply)]);
  postReview(deps, repo, pr, headSha, built);
  for (const r of result.threadReplies) { /* unchanged */ }
  ```

  The notice texts in the `callsWithOutput === 0` branch must stay byte-identical: copy them.
  `review()` must not call `filterFiles` again; the "Nothing to review" check needs `kept`
  before the paid steps, so call `filterFiles` once in `review()` for that exit and let the core
  filter again (same pure function, same result). Decided in plan: a second `filterFiles` costs
  nothing and keeps the core self-contained.
- [ ] `src/cli.ts`: add `engineVersion: readVersion()` to `deps`.
- [ ] Run the three fake files → **expected pass**, golden identical, every posted body identical
  (the existing assertions). Run `bun test src/engine.test.ts` → **expected pass** (`buildReview`
  unchanged for callers without `anchor`).
- [ ] `bun test` → suite green.
- [ ] Commit: `refactor(engine): extract reviewChange behind a source port and a sink port`.
  Body: what moved, what stayed in `review()`, "prompts and bodies byte-identical: golden
  fixtures unchanged in this commit".

### Task 5: test the core from a `ReviewInput` with no GitHub at all

- [ ] Create `src/review-core.fake.test.ts` with its own `FakeProvider` (copy the class; it does
  not record goldens) and a `branchInput()` builder from `test/fixtures/formats/review-input.branch.json`
  plus `headDir: mkdtempSync(…)` holding the files the fixture's patches describe (so
  `repoLineCounter` and `relativisePaths` have something real). `deps` is built as

  ```ts
  const deps = new Proxy({ provider, log: () => {}, warn: (l: string) => warnings.push(l) } as CoreDeps, {
    get(target, prop) {
      if (!(prop in target)) throw new Error(`the core reached for deps.${String(prop)}`);
      return Reflect.get(target, prop);
    },
    has: (target, prop) => prop in target,
  });
  ```

  Note: optional fields (`lineCounter`, `git`, `now`, `costs`, `sleep`, `rateLimitBackoffMs`,
  `engineVersion`) are read with `deps.x ?? default`, which the proxy would throw on. Set them
  explicitly to `undefined` in the target (`lineCounter: undefined, …`) so `in` is true; the only
  name that must throw is `gh` (and `config`, `repoDir`).
- [ ] Tests:
  - `test("reviews a branch input end to end and never touches gh")`: two files, one patch-less;
    the provider reviews one and skips the binary; assert `result.format`, `coverage` (`expected`
    2, `reviewed` 1, `skipped` has the binary with reason `binary`, `partial: true`, `excluded` 0),
    `findings[0].anchor === "diff"` for a finding on an added line and `"outside"` for line 0,
    `batches[0].status === "reviewed"`, `execution.calls === 1`, `callsWithOutput === 1`,
    `stop === "complete"`, `provider.profile === "ci"`, `engine.version === "unknown"`,
    `threadReplies` empty, and that the prompt starts with
    ``You are reviewing branch `feat/x` of repo against main (merge-base 1234567), checked out at its head commit``.
  - `test("the result survives JSON and validates against the result schema")`: run `validate`
    from `test/support/json-schema.ts` on the result; `JSON.parse(JSON.stringify(result))` deep-equals it.
  - `test("a stop with no output: budget, turns, timeout, error")`: four runs with a provider
    answering `terminalReason: "budget"` / `"turns"` / `"timeout"` / `{ isError: true, terminalReason: "error" }`;
    assert `stop` and `callsWithOutput === 0`; the `error` case with
    `providerError: "billing", errorText: "credit balance too low"` yields `stop: "quota"` and
    `rejection.kind === "billing"`; with `providerError: "auth"` yields `stop: "error"` and
    `rejection.kind === "auth"`.
  - `test("budget spent after the first batch: the rest is not reached and partial is true")`:
    two batches (`batchLines: 1`), `totalBudgetUsd: 0.1`, first call costs 0.09 → second batch
    `status: "not run: budget spent"`, `skipped` has its file with the exact reason
    `not reached: the pull request's budget was spent`, `stop: "complete"`, `partial: true`.
  - `test("an unknown format is a usage error before any call")`: `format: "wachiman.review-input/2"`
    → throws `UsageError`; `provider.requests` empty.
  - `test("a scope that matches nothing reviews nothing and calls nothing")`: `scope: ["nope/"]`
    → `coverage.expected` `[]`, `calls` 0.
  - `test("conversation ids the model did not get are dropped from threadReplies")`.
- [ ] Run the file → **expected failure** before the file exists, **expected pass** after.
- [ ] `bun test` → suite green.
- [ ] Commit: `test(engine): review the core from a ReviewInput with no GitHub at all`.

### Task 6: remove each batch's run directory after the call (the one behaviour change)

- [ ] In `src/engine.fake.test.ts`, the two tests at lines 1309 and 1337 ("evidence.json is
  written to the run dir …" and "a failing git never fails the review …"): move the
  `readFileSync(join(runDir, "evidence.json"))` into the provider step, i.e. change `run(git)` to
  accept an `onCall?: (request) => void` that the `FakeProvider` step calls before answering, and
  read the file there into a variable the assertions use. The assertions themselves do not change.
- [ ] Add to the same file:
  - `test("the run directory is removed after the call, on success")`: after `review()`,
    `existsSync(provider.requests[0].addDirs[0])` is false, while `existsSync` inside the step was
    true (the file was readable during the call).
  - `test("the run directory is removed when the provider throws")`: provider step throws;
    `review()` ends with the "did not return a review" error (as today); `addDirs[0]` is gone.
- [ ] Run → **expected failure** (directories still exist).
- [ ] Implement: in `reviewBatch`, wrap everything after `const dir = mkdtempSync(…)` in
  `try { … } finally { rmSync(dir, { recursive: true, force: true }); }` (import `rmSync`).
  Nothing reads the directory after the provider returns (`checkOutput`, `relativisePaths`,
  `repoLineCounter` read the head, not the run dir).
- [ ] Run → **expected pass**; the three fake files' goldens unchanged (the prompt is built before
  the call).
- [ ] `bun test` → suite green.
- [ ] Commit: `fix(engine): remove each batch's run directory after the call` with a body that
  says it is the one behaviour change of the extraction (spec "Failures this must protect
  against": company code left in temporary directories) and that the `threads` and `answer`
  directories are not covered yet.

### Task 7: documentation that matches the code

- [ ] `docs/architecture.md`:
  - In "The flow" diagram, after `filterFiles --> planBatches`, show the seams: a line
    `ReviewInput ──► reviewChange() ──► ReviewResult` with `github connector` feeding the input
    and `GitHub sink (buildReview, refuseLeak, postReview, replies)` consuming the result. Keep
    the existing boxes; add the two labels, do not redraw.
  - New section "## The review core and its ports" after "The pipeline, stage by stage": one
    paragraph each on `ReviewInput` (what is required: `change.describe`, `change.head.sha`,
    `change.base.sha`, `files[].filename/additions/deletions`, `instructions`, `headDir`, `scope`;
    what is optional and why, with a link to `docs/formats/README.md`), `reviewChange` (what is
    inside, in today's names, taken from the spec's "In the core" list), `ReviewResult` (the
    `stop` semantics from decision 5, `callsWithOutput`, the API-equivalent estimate), the GitHub
    sink (`githubReview` → `buildReview`, plus the facts only GitHub knows: `since`, `rebased`,
    `scoped`, `mention`, `automatic`, `instructionChanges`), and the run directory lifetime.
    State plainly: "Only the GitHub connector and sink exist on `main`; the local connector and
    the terminal, Markdown and JSON sinks are PR L."
  - "Invariants a change must keep": add "The core (`reviewChange`) has no `gh` in its
    dependencies and makes no network call of its own; the only senders are `defaultGh` and the
    provider adapter." and "Each batch's run directory is removed after its call."
- [ ] `docs/adr/0019-…md`: status line → "proposed 2026-11-03; the extraction (decision 1, the
  GitHub sink of decision 3, the formats of decision 9) is implemented by PR #<E>; the local
  connector, the other sinks, the subscription mode and the `local` command are not on `main`."
  Fix the consequences bullet (spec correction 7) to list what the engine actually gained.
- [ ] `docs/specs/2026-11-03-local-review-design.md`: status line → "Extraction (PR E) merged as
  #<E> on <date>; L and G not started." Tick the four **(E)** acceptance boxes, each with the
  test name that proves it. Add the two spec corrections that change its text (1 and 2 above) as
  a short "Amendments" list under the result format.
- [ ] `docs/formats/README.md`: link from `docs/architecture.md` and `docs/cli.md`'s "Providers"
  paragraph (one sentence each).
- [ ] `bun test` → suite green (`test/review-on-push.test.ts` reads docs; nothing else does).
- [ ] Commit: `docs: describe the review core and its ports`.

### Task 8: final check before the PR leaves draft

- [ ] `bun test` twice (determinism); `WACHI_UPDATE_GOLDEN=1 bun test src/engine.fake.test.ts src/ceiling.fake.test.ts src/threads.fake.test.ts && git -C <worktree> status --short test/fixtures/golden-prompts` prints nothing: regenerating the goldens on the final code changes no fixture. This is the (E) golden criterion in one command.
- [ ] `git -C <worktree> diff origin/main --stat` and read the `src/engine.ts` diff once more for
  any retyped line (moved code should show as deletions and additions of identical text).
- [ ] Update the PR body: the one behaviour change, the fixture size, and the four (E) criteria
  with their tests.

## Risks

- **A prompt difference the golden cannot see.** The goldens cover every prompt the fake tests
  produce; a path through `review()` no fake test exercises (for example a thread on a file in a
  later batch) is covered only by reading the diff. Mitigation: Task 8's "moved, not retyped"
  read, and PR L's parity (b) test on a real pull request.
- **The golden fixtures are large and change with every intended prompt edit.** Accepted; the
  README says a regenerate is a reviewed diff. If the size is over 3 MB, stop and ask.
- **Bun version drift.** Local Bun is 1.4.2, CI 1.3.4. `Proxy` with `has`, `structuredClone`-free
  code and `rmSync` behave the same; run CI before un-drafting.
- **The `buildReview` anchor fallback** is two code paths for one decision. Accepted for this PR
  (spec correction 6); PR L may drop the fallback once every caller passes anchors.

## Stop condition

Stop and ask the owner (do not work around) if any of these happens:

- A golden prompt differs after Task 3 or Task 4 and the difference is not the run-directory
  placeholder: the move changed the prompt.
- A posted body in any fake test differs: the sink mapping lost a fact (`usage`, `operation`,
  `instructionChanges`, the skip reasons).
- `review()` needs a second `gh` call to build the input: the connector boundary is in the wrong
  place.
- A `CoreDeps` field turns out to need `gh` or `config`: the spec's cut is wrong, not the plan.

## Not in this plan

- Cleanup of `agent-threads-` and `agent-answer-` run directories (two thread tests read
  `threads.json` after the run; a 20-line follow-up with its own test changes).
- The source-neutral wording of the `annotateDiff` notice and of the "pull request's budget"
  skip reason (a golden re-record; decide with PR L's parity results in hand).
- A supported way to force a full review in a GitHub dry run: PR L, Task 8 (cheap: a config flag
  honoured only with `AGENT_REVIEW_DRY_RUN=1`).
