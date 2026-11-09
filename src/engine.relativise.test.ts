import { describe, expect, test } from "bun:test";
import { relativisePaths, type ReviewOutput } from "./engine";

const output = (paths: string[]) =>
  ({ files_reviewed: paths, files_skipped: [], findings: paths.map((path) => ({ path })) }) as unknown as ReviewOutput;

describe("relativisePaths", () => {
  test("on Windows an absolute path inside the head is made repository-relative, with either slash", () => {
    const head = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\wachiman-snapshot-x";
    const out = relativisePaths(output([`${head}\\src\\a.ts`, "C:/Users/RUNNER~1/AppData/Local/Temp/wachiman-snapshot-x/src/b.ts", "src/c.ts"]), head, "win32");
    expect(out.files_reviewed).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(out.findings.map((f) => f.path)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });

  test("elsewhere a backslash stays a file-name character", () => {
    const out = relativisePaths(output(["/tmp/head/src/a\\b.ts", "C:\\head\\src\\a.ts"]), "/tmp/head", "linux");
    expect(out.files_reviewed).toEqual(["src/a\\b.ts", "C:\\head\\src\\a.ts"]);
  });
});
