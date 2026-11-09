import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { repoRelative, toOsPath, toRepoSlashes } from "./repo-path";

describe("repoRelative", () => {
  test("keeps a forward-slash path and drops a leading ./ and doubled slashes", () => {
    for (const platform of ["win32", "linux", "darwin"]) {
      expect(repoRelative("src/a.ts", platform)).toBe("src/a.ts");
      expect(repoRelative("./src//a.ts", platform)).toBe("src/a.ts");
      expect(repoRelative("src/x/../a.ts", platform)).toBe("src/a.ts");
    }
  });

  test("on Windows a backslash path is the same repository path, with forward slashes", () => {
    expect(repoRelative("src\\deep\\a.ts", "win32")).toBe("src/deep/a.ts");
    expect(repoRelative(".\\src\\a.ts", "win32")).toBe("src/a.ts");
  });

  test("elsewhere a backslash is part of the file name", () => {
    expect(repoRelative("src\\a.ts", "linux")).toBe("src\\a.ts");
  });

  test("refuses empty, absolute and climbing paths on every OS", () => {
    for (const platform of ["win32", "linux"]) {
      for (const bad of ["", ".", "/etc/passwd", "../x", "a/../../x", ".."]) {
        expect({ platform, bad, got: repoRelative(bad, platform) }).toEqual({ platform, bad, got: null });
      }
    }
  });

  test("on Windows a drive path is refused, with either slash; elsewhere it is a file name", () => {
    for (const bad of ["C:\\Windows\\win.ini", "C:/x", "C:x"]) expect(repoRelative(bad, "win32")).toBeNull();
    expect(repoRelative("C:x", "linux")).toBe("C:x");
    expect(repoRelative("\\\\server\\share\\a", "win32")).toBeNull();
    expect(repoRelative("..\\x", "win32")).toBeNull();
  });
});

describe("toRepoSlashes", () => {
  test("only Windows converts backslashes", () => {
    expect(toRepoSlashes("a\\b", "win32")).toBe("a/b");
    expect(toRepoSlashes("a\\b", "darwin")).toBe("a\\b");
  });
});

describe("toOsPath", () => {
  test("joins the segments with this OS's separator", () => {
    expect(toOsPath("/root", "src/a.ts")).toBe(join("/root", "src", "a.ts"));
  });
});
