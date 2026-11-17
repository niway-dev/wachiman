import { describe, expect, test } from "bun:test";
import { buildReport, credentialOf, deriveCoverage, group, mergeRanges, weekStart, type SpendRow } from "./report";

const NOW = new Date("2026-11-12T12:00:00Z");

/** Illustrative rows; the figures are invented for these tests. */
function row(over: Partial<SpendRow> & Pick<SpendRow, "day">): SpendRow {
  return {
    source: "actions",
    state: "settled",
    week: weekStart(over.day),
    repositoryKey: "o/alpha",
    repository: "o/alpha",
    pr: 7,
    runId: `r-${over.day}-${Math.random()}`,
    profile: "",
    costUsd: 1,
    reservedUsd: 0,
    calls: [{ model: "claude-opus-5-5", auth: "api-key", costUsd: 1, costKnown: true }],
    ...over,
  };
}

describe("weeks", () => {
  test("a week that spans two months is one week, starting on Monday UTC", () => {
    expect(weekStart("2026-10-29")).toBe("2026-10-26");
    expect(weekStart("2026-11-01")).toBe("2026-10-26");
    expect(weekStart("2026-11-02")).toBe("2026-11-02");
    const rows = [row({ day: "2026-10-29" }), row({ day: "2026-11-01" })];
    const report = buildReport({ rows, coverage: { actions: [{ from: "2026-10-26", to: "2026-11-12" }], laptop: [] }, now: NOW });
    const week = report.weeks.find((w) => w.key === "2026-10-26")!;
    expect(week.spend.total).toEqual({ runs: 2, calls: 2, usd: 2 });
    expect(report.weeks.filter((w) => w.spend.total.runs > 0)).toHaveLength(1);
  });
});

describe("no data versus zero", () => {
  test("a day outside the downloaded range is unknown, a covered day without runs is zero", () => {
    const report = buildReport({
      rows: [row({ day: "2026-11-06" })],
      coverage: { actions: [{ from: "2026-11-05", to: "2026-11-10" }], laptop: [] },
      now: NOW,
    });
    const day = (k: string) => report.days.find((d) => d.key === k)!;
    expect(day("2026-11-07").known.actions).toBe(true);
    expect(day("2026-11-07").spend.total.usd).toBe(0);
    expect(day("2026-11-11").known.actions).toBe(false);
    expect(day("2026-11-11").countedAgainstLimitUsd).toBeNull();
    expect(day("2026-11-07").countedAgainstLimitUsd).toBe(0);
  });
  test("with nothing pulled and no laptop run there is no period at all", () => {
    const report = buildReport({ rows: [], coverage: deriveCoverage([], [], NOW), now: NOW });
    expect(report.days).toEqual([]);
    expect(report.coverage).toEqual({ laptop: null, actions: null });
  });
  test("the laptop is known from its first run to today", () => {
    const rows = [row({ source: "laptop", day: "2026-11-03", repository: "alpha", repositoryKey: "alpha-1" })];
    expect(deriveCoverage(rows, [], NOW).laptop).toEqual([{ from: "2026-11-03", to: "2026-11-12" }]);
  });
});

describe("the four entry states", () => {
  test("only settled runs are spend; the others are reported apart", () => {
    const rows = [
      row({ day: "2026-11-10", costUsd: 0.6, calls: [{ model: "m", auth: "oauth-token", costUsd: 0.6, costKnown: true }] }),
      row({ day: "2026-11-10", state: "reserved", costUsd: 0, reservedUsd: 1, calls: [] }),
      row({ day: "2026-11-10", state: "unsettled", costUsd: 0, reservedUsd: 2, calls: [] }),
      row({ day: "2026-11-10", state: "unreserved", costUsd: 0.25, calls: [{ model: "m", auth: "api-key", costUsd: 0.25, costKnown: true }] }),
    ];
    const report = buildReport({ rows, coverage: { actions: [{ from: "2026-11-01", to: "2026-11-12" }], laptop: [] }, now: NOW });
    expect(report.totals.total).toEqual({ runs: 1, calls: 1, usd: 0.6 });
    expect(report.aside.reserved).toEqual({ runs: 1, usd: 0, reservedUsd: 1 });
    expect(report.aside.unsettled).toEqual({ runs: 1, usd: 0, reservedUsd: 2 });
    expect(report.aside.unreserved).toEqual({ runs: 1, usd: 0.25, reservedUsd: 0 });
    // What the limit counts: the settled spend, the late record and both holds.
    expect(report.days.find((d) => d.key === "2026-11-10")!.countedAgainstLimitUsd).toBe(3.85);
    expect(group(rows, "repo")[0].split.total.runs).toBe(1);
  });
});

describe("splits", () => {
  test("billed and estimated stay apart, and so do the sources", () => {
    const rows = [
      row({ day: "2026-11-10", costUsd: 0.5, calls: [{ model: "a", auth: "api-key", costUsd: 0.5, costKnown: true }] }),
      row({ day: "2026-11-10", source: "laptop", repository: "alpha", repositoryKey: "alpha-1", pr: null, costUsd: 0.25, calls: [{ model: "a", auth: "subscription", costUsd: 0.25, costKnown: true }] }),
    ];
    const report = buildReport({ rows, coverage: deriveCoverage(rows, [{ from: "2026-11-01", to: "2026-11-12" }], NOW), now: NOW });
    expect(report.totals.byCredential.billed.usd).toBe(0.5);
    expect(report.totals.byCredential.estimated.usd).toBe(0.25);
    expect(report.totals.bySource.actions.usd).toBe(0.5);
    expect(report.totals.bySource.laptop.usd).toBe(0.25);
    expect(credentialOf("oauth-token")).toBe("estimated");
    expect(credentialOf("weird")).toBe("unknown");
  });
  test("dollars no call accounts for are not hidden", () => {
    const rows = [row({ day: "2026-11-10", costUsd: 1, calls: [{ model: "a", auth: "api-key", costUsd: 0.4, costKnown: true }] })];
    const report = buildReport({ rows, coverage: { actions: [{ from: "2026-11-01", to: "2026-11-12" }], laptop: [] }, now: NOW });
    expect(report.totals.byCredential.unknown.usd).toBeCloseTo(0.6, 6);
    expect(report.groups.model.map((g) => g.key).sort()).toEqual(["(not itemised)", "a"]);
  });
  test("pull requests and local branches are grouped apart", () => {
    const rows = [row({ day: "2026-11-10", pr: 7 }), row({ day: "2026-11-10", pr: null }), row({ day: "2026-11-10", source: "laptop", pr: null, repository: "alpha", repositoryKey: "alpha-1" })];
    expect(group(rows, "pr").map((g) => g.label).sort()).toEqual(["alpha (local branch)", "o/alpha #7", "o/alpha (no pull request)"]);
  });
});

describe("how many periods are kept", () => {
  test("a run from the start of the year still leaves the newest 120 days, ending today", () => {
    const rows = [row({ day: "2026-01-01" }), row({ day: "2026-11-12" })];
    const report = buildReport({ rows, coverage: { actions: [{ from: "2026-01-01", to: "2026-11-12" }], laptop: [] }, now: NOW });
    expect(report.days).toHaveLength(120);
    expect(report.days.at(-1)!.key).toBe("2026-11-12");
    expect(report.days[0].key).toBe("2026-07-16");
  });
  test("ranges that touch or overlap merge; others stay apart", () => {
    expect(mergeRanges([{ from: "2026-11-01", to: "2026-11-05" }, { from: "2026-11-06", to: "2026-11-08" }, { from: "2026-11-03", to: "2026-11-04" }, { from: "2026-11-20", to: "2026-11-22" }])).toEqual([
      { from: "2026-11-01", to: "2026-11-08" },
      { from: "2026-11-20", to: "2026-11-22" },
    ]);
  });
});
