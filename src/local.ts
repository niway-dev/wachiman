/**
 * `wachiman local`: the committed change of a branch, reviewed on the developer's own signed-in
 * `claude` (ADR 0019, spec D4–D14). Nothing is posted and no GitHub call is made: this module never
 * builds a `gh` function, and the core it calls has none. The review is printed (terminal), or
 * written as Markdown or JSON.
 *
 * Exit codes (plan decision 8): 0 when a report was produced (complete, partial, or stopped by a
 * usage limit); 1 when no call produced a review (sign-in refused, an unclassified error, every
 * batch failed); 2 for a usage error; 130 after Ctrl-C.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, UsageError } from "./config";
import { buildLocalInput, DEFAULT_MAX_DEPTH, EMPTY_TREE_LABEL, type LocalRefs, removeSnapshot, snapshotHead, warnSnapshotDifferences } from "./connectors/local-git";
import {
  DEFAULT_EXCLUDE,
  filterFiles,
  planBatches,
  reviewChange,
  reviewOptionsOf,
  type ReviewInput,
  type ReviewResult,
} from "./engine";
import { spawnGit } from "./evidence";
import { assertReviewInputFormat } from "./formats";
import { historyRoot, historySettings, saveRun } from "./history";
import { inspectIsolatedProfile, parseProfile, populatedProfileError, profileDir, type ProfileChoice } from "./profiles";
import { getProvider, type ProviderAdapter } from "./providers";
import { InterruptedError, SUBSCRIPTION_KEY_REFUSAL } from "./providers/claude-code";
import { sinceLastRunText, thisRunText, type HistoryAnnotation } from "./sinks/common";
import { renderJson } from "./sinks/json";
import { renderMarkdown } from "./sinks/markdown";
import { renderTerminal } from "./sinks/terminal";

export const FORMATS = ["terminal", "markdown", "json"] as const;
export type LocalFormat = (typeof FORMATS)[number];

export interface LocalArgs {
  base?: string;
  commit?: string;
  from?: string;
  maxDepth?: number;
  paths: string[];
  format: LocalFormat;
  output?: string;
  profile: ProfileChoice;
  agentPrompt: boolean;
  history: boolean;
  /** `--verify` forces the verifier on, `--no-verify` off; unset follows `AGENT_REVIEW_VERIFY` (on by default, ADR 0027). */
  verify: boolean | undefined;
  input?: string;
}

export const localUsage = `wachiman local [paths…] [--base <ref> | --from <commit> | --commit <commit>] [--max-depth <n>] [--repo-dir <dir>]
               [--input <file>] [--format terminal|markdown|json] [--output <file>]
               [--profile default|isolated[:<name>]] [--agent-prompt] [--history] [--verify | --no-verify]`;

/** The arguments after `local` (`--repo-dir` is already taken out). Both `--x v` and `--x=v`. */
export function parseLocalArgs(argv: string[]): LocalArgs {
  const args: LocalArgs = { paths: [], format: "terminal", profile: { kind: "default" }, agentPrompt: false, history: false, verify: undefined, input: undefined };
  let base: string | undefined;
  const picked: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      args.paths.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const value = () => {
      const v = eq === -1 ? argv[++i] : arg.slice(eq + 1);
      if (v === undefined || v === "" || (eq === -1 && v.startsWith("--"))) throw new UsageError(`${name} needs a value.`);
      return v;
    };
    if (name === "--agent-prompt" && eq === -1) args.agentPrompt = true;
    else if (name === "--history" && eq === -1) args.history = true;
    else if (name === "--verify" && eq === -1) args.verify = true;
    else if (name === "--no-verify" && eq === -1) args.verify = false;
    else if (name === "--base") {
      base = value();
      picked.push(name);
    } else if (name === "--commit" || name === "--from") {
      args[name === "--commit" ? "commit" : "from"] = value();
      picked.push(name);
    }
    else if (name === "--max-depth") {
      const v = value();
      if (!/^[1-9]\d*$/.test(v) || !Number.isSafeInteger(Number(v))) throw new UsageError(`--max-depth must be a positive integer, got "${v}".`);
      args.maxDepth = Number(v);
    } else if (name === "--output") args.output = value();
    else if (name === "--profile") args.profile = parseProfile(value());
    else if (name === "--format") {
      const v = value();
      if (!(FORMATS as readonly string[]).includes(v)) throw new UsageError(`--format must be one of ${FORMATS.join(", ")}, got "${v}".`);
      args.format = v as LocalFormat;
    } else if (name === "--input") {
      const v = value();
      if (!existsSync(v)) throw new UsageError(`--input ${v} does not exist.`);
      args.input = v;
    } else throw new UsageError(`Unknown option ${name} for local.`);
  }
  if (new Set(picked).size < picked.length) throw new UsageError(`${picked.find((n, i) => picked.indexOf(n) !== i)} was given twice.`);
  if (picked.length > 1) throw new UsageError(`${picked[0]} and ${picked[1]} cannot be used together.`);
  if (base !== undefined) args.base = base;
  if (args.input !== undefined && (picked.length > 0 || args.paths.length > 0)) {
    throw new UsageError("--input reviews the file's change as it is: it takes no --base, --from or --commit, and no paths.");
  }
  return args;
}

const HEX_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const isString = (v: unknown): v is string => typeof v === "string";

/**
 * A `ReviewInput` file, checked for what the core reads (plan decision 11): the format, the
 * change's sentence, repository and commits, the files, the instructions and the scope. The full
 * schema is checked by the tests; `headDir` is never taken from a file.
 */
export function readInputFile(path: string): Omit<ReviewInput, "headDir"> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new UsageError(`--input ${path} is not JSON: ${error instanceof Error ? error.message : error}`);
  }
  if (!parsed || typeof parsed !== "object") throw new UsageError(`--input ${path} is not a review input object.`);
  const input = parsed as Record<string, any>;
  assertReviewInputFormat({ format: input.format });
  const problems: string[] = [];
  const change = input.change;
  if (!change || typeof change !== "object") problems.push("change");
  else {
    if (!isString(change.describe)) problems.push("change.describe");
    if (!isString(change.repository?.name)) problems.push("change.repository.name");
    if (!isString(change.head?.sha) || !HEX_SHA.test(change.head.sha)) problems.push("change.head.sha");
    if (!isString(change.base?.sha) || !HEX_SHA.test(change.base.sha)) problems.push("change.base.sha");
  }
  const files = input.files;
  if (
    !Array.isArray(files) ||
    files.some((f) => !f || !isString(f.filename) || typeof f.additions !== "number" || typeof f.deletions !== "number")
  )
    problems.push("files");
  const instr = input.instructions;
  if (!instr || !isString(instr.baseSha) || !Array.isArray(instr.files)) problems.push("instructions");
  if (!Array.isArray(input.scope) || input.scope.some((s: unknown) => !isString(s))) problems.push("scope");
  if (problems.length > 0) throw new UsageError(`--input ${path} is missing or mistypes: ${problems.join(", ")}.`);
  // In memory only (docs/formats): the head the agent reads is always the engine's own snapshot.
  if ("headDir" in input) throw new UsageError(`--input ${path} carries headDir, which a review input file never holds.`);
  return input as Omit<ReviewInput, "headDir">;
}

/** Exit code for a finished review (decision 8). */
export function exitCodeOf(result: ReviewResult) {
  const { stop, callsWithOutput } = result.execution;
  return stop === "complete" || stop === "quota" || callsWithOutput > 0 ? 0 : 1;
}

/**
 * The provider, with Ctrl-C turned into "stop the review": after an interrupted call every later
 * call fails at once, without starting `claude`, so the core winds down in milliseconds.
 */
function interruptible(provider: ProviderAdapter, state: { interrupted: boolean }): ProviderAdapter {
  return {
    name: provider.name,
    preflight: () => provider.preflight(),
    modelLabel: () => provider.modelLabel(),
    leaksSecret: (texts) => provider.leaksSecret(texts),
    run: (request) => {
      if (state.interrupted) throw new InterruptedError("the review was interrupted");
      try {
        return provider.run(request);
      } catch (error) {
        if (error instanceof InterruptedError) state.interrupted = true;
        throw error;
      }
    },
  };
}

const short = (sha: string) => sha.slice(0, 7);
/** The start line of the `commit` and `from` modes: "the empty tree (a root commit)" or the short sha. */
const startText = (refs: LocalRefs) => (refs.baseRef === EMPTY_TREE_LABEL ? `${EMPTY_TREE_LABEL} (a root commit)` : short(refs.mergeBase));

export function runLocal(
  args: LocalArgs,
  repoDir: string,
  env: Record<string, string | undefined>,
  io: { stdout: (text: string) => void; stderr: (line: string) => void; engineVersion: string },
): number {
  const loaded = loadConfig(env, io.stderr);
  if (loaded.provider !== "claude-code") {
    throw new UsageError(
      `AGENT_REVIEW_PROVIDER=${loaded.provider}: the local review runs only on Claude Code, your signed-in \`claude\`.`,
    );
  }
  // A person ran it: no automatic ceiling (decision 14).
  const config = { ...loaded, trigger: undefined, verify: args.verify ?? loaded.verify };
  // Before the provider exists; the adapter's own check in preflight() is the second line.
  if (env.ANTHROPIC_API_KEY) throw new UsageError(SUBSCRIPTION_KEY_REFUSAL);
  // Off unless asked for (ADR 0020): without this, nothing below touches ~/.wachiman/history.
  // A bad AGENT_REVIEW_HISTORY_DAYS stops here, before any call is paid for.
  const history = historySettings(env, args.history);
  if (history.enabled && !env.HOME) throw new UsageError("HOME is not set, so the history cannot be kept.");

  let configDir: string | undefined;
  let profileNote: string | undefined;
  if (args.profile.kind === "isolated") {
    const home = env.HOME;
    if (!home) throw new UsageError("HOME is not set, so the isolated profile cannot be found.");
    configDir = profileDir(args.profile.name, home);
    const flag = args.profile.name === "isolated" ? "" : ` ${args.profile.name}`;
    if (!existsSync(configDir)) {
      throw new UsageError(`The isolated profile ${configDir} does not exist; run \`wachiman --setup-profile${flag}\` first.`);
    }
    const found = inspectIsolatedProfile(configDir);
    if (found.length > 0) throw populatedProfileError(configDir, found);
    profileNote = `${configDir}, a Claude Code profile that holds only a sign-in`;
  }

  const state = { interrupted: false };
  const provider = interruptible(
    getProvider("claude-code", { ...config, dryRun: false, auth: "subscription", configDir }),
    state,
  );
  provider.preflight();
  // The verifier is its own adapter on its own model, always at effort high (ADR 0027).
  const verifier = config.verify
    ? interruptible(getProvider("claude-code", { ...config, model: config.verifierModel, effort: "high", dryRun: false, auth: "subscription", configDir }), state)
    : undefined;
  verifier?.preflight();

  let snapshotDir: string | undefined;
  const onSigint = () => {
    state.interrupted = true;
  };
  process.on("SIGINT", onSigint);
  try {
    let input: ReviewInput;
    if (args.input === undefined) {
      const built = buildLocalInput({ repoDir, base: args.base, commit: args.commit, from: args.from, maxDepth: args.maxDepth ?? DEFAULT_MAX_DEPTH, paths: args.paths, log: io.stderr, warn: io.stderr });
      snapshotDir = built.snapshotDir;
      input = built.input;
      const { refs } = built;
      const commits = `${refs.depth} commit${refs.depth === 1 ? "" : "s"}`;
      const max = `(max ${args.maxDepth ?? DEFAULT_MAX_DEPTH})`;
      if (refs.mode?.kind === "commit") {
        io.stderr(`mode: one commit (${short(refs.mode.rev)})${refs.mode.merge ? ", a merge commit: first parent" : ""}`);
        io.stderr(`start: ${startText(refs)}`);
        io.stderr(`depth: ${commits}`);
        io.stderr(`head: ${short(refs.headSha)}`);
      } else if (refs.mode?.kind === "from") {
        io.stderr(`mode: from ${short(refs.mode.rev)} to HEAD`);
        io.stderr(`start: ${startText(refs)}`);
        io.stderr(`depth: ${commits} ${max}`);
        io.stderr(`head: ${refs.headRef} (${short(refs.headSha)})`);
      } else {
        io.stderr(`base: ${refs.baseRef} (${short(refs.baseSha)})`);
        io.stderr(`merge-base: ${short(refs.mergeBase)}`);
        io.stderr(`depth: ${commits} ${max}`);
        io.stderr(`head: ${refs.headRef} (${short(refs.headSha)})`);
      }
    } else {
      const fromFile = readInputFile(args.input);
      const head = fromFile.change.head.sha;
      if (spawnGit(["cat-file", "-e", `${head}^{commit}`], { cwd: repoDir, timeoutMs: 60_000 }).status !== 0) {
        throw new UsageError(`The input's head ${short(head)} is not a commit in ${repoDir}; pass the clone that has it with --repo-dir.`);
      }
      const snapshot = snapshotHead(repoDir, head);
      snapshotDir = snapshot.dir;
      warnSnapshotDifferences(snapshot, io.stderr);
      input = { ...fromFile, headDir: snapshot.dir };
      io.stderr(`head: ${short(head)}`);
    }
    const { kept, dropped } = filterFiles(input.files, [...DEFAULT_EXCLUDE, ...config.exclude], input.scope);
    const batches = planBatches(kept, { maxLines: config.batchLines, maxChars: config.batchChars });
    io.stderr(`files: ${kept.length} (${dropped.length} excluded)`);
    io.stderr(`batches: ${batches.length}`);

    const result = reviewChange(input, reviewOptionsOf(config, config.budgetUsd, args.profile.kind), {
      provider,
      ...(verifier ? { verifier } : {}),
      log: io.stderr,
      warn: io.stderr,
      engineVersion: io.engineVersion,
    });
    if (state.interrupted) {
      io.stderr("Interrupted: the review stopped and its snapshot was removed.");
      return 130;
    }
    // After the review and before the snapshot goes: the cited lines are read from it.
    let annotation: HistoryAnnotation | undefined;
    if (history.enabled) {
      try {
        annotation = saveRun({
          root: historyRoot(env.HOME!),
          repoDir,
          input,
          result,
          engineVersion: io.engineVersion,
          days: history.days,
          warn: io.stderr,
        });
      } catch (error) {
        io.stderr(`history: this run was not saved (${error instanceof Error ? error.message : error})`);
      }
    }
    if (annotation && args.format === "json") {
      io.stderr(thisRunText(result, annotation));
      io.stderr(sinceLastRunText(annotation));
    }
    const text =
      args.format === "json"
        ? renderJson(result)
        : args.format === "markdown"
          ? renderMarkdown(result, { profileNote, history: annotation })
          : renderTerminal(result, { profileNote, agentPrompt: args.agentPrompt, history: annotation });
    if (args.output !== undefined) {
      const path = resolve(args.output);
      writeFileSync(path, text);
      io.stderr(`report: ${path}`);
    } else io.stdout(text);
    return exitCodeOf(result);
  } finally {
    process.off("SIGINT", onSigint);
    if (snapshotDir) removeSnapshot(snapshotDir);
  }
}
