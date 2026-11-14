/**
 * `wachiman ask` (ADR 0032, decisions 1, 6, 7 and 8): one question about the local change, or its
 * walkthrough when no question is given. It is the same core a pull request comment uses, fed with
 * the change the scope flags select and with the latest stored review of that change (ADR 0020).
 *
 * One provider call, on the signed-in `claude` as `local` runs (ADR 0019 decision 4), and no GitHub
 * call: this module never builds a `gh` function. The command never runs a review. It reads the
 * repository, reads the history store, and writes its material to a temporary directory it removes.
 *
 * Exit codes: 0 answered (an answer that says what it could not answer is still an answer); 1 no
 * answer (the call failed, or its output was not an answer); 2 usage error; 130 after Ctrl-C.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { wachimanHome } from "./accounts/config";
import { ASK_SCHEMA, buildAskPrompt, checkRefs, isAskAnswer, renderAnswer } from "./ask";
import { repoLineCounter } from "./contracts";
import { UsageError } from "./config";
import { annotateDiff, DEFAULT_EXCLUDE, filterFiles, renderInstructions, runProvider, type ReviewInput, type ReviewResult } from "./engine";
import { historyRoot, readRuns, repositoryKey } from "./history/store";
import { type LocalArgs, type LocalDeps, localScopeInput, openLocalSession, parseFlags } from "./local";
import { costSentence } from "./sinks/common";
import { renderJson } from "./sinks/json";
import { renderMarkdown } from "./sinks/markdown";

export const ASK_FORMAT = "wachiman.ask-result/1";

export const askUsage = `wachiman ask [question…] [--base <ref> | --from <commit> | --commit <commit> | --working-tree staged|all]
               [--max-depth <n>] [--repo-dir <dir>] [--profile <name>]
               [--format terminal|markdown|json] [--output <file>]`;

/** The flags `ask` takes: the scope flags `local` has, and the output and account ones. */
const ASK_FLAGS = ["--base", "--from", "--commit", "--working-tree", "--max-depth", "--profile", "--format", "--output"] as const;

export interface AskArgs extends LocalArgs {
  /** The question's words joined with spaces; "" asks for the walkthrough. */
  question: string;
}

/** The arguments after `ask` (`--repo-dir` is already taken out). Every word that is not a flag is the question. */
export function parseAskArgs(argv: string[]): AskArgs {
  const args = parseFlags(argv, "ask", ASK_FLAGS);
  return { ...args, paths: [], question: args.paths.join(" ").trim() };
}

export const NO_REVIEW_NOTICE =
  'No stored review of this change: answering from the diff alone. Run "wachiman local --history" first to ground answers in a review.';

/**
 * The latest stored review of this change, or undefined. It must be of the same repository (the
 * store's key), the same kind of change, the same base and head commits (a tree for `--working-tree`),
 * and the same files kept for review. A review of another range, another head or another scope is
 * not this change, so it is not used.
 */
export function storedReviewOf(
  root: string,
  repoDir: string,
  input: ReviewInput,
  keptFiles: string[],
  warn: (line: string) => void,
): ReviewResult | undefined {
  const runs = readRuns(root, repositoryKey(repoDir).key, warn);
  const files = [...keptFiles].sort();
  for (let i = runs.length - 1; i >= 0; i--) {
    const { result } = runs[i];
    if (
      result.change.kind !== input.change.kind ||
      result.change.base.sha !== input.change.base.sha ||
      result.change.head.sha !== input.change.head.sha
    )
      continue;
    // The files the review was given: its expected ones and the binaries it left out of them.
    const expected = [...result.coverage.expected, ...(result.coverage.unreviewable ?? []).map((u) => u.path)].sort();
    if (expected.length === files.length && expected.every((f, j) => f === files[j])) return result;
  }
  return undefined;
}

export async function runAsk(
  args: AskArgs,
  repoDir: string,
  env: Record<string, string | undefined>,
  io: {
    stdout: (text: string) => void;
    stderr: (line: string) => void;
    engineVersion: string;
  },
  deps: LocalDeps = {},
): Promise<number> {
  // The account, the provider and the settings are checked before the change is read, as `local` does.
  const { config, provider, state } = openLocalSession({
    profile: args.profile,
    verify: false,
    repoDir,
    env,
    stderr: io.stderr,
    deps,
  });
  const onSigint = () => {
    state.interrupted = true;
  };
  process.on("SIGINT", onSigint);
  let release: (() => void) | undefined;
  let material: string | undefined;
  try {
    const scope = localScopeInput({
      repoDir,
      workingTree: args.workingTree,
      base: args.base,
      commit: args.commit,
      from: args.from,
      maxDepth: args.maxDepth,
      paths: args.paths,
      log: io.stderr,
      warn: io.stderr,
    });
    release = scope.release;
    const { input } = scope;
    // The same files the review would send (its excludes and its scope), so both read one change.
    const { kept, dropped } = filterFiles(input.files, [...DEFAULT_EXCLUDE, ...config.exclude], input.scope);
    if (kept.length === 0) {
      throw new UsageError(`No file in this scope is kept for review (${dropped.length} excluded): there is nothing to ask about.`);
    }

    material = mkdtempSync(join(tmpdir(), "wachiman-ask-"));
    writeFileSync(join(material, "ask.diff"), annotateDiff(kept));
    writeFileSync(
      join(material, "ask.json"),
      `${JSON.stringify(
        {
          change: input.change.describe,
          kind: input.change.kind,
          scope: input.scope,
          files: kept.map((f) => ({ path: f.filename, additions: f.additions, deletions: f.deletions })),
          excludedFiles: dropped.length,
        },
        null,
        2,
      )}\n`,
    );
    const stored = storedReviewOf(historyRoot(wachimanHome(env)), repoDir, input, kept.map((f) => f.filename), io.stderr);
    if (stored) {
      writeFileSync(join(material, "review.json"), renderJson(stored, 2));
      writeFileSync(join(material, "review.md"), renderMarkdown(stored));
    } else io.stderr(NO_REVIEW_NOTICE);

    const prompt = buildAskPrompt({
      changeDescription: `the local change in repository ${input.change.repository.name}: ${input.change.describe}`,
      materialPaths: {
        meta: join(material, "ask.json"),
        diff: join(material, "ask.diff"),
        review: stored ? join(material, "review.md") : undefined,
      },
      instructions: renderInstructions(input.instructions),
      question: args.question,
      hasReview: stored !== undefined,
      local: true,
    });

    // One call, read-only, in the snapshot of the head: the same place the review reads from.
    let result: Awaited<ReturnType<typeof runProvider>> | undefined;
    let failure = "";
    try {
      result = await runProvider(
        { provider, log: io.stderr, warn: io.stderr },
        config,
        input.headDir,
        { operation: "on-demand", label: args.question ? "question" : "walkthrough" },
        prompt,
        material,
        config.answerBudgetUsd,
        ASK_SCHEMA,
      );
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    if (state.interrupted) {
      io.stderr("Interrupted: the answer was not produced.");
      return 130;
    }
    const parsed = result && !result.isError ? result.structuredOutput : undefined;
    if (!result || !isAskAnswer(parsed)) {
      const reason = result ? (result.isError ? result.terminalReason || "the call failed" : "its output was not an answer") : failure;
      io.stderr(`Wachiman could not answer (${reason}).`);
      return 1;
    }

    // A reference is kept only if its file exists in the head snapshot and the line is in the file.
    const lineCount = repoLineCounter(input.headDir);
    const checked = checkRefs(parsed, (path, line) => {
      const count = lineCount(path);
      return count !== null && line <= count;
    });
    const cost = { costUsdEstimate: result.costUsd, calls: 1, turns: result.turns, durationMs: result.durationMs };
    const text =
      args.format === "json"
        ? `${JSON.stringify(
            {
              format: ASK_FORMAT,
              question: args.question,
              walkthrough: args.question === "",
              hasReview: stored !== undefined,
              sections: checked.answer.sections.map((s) => ({
                title: s.title,
                body: s.body,
                refs: s.refs.map((r) => ({ path: r.path, line: r.line })),
              })),
              notAnswered: checked.answer.not_answered,
              removedRefs: checked.removed,
              provider: { label: provider.modelLabel(), model: config.model, costUsd: result.costUsd },
            },
            null,
            2,
          )}\n`
        : `${renderAnswer(checked.answer, {
            removed: checked.removed,
            style: args.format === "markdown" ? "markdown" : "plain",
          })}\n\n${costSentence(cost)}\n`;
    if (args.output !== undefined) {
      const path = resolve(args.output);
      writeFileSync(path, text);
      io.stderr(`report: ${path}`);
    } else io.stdout(text);
    return 0;
  } finally {
    process.off("SIGINT", onSigint);
    release?.();
    if (material !== undefined) rmSync(material, { recursive: true, force: true });
  }
}
