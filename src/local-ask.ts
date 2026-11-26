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
import { type AskAnswer, askSchema, buildAskPrompt, checkRefs, isAskAnswer, renderAnswer } from "./ask";
import { repoLineCounter } from "./contracts";
import { UsageError } from "./config";
import { askDistributed, type ResolvedSibling } from "./distributed";
import { askErrorOf, reportRun, runOfAsk } from "./telemetry/report";
import { annotateDiff, DEFAULT_EXCLUDE, filterFiles, renderInstructions, runProvider, type ReviewInput, type ReviewResult } from "./engine";
import { historyRoot, readRuns, repositoryKey } from "./history/store";
import { type LocalArgs, type LocalDeps, localScopeInput, openLocalSession, parseFlags } from "./local";
import { checkSiblingReferences, countable } from "./sibling-references";
import { costSentence, manifestText, privateNote } from "./sinks/common";
import { renderJson } from "./sinks/json";
import { renderMarkdown } from "./sinks/markdown";
import { rematerialiseSiblings } from "./workspace/ask";
import { workspaceGit } from "./workspace/git";
import { decideDistributed, homeRelative } from "./workspace/run";

export const ASK_FORMAT = "wachiman.ask-result/1";

export const askUsage = `wachiman ask [question…] [--base <ref> | --from <commit> | --commit <commit> | --working-tree staged|all]
               [--max-depth <n>] [--repo-dir <dir>] [--profile <name>]
               [--format terminal|markdown|json] [--output <file>] [--distributed-repo]`;

/** The flags `ask` takes: the scope flags `local` has, and the output and account ones. */
const ASK_FLAGS = [
  "--base",
  "--from",
  "--commit",
  "--working-tree",
  "--max-depth",
  "--profile",
  "--format",
  "--output",
  "--distributed-repo",
] as const;

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

const RUN_LOCAL_FIRST = 'Run "wachiman local --distributed-repo --history" first.';

/**
 * The flag rules of "`ask` and history" (ADR 0043 decision 5). `ask` selects no sibling: it reads what the
 * stored review read. `--distributed-repo` on a change whose stored review read no sibling, or has none, is a
 * usage error. A per-user default of `on` in that situation does nothing, and one line says so.
 */
function checkDistributedFlag(
  args: AskArgs,
  stored: ReviewResult | undefined,
  repoDir: string,
  home: string,
  io: { stderr: (line: string) => void },
) {
  if ((stored?.siblings ?? []).length > 0) return;
  const why = stored === undefined ? "there is no stored review of this change" : "the stored review of this change read no sibling";
  if (args.distributedRepo === true) {
    throw new UsageError(`--distributed-repo reads only what a stored review read, and ${why}. ${RUN_LOCAL_FIRST}`);
  }
  let decision;
  try {
    decision = decideDistributed({ flag: undefined, siblings: [], repoDir, home, git: workspaceGit, warn: io.stderr });
  } catch {
    return; // The line is a courtesy: a broken workspace file never fails an answer.
  }
  if (decision.on) {
    io.stderr(
      `distributed-repo: on (default from ${homeRelative(decision.defaultFile!)}) does nothing for ask: it reads only what a stored review read, and ${why}. ${RUN_LOCAL_FIRST}`,
    );
  }
}

/** One note per sibling the answer could not read again, to print under it. */
function notReadNotes(siblings: readonly ResolvedSibling[]): string[] {
  const seen = new Set<string>();
  const notes: string[] = [];
  for (const s of siblings) {
    if (s.dir !== undefined && s.sha !== undefined && s.status === "read") continue;
    const name = `${manifestText(s.member)}${s.sha ? `@${s.sha.slice(0, 7)}` : ""}`;
    if (seen.has(name)) continue;
    seen.add(name);
    notes.push(
      `Could not read sibling ${name}: ${manifestText(s.unreadable ?? "unknown reason")}. A reference into it is removed and counted.`,
    );
  }
  return notes;
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
    scope: { workingTree: args.workingTree, base: args.base, commit: args.commit, from: args.from, maxDepth: args.maxDepth },
  });
  const onSigint = () => {
    state.interrupted = true;
  };
  process.on("SIGINT", onSigint);
  let release: (() => void) | undefined;
  let releaseSiblings: (() => void) | undefined;
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
    const home = wachimanHome(env);
    const stored = storedReviewOf(
      historyRoot(home),
      repoDir,
      input,
      kept.map((f) => f.filename),
      io.stderr,
    );
    // The flag rules come before anything is written or paid for.
    checkDistributedFlag(args, stored, repoDir, home, io);
    // A review that read siblings is answered on the same evidence: their snapshots are re-created at the stored
    // commits, flag or not. Never fetches; a sibling that cannot be read again is named, not fatal.
    const rematerialised = stored?.siblings?.length
      ? rematerialiseSiblings(stored.siblings, { repoDir, home, warn: io.stderr })
      : undefined;
    releaseSiblings = rematerialised?.release;
    const siblings = rematerialised?.siblings ?? [];
    const sibling = askDistributed(siblings);
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
      siblings: sibling.section,
    });
    // A review that listed siblings may be answered with a reference into one, even when none could be read again: that reference is then removed and counted.
    const schema = askSchema(siblings.length > 0);

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
        schema,
        sibling.dirs,
      );
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    if (state.interrupted) {
      io.stderr("Interrupted: the answer was not produced.");
      return 130;
    }
    const parsed = result && !result.isError ? result.structuredOutput : undefined;
    if (!result || !isAskAnswer(parsed, schema)) {
      const reason = result ? (result.isError ? result.terminalReason || "the call failed" : "its output was not an answer") : failure;
      io.stderr(`Wachiman could not answer (${reason}).`);
      await reportRun(
        runOfAsk({
          model: config.model,
          kept,
          usage: result?.usage,
          durationMs: result?.durationMs ?? 0,
          error: askErrorOf(result),
          failed: true,
        }),
        { env, home: () => home, version: io.engineVersion },
      );
      return 1;
    }

    // A reference is kept only if its file exists in the head snapshot and the line is in the file; one into a
    // sibling, only if the member is one this answer read, the commit is its snapshot's and the line is in it.
    const lineCount = repoLineCounter(input.headDir);
    const readable = siblings.filter((s) => s.dir !== undefined && s.sha !== undefined && s.status === "read");
    const siblingCounters = new Map<string, ReturnType<typeof repoLineCounter>>();
    const siblingOf = (member: string, sha: string) =>
      sha.length >= 7 ? readable.find((s) => s.member === member && s.sha!.startsWith(sha)) : undefined;
    const checkedRefs = checkRefs(parsed, (path, line, ref) => {
      if (ref.member === undefined && ref.sha === undefined) {
        const count = lineCount(path);
        return count !== null && line <= count;
      }
      const found = ref.member !== undefined && ref.sha !== undefined ? siblingOf(ref.member, ref.sha) : undefined;
      if (!found) return false;
      let counter = siblingCounters.get(found.dir!);
      if (!counter) siblingCounters.set(found.dir!, (counter = repoLineCounter(found.dir!)));
      const count = countable(counter(path));
      return count !== null && line <= count;
    });
    // The kept ones name their commit in full; then the text is checked for `member@sha:path:line`, whose removals count too.
    let answer: AskAnswer = {
      ...checkedRefs.answer,
      sections: checkedRefs.answer.sections.map((section) => ({
        ...section,
        refs: section.refs.map((r) =>
          r.member !== undefined && r.sha !== undefined ? { ...r, sha: siblingOf(r.member, r.sha)!.sha! } : r,
        ),
      })),
    };
    let removedRefs = checkedRefs.removed;
    if (siblings.length > 0) {
      const texts = answer.sections.flatMap((section) => [section.title, section.body]);
      const settled = checkSiblingReferences(siblings, [], [...texts, answer.not_answered]);
      answer = {
        sections: answer.sections.map((section, i) => ({ ...section, title: settled.texts[2 * i], body: settled.texts[2 * i + 1] })),
        not_answered: settled.texts[settled.texts.length - 1],
      };
      removedRefs += settled.removed;
    }
    const notes = notReadNotes(siblings);
    const label = stored ? privateNote(stored) : null;
    const cost = { costUsdEstimate: result.costUsd, calls: 1, turns: result.turns, durationMs: result.durationMs };
    const text =
      args.format === "json"
        ? `${JSON.stringify(
            {
              format: ASK_FORMAT,
              question: args.question,
              walkthrough: args.question === "",
              hasReview: stored !== undefined,
              sections: answer.sections.map((s) => ({
                title: s.title,
                body: s.body,
                refs: s.refs.map((r) => ({
                  path: r.path,
                  line: r.line,
                  ...(r.member !== undefined ? { member: r.member, sha: r.sha } : {}),
                })),
              })),
              notAnswered: answer.not_answered,
              removedRefs,
              ...(siblings.length > 0
                ? {
                    siblings: siblings.map((s) => ({
                      member: s.member,
                      ...(s.sha ? { sha: s.sha } : {}),
                      read: s.dir !== undefined && s.status === "read",
                      ...(s.unreadable ? { unreadable: s.unreadable } : {}),
                    })),
                  }
                : {}),
              ...(stored?.privateContext ? { privateContext: stored.privateContext } : {}),
              provider: { label: provider.modelLabel(), model: config.model, costUsd: result.costUsd },
            },
            null,
            2,
          )}\n`
        : `${[
            renderAnswer(answer, { removed: removedRefs, style: args.format === "markdown" ? "markdown" : "plain" }),
            ...notes,
            ...(label ? [label] : []),
          ].join("\n\n")}\n\n${costSentence(cost)}\n`;
    if (args.output !== undefined) {
      const path = resolve(args.output);
      writeFileSync(path, text);
      io.stderr(`report: ${path}`);
    } else io.stdout(text);
    // Only with a stored yes (src/telemetry/); after the answer is written, so it can neither change it nor the exit code.
    await reportRun(
      runOfAsk({ model: config.model, kept, usage: result.usage, durationMs: result.durationMs, error: null, failed: false }),
      {
        env,
        home: () => home,
        version: io.engineVersion,
      },
    );
    return 0;
  } finally {
    process.off("SIGINT", onSigint);
    releaseSiblings?.();
    release?.();
    if (material !== undefined) rmSync(material, { recursive: true, force: true });
  }
}
