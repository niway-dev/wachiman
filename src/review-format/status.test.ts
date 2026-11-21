import { describe, expect, test } from "bun:test";
import { BRAND as ENGINE_BRAND } from "../engine";
import { contract, makeView, partial, person, row, SHA, SINCE } from "./fixtures/views";
import { BRAND, computeStatus, notReviewedStatus, renderStatusLine, type Status } from "./status";
import type { ReviewView } from "./view";

const blocker = (over = {}) => row({ severity: "blocker", priority: "must", ...over });
const fix = (over = {}) => row({ severity: "fix", priority: "should", ...over });
const consider = (over = {}) => row({ severity: "consider", priority: "could", ...over });
const info = (over = {}) => row({ severity: "info", priority: "fyi", inlineThread: false, ...over });

/** The one colour emoji of every lead the review body can produce. */
const LEAD_EMOJI = ["⚠️", "🔴", "🟠", "🔍", "🟣", "⏳", "🟡", "⚪"];

describe("computeStatus: the first mode that applies is the lead", () => {
  test("mode 2, partial, beats a blocker, a fix and everything below", () => {
    const view = makeView({
      ...partial(2),
      findings: { toFix: [blocker(), fix()], consider: [consider()] },
      needsPerson: [person()],
      earlierThreads: 3,
    });
    const status = computeStatus(view);
    expect(status.mode).toBe(2);
    expect(status.emoji).toBe("⚠️");
    expect(status.lead).toBe("Partial: 2 of 9 files not reviewed");
  });

  test("a partial review with a blocker and fixes names them after the lead, in the spec's order", () => {
    const status = computeStatus(makeView({ ...partial(2), findings: { toFix: [blocker(), fix(), fix()], consider: [consider()] } }));
    expect(status.parts).toEqual(["1 blocker before merge", "2 to fix in this PR", "1 to consider"]);
  });

  test("mode 3, blocker: counts blockers, and says before merge only here", () => {
    const one = computeStatus(makeView({ findings: { toFix: [blocker()] } }));
    expect(one.mode).toBe(3);
    expect(one.emoji).toBe("🔴");
    expect(one.lead).toBe("1 blocker before merge");
    expect(computeStatus(makeView({ findings: { toFix: [blocker(), blocker()] } })).lead).toBe("2 blockers before merge");
  });

  test("mode 3 with fixes: the fixes follow as a part, not a second lead", () => {
    const status = computeStatus(makeView({ findings: { toFix: [blocker(), fix(), fix()] } }));
    expect(status.lead).toBe("1 blocker before merge");
    expect(status.parts).toEqual(["2 to fix in this PR"]);
  });

  test("mode 4, fix: Fix is to fix in this PR, never before merge", () => {
    const status = computeStatus(makeView({ findings: { toFix: [fix(), fix()] } }));
    expect(status.mode).toBe(4);
    expect(status.emoji).toBe("🟠");
    expect(status.lead).toBe("2 to fix in this PR");
    expect(renderStatusLine(status)).not.toContain("before merge");
  });

  test("mode 5, needs investigation: an inconclusive Blocker or Fix", () => {
    const status = computeStatus(makeView({ findings: { investigate: [blocker({ origin: "unknown" })] } }));
    expect(status.mode).toBe(5);
    expect(status.emoji).toBe("🔍");
    expect(status.lead).toBe("Needs investigation: 1");
  });

  test("a Fix lead still names an inconclusive Blocker beside it", () => {
    const status = computeStatus(makeView({ findings: { toFix: [fix()], investigate: [blocker()] } }));
    expect(status.lead).toBe("1 to fix in this PR");
    expect(status.parts).toEqual(["1 to investigate"]);
  });

  test("mode 6, questions: needs-a-person items plus open 'connects to' questions", () => {
    const status = computeStatus(makeView({ needsPerson: [person(), person()], contracts: { open: [contract("open")], closed: [contract("closed")] } }));
    expect(status.mode).toBe(6);
    expect(status.emoji).toBe("🟣");
    expect(status.lead).toBe("3 questions for you");
  });

  test("mode 6 with a single open question reads '1 question for you' (wachiman #281)", () => {
    const status = computeStatus(makeView({ contracts: { open: [contract("open")], closed: [] } }));
    expect(status.lead).toBe("1 question for you");
  });

  test("a closed 'connects to' entry is not a question", () => {
    expect(computeStatus(makeView({ contracts: { open: [], closed: [contract("closed")] } })).mode).toBe(9);
  });

  test("fix beats questions; the questions become a part", () => {
    const status = computeStatus(makeView({ findings: { toFix: [fix()] }, needsPerson: [person()] }));
    expect(status.mode).toBe(4);
    expect(status.parts).toEqual(["1 question for you"]);
  });

  test("mode 7, earlier threads open: never a clean lead", () => {
    const status = computeStatus(makeView({ earlierThreads: 2 }));
    expect(status.mode).toBe(7);
    expect(status.emoji).toBe("⏳");
    expect(status.lead).toBe("No new findings to fix");
    expect(status.parts).toEqual(["2 earlier threads open"]);
  });

  test("mode 7, thread count unknown: 'earlier threads not counted', never clean", () => {
    const status = computeStatus(makeView({ earlierThreads: "unknown" }));
    expect(status.mode).toBe(7);
    expect(status.parts).toEqual(["earlier threads not counted"]);
  });

  test("mode 7, a pre-existing Fix or Blocker: named, and not a clean lead", () => {
    const status = computeStatus(makeView({ findings: { preExisting: [fix({ origin: "pre-existing" })] } }));
    expect(status.mode).toBe(7);
    expect(status.parts).toEqual(["1 pre-existing issue to fix, not from this PR"]);
    const blockers = computeStatus(makeView({ findings: { preExisting: [blocker({ origin: "pre-existing" }), fix({ origin: "pre-existing" })] } }));
    expect(blockers.parts).toEqual(["2 pre-existing issues to fix, not from this PR"]);
  });

  test("a pre-existing Consider is not a reason to hold the clean lead", () => {
    expect(computeStatus(makeView({ findings: { preExisting: [consider({ origin: "pre-existing" })] } })).mode).toBe(9);
  });

  test("mode 7 beats Consider; the Consider count follows as the last part", () => {
    const status = computeStatus(makeView({ earlierThreads: 1, findings: { consider: [consider(), consider()] } }));
    expect(status.mode).toBe(7);
    expect(status.parts).toEqual(["1 earlier thread open", "2 to consider"]);
  });

  test("mode 8, only Consider: the count is in the lead and is not repeated", () => {
    const status = computeStatus(makeView({ findings: { consider: [consider(), consider(), consider()] } }));
    expect(status.mode).toBe(8);
    expect(status.emoji).toBe("🟡");
    expect(status.lead).toBe("Nothing to fix · 3 to consider");
    expect(status.parts).toEqual([]);
  });

  test("mode 9, clean: says what Wachiman did, not what the pull request is", () => {
    const status = computeStatus(makeView());
    expect(status.mode).toBe(9);
    expect(status.emoji).toBe("⚪");
    expect(status.lead).toBe("Wachiman found nothing to fix");
    expect(status.parts).toEqual([]);
  });

  test("mode 9, Info only: the spec has no part for Info, so the line stays bare", () => {
    const status = computeStatus(makeView({ findings: { info: [info(), info()] } }));
    expect(status.mode).toBe(9);
    expect(status.parts).toEqual([]);
  });

  test("mode 9 with a failed verifier is never a bare clean lead", () => {
    const status = computeStatus(makeView({ verifier: { status: "failed", notChecked: 4 } }));
    expect(status.mode).toBe(9);
    expect(status.parts).toEqual(["verifier did not finish: 4 findings not checked"]);
    expect(renderStatusLine(status)).toContain("verifier did not finish");
  });

  test("a partial verifier is named too, with its count when it has one", () => {
    expect(computeStatus(makeView({ verifier: { status: "partial", stop: "budget", notChecked: 1 } })).parts).toEqual(["verifier did not finish: 1 finding not checked"]);
    expect(computeStatus(makeView({ verifier: { status: "partial", notChecked: 0 } })).parts).toEqual(["verifier did not finish"]);
  });

  test("a verifier that verified, found nothing to check, was skipped or was off adds no part", () => {
    for (const status of ["verified", "nothing", "skipped", "none"] as const) {
      expect(computeStatus(makeView({ verifier: { status, notChecked: 0 } })).parts).toEqual([]);
    }
  });

  test("all the parts together, in the spec's order", () => {
    const view = makeView({
      ...partial(2),
      findings: { toFix: [blocker(), fix()], investigate: [fix()], preExisting: [fix({ origin: "pre-existing" })], consider: [consider()] },
      needsPerson: [person()],
      earlierThreads: 4,
      verifier: { status: "failed", notChecked: 3 },
    });
    expect(computeStatus(view).parts).toEqual([
      "1 blocker before merge",
      "1 to fix in this PR",
      "1 to investigate",
      "verifier did not finish: 3 findings not checked",
      "1 pre-existing issue to fix, not from this PR",
      "1 question for you",
      "4 earlier threads open",
      "1 to consider",
    ]);
  });

  test("the review body never produces mode 1", () => {
    const views: ReviewView[] = [
      makeView(),
      makeView(partial(9, 9)),
      makeView({ findings: { toFix: [blocker()] } }),
      makeView({ earlierThreads: "unknown" }),
    ];
    for (const v of views) expect(computeStatus(v).mode).not.toBe(1);
  });
});

describe("scope", () => {
  test("whole pull request, at the short head", () => {
    expect(computeStatus(makeView()).scope).toBe("whole PR at `d6f4431`");
  });

  test("changes since a commit", () => {
    const view = makeView({ scope: { kind: "since", since: SINCE, head: SHA, carried: 0 } });
    expect(computeStatus(view).scope).toBe("changes since `9a8b7c6` at `d6f4431`");
  });

  test("changes since a commit, after a rebase", () => {
    const view = makeView({ scope: { kind: "rebase", since: SINCE, head: SHA, carried: 0 } });
    expect(computeStatus(view).scope).toBe("changes since `9a8b7c6` (after a rebase) at `d6f4431`");
  });
});

describe("renderStatusLine", () => {
  test("is the brand, the bold lead with its emoji, the plain parts, then the scope", () => {
    const line = renderStatusLine(computeStatus(makeView({ findings: { toFix: [fix()] }, needsPerson: [person()] })));
    expect(line).toBe("👮 **Wachiman** · 🟠 **1 to fix in this PR** · 1 question for you · whole PR at `d6f4431`");
  });

  test("the clean line opens as the acceptance criteria say", () => {
    expect(renderStatusLine(computeStatus(makeView()))).toStartWith("👮 **Wachiman** · ⚪ **Wachiman found nothing to fix** · whole PR at");
  });

  test("the brand is the engine's own", () => {
    expect(BRAND).toBe(ENGINE_BRAND);
  });

  test("never says good to merge, LGTM or shows a check mark, in any mode", () => {
    for (const status of everyMode()) {
      const line = renderStatusLine(status);
      expect(line.toLowerCase()).not.toContain("good to merge");
      expect(line).not.toContain("LGTM");
      expect(line).not.toContain("✅");
    }
  });

  test("exactly one colour emoji besides the brand, in every mode and with every part", () => {
    for (const status of everyMode()) {
      const rest = renderStatusLine(status).replace(BRAND, "");
      const emoji = rest.match(/\p{Extended_Pictographic}/gu) ?? [];
      expect(emoji).toHaveLength(1);
      expect(rest).toContain(`${status.emoji} **${status.lead}**`);
    }
    expect(LEAD_EMOJI).toContain(computeStatus(makeView()).emoji);
  });

  test("a lead with a long list of parts stays one line", () => {
    const line = renderStatusLine(computeStatus(makeView({ ...partial(2), findings: { toFix: [blocker(), fix()], consider: [consider()] }, earlierThreads: 2 })));
    expect(line).not.toContain("\n");
    expect(line.length).toBeLessThan(300);
  });
});

describe("mode 1, not reviewed, belongs to the notice path", () => {
  test("can be built and rendered by a notice, with its own lead and emoji", () => {
    const status = notReviewedStatus("the provider has no credit", "whole PR at `d6f4431`");
    expect(status.mode).toBe(1);
    expect(status.emoji).toBe("⛔");
    expect(renderStatusLine(status)).toBe("👮 **Wachiman** · ⛔ **Not reviewed: the provider has no credit** · whole PR at `d6f4431`");
  });
});

/** One status of every mode the body or a notice can show, each with every part it can carry. */
function everyMode(): Status[] {
  const full = {
    findings: { toFix: [fix()], investigate: [fix()], preExisting: [fix({ origin: "pre-existing" })], consider: [consider()] },
    needsPerson: [person()],
    earlierThreads: 2,
    verifier: { status: "failed" as const, notChecked: 2 },
  };
  return [
    computeStatus(makeView({ ...partial(2), ...full })),
    computeStatus(makeView({ ...full, findings: { ...full.findings, toFix: [blocker(), fix()] } })),
    computeStatus(makeView(full)),
    computeStatus(makeView({ ...full, findings: { ...full.findings, toFix: [] } })),
    computeStatus(makeView({ ...full, findings: { consider: [consider()] } })),
    computeStatus(makeView({ earlierThreads: "unknown", findings: { consider: [consider()] } })),
    computeStatus(makeView({ findings: { consider: [consider()] } })),
    computeStatus(makeView({ verifier: { status: "failed", notChecked: 1 } })),
    notReviewedStatus("the key was rejected", "whole PR at `d6f4431`"),
  ];
}
