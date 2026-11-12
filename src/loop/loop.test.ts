/**
 * `wachiman loop` through the real entry point, on a temporary branch and a fake `claude` that
 * answers each review call from a file the test wrote: no model, no network, no GitHub. The stop rule
 * has its own pure tests in `stop-rule.test.ts`.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageError } from "../config";
import { A_HEAD, branchRepo, commit, git, removeTempRepos, type BranchRepo } from "../../test/support/temp-repo";
import { wachimanHome } from "../accounts/config";
import { historyRoot, repositoryKey, writeLoopFile } from "../history/store";
import { parseLoopArgs, runLoop } from "./command";
import { readLoop } from "./state";

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

const cli = join(import.meta.dir, "..", "cli.ts");
const BRANCH_FILES = ["CLAUDE.md", "img.png", "src/a.ts", "src/b.ts", "src/new.ts"];
const BLOCKER = { path: "src/a.ts", line: 2, severity: "blocker", topic: "bug", confidence: "high", title: "Off by ten", body: "b is 20, not 2." };

/** The Claude Code answer for one review call. */
const answer = (files: string[], findings: object[]) =>
  JSON.stringify({
    is_error: false,
    subtype: "success",
    num_turns: 2,
    total_cost_usd: 0.01,
    duration_ms: 10,
    structured_output: { files_reviewed: files, files_skipped: [], findings, contracts: [], thread_replies: [], summary: "ok" },
  });

// The fixed text of a file with one line changed, to commit as a fix.
const A_FIXED_LINE2 = A_HEAD.replace("export const b = 20;", "export const b = 21;");
const A_FIXED_LINE4 = A_HEAD.replace("export const d = 4;", "export const d = 5;");

/**
 * A branch repository, a temporary home and a `claude` whose n-th review call prints
 * `answers/<n>.json`; a call with no such file fails the way a crashed `claude` does.
 */
function scenario() {
  const repo: BranchRepo = branchRepo();
  const home = temp("wachiman-loop-home-");
  const bin = temp("wachiman-loop-bin-");
  const state = join(bin, "state");
  writeFileSync(join(bin, "gh"), `#!/bin/sh\necho called >> "${bin}/gh-called"\nexit 99\n`);
  writeFileSync(
    join(bin, "claude"),
    `#!/bin/sh
if [ "$1" = "auth" ]; then
  printf '{"loggedIn":true,"authMethod":"claude.ai","configDirectory":"%s"}\\n' "$CLAUDE_CONFIG_DIR"; exit 0
fi
if [ "$1" = "--version" ]; then echo "9.9.9 (Claude Code)"; exit 0; fi
n=$(cat "${state}.count" 2>/dev/null || echo 0); n=$((n + 1)); echo $n > "${state}.count"
cat > "${state}.prompt.$n"
if [ -f "${state}.answer.$n" ]; then cat "${state}.answer.$n"; exit 0; fi
echo 'no answer scripted'; exit 3
`,
  );
  chmodSync(join(bin, "gh"), 0o755);
  chmodSync(join(bin, "claude"), 0o755);
  const env: Record<string, string> = { PATH: `${bin}:${process.env.PATH ?? ""}`, HOME: home, USER: "dev", AGENT_REVIEW_VERIFY: "0" };
  const run = (args: string[]) => {
    const out = Bun.spawnSync([process.execPath, cli, ...args, ...(args[0] === "history" || args[0] === "loop" ? ["--repo-dir", repo.dir] : [])], { env, stdin: "ignore" });
    return { code: out.exitCode, stdout: out.stdout.toString(), stderr: out.stderr.toString() };
  };
  return {
    repo,
    bin,
    home,
    /** Script the answer of the n-th review call. */
    script: (n: number, files: string[], findings: object[]) => writeFileSync(`${state}.answer.${n}`, answer(files, findings)),
    calls: () => (existsSync(`${state}.count`) ? Number(readFileSync(`${state}.count`, "utf8")) : 0),
    prompt: (n: number) => readFileSync(`${state}.prompt.${n}`, "utf8"),
    loop: (...args: string[]) => run(["loop", ...args]),
    history: (...args: string[]) => run(["history", ...args]),
    /** A review outside the loop that is saved to the same history. */
    local: (...args: string[]) => run(["local", "--repo-dir", repo.dir, "--history", ...args]),
    ghCalled: () => existsSync(join(bin, "gh-called")),
    /** The id the history lists for the one finding it tracks. */
    historyIds: () =>
      (JSON.parse(run(["history", "--json"]).stdout).repositories[0]?.findings ?? []).map((f: { id: string }) => f.id) as string[],
  };
}

const idIn = (text: string) => text.match(/\(id ([0-9a-f]{10})\)/)?.[1];

describe("wachiman loop", () => {
  test("--base on a branch with a seeded Blocker exits 10 and prints the open finding with its id", () => {
    const s = scenario();
    s.script(1, BRANCH_FILES, [BLOCKER]);
    const r = s.loop("--base", "main");
    expect(r.code).toBe(10);
    expect(r.stdout).toContain("round 1 of 3");
    expect(r.stdout).toContain("Keeps the loop open (1):");
    expect(r.stdout).toMatch(/🔴 Blocker · bug {2}src\/a\.ts:2 {2}Off by ten {2}\(id [0-9a-f]{10}\)/);
    expect(idIn(r.stdout)).toBe(s.historyIds()[0]);
    expect(s.calls()).toBe(1);
    expect(s.ghCalled()).toBe(false);
  }, 60_000);

  test("--format json prints one document with the open finding, its id and the outcome", () => {
    const s = scenario();
    s.script(1, BRANCH_FILES, [BLOCKER]);
    const r = s.loop("--base", "main", "--format", "json");
    expect(r.code).toBe(10);
    const doc = JSON.parse(r.stdout);
    expect(doc).toMatchObject({ format: "wachiman.loop-round/1", round: 1, maxRounds: 3, exitCode: 10, outcome: { status: "open" } });
    expect(doc.open).toEqual([expect.objectContaining({ id: s.historyIds()[0], path: "src/a.ts", line: 2, severity: "blocker", status: "open" })]);
    expect(doc.released).toEqual([]);
  }, 60_000);

  test("after a commit that fixes it, the next call reviews only the new commits and exits 0", () => {
    const s = scenario();
    s.script(1, BRANCH_FILES, [BLOCKER]);
    expect(s.loop("--base", "main").code).toBe(10);
    const first = s.prompt(1);
    expect(first).toContain("src/b.ts");
    const fix = commit(s.repo.dir, { "src/a.ts": A_FIXED_LINE2 }, "fix the off by ten");
    s.script(2, ["src/a.ts"], []);
    const r = s.loop();
    expect(r.code).toBe(0);
    expect(s.calls()).toBe(2);
    // The range of round 2 starts at the head of round 1: one commit, the fix.
    expect(r.stderr).toContain(`merge-base: ${s.repo.head.slice(0, 7)}`);
    expect(r.stderr).toContain("depth: 1 commit");
    const second = s.prompt(2);
    expect(second).toContain("export const b = 21;");
    expect(second).not.toContain("src/b.ts");
    expect(second).not.toContain("### CLAUDE.md");
    expect(r.stdout).toContain("round 2 of 3");
    expect(r.stdout).toContain("probably-fixed");
    expect(r.stdout).toContain("Converged on incremental rounds");
    expect(r.stdout).toContain(fix.slice(0, 7));
    // A converged loop is closed.
    const again = s.loop();
    expect(again.code).toBe(2);
    expect(again.stderr).toContain("converged at round 2");
  }, 120_000);

  test("with the finding left unfixed, the fourth call exits 11 with the reason round cap and makes no review call", () => {
    const s = scenario();
    s.script(1, BRANCH_FILES, [BLOCKER]);
    expect(s.loop("--base", "main").code).toBe(10);
    // Rounds 2 and 3 each follow a commit that leaves the Blocker's line alone and the model repeats it.
    let body = A_HEAD;
    for (const n of [2, 3]) {
      body = `${body}export const extra${n} = ${n};\n`;
      commit(s.repo.dir, { "src/a.ts": body }, `unrelated ${n}`);
      s.script(n, ["src/a.ts"], [BLOCKER]);
      expect(s.loop().code).toBe(10);
    }
    const calls = s.calls();
    const fourth = s.loop();
    expect(fourth.code).toBe(11);
    expect(fourth.stdout).toContain("round cap");
    expect(fourth.stdout).toContain("1 finding still keeps");
    expect(s.calls()).toBe(calls);
    // --max-rounds raises the cap for a call.
    commit(s.repo.dir, { "src/a.ts": `${body}export const extra4 = 4;\n` }, "unrelated 4");
    s.script(4, ["src/a.ts"], [BLOCKER]);
    expect(s.loop("--max-rounds", "5").code).toBe(10);
  }, 240_000);

  test("calls with no new commit make no review call and still count as rounds: the fourth stops at the cap", () => {
    const s = scenario();
    s.script(1, BRANCH_FILES, [BLOCKER]);
    expect(s.loop("--base", "main").code).toBe(10);
    for (const round of [2, 3]) {
      const r = s.loop();
      expect(r.code).toBe(10);
      expect(r.stdout).toContain(`round ${round} of 3`);
      expect(r.stderr).toContain("no commit since round");
    }
    expect(s.calls()).toBe(1);
    const fourth = s.loop("--format", "json");
    expect(fourth.code).toBe(11);
    expect(JSON.parse(fourth.stdout).outcome).toMatchObject({ status: "stopped", reason: "round cap" });
    expect(s.calls()).toBe(1);
  }, 120_000);

  test("a finding judged wrong with a reason no longer keeps the loop open and is listed in the outcome; without a reason it still does", () => {
    const s = scenario();
    s.script(1, BRANCH_FILES, [BLOCKER]);
    expect(s.loop("--base", "main").code).toBe(10);
    const [id] = s.historyIds();
    expect(s.history("--verdict", id, "wrong").code).toBe(0);
    const bare = s.loop();
    expect(bare.code).toBe(10);
    expect(bare.stdout).toContain("judged wrong without a reason");
    expect(s.history("--verdict", id, "wrong", "--reason", "b is meant to be 20 here").code).toBe(0);
    const r = s.loop("--format", "json");
    expect(r.code).toBe(0);
    const doc = JSON.parse(r.stdout);
    expect(doc.open).toEqual([]);
    expect(doc.released).toEqual([expect.objectContaining({ id, why: "judged wrong", reason: "b is meant to be 20 here" })]);
    expect(s.calls()).toBe(1);
  }, 120_000);

  test("a Blocker at a line the fix commit did not change, in a file it did change, keeps the loop open when the round does not report it (exit 10); changing its lines later releases it (exit 0)", () => {
    const s = scenario();
    s.script(1, BRANCH_FILES, [BLOCKER]);
    expect(s.loop("--base", "main").code).toBe(10);
    const id = s.historyIds()[0];
    // The agent's commit changes src/a.ts at line 4 and the model reads it and says nothing.
    commit(s.repo.dir, { "src/a.ts": A_FIXED_LINE4 }, "touch line four");
    s.script(2, ["src/a.ts"], []);
    const second = s.loop("--format", "json");
    expect(second.code).toBe(10);
    expect(JSON.parse(second.stdout).open).toEqual([expect.objectContaining({ id, status: "not-repeated" })]);
    // The history agrees that the round did not report it.
    expect(s.history().stdout).toContain("not-repeated");
    // Now the commit changes line 2 itself, and the round that read it does not report it.
    commit(s.repo.dir, { "src/a.ts": A_FIXED_LINE4.replace("export const b = 20;", "export const b = 21;") }, "fix line two");
    s.script(3, ["src/a.ts"], []);
    const third = s.loop("--format", "json");
    expect(third.code).toBe(0);
    const doc = JSON.parse(third.stdout);
    expect(doc.open).toEqual([]);
    expect(doc.released).toEqual([expect.objectContaining({ id, why: "probably-fixed", status: "probably-fixed" })]);
  }, 180_000);

  test("a release because the lines changed is kept in later rounds that do not read the file; another open finding alone keeps the loop open", () => {
    const s = scenario();
    const Y = { path: "src/b.ts", line: 1, severity: "fix", topic: "bug", confidence: "high", title: "Wrong literal", body: "b is 'new'." };
    s.script(1, BRANCH_FILES, [BLOCKER, Y]);
    expect(s.loop("--base", "main", "--max-rounds", "5").code).toBe(10);
    const ids = s.historyIds();
    commit(s.repo.dir, { "src/a.ts": A_FIXED_LINE4 }, "touch line four");
    s.script(2, ["src/a.ts"], []);
    expect(s.loop("--max-rounds", "5").code).toBe(10);
    // Round 3 changes the Blocker's line; the model reads src/a.ts and does not report it.
    commit(s.repo.dir, { "src/a.ts": A_FIXED_LINE4.replace("export const b = 20;", "export const b = 21;") }, "fix line two");
    s.script(3, ["src/a.ts"], []);
    const third = JSON.parse(s.loop("--max-rounds", "5", "--format", "json").stdout);
    expect(third.open.map((f: { path: string }) => f.path)).toEqual(["src/b.ts"]);
    expect(third.released).toEqual([expect.objectContaining({ path: "src/a.ts", why: "probably-fixed" })]);
    // Round 4 touches an unrelated file: src/a.ts is not read again, and the release must stand.
    commit(s.repo.dir, { "docs/note.md": "a note\n" }, "unrelated file");
    s.script(4, ["docs/note.md"], []);
    const fourth = s.loop("--max-rounds", "5", "--format", "json");
    expect(fourth.code).toBe(10);
    const doc = JSON.parse(fourth.stdout);
    expect(doc.open.map((f: { path: string }) => f.path)).toEqual(["src/b.ts"]);
    expect(doc.released.map((f: { path: string }) => f.path)).toEqual(["src/a.ts"]);
    expect(ids).toHaveLength(2);
  }, 240_000);

  test("a release because the lines changed is recomputed in a round that reads the file: reverting the fix reopens the finding", () => {
    const s = scenario();
    const Y = { path: "src/b.ts", line: 1, severity: "fix", topic: "bug", confidence: "high", title: "Wrong literal", body: "b is 'new'." };
    s.script(1, BRANCH_FILES, [BLOCKER, Y]);
    expect(s.loop("--base", "main", "--max-rounds", "5").code).toBe(10);
    commit(s.repo.dir, { "src/a.ts": A_FIXED_LINE4 }, "touch line four");
    s.script(2, ["src/a.ts"], []);
    expect(s.loop("--max-rounds", "5").code).toBe(10);
    // Round 3 changes the Blocker's line and the model, reading src/a.ts, does not report it: released.
    commit(s.repo.dir, { "src/a.ts": A_FIXED_LINE4.replace("export const b = 20;", "export const b = 21;") }, "fix line two");
    s.script(3, ["src/a.ts"], []);
    const third = JSON.parse(s.loop("--max-rounds", "5", "--format", "json").stdout);
    expect(third.released).toEqual([expect.objectContaining({ path: "src/a.ts", why: "probably-fixed" })]);
    // Round 4 puts the line back and the model reads src/a.ts and still does not report it: open again.
    commit(s.repo.dir, { "src/a.ts": A_FIXED_LINE4 }, "revert the fix");
    s.script(4, ["src/a.ts"], []);
    const fourth = s.loop("--max-rounds", "5", "--format", "json");
    expect(fourth.code).toBe(10);
    const reverted = JSON.parse(fourth.stdout);
    expect(reverted.open.map((f: { path: string }) => f.path).sort()).toEqual(["src/a.ts", "src/b.ts"]);
    expect(reverted.released).toEqual([]);
    // Round 5 changes the line again and the model does not report it: released again.
    commit(s.repo.dir, { "src/a.ts": A_FIXED_LINE4.replace("export const b = 20;", "export const b = 22;") }, "fix line two again");
    s.script(5, ["src/a.ts"], []);
    const fifth = JSON.parse(s.loop("--max-rounds", "5", "--format", "json").stdout);
    expect(fifth.open.map((f: { path: string }) => f.path)).toEqual(["src/b.ts"]);
    expect(fifth.released).toEqual([expect.objectContaining({ path: "src/a.ts", why: "probably-fixed" })]);
  }, 300_000);

  test("a review outside the loop, on a branch stacked on this one, cannot release a finding of the loop: only the loop's own runs count", () => {
    const s = scenario();
    s.script(1, BRANCH_FILES, [BLOCKER]);
    expect(s.loop("--base", "main", "--max-rounds", "5").code).toBe(10);
    const a1 = git(s.repo.dir, "rev-parse", "HEAD").trim();
    // A stacked branch fixes the Blocker's line and a plain review of it, saved to the same history, does not report it.
    git(s.repo.dir, "switch", "-q", "-c", "feat/stacked");
    commit(s.repo.dir, { "src/a.ts": A_FIXED_LINE2 }, "fix on the stacked branch");
    s.script(2, ["src/a.ts"], []);
    expect(s.local("--base", a1, "--format", "json").code).toBe(0);
    expect(s.history().stdout).toContain("probably-fixed");
    // Back on the loop's branch, a commit to an unrelated file: the Blocker is still there and still open.
    git(s.repo.dir, "switch", "-q", "feat/x");
    commit(s.repo.dir, { "docs/note.md": "a note\n" }, "unrelated file");
    s.script(3, ["docs/note.md"], []);
    const r = s.loop("--max-rounds", "5", "--format", "json");
    expect(r.code).toBe(10);
    const doc = JSON.parse(r.stdout);
    expect(doc.open.map((f: { path: string }) => f.path)).toEqual(["src/a.ts"]);
    expect(doc.released).toEqual([]);
  }, 300_000);

  test("a finding the history marked probably-fixed is open again when a round that reads the file finds the original line back; it stays open in a round that does not read it", () => {
    const s = scenario();
    const Y = { path: "src/b.ts", line: 1, severity: "fix", topic: "bug", confidence: "high", title: "Wrong literal", body: "b is 'new'." };
    s.script(1, BRANCH_FILES, [BLOCKER, Y]);
    expect(s.loop("--base", "main", "--max-rounds", "6").code).toBe(10);
    // Round 2 changes the Blocker's line; the model reads src/a.ts and does not report it: released.
    commit(s.repo.dir, { "src/a.ts": A_FIXED_LINE2 }, "fix line two");
    s.script(2, ["src/a.ts"], []);
    const second = JSON.parse(s.loop("--max-rounds", "6", "--format", "json").stdout);
    expect(second.released).toEqual([expect.objectContaining({ path: "src/a.ts", why: "probably-fixed", status: "probably-fixed" })]);
    expect(s.history().stdout).toContain("probably-fixed");
    // Round 3 puts the original line back; the model reads src/a.ts and still does not report it: open again.
    commit(s.repo.dir, { "src/a.ts": A_HEAD }, "revert the fix");
    s.script(3, ["src/a.ts"], []);
    const third = s.loop("--max-rounds", "6", "--format", "json");
    expect(third.code).toBe(10);
    const doc = JSON.parse(third.stdout);
    expect(doc.open.map((f: { path: string }) => f.path).sort()).toEqual(["src/a.ts", "src/b.ts"]);
    expect(doc.released).toEqual([]);
    // Round 4 touches an unrelated file: the Blocker does not come back as released.
    commit(s.repo.dir, { "docs/note.md": "a note\n" }, "unrelated file");
    s.script(4, ["docs/note.md"], []);
    const fourth = JSON.parse(s.loop("--max-rounds", "6", "--format", "json").stdout);
    expect(fourth.open.map((f: { path: string }) => f.path).sort()).toEqual(["src/a.ts", "src/b.ts"]);
  }, 300_000);

  test("a finding that a review outside the loop already settled is released by a loop round that reads the fixed file and does not report it", () => {
    const s = scenario();
    s.script(1, BRANCH_FILES, [BLOCKER]);
    expect(s.loop("--base", "main", "--max-rounds", "5").code).toBe(10);
    const a1 = git(s.repo.dir, "rev-parse", "HEAD").trim();
    git(s.repo.dir, "switch", "-q", "-c", "feat/stacked");
    commit(s.repo.dir, { "src/a.ts": A_FIXED_LINE2 }, "fix on the stacked branch");
    s.script(2, ["src/a.ts"], []);
    expect(s.local("--base", a1, "--format", "json").code).toBe(0);
    expect(s.history().stdout).toContain("probably-fixed");
    // The same fix lands on the loop's branch: the loop round reads it and the Blocker is gone.
    git(s.repo.dir, "switch", "-q", "feat/x");
    commit(s.repo.dir, { "src/a.ts": A_FIXED_LINE2 }, "fix line two");
    s.script(3, ["src/a.ts"], []);
    const r = s.loop("--max-rounds", "5", "--format", "json");
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).released).toEqual([expect.objectContaining({ path: "src/a.ts", why: "probably-fixed" })]);
  }, 300_000);

  test("a loop state written without cited-line fingerprints still decides: unchanged lines keep the Blocker open, changed lines release it", () => {
    const s = scenario();
    s.script(1, BRANCH_FILES, [BLOCKER]);
    expect(s.loop("--base", "main", "--max-rounds", "5").code).toBe(10);
    // Make the state look like one written by the first version of the loop.
    const file = Bun.spawnSync(["find", s.home, "-path", "*/loops/*.json"]).stdout.toString().trim();
    const state = JSON.parse(readFileSync(file, "utf8"));
    for (const e of state.ledger) {
      delete e.lineText;
      delete e.blobSha;
      e.linesChanged = false;
    }
    writeFileSync(file, JSON.stringify(state));
    commit(s.repo.dir, { "src/a.ts": A_FIXED_LINE4 }, "touch line four");
    s.script(2, ["src/a.ts"], []);
    const second = s.loop("--max-rounds", "5", "--format", "json");
    expect(second.code).toBe(10);
    expect(JSON.parse(second.stdout).open).toEqual([expect.objectContaining({ path: "src/a.ts", status: "not-repeated" })]);
    commit(s.repo.dir, { "src/a.ts": A_FIXED_LINE4.replace("export const b = 20;", "export const b = 21;") }, "fix line two");
    s.script(3, ["src/a.ts"], []);
    const third = s.loop("--max-rounds", "5", "--format", "json");
    expect(third.code).toBe(0);
    expect(JSON.parse(third.stdout).released).toEqual([expect.objectContaining({ path: "src/a.ts", why: "probably-fixed" })]);
  }, 300_000);

  test("a round that reports the finding again at changed lines keeps the loop open", () => {
    const s = scenario();
    s.script(1, BRANCH_FILES, [BLOCKER]);
    expect(s.loop("--base", "main").code).toBe(10);
    commit(s.repo.dir, { "src/a.ts": A_FIXED_LINE2 }, "a fix that is not one");
    s.script(2, ["src/a.ts"], [{ ...BLOCKER, body: "still wrong at the new value" }]);
    const r = s.loop("--format", "json");
    expect(r.code).toBe(10);
    expect(JSON.parse(r.stdout).open).toHaveLength(1);
  }, 120_000);

  test("a round whose review call fails twice exits 11 with the reason review failed, and the next call retries the same round", () => {
    const s = scenario();
    // No answer is scripted: every call of the fake claude fails.
    const r = s.loop("--base", "main", "--format", "json");
    expect(r.code).toBe(11);
    expect(JSON.parse(r.stdout).outcome).toMatchObject({ status: "stopped", reason: "review failed" });
    expect(r.stderr).toContain("trying once more");
    const failedCalls = s.calls();
    expect(failedCalls).toBeGreaterThanOrEqual(2);
    // The failed round was not recorded: a plain call is round 1 and runs the review again.
    s.script(failedCalls + 1, BRANCH_FILES, [BLOCKER]);
    const again = s.loop();
    expect(again.code).toBe(10);
    expect(again.stdout).toContain("round 1 of 3");
  }, 120_000);

  test("without --base and no loop open, it is exit 2", () => {
    const s = scenario();
    const none = s.loop();
    expect(none.code).toBe(2);
    expect(none.stderr).toContain("No loop is open on feat/x");
    expect(s.calls()).toBe(0);
  }, 60_000);

  test("a loop is kept per branch: another branch has none, and coming back finds the first one", () => {
    const s = scenario();
    s.script(1, BRANCH_FILES, [BLOCKER]);
    expect(s.loop("--base", "main").code).toBe(10);
    git(s.repo.dir, "switch", "-q", "-c", "feat/other");
    const other = s.loop();
    expect(other.code).toBe(2);
    expect(other.stderr).toContain("No loop is open on feat/other");
    git(s.repo.dir, "switch", "-q", "feat/x");
    const back = s.loop();
    expect(back.code).toBe(10);
    expect(back.stdout).toContain("round 2 of 3");
    expect(s.calls()).toBe(1);
  }, 120_000);

  test("--base starts over, even with a loop open", () => {
    const s = scenario();
    s.script(1, BRANCH_FILES, [BLOCKER]);
    expect(s.loop("--base", "main").code).toBe(10);
    s.script(2, BRANCH_FILES, [BLOCKER]);
    const r = s.loop("--base", "main");
    expect(r.code).toBe(10);
    expect(r.stdout).toContain("round 1 of 3");
    expect(r.stderr).toContain("starting over");
  }, 120_000);

  test("a loop state file that is not JSON: a plain call exits 2 naming the file, and --base starts the loop again", () => {
    const s = scenario();
    s.script(1, BRANCH_FILES, [BLOCKER]);
    expect(s.loop("--base", "main").code).toBe(10);
    const file = Bun.spawnSync(["find", s.home, "-path", "*/loops/*.json"]).stdout.toString().trim();
    writeFileSync(file, "{not json");
    const plain = s.loop();
    expect(plain.code).toBe(2);
    expect(plain.stderr).toContain("is not a loop state file");
    expect(s.calls()).toBe(1);
    s.script(2, BRANCH_FILES, [BLOCKER]);
    const again = s.loop("--base", "main");
    expect(again.code).toBe(10);
    expect(again.stdout).toContain("round 1 of 3");
    expect(again.stdout).toContain("Keeps the loop open (1):");
    expect(s.calls()).toBe(2);
  }, 120_000);

  test("the loop never changes the repository: the work tree, the index and the branch are as the agent left them", () => {
    const s = scenario();
    s.script(1, BRANCH_FILES, [BLOCKER]);
    const before = git(s.repo.dir, "status", "--porcelain=v1", "--branch") + git(s.repo.dir, "rev-parse", "HEAD");
    s.loop("--base", "main");
    expect(git(s.repo.dir, "status", "--porcelain=v1", "--branch") + git(s.repo.dir, "rev-parse", "HEAD")).toBe(before);
  }, 60_000);
});

describe("runLoop with a fake review", () => {
  /** What one fake review call reports besides an empty `src/a.ts` read: findings and the verifier's entries. */
  type Shape = { findings?: object[]; entries?: object[] };
  /** A `review` seam that answers like `runLocal` with `--format json`, minus the history save. */
  function fakeReview(repo: BranchRepo, outcomes: ("fail" | "throw" | "ok")[], shapes: Shape[] = []) {
    const calls: string[] = [];
    return {
      calls,
      review: ((args: { base?: string }, _repo: string, _env: unknown, io: { stdout: (t: string) => void }) => {
        const outcome = outcomes[calls.length] ?? "fail";
        const shape = shapes[calls.length];
        calls.push(args.base ?? "");
        if (outcome === "throw") throw new Error("claude crashed");
        if (outcome === "fail") return 1;
        io.stdout(
          JSON.stringify({
            format: "wachiman.review-result/2",
            change: { head: { sha: git(repo.dir, "rev-parse", "HEAD").trim() } },
            coverage: { expected: ["src/a.ts"], reviewed: ["src/a.ts"], partial: false },
            execution: { stop: "complete" },
            findings: shape?.findings ?? [],
            ...(shape?.entries ? { verification: { entries: shape.entries } } : {}),
          }),
        );
        return 0;
      }) as never,
    };
  }
  const run = (repo: BranchRepo, fake: ReturnType<typeof fakeReview>, home: string, ...argv: string[]) => {
    let out = "";
    const err: string[] = [];
    const code = runLoop(parseLoopArgs(argv), repo.dir, { WACHIMAN_HOME: home, PATH: process.env.PATH }, { stdout: (t) => (out += t), stderr: (l) => err.push(l), engineVersion: "0" }, { review: fake.review });
    return { code, out, err };
  };

  test("a review that fails once is retried once and the round goes on", () => {
    const repo = branchRepo();
    for (const first of ["fail", "throw"] as const) {
      const fake = fakeReview(repo, [first, "ok"]);
      const r = run(repo, fake, temp("wachiman-home-"), "--base", "main");
      expect(r.code).toBe(0);
      expect(fake.calls).toEqual(["main", "main"]);
      expect(r.err.some((l) => l.includes("trying once more"))).toBe(true);
    }
  }, 30_000);

  test("a review that fails twice stops with review failed after exactly two attempts", () => {
    const repo = branchRepo();
    const fake = fakeReview(repo, ["fail", "throw", "ok"]);
    const r = run(repo, fake, temp("wachiman-home-"), "--base", "main", "--format", "json");
    expect(r.code).toBe(11);
    expect(fake.calls).toHaveLength(2);
    expect(JSON.parse(r.out).outcome.reason).toBe("review failed");
  }, 30_000);

  test("--base replaces a loop state this version cannot read; a plain call reports it with the instruction", () => {
    const repo = branchRepo();
    const home = temp("wachiman-home-");
    const root = historyRoot(wachimanHome({ WACHIMAN_HOME: home }));
    const key = repositoryKey(repo.dir).key;
    const old = { format: "wachiman.loop-state/0", branch: "feat/x", base: "main" };
    for (const state of [old, { format: "wachiman.loop-state/1", branch: "feat/x", base: "main", status: "open", rounds: [] }]) {
      writeLoopFile(root, key, "feat/x", state);
      const plain = () => run(repo, fakeReview(repo, ["ok"]), home);
      expect(plain).toThrow(/start a new loop with `wachiman loop --base <ref>`/);
      const fake = fakeReview(repo, ["ok"]);
      expect(run(repo, fake, home, "--base", "main").code).toBe(0);
      expect(fake.calls).toEqual(["main"]);
      // The unreadable file was replaced by a state this version reads.
      expect(() => readLoop(root, key, "feat/x")).not.toThrow();
      expect(readLoop(root, key, "feat/x")?.base).toBe("main");
    }
  }, 30_000);

  /** A candidate the verifier dropped with a checked disproof, as `verification.entries` lists it. */
  const droppedCandidate = (over: object) => ({
    id: "candidate-1",
    path: "src/a.ts",
    line: 2,
    title: "Off by ten",
    topic: "bug",
    severity: "blocker",
    status: "refuted",
    origin: "unknown",
    reason: "the code is right",
    checked: [],
    outcome: "dropped",
    ...over,
  });
  const SEEDED = { id: "aaaaaaaaaa", path: "src/a.ts", line: 2, severity: "blocker", topic: "bug", title: "Off by ten" };

  /** Round 1 reports the seeded Blocker; round 2, after one more commit, reports nothing and returns `entries`. */
  const refutedRound = (entries: object[]) => {
    const repo = branchRepo();
    const home = temp("wachiman-home-");
    const fake = fakeReview(repo, ["ok", "ok"], [{ findings: [SEEDED] }, { entries }]);
    expect(run(repo, fake, home, "--base", "main").code).toBe(10);
    commit(repo.dir, { "docs/more.md": "one more commit\n" }, "one more commit");
    return { fake, second: run(repo, fake, home, "--format", "json") };
  };

  test("a Blocker the verifier refuted in a later round, by the same path, topic and title, is released as refuted (exit 0)", () => {
    const { fake, second } = refutedRound([droppedCandidate({ line: 9 })]);
    expect(fake.calls).toHaveLength(2);
    expect(second.code).toBe(0);
    expect(JSON.parse(second.out).released).toEqual([expect.objectContaining({ path: "src/a.ts", why: "refuted" })]);
  }, 60_000);

  test("a dropped candidate in the same file with another topic and title, on another line, does not release the Blocker (exit 10)", () => {
    const { second } = refutedRound([droppedCandidate({ line: 4, topic: "security", title: "Unrelated candidate" })]);
    expect(second.code).toBe(10);
    const doc = JSON.parse(second.out);
    expect(doc.released).toEqual([]);
    expect(doc.open).toEqual([expect.objectContaining({ path: "src/a.ts", severity: "blocker" })]);
  }, 60_000);

  test("a usage error from the review is not retried", () => {
    const repo = branchRepo();
    let calls = 0;
    const review = (() => {
      calls++;
      throw new UsageError("--base nope is not a commit in this clone.");
    }) as never;
    expect(() =>
      runLoop(parseLoopArgs(["--base", "nope"]), repo.dir, { WACHIMAN_HOME: temp("wachiman-home-"), PATH: process.env.PATH }, { stdout: () => {}, stderr: () => {}, engineVersion: "0" }, { review }),
    ).toThrow(UsageError);
    expect(calls).toBe(1);
  }, 30_000);
});

describe("parseLoopArgs", () => {
  test("the defaults and every flag, in both spellings", () => {
    expect(parseLoopArgs([])).toEqual({ maxRounds: 3, format: "terminal", verify: undefined });
    expect(parseLoopArgs(["--base", "main", "--max-rounds", "5", "--format=json", "--profile", "isolated:work", "--no-verify", "--max-depth=9"])).toEqual({
      base: "main",
      maxRounds: 5,
      format: "json",
      profile: "isolated:work",
      verify: false,
      maxDepth: 9,
    });
    expect(parseLoopArgs(["--max-rounds=2"]).maxRounds).toBe(2);
  });

  test.each([
    [["--max-rounds", "0"]],
    [["--max-rounds", "x"]],
    [["--max-rounds"]],
    [["--max-rounds", "2", "--max-rounds", "3"]],
    [["--format", "markdown"]],
    [["src/a.ts"]],
    [["--commit", "abc"]],
    [["--from", "abc"]],
    [["--history"]],
    [["--input", "f"]],
    [["--frobnicate"]],
  ])("%p is a usage error", (argv) => {
    expect(() => parseLoopArgs(argv)).toThrow(UsageError);
  });
});

describe("help", () => {
  test("--help lists loop and its exit codes", () => {
    const out = Bun.spawnSync([process.execPath, cli, "--help"], { env: { PATH: process.env.PATH ?? "", HOME: temp("h-") }, stdin: "ignore" });
    const text = out.stdout.toString();
    expect(text).toContain("wachiman loop [--base <ref>] [--max-rounds <n>]");
    expect(text).toContain("`loop`: 0 converged, 10 findings still open, 11 stopped without converging");
  });
});
