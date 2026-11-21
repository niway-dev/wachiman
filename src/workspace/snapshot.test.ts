import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commit, emptyRepo, git, removeTempRepos, write } from "../../test/support/temp-repo";
import { snapshotSibling, type SiblingSnapshot } from "./snapshot";

const made: SiblingSnapshot[] = [];
const parents: string[] = [];
/** How many `wachiman-sibling-*` folders the temp dir holds: snapshots and the test repositories share the prefix. */
const siblingFolders = () => readdirSync(tmpdir()).filter((name) => name.startsWith("wachiman-sibling-")).length;
afterAll(() => {
  removeTempRepos();
  for (const dir of parents) rmSync(dir, { recursive: true, force: true });
  for (const s of made) s.remove();
});
const snap = (...args: Parameters<typeof snapshotSibling>) => {
  const s = snapshotSibling(...args);
  made.push(s);
  return s;
};

/** A repository with a mix of tracked, symlinked and untracked files. */
function sibling() {
  const dir = emptyRepo("wachiman-sibling-src-");
  const sha = commit(
    dir,
    {
      "src/routes/invoices.ts": "export const route = 1;\n",
      "src/routes/deep/more.ts": "export const more = 1;\n",
      "src/other/private.ts": "outside the globs\n",
      "docs/billing-api.md": "# API\n",
      "README.md": "readme\n",
    },
    "tracked",
  );
  symlinkSync("/etc/hosts", join(dir, "src/routes/escape.ts"));
  symlinkSync("../other/private.ts", join(dir, "src/routes/inside-link.ts"));
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "links");
  const head = git(dir, "rev-parse", "HEAD").trim();
  write(dir, { "src/routes/untracked.ts": "never committed\n" });
  write(dir, { "src/routes/invoices.ts": "export const route = 'edited, uncommitted';\n" });
  return { dir, sha, head };
}

const files = (root: string, base = ""): string[] =>
  readdirSync(join(root, base), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(root, join(base, e.name)) : [join(base, e.name)]));

describe("snapshotSibling", () => {
  test("holds the committed bytes of the selected tracked files and nothing else", () => {
    const { dir, head } = sibling();
    const s = snap(dir, head, ["src/routes/**", "docs/billing-api.md"]);
    expect(s.paths.sort()).toEqual(["docs/billing-api.md", "src/routes/deep/more.ts", "src/routes/invoices.ts"]);
    expect(files(s.dir).sort()).toEqual(s.paths.slice().sort());
    expect(readFileSync(join(s.dir, "src/routes/invoices.ts"), "utf8")).toBe("export const route = 1;\n");
  });

  test("excludes untracked files, files outside the globs, and .git", () => {
    const { dir, head } = sibling();
    const s = snap(dir, head, ["src/routes/**"]);
    expect(existsSync(join(s.dir, "src/routes/untracked.ts"))).toBe(false);
    expect(existsSync(join(s.dir, "src/other"))).toBe(false);
    expect(existsSync(join(s.dir, "docs"))).toBe(false);
    expect(existsSync(join(s.dir, ".git"))).toBe(false);
    expect(files(s.dir).some((f) => f.startsWith(".git"))).toBe(false);
  });

  test("a whole-tree glob still has no .git", () => {
    const { dir, head } = sibling();
    const s = snap(dir, head, ["**"]);
    expect(s.paths).toContain("README.md");
    expect(existsSync(join(s.dir, ".git"))).toBe(false);
  });

  test("symbolic links are dropped and listed, including one that escapes the tree", () => {
    const { dir, head } = sibling();
    const s = snap(dir, head, ["src/routes/**"]);
    expect(s.droppedSymlinks.sort()).toEqual(["src/routes/escape.ts", "src/routes/inside-link.ts"]);
    expect(existsSync(join(s.dir, "src/routes/escape.ts"))).toBe(false);
    expect(files(s.dir).every((f) => !lstatSync(join(s.dir, f)).isSymbolicLink())).toBe(true);
    expect(s.paths).not.toContain("src/routes/escape.ts");
  });

  test("a submodule is dropped and listed apart from the symlinks", () => {
    const dir = emptyRepo("wachiman-sibling-sub-");
    const first = commit(dir, { "vendor/readme.md": "r\n" }, "first");
    git(dir, "update-index", "--add", "--cacheinfo", `160000,${first},vendor/lib`);
    git(dir, "commit", "-qm", "gitlink");
    const head = git(dir, "rev-parse", "HEAD").trim();
    const s = snap(dir, head, ["vendor/**"]);
    expect(s.paths).toEqual(["vendor/readme.md"]);
    expect(s.droppedSubmodules).toEqual(["vendor/lib"]);
    expect(s.droppedSymlinks).toEqual([]);
  });

  test("a symlink outside the globs is not listed", () => {
    const { dir, head } = sibling();
    expect(snap(dir, head, ["docs/**"]).droppedSymlinks).toEqual([]);
  });

  test("reads the given commit, not the sibling's HEAD", () => {
    const { dir, sha, head } = sibling();
    commit(dir, { "src/routes/invoices.ts": "export const route = 2;\n" }, "later");
    expect(readFileSync(join(snap(dir, head, ["src/**"]).dir, "src/routes/invoices.ts"), "utf8")).toBe("export const route = 1;\n");
    expect(sha).not.toBe(head);
  });

  test("an empty selection is an empty directory and no paths", () => {
    const { dir, head } = sibling();
    const s = snap(dir, head, ["nothing/**"]);
    expect(s.paths).toEqual([]);
    expect(s.droppedSymlinks).toEqual([]);
    expect(existsSync(s.dir)).toBe(true);
    expect(readdirSync(s.dir)).toEqual([]);
    expect(snap(dir, head, []).paths).toEqual([]);
  });

  test("a file named like a pathspec is taken literally", () => {
    const dir = emptyRepo("wachiman-sibling-literal-");
    commit(dir, { "a.ts": "a\n", "weird/*.ts": "star\n", "weird/:(top)x": "magic\n" }, "weird names");
    const head = git(dir, "rev-parse", "HEAD").trim();
    const s = snap(dir, head, ["weird/**"]);
    expect(s.paths.sort()).toEqual(["weird/*.ts", "weird/:(top)x"]);
    expect(existsSync(join(s.dir, "a.ts"))).toBe(false);
  });

  test("a large selection (700 files) is written in full", () => {
    const dir = emptyRepo("wachiman-sibling-many-");
    const many: Record<string, string> = {};
    for (let i = 0; i < 700; i++) many[`generated/some/rather/long/directory/name/for/testing/file-number-${i}.txt`] = `${i}\n`;
    commit(dir, many, "many");
    const head = git(dir, "rev-parse", "HEAD").trim();
    const s = snap(dir, head, ["generated/**"]);
    expect(s.paths).toHaveLength(700);
    expect(files(s.dir)).toHaveLength(700);
  });

  test("export-ignore and export-subst, in the tree or in .git/info/attributes, do not change the committed blobs", () => {
    const dir = emptyRepo("wachiman-sibling-attrs-");
    commit(
      dir,
      { ".gitattributes": "secret.txt export-ignore\nstamp.txt export-subst\n", "secret.txt": "s\n", "keep.txt": "k\n", "stamp.txt": "version $Format:%H$\n", "local.txt": "l\n" },
      "attrs",
    );
    write(dir, { ".git/info/attributes": "local.txt export-ignore\n" });
    const head = git(dir, "rev-parse", "HEAD").trim();
    const s = snap(dir, head, ["**"]);
    expect(s.paths.sort()).toEqual([".gitattributes", "keep.txt", "local.txt", "secret.txt", "stamp.txt"]);
    expect(readFileSync(join(s.dir, "stamp.txt"), "utf8")).toBe("version $Format:%H$\n");
    expect(readFileSync(join(s.dir, "local.txt"), "utf8")).toBe("l\n");
  });

  test("the executable bit is kept and other files are not executable", () => {
    const dir = emptyRepo("wachiman-sibling-exec-");
    write(dir, { "bin/run.sh": "#!/bin/sh\n", "bin/data.txt": "d\n" });
    chmodSync(join(dir, "bin/run.sh"), 0o755);
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "exec");
    const head = git(dir, "rev-parse", "HEAD").trim();
    const s = snap(dir, head, ["bin/**"]);
    expect(statSync(join(s.dir, "bin/run.sh")).mode & 0o111).not.toBe(0);
    expect(statSync(join(s.dir, "bin/data.txt")).mode & 0o111).toBe(0);
  });

  test("an entry path with a .. segment is refused", () => {
    const dir = emptyRepo("wachiman-sibling-dotdot-");
    const first = commit(dir, { "a.txt": "a\n" }, "first");
    const blob = git(dir, "rev-parse", `${first}:a.txt`).trim();
    // A tree whose entry is named "..": git writes it with `hash-object` and no fsck.
    const bad = spawnSync("git", ["hash-object", "-w", "-t", "tree", "--literally", "--stdin"], { cwd: dir, input: Buffer.concat([Buffer.from("100644 ..\0"), Buffer.from(blob, "hex")]), encoding: "utf8" }).stdout.trim();
    const commitId = git(dir, "commit-tree", bad, "-m", "dotdot").trim();
    expect(() => snapshotSibling(dir, commitId, ["**"])).toThrow(/Refusing the tree entry "\.\."/);
  });

  test("a commit that does not exist, or a name that is not a full id, is an error and leaves no directory", () => {
    const { dir } = sibling();
    const before = siblingFolders();
    expect(() => snapshotSibling(dir, "0".repeat(40), ["**"])).toThrow(/ls-tree/);
    expect(() => snapshotSibling(dir, "HEAD", ["**"])).toThrow(/full commit id/);
    expect(() => snapshotSibling(dir, "--all", ["**"])).toThrow(/full commit id/);
    expect(siblingFolders()).toBe(before);
  });

  test("remove deletes the directory", () => {
    const { dir, head } = sibling();
    const s = snapshotSibling(dir, head, ["**"]);
    s.remove();
    expect(existsSync(s.dir)).toBe(false);
  });

  test("the sibling's own clone is not modified", () => {
    const { dir, head } = sibling();
    const before = git(dir, "status", "--porcelain");
    snap(dir, head, ["**"]);
    expect(git(dir, "status", "--porcelain")).toBe(before);
  });

  test("a blob a partial clone never downloaded fails the snapshot with the missing-object error, and nothing is fetched", () => {
    const origin = emptyRepo("wachiman-sibling-origin-");
    git(origin, "config", "uploadpack.allowFilter", "true");
    git(origin, "config", "uploadpack.allowAnySHA1InWant", "true");
    const sha = commit(origin, { "src/a.ts": "a\n" }, "one");
    const parent = mkdtempSync(join(tmpdir(), "wachiman-sibling-partial-"));
    parents.push(parent);
    const clone = join(parent, "clone");
    const run = spawnSync("git", ["clone", "-q", "--no-checkout", "--filter=blob:none", `file://${origin}`, clone], { encoding: "utf8" });
    expect(run.status).toBe(0);
    // The origin is gone: any attempt to fetch the blob would fail with a transport error, not the missing-object one.
    renameSync(origin, `${origin}.gone`);
    const before = siblingFolders();
    try {
      expect(() => snapshotSibling(clone, sha, ["src/**"])).toThrow(/object not present locally; Wachiman never fetches/);
      expect(siblingFolders()).toBe(before);
    } finally {
      renameSync(`${origin}.gone`, origin);
    }
  });
});
