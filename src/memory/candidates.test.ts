/**
 * Memory candidates (layer 3): the evidence rule (AC7), the exact entry text, the local store and the
 * `candidates`, `add` and `show` commands. No model, no network, no GitHub.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendVerdict, historyRoot, repositoryKey, writeLoopFile } from "../history/store";
import { branchRepo, git, removeTempRepos } from "../../test/support/temp-repo";
import { parseMemoryFile } from "./entries";
import { newCandidate, proposability, readCandidate, renderEntry, withEvidence, writeCandidate, type Evidence } from "./candidates";
import { runMemory } from "./command";

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

const FIELDS = { kind: "convention", scope: "src/**", rule: "Prefer named exports.", why: "Renames then show up in every importer." };
const ev = (source: Evidence["source"], ref: { pr?: number; branch?: string }, extra: Partial<Evidence> = {}): Evidence => ({ date: "2026-11-18", source, agent: false, ...ref, ...extra });

describe("the evidence rule (AC7)", () => {
  test("AC7: a candidate found by the tool is not proposable until it has min_evidence pieces from different pull requests", () => {
    const one = newCandidate(FIELDS, ev("judged", { pr: 1 }), "2026-11-18");
    expect(proposability(one, 2)).toMatchObject({ proposable: false, distinct: 1, needed: 2 });
    expect(proposability(one, 2).why).toContain("needs evidence from 2 different pull requests");
    // Two pieces from the same pull request are one piece.
    const same = withEvidence(one, [ev("judged", { pr: 1 }, { finding: "abc" })]);
    expect(same.evidence).toHaveLength(2);
    expect(proposability(same, 2).proposable).toBe(false);
    // A second pull request reaches the rule; a branch counts as its own reference.
    expect(proposability(withEvidence(one, [ev("fixed", { pr: 2 })]), 2).proposable).toBe(true);
    expect(proposability(withEvidence(one, [ev("judged", { branch: "feat/y" })]), 2).proposable).toBe(true);
    expect(proposability(withEvidence(one, [ev("judged", { pr: 2 })]), 3).proposable).toBe(false);
  });

  test("AC7: an explicit operator instruction is proposable with one piece of evidence", () => {
    const c = newCandidate(FIELDS, ev("instruction", { pr: 709 }), "2026-11-18");
    expect(proposability(c, 2)).toMatchObject({ proposable: true, counted: 1 });
    expect(proposability(c, 5).proposable).toBe(true);
  });

  test("a fix supports only a convention, never an exception", () => {
    const fixes = (kind: string) => {
      const c = newCandidate({ ...FIELDS, kind }, ev("fixed", { pr: 1 }), "2026-11-18");
      return withEvidence(c, [ev("fixed", { pr: 2 }), ev("fixed", { pr: 3 })]);
    };
    expect(proposability(fixes("convention"), 2).proposable).toBe(true);
    const exception = proposability(fixes("exception"), 2);
    expect(exception.proposable).toBe(false);
    expect(exception.why).toContain("a fix supports only a convention");
  });

  test("evidence from the same source, reference and finding is counted once", () => {
    const c = newCandidate(FIELDS, ev("judged", { pr: 1 }, { finding: "f1" }), "2026-11-18");
    expect(withEvidence(c, [ev("judged", { pr: 1 }, { finding: "f1" })]).evidence).toHaveLength(1);
  });
});

describe("the entry text", () => {
  test("renders an entry that parses back with the same id and no problem, and the id ignores evidence", () => {
    const c = newCandidate({ ...FIELDS, holdsWhile: "src/gateway.ts" }, ev("instruction", { pr: 709 }, { agent: true }), "2026-11-18");
    const text = renderEntry(c);
    const parsed = parseMemoryFile("index.md", text);
    expect(parsed.problems).toEqual([]);
    expect(parsed.entries[0]).toMatchObject({ id: c.id, kind: "convention", scope: "src/**", holdsWhile: "src/gateway.ts", added: "2026-11-18" });
    expect(parsed.entries[0].evidence).toEqual(["2026-11-18 operator instruction, pull request 709, written by an agent"]);
    expect(withEvidence(c, [ev("judged", { pr: 2 })]).id).toBe(c.id);
    expect(text.endsWith("\n")).toBe(true);
  });

  test("a multi-line rule is written on one line and a missing field or bad kind is a usage error", () => {
    const c = newCandidate({ ...FIELDS, rule: "Line one.\n  Line two." }, ev("instruction", { branch: "b" }), "2026-11-18");
    expect(renderEntry(c)).toContain("- rule: Line one. Line two.");
    expect(() => newCandidate({ ...FIELDS, why: "  " }, ev("instruction", { branch: "b" }), "2026-11-18")).toThrow("needs a why");
    expect(() => newCandidate({ ...FIELDS, kind: "rule" }, ev("instruction", { branch: "b" }), "2026-11-18")).toThrow("convention");
  });
});

/** A repository, a Wachiman home and the three read-only commands through `runMemory`. */
function setup() {
  const repo = branchRepo();
  const home = temp("wachiman-cand-home-");
  const env = { WACHIMAN_HOME: home };
  const run = (...argv: string[]) => {
    let stdout = "";
    let stderr = "";
    let code: number;
    try {
      code = runMemory(argv, repo.dir, { stdout: (t) => (stdout += t), stderr: (l) => (stderr += `${l}\n`) }, { env, now: () => new Date("2026-11-18T10:00:00Z") });
    } catch (error) {
      code = 2;
      stderr += (error as Error).message;
    }
    return { code, stdout, stderr };
  };
  return { repo, home, run, key: repositoryKey(repo.dir).key, root: historyRoot(home) };
}

const ADD = ["add", "--kind", "convention", "--scope", "src/**", "--rule", "Prefer named exports.", "--why", "Renames then show up in every importer."];

describe("memory add, candidates and show", () => {
  test("add records an operator instruction as a proposable candidate, and show prints the exact entry text", () => {
    const s = setup();
    git(s.repo.dir, "switch", "-q", "feat/x");
    const added = s.run(...ADD, "--pr", "709");
    expect(added.code).toBe(0);
    const id = added.stdout.match(/\b([0-9a-f]{7})\b/)![1];
    const shown = s.run("show", id);
    expect(shown.code).toBe(0);
    expect(shown.stdout).toBe(renderEntry(readCandidate(s.home, s.key, id)!));
    expect(shown.stdout).toContain("- evidence:\n  - 2026-11-18 operator instruction, pull request 709\n- added: 2026-11-18\n");
    const list = s.run("candidates", "--format", "json");
    expect(JSON.parse(list.stdout)).toEqual({
      format: "wachiman.memory-candidates/1",
      candidates: [expect.objectContaining({ id, kind: "convention", title: "Prefer named exports.", proposable: true, evidence: 1, needed: 2 })],
    });
    expect(s.run("candidates").stdout).toContain("proposable");
  });

  test("adding the same entry again adds evidence without changing the id; the current branch is the default reference", () => {
    const s = setup();
    git(s.repo.dir, "switch", "-q", "feat/x");
    const id = s.run(...ADD).stdout.match(/\b([0-9a-f]{7})\b/)![1];
    expect(s.run(...ADD, "--branch", "feat/y").stdout).toContain(id);
    expect(readCandidate(s.home, s.key, id)!.evidence.map((e) => e.branch)).toEqual(["feat/x", "feat/y"]);
  });

  test("a judged finding needs a wrong verdict with a reason in the local history; a fixed one needs probably-fixed; the loop branch is the reference", () => {
    const s = setup();
    const state = (branch: string, status: string) => ({
      format: "wachiman.loop-state/1", branch, base: "main", status: "open", rounds: [],
      ledger: [{ id: "f1f1f1f1f1", path: "src/a.ts", line: 2, severity: "consider", topic: "style", title: "t", status, refuted: false }],
    });
    writeLoopFile(s.root, s.key, "feat/x", state("feat/x", "open"));
    const judged = [...ADD, "--source", "judged", "--finding", "f1f1f1f1f1"];
    expect(s.run(...judged).stderr).toContain('no verdict "wrong" with a reason');
    appendVerdict(s.root, s.key, { at: "2026-11-18T00:00:00Z", firstId: "f1f1f1f1f1", verdict: "wrong", reason: "intentional" });
    expect(s.run(...judged).code).toBe(0);
    const id = s.run("candidates", "--format", "json").stdout.match(/"id": "([0-9a-f]{7})"/)![1];
    expect(readCandidate(s.home, s.key, id)!.evidence[0]).toMatchObject({ source: "judged", branch: "feat/x", finding: "f1f1f1f1f1" });
    // Not fixed yet.
    expect(s.run(...ADD, "--source", "fixed", "--finding", "f1f1f1f1f1").stderr).toContain("did not mark finding f1f1f1f1f1 as fixed");
    writeLoopFile(s.root, s.key, "feat/x", state("feat/x", "probably-fixed"));
    expect(s.run(...ADD, "--source", "fixed", "--finding", "f1f1f1f1f1").code).toBe(0);
    // An unknown finding is no evidence.
    expect(s.run(...ADD, "--source", "judged", "--finding", "0000000000").stderr).toContain("No finding 0000000000");
  });

  test("an exception cannot be recorded from a fix; --file supplies the fields; reactions are not a source", () => {
    const s = setup();
    expect(s.run("add", "--kind", "exception", "--scope", "src/**", "--rule", "r", "--why", "w", "--source", "fixed", "--finding", "x").stderr).toContain("A fix supports only a convention");
    const dir = temp("wachiman-cand-file-");
    const file = join(dir, "entry.json");
    writeFileSync(file, JSON.stringify({ kind: "exception", scope: "docs/**", rule: "Skip dates.", why: "ADRs version themselves.", title: "No date nags" }));
    expect(s.run("add", "--file", file, "--pr", "5").code).toBe(0);
    expect(s.run("candidates").stdout).toContain("No date nags");
    expect(s.run("add", "--file", file, "--source", "reaction").stderr).toContain("--source must be");
    expect(s.run("show", "abcdef0").stderr).toContain("No memory candidate abcdef0");
    expect(s.run("show", "nope").stderr).toContain("not a memory entry id");
  });

  test("candidates says why one is not proposable, and an empty store prints none", () => {
    const s = setup();
    expect(s.run("candidates").stdout).toContain("no memory candidates");
    expect(JSON.parse(s.run("candidates", "--format", "json").stdout).candidates).toEqual([]);
    const c = withEvidence(newCandidate(FIELDS, ev("judged", { pr: 1 }), "2026-11-18"), []);
    writeCandidate(s.home, s.key, c);
    const out = s.run("candidates");
    expect(out.stdout).toContain("not proposable: needs evidence from 2 different pull requests");
  });
});
