/**
 * `wachiman local`: the committed change of a branch, reviewed on the developer's own signed-in
 * `claude` (ADR 0019, spec D4–D14). Nothing is posted and no GitHub call is made: this module never
 * builds a `gh` function, and the core it calls has none. The review is printed (terminal), or
 * written as Markdown or JSON.
 *
 * Exit codes (plan decision 8): 0 when a report was produced (complete, partial, or stopped by a
 * usage limit); 1 when no call produced a review (sign-in refused, an unclassified error, every
 * batch failed); 2 for a usage error; 130 after Ctrl-C.
 *
 * The parts `wachiman ask` shares (`parseFlags`, `openLocalSession`, `localScopeInput`) live here, so
 * both commands read the same flags, pick the same account and provider, and read the same change.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, UsageError } from "./config";
import {
  buildLocalInput,
  DEFAULT_MAX_DEPTH,
  EMPTY_TREE_LABEL,
  type LocalRefs,
  removeSnapshot,
  snapshotHead,
  warnSnapshotDifferences,
} from "./connectors/local-git";
import { DEFAULT_EXCLUDE, filterFiles, planBatches, reviewChange, reviewOptionsOf, type ReviewInput, type ReviewResult } from "./engine";
import { spawnGit } from "./evidence";
import { assertReviewInputFormat, REVIEW_INPUT_V2 } from "./formats";
import { workingTreeInput, snapshotWorkingTree } from "./connectors/working-tree";
import { historyRoot, historySettings, saveRun } from "./history";
import { readConfig, wachimanHome } from "./accounts/config";
import { confirmProfile, type SpawnFn } from "./accounts/confirm";
import { failureText, profileLine, resolveProfile, type ResolvedProfile } from "./accounts/resolve";
import { repositoryKey } from "./history/store";
import { inspectIsolatedProfile, parseProfile, populatedProfileError, profileDir } from "./profiles";
import { getProvider as defaultGetProvider, type ProviderAdapter } from "./providers";
import { InterruptedError, SUBSCRIPTION_KEY_REFUSAL } from "./providers/claude-code";
import { sinceLastRunText, thisRunText, type HistoryAnnotation } from "./sinks/common";
import { renderJson } from "./sinks/json";
import { renderMarkdown } from "./sinks/markdown";
import { renderTerminal } from "./sinks/terminal";

export const FORMATS = ["terminal", "markdown", "json"] as const;
export type LocalFormat = (typeof FORMATS)[number];

export interface LocalArgs {
  workingTree?: "staged" | "all";
  base?: string;
  commit?: string;
  from?: string;
  maxDepth?: number;
  paths: string[];
  format: LocalFormat;
  output?: string;
  /** The `--profile` value as typed; `resolveProfile` decides what it names. Absent: the lower rungs decide. */
  profile?: string;
  agentPrompt: boolean;
  history: boolean;
  /** `--verify` forces the verifier on, `--no-verify` off; unset follows `AGENT_REVIEW_VERIFY` (off by default, ADR 0027). */
  verify: boolean | undefined;
  /** `--result-version`: with `--format json`, which result version to write (default 1 for a committed change). */
  resultVersion?: 1 | 2;
  input?: string;
}

export const localUsage = `wachiman local [paths…] [--base <ref> | --from <commit> | --commit <commit>] [--max-depth <n>] [--repo-dir <dir>]
               [--input <file>] [--format terminal|markdown|json] [--output <file>]
               [--profile <name>] [--agent-prompt] [--history] [--verify | --no-verify]
               [--result-version 1|2] [--working-tree staged|all]`;

/** Every flag `local` takes. `ask` takes the subset it names in `ask-command`. */
export const LOCAL_FLAGS = [
  "--agent-prompt",
  "--history",
  "--verify",
  "--no-verify",
  "--result-version",
  "--working-tree",
  "--base",
  "--commit",
  "--from",
  "--max-depth",
  "--output",
  "--profile",
  "--format",
  "--input",
] as const;

/** The arguments after `local` (`--repo-dir` is already taken out). Both `--x v` and `--x=v`. */
export function parseLocalArgs(argv: string[]): LocalArgs {
  return parseFlags(argv, "local", LOCAL_FLAGS);
}

/**
 * The flags `local` and `ask` share, read by this one parser so both mean the same by each. A flag
 * not in `accepted` is a usage error for `command`. Every argument that is not a flag goes to
 * `paths`: the paths of `local`, the words of an `ask` question.
 */
export function parseFlags(argv: string[], command: string, accepted: readonly string[]): LocalArgs {
  const args: LocalArgs = {
    paths: [],
    format: "terminal",
    profile: undefined,
    agentPrompt: false,
    history: false,
    verify: undefined,
    input: undefined,
  };
  let base: string | undefined;
  let sawVerify = false;
  let sawNoVerify = false;
  const picked: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      args.paths.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (!accepted.includes(name)) throw new UsageError(`Unknown option ${name} for ${command}.`);
    const value = () => {
      const v = eq === -1 ? argv[++i] : arg.slice(eq + 1);
      if (v === undefined || v === "" || (eq === -1 && v.startsWith("--"))) throw new UsageError(`${name} needs a value.`);
      return v;
    };
    if (name === "--agent-prompt" && eq === -1) args.agentPrompt = true;
    else if (name === "--history" && eq === -1) args.history = true;
    else if (name === "--verify" && eq === -1) {
      args.verify = true;
      sawVerify = true;
    } else if (name === "--no-verify" && eq === -1) {
      args.verify = false;
      sawNoVerify = true;
    } else if (name === "--result-version") {
      const v = value();
      if (v !== "1" && v !== "2") throw new UsageError(`--result-version must be 1 or 2, got "${v}".`);
      args.resultVersion = v === "1" ? 1 : 2;
    } else if (name === "--working-tree") {
      const v = value();
      if (v !== "staged" && v !== "all") throw new UsageError("--working-tree must be staged or all.");
      args.workingTree = v;
      picked.push(name);
    } else if (name === "--base") {
      base = value();
      picked.push(name);
    } else if (name === "--commit" || name === "--from") {
      args[name === "--commit" ? "commit" : "from"] = value();
      picked.push(name);
    } else if (name === "--max-depth") {
      const v = value();
      if (!/^[1-9]\d*$/.test(v) || !Number.isSafeInteger(Number(v)))
        throw new UsageError(`--max-depth must be a positive integer, got "${v}".`);
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
    } else throw new UsageError(`Unknown option ${name} for ${command}.`);
  }
  if (sawVerify && sawNoVerify) throw new UsageError("--verify and --no-verify cannot be used together.");
  if (args.resultVersion !== undefined && args.format !== "json") throw new UsageError("--result-version applies only with --format json.");
  if (new Set(picked).size < picked.length) throw new UsageError(`${picked.find((n, i) => picked.indexOf(n) !== i)} was given twice.`);
  if (picked.length > 1) throw new UsageError(`${picked[0]} and ${picked[1]} cannot be used together.`);
  if (base !== undefined) args.base = base;
  if (args.input !== undefined && (picked.length > 0 || args.paths.length > 0)) {
    throw new UsageError("--input reviews the file's change as it is: it takes no --base, --from or --commit, and no paths.");
  }
  if (args.workingTree && args.resultVersion === 1) throw new UsageError("Working-tree reviews require --result-version 2.");
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
    if (!["pull-request", "branch", "working-tree"].includes(change.kind)) problems.push("change.kind");
    if (change.kind === "working-tree") {
      const w = change.workingTree;
      if (
        input.format !== REVIEW_INPUT_V2 ||
        !w ||
        !["staged", "all"].includes(w.mode) ||
        w.tree !== change.head?.sha ||
        w.baseCommit !== change.base?.sha
      )
        problems.push("change.workingTree");
    } else if (change.workingTree !== undefined) problems.push("change.workingTree");
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
export function interruptible(provider: ProviderAdapter, state: { interrupted: boolean }): ProviderAdapter {
  return {
    name: provider.name,
    auth: provider.auth,
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

/** Seams for tests: the `claude` probes of the confirmation, and the provider factory. */
export interface LocalDeps {
  spawn?: SpawnFn;
  getProvider?: typeof defaultGetProvider;
}

/** What a local command settles before any call: the settings, the account and the providers. */
export interface LocalSession {
  config: ReturnType<typeof loadConfig>;
  profile: ResolvedProfile["profile"];
  profileNote?: string;
  provider: ProviderAdapter;
  verifier?: ProviderAdapter;
  /** Set by Ctrl-C: every later call then fails at once. */
  state: { interrupted: boolean };
}

/**
 * The settings, the account (ADR 0029), the subscription-mode provider and, with `--verify`, the
 * verifier, all checked before any call. Nothing in the reviewed repository takes part: a corrupt
 * store, a value that resolves to nothing, or a profile that does not confirm is a usage error.
 */
export function openLocalSession(p: {
  profile?: string;
  verify: boolean | undefined;
  repoDir: string;
  env: Record<string, string | undefined>;
  stderr: (line: string) => void;
  deps: LocalDeps;
}): LocalSession {
  const { env, repoDir, deps } = p;
  const loaded = loadConfig(env, p.stderr);
  if (loaded.provider !== "claude-code") {
    throw new UsageError(`AGENT_REVIEW_PROVIDER=${loaded.provider}: the local review runs only on Claude Code, your signed-in \`claude\`.`);
  }
  // A person ran it: no automatic ceiling (decision 14).
  const config = {
    ...loaded,
    trigger: undefined,
    verify: p.verify ?? loaded.verify,
  };
  // Before the provider exists; the adapter's own check in preflight() is the second line.
  if (env.ANTHROPIC_API_KEY) throw new UsageError(SUBSCRIPTION_KEY_REFUSAL);

  // Which account (ADR 0029): nothing in the reviewed repository takes part. A corrupt store, a
  // value that resolves to nothing, or a profile that does not confirm is exit 2 before any call.
  const home = wachimanHome(env);
  const stored = readConfig(home);
  if (stored.kind === "corrupt") throw new UsageError(`${stored.path} is corrupt (${stored.problem}); fix or remove it.`);
  const accounts = stored.kind === "ok" ? stored.config : undefined;
  const bindingKey = accounts && Object.keys(accounts.projects).length > 0 ? repositoryKey(repoDir).key : undefined;
  const resolution = resolveProfile({
    flag: p.profile,
    binding: bindingKey !== undefined && Object.hasOwn(accounts!.projects, bindingKey) ? accounts!.projects[bindingKey] : undefined,
    env: { WACHIMAN_PROFILE: env.WACHIMAN_PROFILE },
    config: accounts,
    managedDirExists: (name) => existsSync(profileDir(name, home)),
    home,
  });
  if (!resolution.ok) throw new UsageError(failureText(resolution.failure));
  const { resolved } = resolution;
  p.stderr(profileLine(resolved));
  const { profile } = resolved;

  let configDir: string | undefined;
  let profileNote: string | undefined;
  if (profile.kind === "managed") {
    configDir = profile.configDir;
    const found = inspectIsolatedProfile(configDir);
    if (found.length > 0) throw populatedProfileError(configDir, found);
    profileNote = `${configDir}, a Claude Code profile that holds only a sign-in`;
  } else if (profile.kind === "external") {
    configDir = profile.configDir;
    profileNote = `${profile.name}, an external Claude Code profile (${configDir}); its plugins are untested and could reach the review`;
  }
  const confirmation = confirmProfile(resolved, env, deps.spawn);
  if (!confirmation.ok) throw new UsageError(`${confirmation.problem} Fix: ${confirmation.fix}.`);

  const state = { interrupted: false };
  const provider = interruptible(
    (deps.getProvider ?? defaultGetProvider)("claude-code", {
      ...config,
      dryRun: false,
      auth: "subscription",
      configDir,
      binary: profile.kind === "external" ? profile.binary : undefined,
    }),
    state,
  );
  provider.preflight();
  // The verifier is its own adapter on its own model, always at effort high (ADR 0027).
  const verifier = config.verify
    ? interruptible(
        (deps.getProvider ?? defaultGetProvider)("claude-code", {
          ...config,
          model: config.verifierModel,
          effort: "high",
          dryRun: false,
          auth: "subscription",
          configDir,
          binary: profile.kind === "external" ? profile.binary : undefined,
        }),
        state,
      )
    : undefined;
  verifier?.preflight();
  return { config, profile, profileNote, provider, verifier, state };
}

/**
 * The change the scope flags select (ADR 0019 decision 2): the tracked working tree with
 * `--working-tree`, else the committed range. The input reads from a snapshot of the head; `release`
 * removes it, and the caller runs it once the change is no longer read.
 */
export function localScopeInput(p: {
  repoDir: string;
  workingTree?: "staged" | "all";
  base?: string;
  commit?: string;
  from?: string;
  maxDepth?: number;
  paths: string[];
  log: (line: string) => void;
  warn: (line: string) => void;
}): { input: ReviewInput; release: () => void } {
  if (p.workingTree) {
    const built = workingTreeInput({
      repoDir: p.repoDir,
      mode: p.workingTree,
      paths: p.paths,
      log: p.log,
      warn: p.warn,
    });
    p.log(`mode: working tree (${p.workingTree})`);
    p.log(`base: HEAD (${short(built.input.change.base.sha)})`);
    p.log(`tree: ${short(built.input.change.head.sha)}`);
    return { input: built.input, release: built.release };
  }
  const maxDepth = p.maxDepth ?? DEFAULT_MAX_DEPTH;
  const built = buildLocalInput({
    repoDir: p.repoDir,
    base: p.base,
    commit: p.commit,
    from: p.from,
    maxDepth,
    paths: p.paths,
    log: p.log,
    warn: p.warn,
  });
  const { refs } = built;
  const commits = `${refs.depth} commit${refs.depth === 1 ? "" : "s"}`;
  const max = `(max ${maxDepth})`;
  if (refs.mode?.kind === "commit") {
    p.log(`mode: one commit (${short(refs.mode.rev)})${refs.mode.merge ? ", a merge commit: first parent" : ""}`);
    p.log(`start: ${startText(refs)}`);
    p.log(`depth: ${commits}`);
    p.log(`head: ${short(refs.headSha)}`);
  } else if (refs.mode?.kind === "from") {
    p.log(`mode: from ${short(refs.mode.rev)} to HEAD`);
    p.log(`start: ${startText(refs)}`);
    p.log(`depth: ${commits} ${max}`);
    p.log(`head: ${refs.headRef} (${short(refs.headSha)})`);
  } else {
    p.log(`base: ${refs.baseRef} (${short(refs.baseSha)})`);
    p.log(`merge-base: ${short(refs.mergeBase)}`);
    p.log(`depth: ${commits} ${max}`);
    p.log(`head: ${refs.headRef} (${short(refs.headSha)})`);
  }
  return { input: built.input, release: () => removeSnapshot(built.snapshotDir) };
}

export function runLocal(
  args: LocalArgs,
  repoDir: string,
  env: Record<string, string | undefined>,
  io: {
    stdout: (text: string) => void;
    stderr: (line: string) => void;
    engineVersion: string;
  },
  deps: LocalDeps = {},
): number {
  const fileInput = args.input === undefined ? undefined : readInputFile(args.input);
  if ((args.workingTree || fileInput?.change.kind === "working-tree") && args.resultVersion === 1) {
    throw new UsageError("Working-tree reviews require --result-version 2; a tree is not a commit.");
  }
  // Off unless asked for (ADR 0020): without this, nothing below touches ~/.wachiman/history.
  // A bad AGENT_REVIEW_HISTORY_DAYS stops here, before any call is paid for.
  const history = historySettings(env, args.history);
  const home = wachimanHome(env);
  const { config, profile, profileNote, provider, verifier, state } = openLocalSession({
    profile: args.profile,
    verify: args.verify,
    repoDir,
    env,
    stderr: io.stderr,
    deps,
  });

  let release: (() => void) | undefined;
  const onSigint = () => {
    state.interrupted = true;
  };
  process.on("SIGINT", onSigint);
  try {
    let input: ReviewInput;
    if (args.input === undefined) {
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
      input = scope.input;
      release = scope.release;
    } else {
      const fromFile = fileInput!;
      const head = fromFile.change.head.sha;
      if (
        fromFile.change.kind !== "working-tree" &&
        spawnGit(["cat-file", "-e", `${head}^{commit}`], {
          cwd: repoDir,
          timeoutMs: 60_000,
        }).status !== 0
      ) {
        throw new UsageError(`The input's head ${short(head)} is not a commit in ${repoDir}; pass the clone that has it with --repo-dir.`);
      }
      const snapshot =
        fromFile.change.kind === "working-tree"
          ? { ...snapshotWorkingTree(repoDir, head), missing: [], extra: [] }
          : snapshotHead(repoDir, head);
      release = () => removeSnapshot(snapshot.dir);
      warnSnapshotDifferences(snapshot, io.stderr);
      input = { ...fromFile, headDir: snapshot.dir };
      io.stderr(`head: ${short(head)}`);
    }
    const { kept, dropped } = filterFiles(input.files, [...DEFAULT_EXCLUDE, ...config.exclude], input.scope);
    const batches = planBatches(kept, {
      maxLines: config.batchLines,
      maxChars: config.batchChars,
    });
    io.stderr(`files: ${kept.length} (${dropped.length} excluded)`);
    io.stderr(`batches: ${batches.length}`);
    io.stderr(
      config.verify
        ? `verify: on (${config.verifierModel}, reserve $${Math.min(config.verifyBudgetUsd, config.budgetUsd / 2).toFixed(2)})`
        : "verify: off",
    );

    const result = reviewChange(input, reviewOptionsOf(config, config.budgetUsd, profile.kind === "managed" ? "isolated" : "default"), {
      provider,
      ...(verifier ? { verifier } : {}),
      // The verifier reads the code before the change too; made once, only when there is something to check.
      ...(verifier
        ? {
            baseSnapshot: () => {
              const base = input.change.kind === "working-tree"
                ? snapshotWorkingTree(repoDir, `${input.change.base.sha}^{tree}`)
                : snapshotHead(repoDir, input.change.base.sha);
              return {
                dir: base.dir,
                release: () => removeSnapshot(base.dir),
              };
            },
          }
        : {}),
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
          root: historyRoot(home),
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
        ? renderJson(
            result,
            args.resultVersion ?? (input.change.kind === "working-tree" ? 2 : 1),
            // ADR 0034: with history on, a `/2` finding names itself by the id `history --verdict` takes.
            annotation ? result.findings.map((_, i) => annotation!.byIndex.get(i)?.id) : undefined,
          )
        : args.format === "markdown"
          ? renderMarkdown(result, { profileNote, history: annotation })
          : renderTerminal(result, {
              profileNote,
              agentPrompt: args.agentPrompt,
              history: annotation,
            });
    if (args.output !== undefined) {
      const path = resolve(args.output);
      writeFileSync(path, text);
      io.stderr(`report: ${path}`);
    } else io.stdout(text);
    return exitCodeOf(result);
  } finally {
    process.off("SIGINT", onSigint);
    release?.();
  }
}
