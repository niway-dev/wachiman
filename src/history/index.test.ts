import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReviewInput, ReviewResult } from "../engine";
import { commit, emptyRepo, git, removeTempRepos } from "../../test/support/temp-repo";
import { historyRoot, saveRun } from "./index";
import { readRuns, repositoryKey } from "./store";

const temps: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  removeTempRepos();
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const BAD = "const total = items[i + 1].price;";

/** Reviews the repository's current HEAD, whose `src/a.ts` is `content`, reporting `findings` (titles at line 2). */
function review(home: string, repo: string, content: string, findings: string[]) {
  const sha = git(repo, "rev-parse", "HEAD").trim();
  const headDir = temp("wachiman-hist-snap-");
  mkdirSync(join(headDir, "src"));
  writeFileSync(join(headDir, "src/a.ts"), content);
  const result = {
    format: "wachiman.review-result/1",
    change: { head: { sha } },
    coverage: { reviewed: ["src/a.ts"], expected: ["src/a.ts"], skipped: [] },
    findings: findings.map((title) => ({ path: "src/a.ts", line: 2, title, topic: "bug", severity: "fix", body: "b" })),
  } as unknown as ReviewResult;
  const input = { files: [{ filename: "src/a.ts", sha: "blob", additions: 1, deletions: 0 }], headDir } as unknown as ReviewInput;
  const warnings: string[] = [];
  saveRun({ root: historyRoot(home), repoDir: repo, input, result, engineVersion: "0", days: 30, warn: (l) => warnings.push(l) });
  return readRuns(historyRoot(home), repositoryKey(repo).key, () => {}).at(-1)!;
}

describe("saveRun across branches", () => {
  test("a finding from branch A is not settled by a review of branch B, which does not contain A's head", () => {
    const home = temp("wachiman-hist-home-");
    const repo = emptyRepo();
    git(repo, "remote", "add", "origin", "https://github.com/o/branches.git");
    const clean = "export function f() {\n  return 1;\n}\n";
    const bad = `export function f() {\n  ${BAD}\n}\n`;
    commit(repo, { "src/a.ts": clean }, "base");
    git(repo, "switch", "-q", "-c", "branch-a");
    commit(repo, { "src/a.ts": bad }, "a");
    review(home, repo, bad, ["Reads one past the end"]);

    git(repo, "switch", "-q", "main");
    git(repo, "switch", "-q", "-c", "branch-b");
    commit(repo, { "src/other.ts": "export {};\n" }, "b");
    const onB = review(home, repo, clean, []);
    expect(onB.settled).toEqual([]);
    expect(onB.unknown).toBe(1);

    // On the branch the finding came from, a later clean review still settles it.
    git(repo, "switch", "-q", "branch-a");
    commit(repo, { "src/a.ts": clean }, "fix");
    const fixed = review(home, repo, clean, []);
    expect(fixed.settled.map((s) => s.status)).toEqual(["probably-fixed"]);
  });
});
