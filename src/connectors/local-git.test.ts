import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { UsageError } from "../config";
import { MAX_INSTRUCTION_BYTES } from "../engine";
import { spawnGit } from "../evidence";
import { validate } from "../../test/support/json-schema";
import { A_HEAD, branchRepo, commit, emptyRepo, git, removeTempRepos } from "../../test/support/temp-repo";
import {
  buildLocalInput,
  localFiles,
  localInstructions,
  removeSnapshot,
  resolveRefs,
  snapshotHead,
  splitPatches,
  tarCommand,
} from "./local-git";

afterAll(removeTempRepos);

const snapshots: string[] = [];
afterAll(() => snapshots.forEach(removeSnapshot));

/** `git diff` of one file, from its first `@@` line, without the trailing newline: GitHub's `patch`. */
function gitPatch(dir: string, from: string, to: string, file: string) {
  const out = git(dir, "diff", "-M", "--inter-hunk-context=1", from, to, "--", file);
  return out.slice(out.indexOf("@@")).replace(/\n$/, "");
}

describe("resolveRefs", () => {
  test("resolves the base, the merge-base and the head ref", () => {
    const r = branchRepo();
    expect(resolveRefs(r.dir, undefined)).toEqual({
      baseRef: "main",
      baseSha: r.mainTip,
      mergeBase: r.mergeBase,
      headRef: "feat/x",
      headSha: r.head,
      depth: 2,
    });
    expect(resolveRefs(r.dir, "main").mergeBase).toBe(r.mergeBase);
  });

  test("the upstream's default branch wins over main when origin/HEAD resolves", () => {
    const r = branchRepo();
    const bare = mkdtempSync(join(tmpdir(), "wachiman-bare-"));
    git(bare, "init", "-q", "--bare");
    git(r.dir, "remote", "add", "origin", bare);
    git(r.dir, "push", "-q", "origin", "main");
    git(r.dir, "fetch", "-q", "origin");
    git(r.dir, "remote", "set-head", "origin", "main");
    const refs = resolveRefs(r.dir, undefined);
    expect(refs.baseRef).toBe("origin/main");
    expect(refs.mergeBase).toBe(r.mergeBase);
    rmSync(bare, { recursive: true, force: true });
  });

  test("with neither origin/HEAD nor main, a usage error names --base", () => {
    const dir = emptyRepo();
    git(dir, "switch", "-q", "-c", "trunk");
    commit(dir, { "a.txt": "a\n" }, "first");
    git(dir, "switch", "-q", "-c", "feat/y");
    commit(dir, { "a.txt": "b\n" }, "second");
    expect(() => resolveRefs(dir, undefined)).toThrow(UsageError);
    expect(() => resolveRefs(dir, undefined)).toThrow("--base");
    expect(resolveRefs(dir, "trunk").baseRef).toBe("trunk");
  });

  test("refuses a detached HEAD, an unborn HEAD and a base with no merge-base", () => {
    const detached = branchRepo();
    git(detached.dir, "switch", "-q", "--detach", "feat/x");
    expect(() => resolveRefs(detached.dir, undefined)).toThrow("HEAD is detached; check out a branch, or pass --input");

    const unborn = emptyRepo();
    expect(() => resolveRefs(unborn, "main")).toThrow(UsageError);
    expect(() => resolveRefs(unborn, "main")).toThrow("no commit");

    const orphan = branchRepo();
    git(orphan.dir, "switch", "-q", "--orphan", "lonely");
    commit(orphan.dir, { "x.txt": "x\n" }, "unrelated");
    expect(() => resolveRefs(orphan.dir, "main")).toThrow("`main` and HEAD have no common ancestor");
  });

  test("a base that is not a commit, or looks like an option, is a usage error", () => {
    const r = branchRepo();
    expect(() => resolveRefs(r.dir, "nope")).toThrow(UsageError);
    expect(() => resolveRefs(r.dir, "--output=/tmp/x")).toThrow(UsageError);
  });
});

describe("localFiles", () => {
  test("the file list matches git: counts, patches, renames, binary", () => {
    const r = branchRepo();
    const files = localFiles(r.dir, r.mergeBase, r.head);
    const blob = (path: string) => git(r.dir, "rev-parse", `${r.head}:${path}`).trim();
    expect(files).toEqual([
      { filename: "CLAUDE.md", additions: 1, deletions: 1, patch: gitPatch(r.dir, r.mergeBase, r.head, "CLAUDE.md"), sha: blob("CLAUDE.md") },
      { filename: "img.png", additions: 0, deletions: 0, sha: blob("img.png") },
      { filename: "src/a.ts", additions: 2, deletions: 1, patch: gitPatch(r.dir, r.mergeBase, r.head, "src/a.ts"), sha: blob("src/a.ts") },
      { filename: "src/b.ts", additions: 1, deletions: 0, patch: gitPatch(r.dir, r.mergeBase, r.head, "src/b.ts"), sha: blob("src/b.ts") },
      { filename: "src/new.ts", additions: 0, deletions: 0, previous_filename: "src/old.ts", sha: blob("src/new.ts") },
    ]);
    expect("patch" in files[1]).toBe(false);
    expect("patch" in files[4]).toBe(false);
    expect(files[2].patch).toStartWith("@@ -1,3 +1,4 @@");
    expect(files[2].patch).not.toEndWith("\n");
  });

  test("a removed file has its patch and no sha; a renamed and edited file keeps both names", () => {
    const dir = emptyRepo();
    const base = commit(dir, { "gone.ts": "a\nb\n", "moved.ts": "1\n2\n3\n4\n5\n6\n7\n8\n" }, "base");
    git(dir, "switch", "-q", "-c", "feat/z");
    git(dir, "rm", "-q", "gone.ts");
    git(dir, "mv", "moved.ts", "place.ts");
    const head = commit(dir, { "place.ts": "1\n2\n3\n4\n5\n6\n7\n8\n9\n" }, "remove and move");
    const files = localFiles(dir, base, head);
    expect(files.map((f) => f.filename)).toEqual(["gone.ts", "place.ts"]);
    expect(files[0]).toEqual({ filename: "gone.ts", additions: 0, deletions: 2, patch: "@@ -1,2 +0,0 @@\n-a\n-b" });
    expect(files[1]).toMatchObject({ filename: "place.ts", previous_filename: "moved.ts", additions: 1, deletions: 0 });
    expect(files[1].patch).toStartWith("@@ ");
  });

  test("a patch keeps the no-newline marker and ends without a newline", () => {
    const dir = emptyRepo();
    const base = commit(dir, { "n.txt": "one\ntwo" }, "base");
    git(dir, "switch", "-q", "-c", "feat/n");
    const head = commit(dir, { "n.txt": "one\nthree" }, "edit");
    const [file] = localFiles(dir, base, head);
    expect(file.patch).toBe(gitPatch(dir, base, head, "n.txt"));
    expect(file.patch).toEndWith("\\ No newline at end of file");
  });

  test("a developer's diff settings do not change the patches", () => {
    const r = branchRepo();
    const plain = localFiles(r.dir, r.mergeBase, r.head);
    git(r.dir, "config", "diff.noprefix", "true");
    git(r.dir, "config", "diff.context", "1");
    git(r.dir, "config", "color.diff", "always");
    git(r.dir, "config", "diff.algorithm", "histogram");
    expect(localFiles(r.dir, r.mergeBase, r.head)).toEqual(plain);
  });

  test("names with spaces and non-ASCII characters survive", () => {
    const dir = emptyRepo();
    const base = commit(dir, { "a b/ñandú.md": "x\n" }, "base");
    git(dir, "switch", "-q", "-c", "feat/u");
    const head = commit(dir, { "a b/ñandú.md": "y\n" }, "edit");
    expect(localFiles(dir, base, head).map((f) => [f.filename, f.additions, f.deletions])).toEqual([["a b/ñandú.md", 1, 1]]);
  });
});

describe("splitPatches", () => {
  test("one entry per section, in order; a section without a hunk has no patch", () => {
    const diff = [
      "diff --git a/x b/x",
      "index 1..2 100644",
      "--- a/x",
      "+++ b/x",
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "diff --git a/i.png b/i.png",
      "index 3..4 100644",
      "Binary files a/i.png and b/i.png differ",
      "",
    ].join("\n");
    expect(splitPatches(diff)).toEqual([
      { header: "diff --git a/x b/x", patch: "@@ -1 +1 @@\n-a\n+b" },
      { header: "diff --git a/i.png b/i.png", patch: undefined },
    ]);
  });
});

describe("localInstructions", () => {
  test("instructions come from the merge-base, never the head", () => {
    const r = branchRepo();
    const warnings: string[] = [];
    const instr = localInstructions(r.dir, r.mergeBase, (l) => warnings.push(l));
    expect(instr).toEqual({ baseSha: r.mergeBase, files: [{ path: "CLAUDE.md", content: "RULES-FROM-BASE\n", truncated: false }] });
    expect(warnings).toEqual([]);
  });

  test("the old focus path is read with the deprecation warning, and a long file is cut with the warning", () => {
    const dir = emptyRepo();
    const long = `${"x".repeat(MAX_INSTRUCTION_BYTES)}é and more`;
    const base = commit(dir, { ".github/claude-review.md": "focus\n", "AGENTS.md": long }, "base");
    const warnings: string[] = [];
    const instr = localInstructions(dir, base, (l) => warnings.push(l));
    expect(instr.files.map((f) => [f.path, f.truncated])).toEqual([
      [".github/claude-review.md", false],
      ["AGENTS.md", true],
    ]);
    expect(Buffer.byteLength(instr.files[1].content)).toBe(MAX_INSTRUCTION_BYTES);
    expect(warnings).toEqual([
      ".github/claude-review.md is deprecated; rename it to .github/wachiman.md.",
      "AGENTS.md at the base commit is over 64 KB: cut.",
    ]);
  });

  test("a directory at an instruction path is not an instruction file", () => {
    const dir = emptyRepo();
    const base = commit(dir, { "CLAUDE.md/inner.md": "not a file\n" }, "base");
    expect(localInstructions(dir, base, () => {}).files).toEqual([]);
  });
});

describe("tarCommand", () => {
  test("is plain tar on POSIX systems", () => {
    expect(tarCommand("linux", {}, () => true)).toBe("tar");
    expect(tarCommand("darwin", { SystemRoot: "C:\\Windows" }, () => true)).toBe("tar");
  });

  // GNU tar from Git for Windows reads `C:\x.tar` as a file on a host named `C`; the system's bsdtar does not.
  test("on Windows it is the system's own tar.exe, found through SystemRoot in any case", () => {
    const seen: string[] = [];
    const exists = (path: string) => (seen.push(path), true);
    expect(tarCommand("win32", { SYSTEMROOT: "D:\\Win" }, exists)).toBe(join("D:\\Win", "System32", "tar.exe"));
    expect(seen).toEqual([join("D:\\Win", "System32", "tar.exe")]);
  });

  test("on Windows it falls back to tar on PATH when the system's is missing or SystemRoot is unset", () => {
    expect(tarCommand("win32", { SystemRoot: "C:\\Windows" }, () => false)).toBe("tar");
    expect(tarCommand("win32", {}, () => true)).toBe("tar");
  });
});

describe("snapshotHead", () => {
  test("the snapshot holds the committed head, not the working tree, and git grep works in it", () => {
    const r = branchRepo();
    writeFileSync(join(r.dir, "src/a.ts"), `${A_HEAD}export const uncommitted = true;\n`);
    const snapshot = snapshotHead(r.dir, r.head);
    snapshots.push(snapshot.dir);
    expect(snapshot.dir).toBe(realpathSync(snapshot.dir));
    expect(readFileSync(join(snapshot.dir, "src/a.ts"), "utf8")).toBe(A_HEAD);
    const grep = spawnGit(["grep", "-n", "-F", "-e", "export const d = 4;", "--", "*.ts"], { cwd: snapshot.dir, timeoutMs: 5000 });
    expect(grep.status).toBe(0);
    expect(grep.stdout).toBe("src/a.ts:4:export const d = 4;\n");
    expect(snapshot.missing).toEqual([]);
    expect(snapshot.extra).toEqual([]);
    expect(existsSync(`${snapshot.dir}.tar`)).toBe(false);
    removeSnapshot(snapshot.dir);
    expect(existsSync(snapshot.dir)).toBe(false);
  });

  test("core.autocrlf=true (the Git for Windows default) does not put CRLF into the snapshot", () => {
    const r = branchRepo();
    git(r.dir, "config", "core.autocrlf", "true");
    const snapshot = snapshotHead(r.dir, r.head);
    snapshots.push(snapshot.dir);
    expect(readFileSync(join(snapshot.dir, "src/a.ts"), "utf8")).toBe(A_HEAD);
  });

  test("a text=auto attribute with core.eol=crlf does not put CRLF into the snapshot either", () => {
    const r = branchRepo();
    commit(r.dir, { ".gitattributes": "* text=auto\n" }, "text=auto");
    git(r.dir, "config", "core.eol", "crlf");
    const head = git(r.dir, "rev-parse", "HEAD").trim();
    const snapshot = snapshotHead(r.dir, head);
    snapshots.push(snapshot.dir);
    expect(readFileSync(join(snapshot.dir, "src/a.ts"), "utf8")).toBe(A_HEAD);
  });

  test("export-ignore makes the snapshot differ from ls-tree, and that is a warning", () => {
    const r = branchRepo();
    commit(r.dir, { ".gitattributes": "secret.txt export-ignore\n", "secret.txt": "kept out\n" }, "export-ignore");
    const head = git(r.dir, "rev-parse", "HEAD").trim();
    const snapshot = snapshotHead(r.dir, head);
    snapshots.push(snapshot.dir);
    expect(snapshot.missing).toEqual(["secret.txt"]);
    const warnings: string[] = [];
    const built = buildLocalInput({ repoDir: r.dir, paths: [], log: () => {}, warn: (l) => warnings.push(l) });
    snapshots.push(built.snapshotDir);
    expect(warnings).toContain(
      "The snapshot lacks 1 file(s) that the head commit has (export-ignore in .gitattributes, or a submodule): secret.txt",
    );
  });
});

describe("buildLocalInput", () => {
  test("on Windows a scope typed with backslashes names the same repository path", () => {
    const r = branchRepo();
    const logs: string[] = [];
    const { input, snapshotDir } = buildLocalInput({ repoDir: r.dir, paths: ["src\\a.ts", ".\\src", "nope\\x"], platform: "win32", log: (l) => logs.push(l), warn: () => {} });
    snapshots.push(snapshotDir);
    expect(input.scope).toEqual(["src/a.ts", "src"]);
    expect(logs).toContain("Not paths in this change, ignored: nope/x");
  });

  test("the change, the scope and the cleanup", () => {
    const r = branchRepo();
    const logs: string[] = [];
    const { input, snapshotDir, refs } = buildLocalInput({ repoDir: r.dir, paths: ["src", "nope"], log: (l) => logs.push(l), warn: () => {} });
    snapshots.push(snapshotDir);
    expect(refs.mergeBase).toBe(r.mergeBase);
    expect(input.format).toBe("wachiman.review-input/1");
    expect(input.change).toEqual({
      kind: "branch",
      describe: `branch \`feat/x\` of ${basename(r.dir)} against main (merge-base ${r.mergeBase.slice(0, 7)})`,
      repository: { name: basename(r.dir) },
      base: { sha: r.mergeBase, ref: "main" },
      head: { sha: r.head, ref: "feat/x" },
      title: "feat/x",
      description: r.subjects.join("\n"),
      author: "t",
    });
    expect(input.change.identifier).toBeUndefined();
    expect(input.scope).toEqual(["src"]);
    expect(logs).toContain("Not paths in this change, ignored: nope");
    expect(input.headDir).toBe(snapshotDir);
    expect(input.instructions.baseSha).toBe(r.mergeBase);
    expect(input.files.map((f) => f.filename)).toEqual(["CLAUDE.md", "img.png", "src/a.ts", "src/b.ts", "src/new.ts"]);
    expect(input).not.toHaveProperty("since");
    expect(input).not.toHaveProperty("conversation");
    const schema = JSON.parse(readFileSync(join(import.meta.dir, "../../docs/formats/review-input.v1.schema.json"), "utf8"));
    const { headDir: _, ...onDisk } = input;
    expect(validate(schema, JSON.parse(JSON.stringify(onDisk)))).toEqual([]);
    removeSnapshot(snapshotDir);
    expect(existsSync(snapshotDir)).toBe(false);
  });

  test("a refused HEAD leaves no snapshot behind", () => {
    const r = branchRepo();
    git(r.dir, "switch", "-q", "--detach", "feat/x");
    const before = new Set(readdirSync(tmpdir()));
    expect(() => buildLocalInput({ repoDir: r.dir, paths: [], log: () => {}, warn: () => {} })).toThrow(UsageError);
    const after = readdirSync(tmpdir()).filter(
      (n) => n.startsWith("wachiman-snapshot-") && !before.has(n),
    );
    expect(after).toEqual([]);
  });
});

describe("the commit and from modes", () => {
  const sha7 = (v: string) => v.slice(0, 7);
  const sha = (dir: string, rev: string) => git(dir, "rev-parse", rev).trim();
  const EMPTY_TREE = git(process.cwd(), "hash-object", "-t", "tree", "/dev/null").trim();

  test("a commit: its first parent is the start, depth 1, the branch name only when HEAD is on it", () => {
    const r = branchRepo();
    const parent = sha(r.dir, "HEAD~1");
    expect(resolveRefs(r.dir, undefined, undefined, 50, { commit: "HEAD" })).toEqual({
      baseRef: sha7(parent),
      baseSha: parent,
      mergeBase: parent,
      headRef: "feat/x",
      headSha: r.head,
      depth: 1,
      mode: { kind: "commit", rev: r.head, merge: false },
    });
    const older = resolveRefs(r.dir, undefined, undefined, 50, { commit: parent });
    expect(older.headRef).toBe(sha7(parent));
    expect(older.mergeBase).toBe(r.mergeBase);
  });

  test("a root commit starts at the empty tree; a merge commit at its first parent", () => {
    const r = branchRepo();
    const root = resolveRefs(r.dir, undefined, undefined, 50, { commit: r.mergeBase });
    expect(root.mergeBase).toBe(EMPTY_TREE);
    expect(root.depth).toBe(1);
    git(r.dir, "switch", "-q", "main");
    git(r.dir, "merge", "-q", "--no-ff", "-m", "merge", "feat/x");
    const merge = resolveRefs(r.dir, undefined, undefined, 50, { commit: "HEAD" });
    expect(merge.mergeBase).toBe(r.mainTip);
    expect(merge.mode).toEqual({ kind: "commit", rev: sha(r.dir, "HEAD"), merge: true });
  });

  test("--from: the range is <rev>^..HEAD, checked against the depth", () => {
    const r = branchRepo();
    const first = sha(r.dir, "HEAD~1");
    const refs = resolveRefs(r.dir, undefined, undefined, 50, { from: first });
    expect(refs).toMatchObject({ mergeBase: r.mergeBase, headSha: r.head, headRef: "feat/x", depth: 2, mode: { kind: "from", rev: first } });
    expect(() => resolveRefs(r.dir, undefined, undefined, 1, { from: first })).toThrow(/is 2 commits, more than the maximum depth of 1/);
    expect(resolveRefs(r.dir, undefined, undefined, 50, { from: r.mergeBase }).mergeBase).toBe(EMPTY_TREE);
    expect(() => resolveRefs(r.dir, undefined, undefined, 50, { from: r.mainTip })).toThrow(UsageError);
  });

  test("the files and instructions of a one-commit review come from the start commit", () => {
    const r = branchRepo();
    const built = buildLocalInput({ repoDir: r.dir, commit: "HEAD", paths: [], log: () => {}, warn: () => {} });
    try {
      expect(built.input.files.map((f) => f.filename)).toEqual(["CLAUDE.md", "img.png", "src/new.ts"]);
      expect(built.input.change.base.sha).toBe(sha(r.dir, "HEAD~1"));
      expect(built.input.change.head).toEqual({ sha: r.head, ref: "feat/x" });
      expect(built.input.change.kind).toBe("branch");
      expect(built.input.change.description).toBe("rename old, change the image and the rules");
      expect(built.input.instructions.baseSha).toBe(sha(r.dir, "HEAD~1"));
      expect(JSON.stringify(built.input.instructions.files)).toContain("RULES-FROM-BASE");
    } finally {
      removeSnapshot(built.snapshotDir);
    }
  });

  test("a root commit has no instructions and every file as added", () => {
    const r = branchRepo();
    const built = buildLocalInput({ repoDir: r.dir, commit: r.mergeBase, paths: [], log: () => {}, warn: () => {} });
    try {
      expect(built.input.files.map((f) => f.filename)).toEqual(["CLAUDE.md", "img.png", "src/a.ts", "src/old.ts"]);
      expect(built.input.instructions.files).toEqual([]);
    } finally {
      removeSnapshot(built.snapshotDir);
    }
  });
});
