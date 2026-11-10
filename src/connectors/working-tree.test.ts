import { afterAll, expect, test } from "bun:test";
import { readFileSync, writeFileSync, existsSync, readdirSync, symlinkSync, mkdirSync, statSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { emptyRepo, commit, git, removeTempRepos } from "../../test/support/temp-repo";
import { workingTreeInput } from "./working-tree";
afterAll(removeTempRepos);
function fixture() {
  const dir = emptyRepo();
  writeFileSync(join(dir, "a.ts"), "base\n");
  commit(dir, {}, "base");
  writeFileSync(join(dir, "a.ts"), "staged\n");
  git(dir, "add", "a.ts");
  writeFileSync(join(dir, "a.ts"), "unstaged\n");
  writeFileSync(join(dir, "untracked.ts"), "secret\n");
  return dir;
}
function capture(dir: string, mode: "staged" | "all", extra = {}) {
  return workingTreeInput({
    repoDir: dir,
    mode,
    paths: [],
    log: () => {},
    warn: () => {},
    ...extra,
  });
}
test("staged and all freeze tracked bytes without changing the real index or objects", () => {
  const dir = fixture();
  const index = readFileSync(join(dir, ".git/index"));
  const objectBytes = () =>
    JSON.stringify(
      readdirSync(join(dir, ".git/objects"), { recursive: true }).map((name) => {
        const path = join(dir, ".git/objects", String(name));
        return [name, statSync(path).isFile() ? readFileSync(path).toString("hex") : null];
      }),
    );
  const objects = objectBytes();
  for (const mode of ["staged", "all"] as const) {
    const built = capture(dir, mode);
    try {
      expect(readFileSync(join(built.input.headDir, "a.ts"), "utf8")).toBe(mode === "staged" ? "staged\n" : "unstaged\n");
      expect(existsSync(join(built.input.headDir, "untracked.ts"))).toBe(false);
      expect(built.input.change.kind).toBe("working-tree");
      expect(built.input.files.map((f) => f.filename)).toEqual(["a.ts"]);
      expect(readFileSync(join(dir, "a.ts"), "utf8")).toBe("unstaged\n");
      expect(readFileSync(join(dir, "untracked.ts"), "utf8")).toBe("secret\n");
      writeFileSync(join(dir, "a.ts"), "later\n");
      expect(readFileSync(join(built.input.headDir, "a.ts"), "utf8")).not.toBe("later\n");
    } finally {
      built.release();
    }
    writeFileSync(join(dir, "a.ts"), "unstaged\n");
  }
  expect(readFileSync(join(dir, ".git/index")).equals(index)).toBe(true);
  expect(objectBytes()).toBe(objects);
});
test("rejects an index or tracked-content race and cleans up", () => {
  const dir = fixture();
  expect(() =>
    capture(dir, "all", {
      afterCapture: () => writeFileSync(join(dir, "a.ts"), "raced\n"),
    }),
  ).toThrow(/changed.*retry/i);
  expect(() => capture(dir, "staged", { afterCapture: () => git(dir, "add", "a.ts") })).toThrow(/changed.*retry/i);
});
test("rejects unborn and split indexes explicitly", () => {
  expect(() => capture(emptyRepo(), "all")).toThrow(/HEAD/);
  const dir = fixture();
  git(dir, "update-index", "--split-index");
  expect(() => capture(dir, "staged")).toThrow(/split.index/i);
});
test("symlinks become link text and parent links are never traversed", () => {
  const dir = fixture();
  symlinkSync("/etc/passwd", join(dir, "link"));
  git(dir, "add", "link");
  const b = capture(dir, "all");
  try {
    expect(readFileSync(join(b.input.headDir, "link"), "utf8")).toBe("/etc/passwd");
  } finally {
    b.release();
  }
  mkdirSync(join(dir, "nested"));
  writeFileSync(join(dir, "nested/file"), "x");
  git(dir, "add", "nested/file");
  git(dir, "commit", "-qm", "nested");
  git(dir, "rm", "-rf", "nested");
  symlinkSync("/etc", join(dir, "nested")); // a tracked parent replaced by a link
  git(dir, "reset", "HEAD", "nested/file");
  expect(() => capture(dir, "all")).toThrow(/symlink|directory/i);
});
test("configured filters, hooks, fsmonitor and external diff are never executed", () => {
  const dir = fixture();
  const marker = join(dir, "EXECUTED");
  const command = `touch '${marker}'`;
  writeFileSync(join(dir, ".gitattributes"), "* filter=evil diff=evil\n");
  git(dir, "add", ".gitattributes");
  git(dir, "config", "filter.evil.clean", command);
  git(dir, "config", "filter.evil.smudge", command);
  git(dir, "config", "diff.evil.command", command);
  git(dir, "config", "core.fsmonitor", command);
  git(dir, "config", "core.hooksPath", dir);
  writeFileSync(join(dir, "post-index-change"), "#!/bin/sh\n" + command);
  chmodSync(join(dir, "post-index-change"), 0o755);
  for (const mode of ["staged", "all"] as const) {
    const b = capture(dir, mode);
    b.release();
    expect(existsSync(marker)).toBe(false);
  }
});
test("index conflicts are refused without changing the conflict index", () => {
  const dir = fixture();
  git(dir, "reset", "--hard", "HEAD");
  git(dir, "checkout", "-b", "other");
  writeFileSync(join(dir, "a.ts"), "other\n");
  commit(dir, {}, "other");
  git(dir, "checkout", "main");
  writeFileSync(join(dir, "a.ts"), "main\n");
  commit(dir, {}, "main");
  try {
    git(dir, "merge", "other");
  } catch {}
  const before = readFileSync(join(dir, ".git/index"));
  expect(() => capture(dir, "all")).toThrow(/unmerged/);
  expect(readFileSync(join(dir, ".git/index")).equals(before)).toBe(true);
});
test("tracked deletions, binary bytes and staged additions are captured; ignored and untracked stay out", () => {
  const dir = fixture();
  writeFileSync(join(dir, "binary"), Buffer.from([0, 255, 10]));
  git(dir, "add", "binary");
  writeFileSync(join(dir, ".gitignore"), "ignored\n");
  writeFileSync(join(dir, "ignored"), "private");
  git(dir, "rm", "-f", "a.ts");
  const b = capture(dir, "all");
  try {
    expect(existsSync(join(b.input.headDir, "a.ts"))).toBe(false);
    expect(readFileSync(join(b.input.headDir, "binary"))).toEqual(Buffer.from([0, 255, 10]));
    expect(b.input.files.map((f) => f.filename)).toEqual(["a.ts", "binary"]);
  } finally {
    b.release();
  }
});

test("history matches working-tree findings and never asks ancestry about ephemeral trees, even in a later committed run", async () => {
  const { saveRun } = await import("../history");
  const { readRuns, repositoryKey } = await import("../history/store");
  const { spawnGit } = await import("../evidence");
  const dir = fixture();
  const root = join(dir, ".history");
  let tick = 0;
  const ancestry: string[][] = [];
  const runner: typeof spawnGit = (args, opts) => {
    if (args[0] === "merge-base") {
      ancestry.push(args);
      throw new Error("Tree ancestry must not run");
    }
    return spawnGit(args, opts);
  };
  const template = JSON.parse(readFileSync(join(import.meta.dir, "../../test/fixtures/formats/review-result.v2.example.json"), "utf8"));
  function save(findings: boolean, committed = false) {
    const b = capture(dir, "all");
    try {
      const result = {
        ...template,
        change: committed
          ? { ...b.input.change, kind: "branch", head: { sha: b.input.change.base.sha }, workingTree: undefined }
          : b.input.change,
        findings: findings ? [{ ...template.findings[0], path: "a.ts", line: 1, title: "same finding" }] : [],
        coverage: { ...template.coverage, expected: ["a.ts"], reviewed: ["a.ts"] },
      };
      return saveRun({
        root,
        repoDir: dir,
        input: b.input,
        result,
        engineVersion: "test",
        days: 30,
        warn: () => {},
        git: runner,
        now: () => new Date(Date.UTC(2026, 10, 10, 0, 0, tick++)),
      });
    } finally {
      b.release();
    }
  }
  expect(save(true).byIndex.get(0)?.status).toBe("new");
  expect(save(true).byIndex.get(0)?.status).toBe("open");
  expect(save(false, true).unknown).toBe(1);
  expect(ancestry).toEqual([]);
  const runs = readRuns(root, repositoryKey(dir).key, () => {});
  expect(runs[0].result.change.kind).toBe("working-tree");
  expect(runs[0].result.change.workingTree?.mode).toBe("all");
});

test("linked worktrees use their own index, and paths scope only the selected local changes", () => {
  const dir = fixture();
  git(dir, "reset", "--hard", "HEAD");
  const linked = dir + "-linked";
  try {
    git(dir, "worktree", "add", "-b", "linked", linked);
    writeFileSync(join(linked, "a.ts"), "linked edit\n");
    const b = workingTreeInput({ repoDir: linked, mode: "all", paths: ["a.ts"], log: () => {}, warn: () => {} });
    try {
      expect(b.input.scope).toEqual(["a.ts"]);
      expect(readFileSync(join(b.input.headDir, "a.ts"), "utf8")).toBe("linked edit\n");
      expect(readFileSync(join(dir, "a.ts"), "utf8")).toBe("base\n");
    } finally {
      b.release();
    }
  } finally {
    git(dir, "worktree", "remove", "--force", linked);
  }
});
test("gitlinks and sparse/skip-worktree entries are refused without executing submodules", () => {
  const dir = fixture();
  git(dir, "update-index", "--skip-worktree", "a.ts");
  expect(() => capture(dir, "all")).toThrow(/sparse|skip-worktree/);
  git(dir, "update-index", "--no-skip-worktree", "a.ts");
  const head = git(dir, "rev-parse", "HEAD").trim();
  git(dir, "update-index", "--add", "--cacheinfo", "160000", head, "module");
  expect(() => capture(dir, "all")).toThrow(/gitlink/);
});

test("all freezes every tracked identity before reading content, so a later file cannot slip into the snapshot", () => {
  const dir = fixture();
  writeFileSync(join(dir, "z.ts"), "initial\n");
  git(dir, "add", "z.ts");
  expect(() => capture(dir, "all", { afterManifest: () => writeFileSync(join(dir, "z.ts"), "changed before content read\n") })).toThrow(
    /changed.*retry/i,
  );
});
