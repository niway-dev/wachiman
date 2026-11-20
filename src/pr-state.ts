/**
 * `wachiman pr-state` (ADR 0060): what Wachiman's own review needs from whoever works a pull request,
 * as one JSON object and an exit code. It reads the pull request's head, the engine's own reviews
 * and their state blocks, the engine's own finding threads and the "Wachiman review" check run, and
 * decides `next` with a fixed, ordered rule table (`decide`). It never posts, resolves, replies or
 * edits anything and stores nothing: every field is derived from GitHub on each call.
 *
 * `readPrState` is one complete state read. `--wait` (a later layer) loops it; nothing in here keeps
 * state between calls.
 */
import { UsageError } from "./config";
import {
  GhError,
  SIGNATURE,
  beforeLegacyCutoff,
  isBotFinding,
  isPartialFooter,
  jsonLines,
  parseInlineTable,
  readLegacyMarker,
  readSignedMarker,
  readSignedStateBlock,
  type GhFn,
  type RawThread,
} from "./engine";
import type { NotReviewedReason, ReviewStateBlock } from "./review-state";

export const PR_STATE_FORMAT = "wachiman.pr-state/1";

/** The engine's own reviews are posted by this login (ADR 0005); the REST name, with the `[bot]` suffix. */
export const OWN_REVIEW_LOGIN = "github-actions[bot]";
/** The same account as GraphQL names it, for review threads. */
const OWN_THREAD_LOGIN = "github-actions";
/** The check run the reusable workflow's review job reports. */
export const REVIEW_CHECK_NAME = "Wachiman review";

export type Next = "wait" | "act" | "blocked" | "done" | "closed";
export type ReviewKind = "none" | "running" | "complete" | "partial" | "scoped" | "not-reviewed" | "stale";
export type Why =
  | "closed"
  | "head_moved"
  | "review_running"
  | "review_not_started"
  | NotReviewedReason
  | "review_missing"
  | "findings_open"
  | "partial"
  | "clean";

export interface OpenFinding {
  thread_id: string;
  url: string | null;
  path: string | null;
  line: number | null;
  severity: "blocker" | "fix" | "consider" | "info" | null;
  outdated: boolean;
  /** `fix_or_reply`: Wachiman wrote the last comment. `resolve`: someone else did. */
  awaiting: "fix_or_reply" | "resolve";
}

export interface PrState {
  format: typeof PR_STATE_FORMAT;
  repo: string;
  pr: number;
  /** The head read at the start of the call. */
  head: string;
  review: {
    state: ReviewKind;
    reason: NotReviewedReason | null;
    /** The head the deciding review (or, for `stale` and `scoped`, the latest other one) covers. */
    reviewed_head: string | null;
    attempt: string | null;
    engine: string | null;
    source: "block" | "legacy-markers" | null;
  };
  findings: {
    open: OpenFinding[];
    /** Counts from the deciding block of findings that have no thread; null when there is no block to count from. */
    unthreaded: { blocking: number; body: number; outside_diff: number } | null;
  };
  next: Next;
  why: Why;
}

/** 0 done or closed, 20 act, 21 wait, 22 blocked. A GitHub error (1) and a usage error (2) never reach a document. */
export const EXIT_FOR: Record<Next, number> = { closed: 0, done: 0, act: 20, wait: 21, blocked: 22 };

/** The most pages of review threads read; a pull request cannot have anywhere near this many. */
const MAX_THREAD_PAGES = 200;

// ----- Reading GitHub ---------------------------------------------------------------------------

interface PullInfo {
  open: boolean;
  head: string;
}

function readPull(gh: GhFn, repo: string, pr: number): PullInfo {
  const jq = "{state, head: .head.sha} | @json";
  const raw = jsonLines<{ state?: unknown; head?: unknown }>(gh(["api", `repos/${repo}/pulls/${pr}`, "--jq", jq]))[0];
  if (!raw || typeof raw.head !== "string" || raw.head === "") throw new GhError(`GitHub answered no head commit for ${repo}#${pr}.`, null, "");
  return { open: raw.state === "open", head: raw.head };
}

interface OwnReview {
  body: string;
  createdAt: string;
}

/** The reviews the engine's author wrote, oldest first by creation time (ties keep GitHub's order). The author is checked here, not by the query. */
function readOwnReviews(gh: GhFn, repo: string, pr: number): OwnReview[] {
  const jq = ".[] | {login: .user.login, body, submitted_at} | @json";
  const rows = jsonLines<{ login?: string | null; body?: string | null; submitted_at?: string | null }>(
    gh(["api", "--paginate", `repos/${repo}/pulls/${pr}/reviews`, "--jq", jq]),
  );
  return rows
    .filter((r) => r.login === OWN_REVIEW_LOGIN)
    .map((r) => ({ body: r.body ?? "", createdAt: r.submitted_at ?? "" }))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.createdAt < b.r.createdAt ? -1 : a.r.createdAt > b.r.createdAt ? 1 : a.i - b.i))
    .map(({ r }) => r);
}

/** What the "Wachiman review" check runs on the head say: none, one still queued or in progress, or all finished. */
function readCheck(gh: GhFn, repo: string, head: string): "none" | "running" | "finished" {
  const jq = ".check_runs[] | {name, status} | @json";
  const runs = jsonLines<{ name?: string; status?: string }>(gh(["api", "--paginate", `repos/${repo}/commits/${head}/check-runs`, "--jq", jq])).filter(
    (r) => r.name === REVIEW_CHECK_NAME,
  );
  if (runs.length === 0) return "none";
  return runs.some((r) => r.status !== "completed") ? "running" : "finished";
}

interface ThreadComment {
  author: { login: string } | null;
  body: string;
  createdAt?: string;
  url?: string;
}
interface ThreadNode {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string | null;
  line: number | null;
  originalLine: number | null;
  first: { nodes: ThreadComment[] };
  last: { nodes: ThreadComment[] };
}

/**
 * Every review thread of the pull request, a page of 100 at a time. Each thread's first and last
 * comment are asked for by name, so a thread of any length needs no comment pagination: the first
 * decides whether it is a Wachiman finding, the last who wrote last.
 */
function readThreads(gh: GhFn, repo: string, pr: number): ThreadNode[] {
  const [owner, name] = repo.split("/");
  const query = `query($owner: String!, $name: String!, $pr: Int!, $after: String) {
    repository(owner: $owner, name: $name) { pullRequest(number: $pr) {
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { id isResolved isOutdated path line originalLine
          first: comments(first: 1) { nodes { author { login } body createdAt url } }
          last: comments(last: 1) { nodes { author { login } body createdAt url } } } } } } }`;
  const out: ThreadNode[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_THREAD_PAGES; page++) {
    const raw = gh(["api", "graphql", "-f", `query=${query}`, "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `pr=${pr}`, ...(after === null ? [] : ["-F", `after=${after}`])]);
    const threads = JSON.parse(raw)?.data?.repository?.pullRequest?.reviewThreads;
    if (!threads || !Array.isArray(threads.nodes)) throw new GhError(`GitHub answered no review threads for ${repo}#${pr}.`, null, "");
    out.push(...threads.nodes);
    const next: unknown = threads.pageInfo?.hasNextPage ? threads.pageInfo.endCursor : null;
    if (next === null) return out;
    if (typeof next !== "string" || next === after) throw new GhError("GitHub's review-thread pagination did not advance.", null, "");
    after = next;
  }
  throw new GhError(`More than ${MAX_THREAD_PAGES * 100} review threads on ${repo}#${pr}.`, null, "");
}

// ----- Reading the reviews ----------------------------------------------------------------------

/** One own review as `pr-state` reads it: from its state block, or from the markers of an engine without one. */
interface ReadReview {
  head: string;
  status: "complete" | "partial" | "scoped" | "not-reviewed";
  reason: NotReviewedReason | null;
  attempt: string | null;
  engine: string | null;
  source: "block" | "legacy-markers";
  block: ReviewStateBlock | null;
}

/**
 * What each own review says about a head. A signed review's block wins; without one, its
 * `wachiman sha=` or `wachi:partial` marker does (`legacy-markers`). A notice with no sha (refusal,
 * ceiling, limit before the block) says nothing about any head and is skipped, never read as complete.
 * An unsigned review from before signatures existed counts only under the engine's own window.
 */
export function readReviews(reviews: OwnReview[]): ReadReview[] {
  const firstSigned = reviews.findIndex((r) => r.body.includes(SIGNATURE.review));
  const out: ReadReview[] = [];
  reviews.forEach((r, i) => {
    if (r.body.includes(SIGNATURE.review)) {
      const block = readSignedStateBlock(r.body);
      if (block) {
        out.push({ head: block.head, status: block.status, reason: block.reason, attempt: block.attempt, engine: block.engine, source: "block", block });
        return;
      }
      const sha = readSignedMarker(r.body);
      if (sha) out.push(legacy(sha, isPartialFooter(r.body) ? "partial" : "complete"));
      return;
    }
    // Unsigned: the engine's own legacy window only (before the first signed review, before the cutoff).
    if (firstSigned !== -1 && i > firstSigned) return;
    if (!beforeLegacyCutoff(r.createdAt)) return;
    const sha = readLegacyMarker(r.body);
    if (sha) out.push(legacy(sha, "complete"));
  });
  return out;
}

const legacy = (head: string, status: "complete" | "partial"): ReadReview => ({ head, status, reason: null, attempt: null, engine: null, source: "legacy-markers", block: null });

// ----- Reading the threads ----------------------------------------------------------------------

const SEVERITY_WORD = /\*\*(Blocker|Fix|Consider|Info)\b/;

function severityOf(body: string): OpenFinding["severity"] {
  const word = parseInlineTable(body)?.severity.word ?? body.match(SEVERITY_WORD)?.[1] ?? (/\*\*Should fix\b/.test(body) ? "Fix" : null);
  return word === null ? null : (word.toLowerCase() as "blocker" | "fix" | "consider" | "info");
}

/** Every unresolved thread that opens with a finding of the engine's author, whoever replied since. */
export function openFindings(threads: ThreadNode[]): OpenFinding[] {
  const out: OpenFinding[] = [];
  for (const t of threads) {
    if (t.isResolved) continue;
    const first = t.first?.nodes?.[0];
    if (!first) continue;
    // The engine's own test, over the same shape it reads elsewhere (`openBotThreads`).
    const asRaw: RawThread = { isResolved: false, path: t.path ?? "", line: t.line, comments: { nodes: [{ databaseId: 0, author: first.author, authorAssociation: "", body: first.body, createdAt: first.createdAt }] } };
    if (!isBotFinding(asRaw) || first.author?.login !== OWN_THREAD_LOGIN) continue;
    const last = t.last?.nodes?.[0] ?? first;
    out.push({
      thread_id: t.id,
      url: first.url ?? null,
      path: t.path ?? null,
      line: t.line ?? t.originalLine ?? null,
      severity: severityOf(first.body),
      outdated: t.isOutdated === true,
      awaiting: last.author?.login === OWN_THREAD_LOGIN ? "fix_or_reply" : "resolve",
    });
  }
  return out;
}

// ----- The rule table ---------------------------------------------------------------------------

export interface Facts {
  open: boolean;
  headMoved: boolean;
  /** The deciding review of the current head (never a scoped one), or null. */
  deciding: ReadReview | null;
  check: "none" | "running" | "finished";
  openFindings: number;
  unthreadedBlocking: number;
}

/** The ordered rule table of the spec: the first row that matches decides. */
export function decide(f: Facts): { next: Next; why: Why } {
  if (!f.open) return { next: "closed", why: "closed" };
  if (f.headMoved) return { next: "wait", why: "head_moved" };
  if (!f.deciding) {
    if (f.check === "running") return { next: "wait", why: "review_running" };
    if (f.check === "none") return { next: "wait", why: "review_not_started" };
    return { next: "blocked", why: "review_missing" };
  }
  if (f.deciding.status === "not-reviewed") return { next: "blocked", why: f.deciding.reason ?? "review_missing" };
  if (f.openFindings > 0 || f.unthreadedBlocking > 0) return { next: "act", why: "findings_open" };
  if (f.deciding.status === "partial") return { next: "blocked", why: "partial" };
  return { next: "done", why: "clean" };
}

// ----- One state read ---------------------------------------------------------------------------

/**
 * One complete read of the pull request's state: the head, the own reviews, the own finding threads
 * and the check run, then the head again. A head that moved while reading answers `wait` with
 * `head_moved` (the rest of the document is then about the head read first). Throws `GhError` when
 * GitHub or `gh` fails.
 */
export function readPrState(gh: GhFn, repo: string, pr: number): PrState {
  const start = readPull(gh, repo, pr);
  const reviews = readReviews(readOwnReviews(gh, repo, pr));
  const check = readCheck(gh, repo, start.head);
  const open = openFindings(readThreads(gh, repo, pr));
  const end = readPull(gh, repo, pr);

  const onHead = reviews.filter((r) => r.head === start.head);
  // The latest attempt on this head decides, by creation time (the order of `reviews`); a scoped review never does.
  const deciding = onHead.filter((r) => r.status !== "scoped").at(-1) ?? null;
  const scoped = onHead.filter((r) => r.status === "scoped").at(-1) ?? null;
  const older = reviews.filter((r) => r.head !== start.head && r.status !== "scoped").at(-1) ?? null;

  const { next, why } = decide({
    open: start.open && end.open,
    headMoved: end.head !== start.head,
    deciding,
    check,
    openFindings: open.length,
    unthreadedBlocking: deciding?.block?.findings.unthreaded_blocking ?? 0,
  });

  let state: ReviewKind;
  let shown: ReadReview | null = deciding;
  if (deciding) state = deciding.status;
  else if (check === "running") (state = "running", (shown = older));
  else if (scoped) (state = "scoped", (shown = scoped));
  else if (older) (state = "stale", (shown = older));
  else state = "none";

  const f = deciding?.block?.findings;
  return {
    format: PR_STATE_FORMAT,
    repo,
    pr,
    head: start.head,
    review: {
      state,
      reason: deciding?.status === "not-reviewed" ? deciding.reason : null,
      reviewed_head: shown?.head ?? null,
      attempt: shown?.attempt ?? null,
      engine: shown?.engine ?? null,
      source: shown?.source ?? null,
    },
    findings: {
      open,
      unthreaded: f ? { blocking: f.unthreaded_blocking, body: f.by_placement.body, outside_diff: f.by_placement.outside_diff } : null,
    },
    next,
    why,
  };
}

// ----- The command ------------------------------------------------------------------------------

export const prStateUsage = "wachiman pr-state [<pr>] [--repo <owner/repo>] [--json]";

export interface PrStateArgs {
  pr?: number;
  repo?: string;
}

/** The arguments after `pr-state`. `--json` is accepted: JSON is the only format. */
export function parsePrStateArgs(argv: string[]): PrStateArgs | { help: true } {
  const args: PrStateArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--json") continue;
    if (arg === "--repo" || arg.startsWith("--repo=")) {
      const v = arg === "--repo" ? argv[++i] : arg.slice("--repo=".length);
      if (v === undefined || !/^[\w.-]+\/[\w.-]+$/.test(v)) throw new UsageError(`--repo must be <owner>/<repo>, got "${v ?? ""}".`);
      args.repo = v;
    } else if (arg.startsWith("-")) throw new UsageError(`Unknown option "${arg}" for pr-state.`);
    else if (args.pr !== undefined) throw new UsageError(`pr-state takes one pull request number, got a second argument "${arg}".`);
    else if (!/^[1-9]\d*$/.test(arg) || !Number.isSafeInteger(Number(arg))) throw new UsageError(`pr-state needs a pull request number, got "${arg}".`);
    else args.pr = Number(arg);
  }
  return args;
}

/** The repository and pull request to read: the arguments, then `gh` for what they leave out (the current branch's pull request). */
export function resolveTarget(args: PrStateArgs, gh: GhFn): { repo: string; pr: number } {
  if (args.pr !== undefined) {
    const repo = args.repo ?? gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new GhError("Could not tell which repository to read; pass --repo <owner/repo>.", null, "");
    return { repo, pr: args.pr };
  }
  const view = JSON.parse(gh(["pr", "view", "--json", "number,url", ...(args.repo ? ["--repo", args.repo] : [])])) as { number?: unknown; url?: unknown };
  const fromUrl = /^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/pull\//.exec(String(view.url ?? ""))?.[1];
  const repo = args.repo ?? fromUrl;
  if (typeof view.number !== "number" || !repo) throw new GhError("Could not tell which pull request to read; pass its number.", null, "");
  return { repo, pr: view.number };
}

/** Runs the command: one JSON document on stdout and the exit code of `next`; exit 1 with a stderr line when GitHub fails. */
export function runPrState(args: PrStateArgs, gh: GhFn, io: { stdout: (text: string) => void; stderr: (line: string) => void }): number {
  try {
    const { repo, pr } = resolveTarget(args, gh);
    const state = readPrState(gh, repo, pr);
    io.stdout(`${JSON.stringify(state, null, 2)}\n`);
    return EXIT_FOR[state.next];
  } catch (error) {
    if (error instanceof UsageError) throw error;
    io.stderr(`wachiman: pr-state: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    return 1;
  }
}
