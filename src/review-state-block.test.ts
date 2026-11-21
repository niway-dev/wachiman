import { describe, expect, test } from "bun:test";
import {
  MAX_STATE_BLOCK_CHARS,
  NOT_REVIEWED_REASONS,
  REVIEW_STATE_FORMAT,
  STATE_SOURCE,
  buildStateBlock,
  countFindings,
  decodeStateBlock,
  encodeStateBlock,
  noFindings,
  settleFindings,
  type ReviewStateBlock,
  type ReviewStateDraft,
} from "./review-state";

// ADR 0060: the block's schema, writer, size cap and strict decoder. Where a block is trusted is
// the signed-footer rule in engine.ts, tested next to the other footer markers.

const HEAD = "9f2c1234abcd5678";
const ATTEMPT = "6b1e0000-0000-4000-8000-000000000001";
const CTX = { engine: "1.18.0", head: HEAD, attempt: ATTEMPT };
const encodedOf = (comment: string) => new RegExp(`^${STATE_SOURCE}$`).exec(comment)?.[1] as string;
const sev = (...s: ("blocker" | "fix" | "consider" | "info")[]) => s.map((severity) => ({ severity }));

/** The three placements of the spec's example: 4 inline, 2 in the body, 1 outside the diff. */
const example = (): ReviewStateDraft => {
  const all = sev("fix", "consider", "consider", "consider", "consider", "info", "info");
  const counted = countFindings(all, all.slice(0, 4), all.slice(4, 5));
  return { status: "complete", ...counted };
};

describe("the block's content (AC2)", () => {
  test("holds format, engine, head, attempt, status, reason and the finding counts", () => {
    const block = buildStateBlock(example(), CTX, 4);
    expect(block).toEqual({
      format: "wachiman.review-state/1",
      engine: "1.18.0",
      head: HEAD,
      attempt: ATTEMPT,
      status: "complete",
      reason: null,
      findings: {
        total: 7,
        by_severity: { blocker: 0, fix: 1, consider: 4, info: 2 },
        by_placement: { inline: 4, body: 2, outside_diff: 1 },
        unthreaded_blocking: 0,
      },
    });
  });

  test("the placements add up to the headline count, including the gap between it and the inline count", () => {
    // 7 findings, 4 on their lines: the headline says 7, the inline count 4, the gap is by design.
    const { findings } = buildStateBlock(example(), CTX, 4);
    const placed = findings.by_placement.inline + findings.by_placement.body + findings.by_placement.outside_diff;
    expect(placed).toBe(findings.total);
    expect(findings.by_placement.inline).toBeLessThan(findings.total);
  });

  test("a Blocker or Fix finding with no thread is counted as unthreaded blocking", () => {
    const all = sev("blocker", "fix", "fix", "info");
    const draft: ReviewStateDraft = { status: "complete", ...countFindings(all, all.slice(2, 3), all.slice(1, 2)) };
    expect(draft.findings.unthreaded_blocking).toBe(2);
    expect(draft.findings.by_placement).toEqual({ inline: 1, body: 2, outside_diff: 1 });
  });

  test("a notice states its reason, a base-update line its earlier head, the all-binary notice and a scoped review their scope", () => {
    const notice = buildStateBlock({ status: "not-reviewed", reason: "billing", findings: noFindings() }, CTX, 0);
    expect(notice).toMatchObject({ status: "not-reviewed", reason: "billing" });
    const carried = buildStateBlock({ status: "complete", carriedFrom: "1234abc", findings: noFindings() }, CTX, 0);
    expect(carried).toMatchObject({ status: "complete", carried_from: "1234abc", reason: null });
    const binary = buildStateBlock({ status: "complete", scope: "binary_only", findings: noFindings() }, CTX, 0);
    expect(binary).toMatchObject({ status: "complete", scope: "binary_only" });
    expect(binary.findings.total).toBe(0);
    const scoped = buildStateBlock({ status: "scoped", scope: 3, findings: noFindings() }, CTX, 0);
    expect(scoped).toMatchObject({ status: "scoped", scope: 3 });
  });

  test("a reason is written only on a notice", () => {
    const review = buildStateBlock({ status: "complete", reason: "billing", findings: noFindings() }, CTX, 0);
    expect(review.reason).toBeNull();
  });
});

describe("the placement is settled against what is sent (AC16)", () => {
  test("inline comments that moved into the body are counted under body, and a blocking one has no thread", () => {
    const all = sev("blocker", "fix", "consider", "info");
    const draft: ReviewStateDraft = { status: "complete", ...countFindings(all, all.slice(0, 3), []) };
    expect(draft.findings.by_placement).toEqual({ inline: 3, body: 1, outside_diff: 0 });
    expect(draft.findings.unthreaded_blocking).toBe(0);
    expect(settleFindings(draft, 3)).toEqual(draft.findings);
    const moved = settleFindings(draft, 0);
    expect(moved.by_placement).toEqual({ inline: 0, body: 4, outside_diff: 0 });
    expect(moved.unthreaded_blocking).toBe(2);
    expect(moved.total).toBe(4);
    // The draft is not changed: the same review can be settled again for another send.
    expect(draft.findings.by_placement.inline).toBe(3);
  });

  test("a review built with no inline comments is the same whether or not any are posted", () => {
    const all = sev("consider");
    const draft: ReviewStateDraft = { status: "complete", ...countFindings(all, [], []) };
    expect(settleFindings(draft, 0)).toEqual(draft.findings);
  });
});

describe("the encoded comment", () => {
  test("round-trips through the strict decoder", () => {
    const block = buildStateBlock(example(), CTX, 4);
    const comment = encodeStateBlock(block);
    expect(comment).toMatch(new RegExp(`^${STATE_SOURCE}$`));
    expect(decodeStateBlock(encodedOf(comment))).toEqual(block);
  });

  test("is base64url: nothing in it can close the comment", () => {
    const block = buildStateBlock({ status: "partial", findings: noFindings() }, { ...CTX, engine: "-->.<!--" }, 0);
    const comment = encodeStateBlock(block);
    expect(comment.match(/-->/g)).toHaveLength(1);
    expect(comment.slice("<!-- wachi:state ".length, -" -->".length)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  const encode = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const good = (): ReviewStateBlock => buildStateBlock(example(), CTX, 4);
  const rejects = (edit: (b: Record<string, unknown>) => void) => {
    const b = structuredClone(good()) as unknown as Record<string, unknown>;
    edit(b);
    return decodeStateBlock(encode(b));
  };

  test("rejects anything that is not exactly the schema", () => {
    expect(decodeStateBlock("not base64 json!")).toBeNull();
    expect(decodeStateBlock(encode([]))).toBeNull();
    expect(decodeStateBlock(encode("x"))).toBeNull();
    expect(rejects((b) => (b.format = "wachiman.review-state/2"))).toBeNull();
    expect(rejects((b) => delete b.format)).toBeNull();
    expect(rejects((b) => (b.status = "done"))).toBeNull();
    expect(rejects((b) => (b.head = "has spaces"))).toBeNull();
    expect(rejects((b) => (b.attempt = 5))).toBeNull();
    expect(rejects((b) => (b.engine = ""))).toBeNull();
    expect(rejects((b) => (b.scope = 0))).toBeNull();
    expect(rejects((b) => (b.scope = "everything"))).toBeNull();
    expect(rejects((b) => (b.carried_from = "a b"))).toBeNull();
  });

  test("rejects counts that do not add up, and negative or fractional ones", () => {
    expect(rejects((b) => ((b.findings as { total: number }).total = 8))).toBeNull();
    expect(rejects((b) => ((b.findings as { by_placement: { inline: number } }).by_placement.inline = 9))).toBeNull();
    expect(rejects((b) => ((b.findings as { by_severity: { fix: number } }).by_severity.fix = -1))).toBeNull();
    expect(rejects((b) => ((b.findings as { by_severity: { fix: number } }).by_severity.fix = 0.5))).toBeNull();
    expect(rejects((b) => ((b.findings as { unthreaded_blocking: number }).unthreaded_blocking = 5))).toBeNull();
    expect(rejects((b) => delete (b.findings as { by_placement?: unknown }).by_placement)).toBeNull();
  });

  test("every reason of the spec round-trips, the stop reasons included", () => {
    expect(NOT_REVIEWED_REASONS).toEqual(["billing", "auth", "rate_limit", "ceiling", "limit", "size_gate", "turn_limit", "timeout", "budget"]);
    for (const reason of NOT_REVIEWED_REASONS) {
      const notice = buildStateBlock({ status: "not-reviewed", reason, findings: noFindings() }, CTX, 0);
      expect(decodeStateBlock(encodedOf(encodeStateBlock(notice)))?.reason).toBe(reason);
    }
  });

  test("requires a reason on a notice and none on a review", () => {
    const notice = buildStateBlock({ status: "not-reviewed", reason: "ceiling", findings: noFindings() }, CTX, 0);
    expect(decodeStateBlock(encodedOf(encodeStateBlock(notice)))).toEqual(notice);
    expect(rejects((b) => ((b.status = "not-reviewed"), (b.reason = null)))).toBeNull();
    expect(rejects((b) => ((b.status = "not-reviewed"), (b.reason = "because")))).toBeNull();
    expect(rejects((b) => (b.reason = "billing"))).toBeNull();
  });

  test("a block from a future compatible writer with extra fields is still read, and the extras are not kept", () => {
    const decoded = rejects((b) => (b.extra = "x"));
    expect(decoded).toEqual(good());
  });
});

describe("the size cap (AC4)", () => {
  test("a block with oversized fields keeps its counts and status and stays under the cap", () => {
    const big = "x".repeat(50_000);
    const block: ReviewStateBlock = {
      ...buildStateBlock({ status: "partial", carriedFrom: "abc", scope: 4, ...{ findings: countFindings(sev("fix", "info"), sev("fix"), []).findings } }, CTX, 1),
      engine: big,
      head: big,
      attempt: big,
    };
    const comment = encodeStateBlock(block);
    expect(comment.length).toBeLessThanOrEqual(MAX_STATE_BLOCK_CHARS);
    const decoded = decodeStateBlock(encodedOf(comment));
    // The ids are clipped to what the decoder accepts; the counts and the status are exactly as given.
    expect(decoded?.status).toBe("partial");
    expect(decoded?.findings).toEqual(block.findings);
  });

  test("the writer bounds the engine version, so a normal block is far under the cap", () => {
    const block = buildStateBlock({ status: "complete", findings: noFindings() }, { ...CTX, engine: "9".repeat(10_000) }, 0);
    expect(block.engine.length).toBeLessThanOrEqual(40);
    expect(encodeStateBlock(block).length).toBeLessThan(MAX_STATE_BLOCK_CHARS / 2);
  });

  test("the format constant is the version the spec names", () => {
    expect(REVIEW_STATE_FORMAT).toBe("wachiman.review-state/1");
  });
});
