import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { commit, emptyRepo, git, removeTempRepos, write } from "../../test/support/temp-repo";
import { snapshotSibling, type SiblingSnapshot } from "./snapshot";

const made: SiblingSnapshot[] = [];
afterAll(() => {
  removeTempRepos();
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

  test("a large selection is archived in several command lines", () => {
    const dir = emptyRepo("wachiman-sibling-many-");
    const many: Record<string, string> = {};
    for (let i = 0; i < 700; i++) many[`generated/some/rather/long/directory/name/for/testing/file-number-${i}.txt`] = `${i}\n`;
    commit(dir, many, "many");
    const head = git(dir, "rev-parse", "HEAD").trim();
    const s = snap(dir, head, ["generated/**"]);
    expect(s.paths).toHaveLength(700);
    expect(files(s.dir)).toHaveLength(700);
  });

  test("export-ignore in the sibling's attributes leaves the file out of paths", () => {
    const dir = emptyRepo("wachiman-sibling-ignore-");
    commit(dir, { ".gitattributes": "secret.txt export-ignore\n", "secret.txt": "s\n", "keep.txt": "k\n" }, "attrs");
    const head = git(dir, "rev-parse", "HEAD").trim();
    expect(snap(dir, head, ["**"]).paths.sort()).toEqual([".gitattributes", "keep.txt"]);
  });

  test("a commit that does not exist, or a name that is not a full id, is an error and leaves no directory", () => {
    const { dir, head } = sibling();
    expect(() => snapshotSibling(dir, "0".repeat(40), ["**"])).toThrow(/ls-tree/);
    expect(() => snapshotSibling(dir, "HEAD", ["**"])).toThrow(/full commit id/);
    expect(() => snapshotSibling(dir, "--all", ["**"])).toThrow(/full commit id/);
    expect(head).toHaveLength(40);
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
});
