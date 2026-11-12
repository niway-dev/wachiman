/** Checking the model's claims and deciding which files they explain (ADR 0033 decisions 1, 2, 9, 13). */
import { describe, expect, test } from "bun:test";
import { checkClaims, unexplainedFiles } from "./claims";
import type { Assignment, Claim } from "./types";

const claim = (over: Partial<Claim> = {}): Claim => ({
  text: "Adds an export button",
  status: "confirmed",
  evidence: [{ path: "src/Toolbar.tsx", line: 52, endLine: 78 }],
  ...over,
});

describe("checkClaims", () => {
  const lineExists = (path: string, line: number) => path === "src/Toolbar.tsx" && line >= 1 && line <= 100;

  test("keeps a confirmed claim whose evidence exists", () => {
    const [c] = checkClaims([claim()], lineExists);
    expect(c).toEqual(claim());
  });

  test("drops evidence whose line or path does not exist, and a confirmed claim left with none becomes unverified", () => {
    const [c] = checkClaims(
      [claim({ evidence: [{ path: "src/Toolbar.tsx", line: 500 }, { path: "src/ghost.ts", line: 1 }] })],
      lineExists,
    );
    expect(c?.status).toBe("unverified");
    expect(c?.evidence).toEqual([]);
  });

  test("a range whose end does not exist loses its end line, not the whole evidence", () => {
    const [c] = checkClaims([claim({ evidence: [{ path: "src/Toolbar.tsx", line: 90, endLine: 140 }] })], lineExists);
    expect(c?.status).toBe("confirmed");
    expect(c?.evidence).toEqual([{ path: "src/Toolbar.tsx", line: 90 }]);
  });

  test("a range that ends before it starts is read as its first line", () => {
    const [c] = checkClaims([claim({ evidence: [{ path: "src/Toolbar.tsx", line: 60, endLine: 50 }] })], lineExists);
    expect(c?.evidence).toEqual([{ path: "src/Toolbar.tsx", line: 60 }]);
  });

  test("a contradicted claim stays contradicted when its evidence is gone: the contradiction is not discarded", () => {
    const [c] = checkClaims([claim({ status: "contradicted", evidence: [{ path: "x.ts", line: 1 }] })], lineExists);
    expect(c?.status).toBe("contradicted");
    expect(c?.evidence).toEqual([]);
  });

  test("an unknown status is unverified, never confirmed", () => {
    const [c] = checkClaims([{ ...claim(), status: "proven" as never }], lineExists);
    expect(c?.status).toBe("unverified");
  });

  test("a vague claim keeps its status", () => {
    const [c] = checkClaims([claim({ status: "vague", evidence: [] })], lineExists);
    expect(c?.status).toBe("vague");
  });

  test("a claim with no text is dropped", () => {
    expect(checkClaims([claim({ text: "   " })], lineExists)).toEqual([]);
  });
});

describe("unexplainedFiles", () => {
  const files = (...paths: string[]) => paths.map((path) => ({ path }));
  const to = (path: string, claimIndex: number): Assignment => ({ path, claim: claimIndex });

  test("a file assigned to a confirmed claim is explained", () => {
    expect(unexplainedFiles(files("src/a.ts"), [to("src/a.ts", 0)], [claim()])).toEqual([]);
  });

  test("a file assigned to an unverified claim is explained: the claim is the problem, not the file", () => {
    expect(unexplainedFiles(files("src/a.ts"), [to("src/a.ts", 0)], [claim({ status: "unverified" })])).toEqual([]);
  });

  test("a vague claim counts as no claim: it explains nothing", () => {
    expect(unexplainedFiles(files("src/a.ts"), [to("src/a.ts", 0)], [claim({ status: "vague" })])).toEqual(["src/a.ts"]);
  });

  test("a contradicted claim explains nothing", () => {
    expect(unexplainedFiles(files("src/a.ts"), [to("src/a.ts", 0)], [claim({ status: "contradicted" })])).toEqual([
      "src/a.ts",
    ]);
  });

  test("a file with no assignment, or one to a claim that does not exist, is unexplained", () => {
    expect(unexplainedFiles(files("src/a.ts", "src/b.ts"), [to("src/b.ts", 7), to("src/b.ts", -1)], [claim()])).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  test("a file kept by one good claim stays explained even when another assignment of it points at a vague one", () => {
    expect(
      unexplainedFiles(files("src/a.ts"), [to("src/a.ts", 0), to("src/a.ts", 1)], [claim({ status: "vague" }), claim()]),
    ).toEqual([]);
  });

  test("an assignment for a file that did not change is ignored", () => {
    expect(unexplainedFiles(files("src/a.ts"), [to("src/z.ts", 0)], [claim()])).toEqual(["src/a.ts"]);
  });

  test("lockfiles, generated files and formatting are explained by rule with no claim at all", () => {
    expect(
      unexplainedFiles(
        [
          { path: "bun.lock" },
          { path: "src/generated/api.ts" },
          { path: "src/a.ts", patch: "@@ -1 +1 @@\n-a=1\n+a = 1" },
          { path: "src/session.ts" },
        ],
        [],
        [],
      ),
    ).toEqual(["src/session.ts"]);
  });

  test("a test is explained when its source is assigned to a confirmed claim, not when the claim is unverified", () => {
    const set = files("src/a.ts", "src/a.test.ts");
    expect(unexplainedFiles(set, [to("src/a.ts", 0)], [claim()])).toEqual([]);
    expect(unexplainedFiles(set, [to("src/a.ts", 0)], [claim({ status: "unverified" })])).toEqual(["src/a.test.ts"]);
  });

  test("a test whose source is explained only by a rule, not by a claim, stays unexplained", () => {
    const reformatted = { path: "src/a.ts", patch: "@@ -1 +1 @@\n-a=1\n+a = 1" };
    expect(unexplainedFiles([reformatted, { path: "src/a.test.ts" }], [], [])).toEqual(["src/a.test.ts"]);
  });

  test("keeps the order of the changed files and lists each once", () => {
    expect(unexplainedFiles(files("src/z.ts", "src/a.ts", "src/z.ts"), [], [])).toEqual(["src/z.ts", "src/a.ts"]);
  });
});
