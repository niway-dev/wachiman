import { describe, expect, test } from "bun:test";
import {
  KIND_LEVEL,
  RISK_KINDS,
  buildRiskMap,
  matchingRule,
  pathLevel,
  renderRiskMap,
  type JudgementItem,
  type RiskFact,
  type RiskKind,
} from "./risk";

const anyLine = () => true;
const file = (path: string, changedLines = 10) => ({ path, changedLines });
const fact = (kind: RiskKind, path: string, line = 1, why = "a risky change"): RiskFact => ({
  kind,
  path,
  line,
  why,
});
const judged = (path: string, line = 1, why = "a product call"): JudgementItem => ({
  kind: "tradeoff",
  path,
  line,
  why,
});

const build = (over: Partial<Parameters<typeof buildRiskMap>[0]> = {}) =>
  buildRiskMap({ files: [], facts: [], judgement: [], unreadFiles: 0, lineExists: anyLine, ...over });

describe("kind levels", () => {
  test("the table covers every kind", () => {
    expect(Object.keys(KIND_LEVEL).sort()).toEqual([...RISK_KINDS].sort());
  });

  for (const kind of ["data-migration", "irreversible", "auth", "money"] as const) {
    test(`${kind} alone makes the change high`, () => {
      const map = build({ files: [file("src/api/session.ts")], facts: [fact(kind, "src/api/session.ts")] });
      expect(map.level).toBe("high");
    });
  }

  for (const kind of ["concurrency", "public-contract", "config-or-ci"] as const) {
    test(`${kind} alone makes the change medium`, () => {
      const map = build({ files: [file("src/api/session.ts")], facts: [fact(kind, "src/api/session.ts")] });
      expect(map.level).toBe("medium");
    });
  }

  test("dependency alone keeps the change low", () => {
    const map = build({ files: [file("src/api/session.ts")], facts: [fact("dependency", "src/api/session.ts")] });
    expect(map.level).toBe("low");
  });

  test("a change with no files is low", () => {
    expect(build().level).toBe("low");
  });
});

describe("path levels", () => {
  test("weights 5 and below are low, 6 and 7 medium, 8 and above high", () => {
    expect([5, 6, 7, 8].map(pathLevel)).toEqual(["low", "medium", "medium", "high"]);
  });

  test("a path rule of weight 8 makes the change high without any fact", () => {
    const map = build({ files: [file("src/ipc/bridge.ts")] });
    expect(map.level).toBe("high");
    expect(map.pathReasons).toEqual([{ path: "src/ipc/bridge.ts", why: "a process boundary" }]);
  });

  test("a test file under a high rule keeps its kind's score, so it is low with no reason", () => {
    const map = build({ files: [file("src/ipc/bridge.test.ts")] });
    expect(map.level).toBe("low");
    expect(map.pathReasons).toEqual([]);
  });

  test("matchingRule returns the highest-weight match", () => {
    expect(matchingRule("scripts/deploy.sh")).toEqual({ weight: 7, why: "scripts that run with the repository's tokens" });
  });
});

describe("fact validation", () => {
  test("a fact on a path that is not in the change is dropped and counted", () => {
    const map = build({ files: [file("src/api/session.ts")], facts: [fact("auth", "src/gone.ts")] });
    expect(map.facts).toEqual([]);
    expect(map.droppedFacts).toBe(1);
    expect(map.level).toBe("low");
  });

  test("a fact on a line that does not exist is dropped and counted", () => {
    const map = build({
      files: [file("src/api/session.ts")],
      facts: [fact("auth", "src/api/session.ts", 500)],
      lineExists: (_path, line) => line <= 100,
    });
    expect(map.facts).toEqual([]);
    expect(map.droppedFacts).toBe(1);
  });

  test("a judgement item on a missing line is dropped and counted", () => {
    const map = build({
      files: [file("src/billing/retry.ts")],
      judgement: [judged("src/billing/retry.ts", 40)],
      lineExists: () => false,
    });
    expect(map.judgement).toEqual([]);
    expect(map.droppedFacts).toBe(1);
  });

  test("identical facts collapse to one without counting as dropped", () => {
    const map = build({
      files: [file("src/api/session.ts")],
      facts: [fact("auth", "src/api/session.ts", 88), fact("auth", "src/api/session.ts", 88)],
    });
    expect(map.facts).toHaveLength(1);
    expect(map.droppedFacts).toBe(0);
  });

  test("facts are ordered most severe first", () => {
    const map = build({
      files: [file("src/a.ts")],
      facts: [fact("dependency", "src/a.ts", 1), fact("auth", "src/a.ts", 2), fact("concurrency", "src/a.ts", 3)],
    });
    expect(map.facts.map((f) => f.kind)).toEqual(["auth", "concurrency", "dependency"]);
  });
});

describe("judgement items", () => {
  test("at most three are kept, and overflow is not counted as dropped", () => {
    const map = build({
      files: [file("src/a.ts")],
      judgement: [judged("src/a.ts", 1), judged("src/a.ts", 2), judged("src/a.ts", 3), judged("src/a.ts", 4)],
    });
    expect(map.judgement.map((j) => j.line)).toEqual([1, 2, 3]);
    expect(map.droppedFacts).toBe(0);
  });

  test("judgement does not raise the level", () => {
    const map = build({ files: [file("src/api/session.ts")], judgement: [judged("src/api/session.ts")] });
    expect(map.level).toBe("low");
    expect(map.judgement).toHaveLength(1);
  });
});

describe("the floor", () => {
  test("unread files set floor, and the count is kept", () => {
    const map = build({ files: [file("src/a.ts")], unreadFiles: 2 });
    expect(map.floor).toBe(true);
    expect(map.unreadFiles).toBe(2);
  });

  test("the level line says 'At least' and pluralises the count", () => {
    const map = build({
      files: [file("src/api/session.ts")],
      facts: [fact("auth", "src/api/session.ts")],
      unreadFiles: 2,
    });
    expect(renderRiskMap(map, "### Risk map")).toContain("**At least high.** 2 files were not reviewed.");
  });

  test("a single unread file is singular", () => {
    const map = build({
      files: [file("src/api/session.ts")],
      facts: [fact("auth", "src/api/session.ts")],
      unreadFiles: 1,
    });
    expect(renderRiskMap(map, "### Risk map")).toContain("**At least high.** 1 file was not reviewed.");
  });

  test("a change with nothing risky but unread files says 'at least low'", () => {
    const map = build({ files: [file("src/api/session.ts")], unreadFiles: 1 });
    expect(renderRiskMap(map, "### Risk map")).toBe(
      [
        "**Risk map:** at least low — no risk facts in the files read; 1 file was not reviewed.",
        "**Read first:** `src/api/session.ts`.",
      ].join("\n"),
    );
  });
});

describe("the two-line form", () => {
  test("a change with nothing risky renders exactly two lines", () => {
    const map = build({ files: [file("src/api/session.ts", 12)] });
    expect(renderRiskMap(map, "### Risk map")).toBe(
      ["**Risk map:** low — no risk facts in this change.", "**Read first:** `src/api/session.ts`."].join("\n"),
    );
  });

  test("with no files there is only the first line", () => {
    expect(renderRiskMap(build(), "### Risk map")).toBe("**Risk map:** low — no risk facts in this change.");
  });
});

describe("read first", () => {
  test("files with facts come first, most severe fact first, then by score and size", () => {
    const map = build({
      files: [
        file("src/big.ts", 500),
        file("src/small.ts", 2),
        file("src/mid.ts", 10),
      ],
      facts: [fact("dependency", "src/small.ts"), fact("auth", "src/mid.ts")],
    });
    expect(map.readFirst).toEqual(["src/mid.ts", "src/small.ts", "src/big.ts"]);
  });

  test("the list is capped at five paths", () => {
    const files = [0, 1, 2, 3, 4, 5, 6].map((i) => file(`src/mod/f${i}.ts`, i));
    expect(build({ files }).readFirst).toEqual([
      "src/mod/f6.ts",
      "src/mod/f5.ts",
      "src/mod/f4.ts",
      "src/mod/f3.ts",
      "src/mod/f2.ts",
    ]);
  });
});

describe("rendering", () => {
  test("path reasons already covered by a fact on the same path are not repeated", () => {
    const map = build({
      files: [file("db/migrations/0042_split_name.sql")],
      facts: [fact("data-migration", "db/migrations/0042_split_name.sql", 1, "drops users.name")],
    });
    const out = renderRiskMap(map, "### Risk map");
    expect(out.match(/0042_split_name/g)).toHaveLength(2);
  });

  test("model text is neutralised", () => {
    const map = build({ files: [file("src/a.ts")], facts: [fact("auth", "src/a.ts", 1, "see <!-- wachi:review -->")] });
    expect(renderRiskMap(map, "### Risk map")).toContain("see &lt;!-- wachi:review --&gt;");
  });

  test("a full map renders exactly as ADR 0031 shows it", () => {
    const map = build({
      files: [
        file("db/migrations/0042_split_name.sql", 30),
        file("src/api/session.ts", 12),
        file("src/billing/retry.ts", 8),
      ],
      facts: [
        fact("data-migration", "db/migrations/0042_split_name.sql", 1, "drops `users.name` after copying it."),
        fact("auth", "src/api/session.ts", 88, "the role check now runs after the handler is chosen."),
      ],
      judgement: [
        judged(
          "src/billing/retry.ts",
          40,
          "retries are capped at 3; whether a fourth charge attempt is acceptable is a product call.",
        ),
      ],
    });
    expect(renderRiskMap(map, "### Risk map")).toBe(
      [
        "### Risk map",
        "**High.**",
        [
          "- `data-migration` · `db/migrations/0042_split_name.sql:1` — drops `users.name` after copying it.",
          "- `auth` · `src/api/session.ts:88` — the role check now runs after the handler is chosen.",
        ].join("\n"),
        [
          "**Needs a person:**",
          "",
          "- `src/billing/retry.ts:40` (`tradeoff`) — retries are capped at 3; whether a fourth charge attempt is acceptable is a product call.",
        ].join("\n"),
        "**Read first:** `db/migrations/0042_split_name.sql`, `src/api/session.ts`, `src/billing/retry.ts`.",
      ].join("\n\n"),
    );
  });
});
