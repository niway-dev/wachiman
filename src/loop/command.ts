/**
 * `wachiman loop`: one review round per call (ADR 0034). A round is a local review with history on,
 * a comparison with the rounds before it, and an outcome the caller can branch on. The agent fixes
 * between calls; this command never edits code.
 *
 * Exit codes: 0 converged, 10 findings still open, 11 stopped without converging (`round cap`,
 * `review failed`), 2 usage error, 130 interrupted. With `--summary`, 0 printed (and published when asked),
 * 1 printed but the publish failed.
 *
 * A call continues the branch's loop (ADR 0054): when the loop has the same base and its last round's
 * head is an ancestor of HEAD, round n+1 reviews the commits since that head with the ledger and the
 * rounds kept, even after a convergence. `--max-rounds` limits the rounds of one pass (since the loop
 * last converged, or started); the summary totals every round. A different base, or history that no
 * longer contains the last head (a rebase), starts a fresh loop and says why.
 *
 * The review is `runLocal` itself, asked for result `/2` with history on, so the account rules, the
 * prompt and the history are exactly those of `wachiman local`. Round 1 reviews the whole range from
 * `--base`; a later round reviews the commits since the previous round's head, as an ordinary range.
 * A round with no new commit makes no model call: it re-reads the verdicts and reports again.
 *
 * Each round records what its review reported about itself (range, version, models, cost, time) in
 * the loop state, and the state renders as the "Review summary — local" comment (`summary.ts`,
 * ADR 0054): `--format markdown` prints it after a round, `--summary` prints it without one, and
 * `--publish` (or `publishLoopSummary: true` in `.wachiman.yml`) posts it on the branch's pull request.
 */
import { UsageError } from "../config";
import { neutralise, SEVERITY, TOPIC, type ReviewResult } from "../engine";
import { spawnGit } from "../evidence";
import { readReviewResultFormat } from "../formats";
import { wachimanHome } from "../accounts/config";
import { MIN_LINE_CHARS, stripWhitespace, titleKey } from "../history/fingerprint";
import { replay, type ReplayedFinding } from "../history/match";
import { historyRoot, readRuns, readVerdicts, repositoryKey } from "../history/store";
import { LOCAL_FLAGS, parseFlags, runLocal, type LocalArgs, type LocalDeps } from "../local";
import { location, sha7 } from "../sinks/common";
import { localRepoSettings } from "../connectors/local-git";
import { ignoredSettingsNote } from "../repo-settings";
import { publishSummary, spawnGh, type GhRunner } from "./publish";
import { LOOP_STATE_FORMAT, readLoop, writeLoop, type LedgerEntry, type LoopRound, type LoopState, type RoundReview } from "./state";
import { renderSummary } from "./summary";
import { evaluate, isRefutedBy, roundCapReached, type Decision, type LoopFinding, type LoopStatus, type OpenFinding, type Released } from "./stop-rule";

export const LOOP_RESULT_FORMAT = "wachiman.loop-round/1";
export const DEFAULT_MAX_ROUNDS = 5;

export const loopUsage = `wachiman loop [--base <ref>] [--max-rounds <n>] [--max-depth <n>] [--repo-dir <dir>]
               [--format terminal|json|markdown] [--profile <name>] [--verify | --no-verify]
               [--summary] [--publish | --no-publish] [--agent <name>]`;

export interface LoopArgs {
  /** Starts a loop, or continues the branch's when it has this base and the history still holds its last round. Absent: continue the branch's loop. */
  base?: string;
  /** The rounds one pass may run: since the loop last converged, or started. */
  maxRounds: number;
  format: "terminal" | "json" | "markdown";
  profile?: string;
  verify: boolean | undefined;
  maxDepth?: number;
  /** Print the summary of the open loop and run no round. */
  summary: boolean;
  /** Post the summary on the branch's open pull request. Absent: what `.wachiman.yml` says, else no. */
  publish?: boolean;
  /** The agent that posts the summary; absent: `WACHIMAN_AGENT`, else the user. */
  agent?: string;
}

/** The flags `loop` takes, a subset of `local`'s plus `--max-rounds`. */
const LOOP_LOCAL_FLAGS = LOCAL_FLAGS.filter((f) => ["--base", "--format", "--profile", "--verify", "--no-verify", "--max-depth"].includes(f));

/** The arguments after `loop` (`--repo-dir` is already taken out). Both `--x v` and `--x=v`. */
export function parseLoopArgs(argv: string[]): LoopArgs {
  let maxRounds = DEFAULT_MAX_ROUNDS;
  let seenMax = false;
  let summary = false;
  let publish: boolean | undefined;
  let agent: string | undefined;
  let formatGiven = false;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--summary") summary = true;
    else if (arg === "--publish" || arg === "--no-publish") {
      if (publish !== undefined) throw new UsageError("--publish and --no-publish take one place; give one of them once.");
      publish = arg === "--publish";
    } else if (arg === "--agent" || arg.startsWith("--agent=")) {
      if (agent !== undefined) throw new UsageError("--agent was given twice.");
      const v = arg === "--agent" ? argv[++i] : arg.slice("--agent=".length);
      if (v === undefined || v.trim() === "" || v.startsWith("--")) throw new UsageError("--agent needs the name of the agent.");
      agent = v.trim();
    } else if (arg === "--max-rounds" || arg.startsWith("--max-rounds=")) {
      if (seenMax) throw new UsageError("--max-rounds was given twice.");
      seenMax = true;
      const v = arg === "--max-rounds" ? argv[++i] : arg.slice("--max-rounds=".length);
      if (v === undefined || v === "" || v.startsWith("--")) throw new UsageError("--max-rounds needs a value.");
      if (!/^[1-9]\d*$/.test(v) || !Number.isSafeInteger(Number(v))) throw new UsageError(`--max-rounds must be a positive integer, got "${v}".`);
      maxRounds = Number(v);
    } else {
      if (arg === "--format" || arg.startsWith("--format=")) formatGiven = true;
      rest.push(arg);
    }
  }
  const local = parseFlags(rest, "loop", LOOP_LOCAL_FLAGS);
  if (local.paths.length > 0) throw new UsageError(`loop takes no path or argument ("${local.paths[0]}"): it reviews the committed branch.`);
  if (summary) {
    // The summary reads the loop and runs no round, so a round's options would be silently dropped.
    const given = [
      ...(local.base !== undefined ? ["--base"] : []),
      ...(seenMax ? ["--max-rounds"] : []),
      ...(local.maxDepth !== undefined ? ["--max-depth"] : []),
      ...(local.profile !== undefined ? ["--profile"] : []),
      ...(local.verify !== undefined ? ["--verify/--no-verify"] : []),
    ];
    if (given.length > 0) throw new UsageError(`--summary runs no round, so it takes no ${given.join(", ")}.`);
    if (formatGiven && local.format !== "markdown") throw new UsageError("--summary prints Markdown; leave out --format or give --format markdown.");
  }
  return {
    ...(local.base !== undefined ? { base: local.base } : {}),
    maxRounds,
    format: summary ? "markdown" : (local.format as LoopArgs["format"]),
    ...(local.profile !== undefined ? { profile: local.profile } : {}),
    verify: local.verify,
    ...(local.maxDepth !== undefined ? { maxDepth: local.maxDepth } : {}),
    summary,
    ...(publish !== undefined ? { publish } : {}),
    ...(agent !== undefined ? { agent } : {}),
  };
}

export interface LoopDeps extends LocalDeps {
  /** The review of one round; `runLocal` unless a test says otherwise. */
  review?: typeof runLocal;
  /** `gh` for `--publish`; the real one unless a test says otherwise. */
  gh?: GhRunner;
}

type Why = "round cap" | "review failed";

/** What one call reports, in terminal and JSON form. */
export interface RoundReport {
  branch: string;
  round: number;
  /** This call's place in the budget: the rounds run since the loop last converged or started, this one included. */
  passRound: number;
  maxRounds: number;
  /** What the round reviewed. */
  range: { kind: "whole"; base: string } | { kind: "since-previous-round"; from: string } | { kind: "none"; head: string };
  head: string;
  open: OpenFinding[];
  released: Released[];
  notes: LoopFinding[];
  outcome: { status: "converged" | "open" | "stopped"; reason?: Why; message: string };
  exitCode: 0 | 10 | 11;
}

const GIT_TIMEOUT_MS = 30_000;
const git = (repoDir: string, args: string[]) => spawnGit(args, { cwd: repoDir, timeoutMs: GIT_TIMEOUT_MS });

function currentBranch(repoDir: string): string {
  const out = git(repoDir, ["symbolic-ref", "--short", "-q", "HEAD"]);
  if (out.status !== 0 || out.stdout.trim() === "") throw new UsageError("HEAD is detached; the loop is kept per branch, so check out a branch.");
  return out.stdout.trim();
}

function headOf(repoDir: string): string {
  const out = git(repoDir, ["rev-parse", "--verify", "HEAD^{commit}"]);
  if (out.status !== 0) throw new UsageError("HEAD has no commit yet; commit the change first.");
  return out.stdout.trim();
}

/** `old path -> new path` for the files the range renamed. */
function renamesIn(repoDir: string, from: string, head: string): Map<string, string> {
  const out = git(repoDir, ["diff", "--name-status", "-M", from, head]);
  const map = new Map<string, string>();
  if (out.status !== 0) return map;
  for (const line of out.stdout.split("\n")) {
    const [kind, oldPath, newPath] = line.split("\t");
    if (kind?.startsWith("R") && oldPath && newPath) map.set(oldPath, newPath);
  }
  return map;
}

/**
 * Whether the finding's cited region changed in the file at HEAD, by the rule the history uses when
 * it settles a finding: the cited line is gone from the file; or, with no line to search for, the
 * file's blob differs.
 */
function regionChanged(repoDir: string, head: string, path: string, t: Pick<ReplayedFinding, "lineText" | "blobSha">): boolean {
  if (t.lineText !== undefined) {
    const shown = git(repoDir, ["show", `${head}:${path}`]);
    return shown.status !== 0 || !shown.stdout.split("\n").some((l) => stripWhitespace(l) === t.lineText);
  }
  const blob = git(repoDir, ["rev-parse", `${head}:${path}`]);
  return blob.status !== 0 || t.blobSha === undefined || blob.stdout.trim() !== t.blobSha;
}

/**
 * What `regionChanged` compares against later: the cited line without whitespace, or the file's blob
 * when the line is too short, repeated or missing, as the history fingerprints a finding.
 */
function fingerprintAt(repoDir: string, head: string, path: string, line: number): { lineText?: string; blobSha?: string } {
  const shown = git(repoDir, ["show", `${head}:${path}`]);
  if (shown.status === 0 && Number.isInteger(line) && line >= 1) {
    const lines = shown.stdout.split("\n");
    const text = line <= lines.length ? stripWhitespace(lines[line - 1]) : "";
    if (text.length >= MIN_LINE_CHARS && lines.filter((l) => stripWhitespace(l) === text).length === 1) return { lineText: text };
  }
  const blob = git(repoDir, ["rev-parse", `${head}:${path}`]);
  return blob.status === 0 ? { blobSha: blob.stdout.trim() } : {};
}

/** A complete `/2` result whose findings all carry their history id. */
type IdentifiedResult = ReviewResult & { findings: { id: string }[] };
type Attempt = { ok: true; result: IdentifiedResult } | { ok: false; why: string } | { interrupted: true };

/** One review call: succeeds only with a complete `/2` result in which every finding has a history id. */
async function attempt(args: LocalArgs, repoDir: string, env: Record<string, string | undefined>, io: LoopIo, deps: LoopDeps): Promise<Attempt> {
  let out = "";
  let code: number;
  try {
    code = await (deps.review ?? runLocal)(args, repoDir, env, { stdout: (t) => (out += t), stderr: io.stderr, engineVersion: io.engineVersion }, deps);
  } catch (error) {
    if (error instanceof UsageError) throw error;
    return { ok: false, why: error instanceof Error ? error.message : String(error) };
  }
  if (code === 130) return { interrupted: true };
  if (code !== 0) return { ok: false, why: `the review exited ${code}` };
  let parsed: ReviewResult;
  try {
    parsed = JSON.parse(out);
    readReviewResultFormat(parsed);
  } catch {
    return { ok: false, why: "the review did not return a result" };
  }
  if (parsed.execution.stop !== "complete") return { ok: false, why: `the review stopped early (${parsed.execution.stop})` };
  if (parsed.coverage.partial) return { ok: false, why: "the review left files unread" };
  if (parsed.findings.some((f: { id?: string }) => typeof f.id !== "string")) return { ok: false, why: "the review's history entry was not saved, so its findings have no id" };
  return { ok: true, result: parsed as IdentifiedResult };
}

interface LoopIo {
  stdout: (text: string) => void;
  stderr: (line: string) => void;
  engineVersion: string;
}

const withVerdicts = (ledger: LedgerEntry[], verdicts: ReturnType<typeof readVerdicts>): LoopFinding[] =>
  ledger.map((e) => ({ ...e, ...(verdicts.get(e.id) ? { verdict: { verdict: verdicts.get(e.id)!.verdict, reason: verdicts.get(e.id)!.reason } } : {}) }));

export async function runLoop(args: LoopArgs, repoDir: string, env: Record<string, string | undefined>, io: LoopIo, deps: LoopDeps = {}): Promise<number> {
  const root = historyRoot(wachimanHome(env));
  const key = repositoryKey(repoDir).key;
  const branch = currentBranch(repoDir);
  const head = headOf(repoDir);
  // With --base the old state is about to be replaced, so one this version cannot read is no obstacle.
  let existing: LoopState | undefined;
  try {
    existing = readLoop(root, key, branch);
  } catch (error) {
    if (args.base === undefined || !(error instanceof UsageError)) throw error;
  }

  const verdicts = () => readVerdicts(root, key);
  const agent = args.agent ?? (env.WACHIMAN_AGENT?.trim() || undefined);
  const gh = deps.gh ?? spawnGh(repoDir, env);
  const summaryOf = (st: LoopState) => renderSummary({ state: st, findings: withVerdicts(st.ledger, verdicts()), ...(agent ? { agent } : {}) });
  /** Whether the summary goes to GitHub: the flag, else the repository's setting read at the merge-base (never from the head under review). */
  const wantsPublish = (st: LoopState): boolean => {
    if (args.publish !== undefined) return args.publish;
    const base = git(repoDir, ["merge-base", st.base, head]);
    if (base.status !== 0 || base.stdout.trim() === "") {
      io.stderr(`loop: publishLoopSummary was not checked: no merge-base of ${st.base} and HEAD; pass --publish to publish anyway.`);
      return false;
    }
    const where = `the merge-base ${sha7(base.stdout.trim())}`;
    try {
      const settings = localRepoSettings(repoDir, base.stdout.trim());
      if (settings?.publishLoopSummaryError !== undefined) {
        io.stderr(`loop: ${settings.publishLoopSummaryError.replace(/\.$/, "")} (at ${where}); not publishing. Pass --publish to publish anyway.`);
        return false;
      }
      return settings?.publishLoopSummary === true;
    } catch (error) {
      if (!(error instanceof UsageError)) throw error;
      io.stderr(ignoredSettingsNote(error.message, where));
      return false;
    }
  };
  /** Posts the summary when asked. A failure is said on stderr and never changes the round's exit code. Returns whether it failed. */
  const publish = (st: LoopState, body?: string): boolean => {
    if (st.rounds.length === 0 || !wantsPublish(st)) return false;
    try {
      const done = publishSummary(body ?? summaryOf(st), branch, gh, (step) => io.stderr(`loop: publishing the summary: ${step}…`));
      io.stderr(`loop: summary ${done.action} on ${done.pullRequest}: ${done.url}`);
      return false;
    } catch (error) {
      if (!(error instanceof UsageError)) throw error;
      io.stderr(`loop: the summary was not published: ${error.message}`);
      return true;
    }
  };
  /** The round's report, or the summary with `--format markdown`; then the publish, when asked. */
  const render = (report: RoundReport, st: LoopState) => {
    if (args.format === "markdown") {
      // The outcome is not in the summary, so it goes where a script reads it too. A loop with no recorded round has no summary yet.
      io.stderr(`loop: ${report.outcome.message}`);
      const body = st.rounds.length > 0 ? summaryOf(st) : undefined;
      if (body !== undefined) io.stdout(body);
      publish(st, body);
    } else {
      io.stdout(args.format === "json" ? renderJson(report) : renderTerminal(report));
      publish(st);
    }
    return report.exitCode;
  };

  // `--summary`: the loop as it stands, no round, no model call, nothing written. A converged loop prints too.
  if (args.summary) {
    if (!existing) throw new UsageError(`No loop is open on ${branch}; start one with \`wachiman loop --base <ref>\`.`);
    if (existing.rounds.length === 0) throw new UsageError(`The loop on ${branch} has not recorded a round yet; run \`wachiman loop\` first.`);
    const body = summaryOf(existing);
    io.stdout(body);
    return publish(existing, body) ? 1 : 0;
  }

  let state: LoopState;
  const resumed = existing ? continuation(repoDir, existing, args.base, head) : undefined;
  if (existing && resumed && resumed.ok) {
    state = existing.status === "converged" ? { ...existing, status: "open", passFrom: existing.rounds.length } : existing;
    const last = existing.rounds.at(-1);
    io.stderr(`loop: continuing the loop on ${branch}: round ${existing.rounds.length + 1}${last ? `, the commits since round ${last.round} (${sha7(last.head)})` : ""}${existing.status === "converged" ? "; the last pass converged, so this is a new pass of the budget" : ""}.`);
  } else if (args.base !== undefined) {
    if (existing && existing.rounds.length > 0) io.stderr(`loop: starting a fresh loop on ${branch}: ${resumed && !resumed.ok ? resumed.why : "the earlier loop could not be read"}; its ${existing.rounds.length} round(s) are not carried over.`);
    state = { format: LOOP_STATE_FORMAT, branch, base: args.base, status: "open", rounds: [], ledger: [] };
  } else if (!existing) {
    throw new UsageError(`No loop is open on ${branch}; start one with \`wachiman loop --base <ref>\`.`);
  } else {
    throw new UsageError(`The loop on ${branch} cannot continue: ${resumed && !resumed.ok ? resumed.why : "it could not be read"}. Start a fresh one with \`wachiman loop --base <ref>\`.`);
  }

  const roundsRun = state.rounds.length;
  const passRounds = roundsRun - (state.passFrom ?? 0);

  // Stop before another round when this pass has used its budget: no model call.
  if (existing && resumed?.ok && roundCapReached(passRounds, args.maxRounds)) {
    const decision = evaluate(withVerdicts(state.ledger, verdicts()));
    state = { ...state, maxRounds: args.maxRounds };
    writeLoop(root, key, state);
    return render(
      report(state, roundsRun, passRounds, args, head, { kind: "none", head }, decision, 11, {
        status: "stopped",
        reason: "round cap",
        message: `Stopped without converging: round cap. This pass ran ${passRounds} round(s) (--max-rounds ${args.maxRounds}) and ${plural(decision.open.length, "finding")} still ${decision.open.length === 1 ? "keeps" : "keep"} the loop open. Raise --max-rounds to continue, or start a new loop with --base. A stop is never an approval.`,
      }),
      state,
    );
  }

  const previous = state.rounds.at(-1);
  const round = roundsRun + 1;
  const passRound = passRounds + 1;
  const now = () => new Date().toISOString();

  // No new commit since the last round: nothing to review. The verdicts may have changed.
  if (previous && previous.head === head) {
    const decision = evaluate(withVerdicts(state.ledger, verdicts()));
    state = { ...state, maxRounds: args.maxRounds, rounds: [...state.rounds, { round, head, at: now() }], status: decision.converged ? "converged" : "open" };
    writeLoop(root, key, state);
    io.stderr(`loop: no commit since round ${previous.round} (${sha7(head)}); nothing was reviewed, the verdicts were read again.`);
    return render(report(state, round, passRound, args, head, { kind: "none", head }, decision, decision.converged ? 0 : 10, finish(decision, round, passRound, args)), state);
  }

  const dirty = git(repoDir, ["status", "--porcelain", "--untracked-files=no"]);
  if (dirty.status === 0 && dirty.stdout.trim() !== "") io.stderr("loop: uncommitted changes are not reviewed; commit the fix first.");

  const from = previous ? previous.head : args.base ?? state.base;
  const localArgs: LocalArgs = {
    paths: [],
    format: "json",
    resultVersion: 2,
    agentPrompt: false,
    history: true,
    verify: args.verify,
    base: from,
    ...(args.profile !== undefined ? { profile: args.profile } : {}),
    ...(args.maxDepth !== undefined ? { maxDepth: args.maxDepth } : {}),
  };
  let made = await attempt(localArgs, repoDir, env, io, deps);
  if ("ok" in made && !made.ok) {
    io.stderr(`loop: the review failed (${made.why}); trying once more.`);
    made = await attempt(localArgs, repoDir, env, io, deps);
  }
  if ("interrupted" in made) return 130;
  if (!made.ok) {
    // The round is not recorded; a fresh loop is, so the next call can retry it without --base.
    if (!(existing && resumed?.ok)) writeLoop(root, key, state);
    const decision = evaluate(withVerdicts(state.ledger, verdicts()));
    return render(
      report(state, round, passRound, args, head, { kind: "none", head }, decision, 11, {
        status: "stopped",
        reason: "review failed",
        message: `Stopped without converging: review failed. The review call failed twice (${made.why}). Round ${round} was not recorded; run \`wachiman loop\` again to retry it. A stop is never an approval.`,
      }),
      state,
    );
  }

  const { result } = made;
  const decision = settle(state, result, repoDir, key, root, previous?.head ?? from, verdicts(), round);
  const recorded = reviewOf(result, decision.fresh);
  state = {
    ...state,
    maxRounds: args.maxRounds,
    rounds: [...state.rounds, { round, head: result.change.head.sha, at: now(), ...(recorded ? { review: recorded } : {}) }],
    ledger: decision.ledger,
    status: decision.decision.converged ? "converged" : "open",
  };
  writeLoop(root, key, state);
  const range: RoundReport["range"] = previous ? { kind: "since-previous-round", from: previous.head } : { kind: "whole", base: from };
  return render(report(state, round, passRound, args, result.change.head.sha, range, decision.decision, decision.decision.converged ? 0 : 10, finish(decision.decision, round, passRound, args)), state);
}

/**
 * Whether a call continues the branch's loop: the loop has the same base and its last round's head
 * is an ancestor of HEAD. The base is compared as the commit the branch forked from (the merge-base
 * with the ref), so a base that only moved ahead, with no rebase onto it, still counts as the same.
 * Otherwise `why` says in one clause what made it start over.
 */
function continuation(repoDir: string, existing: LoopState, requested: string | undefined, head: string): { ok: true } | { ok: false; why: string } {
  const last = existing.rounds.at(-1);
  // A loop whose first round failed has no round yet: it goes on from its base, unless another base was asked for.
  if (!last) return requested === undefined || requested === existing.base ? { ok: true } : { ok: false, why: `its base ${existing.base} is not the base ${requested} asked for` };
  if (git(repoDir, ["merge-base", "--is-ancestor", last.head, head]).status !== 0) {
    return { ok: false, why: `round ${last.round} (${sha7(last.head)}) is not in the history of HEAD any more (a rebase or a forced push)` };
  }
  if (requested !== undefined) {
    const forkOf = (ref: string, tip: string) => {
      const out = git(repoDir, ["merge-base", ref, tip]);
      return out.status === 0 ? out.stdout.trim() : "";
    };
    const wanted = forkOf(requested, head);
    const had = forkOf(existing.base, head);
    if (wanted === "" || had === "" || wanted !== had) return { ok: false, why: `its base ${existing.base} is not the base ${requested} asked for` };
  }
  return { ok: true };
}

/**
 * What the round's review reported about itself, copied from its result: the range it read, the
 * version and models, the API-equivalent cost and the time. Undefined when the result lacks a figure
 * (the summary then says `not recorded`): nothing here is ever estimated.
 */
function reviewOf(result: IdentifiedResult, fresh: number): RoundReview | undefined {
  const { costUsdEstimate: costUsd, durationMs } = result.execution;
  const base = result.change.base?.sha;
  const version = result.engine?.version;
  const reviewer = result.provider;
  if (!Number.isFinite(costUsd) || costUsd < 0 || !Number.isFinite(durationMs) || durationMs < 0) return undefined;
  if (!base || !version || !reviewer?.model || !reviewer.effort) return undefined;
  // A verifier that was skipped or failed made no call that counts: it is never recorded as the verifier that ran.
  const v = result.verification;
  const ran = v && v.status !== "skipped" && v.status !== "failed";
  return {
    base,
    version,
    reviewer: { model: reviewer.model, effort: reviewer.effort },
    ...(v && ran ? { verifier: { model: v.model, effort: v.effort } } : {}),
    ...(v && !ran ? { verifierStatus: v.status as "skipped" | "failed" } : {}),
    costUsd,
    durationMs,
    findings: result.findings.length,
    newFindings: fresh,
  };
}

/**
 * The new ledger and the decision after a round. The loop decides from the round's own result and the
 * code, never from the history's settled map (a review outside the loop writes to the same history).
 * In a round that reads a finding's file: reported again means open; not reported with its cited
 * line gone means probably fixed; not reported with the line still there means not repeated, which
 * still counts. A round that does not read the file keeps the previous state.
 */
function settle(
  state: LoopState,
  result: IdentifiedResult,
  repoDir: string,
  key: string,
  root: string,
  rangeFrom: string,
  verdicts: ReturnType<typeof readVerdicts>,
  round: number,
): { ledger: LedgerEntry[]; decision: Decision; fresh: number } {
  const head = result.change.head.sha;
  const renames = renamesIn(repoDir, rangeFrom, head);
  const expected = new Set(result.coverage.expected);
  const readThisRound = new Set(result.coverage.reviewed.filter((p) => expected.has(p)));
  const dropped = (result.verification?.entries ?? []).filter((e) => e.outcome === "dropped" && e.status === "refuted");
  const droppedKeys = dropped.map((d) => ({ path: d.path, topic: d.topic, titleKey: titleKey(d.title) }));
  type Reported = { id: string; path: string; line: number; severity: LedgerEntry["severity"]; topic: LedgerEntry["topic"]; title: string };
  const findings = result.findings as unknown as Reported[];

  const prior = state.ledger.map((e) => ({ ...e, path: renames.get(e.path) ?? e.path }));
  // A reported finding is the ledger entry with its id, or failing that the one in the same file with the same topic and title.
  const reportedBy = new Map<string, Reported>();
  const unmatched: Reported[] = [];
  for (const f of findings) {
    const e = prior.find((x) => x.id === f.id && !reportedBy.has(x.id));
    if (e) reportedBy.set(e.id, f);
    else unmatched.push(f);
  }
  const fresh: Reported[] = [];
  for (const f of unmatched) {
    const e = prior.find((x) => !reportedBy.has(x.id) && x.path === f.path && x.topic === f.topic && titleKey(x.title) === titleKey(f.title));
    if (e) reportedBy.set(e.id, f);
    else fresh.push(f);
  }

  // Fingerprints of entries written before the loop kept them come from the history, by id: data only, never a status.
  let past: Map<string, ReplayedFinding> | undefined;
  const fingerprintOf = (e: LedgerEntry) => {
    if (e.lineText !== undefined || e.blobSha !== undefined) return e;
    past ??= new Map(replay(readRuns(root, key, () => {}), verdicts).findings.map((f) => [f.firstId, f]));
    return past.get(e.id);
  };
  const seen = (f: Reported): LedgerEntry => ({
    id: f.id,
    path: f.path,
    line: f.line,
    severity: f.severity,
    topic: f.topic,
    title: f.title,
    status: "open",
    refuted: false,
    ...fingerprintAt(repoDir, head, f.path, f.line),
  });

  const ledger: LedgerEntry[] = [
    ...prior.map((e): LedgerEntry => {
      const again = reportedBy.get(e.id);
      if (again) return { ...seen(again), id: e.id, ...(e.round !== undefined ? { round: e.round } : {}) };
      const refuted =
        e.refuted ||
        droppedKeys.some((d) => isRefutedBy(d, { path: e.path, topic: e.topic, titleKey: titleKey(e.title) }));
      const fp = readThisRound.has(e.path) ? fingerprintOf(e) : undefined;
      if (!fp || (fp.lineText === undefined && fp.blobSha === undefined)) return { ...e, refuted };
      return { ...e, refuted, linesChanged: undefined, lineText: fp.lineText, blobSha: fp.blobSha, status: regionChanged(repoDir, head, e.path, fp) ? "probably-fixed" : "not-repeated" };
    }),
    ...fresh.map((f) => ({ ...seen(f), round })),
  ];
  return { ledger, decision: evaluate(withVerdicts(ledger, verdicts)), fresh: fresh.length };
}

function finish(d: Decision, round: number, passRound: number, args: LoopArgs): RoundReport["outcome"] {
  if (d.converged) {
    return {
      status: "converged",
      message:
        round === 1
          ? "Converged: nothing keeps the loop open. Round 1 reviewed the whole range. This is not an approval."
          : "Converged on incremental rounds: round 1 reviewed the whole range and later rounds only the commits after the previous round. Interactions between a fix and code outside those commits were not re-read. This is not an approval.",
    };
  }
  const left = args.maxRounds - passRound;
  return {
    status: "open",
    message: `${plural(d.open.length, "finding")} ${d.open.length === 1 ? "keeps" : "keep"} the loop open. Fix each one and commit, or judge it wrong with a reason (wachiman history --verdict <id> wrong --reason "<why>"), then run \`wachiman loop\` again. ${left > 0 ? `${plural(left, "round")} left of ${args.maxRounds}.` : `That was round ${passRound} of ${args.maxRounds} in this pass; the next call stops at the round cap.`}`,
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function report(
  state: LoopState,
  round: number,
  passRound: number,
  args: LoopArgs,
  head: string,
  range: RoundReport["range"],
  d: Decision,
  exitCode: 0 | 10 | 11,
  outcome: RoundReport["outcome"],
): RoundReport {
  return { branch: state.branch, round, passRound, maxRounds: args.maxRounds, range, head, open: d.open, released: d.released, notes: d.notes, outcome, exitCode };
}

const cleanFinding = (f: LoopFinding) => ({ id: f.id, path: f.path, line: f.line, severity: f.severity, topic: f.topic, title: f.title, status: f.status });

export function renderJson(r: RoundReport): string {
  const doc = {
    format: LOOP_RESULT_FORMAT,
    branch: r.branch,
    round: r.round,
    passRound: r.passRound,
    maxRounds: r.maxRounds,
    range: r.range,
    head: r.head,
    exitCode: r.exitCode,
    outcome: r.outcome,
    open: r.open.map((f) => ({ ...cleanFinding(f), ...(f.unreasonedWrong ? { unreasonedWrong: true } : {}) })),
    released: r.released.map((x) => ({ ...cleanFinding(x.finding), why: x.why, ...(x.reason ? { reason: x.reason } : {}) })),
    notes: r.notes.map(cleanFinding),
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

const row = (f: LoopFinding) => `${SEVERITY[f.severity].emoji} ${SEVERITY[f.severity].word} · ${TOPIC[f.topic].word}  ${location(f)}  ${neutralise(f.title).replace(/\s+/g, " ")}  (id ${f.id})`;

export function renderTerminal(r: RoundReport): string {
  const range =
    r.range.kind === "whole"
      ? `the whole range from ${neutralise(r.range.base)}`
      : r.range.kind === "since-previous-round"
        ? `the commits since round ${r.round - 1} (${sha7(r.range.from)})`
        : "no review this call";
  const lines = [`wachiman loop · ${neutralise(r.branch)} · round ${r.round} (${r.passRound} of ${r.maxRounds} in this pass) · ${range} → ${sha7(r.head)}`, ""];
  lines.push(`Keeps the loop open (${r.open.length}):`);
  for (const f of r.open) lines.push(`  ${row(f)}`, `      history: ${f.status}${f.unreasonedWrong ? " · judged wrong without a reason: still counts" : ""}`);
  if (r.open.length === 0) lines.push("  none");
  lines.push("", `No longer open (${r.released.length}):`);
  for (const x of r.released) lines.push(`  ${x.why}  ${row(x.finding)}${x.reason ? `\n      reason: ${neutralise(x.reason)}` : ""}`);
  if (r.released.length === 0) lines.push("  none");
  lines.push("", `Notes, never counted (${r.notes.length}):`);
  for (const f of r.notes) lines.push(`  ${row(f)}`);
  if (r.notes.length === 0) lines.push("  none");
  lines.push("", `Outcome (exit ${r.exitCode}): ${r.outcome.message}`);
  return `${lines.join("\n")}\n`;
}
