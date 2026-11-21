/**
 * Synthetic reviews for the goldens of the review body: invented pull requests, invented findings,
 * no model. Each scenario is the data `buildReview` has (a `ViewInput`), so the golden shows what a
 * reader would see for that shape of review. The real reviews are in `real.ts`.
 */
import { receiptFooter } from "../../ledger";
import type { ViewInput } from "../view";

const HEAD = "d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SINCE = "9a8b7c6bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const AUTO = "<!-- wachi:auto -->";
const REVIEW = "<!-- wachi:review -->";

type Found = ViewInput["output"]["findings"][number];

const found = (over: Partial<Found> & Pick<Found, "path" | "line" | "title">): Found => ({
  severity: "fix",
  topic: "bug",
  confidence: "high",
  body: `${over.title}: the model's explanation, one short paragraph.`,
  anchor: "diff",
  ...over,
});

const file = (filename: string, additions = 4, deletions = 1) => ({ filename, additions, deletions });
const SRC = ["src/store.ts", "src/session.ts", "src/api/routes.ts", "docs/guide.md"];

const base = (over: Partial<ViewInput> = {}): ViewInput => ({
  output: { files_reviewed: SRC, files_skipped: [], findings: [], contracts: [], thread_replies: [], summary: "The change is small and consistent." },
  files: SRC.map((f) => file(f)),
  repo: "acme/shop",
  mention: "/wachiman",
  arm: "priority",
  headSha: HEAD,
  since: null,
  scoped: false,
  batches: [{ label: "Batch 1 of 1", files: 4, lines: 20, maxRisk: 3, status: "reviewed", turns: 5, costUsd: 0.12 }],
  earlierThreads: 0,
  footer: {
    receipt: receiptFooter({ account: "acct-1", repository: "acme/shop", run_id: "run-1", usd: 0.12, day: "2026-11-14" }, "c2lnbmF0dXJl"),
    costLine: "<sub>Claude Sonnet 5.5 via Claude Code 2.1.304 · effort high · review · 5 in / 1.2k out · $0.12</sub>",
    markers: [AUTO, REVIEW, `<!-- wachiman sha=${HEAD} -->`],
  },
  ...over,
});

const withFindings = (findings: Found[], over: Partial<ViewInput> = {}) =>
  base({ ...over, output: { ...base().output, ...over.output, findings } });

export const scenarios: Record<string, ViewInput> = {
  // A first review with a fix and two things to consider, all on their lines.
  "first-review": withFindings(
    [
      found({ path: "src/store.ts", line: 12, title: "The store drops the last session when the list is empty" }),
      found({ path: "src/session.ts", line: 40, severity: "consider", topic: "tests", confidence: "medium", title: "No test covers the export path" }),
      found({ path: "src/api/routes.ts", line: 7, severity: "consider", topic: "cleanup", confidence: "low", title: "The handler repeats the validation of the router" }),
    ],
    { riskMap: { level: "medium", floor: false, facts: [{ kind: "data", path: "src/store.ts", line: 12, why: "Sessions are written here." }], judgement: [], pathReasons: [{ path: "src/store.ts", why: "writes to storage" }], readFirst: ["src/store.ts"], unreadFiles: 0, droppedFacts: 0 } },
  ),

  // A re-review of one push, with two earlier threads still open.
  "re-review-open-threads": withFindings(
    [found({ path: "src/store.ts", line: 15, severity: "consider", topic: "bug", confidence: "medium", title: "The retry never backs off" })],
    {
      since: SINCE,
      commits: ["1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
      earlierThreads: 2,
      files: SRC.slice(0, 2).map((f) => file(f)),
      batches: [{ label: "Batch 1 of 1", files: 2, lines: 10, maxRisk: 3, status: "reviewed", turns: 4, costUsd: 0.18 }],
      output: { ...base().output, files_reviewed: SRC.slice(0, 2), findings: [found({ path: "src/store.ts", line: 15, severity: "consider", topic: "bug", confidence: "medium", title: "The retry never backs off" })] },
      footer: {
        costLine: "<sub>Claude Sonnet 5.5 via Claude Code 2.1.304 · effort high · re-review · 2 commits · PR so far $0.30 over 2 automatic runs · $0.18</sub>",
        markers: [AUTO, REVIEW, `<!-- wachiman sha=${HEAD} -->`],
      },
    },
  ),

  // Nothing found, whole pull request.
  clean: base(),

  // Many findings: the Consider table is long enough to collapse.
  "many-findings": withFindings(
    [
      found({ path: "src/store.ts", line: 3, severity: "blocker", topic: "security", title: "The token is written to the log" }),
      found({ path: "src/store.ts", line: 21, title: "The cache is never invalidated" }),
      found({ path: "src/session.ts", line: 9, title: "The timeout is read in seconds but used as milliseconds" }),
      ...Array.from({ length: 10 }, (_, i) =>
        found({ path: "src/api/routes.ts", line: 10 + i, severity: "consider", topic: i % 2 === 0 ? "cleanup" : "tests", confidence: "medium", title: `Small issue number ${i + 1} in the router` }),
      ),
      found({ path: "docs/guide.md", line: 0, severity: "info", topic: "question", confidence: "low", anchor: "outside", title: "The guide still names the old command" }),
      found({ path: "src/session.ts", line: 70, origin: "pre-existing", title: "The session manager never closes the store", anchor: "outside" }),
    ],
    {},
  ),

  // Partial: two reasons, three files not reviewed.
  partial: base({
    batches: [
      { label: "Batch 1 of 3", files: 1, lines: 5, maxRisk: 3, status: "reviewed", turns: 5, costUsd: 0.12 },
      { label: "Batch 2 of 3", files: 2, lines: 10, maxRisk: 4, status: "not run: budget spent", turns: 0, costUsd: 0 },
      { label: "Batch 3 of 3", files: 1, lines: 5, maxRisk: 2, status: "not run: the provider rejected the call", turns: 1, costUsd: 0.01 },
    ],
    output: {
      ...base().output,
      files_reviewed: SRC.slice(0, 1),
      files_skipped: [
        { path: "src/session.ts", reason: "not reached: the pull request's budget was spent" },
        { path: "src/api/routes.ts", reason: "not reached: the pull request's budget was spent" },
        { path: "docs/guide.md", reason: "the provider rejected the call" },
      ],
      findings: [found({ path: "src/store.ts", line: 12, title: "The store drops the last session" })],
    },
    footer: {
      costLine: "<sub>Claude Sonnet 5.5 via Claude Code 2.1.304 · effort high · review · $0.40</sub>",
      markers: [AUTO, REVIEW, `<!-- wachi:partial sha=${HEAD} state=eyJyIjpbInNyYy9zZXNzaW9uLnRzIl0sInQiOltdfQ -->`],
    },
  }),

  // The second reader stopped on the budget; two findings were not checked.
  "verifier-failed": withFindings(
    [
      found({ path: "src/store.ts", line: 12, title: "The store drops the last session" }),
      found({ path: "src/session.ts", line: 40, title: "The lock is released before the write completes" }),
    ],
    { verification: { status: "failed", model: "claude-opus-5-5", effort: "high", costUsd: 0.2, stop: { kind: "budget", detail: "the call ran out of its budget" }, entries: [], dropped: 0, inconclusive: 0 } },
  ),

  // A Blocker the verifier could not settle: it is a thing to investigate, never "before merge".
  "inconclusive-blocker": withFindings(
    [
      {
        ...found({ path: "src/store.ts", line: 12, severity: "blocker", topic: "security", title: "The query may be built from user input" }),
        verification: { status: "inconclusive", reason: "The caller may sanitise the value before it reaches this line.", checked: [] },
      },
    ],
    {},
  ),

  // A pre-existing fix: shown, but it does not say "to fix in this PR".
  "pre-existing": withFindings(
    [found({ path: "src/session.ts", line: 70, origin: "pre-existing", anchor: "outside", title: "The session manager never closes the store" })],
    {},
  ),

  // A Blocker on a line the diff does not touch: no thread, so its text goes to the details block.
  "blocker-outside-diff": withFindings(
    [found({ path: "src/store.ts", line: 200, severity: "blocker", topic: "security", anchor: "outside", title: "The admin route has no authorisation check" })],
    {},
  ),

  // A title with a pipe and a newline must not break the table.
  "title-pipe-newline": withFindings(
    [found({ path: "src/store.ts", line: 12, title: "Handles `a | b` wrongly\nwhen the input is empty" })],
    {},
  ),

  // S7: two files with one name are told apart, and a lone one is not given a prefix.
  "same-name-files": withFindings(
    [
      found({ path: "src/init/run.ts", line: 5, title: "The init run ignores the flag" }),
      found({ path: "src/setup/run.ts", line: 8, severity: "consider", topic: "cleanup", title: "The setup run duplicates the init run" }),
      found({ path: "src/store.ts", line: 2, severity: "consider", topic: "tests", title: "A lone file keeps its bare name" }),
    ],
    { files: ["src/init/run.ts", "src/setup/run.ts", "src/store.ts", "docs/guide.md"].map((f) => file(f)), output: { ...base().output, files_reviewed: ["src/init/run.ts", "src/setup/run.ts", "src/store.ts", "docs/guide.md"] } },
  ),
};
