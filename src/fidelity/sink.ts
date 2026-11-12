/**
 * Writing PR Confidence into the pull request description (ADR 0033 decisions 11 and 14), and the
 * reset that runs before any model call. Everything here is best-effort: the review is the record
 * and is already posted, so a failed read or write of the description is a warning, never an error.
 * Nothing is written in a dry run.
 *
 * The block goes into the description as it is now, read right before the write, so an edit made
 * while the review ran is kept. The same read gives the commit and the text the grade is checked
 * against: a grade whose commit is no longer the head, or whose claims were read from text that has
 * changed, is written as `cannot say`.
 */
import type { GhFn } from "../engine";
import { cannotSayBlock, renderBlock, upsertBlock } from "./block";
import { claimsDigest } from "./digest";
import { computeGrade } from "./grade";
import type { Fidelity } from "./types";

/** What the block says when no review of the commit has finished (the reset, and a newer head). */
export const RESET_REASON = "The review of this commit has not finished";

export interface SinkDeps {
  gh: GhFn;
  dryRun: boolean;
  log: (line: string) => void;
  warn: (line: string) => void;
  /** The clock, in ms, for the date in the block. Default: `Date.now`. */
  now?: () => number;
}

interface Live {
  headRefOid: string;
  title: string;
  body: string;
}

function readLive(gh: GhFn, repo: string, pr: number): Live {
  const live = JSON.parse(gh(["pr", "view", String(pr), "-R", repo, "--json", "headRefOid,title,body"])) as Partial<Live>;
  if (typeof live.headRefOid !== "string" || live.headRefOid === "") throw new Error("the pull request has no head commit");
  return { headRefOid: live.headRefOid, title: live.title ?? "", body: live.body ?? "" };
}

const dateOf = (deps: SinkDeps) => new Date((deps.now ?? Date.now)()).toISOString().slice(0, 10);

/**
 * The grade as it stands at the moment of writing. A review whose commit is still the head and
 * whose text is the one the claims were read from keeps its grade (the same object); any other is
 * `cannot say` with the reason, no trial mark and no letter.
 */
export function failClosed(f: Fidelity, now: { headCommit: string; title: string; body: string }): Fidelity {
  const stale = computeGrade({
    claims: [],
    assignments: [],
    changedFiles: [],
    openFindings: [],
    riskMap: { level: "low", facts: [], judgement: [], pathReasons: [], droppedFacts: 0 },
    run: {
      finished: true,
      unreadFiles: 0,
      reviewedCommit: f.reviewedCommit,
      headCommit: now.headCommit,
      digestAtRead: f.digest,
      digestAtWrite: claimsDigest(now.title, now.body),
    },
  });
  if (stale.grade !== "cannot say") return f;
  return { ...f, grade: "cannot say", reasons: stale.reasons, trial: false };
}

/** Puts `block` into the live description. Returns false when nothing needed writing. */
function write(deps: SinkDeps, repo: string, pr: number, live: Live, block: string): boolean {
  const next = upsertBlock(live.body, block);
  if (deps.dryRun) {
    deps.log(`--- PR Confidence block (dry run, not written) ---\n${block}`);
    return false;
  }
  if (next === live.body) return false;
  deps.gh(["api", "-X", "PATCH", `repos/${repo}/pulls/${pr}`, "--input", "-"], JSON.stringify({ body: next }));
  return true;
}

export interface Publish {
  /** The commit the review read. */
  headSha: string;
  /** The grade; absent for a review that cannot give one (an incremental or scoped review). */
  fidelity?: Fidelity;
  /** Why there is no grade, when `fidelity` is absent. */
  partialReason?: string;
  /** The posted review comment, when GitHub said where it is. */
  reviewUrl?: string;
  /** `https://github.com/owner/repo`. */
  permalinkBase: string;
}

/** The block after a review: the grade, or `cannot say` when the text has moved on. A newer head writes nothing. */
export function publishConfidence(deps: SinkDeps, repo: string, pr: number, p: Publish): void {
  try {
    const live = readLive(deps.gh, repo, pr);
    const date = dateOf(deps);
    if (live.headRefOid !== p.headSha) {
      // The review read an older commit. The run for the newer commit owns the block (it reset it,
      // and may have finished): writing here could wipe its grade.
      deps.log(`PR Confidence not written: the pull request has a newer commit (${live.headRefOid.slice(0, 7)}) than this review's ${p.headSha.slice(0, 7)}.`);
      return;
    }
    let block: string;
    if (!p.fidelity) {
      block = cannotSayBlock(p.headSha, p.partialReason ?? RESET_REASON, { date, reviewUrl: p.reviewUrl });
    } else {
      const f = failClosed(p.fidelity, { headCommit: live.headRefOid, title: live.title, body: live.body });
      block = renderBlock(f, { reviewUrl: p.reviewUrl, reviewedCommit: p.headSha, date, permalinkBase: p.permalinkBase });
    }
    write(deps, repo, pr, live, block);
  } catch (error) {
    deps.warn(`PR Confidence: the description could not be updated (${String(error).slice(0, 200)}). The review is posted.`);
  }
}

/**
 * The reset (decision 14): before any model call, the block becomes `cannot say` for the commit
 * under review, so a run that is cancelled during the push wait, fails or hits the ceiling leaves no
 * letter from an earlier commit. A run that finds a newer head is stale: the newer run resets it.
 */
export function resetConfidence(deps: SinkDeps, repo: string, pr: number, commit?: string): void {
  try {
    const live = readLive(deps.gh, repo, pr);
    if (commit !== undefined && commit !== live.headRefOid) {
      deps.log(`PR Confidence reset skipped: the pull request has a newer commit (${live.headRefOid.slice(0, 7)}) than this run's ${commit.slice(0, 7)}.`);
      return;
    }
    write(deps, repo, pr, live, cannotSayBlock(live.headRefOid, RESET_REASON, { date: dateOf(deps) }));
  } catch (error) {
    deps.warn(`PR Confidence: the description block could not be reset (${String(error).slice(0, 200)}).`);
  }
}
