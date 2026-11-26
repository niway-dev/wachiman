import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { spawnGit, type GitRunner } from "../evidence";
import { commit, emptyRepo, git, removeTempRepos, write } from "../../test/support/temp-repo";
import { buildLocalInput, localFormatOnly, readIgnoreRevs } from "./local-git";

// Local routing by `.git-blame-ignore-revs` (ADR 0063, AC21): the same rule as in a pull request
// run, read from the working tree's file and from one `git log` of the range.

afterAll(removeTempRepos);

/**
 * `main` holds a.ts, b.ts and c.ts. `feat/x` has three commits: a formatter run over a.ts and
 * c.ts, a feature commit over c.ts and a new d.ts, and a second formatter run over b.ts.
 */
function formattedBranch() {
  const dir = emptyRepo();
  const mergeBase = commit(dir, { "a.ts": "a=1\n", "b.ts": "b=1\n", "c.ts": "c=1\n" }, "base");
  git(dir, "switch", "-q", "-c", "feat/x");
  const format1 = commit(dir, { "a.ts": "a = 1;\n", "c.ts": "c = 1;\n" }, "style: format");
  const feature = commit(dir, { "c.ts": "c = 2;\n", "d.ts": "d = 1;\n" }, "feat: change c");
  const format2 = commit(dir, { "b.ts": "b = 1;\n" }, "style: format b");
  return { dir, mergeBase, format1, feature, format2 };
}

const run = (b: ReturnType<typeof formattedBranch>, text: string | undefined, files = ["a.ts", "b.ts", "c.ts", "d.ts"]) => {
  const notes: string[] = [];
  const only = localFormatOnly(b.dir, b.mergeBase, "HEAD", files, text, (l) => notes.push(l));
  return { only, notes };
};

describe("localFormatOnly reads the range with one git log", () => {
  test("a file changed only by listed commits is format-only; one a feature commit also touched is not", () => {
    const b = formattedBranch();
    expect(run(b, `${b.format1}\n${b.format2}\n`).only).toEqual(["a.ts", "b.ts"]);
  });

  test("a listing that names one formatter commit routes only that commit's files", () => {
    const b = formattedBranch();
    expect(run(b, `${b.format1} # bun fmt\n`).only).toEqual(["a.ts"]);
  });

  test("an abbreviated hash is matched against the range", () => {
    const b = formattedBranch();
    expect(run(b, `${b.format2.slice(0, 10)}\n`).only).toEqual(["b.ts"]);
  });

  test("no file, an empty file, or a listing with no commit of the range routes nothing", () => {
    const b = formattedBranch();
    expect(run(b, undefined).only).toEqual([]);
    expect(run(b, "# nothing\n").only).toEqual([]);
    expect(run(b, `${"e".repeat(40)}\n`).only).toEqual([]);
  });

  test("a merge commit is conservative: git log -m shows it touching what the branch changed, and it is not listed", () => {
    const b = formattedBranch();
    const listing = `${b.format1}\n${b.format2}\n`;
    expect(run(b, listing, ["a.ts", "b.ts"]).only).toEqual(["a.ts", "b.ts"]);
    git(b.dir, "switch", "-q", "-c", "side", b.mergeBase);
    commit(b.dir, { "e.ts": "e=1\n" }, "side change");
    git(b.dir, "switch", "-q", "feat/x");
    git(b.dir, "merge", "-q", "--no-ff", "-m", "merge side", "side");
    expect(run(b, listing, ["a.ts", "b.ts"]).only).toEqual([]);
  });

  test("a file a listed commit renamed after an unlisted edit stays with the main model", () => {
    const dir = emptyRepo();
    const body = Array.from({ length: 40 }, (_, i) => `line ${i}\n`).join("");
    const mergeBase = commit(dir, { "old.ts": body, "other.ts": "x=1\n" }, "base");
    git(dir, "switch", "-q", "-c", "feat/x");
    commit(dir, { "old.ts": `${body}// behaviour change\n` }, "feat: change old");
    git(dir, "mv", "old.ts", "new.ts");
    git(dir, "commit", "-q", "-m", "style: rename");
    const rename = git(dir, "rev-parse", "HEAD").trim();
    const notes: string[] = [];
    expect(localFormatOnly(dir, mergeBase, "HEAD", ["new.ts"], `${rename}\n`, (l) => notes.push(l))).toEqual([]);
  });

  test("a review that starts at a root commit reads all of the head's history", () => {
    const dir = emptyRepo();
    const root = commit(dir, { "a.ts": "a=1\n" }, "style: format everything");
    const notes: string[] = [];
    expect(localFormatOnly(dir, null, "HEAD", ["a.ts"], `${root}\n`, (l) => notes.push(l))).toEqual(["a.ts"]);
    expect(notes.join("\n")).not.toContain("could not be used");
  });

  test("a shallow clone is not routed and says why", () => {
    const b = formattedBranch();
    const shallow: GitRunner = (args) =>
      args[0] === "rev-parse" && args.includes("--is-shallow-repository") ? { status: 0, stdout: "true\n", stderr: "" } : (() => { throw new Error("must not run git log"); })();
    const notes: string[] = [];
    expect(localFormatOnly(b.dir, b.mergeBase, "HEAD", ["a.ts"], `${b.format1}\n`, (l) => notes.push(l), shallow)).toEqual([]);
    expect(notes.join("\n")).toContain("shallow");
  });

  test("an empty commit in the range does not shift the commits after it", () => {
    const b = formattedBranch();
    git(b.dir, "commit", "-q", "--allow-empty", "-m", "chore: empty");
    expect(run(b, `${b.format1}\n${b.format2}\n`).only).toEqual(["a.ts", "b.ts"]);
  });

  test("output the parser does not read is an error, so no file is routed", () => {
    const b = formattedBranch();
    const noisy: GitRunner = (args, opts) =>
      args.includes("log") ? { status: 0, stdout: "gpg: Good signature\x01abc\0M\0a.ts\0", stderr: "" } : spawnGit(args, opts);
    const notes: string[] = [];
    expect(localFormatOnly(b.dir, b.mergeBase, "HEAD", ["a.ts"], `${b.format1}\n`, (l) => notes.push(l), noisy)).toEqual([]);
    expect(notes.join("\n")).toContain("could not be used");
  });

  test("a git failure is a note and an empty answer, never an error", () => {
    const b = formattedBranch();
    const notes: string[] = [];
    expect(localFormatOnly(b.dir, "0".repeat(40), "HEAD", ["a.ts"], `${b.format1}\n`, (l) => notes.push(l))).toEqual([]);
    expect(notes.join("\n")).toContain("could not be used");
  });
});

describe("readIgnoreRevs reads the working tree", () => {
  test("returns the file's text, or undefined when it is absent", () => {
    const b = formattedBranch();
    expect(readIgnoreRevs(b.dir)).toBeUndefined();
    write(b.dir, { ".git-blame-ignore-revs": `${b.format1}\n` });
    expect(readIgnoreRevs(b.dir)).toBe(`${b.format1}\n`);
  });
});

describe("buildLocalInput routes by the working tree's file (AC21)", () => {
  test("the input carries formatOnly from the working tree's .git-blame-ignore-revs", () => {
    const b = formattedBranch();
    write(b.dir, { ".git-blame-ignore-revs": `${b.format1}\n${b.format2}\n` });
    const built = buildLocalInput({ repoDir: b.dir, base: "main", paths: [], log: () => {}, warn: () => {} });
    try {
      expect(built.input.formatOnly).toEqual(["a.ts", "b.ts"]);
    } finally {
      rmSync(built.snapshotDir, { recursive: true, force: true });
    }
  });

  test("format: false (ask) reads no commits and the input has no formatOnly", () => {
    const b = formattedBranch();
    write(b.dir, { ".git-blame-ignore-revs": `${b.format1}\n${b.format2}\n` });
    const lines: string[] = [];
    const built = buildLocalInput({ repoDir: b.dir, base: "main", paths: [], format: false, log: (l) => lines.push(l), warn: () => {} });
    try {
      expect(built.input.formatOnly).toBeUndefined();
      expect(lines.join("\n")).not.toContain(".git-blame-ignore-revs");
    } finally {
      rmSync(built.snapshotDir, { recursive: true, force: true });
    }
  });

  test("without the file the input has no formatOnly", () => {
    const b = formattedBranch();
    const built = buildLocalInput({ repoDir: b.dir, base: "main", paths: [], log: () => {}, warn: () => {} });
    try {
      expect(built.input.formatOnly).toBeUndefined();
    } finally {
      rmSync(built.snapshotDir, { recursive: true, force: true });
    }
  });
});
