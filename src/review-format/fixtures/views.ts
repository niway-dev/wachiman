/** Hand-built views for the tests of the review format. Synthetic: no pull request, no model. */
import type { Contract } from "../../contracts";
import { countFindingRows, type FindingRow, type GlanceRow, type NeedsPersonItem, type ReviewView } from "../view";

export const SHA = "d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const SINCE = "9a8b7c6bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

export const row = (over: Partial<FindingRow> = {}): FindingRow => ({
  severity: "fix",
  priority: "should",
  topic: "bug",
  confidence: "high",
  origin: "introduced",
  path: "src/a.ts",
  line: 1,
  displayPath: "a.ts",
  location: "a.ts:1",
  title: "a finding",
  body: "its body",
  inlineThread: true,
  outsideDiff: false,
  ...over,
});

export const person = (over: Partial<NeedsPersonItem> = {}): NeedsPersonItem => ({
  kind: "tradeoff",
  path: "docs/x.md",
  line: 3,
  displayPath: "x.md",
  location: "x.md:3",
  why: "a person decides",
  ...over,
});

export const contract = (status: Contract["status"]): Contract => ({
  action: "the new button",
  location: "src/a.ts:1",
  status,
  evidence: ["src/a.ts:1"],
  ...(status === "open" ? { open_question: "does the server accept it?" } : {}),
});

type Slots = Partial<ReviewView["findings"]>;

/** A clean review of four files, whole pull request, no verifier; `over` replaces any field. `findings` may name only some slots. */
export function makeView(over: Omit<Partial<ReviewView>, "findings"> & { findings?: Slots } = {}): ReviewView {
  const { findings: slots, ...rest } = over;
  const findings = { toFix: [], investigate: [], consider: [], preExisting: [], info: [], ...slots };
  const glance: GlanceRow[] = [{ key: "findings", ...countFindingRows(findings) }];
  return {
    scope: { kind: "whole", since: null, head: SHA, carried: 0 },
    files: { total: 4, reviewed: 4, notReviewed: [], notReviewedTwice: [], notReviewable: [] },
    notices: {},
    verifier: { status: "verified", notChecked: 0 },
    earlierThreads: 0,
    glance,
    needsPerson: [],
    risk: null,
    contracts: { open: [], closed: [] },
    batchProse: "",
    coverage: { rows: [], estimate: false },
    footer: { costLine: "<sub>m via c · $0.10</sub>", markers: [] },
    ...rest,
    findings,
  };
}

/** A view that is partial: `n` of `total` files not reviewed, for one reason. */
export const partial = (n: number, total = 9, reason = "not reached: the pull request's budget was spent") => ({
  files: {
    total,
    reviewed: total - n,
    notReviewed: [{ reason, paths: Array.from({ length: n }, (_, i) => `src/f${i}.ts`) }],
    notReviewedTwice: [],
    notReviewable: [],
  },
});
