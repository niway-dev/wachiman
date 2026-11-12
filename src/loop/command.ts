/**
 * `wachiman loop`: one review round per call (ADR 0034). A round is a local review with history on,
 * a comparison with the rounds before it, and an outcome the caller can branch on. The agent fixes
 * between calls; this command never edits code.
 *
 * Exit codes: 0 converged, 10 findings still open, 11 stopped without converging (`round cap`,
 * `review failed`), 2 usage error, 130 interrupted.
 *
 * The review is `runLocal` itself, asked for result `/2` with history on, so the account rules, the
 * prompt and the history are exactly those of `wachiman local`. Round 1 reviews the whole range from
 * `--base`; a later round reviews the commits since the previous round's head, as an ordinary range.
 * A round with no new commit makes no model call: it re-reads the verdicts and reports again.
 */
import { UsageError } from "../config";
import { neutralise, SEVERITY, TOPIC, type ReviewResult } from "../engine";
import { spawnGit } from "../evidence";
import { readReviewResultFormat } from "../formats";
import { wachimanHome } from "../accounts/config";
import { stripWhitespace, titleKey } from "../history/fingerprint";
import { replay, type ReplayedFinding } from "../history/match";
import { historyRoot, readRuns, readVerdicts, repositoryKey, runFileNames } from "../history/store";
import { LOCAL_FLAGS, parseFlags, runLocal, type LocalArgs, type LocalDeps } from "../local";
import { location, sha7 } from "../sinks/common";
import { LOOP_STATE_FORMAT, readLoop, writeLoop, type LedgerEntry, type LoopState } from "./state";
import { evaluate, isRefutedBy, roundCapReached, type Decision, type LoopFinding, type LoopStatus, type OpenFinding, type Released } from "./stop-rule";

export const LOOP_RESULT_FORMAT = "wachiman.loop-round/1";
export const DEFAULT_MAX_ROUNDS = 3;

export const loopUsage = `wachiman loop [--base <ref>] [--max-rounds <n>] [--max-depth <n>] [--repo-dir <dir>]
               [--format terminal|json] [--profile <name>] [--verify | --no-verify]`;

export interface LoopArgs {
  /** Starts a loop (round 1 reviews the whole range from here). Absent: continue the open loop. */
  base?: string;
  maxRounds: number;
  format: "terminal" | "json";
  profile?: string;
  verify: boolean | undefined;
  maxDepth?: number;
}

/** The flags `loop` takes, a subset of `local`'s plus `--max-rounds`. */
const LOOP_LOCAL_FLAGS = LOCAL_FLAGS.filter((f) => ["--base", "--format", "--profile", "--verify", "--no-verify", "--max-depth"].includes(f));

/** The arguments after `loop` (`--repo-dir` is already taken out). Both `--x v` and `--x=v`. */
export function parseLoopArgs(argv: string[]): LoopArgs {
  let maxRounds = DEFAULT_MAX_ROUNDS;
  let seenMax = false;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--max-rounds" || arg.startsWith("--max-rounds=")) {
      if (seenMax) throw new UsageError("--max-rounds was given twice.");
      seenMax = true;
      const v = arg === "--max-rounds" ? argv[++i] : arg.slice("--max-rounds=".length);
      if (v === undefined || v === "" || v.startsWith("--")) throw new UsageError("--max-rounds needs a value.");
      if (!/^[1-9]\d*$/.test(v) || !Number.isSafeInteger(Number(v))) throw new UsageError(`--max-rounds must be a positive integer, got "${v}".`);
      maxRounds = Number(v);
    } else rest.push(arg);
  }
  const local = parseFlags(rest, "loop", LOOP_LOCAL_FLAGS);
  if (local.paths.length > 0) throw new UsageError(`loop takes no path or argument ("${local.paths[0]}"): it reviews the committed branch.`);
  if (local.format === "markdown") throw new UsageError("--format must be terminal or json for loop.");
  return {
    ...(local.base !== undefined ? { base: local.base } : {}),
    maxRounds,
    format: local.format as "terminal" | "json",
    ...(local.profile !== undefined ? { profile: local.profile } : {}),
    verify: local.verify,
    ...(local.maxDepth !== undefined ? { maxDepth: local.maxDepth } : {}),
  };
}

export interface LoopDeps extends LocalDeps {
  /** The review of one round; `runLocal` unless a test says otherwise. */
  review?: typeof runLocal;
}

type Why = "round cap" | "review failed";

/** What one call reports, in terminal and JSON form. */
export interface RoundReport {
  branch: string;
  round: number;
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

/** A complete `/2` result whose findings all carry their history id. */
type IdentifiedResult = ReviewResult & { findings: { id: string }[] };
type Attempt = { ok: true; result: IdentifiedResult } | { ok: false; why: string } | { interrupted: true };

/** One review call: succeeds only with a complete `/2` result in which every finding has a history id. */
function attempt(args: LocalArgs, repoDir: string, env: Record<string, string | undefined>, io: LoopIo, deps: LoopDeps): Attempt {
  let out = "";
  let code: number;
  try {
    code = (deps.review ?? runLocal)(args, repoDir, env, { stdout: (t) => (out += t), stderr: io.stderr, engineVersion: io.engineVersion }, deps);
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

export function runLoop(args: LoopArgs, repoDir: string, env: Record<string, string | undefined>, io: LoopIo, deps: LoopDeps = {}): number {
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

  let state: LoopState;
  if (args.base !== undefined) {
    if (existing?.status === "open" && existing.rounds.length > 0) io.stderr(`loop: starting over on ${branch}; the open loop had run ${existing.rounds.length} round(s).`);
    state = { format: LOOP_STATE_FORMAT, branch, base: args.base, status: "open", rounds: [], ledger: [] };
  } else if (!existing) {
    throw new UsageError(`No loop is open on ${branch}; start one with \`wachiman loop --base <ref>\`.`);
  } else if (existing.status === "converged") {
    throw new UsageError(`The loop on ${branch} converged at round ${existing.rounds.length}; start a new one with \`wachiman loop --base <ref>\`.`);
  } else state = existing;

  const verdicts = () => readVerdicts(root, key);
  const roundsRun = state.rounds.length;
  const render = (report: RoundReport) => {
    io.stdout(args.format === "json" ? renderJson(report) : renderTerminal(report));
    return report.exitCode;
  };

  // Stop before another round when the cap is reached: no model call.
  if (args.base === undefined && roundCapReached(roundsRun, args.maxRounds)) {
    const decision = evaluate(withVerdicts(state.ledger, verdicts()));
    return render(
      report(state, roundsRun, args, head, { kind: "none", head }, decision, 11, {
        status: "stopped",
        reason: "round cap",
        message: `Stopped without converging: round cap. ${roundsRun} round(s) ran (--max-rounds ${args.maxRounds}) and ${plural(decision.open.length, "finding")} still ${decision.open.length === 1 ? "keeps" : "keep"} the loop open. Raise --max-rounds to continue, or start a new loop with --base. A stop is never an approval.`,
      }),
    );
  }

  const previous = state.rounds.at(-1);
  const round = roundsRun + 1;
  const now = () => new Date().toISOString();

  // No new commit since the last round: nothing to review. The verdicts may have changed.
  if (previous && previous.head === head) {
    const decision = evaluate(withVerdicts(state.ledger, verdicts()));
    state = { ...state, rounds: [...state.rounds, { round, head, at: now() }], status: decision.converged ? "converged" : "open" };
    writeLoop(root, key, state);
    io.stderr(`loop: no commit since round ${previous.round} (${sha7(head)}); nothing was reviewed, the verdicts were read again.`);
    return render(report(state, round, args, head, { kind: "none", head }, decision, decision.converged ? 0 : 10, finish(decision, round, args)));
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
  const runsBefore = new Set(runFileNames(root, key));
  let made = attempt(localArgs, repoDir, env, io, deps);
  if ("ok" in made && !made.ok) {
    io.stderr(`loop: the review failed (${made.why}); trying once more.`);
    made = attempt(localArgs, repoDir, env, io, deps);
  }
  if ("interrupted" in made) return 130;
  if (!made.ok) {
    // The round is not recorded; a fresh loop is, so the next call can retry it without --base.
    if (args.base !== undefined) writeLoop(root, key, state);
    const decision = evaluate(withVerdicts(state.ledger, verdicts()));
    return render(
      report(state, round, args, head, { kind: "none", head }, decision, 11, {
        status: "stopped",
        reason: "review failed",
        message: `Stopped without converging: review failed. The review call failed twice (${made.why}). Round ${round} was not recorded; run \`wachiman loop\` again to retry it. A stop is never an approval.`,
      }),
    );
  }

  const { result } = made;
  const ownRuns = [...(state.runs ?? []), ...thisRound(root, key, runsBefore, result)];
  const decision = settle(state, result, repoDir, key, root, previous?.head ?? from, verdicts(), new Set(ownRuns));
  state = {
    ...state,
    runs: ownRuns,
    rounds: [...state.rounds, { round, head: result.change.head.sha, at: now() }],
    ledger: decision.ledger,
    status: decision.decision.converged ? "converged" : "open",
  };
  writeLoop(root, key, state);
  const range: RoundReport["range"] = previous ? { kind: "since-previous-round", from: previous.head } : { kind: "whole", base: from };
  return render(report(state, round, args, result.change.head.sha, range, decision.decision, decision.decision.converged ? 0 : 10, finish(decision.decision, round, args)));
}

/**
 * The history run file this round's review saved: among the files that appeared during the call, the
 * newest one for this head whose findings are the result's (a failed first attempt may have saved one too).
 */
function thisRound(root: string, key: string, before: ReadonlySet<string>, result: IdentifiedResult): string[] {
  const names = runFileNames(root, key).filter((n) => !before.has(n));
  const head = result.change.head.sha;
  const ids = result.findings.map((f) => f.id).sort().join(",");
  const candidates = names.flatMap((name) => readRuns(root, key, () => {}, new Set([name])).map((run) => ({ name, run }))).filter((c) => c.run.result.change.head.sha === head);
  const exact = candidates.filter((c) => c.run.tracking.map((t) => t.firstId).sort().join(",") === ids);
  const pick = (exact.length > 0 ? exact : candidates).at(-1);
  return pick ? [pick.name] : [];
}

/** The new ledger and the decision after a round whose result and history entry exist. */
function settle(
  state: LoopState,
  result: IdentifiedResult,
  repoDir: string,
  key: string,
  root: string,
  rangeFrom: string,
  verdicts: ReturnType<typeof readVerdicts>,
  ownRuns: ReadonlySet<string>,
): { ledger: LedgerEntry[]; decision: Decision } {
  // Only the runs of this loop's own rounds: a finding another review settled says nothing about this branch.
  const tracked = new Map(replay(readRuns(root, key, () => {}, ownRuns), verdicts).findings.map((f) => [f.firstId, f]));
  const head = result.change.head.sha;
  const reportedIds = new Set(result.findings.map((f) => f.id));
  const renames = renamesIn(repoDir, rangeFrom, head);
  const expected = new Set(result.coverage.expected);
  const readThisRound = new Set(result.coverage.reviewed.filter((p) => expected.has(p)));
  const dropped = (result.verification?.entries ?? []).filter((e) => e.outcome === "dropped" && e.status === "refuted");

  const byId = new Map(state.ledger.map((e) => [e.id, e]));
  for (const f of result.findings) {
    if (byId.has(f.id)) continue;
    const t = tracked.get(f.id);
    byId.set(f.id, {
      id: f.id,
      path: t?.path ?? (f as { path: string }).path,
      line: t?.line ?? (f as { line: number }).line,
      severity: (f as { severity: LedgerEntry["severity"] }).severity,
      topic: (f as { topic: LedgerEntry["topic"] }).topic,
      title: (f as { title: string }).title,
      status: "new",
      refuted: false,
      linesChanged: false,
    });
  }

  const ledger: LedgerEntry[] = [...byId.values()].map((prior) => {
    const t = tracked.get(prior.id);
    const reported = reportedIds.has(prior.id);
    const path = t ? (renames.get(t.path) ?? t.path) : prior.path;
    const status: LoopStatus = t ? t.status : prior.status;
    const entry: LedgerEntry = {
      id: prior.id,
      path,
      line: t?.line ?? prior.line,
      severity: t?.severity ?? prior.severity,
      topic: t?.topic ?? prior.topic,
      title: t?.title ?? prior.title,
      status: reported ? "open" : status,
      refuted: false,
      linesChanged: false,
    };
    if (!reported) {
      const titleOf = titleKey(entry.title);
      entry.refuted =
        prior.refuted || dropped.some((d) => isRefutedBy({ path: d.path, line: d.line, topic: d.topic, titleKey: titleKey(d.title) }, { path, line: entry.line, topic: entry.topic, titleKey: titleOf }));
    }
    // A finding that a round settled as fixed or not repeated is looked at again whenever a round reads its
    // file: the original line back means it is not fixed (a revert reopens it), changed lines release it.
    // A round that does not read the file keeps what the previous round decided. A round that reports
    // the finding again makes it `open` and clears all of this.
    if (!reported) {
      const settled = (x: LoopStatus) => x === "probably-fixed" || x === "not-repeated";
      if (t !== undefined && readThisRound.has(path) && settled(status)) {
        const changed = regionChanged(repoDir, head, path, t);
        entry.status = changed && status === "probably-fixed" ? "probably-fixed" : "not-repeated";
        entry.linesChanged = changed;
      } else if (!readThisRound.has(path) && settled(prior.status)) {
        entry.status = prior.status;
        entry.linesChanged = prior.linesChanged;
      }
    }
    return entry;
  });
  // A finding reported in this round is new or open, never settled.
  return { ledger, decision: evaluate(withVerdicts(ledger, verdicts)) };
}

function finish(d: Decision, round: number, args: LoopArgs): RoundReport["outcome"] {
  if (d.converged) {
    return {
      status: "converged",
      message:
        round === 1
          ? "Converged: nothing keeps the loop open. Round 1 reviewed the whole range. This is not an approval."
          : "Converged on incremental rounds: round 1 reviewed the whole range and later rounds only the commits after the previous round. Interactions between a fix and code outside those commits were not re-read. This is not an approval.",
    };
  }
  const left = args.maxRounds - round;
  return {
    status: "open",
    message: `${plural(d.open.length, "finding")} ${d.open.length === 1 ? "keeps" : "keep"} the loop open. Fix each one and commit, or judge it wrong with a reason (wachiman history --verdict <id> wrong --reason "<why>"), then run \`wachiman loop\` again. ${left > 0 ? `${plural(left, "round")} left of ${args.maxRounds}.` : `That was round ${round} of ${args.maxRounds}; the next call stops at the round cap.`}`,
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function report(
  state: LoopState,
  round: number,
  args: LoopArgs,
  head: string,
  range: RoundReport["range"],
  d: Decision,
  exitCode: 0 | 10 | 11,
  outcome: RoundReport["outcome"],
): RoundReport {
  return { branch: state.branch, round, maxRounds: args.maxRounds, range, head, open: d.open, released: d.released, notes: d.notes, outcome, exitCode };
}

const cleanFinding = (f: LoopFinding) => ({ id: f.id, path: f.path, line: f.line, severity: f.severity, topic: f.topic, title: f.title, status: f.status });

export function renderJson(r: RoundReport): string {
  const doc = {
    format: LOOP_RESULT_FORMAT,
    branch: r.branch,
    round: r.round,
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
  const lines = [`wachiman loop · ${neutralise(r.branch)} · round ${r.round} of ${r.maxRounds} · ${range} → ${sha7(r.head)}`, ""];
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
