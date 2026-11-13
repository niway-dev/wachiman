import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageError } from "./config";
import { CLAIMS_SCHEMA } from "./fidelity/claims-call";
import { parseLocalArgs, runLocal } from "./local";
import type { ProviderAdapter, ProviderRequest, ProviderResult } from "./providers/types";
import { branchRepo, removeTempRepos, type BranchRepo } from "../test/support/temp-repo";

// `wachiman local --confidence <file>`: the laptop computes PR Confidence with a fake provider.
// Nothing here starts `claude`.

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

const FILES = ["CLAUDE.md", "img.png", "src/a.ts", "src/b.ts", "src/new.ts"];

class FakeProvider implements ProviderAdapter {
  readonly name = "fake";
  readonly requests: ProviderRequest[] = [];
  preflight() {}
  modelLabel() {
    return "Fake Model 1";
  }
  leaksSecret() {
    return false;
  }
  run(request: ProviderRequest): ProviderResult {
    this.requests.push(request);
    const base = { costUsd: 0.01, turns: 1, durationMs: 1, terminalReason: "success", isError: false, raw: {} };
    if (request.outputSchema === CLAIMS_SCHEMA) return { ...base, structuredOutput: { claims: [{ text: "Adds a new module.", vague: false }] } };
    return {
      ...base,
      structuredOutput: {
        files_reviewed: FILES,
        files_skipped: [],
        findings: [],
        contracts: [],
        thread_replies: [],
        summary: "clean",
        claim_assignments: FILES.map((path) => ({ path, claim: 0, verdict: "supports", evidence: [{ path, line: 1 }] })),
      },
    };
  }
  get claimsCalls() {
    return this.requests.filter((r) => r.outputSchema === CLAIMS_SCHEMA);
  }
}

function grade(args: string[], repo: BranchRepo, provider: FakeProvider) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const env = { HOME: temp("wachiman-home-"), WACHIMAN_HOME: temp("wachiman-wh-"), PATH: process.env.PATH, WACHIMAN_VERIFY: "0" };
  const code = runLocal(
    parseLocalArgs(args),
    repo.dir,
    env,
    { stdout: (t) => stdout.push(t), stderr: (l) => stderr.push(l), engineVersion: "0" },
    {
      spawn: (_bin, a, o) => ({
        status: 0,
        stdout: a[0] === "--version" ? "9.9.9" : JSON.stringify({ loggedIn: true, authMethod: "claude.ai", configDirectory: o.env.CLAUDE_CONFIG_DIR }),
        stderr: "",
      }),
      getProvider: () => provider,
    },
  );
  return { code, stdout: stdout.join(""), stderr: stderr.join("\n") };
}

const prFile = (extra: Record<string, unknown> = {}) => {
  const file = join(temp("wachiman-pr-"), "pr.json");
  writeFileSync(file, JSON.stringify({ title: "Add a module", body: "Adds a new module.", number: 12, url: "https://github.com/o/r/pull/12", ...extra }));
  return file;
};

describe("wachiman local --confidence", () => {
  test("--commit with --format json returns a graded fidelity, and the claims call is made once", () => {
    const repo = branchRepo();
    const provider = new FakeProvider();
    const r = grade(["--commit", repo.head, "--confidence", prFile(), "--format", "json"], repo, provider);
    expect(r.code).toBe(0);
    const result = JSON.parse(r.stdout);
    expect(result.format).toBe("wachiman.review-result/2");
    expect(result.change.kind).toBe("pull-request");
    expect(result.change.title).toBe("Add a module");
    expect(result.change.identifier).toBe("#12");
    expect(result.change.describe).toContain("pull request #12");
    expect(result.change.repository.url).toBe("https://github.com/o/r");
    expect(result.fidelity.grade).toMatch(/^(A|A-|B|C|D|cannot say)$/);
    expect(result.fidelity.claims).toHaveLength(1);
    expect(provider.claimsCalls).toHaveLength(1);
  }, 30_000);

  test("without the flag there is no fidelity and no claims call", () => {
    const repo = branchRepo();
    const provider = new FakeProvider();
    const r = grade(["--commit", repo.head, "--format", "json"], repo, provider);
    expect(r.code).toBe(0);
    const result = JSON.parse(r.stdout);
    expect(result.format).toBe("wachiman.review-result/1");
    expect(result).not.toHaveProperty("fidelity");
    expect(provider.claimsCalls).toHaveLength(0);
  }, 30_000);

  test("markdown output carries the rendered block", () => {
    const repo = branchRepo();
    const r = grade(["--commit", repo.head, "--confidence", prFile(), "--format", "markdown"], repo, new FakeProvider());
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("PR Confidence");
  }, 30_000);

  test("refuses what it cannot grade", () => {
    const f = prFile();
    expect(() => parseLocalArgs(["--working-tree", "all", "--confidence", f])).toThrow(UsageError);
    expect(() => parseLocalArgs(["--confidence", f, "src/a.ts"])).toThrow("takes no paths");
    expect(() => parseLocalArgs(["--confidence", f, "--format", "json", "--result-version", "1"])).toThrow("result-version 2");
    expect(() => parseLocalArgs(["--confidence", f, "--input", f])).toThrow("--input");
    expect(() => parseLocalArgs(["--confidence", "/nonexistent/pr.json"])).toThrow("does not exist");
  });

  test("the body loses Wachiman's own block, and a url without /pull/<n> is refused", () => {
    const repo = branchRepo();
    const provider = new FakeProvider();
    const body = "Adds a new module.\n<!-- wachiman:confidence:start -->\nold\n<!-- wachiman:confidence:end -->";
    const r = grade(["--commit", repo.head, "--confidence", prFile({ body }), "--format", "json"], repo, provider);
    expect(JSON.parse(r.stdout).change.description.trim()).toBe("Adds a new module.");
    expect(() => grade(["--commit", repo.head, "--confidence", prFile({ url: "https://github.com/o/r/issues/3" })], repo, new FakeProvider())).toThrow("url");
  }, 30_000);

  test("a malformed file is a usage error naming the field", () => {
    const repo = branchRepo();
    expect(() => grade(["--commit", repo.head, "--confidence", prFile({ title: 5 })], repo, new FakeProvider())).toThrow("title");
  });
});
