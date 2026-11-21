import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CHECK_BUN, compare, countCheck, countLint, LINT_BUN, ratchet, type Baseline, type Runner } from "./ratchet";

const repo = resolve(import.meta.dir, "..");

/** What `bun lint --format json` prints: one entry per file, absolute paths, one message per diagnostic. */
const lintJson = (root: string, files: Record<string, (string | null)[]>) =>
  JSON.stringify(
    Object.entries(files).map(([file, rules]) => ({
      filePath: join(root, file),
      messages: rules.map((ruleId, i) => ({ ruleId, severity: 1, message: "m", line: i + 1, column: 1 })),
    })),
  );

/** What `bun check --no-pretty` prints on stdout: one line per error, indented continuation lines under some. */
const checkText = (...lines: string[]) => lines.join("\n") + "\n";

describe("countLint", () => {
  test("counts diagnostics by rule, then by file, with paths relative to the root", () => {
    const out = lintJson("/r", { "src/a.ts": ["no-empty", "no-empty", "max-depth"], "src/b.ts": ["no-empty"], "src/clean.ts": [] });
    expect(countLint(out, "/r")).toEqual({
      "max-depth": { "src/a.ts": 1 },
      "no-empty": { "src/a.ts": 2, "src/b.ts": 1 },
    });
  });

  test("a diagnostic with no rule (a file that does not parse) is counted under its own name, not dropped", () => {
    expect(countLint(lintJson("/r", { "src/a.ts": [null] }), "/r")).toEqual({ "(no rule)": { "src/a.ts": 1 } });
  });

  test("output that is not the expected JSON is an error, never an empty count", () => {
    expect(() => countLint("not json", "/r")).toThrow(/lint/i);
    expect(() => countLint("{}", "/r")).toThrow(/lint/i);
  });
});

describe("countCheck", () => {
  test("counts errors by code, then by file, and skips continuation lines and annotations", () => {
    const out = checkText(
      "src/a.ts(3,5): error TS2345: Argument of type 'x' is not assignable.",
      "  Types of property 'wait' are incompatible.",
      "    Type 'boolean' is not assignable to type 'true'.",
      "src/a.ts(9,1): error TS2345: Another one.",
      "test/b.test.ts(1,1): error TS2322: Type mismatch.",
      "::error file=src/a.ts,line=3,col=5,title=TS2345::Argument",
    );
    expect(countCheck(out)).toEqual({ TS2322: { "test/b.test.ts": 1 }, TS2345: { "src/a.ts": 2 } });
  });

  test("a clean run is an empty count", () => {
    expect(countCheck("")).toEqual({});
  });
});

describe("compare", () => {
  const base: Baseline["lint"] = { "no-empty": { "src/a.ts": 2, "src/b.ts": 1 } };

  test("equal counts are neither a rise nor a fall", () => {
    expect(compare(base, base)).toEqual({ rises: [], falls: [] });
  });

  test("a higher count in a known file is a rise", () => {
    const now = { "no-empty": { "src/a.ts": 3, "src/b.ts": 1 } };
    expect(compare(base, now).rises).toEqual([{ rule: "no-empty", file: "src/a.ts", was: 2, now: 3 }]);
  });

  test("a rule or file the baseline has never seen is a rise from zero", () => {
    const now = { "no-empty": { "src/a.ts": 2, "src/b.ts": 1, "src/new.ts": 1 }, "max-depth": { "src/a.ts": 1 } };
    expect(compare(base, now).rises).toEqual([
      { rule: "max-depth", file: "src/a.ts", was: 0, now: 1 },
      { rule: "no-empty", file: "src/new.ts", was: 0, now: 1 },
    ]);
  });

  test("a lower count, or a file that dropped out, is a fall and not a rise", () => {
    const now = { "no-empty": { "src/a.ts": 1 } };
    const result = compare(base, now);
    expect(result.rises).toEqual([]);
    expect(result.falls).toEqual([
      { rule: "no-empty", file: "src/a.ts", was: 2, now: 1 },
      { rule: "no-empty", file: "src/b.ts", was: 1, now: 0 },
    ]);
  });

  test("a fall in one file does not pay for a rise in another", () => {
    const now = { "no-empty": { "src/a.ts": 0, "src/b.ts": 2 } };
    const result = compare(base, now);
    expect(result.rises).toEqual([{ rule: "no-empty", file: "src/b.ts", was: 1, now: 2 }]);
    expect(result.falls).toEqual([{ rule: "no-empty", file: "src/a.ts", was: 2, now: 0 }]);
  });
});

describe("ratchet", () => {
  let dir: string;
  let baselinePath: string;
  let logs: string[];
  let calls: string[];
  const log = (line: string) => logs.push(line);

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "wachiman-ratchet-")));
    baselinePath = join(dir, "baseline.json");
    logs = [];
    calls = [];
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** A runner that answers each tool with canned output, as the real tool would, and records what it was asked. */
  const runner =
    (lint: Record<string, (string | null)[]>, check: string): Runner =>
    (tool) => {
      calls.push(tool);
      return tool === "lint" ? { status: 1, stdout: lintJson(dir, lint), stderr: "" } : { status: 1, stdout: check, stderr: "" };
    };
  const errorLine = (file: string) => `${file}(1,1): error TS2345: boom`;
  const writeBaseline = (b: Baseline) => writeFileSync(baselinePath, JSON.stringify(b));

  test("--update records the current counts, and the next run on the same code passes", () => {
    const run = runner({ "src/a.ts": ["no-empty"] }, checkText(errorLine("src/a.ts")));
    expect(ratchet({ which: "all", update: true, root: dir, baselinePath, run, log })).toBe(0);
    const written = JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;
    expect(written.lint).toEqual({ "no-empty": { "src/a.ts": 1 } });
    expect(written.check).toEqual({ TS2345: { "src/a.ts": 1 } });
    expect(ratchet({ which: "all", update: false, root: dir, baselinePath, run, log })).toBe(0);
  });

  test("fails when a change adds a lint violation over the baseline, and names the rule and file", () => {
    writeBaseline({ lint: { "no-empty": { "src/a.ts": 1 } }, check: {} });
    const run = runner({ "src/a.ts": ["no-empty", "no-empty"] }, "");
    expect(ratchet({ which: "lint", update: false, root: dir, baselinePath, run, log })).toBe(1);
    expect(logs.join("\n")).toMatch(/no-empty.*src\/a\.ts.*1.*2/);
  });

  test("passes when a change removes a lint violation, says so, and does not rewrite the baseline", () => {
    writeBaseline({ lint: { "no-empty": { "src/a.ts": 2 } }, check: {} });
    const before = readFileSync(baselinePath, "utf8");
    const run = runner({ "src/a.ts": ["no-empty"] }, "");
    expect(ratchet({ which: "lint", update: false, root: dir, baselinePath, run, log })).toBe(0);
    expect(logs.join("\n")).toMatch(/fell|lower|decrease/i);
    expect(logs.join("\n")).toContain("--update");
    expect(readFileSync(baselinePath, "utf8")).toBe(before);
  });

  test("fails when a change adds a type error over the baseline", () => {
    writeBaseline({ lint: {}, check: { TS2345: { "src/a.ts": 1 } } });
    const run = runner({}, checkText(errorLine("src/a.ts"), errorLine("src/a.ts")));
    expect(ratchet({ which: "check", update: false, root: dir, baselinePath, run, log })).toBe(1);
    expect(logs.join("\n")).toMatch(/TS2345.*src\/a\.ts/);
  });

  test("runs only the tool it was asked to", () => {
    writeBaseline({ lint: {}, check: {} });
    ratchet({ which: "lint", update: false, root: dir, baselinePath, run: runner({}, ""), log });
    expect(calls).toEqual(["lint"]);
    calls.length = 0;
    ratchet({ which: "check", update: false, root: dir, baselinePath, run: runner({}, ""), log });
    expect(calls).toEqual(["check"]);
  });

  test("--update of one tool keeps the other tool's recorded counts", () => {
    writeBaseline({ lint: { "no-empty": { "src/a.ts": 5 } }, check: { TS2345: { "src/a.ts": 3 } } });
    const run = runner({}, checkText(errorLine("src/a.ts")));
    expect(ratchet({ which: "check", update: true, root: dir, baselinePath, run, log })).toBe(0);
    const written = JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;
    expect(written.lint).toEqual({ "no-empty": { "src/a.ts": 5 } });
    expect(written.check).toEqual({ TS2345: { "src/a.ts": 1 } });
  });

  test("a missing baseline fails and says how to create it", () => {
    const run = runner({}, "");
    expect(ratchet({ which: "lint", update: false, root: dir, baselinePath, run, log })).toBe(2);
    expect(logs.join("\n")).toContain("--update");
  });

  test("a tool that crashes (a status other than 0 or 1, or no output at all) fails the run instead of passing as clean", () => {
    writeBaseline({ lint: {}, check: {} });
    const crashed: Runner = () => ({ status: 2, stdout: "", stderr: "boom" });
    expect(ratchet({ which: "lint", update: false, root: dir, baselinePath, run: crashed, log })).toBe(2);
    const silentFailure: Runner = () => ({ status: 1, stdout: "", stderr: "" });
    expect(ratchet({ which: "check", update: false, root: dir, baselinePath, run: silentFailure, log })).toBe(2);
  });

  test("a clean check with exit 0 and no output is a pass, not a crash", () => {
    writeBaseline({ lint: {}, check: {} });
    const clean: Runner = () => ({ status: 0, stdout: "", stderr: "" });
    expect(ratchet({ which: "check", update: false, root: dir, baselinePath, run: clean, log })).toBe(0);
  });
});

describe("the toolchain pins", () => {
  const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const ci = readFileSync(join(repo, ".github/workflows/ci.yml"), "utf8");

  test("fmt and check use one exact stable Bun, lint an exact canary until a stable release has `bun lint`", () => {
    expect(CHECK_BUN).toMatch(/^\d+\.\d+\.\d+$/);
    expect(LINT_BUN).toMatch(/^\d+\.\d+\.\d+-canary\.\d+\.\d+$/);
  });

  test("the package scripts name the same versions the ratchet runs", () => {
    expect(pkg.scripts["fmt"]).toContain(`bun@${CHECK_BUN}`);
    expect(pkg.scripts["fmt:check"]).toContain(`bun@${CHECK_BUN}`);
    expect(pkg.scripts["lint:raw"]).toContain(`bun@${LINT_BUN}`);
    expect(pkg.scripts["check:raw"]).toContain(`bun@${CHECK_BUN}`);
  });

  test("the gates CI runs are the ratcheted ones, and the CI jobs run them", () => {
    expect(pkg.scripts["lint"]).toContain("scripts/ratchet.ts lint");
    expect(pkg.scripts["check"]).toContain("scripts/ratchet.ts check");
    expect(pkg.scripts["ratchet"]).toContain("scripts/ratchet.ts");
    for (const command of ["bun run fmt:check", "bun run lint", "bun run check"]) expect(ci).toContain(command);
  });

  test("the consumer runtime stays on Bun 1.3.4", () => {
    expect(pkg.dependencies["bun"]).toBe("1.3.4");
  });

  test("the typecheck's inputs are exact pins: bun-types asks for any @types/node, so an unpinned one would move the baseline", () => {
    const dev = pkg.devDependencies ?? {};
    expect(Object.keys(dev).sort()).toEqual(["@types/bun", "@types/node"]);
    for (const version of Object.values(dev)) expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(dev["@types/bun"]).toBe(pkg.dependencies["bun"]);
  });
});
