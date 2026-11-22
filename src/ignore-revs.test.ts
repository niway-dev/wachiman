import { describe, expect, test } from "bun:test";
import { formatOnlyPaths, listedCommitsIn, parseIgnoreRevs } from "./ignore-revs";

// ADR 0063 decisions 1 and 2: `.git-blame-ignore-revs` names the formatting commits, and a file
// goes to the cheaper model only when every commit of the range that touches it is named. The
// file is read as `git blame --ignore-revs-file` reads it, and nothing in it is ever an error.

const A = "a639481" + "0".repeat(33);
const B = "b11d2e9" + "1".repeat(33);
const C = "c77f0a3" + "2".repeat(33);

describe("parseIgnoreRevs", () => {
  test("reads full and abbreviated hashes, one per line", () => {
    expect(parseIgnoreRevs(`${A}\na639481\n`)).toEqual([A, "a639481"]);
  });

  test("skips comment lines, blank lines and the comment after a hash", () => {
    const text = ["# Format the code with bun fmt", "", `${A} # the formatter commit`, "   ", "  # indented comment", `${B}`].join("\n");
    expect(parseIgnoreRevs(text)).toEqual([A, B]);
  });

  test("lowercases hashes and accepts Windows line endings", () => {
    expect(parseIgnoreRevs(`${A.toUpperCase()}\r\n${B}\r\n`)).toEqual([A, B]);
  });

  test("drops anything that is not a hash of at least 7 hex characters, without throwing", () => {
    expect(parseIgnoreRevs(["not a hash", "abc12", "g".repeat(40), `${"a".repeat(41)}`, "a639481 trailing words", A].join("\n"))).toEqual([A]);
  });

  test("an empty file lists nothing", () => {
    expect(parseIgnoreRevs("")).toEqual([]);
  });
});

describe("listedCommitsIn", () => {
  const range = [A, B, C];

  test("a full hash in the range is listed", () => {
    expect(listedCommitsIn([A], range)).toEqual(new Set([A]));
  });

  test("an abbreviated hash is resolved against the range", () => {
    expect(listedCommitsIn(["b11d2e9"], range)).toEqual(new Set([B]));
  });

  test("a hash that is not in the range is ignored", () => {
    expect(listedCommitsIn(["d00dfee" + "3".repeat(33), "feedbee"], range)).toEqual(new Set());
  });

  test("an abbreviation that matches two commits of the range is not guessed", () => {
    const twin = "a639481" + "9".repeat(33);
    expect(listedCommitsIn(["a639481"], [A, twin])).toEqual(new Set());
    expect(listedCommitsIn([A], [A, twin])).toEqual(new Set([A]));
  });
});

describe("formatOnlyPaths", () => {
  const touches = [
    { sha: A, paths: ["src/a.ts", "src/b.ts", "src/c.ts"] },
    { sha: B, paths: ["src/b.ts"] },
    { sha: C, paths: ["README.md"] },
  ];
  const files = ["src/a.ts", "src/b.ts", "src/c.ts", "README.md", "src/new.ts"];

  test("a file changed only by listed commits is format-only", () => {
    expect(formatOnlyPaths(files, touches, new Set([A]))).toEqual(["src/a.ts", "src/c.ts"]);
  });

  test("a file changed by a listed and an unlisted commit goes to the main model", () => {
    expect(formatOnlyPaths(["src/b.ts"], touches, new Set([A]))).toEqual([]);
  });

  test("a file changed by several commits, all of them listed, is format-only", () => {
    expect(formatOnlyPaths(["src/b.ts"], touches, new Set([A, B]))).toEqual(["src/b.ts"]);
  });

  test("a file no commit of the range is seen touching is never format-only", () => {
    expect(formatOnlyPaths(["src/new.ts"], touches, new Set([A, B, C]))).toEqual([]);
  });

  test("with nothing listed there is no format-only file", () => {
    expect(formatOnlyPaths(files, touches, new Set())).toEqual([]);
  });
});
