import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageError } from "../config";
import { emptyRepo, git, removeTempRepos } from "../../test/support/temp-repo";
import { parseHistoryArgs } from "./command";
import { readVerdicts, repositoryKey, writeRun } from "./store";
import { HISTORY_RUN_FORMAT, type HistoryRun } from "./types";

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
function history(args: string[], home: string, extraEnv: Record<string, string> = {}) {
  const out = Bun.spawnSync([process.execPath, cli, "history", ...args], {
    env: { PATH: process.env.PATH ?? "", HOME: home, USER: "dev", ...extraEnv },
    stdin: "ignore",
  });
  return { code: out.exitCode, stdout: out.stdout.toString(), stderr: out.stderr.toString() };
}

const FIRST = "5d6e7f8".padEnd(40, "0");
const SECOND = "9a8b7c6".padEnd(40, "0");

function finding(path: string, line: number, title: string, severity = "fix", topic = "bug") {
  return { path, line, title, severity, topic, body: "b", anchor: "diff" };
}

/** A repository with an origin, and its history: run 1 finds A and B; run 2 finds A again and settles B. */
function seeded(daysAgo = 2, name = "listed") {
  const home = temp("wachiman-hist-home-");
  const repo = emptyRepo();
  git(repo, "remote", "add", "origin", `https://github.com/o/${name}.git`);
  const repository = repositoryKey(repo);
  const at = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const base = { format: HISTORY_RUN_FORMAT, engine: { version: "0" }, repository } as const;
  const tr = (id: string, status: "new" | "open", runs: number, firstHead: string) => ({ id, status, firstId: id, firstHead, runs, reopened: 0, titleKey: id });
  const run1 = {
    ...base,
    savedAt: at(daysAgo + 10),
    result: { format: "wachiman.review-result/1", change: { head: { sha: FIRST } }, coverage: { reviewed: [], expected: [], skipped: [] }, findings: [finding("src/a.ts", 12, "Off-by-one in the loop"), finding("src/b.ts", 40, "Unchecked cast")] },
    tracking: [tr("a1a1a1a1a1", "new", 1, FIRST), tr("b2b2b2b2b2", "new", 1, FIRST)],
    settled: [],
    unknown: 0,
    unknownIds: [],
  } as unknown as HistoryRun;
  const run2 = {
    ...base,
    savedAt: at(daysAgo),
    result: { format: "wachiman.review-result/1", change: { head: { sha: SECOND } }, coverage: { reviewed: [], expected: [], skipped: [] }, findings: [finding("src/a.ts", 12, "Off-by-one in the loop")] },
    tracking: [tr("c3c3c3c3c3", "open", 2, FIRST)].map((t) => ({ ...t, firstId: "a1a1a1a1a1" })),
    settled: [{ firstId: "b2b2b2b2b2", status: "probably-fixed", path: "src/b.ts", line: 40, title: "Unchecked cast", lastHead: FIRST }],
    unknown: 0,
    unknownIds: [],
  } as unknown as HistoryRun;
  const root = join(home, ".wachiman", "history");
  writeRun(root, run1);
  writeRun(root, run2);
  return { home, repo, root, key: repository.key };
}

describe("parseHistoryArgs", () => {
  test("every option, and the usage errors", () => {
    expect(parseHistoryArgs(["--since", "7d", "--all-repos", "--json"])).toEqual({ sinceDays: 7, allRepos: true, json: true, forget: false, all: false });
    expect(parseHistoryArgs(["--verdict", "abc", "wrong", "--reason", "x"]).verdict).toEqual({ id: "abc", word: "wrong" });
    expect(parseHistoryArgs(["--forget", "--all"])).toMatchObject({ forget: true, all: true });
    for (const bad of [["--frobnicate"], ["--all"], ["--since", "7"], ["--since=1w"], ["--reason", "x"], ["--verdict", "abc", "maybe"], ["--verdict", "abc"], ["stray"], ["--json=1"], ["--forget", "--json"]]) {
      expect(() => parseHistoryArgs(bad)).toThrow(UsageError);
    }
  });
});

describe("agent-review history", () => {
  test("lists a repository's findings with status, heads, runs, id and verdict", () => {
    const { home, repo } = seeded();
    const r = history(["--repo-dir", repo], home);
    expect(r.code).toBe(0);
    const lines = r.stdout.trimEnd().split("\n");
    expect(lines[0]).toMatch(/^listed-[0-9a-f]{8}  .+  \(2 runs, \d{4}-\d\d-\d\d → \d{4}-\d\d-\d\d\)$/);
    expect(lines[1]).toBe("  status          first    last     runs  id          finding");
    expect(lines[2]).toBe("  open            5d6e7f8  9a8b7c6  2     a1a1a1a1a1  src/a.ts:12  Fix · bug  Off-by-one in the loop");
    expect(lines[3]).toBe("  probably-fixed  5d6e7f8  5d6e7f8  1     b2b2b2b2b2  src/b.ts:40  Fix · bug  Unchecked cast");
    expect(lines[4]).toBe("verdicts: 0 correct, 0 partial, 0 wrong, 2 unjudged");
  });

  test("--repo-dir resolves the key from the clone; --all-repos lists every key", () => {
    const { home, repo, root } = seeded();
    // A second repository's history under the same home.
    const second = seeded(2, "second");
    cpSync(join(second.root, second.key), join(root, second.key), { recursive: true });
    // A clone of a third repository sees nothing; --all-repos sees both keys.
    const stranger = emptyRepo();
    git(stranger, "remote", "add", "origin", "https://github.com/o/stranger");
    expect(history(["--repo-dir", stranger], home).stdout).toBe("No history yet: run `agent-review local --history` to start one.\n");
    expect(history(["--repo-dir", repo], home).stdout.match(/^listed-/gm)).toHaveLength(1);
    const all = history(["--all-repos", "--repo-dir", stranger], home);
    expect(all.code).toBe(0);
    expect(all.stdout.match(/^(listed|second)-[0-9a-f]{8}  /gm)).toHaveLength(2);
  });

  test("--since 7d keeps findings seen in the last 7 days", () => {
    const { home, repo } = seeded(20);
    const all = history(["--repo-dir", repo], home);
    expect(all.stdout).toContain("Off-by-one");
    const recent = history(["--since", "7d", "--repo-dir", repo], home);
    expect(recent.code).toBe(0);
    expect(recent.stdout).not.toContain("Off-by-one");
    const wide = history(["--since", "30d", "--repo-dir", repo], home);
    expect(wide.stdout).toContain("Off-by-one");
  });

  test("--json prints the replayed state", () => {
    const { home, repo, key } = seeded();
    const r = history(["--json", "--repo-dir", repo], home);
    expect(r.code).toBe(0);
    const state = JSON.parse(r.stdout);
    expect(state.format).toBe("wachiman.history-state/1");
    expect(state.repositories).toHaveLength(1);
    expect(state.repositories[0]).toMatchObject({ key, runs: 2 });
    expect(state.repositories[0].findings.map((f: any) => [f.id, f.status])).toEqual([["a1a1a1a1a1", "open"], ["b2b2b2b2b2", "probably-fixed"]]);
  });

  test("no history prints one line and exits 0", () => {
    const home = temp("wachiman-hist-home-");
    const repo = emptyRepo();
    const r = history(["--repo-dir", repo], home);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("No history yet: run `agent-review local --history` to start one.\n");
    expect(existsSync(join(home, ".wachiman"))).toBe(false);
  });

  test("--verdict appends a line and the listing shows it; an unknown id exits 2", () => {
    const { home, repo, root, key } = seeded();
    const ok = history(["--verdict", "b2b2b2b2b2", "wrong", "--reason", "x", "--repo-dir", repo], home);
    expect(ok.code).toBe(0);
    const file = join(root, key, "verdicts.jsonl");
    expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(1);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readVerdicts(root, key).get("b2b2b2b2b2")).toMatchObject({ verdict: "wrong", reason: "x" });
    const listing = history(["--repo-dir", repo], home).stdout.split("\n");
    expect(listing[3]).toEndWith("Unchecked cast   verdict: wrong");
    expect(listing[4]).toBe("verdicts: 0 correct, 0 partial, 1 wrong, 1 unjudged");

    const unknown = history(["--verdict", "zzzzzzzzzz", "correct", "--repo-dir", repo], home);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain("zzzzzzzzzz");
    const bad = history(["--verdict", "b2b2b2b2b2", "maybe", "--repo-dir", repo], home);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("correct, partial, wrong");
    expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(1);
  });

  test("--forget removes one repository or everything, and never a profile", () => {
    const { home, repo, root, key } = seeded();
    const profile = join(home, ".wachiman", "claude-isolated");
    mkdirSync(profile, { recursive: true });
    const one = history(["--forget", "--repo-dir", repo], home);
    expect(one.code).toBe(0);
    expect(one.stdout).toBe(`removed ${join(root, key)}\n`);
    expect(existsSync(join(root, key))).toBe(false);
    expect(history(["--forget", "--repo-dir", repo], home).stdout).toBe("Nothing to remove.\n");

    const again = seeded();
    const profile2 = join(again.home, ".wachiman", "claude-work");
    mkdirSync(profile2, { recursive: true });
    const all = history(["--forget", "--all", "--repo-dir", again.repo], again.home);
    expect(all.stdout).toBe(`removed ${again.root}\n`);
    expect(existsSync(again.root)).toBe(false);
    expect(existsSync(profile2)).toBe(true);
    expect(existsSync(profile)).toBe(true);
  });

  test("history never runs claude and never calls gh", () => {
    const { home, repo } = seeded();
    const bin = temp("wachiman-bin-");
    const canary = join(bin, "canary");
    for (const name of ["claude", "gh"]) {
      writeFileSync(join(bin, name), `#!/bin/sh\necho ${name} >> "${canary}"\nexit 99\n`);
      chmodSync(join(bin, name), 0o755);
    }
    const env = { PATH: `${bin}:${process.env.PATH ?? ""}` };
    expect(history(["--repo-dir", repo], home, env).code).toBe(0);
    expect(history(["--json", "--repo-dir", repo], home, env).code).toBe(0);
    expect(existsSync(canary)).toBe(false);
  });
});
