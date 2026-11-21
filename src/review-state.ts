/**
 * The review state block (ADR 0060): one versioned JSON object, base64url-encoded in an HTML
 * comment, that the engine writes in the signed footer of every review it posts. It says what the
 * review is (complete, partial, scoped, not reviewed and why) and counts its findings by severity
 * and by placement. It never holds finding text.
 *
 * This module owns the schema, the writer, the size cap and the strict decoder. It does not decide
 * where a block is trusted: that is the signed-footer rule in `engine.ts` (`readSignedStateBlock`),
 * next to every other footer marker. A block anywhere else is never read.
 *
 * Counts by placement add up to the headline count. `inline` findings have a thread, `outside_diff`
 * ones are listed under "Outside the diff", and `body` ones (information, pre-existing, inconclusive,
 * or inline findings GitHub refused to anchor) are listed in the body only.
 */

export const REVIEW_STATE_FORMAT = "wachiman.review-state/1";

/** The comment as it is written, with the encoded JSON in the group. The alphabet has no `>`, so no content can close it. */
export const STATE_ALPHABET = "[A-Za-z0-9_-]+";
export const STATE_SOURCE = `<!-- wachi:state (${STATE_ALPHABET}) -->`;
/** The same comment with no capture group, for readers that embed it and keep their own group indexes. */
export const STATE_SOURCE_NO_GROUP = `<!-- wachi:state ${STATE_ALPHABET} -->`;

/**
 * The most characters the whole `<!-- wachi:state … -->` comment may take. A real block is about
 * 500; the cap exists so that no field can make a review body pass GitHub's limit (the body fitting
 * leaves 5,500 characters free; the cap and the attempt line stay well within them).
 */
export const MAX_STATE_BLOCK_CHARS = 2_000;

export const REVIEW_STATUSES = ["complete", "partial", "scoped", "not-reviewed"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const NOT_REVIEWED_REASONS = ["billing", "auth", "rate_limit", "ceiling", "limit", "size_gate", "turn_limit", "timeout", "budget"] as const;
export type NotReviewedReason = (typeof NOT_REVIEWED_REASONS)[number];

export const SEVERITIES = ["blocker", "fix", "consider", "info"] as const;
type Sev = (typeof SEVERITIES)[number];

export interface StateFindings {
  /** The headline count: every finding the review states, wherever it is listed. */
  total: number;
  by_severity: Record<Sev, number>;
  by_placement: { inline: number; body: number; outside_diff: number };
  /** Blocker and Fix findings that have no thread (not inline). */
  unthreaded_blocking: number;
}

export interface ReviewStateBlock {
  format: typeof REVIEW_STATE_FORMAT;
  engine: string;
  head: string;
  attempt: string;
  status: ReviewStatus;
  /** Required when `status` is `not-reviewed`, null otherwise. */
  reason: NotReviewedReason | null;
  /** On a base-update line: the earlier head whose review (and counts) it carries over. */
  carried_from?: string;
  /** `binary_only` on the all-binary notice; the number of paths on a scoped review. */
  scope?: "binary_only" | number;
  findings: StateFindings;
}

/**
 * What the engine knows about a review before it is sent. The head, the attempt id and the engine
 * version are added at post time, and the placement counts are settled against the comments that
 * are actually sent (see `settleFindings`).
 */
export interface ReviewStateDraft {
  status: ReviewStatus;
  reason?: NotReviewedReason;
  carriedFrom?: string;
  scope?: "binary_only" | number;
  /** The counts as the review was built. */
  findings: StateFindings;
  /**
   * The inline findings of the review as built, and how many of them are Blocker or Fix. When the
   * review is sent without its inline comments (GitHub refused them and they moved into the body),
   * they are counted under `body` and, if blocking, under `unthreaded_blocking`.
   */
  threaded?: { inline: number; blocking: number };
}

export const noFindings = (): StateFindings => ({
  total: 0,
  by_severity: { blocker: 0, fix: 0, consider: 0, info: 0 },
  by_placement: { inline: 0, body: 0, outside_diff: 0 },
  unthreaded_blocking: 0,
});

/**
 * Counts for a review as `buildReview` lays it out: `inline` are the findings that got a thread,
 * `outsideDiff` the ones listed under "Outside the diff"; every other finding is listed in the body.
 */
export function countFindings(
  findings: { severity: Sev }[],
  inline: { severity: Sev }[],
  outsideDiff: { severity: Sev }[],
): { findings: StateFindings; threaded: { inline: number; blocking: number } } {
  const out = noFindings();
  for (const f of findings) out.by_severity[f.severity] += 1;
  out.total = findings.length;
  out.by_placement.inline = inline.length;
  out.by_placement.outside_diff = outsideDiff.length;
  out.by_placement.body = findings.length - inline.length - outsideDiff.length;
  const blocking = (list: { severity: Sev }[]) => list.filter((f) => f.severity === "blocker" || f.severity === "fix").length;
  out.unthreaded_blocking = blocking(findings) - blocking(inline);
  return { findings: out, threaded: { inline: inline.length, blocking: blocking(inline) } };
}

/**
 * The counts for what is actually sent. The inline comments go either all or none: when none go but
 * the review was built with some (the 422 fallback of `moveCommentsToBody`), they are body findings
 * now and a blocking one has no thread.
 */
export function settleFindings(draft: ReviewStateDraft, postedInline: number): StateFindings {
  const f = draft.findings;
  const moved = draft.threaded && postedInline === 0 ? draft.threaded : null;
  if (!moved || moved.inline === 0) return f;
  return {
    ...f,
    by_severity: { ...f.by_severity },
    by_placement: { inline: 0, body: f.by_placement.body + moved.inline, outside_diff: f.by_placement.outside_diff },
    unthreaded_blocking: f.unthreaded_blocking + moved.blocking,
  };
}

const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text);
/** A sha or an id: letters, digits and dashes only, so it reads back through the strict decoder. */
const idOf = (text: string, max = 64) => clip(text.replace(/[^A-Za-z0-9-]/g, ""), max);

/** The block for a draft: the engine version, head and attempt join the draft; placement is settled against `postedInline`. */
export function buildStateBlock(
  draft: ReviewStateDraft,
  ctx: { engine: string; head: string; attempt: string },
  postedInline: number,
): ReviewStateBlock {
  return {
    format: REVIEW_STATE_FORMAT,
    engine: clip(ctx.engine.replace(/[^\w.+-]/g, ""), 40) || "unknown",
    head: idOf(ctx.head),
    attempt: idOf(ctx.attempt),
    status: draft.status,
    reason: draft.status === "not-reviewed" ? (draft.reason ?? null) : null,
    ...(draft.carriedFrom ? { carried_from: idOf(draft.carriedFrom) } : {}),
    ...(draft.scope !== undefined ? { scope: draft.scope } : {}),
    findings: settleFindings(draft, postedInline),
  };
}

const encodeJson = (value: unknown) => `<!-- wachi:state ${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")} -->`;

/**
 * The comment to write: `<!-- wachi:state <base64url JSON> -->`. When it would pass
 * `MAX_STATE_BLOCK_CHARS` the optional fields go first and the engine version is shortened, so the
 * counts always stay; never throws and never returns something longer than the cap.
 */
export function encodeStateBlock(block: ReviewStateBlock): string {
  const full = encodeJson(block);
  if (full.length <= MAX_STATE_BLOCK_CHARS) return full;
  // The optional fields go, the ids are clipped and the version is dropped; the status and the counts stay.
  const { carried_from: _carried, scope: _scope, ...lean } = block;
  return encodeJson({ ...lean, engine: "unknown", head: clip(block.head, 64), attempt: clip(block.attempt, 64) });
}

const isCount = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 1_000_000;
const isId = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9-]{1,64}$/.test(s);

function readFindings(value: unknown): StateFindings | null {
  if (typeof value !== "object" || value === null) return null;
  const f = value as Record<string, unknown>;
  const sev = f.by_severity as Record<string, unknown> | null;
  const place = f.by_placement as Record<string, unknown> | null;
  if (typeof sev !== "object" || sev === null || typeof place !== "object" || place === null) return null;
  const by_severity = { blocker: sev.blocker, fix: sev.fix, consider: sev.consider, info: sev.info };
  const by_placement = { inline: place.inline, body: place.body, outside_diff: place.outside_diff };
  if (!Object.values(by_severity).every(isCount) || !Object.values(by_placement).every(isCount)) return null;
  if (!isCount(f.total) || !isCount(f.unthreaded_blocking)) return null;
  const s = by_severity as Record<Sev, number>;
  const p = by_placement as StateFindings["by_placement"];
  const sum = (o: Record<string, number>) => Object.values(o).reduce((n, v) => n + v, 0);
  if (sum(s) !== f.total || sum(p) !== f.total) return null;
  if (f.unthreaded_blocking > s.blocker + s.fix) return null;
  return { total: f.total, by_severity: s, by_placement: p, unthreaded_blocking: f.unthreaded_blocking };
}

/**
 * The block inside an encoded comment, or null when it is not one `encodeStateBlock` writes: not
 * base64url JSON, another format version, a field of the wrong type, a reason missing on a notice
 * (or present on a review), or counts that do not add up. Knows nothing about where it was found:
 * `engine.ts` calls it only for a comment in a signed footer.
 */
export function decodeStateBlock(encoded: string): ReviewStateBlock | null {
  if (encoded.length > MAX_STATE_BLOCK_CHARS) return null;
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    data = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  if (data.format !== REVIEW_STATE_FORMAT) return null;
  if (typeof data.engine !== "string" || data.engine.length === 0 || data.engine.length > 64) return null;
  if (!isId(data.head) || !isId(data.attempt)) return null;
  const status = data.status;
  if (!(REVIEW_STATUSES as readonly unknown[]).includes(status)) return null;
  const reason = data.reason ?? null;
  if (status === "not-reviewed") {
    if (!(NOT_REVIEWED_REASONS as readonly unknown[]).includes(reason)) return null;
  } else if (reason !== null) return null;
  const carried = data.carried_from;
  if (carried !== undefined && !isId(carried)) return null;
  const scope = data.scope;
  if (scope !== undefined && scope !== "binary_only" && !(typeof scope === "number" && Number.isInteger(scope) && scope > 0 && scope <= 1_000_000)) {
    return null;
  }
  const findings = readFindings(data.findings);
  if (!findings) return null;
  return {
    format: REVIEW_STATE_FORMAT,
    engine: data.engine,
    head: data.head,
    attempt: data.attempt,
    status: status as ReviewStatus,
    reason: reason as NotReviewedReason | null,
    ...(carried !== undefined ? { carried_from: carried as string } : {}),
    ...(scope !== undefined ? { scope: scope as "binary_only" | number } : {}),
    findings,
  };
}
