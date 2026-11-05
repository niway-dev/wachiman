import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findingId, lineHashOf, titleKey } from "./fingerprint";

const dirs: string[] = [];
const dirWith = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "wachiman-fp-"));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
};
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");

describe("titleKey", () => {
  test("lowercases, drops backticks and punctuation, collapses whitespace", () => {
    expect(titleKey("Off-by-one in `items[i + 1]`:  the last element")).toBe("off by one in items i # the last element");
  });

  test("every digit run becomes one #", () => {
    expect(titleKey("Line 120 reads 3 bytes")).toBe("line # reads # bytes");
  });

  test("is stable under reordering of whitespace only", () => {
    expect(titleKey("a  b\tc")).toBe(titleKey("a b c"));
  });
});

describe("lineHashOf", () => {
  test("hashes the cited line without whitespace", () => {
    const dir = dirWith({ "f.ts": "const a = 1;\n  return items[i + 1];\n" });
    expect(lineHashOf(dir, "f.ts", 2)).toEqual({ hash: sha256hex("returnitems[i+1];"), text: "returnitems[i+1];" });
  });

  test("undefined for line 0, a missing file, a missing line", () => {
    const dir = dirWith({ "f.ts": "const a = 1;\n  return items[i + 1];\n" });
    expect(lineHashOf(dir, "f.ts", 0)).toBeUndefined();
    expect(lineHashOf(dir, "nope.ts", 2)).toBeUndefined();
    expect(lineHashOf(dir, "f.ts", 99)).toBeUndefined();
    expect(lineHashOf(dir, "../f.ts", 1)).toBeUndefined();
  });

  test("undefined for a line under 8 characters once stripped", () => {
    const dir = dirWith({ "f.ts": "  }\nreturn;\nconst longer = 1;\n" });
    expect(lineHashOf(dir, "f.ts", 1)).toBeUndefined();
    expect(lineHashOf(dir, "f.ts", 2)).toBeUndefined();
    expect(lineHashOf(dir, "f.ts", 3)).toBeDefined();
  });

  test("undefined for a line that occurs more than once in the file", () => {
    const dir = dirWith({ "f.ts": "return null;\nconst x = 1;\n  return null;\n" });
    expect(lineHashOf(dir, "f.ts", 1)).toBeUndefined();
    expect(lineHashOf(dir, "f.ts", 3)).toBeUndefined();
  });
});

describe("findingId", () => {
  test("ten hex digits, stable, and different for a different line", () => {
    const a = findingId("k", "h", "src/a.ts", 2, "bug", "t");
    expect(a).toMatch(/^[0-9a-f]{10}$/);
    expect(findingId("k", "h", "src/a.ts", 2, "bug", "t")).toBe(a);
    expect(findingId("k", "h", "src/a.ts", 3, "bug", "t")).not.toBe(a);
  });
});
