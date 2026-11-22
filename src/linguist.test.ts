import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { commit, emptyRepo, git, removeTempRepos } from "../test/support/temp-repo";
import { gitSupportsAttrSource, linguistExcluded, parseCheckAttr } from "./linguist";

afterAll(removeTempRepos);

/** A `git` ahead on PATH that records each call's arguments and whether a token reached it, then runs the real git. */
function withGitShim<T>(run: (calls: () => string[]) => T): T {
  const real = Bun.which("git") ?? "git";
  const dir = join(tmpdir(), `wachiman-git-shim-${process.pid}`);
  const logFile = join(dir, "calls.log");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "git"), `#!/bin/sh\necho "token=\${GH_TOKEN:-}\${GITHUB_TOKEN:-}|config=\${GIT_CONFIG_COUNT:-} $*" >> "${logFile}"\nexec "${real}" "$@"\n`);
  chmodSync(join(dir, "git"), 0o755);
  const saved = { PATH: process.env.PATH, GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN };
  process.env.PATH = `${dir}:${saved.PATH ?? ""}`;
  process.env.GH_TOKEN = "secret-token-value";
  process.env.GITHUB_TOKEN = "secret-token-value";
  try {
    return run(() => readFileSync(logFile, "utf8").trim().split("\n"));
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

const BASE_ATTRIBUTES = [
  "gen/** linguist-generated",
  "vendor/** linguist-vendored",
  "keep/** linguist-generated=false",
  "plain/** linguist-vendored=false",
  "",
].join("\n");

/**
 * A base commit whose `.gitattributes` marks `gen/**` generated and `vendor/**` vendored (and
 * switches both marks off for `keep/**` and `plain/**`), and a head that changes a file in each,
 * a normal file, and adds its own `.gitattributes` line marking the normal file generated.
 */
function fixture() {
  const dir = emptyRepo("wachiman-linguist-");
  const files = { "gen/a.js": "1\n", "vendor/b.js": "1\n", "keep/c.js": "1\n", "plain/d.js": "1\n", "src/n.ts": "1\n", "nested/x.txt": "1\n" };
  const base = commit(dir, { ".gitattributes": BASE_ATTRIBUTES, ...files }, "base");
  git(dir, "switch", "-q", "-c", "feat");
  const head = commit(
    dir,
    {
      ".gitattributes": `${BASE_ATTRIBUTES}src/n.ts linguist-generated\nnested/** linguist-vendored\n`,
      "gen/a.js": "2\n",
      "vendor/b.js": "2\n",
      "keep/c.js": "2\n",
      "plain/d.js": "2\n",
      "src/n.ts": "2\n",
      "nested/x.txt": "2\n",
    },
    "head",
  );
  const paths = ["gen/a.js", "vendor/b.js", "keep/c.js", "plain/d.js", "src/n.ts", "nested/x.txt", ".gitattributes"];
  return { dir, base, head, paths };
}

describe("linguist exclusion from the base commit", () => {
  test("AC11: generated and vendored files are excluded", () => {
    const f = fixture();
    const logs: string[] = [];
    const excluded = linguistExcluded(f.paths, { repoDir: f.dir, baseSha: f.base, log: (l) => logs.push(l) });
    expect([...excluded].sort()).toEqual(["gen/a.js", "vendor/b.js"]);
    expect(logs).toEqual(["2 file(s) are marked linguist-generated or linguist-vendored at the base commit and are not reviewed."]);
  });

  test("AC12: marks the head adds for its own files are never read", () => {
    const f = fixture();
    const excluded = linguistExcluded(f.paths, { repoDir: f.dir, baseSha: f.base, log: () => {} });
    expect(excluded.has("src/n.ts")).toBe(false);
    expect(excluded.has("nested/x.txt")).toBe(false);
    // Read from the head instead, the same call would exclude them: the base is what keeps them reviewed.
    const fromHead = linguistExcluded(f.paths, { repoDir: f.dir, baseSha: f.head, log: () => {} });
    expect(fromHead.has("src/n.ts")).toBe(true);
  });

  test("AC16: a local range reads the marks at its merge-base, never fetching", () => {
    const f = fixture();
    const mergeBase = git(f.dir, "merge-base", "main", "feat").trim();
    expect(mergeBase).toBe(f.base);
    const excluded = linguistExcluded(f.paths, { repoDir: f.dir, baseSha: mergeBase, log: () => {} });
    expect([...excluded].sort()).toEqual(["gen/a.js", "vendor/b.js"]);
  });

  test("run from a subdirectory, repository-root-relative paths still match", () => {
    const f = fixture();
    const excluded = linguistExcluded(f.paths, { repoDir: join(f.dir, "src"), baseSha: f.base, log: () => {} });
    expect([...excluded].sort()).toEqual(["gen/a.js", "vendor/b.js"]);
  });

  test("a root-commit range (the empty tree as base) excludes nothing and logs nothing", () => {
    const f = fixture();
    const tree = git(f.dir, "hash-object", "-t", "tree", "/dev/null").trim();
    const logs: string[] = [];
    expect(linguistExcluded(f.paths, { repoDir: f.dir, baseSha: tree, log: (l) => logs.push(l) }).size).toBe(0);
    expect(logs).toEqual([]);
  });

  test("a shallow clone fetches the missing base and a failed fetch is named", () => {
    const f = fixture();
    const clone = join(tmpdir(), `wachiman-linguist-shallow-${process.pid}`);
    rmSync(clone, { recursive: true, force: true });
    git(f.dir, "config", "uploadpack.allowAnySHA1InWant", "true");
    git(tmpdir(), "clone", "-q", "--depth=1", `file://${f.dir}`, clone);
    try {
      const logs: string[] = [];
      const missingBase = { repoDir: clone, baseSha: f.base, log: (l: string) => logs.push(l) };
      expect(linguistExcluded(f.paths, missingBase).size).toBe(0);
      const excluded = linguistExcluded(f.paths, { ...missingBase, fetchMissingBase: true });
      expect([...excluded].sort()).toEqual(["gen/a.js", "vendor/b.js"]);
      const failed = linguistExcluded(f.paths, { repoDir: clone, baseSha: "2".repeat(40), fetchMissingBase: true, log: (l) => logs.push(l) });
      expect(failed.size).toBe(0);
      expect(logs.at(-1)).toMatch(/fetching it failed: \S/);
    } finally {
      rmSync(clone, { recursive: true, force: true });
    }
  });

  test("a shallow clone fetches the base once, one check-attr answers, and no git receives the run token", () => {
    const f = fixture();
    const clone = join(tmpdir(), `wachiman-linguist-token-${process.pid}`);
    rmSync(clone, { recursive: true, force: true });
    git(f.dir, "config", "uploadpack.allowAnySHA1InWant", "true");
    git(tmpdir(), "clone", "-q", "--depth=1", `file://${f.dir}`, clone);
    try {
      withGitShim((calls) => {
        const excluded = linguistExcluded(f.paths, { repoDir: clone, baseSha: f.base, fetchMissingBase: true, log: () => {} });
        expect([...excluded].sort()).toEqual(["gen/a.js", "vendor/b.js"]);
        const all = calls();
        expect(all.filter((c) => c.includes(" fetch ")).length).toBe(1);
        expect(all.filter((c) => c.includes(" check-attr ")).length).toBe(1);
        expect(all.every((c) => c.startsWith("token=|config= "))).toBe(true);
      });
    } finally {
      rmSync(clone, { recursive: true, force: true });
    }
  });

  test("a failed fetch names a reason", () => {
    const f = fixture();
    const clone = join(tmpdir(), `wachiman-linguist-nofetch-${process.pid}`);
    rmSync(clone, { recursive: true, force: true });
    git(tmpdir(), "clone", "-q", "--depth=1", `file://${f.dir}`, clone);
    try {
      git(clone, "remote", "set-url", "origin", join(tmpdir(), "wachiman-no-such-remote"));
      const logs: string[] = [];
      linguistExcluded(f.paths, { repoDir: clone, baseSha: f.base, fetchMissingBase: true, log: (l) => logs.push(l) });
      expect(logs.at(-1)).toMatch(/fetching it failed: \S/);
    } finally {
      rmSync(clone, { recursive: true, force: true });
    }
  });

  test("a base commit that is not in the clone excludes nothing and logs one line", () => {
    const f = fixture();
    const logs: string[] = [];
    const excluded = linguistExcluded(f.paths, { repoDir: f.dir, baseSha: "1".repeat(40), log: (l) => logs.push(l) });
    expect(excluded.size).toBe(0);
    expect(logs).toEqual([`linguist-generated and linguist-vendored are not applied: the base commit ${"1".repeat(7)} is not in the clone.`]);
  });

  test("paths with spaces, newlines-free odd characters and no paths at all", () => {
    const dir = emptyRepo("wachiman-linguist-odd-");
    const base = commit(dir, { ".gitattributes": "gen/** linguist-generated\n", "gen/a b.js": "1\n", "gen/[x].js": "1\n" }, "base");
    expect([...linguistExcluded(["gen/a b.js", "gen/[x].js", "z"], { repoDir: dir, baseSha: base, log: () => {} })].sort()).toEqual(["gen/[x].js", "gen/a b.js"]);
    expect(linguistExcluded([], { repoDir: dir, baseSha: base, log: () => {} }).size).toBe(0);
  });
});

describe("helpers", () => {
  test("git older than 2.40 has no check-attr --source", () => {
    expect(gitSupportsAttrSource("git version 2.39.5")).toBe(false);
    expect(gitSupportsAttrSource("git version 2.40.0")).toBe(true);
    expect(gitSupportsAttrSource("git version 2.54.0 (Apple Git-157)")).toBe(true);
    expect(gitSupportsAttrSource("git version 3.0.0")).toBe(true);
    expect(gitSupportsAttrSource("not git")).toBe(false);
  });

  test("check-attr output: set and true count; false, unset and unspecified do not", () => {
    const out = ["a", "linguist-generated", "set", "a", "linguist-vendored", "unspecified", "b", "linguist-generated", "true", "c", "linguist-generated", "false", "d", "linguist-vendored", "unset", ""].join("\0");
    expect([...parseCheckAttr(out)].sort()).toEqual(["a", "b"]);
  });
});
