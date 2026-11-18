import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config";
import { githubReview, reviewChange, reviewOptionsOf, type CoreDeps, type Finding, type ReviewInput, type ReviewOptions, type ReviewOutput } from "../engine";
import { toResultV1 } from "../formats";
import type { ProviderAdapter, ProviderRequest, ProviderResult } from "../providers/types";
import { validate } from "../../test/support/json-schema";
import { parseRepoSettings } from "../repo-settings";
import { entryId } from "./entries";
import { loadMemory, type MemorySource } from "./load";

// ADR 0057 through the review core, with a fake provider: conventions in the prompt, exceptions
// matched after discovery, the severity floor, and the visible "Muted by memory" list.

type Step = (request: ProviderRequest) => Partial<ProviderResult>;

/** Answers a discovery call and a matching call by what the prompt is, so the order of calls does not matter. */
class FakeProvider implements ProviderAdapter {
  readonly name = "fake";
  readonly requests: ProviderRequest[] = [];
  constructor(
    private readonly discovery: Step,
    private readonly matching: Step = () => ({ structuredOutput: { matches: [] } }),
    private readonly verifying?: Step,
  ) {}
  preflight() {}
  modelLabel() {
    return "Fake Model 1 via Fake CLI 0.1";
  }
  leaksSecret() {
    return false;
  }
  get matchingCalls() {
    return this.requests.filter((r) => r.prompt.includes("<exceptions>"));
  }
  get discoveryCalls() {
    return this.requests.filter((r) => !r.prompt.includes("<exceptions>") && !r.prompt.includes("<candidates>"));
  }
  async run(request: ProviderRequest): Promise<ProviderResult> {
    this.requests.push(request);
    const step = request.prompt.includes("<exceptions>") ? this.matching : request.prompt.includes("<candidates>") ? this.verifying : this.discovery;
    if (!step) throw new Error("the fake provider has no answer for this call");
    return { costUsd: 0.1, turns: 1, durationMs: 1, terminalReason: "success", isError: false, raw: {}, ...step(request) };
  }
}

const ROOT = join(import.meta.dir, "..", "..");
const resultSchema = JSON.parse(readFileSync(join(ROOT, "docs/formats/review-result.v2.schema.json"), "utf8"));
const branchFixture = JSON.parse(readFileSync(join(ROOT, "test/fixtures/formats/review-input.branch.json"), "utf8"));

function branchInput(): ReviewInput {
  const headDir = mkdtempSync(join(tmpdir(), "mute-head-"));
  mkdirSync(join(headDir, "src"));
  writeFileSync(join(headDir, "src/a.ts"), "const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n");
  return { ...structuredClone(branchFixture), headDir };
}

const deps = (provider: ProviderAdapter, verifier?: ProviderAdapter) => {
  const warnings: string[] = [];
  const d: CoreDeps = { provider, ...(verifier ? { verifier } : {}), log: () => {}, warn: (l) => void warnings.push(l), sleep: () => {}, rateLimitBackoffMs: 0 };
  return { deps: d, warnings };
};
const options = (over: Partial<ReviewOptions> = {}, verify = "0"): ReviewOptions => ({ ...reviewOptionsOf(loadConfig({ WACHIMAN_VERIFY: verify }), 5), ...over });

const finding = (over: Partial<Finding>): Finding => ({ path: "src/a.ts", line: 2, severity: "consider", topic: "cleanup", confidence: "high", title: "t", body: "b", ...over });
const discover = (findings: Finding[]): Step => () => ({ structuredOutput: { files_reviewed: ["src/a.ts"], files_skipped: [], findings, thread_replies: [], summary: "Looks fine." } satisfies ReviewOutput });
const answer = (...matches: { finding: string; entry: string; reason?: string }[]): Step => () => ({ structuredOutput: { matches: matches.map((m) => ({ reason: "it is that kind of finding", ...m })) } });

function memoryEntry(kind: "convention" | "exception", rule: string, scope: string, holdsWhile?: string) {
  const why = "the owner said so";
  const id = entryId({ kind, scope, rule, why, ...(holdsWhile ? { holdsWhile } : {}) });
  const block = `### ${id} ${rule}\n\n- kind: ${kind}\n- scope: ${scope}\n- rule: ${rule}\n- why: ${why}\n${holdsWhile ? `- holds while: ${holdsWhile}\n` : ""}- evidence:\n  - 2026-11-18 operator instruction\n- added: 2026-11-18\n`;
  return { id, block };
}
const REV = "b".repeat(40);
function memoryOf(blocks: string[], settings?: string) {
  const files: Record<string, string> = { "index.md": `# Memory\n\n${blocks.join("\n")}` };
  const source: MemorySource = { list: () => Object.keys(files), read: (n) => files[n] ?? null, settings: () => (settings === undefined ? undefined : parseRepoSettings(settings)) };
  return loadMemory(source, REV, ["src/a.ts"], () => {})!;
}

const NIT = finding({ line: 2, title: "stale comment" });
const EXCEPTION = memoryEntry("exception", "Do not report stale comments in src", "src/**");

describe("conventions in the review prompt", () => {
  test("a convention is in the discovery prompt after the instruction files, labelled as learned; an exception never is", async () => {
    const convention = memoryEntry("convention", "Readable before terse", "src/**");
    const provider = new FakeProvider(discover([]));
    const input = branchInput();
    input.instructions = { baseSha: REV, files: [{ path: ".github/wachiman.md", content: "HAND WRITTEN RULE" }] } as ReviewInput["instructions"];
    await reviewChange(input, options({ memory: memoryOf([convention.block, EXCEPTION.block]) }), deps(provider).deps);

    const prompt = provider.discoveryCalls[0].prompt;
    expect(prompt).toContain("## Learned conventions");
    expect(prompt).toContain("Readable before terse");
    expect(prompt.indexOf("HAND WRITTEN RULE")).toBeGreaterThan(-1);
    expect(prompt.indexOf("## Learned conventions")).toBeGreaterThan(prompt.indexOf("HAND WRITTEN RULE"));
    expect(prompt).toContain("hand-written file wins");
    expect(prompt).not.toContain("Do not report stale comments in src");
    // No call but the discovery batch: a review with no findings has nothing to match.
    expect(provider.requests).toHaveLength(1);
  });

  test("with only exceptions in memory the discovery prompt is the one it would be with no memory", async () => {
    const plain = new FakeProvider(discover([]));
    await reviewChange(branchInput(), options(), deps(plain).deps);
    const withMemory = new FakeProvider(discover([]));
    await reviewChange(branchInput(), options({ memory: memoryOf([EXCEPTION.block]) }), deps(withMemory).deps);
    const norm = (p: FakeProvider) => p.requests.map((r) => r.prompt.replace(/mute-head-\w+/g, "H").replace(/wachiman-review-\w+/g, "R"));
    expect(norm(withMemory)).toEqual(norm(plain));
  });
});

describe("AC5: an exception acts after discovery and what it mutes is listed", () => {
  test("the matching call carries the exception, the discovery prompt never does, and the muted finding is listed with the entry id", async () => {
    const provider = new FakeProvider(discover([NIT, finding({ line: 3, title: "keep me", severity: "fix", topic: "bug" })]), answer({ finding: "f1", entry: EXCEPTION.id }));
    const { deps: d } = deps(provider);
    const result = await reviewChange(branchInput(), options({ memory: memoryOf([EXCEPTION.block]) }), d);

    expect(provider.discoveryCalls).toHaveLength(1);
    expect(provider.discoveryCalls[0].prompt).not.toContain("Do not report stale comments in src");
    expect(provider.discoveryCalls[0].prompt).not.toContain(EXCEPTION.id);
    expect(provider.matchingCalls).toHaveLength(1);
    expect(provider.matchingCalls[0].prompt).toContain("Do not report stale comments in src");
    // Only what may be muted is offered: the Fix finding is not in the matching prompt.
    expect(provider.matchingCalls[0].prompt).toContain("stale comment");
    expect(provider.matchingCalls[0].prompt).not.toContain("keep me");

    expect(result.findings.map((f) => f.title)).toEqual(["keep me"]);
    expect(result.muted).toEqual([{ path: "src/a.ts", line: 2, severity: "consider", topic: "cleanup", title: "stale comment", entry: EXCEPTION.id, reason: "it is that kind of finding" }]);
    expect(result.summary).toStartWith("Looks fine.");
    expect(result.summary).toContain("**Muted by memory**");
    expect(result.summary).toContain("stale comment");
    expect(result.summary).toContain("`src/a.ts:2`");
    expect(result.summary).toContain(`\`${EXCEPTION.id}\``);
    // The matching call is a call of the review: counted, costed.
    expect(result.execution.calls).toBe(2);
    expect(result.execution.costUsdEstimate).toBeCloseTo(0.2);
    expect(validate(resultSchema, JSON.parse(JSON.stringify(result)))).toEqual([]);
    expect("muted" in toResultV1(result)).toBe(false);

    const posted = githubReview(result, { since: null, rebased: false, scoped: false, mention: "/wachiman", automatic: false, instructionChanges: { files: [], baseSha: REV } });
    expect(posted.body).toContain("Muted by memory");
    expect(posted.comments.map((c) => c.body).join("\n")).not.toContain("stale comment");
  });

  test("an Info finding is muted too", async () => {
    const provider = new FakeProvider(discover([finding({ severity: "info", title: "fyi" })]), answer({ finding: "f1", entry: EXCEPTION.id }));
    const result = await reviewChange(branchInput(), options({ memory: memoryOf([EXCEPTION.block]) }), deps(provider).deps);
    expect(result.findings).toEqual([]);
    expect(result.muted?.map((m) => m.title)).toEqual(["fyi"]);
  });

  test("a result with no muted finding has no `muted` field and its summary has no section", async () => {
    const provider = new FakeProvider(discover([NIT]), answer());
    const result = await reviewChange(branchInput(), options({ memory: memoryOf([EXCEPTION.block]) }), deps(provider).deps);
    expect("muted" in result).toBe(false);
    expect(result.summary).toBe("Looks fine.");
    expect(result.findings).toHaveLength(1);
  });
});

describe("AC6: an exception cannot mute a Blocker, a Fix or a security finding", () => {
  const protectedFindings = [
    finding({ line: 1, severity: "blocker", topic: "bug", title: "blocker one" }),
    finding({ line: 2, severity: "fix", topic: "docs", title: "fix one" }),
    finding({ line: 3, severity: "consider", topic: "security", title: "security consider" }),
    finding({ line: 4, severity: "info", topic: "security", title: "security info" }),
  ];

  test("the matching step is not even offered them, so no call is made when they are all there is", async () => {
    const provider = new FakeProvider(discover(protectedFindings));
    const result = await reviewChange(branchInput(), options({ memory: memoryOf([EXCEPTION.block]) }), deps(provider).deps);
    expect(provider.matchingCalls).toHaveLength(0);
    expect(result.findings.map((f) => f.title)).toEqual(protectedFindings.map((f) => f.title));
    expect(result.muted).toBeUndefined();
  });

  test("a matching answer that names every one of them anyway is refused by the engine: all are posted, each with a note naming the entry", async () => {
    const all = [...protectedFindings, finding({ line: 2, title: "real nit" })];
    const provider = new FakeProvider(discover(all), answer(...all.map((_, i) => ({ finding: `f${i + 1}`, entry: EXCEPTION.id }))));
    const result = await reviewChange(branchInput(), options({ memory: memoryOf([EXCEPTION.block]) }), deps(provider).deps);

    expect(provider.matchingCalls).toHaveLength(1);
    expect(result.findings.map((f) => f.title)).toEqual(protectedFindings.map((f) => f.title));
    for (const f of result.findings) expect(f.body).toContain(`Memory exception \`${EXCEPTION.id}\` matched this finding, but memory cannot mute`);
    expect(result.muted?.map((m) => m.title)).toEqual(["real nit"]);
    const posted = githubReview(result, { since: null, rebased: false, scoped: false, mention: "/wachiman", automatic: false, instructionChanges: { files: [], baseSha: REV } });
    expect(posted.comments.map((c) => c.body).join("\n")).toContain("blocker one");
    expect(posted.comments.map((c) => c.body).join("\n")).toContain("fix one");
  });

  test("an answer that names an unknown finding or an unknown entry is ignored", async () => {
    const provider = new FakeProvider(discover([NIT]), answer({ finding: "f7", entry: EXCEPTION.id }, { finding: "f1", entry: "0000000" }));
    const result = await reviewChange(branchInput(), options({ memory: memoryOf([EXCEPTION.block]) }), deps(provider).deps);
    expect(result.findings.map((f) => f.title)).toEqual(["stale comment"]);
    expect(result.muted).toBeUndefined();
  });

  test("the floor applies to the final severity: a finding the verifier raises to Fix is not offered and is posted", async () => {
    const verifying: Step = () => ({ structuredOutput: { verdicts: [{ id: "c1", verdict: "supported", reason: "it is worse than a nit", checked: [{ snapshot: "head", path: "src/a.ts", line: 2 }], severity: "fix" }] } });
    const provider = new FakeProvider(discover([NIT]), answer({ finding: "f1", entry: EXCEPTION.id }), verifying);
    const result = await reviewChange(branchInput(), options({ memory: memoryOf([EXCEPTION.block]) }, "1"), deps(provider).deps);
    expect(result.findings.map((f) => [f.title, f.severity])).toEqual([["stale comment", "fix"]]);
    expect(provider.matchingCalls).toHaveLength(0);
    expect(result.muted).toBeUndefined();
  });

  test("with verification on, a finding the verifier keeps at Consider is matched after it, and the call is made once", async () => {
    const verifying: Step = () => ({ structuredOutput: { verdicts: [{ id: "c1", verdict: "supported", reason: "yes", checked: [{ snapshot: "head", path: "src/a.ts", line: 2 }] }] } });
    const provider = new FakeProvider(discover([NIT]), answer({ finding: "f1", entry: EXCEPTION.id }), verifying);
    const result = await reviewChange(branchInput(), options({ memory: memoryOf([EXCEPTION.block]) }, "1"), deps(provider).deps);
    expect(provider.requests.map((r) => (r.prompt.includes("<exceptions>") ? "match" : r.prompt.includes("<candidates>") ? "verify" : "discover"))).toEqual(["discover", "verify", "match"]);
    expect(result.findings).toEqual([]);
    expect(result.muted?.map((m) => m.title)).toEqual(["stale comment"]);
  });
});

describe("AC17: an exception does not change which files a review reads", () => {
  test("with a path-scoped exception in the base memory, the file is still read and a Fix finding in it is posted", async () => {
    const wide = memoryEntry("exception", "Do not review the files under src", "src/**");
    const provider = new FakeProvider(
      discover([finding({ line: 3, severity: "fix", topic: "bug", title: "real bug under src" })]),
      answer({ finding: "f1", entry: wide.id }),
    );
    const result = await reviewChange(branchInput(), options({ memory: memoryOf([wide.block]) }), deps(provider).deps);

    expect(provider.discoveryCalls[0].prompt).toContain("src/a.ts");
    expect(provider.discoveryCalls[0].prompt).not.toContain("Do not review the files under src");
    expect(result.coverage.expected).toContain("src/a.ts");
    expect(result.coverage.reviewed).toContain("src/a.ts");
    expect(result.findings.map((f) => [f.path, f.severity, f.title])).toEqual([["src/a.ts", "fix", "real bug under src"]]);
    expect(result.muted).toBeUndefined();
  });
});

describe("when the exception does not or cannot apply", () => {
  test("an exception whose scope the diff does not reach causes no call and mutes nothing", async () => {
    const elsewhere = memoryEntry("exception", "Only in docs", "docs/**");
    const provider = new FakeProvider(discover([NIT]));
    const result = await reviewChange(branchInput(), options({ memory: memoryOf([elsewhere.block]) }), deps(provider).deps);
    expect(provider.matchingCalls).toHaveLength(0);
    expect(result.findings).toHaveLength(1);
  });

  test("no Consider or Info candidate means no matching call", async () => {
    const provider = new FakeProvider(discover([finding({ severity: "fix", topic: "bug" })]));
    await reviewChange(branchInput(), options({ memory: memoryOf([EXCEPTION.block]) }), deps(provider).deps);
    expect(provider.matchingCalls).toHaveLength(0);
  });

  test("no memory means no extra call and no change to the result", async () => {
    const provider = new FakeProvider(discover([NIT]));
    const result = await reviewChange(branchInput(), options(), deps(provider).deps);
    expect(provider.requests).toHaveLength(1);
    expect("muted" in result).toBe(false);
  });

  test("a matching call that throws mutes nothing, and the summary and the notices say matching did not run", async () => {
    const provider = new FakeProvider(discover([NIT]), () => {
      throw new Error("provider down");
    });
    const { deps: d, warnings } = deps(provider);
    const result = await reviewChange(branchInput(), options({ memory: memoryOf([EXCEPTION.block]) }), d);
    expect(result.findings.map((f) => f.title)).toEqual(["stale comment"]);
    expect(result.muted).toBeUndefined();
    expect(result.summary).toContain("matching did not run");
    expect(warnings.some((w) => w.includes("matching"))).toBe(true);
    expect(result.execution.notices.some((n) => n.includes("matching"))).toBe(true);
  });

  test("when the provider already rejected the account, no matching call is made and the summary says why", async () => {
    let n = 0;
    const provider = new FakeProvider((r) => {
      const files = ["src/a.ts", "src/b.ts"].filter((f) => r.prompt.includes(f));
      if (n++ === 0) return discover([NIT])(r);
      return { isError: true, terminalReason: "error", providerError: "billing", errorText: `credit balance is too low (${files.join()})` };
    });
    const input = branchInput();
    writeFileSync(join(input.headDir, "src/b.ts"), "const x = 1;\nconst y = 2;\n");
    input.files.push({ filename: "src/b.ts", additions: 2, deletions: 0, patch: "@@ -0,0 +1,2 @@\n+const x = 1;\n+const y = 2;" });
    const { deps: d } = deps(provider);
    const result = await reviewChange(input, options({ memory: memoryOf([EXCEPTION.block]), batchLines: 2 }), d);
    expect(provider.requests.length).toBe(2);
    expect(provider.matchingCalls).toHaveLength(0);
    expect(result.muted).toBeUndefined();
    expect(result.findings.map((f) => f.title)).toEqual(["stale comment"]);
    expect(result.summary).toContain("matching did not run");
  });

  test("an unparseable answer, an error result and a stopped call mute nothing", async () => {
    for (const bad of [
      () => ({ structuredOutput: "f1 matches it" }),
      () => ({ structuredOutput: { matches: [{ finding: "f1" }] } }),
      () => ({ structuredOutput: undefined }),
      () => ({ isError: true, structuredOutput: { matches: [{ finding: "f1", entry: EXCEPTION.id, reason: "r" }] } }),
      () => ({ terminalReason: "budget", structuredOutput: { matches: [{ finding: "f1", entry: EXCEPTION.id, reason: "r" }] } }),
    ] as Step[]) {
      const provider = new FakeProvider(discover([NIT]), bad);
      const result = await reviewChange(branchInput(), options({ memory: memoryOf([EXCEPTION.block]) }), deps(provider).deps);
      expect(result.findings.map((f) => f.title)).toEqual(["stale comment"]);
      expect(result.muted).toBeUndefined();
      expect(result.summary).toContain("matching did not run");
    }
  });

  test("an exception whose holds-while path the diff touches mutes nothing, makes no call, and the summary says it may be out of date", async () => {
    const guarded = memoryEntry("exception", "Handlers get validated input", "src/**", "src/a.ts");
    const provider = new FakeProvider(discover([NIT]), answer({ finding: "f1", entry: guarded.id }));
    const result = await reviewChange(branchInput(), options({ memory: memoryOf([guarded.block]) }), deps(provider).deps);
    expect(provider.matchingCalls).toHaveLength(0);
    expect(result.findings.map((f) => f.title)).toEqual(["stale comment"]);
    expect(result.muted).toBeUndefined();
    expect(result.summary).toContain(`\`${guarded.id}\` may be out of date`);
    expect(result.summary).toContain("`src/a.ts`");
  });

  test("a holds-while path the diff does not touch leaves the exception active", async () => {
    const guarded = memoryEntry("exception", "Handlers get validated input", "src/**", "src/gateway.ts");
    const provider = new FakeProvider(discover([NIT]), answer({ finding: "f1", entry: guarded.id }));
    const result = await reviewChange(branchInput(), options({ memory: memoryOf([guarded.block]) }), deps(provider).deps);
    expect(result.muted?.map((m) => m.entry)).toEqual([guarded.id]);
    expect(result.summary).not.toContain("may be out of date");
  });

  test("a budget with no room left for the matching call mutes nothing and says so", async () => {
    const provider = new FakeProvider((r) => ({ ...discover([NIT])(r), costUsd: 0.19 }), answer({ finding: "f1", entry: EXCEPTION.id }));
    const result = await reviewChange(branchInput(), options({ memory: memoryOf([EXCEPTION.block]), totalBudgetUsd: 0.2 }), deps(provider).deps);
    expect(provider.matchingCalls).toHaveLength(0);
    expect(result.findings.map((f) => f.title)).toEqual(["stale comment"]);
    expect(result.muted).toBeUndefined();
    expect(result.summary).toContain("matching did not run (no budget left");
  });
});
