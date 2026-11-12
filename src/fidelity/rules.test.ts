/** The fixed rules that explain a changed file without a claim (ADR 0033 decision 2). */
import { describe, expect, test } from "bun:test";
import { explainedByRule, isFormattingOnly, isLockfile, isGeneratedPath, isTestPath } from "./rules";

const patch = (...lines: string[]) => lines.join("\n");

describe("isLockfile", () => {
  test("knows the lockfiles of the common package managers, at any depth", () => {
    for (const p of [
      "bun.lock",
      "bun.lockb",
      "package-lock.json",
      "yarn.lock",
      "pnpm-lock.yaml",
      "Cargo.lock",
      "go.sum",
      "poetry.lock",
      "uv.lock",
      "Gemfile.lock",
      "composer.lock",
      "apps/web/package-lock.json",
    ]) {
      expect(isLockfile(p)).toBe(true);
    }
  });

  test("a manifest is not a lockfile, and neither is a file that only contains the word", () => {
    for (const p of ["package.json", "Cargo.toml", "src/lock.ts", "docs/lockfiles.md", "go.mod"]) {
      expect(isLockfile(p)).toBe(false);
    }
  });
});

describe("isGeneratedPath", () => {
  test("knows generated directories, suffixes and minified bundles", () => {
    for (const p of [
      "src/generated/api.ts",
      "src/__generated__/schema.ts",
      "api/user.pb.go",
      "proto/user_pb2.py",
      "src/client.generated.ts",
      "public/app.min.js",
      "public/app.min.css",
    ]) {
      expect(isGeneratedPath(p)).toBe(true);
    }
  });

  test("a name that merely resembles one is not generated", () => {
    for (const p of ["src/generate.ts", "src/generator/index.ts", "src/minimal.js", "docs/generated-docs.md"]) {
      expect(isGeneratedPath(p)).toBe(false);
    }
  });

  test("a file that claims to be generated in its own text is not trusted", () => {
    expect(explainedByRule({ path: "src/handwritten.ts", patch: "@@ -0,0 +1 @@\n+// @generated" })).toBeUndefined();
  });
});

describe("isTestPath", () => {
  test("knows test files by suffix, prefix and directory", () => {
    for (const p of [
      "src/a.test.ts",
      "src/a.spec.tsx",
      "pkg/a_test.go",
      "tests/test_a.py",
      "src/__tests__/a.ts",
      "test/fixtures/a.json",
    ]) {
      expect(isTestPath(p)).toBe(true);
    }
  });

  test("source files whose name contains test are not tests", () => {
    for (const p of ["src/attest.ts", "src/contest.ts", "src/testing-utils.ts", "src/latest/a.ts"]) {
      expect(isTestPath(p)).toBe(false);
    }
  });
});

describe("isFormattingOnly", () => {
  test("indentation and trailing-space changes are formatting", () => {
    expect(isFormattingOnly(patch("@@ -1 +1 @@", "-    const a = 1;", "+  const a = 1;"))).toBe(true);
    expect(isFormattingOnly(patch("@@ -1 +1 @@", "-const a = 1;", "+const a = 1;   "))).toBe(true);
    expect(isFormattingOnly(patch("@@ -1,2 +1,2 @@", "-\tf();", "-g();  ", "+    f();", "+g();"))).toBe(true);
  });

  test("any change of whitespace inside a line is not formatting: collapsed, widened, deleted or a tab", () => {
    expect(isFormattingOnly(patch("@@ -1 +1 @@", "-const   a  =  1;", "+const a = 1;"))).toBe(false);
    expect(isFormattingOnly(patch("@@ -1 +1 @@", '-const s = "a  b";', '+const s = "a b";'))).toBe(false);
    expect(isFormattingOnly(patch("@@ -1 +1 @@", '-const s = "a\tb";', '+const s = "a b";'))).toBe(false);
    expect(isFormattingOnly(patch("@@ -1 +1 @@", "-const a = 1;", "+const a=1;"))).toBe(false);
  });

  test("whitespace inside a string literal removed or added is a change", () => {
    expect(isFormattingOnly(patch("@@ -1 +1 @@", '-const s = "a b";', '+const s = "ab";'))).toBe(false);
    expect(isFormattingOnly(patch("@@ -1 +1 @@", '-const s = "ab";', '+const s = "a b";'))).toBe(false);
    expect(isFormattingOnly(patch("@@ -1 +1 @@", '-const s = " ";', '+const s = "";'))).toBe(false);
  });

  test("a space that separates two operators is a change: a - -b against a --b", () => {
    expect(isFormattingOnly(patch("@@ -1 +1 @@", "-x = a - -b;", "+x = a --b;"))).toBe(false);
  });

  test("a hunk with a backtick is never formatting: a template literal's value depends on its indentation", () => {
    expect(isFormattingOnly(patch("@@ -1,2 +1,2 @@", "-const s = `a", "-  b`;", "+const s = `a", "+    b`;"))).toBe(false);
    expect(isFormattingOnly(patch("@@ -1 +1 @@", "-const s = `a`;", "+  const s = `a`;"))).toBe(false);
    expect(isFormattingOnly(patch("@@ -1 +1 @@", "-const s = 'a';", "+  const s = 'a';"))).toBe(true);
  });

  test("a statement joined onto one line, or split over several, is a change", () => {
    expect(isFormattingOnly(patch("@@ -1,2 +1 @@", "-return", "- value;", "+return value;"))).toBe(false);
    expect(isFormattingOnly(patch("@@ -1 +1,3 @@", "-call(a, b, c);", "+call(", "+  a, b, c", "+);"))).toBe(false);
  });

  test("a change of a token is not formatting", () => {
    expect(isFormattingOnly(patch("@@ -1 +1 @@", "-const timeout = 30;", "+const timeout = 60;"))).toBe(false);
  });

  test("code moved from one hunk to another is not formatting", () => {
    expect(
      isFormattingOnly(patch("@@ -1,2 +1 @@", "-moved();", " keep();", "@@ -9 +8,2 @@", " tail();", "+moved();")),
    ).toBe(false);
  });

  test("a patch with no changed line, or no patch at all, is not formatting", () => {
    expect(isFormattingOnly("")).toBe(false);
    expect(isFormattingOnly(undefined)).toBe(false);
    expect(isFormattingOnly("@@ -1 +1 @@\n context")).toBe(false);
  });

  test("the file header lines of a diff are not read as changed lines", () => {
    expect(isFormattingOnly(patch("--- a/x.ts", "+++ b/x.ts", "@@ -1 +1 @@", "-  a = 1", "+a = 1"))).toBe(true);
  });
});

describe("explainedByRule", () => {
  test("a lockfile is explained by the lockfile rule", () => {
    expect(explainedByRule({ path: "bun.lock" })).toBe("lockfile");
  });

  test("a generated file is explained by the generated rule", () => {
    expect(explainedByRule({ path: "src/generated/api.ts" })).toBe("generated");
  });

  test("a formatting-only change is explained, and a real one is not", () => {
    expect(explainedByRule({ path: "src/a.ts", patch: patch("@@ -1 +1 @@", "-  a = 1", "+a = 1") })).toBe(
      "formatting-only",
    );
    expect(explainedByRule({ path: "src/a.ts", patch: patch("@@ -1 +1 @@", "-a = 1", "+a = 2") })).toBeUndefined();
  });

  test("an indentation change in a language where indentation means something is not formatting", () => {
    const indent = patch("@@ -1,2 +1,2 @@", "-if x:", "-    run()", "+if x:", "+        run()");
    expect(explainedByRule({ path: "tool.py", patch: indent })).toBeUndefined();
    expect(explainedByRule({ path: ".github/workflows/ci.yml", patch: indent })).toBeUndefined();
    expect(explainedByRule({ path: "Makefile", patch: indent })).toBeUndefined();
  });

  test("a test is explained only when the source it tests is explained by a confirmed claim", () => {
    const confirmed = new Set(["src/risk.ts"]);
    expect(explainedByRule({ path: "src/risk.test.ts" }, { confirmedPaths: confirmed })).toBe(
      "test-of-confirmed-claim",
    );
    expect(explainedByRule({ path: "src/other.test.ts" }, { confirmedPaths: confirmed })).toBeUndefined();
    expect(explainedByRule({ path: "src/risk.test.ts" })).toBeUndefined();
  });

  test("a test in a mirrored test directory is matched to its source", () => {
    const confirmed = new Set(["src/fidelity/grade.ts"]);
    expect(explainedByRule({ path: "test/fidelity/grade.test.ts" }, { confirmedPaths: confirmed })).toBe(
      "test-of-confirmed-claim",
    );
    expect(explainedByRule({ path: "src/fidelity/__tests__/grade.test.ts" }, { confirmedPaths: confirmed })).toBe(
      "test-of-confirmed-claim",
    );
    expect(explainedByRule({ path: "test/grade.test.ts" }, { confirmedPaths: confirmed })).toBe(
      "test-of-confirmed-claim",
    );
  });

  test("go and python test names find their source", () => {
    expect(explainedByRule({ path: "pkg/user_test.go" }, { confirmedPaths: new Set(["pkg/user.go"]) })).toBe(
      "test-of-confirmed-claim",
    );
    expect(explainedByRule({ path: "tests/test_user.py" }, { confirmedPaths: new Set(["app/user.py"]) })).toBe(
      "test-of-confirmed-claim",
    );
  });

  test("a test of the same stem in an unrelated directory does not match", () => {
    expect(
      explainedByRule({ path: "src/billing/index.test.ts" }, { confirmedPaths: new Set(["src/auth/index.ts"]) }),
    ).toBeUndefined();
  });

  test("a source file confirmed by a claim is not explained by the test rule, and unknown files stay unexplained", () => {
    expect(explainedByRule({ path: "src/risk.ts" }, { confirmedPaths: new Set(["src/risk.ts"]) })).toBeUndefined();
    expect(explainedByRule({ path: "src/session.ts" })).toBeUndefined();
  });
});
