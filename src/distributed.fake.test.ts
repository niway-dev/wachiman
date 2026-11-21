import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config";
import type { ContractReading, DistributedContext, ResolvedSibling } from "./distributed";
import { reviewChange, reviewOptionsOf, type CoreDeps, type ReviewInput, type ReviewOptions, type ReviewOutput } from "./engine";
import { REMOVED_REFERENCE } from "./sibling-references";
import { VERIFY_SCHEMA, verifySchema } from "./verify";
import type { ProviderAdapter, ProviderRequest, ProviderResult } from "./providers/types";

// Distributed-repo design, "How a run picks its siblings" step 6: only the batches that hold a file
// which triggered a contract get the snapshots (as extra directories) and the contract section;
// every other batch is byte-identical to a run without the feature; the verifier gets every snapshot.
// The names are invented.

class FakeProvider implements ProviderAdapter {
  readonly name = "fake";
  readonly requests: ProviderRequest[] = [];
  constructor(private readonly answer: (request: ProviderRequest, call: number) => Partial<ProviderResult>) {}
  preflight() {}
  modelLabel() {
    return "Fake Model 1 via Fake CLI 0.1";
  }
  leaksSecret() {
    return false;
  }
  async run(request: ProviderRequest): Promise<ProviderResult> {
    this.requests.push(request);
    return { costUsd: 0, turns: 1, durationMs: 1, terminalReason: "success", isError: false, raw: {}, ...this.answer(request, this.requests.length) };
  }
}

const out = (over: Partial<ReviewOutput>): ReviewOutput => ({ files_reviewed: [], files_skipped: [], findings: [], thread_replies: [], summary: "", ...over });

/** The files the prompt lists, so a fake reviewer can answer for exactly what it was given. */
const filesIn = (prompt: string) => {
  const part = prompt.split("This part holds exactly these files")[1]?.split("Each diff line")[0] ?? "";
  return [...part.matchAll(/^- (\S+) \+\d+ −\d+/gm)].map((m) => m[1]);
};
const answersForItsFiles = (request: ProviderRequest) => ({ costUsd: 0.1, structuredOutput: out({ files_reviewed: filesIn(request.prompt), summary: "s" }) });

const SHA_A = "3f2a9c1".padEnd(40, "0");
const SHA_B = "9d8e7f6".padEnd(40, "0");

const made: string[] = [];
const tmp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function reviewedHead() {
  const headDir = tmp("distributed-head-");
  mkdirSync(join(headDir, "src"), { recursive: true });
  writeFileSync(join(headDir, "src/a.ts"), "export const a = 1;\nexport const b = 2;\n");
  writeFileSync(join(headDir, "src/b.ts"), "export const c = 3;\nexport const d = 4;\n");
  return headDir;
}

function input(headDir: string, files: ReviewInput["files"]): ReviewInput {
  const base = JSON.parse(readFileSync(join(import.meta.dir, "../test/fixtures/formats/review-input.branch.json"), "utf8"));
  return { ...base, files, headDir };
}

const TWO_FILES = [
  { filename: "src/a.ts", additions: 2, deletions: 0, patch: "@@ -0,0 +1,2 @@\n+export const a = 1;\n+export const b = 2;" },
  { filename: "src/b.ts", additions: 2, deletions: 0, patch: "@@ -0,0 +1,2 @@\n+export const c = 3;\n+export const d = 4;" },
];

/** A snapshot directory the way `snapshotSibling` leaves one: plain files, no `.git`. */
function snapshotDir(file: string, text: string) {
  const dir = tmp("distributed-snapshot-");
  mkdirSync(join(dir, file.split("/").slice(0, -1).join("/")), { recursive: true });
  writeFileSync(join(dir, file), text);
  return dir;
}

const sibling = (over: Partial<ResolvedSibling> & Pick<ResolvedSibling, "member">): ResolvedSibling => ({
  repo: `acme/${over.member}`,
  visibility: "private",
  contracts: ["brand-palette"],
  byHand: false,
  rule: "tip",
  ruleSource: "default",
  readAs: "tip",
  sha: SHA_A,
  paths: ["Assets/palette.json"],
  status: "read",
  droppedSymlinks: [],
  droppedSubmodules: [],
  ...over,
});

const palette = (desktop: ResolvedSibling): ContractReading => ({
  name: "brand-palette",
  triggerPaths: ["src/a.ts"],
  reviewedMember: "web-site",
  reviewedRoles: ["consumer"],
  holdsSource: false,
  sides: [
    { member: "desktop-app", role: "provider", paths: ["Assets/palette.json"] },
    { member: "web-site", role: "consumer", paths: ["src/**"] },
  ],
  sourceOfTruth: { member: "desktop-app", paths: ["Assets/palette.json"] },
});

function context(siblings: ResolvedSibling[], contracts: ContractReading[]): DistributedContext {
  return { manifestPath: "/workspace/workspace.manifest.json", reviewed: "web-site", contracts, siblings };
}

const options = (over: Partial<ReviewOptions> = {}): ReviewOptions => ({
  ...reviewOptionsOf(loadConfig({ WACHIMAN_VERIFY: "0" }), 5),
  batchLines: 1,
  ...over,
});

function coreDeps(provider: FakeProvider, verifier?: FakeProvider): CoreDeps {
  return { provider, ...(verifier ? { verifier } : {}), log: () => {}, warn: () => {}, sleep: () => {}, rateLimitBackoffMs: 0 };
}

/** The scratch directories have random names; nothing else may differ between two runs. */
const scrub = (text: string) => text.replace(/(wachiman-review|distributed-[a-z]+|agent-verify)-[A-Za-z0-9]+/g, "$1-X");
const forFile = (provider: FakeProvider, file: string) => provider.requests.find((r) => filesIn(r.prompt).includes(file))!;

describe("the batches of a distributed-repo run", () => {
  test("only the batch that holds a triggering file gets the section and the snapshot; the other is byte-identical to a run without the feature", async () => {
    const headDir = reviewedHead();
    const desktop = sibling({ member: "desktop-app", dir: snapshotDir("Assets/palette.json", '{"accent":"#112233"}\n') });
    const without = new FakeProvider(answersForItsFiles);
    await reviewChange(input(headDir, TWO_FILES), options(), coreDeps(without));
    const withSiblings = new FakeProvider(answersForItsFiles);
    await reviewChange(input(headDir, TWO_FILES), options({ distributed: context([desktop], [palette(desktop)]) }), coreDeps(withSiblings));

    expect(withSiblings.requests).toHaveLength(2);
    const triggered = forFile(withSiblings, "src/a.ts");
    expect(triggered.addDirs).toContain(desktop.dir!);
    expect(triggered.prompt).toContain("brand-palette");
    expect(triggered.prompt).toContain("desktop-app");
    expect(triggered.prompt).toContain(SHA_A);
    expect(triggered.prompt).toContain(desktop.dir!);
    // How to cite, with the member, the short commit, the path and the line.
    expect(triggered.prompt).toContain("`member@sha:path:line`");
    expect(triggered.prompt).toContain("desktop-app@3f2a9c1:path/to/file:12");
    expect(triggered.prompt).toContain("provider");
    expect(triggered.prompt).toContain("consumer");

    const other = forFile(withSiblings, "src/b.ts");
    const baseline = forFile(without, "src/b.ts");
    expect(scrub(other.prompt)).toBe(scrub(baseline.prompt));
    expect(other.addDirs).toHaveLength(baseline.addDirs.length);
    expect(other.addDirs).not.toContain(desktop.dir!);
    expect(other.prompt).not.toContain("desktop-app");
    // Everything else the call carries is the same too.
    expect({ ...other, prompt: "", addDirs: [], cwd: "" }).toEqual({ ...baseline, prompt: "", addDirs: [], cwd: "" });

    // The triggering batch's prompt is the plain one with the section after it.
    const plain = forFile(without, "src/a.ts");
    expect(scrub(triggered.prompt).startsWith(scrub(plain.prompt))).toBe(true);
  });

  test("a rename triggers through its old path", async () => {
    const headDir = reviewedHead();
    const desktop = sibling({ member: "desktop-app", dir: snapshotDir("Assets/palette.json", "{}\n") });
    const contract = { ...palette(desktop), triggerPaths: ["src/old-name.ts"] };
    const files = [{ ...TWO_FILES[0], previous_filename: "src/old-name.ts" }, TWO_FILES[1]];
    const provider = new FakeProvider(answersForItsFiles);
    await reviewChange(input(headDir, files), options({ distributed: context([desktop], [contract]) }), coreDeps(provider));
    expect(forFile(provider, "src/a.ts").addDirs).toContain(desktop.dir!);
    expect(forFile(provider, "src/b.ts").addDirs).not.toContain(desktop.dir!);
  });

  test("a batch that holds a trigger and another file gets the section, and its retry over the other file alone does not", async () => {
    const headDir = reviewedHead();
    const desktop = sibling({ member: "desktop-app", dir: snapshotDir("Assets/palette.json", "{}\n") });
    // One batch with both files; the first call leaves src/b.ts unaccounted for, so a retry covers it alone.
    const provider = new FakeProvider((request) =>
      request.prompt.includes("second pass")
        ? answersForItsFiles(request)
        : { costUsd: 0.1, structuredOutput: out({ files_reviewed: ["src/a.ts"], summary: "s" }) },
    );
    await reviewChange(input(headDir, TWO_FILES), options({ batchLines: 1000, distributed: context([desktop], [palette(desktop)]) }), coreDeps(provider));
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[0].addDirs).toContain(desktop.dir!);
    expect(provider.requests[0].prompt).toContain("brand-palette");
    expect(provider.requests[1].prompt).toContain("second pass");
    expect(provider.requests[1].addDirs).not.toContain(desktop.dir!);
    expect(provider.requests[1].prompt).not.toContain("brand-palette");
  });

  test("a sibling that was not cloned is named in the section and adds no directory", async () => {
    const headDir = reviewedHead();
    const missing = sibling({ member: "desktop-app", status: "not-cloned", sha: undefined, paths: [] });
    const provider = new FakeProvider(answersForItsFiles);
    await reviewChange(input(headDir, TWO_FILES), options({ distributed: context([missing], [palette(missing)]) }), coreDeps(provider));
    const triggered = forFile(provider, "src/a.ts");
    expect(triggered.prompt).toContain("desktop-app");
    expect(triggered.prompt).toContain("not cloned: not checked");
    expect(triggered.addDirs).toHaveLength(1);
  });

  test("a context with no contract and no hand-added member changes nothing", async () => {
    const headDir = reviewedHead();
    const without = new FakeProvider(answersForItsFiles);
    await reviewChange(input(headDir, TWO_FILES), options(), coreDeps(without));
    const empty = new FakeProvider(answersForItsFiles);
    await reviewChange(input(headDir, TWO_FILES), options({ distributed: context([], []) }), coreDeps(empty));
    expect(empty.requests.map((r) => scrub(r.prompt))).toEqual(without.requests.map((r) => scrub(r.prompt)));
    expect(empty.requests.map((r) => r.addDirs.length)).toEqual(without.requests.map((r) => r.addDirs.length));
  });

  test("a member added by hand with --sibling reaches every batch", async () => {
    const headDir = reviewedHead();
    const hand = sibling({ member: "api-client", contracts: ["--sibling"], byHand: true, paths: ["src/index.ts"], dir: snapshotDir("src/index.ts", "export {};\n") });
    const provider = new FakeProvider(answersForItsFiles);
    await reviewChange(input(headDir, TWO_FILES), options({ distributed: context([hand], []) }), coreDeps(provider));
    for (const file of ["src/a.ts", "src/b.ts"]) {
      const request = forFile(provider, file);
      expect(request.addDirs).toContain(hand.dir!);
      expect(request.prompt).toContain("api-client");
      expect(request.prompt).toContain("Added by hand with --sibling");
    }
  });
});

describe("the verifier of a distributed-repo run", () => {
  const finding = { path: "src/b.ts", line: 1, severity: "fix", topic: "bug", confidence: "high", title: "t", body: "b" } as const;
  const verdicts = { verdicts: [{ id: "c1", verdict: "supported", reason: "yes", checked: [{ snapshot: "head", path: "src/b.ts", line: 1 }] }] };

  test("gets every snapshot of the run, also those of contracts that no finding came from", async () => {
    const headDir = reviewedHead();
    const desktop = sibling({ member: "desktop-app", dir: snapshotDir("Assets/palette.json", "{}\n") });
    const billing = sibling({ member: "billing-service", contracts: ["billing-api"], sha: SHA_B, paths: ["src/routes/x.ts"], dir: snapshotDir("src/routes/x.ts", "export {};\n") });
    const billingContract: ContractReading = {
      name: "billing-api",
      triggerPaths: ["src/a.ts"],
      reviewedMember: "web-site",
      reviewedRoles: ["consumer"],
      holdsSource: false,
      sides: [
        { member: "billing-service", role: "provider", paths: ["src/routes/**"] },
        { member: "web-site", role: "consumer", paths: ["src/**"] },
      ],
      sourceOfTruth: { member: "billing-service", paths: ["src/routes/**"] },
    };
    // The finding is in src/b.ts, which triggered nothing; both snapshots still reach the verifier.
    const provider = new FakeProvider((request) => ({ costUsd: 0.1, structuredOutput: out({ files_reviewed: filesIn(request.prompt), findings: filesIn(request.prompt).includes("src/b.ts") ? [finding] : [], summary: "s" }) }));
    const verifier = new FakeProvider(() => ({ costUsd: 0.1, structuredOutput: verdicts }));
    const result = await reviewChange(
      input(headDir, TWO_FILES),
      options({ ...reviewOptionsOf(loadConfig({ WACHIMAN_VERIFY: "1" }), 5), batchLines: 1, distributed: context([desktop, billing], [palette(desktop), billingContract]) }),
      coreDeps(provider, verifier),
    );
    expect(result.findings).toHaveLength(1);
    expect(verifier.requests).toHaveLength(1);
    const call = verifier.requests[0];
    expect(call.addDirs).toContain(desktop.dir!);
    expect(call.addDirs).toContain(billing.dir!);
    expect(call.prompt).toContain("desktop-app@3f2a9c1");
    expect(call.prompt).toContain("billing-service@9d8e7f6");
  });

  test("a disproof found only in a sibling snapshot can be cited, and drops the finding; the schema and prompt say how", async () => {
    const headDir = reviewedHead();
    const billing = sibling({ member: "billing-service", contracts: ["billing-api"], sha: SHA_B, paths: ["src/routes/x.ts"], dir: snapshotDir("src/routes/x.ts", "export {};\nexport const guard = 1;\n") });
    const contract: ContractReading = {
      name: "billing-api",
      triggerPaths: ["src/a.ts"],
      reviewedMember: "web-site",
      reviewedRoles: ["consumer"],
      holdsSource: false,
      sides: [{ member: "billing-service", role: "provider", paths: ["src/routes/**"] }, { member: "web-site", role: "consumer", paths: ["src/**"] }],
      sourceOfTruth: { member: "billing-service", paths: ["src/routes/**"] },
    };
    const cite = (line: number, over: Record<string, unknown> = {}) => ({ snapshot: "head", member: "billing-service", sha: "9d8e7f6", path: "src/routes/x.ts", line, ...over });
    const run = async (disproof: object) => {
      const provider = new FakeProvider((request) => ({ costUsd: 0.1, structuredOutput: out({ files_reviewed: filesIn(request.prompt), findings: filesIn(request.prompt).includes("src/b.ts") ? [finding] : [], summary: "s" }) }));
      const verifier = new FakeProvider(() => ({ costUsd: 0.1, structuredOutput: { verdicts: [{ id: "c1", verdict: "refuted", reason: "guarded in billing-service", checked: [cite(2)], disproof }] } }));
      const result = await reviewChange(input(headDir, TWO_FILES), options({ ...reviewOptionsOf(loadConfig({ WACHIMAN_VERIFY: "1" }), 5), batchLines: 1, distributed: context([billing], [contract]) }), coreDeps(provider, verifier));
      return { result, call: verifier.requests[0] };
    };
    const good = await run(cite(2));
    expect(good.result.findings).toHaveLength(0);
    expect(good.result.verification?.entries[0]).toMatchObject({ outcome: "dropped", disproof: { member: "billing-service", sha: SHA_B, path: "src/routes/x.ts", line: 2 } });
    expect(good.call.outputSchema).toEqual(verifySchema(true));
    expect(good.call.prompt).toContain('"member"');
    // The same citation with a line the sibling does not have, or a commit that is not its snapshot's, is not evidence: the finding stays, inconclusive.
    for (const bad of [cite(3), cite(2, { sha: "3f2a9c1" }), cite(2, { member: "web-site" })]) {
      const { result } = await run(bad);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].verification.status).toBe("inconclusive");
    }
  });

  test("without siblings read, the verifier's prompt and directories are the usual ones", async () => {
    const headDir = reviewedHead();
    const run = async (distributed?: DistributedContext) => {
      const provider = new FakeProvider((request) => ({ costUsd: 0.1, structuredOutput: out({ files_reviewed: filesIn(request.prompt), findings: filesIn(request.prompt).includes("src/b.ts") ? [finding] : [], summary: "s" }) }));
      const verifier = new FakeProvider(() => ({ costUsd: 0.1, structuredOutput: verdicts }));
      await reviewChange(input(headDir, TWO_FILES), options({ ...reviewOptionsOf(loadConfig({ WACHIMAN_VERIFY: "1" }), 5), batchLines: 1, ...(distributed ? { distributed } : {}) }), coreDeps(provider, verifier));
      return verifier.requests[0];
    };
    const missing = sibling({ member: "desktop-app", status: "not-cloned", sha: undefined, paths: [] });
    const plain = await run();
    const noneRead = await run(context([missing], [palette(missing)]));
    expect(scrub(noneRead.prompt)).toBe(scrub(plain.prompt));
    expect(noneRead.addDirs).toHaveLength(plain.addDirs.length);
    // The schema is the one a run without the feature sends, not a copy with member and sha in it.
    expect(noneRead.outputSchema).toBe(VERIFY_SCHEMA);
    expect(plain.outputSchema).toBe(VERIFY_SCHEMA);
  });
});

describe("the result of a distributed-repo run", () => {
  const cited = (body: string) => ({ path: "src/a.ts", line: 1, severity: "fix", topic: "bug", confidence: "high", title: "The accent drifts", body }) as const;
  const reviewer = (body: string) =>
    new FakeProvider((request) => ({ costUsd: 0.1, structuredOutput: out({ files_reviewed: filesIn(request.prompt), findings: filesIn(request.prompt).includes("src/a.ts") ? [cited(body)] : [], summary: "s" }) }));
  const palette2 = '{\n  "accent": "#112233"\n}\n';

  test("carries the siblings without their directories, the contracts, the private-context label and the checked references", async () => {
    const headDir = reviewedHead();
    const desktop = sibling({ member: "desktop-app", ruleSource: "user-file", fetchedAt: "2026-11-18T09:30:00.000Z", dir: snapshotDir("Assets/palette.json", palette2) });
    const missing = sibling({ member: "brand-assets", visibility: "public", status: "not-cloned", sha: undefined, paths: [] });
    const provider = reviewer("The source says desktop-app@3f2a9c1:Assets/palette.json:2, and also desktop-app@3f2a9c1:Assets/palette.json:30.");
    const result = await reviewChange(input(headDir, TWO_FILES), options({ distributed: context([desktop, missing], [palette(desktop)]) }), coreDeps(provider));

    expect(result.format).toBe("wachiman.review-result/2");
    expect(result.siblings?.map((s) => [s.member, s.status, s.ruleSource, s.sha?.slice(0, 7), s.fetchedAt])).toEqual([
      ["desktop-app", "read", "user-file", "3f2a9c1", "2026-11-18T09:30:00.000Z"],
      ["brand-assets", "not-cloned", "default", undefined, undefined],
    ]);
    for (const row of result.siblings!) expect(row).not.toHaveProperty("dir");
    expect(JSON.stringify(result)).not.toContain(desktop.dir!);
    expect(result.workspaceContractsApplied).toEqual(["brand-palette"]);
    expect(result).not.toHaveProperty("noWorkspaceContractApplied");
    // A private sibling that was read labels the result; a public one that was not read does not.
    expect(result.privateContext).toEqual({ members: ["desktop-app"] });
    expect(result.removedSiblingReferences).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.references).toEqual([{ member: "desktop-app", sha: SHA_A, path: "Assets/palette.json", line: 2 }]);
    expect(result.findings[0]!.body).toBe(`The source says desktop-app@3f2a9c1:Assets/palette.json:2, and also ${REMOVED_REFERENCE}.`);
  });

  test("every model-written text of the result is checked, not only the findings: contracts, risk map, verifier entries, summary; one removed total", async () => {
    const headDir = reviewedHead();
    const desktop = sibling({ member: "desktop-app", dir: snapshotDir("Assets/palette.json", palette2) });
    const bad = "desktop-app@3f2a9c1:Assets/palette.json:99";
    const good = "desktop-app@3f2a9c1:Assets/palette.json:2";
    const provider = new FakeProvider((request) => {
      const hasA = filesIn(request.prompt).includes("src/a.ts");
      return {
        costUsd: 0.1,
        structuredOutput: out({
          files_reviewed: filesIn(request.prompt),
          findings: hasA ? [cited("Plain.")] : [],
          contracts: hasA
            ? [{ action: "Paint the accent", location: "src/a.ts:1", status: "closed", evidence: ["src/a.ts:1"], before_after: `Before ${bad}, after ${good}.`, visible_effect: `Seen at ${bad}`, failure_mode: `Fails at ${bad}`, open_question: `Ask ${bad}` }]
            : [],
          risk_facts: hasA ? [{ kind: "public-contract", path: "src/a.ts", line: 1, why: `Shared with ${bad}` }] : [],
          judgement: hasA ? [{ kind: "direction", path: "src/a.ts", line: 1, why: `Decide at ${bad}` }] : [],
          summary: hasA ? `Summary ${bad}` : "",
        }),
      };
    });
    const verifier = new FakeProvider(() => ({
      costUsd: 0.1,
      structuredOutput: { verdicts: [{ id: "c1", verdict: "refuted", reason: `Guarded at ${bad}`, checked: [{ snapshot: "head", path: "src/a.ts", line: 1 }], disproof: { snapshot: "head", path: "src/a.ts", line: 2 } }] },
    }));
    const result = await reviewChange(
      input(headDir, TWO_FILES),
      options({ ...reviewOptionsOf(loadConfig({ WACHIMAN_VERIFY: "1" }), 5), batchLines: 1, distributed: context([desktop], [palette(desktop)]) }),
      coreDeps(provider, verifier),
    );
    const gone = REMOVED_REFERENCE;
    expect(result.findings).toHaveLength(0);
    expect(result.verification?.entries[0]).toMatchObject({ outcome: "dropped", reason: `Guarded at ${gone}` });
    expect(result.summary).toBe(`Summary ${gone}`);
    expect(result.contracts[0]).toMatchObject({ before_after: `Before ${gone}, after ${good}.`, visible_effect: `Seen at ${gone}`, failure_mode: `Fails at ${gone}`, open_question: `Ask ${gone}` });
    expect(result.riskMap.facts[0]?.why).toBe(`Shared with ${gone}`);
    expect(result.riskMap.judgement[0]?.why).toBe(`Decide at ${gone}`);
    // summary, entry reason, four contract fields, one fact, one judgement item
    expect(result.removedSiblingReferences).toBe(8);
    expect(JSON.stringify(result)).not.toContain(bad);
  });

  test("a snapshot's temporary directory the model repeats never reaches the result", async () => {
    const headDir = reviewedHead();
    const desktop = sibling({ member: "desktop-app", dir: snapshotDir("Assets/palette.json", palette2) });
    const provider = reviewer(`The source is in ${desktop.dir}/Assets/palette.json:2 and ${desktop.dir}/Assets/palette.json:50; the folder is ${desktop.dir}.`);
    const result = await reviewChange(input(headDir, TWO_FILES), options({ distributed: context([desktop], [palette(desktop)]) }), coreDeps(provider));
    expect(result.findings[0]!.body).toBe(`The source is in desktop-app@3f2a9c1:Assets/palette.json:2 and ${REMOVED_REFERENCE}; the folder is desktop-app@3f2a9c1.`);
    expect(result.findings[0]!.references).toEqual([{ member: "desktop-app", sha: SHA_A, path: "Assets/palette.json", line: 2 }]);
    expect(result.removedSiblingReferences).toBe(1);
    expect(JSON.stringify(result)).not.toContain(desktop.dir!);
  });

  test("a result that read only public siblings, or none, has no private-context label", async () => {
    const headDir = reviewedHead();
    const open = sibling({ member: "desktop-app", visibility: "public", dir: snapshotDir("Assets/palette.json", palette2) });
    const publicOnly = await reviewChange(input(headDir, TWO_FILES), options({ distributed: context([open], [palette(open)]) }), coreDeps(new FakeProvider(answersForItsFiles)));
    expect(publicOnly.siblings).toHaveLength(1);
    expect(publicOnly).not.toHaveProperty("privateContext");
    const missing = sibling({ member: "desktop-app", status: "not-cloned", sha: undefined, paths: [] });
    const notRead = await reviewChange(input(headDir, TWO_FILES), options({ distributed: context([missing], [palette(missing)]) }), coreDeps(new FakeProvider(answersForItsFiles)));
    expect(notRead).not.toHaveProperty("privateContext");
  });

  test("a run that applied no contract says so, and still lists its siblings and the removed count", async () => {
    const headDir = reviewedHead();
    const result = await reviewChange(input(headDir, TWO_FILES), options({ distributed: context([], []) }), coreDeps(new FakeProvider(answersForItsFiles)));
    expect(result.siblings).toEqual([]);
    expect(result.workspaceContractsApplied).toEqual([]);
    expect(result.noWorkspaceContractApplied).toBe(true);
    expect(result.removedSiblingReferences).toBe(0);
    expect(result).not.toHaveProperty("privateContext");
  });

  test("a finding whose only sibling reference was removed stays, without the reference", async () => {
    const headDir = reviewedHead();
    const desktop = sibling({ member: "desktop-app", dir: snapshotDir("Assets/palette.json", palette2) });
    const result = await reviewChange(input(headDir, TWO_FILES), options({ distributed: context([desktop], [palette(desktop)]) }), coreDeps(reviewer("Compare with desktop-app@3f2a9c1:Assets/nowhere.json:1.")));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).not.toHaveProperty("references");
    expect(result.findings[0]!.body).toBe(`Compare with ${REMOVED_REFERENCE}.`);
    expect(result.removedSiblingReferences).toBe(1);
  });

  test("without the mode the result has none of the new fields and is what it was", async () => {
    const headDir = reviewedHead();
    // The text a model could write is left alone too: nothing is checked, nothing is removed.
    const body = "Compare with desktop-app@3f2a9c1:Assets/palette.json:2.";
    const result = await reviewChange(input(headDir, TWO_FILES), options(), coreDeps(reviewer(body)));
    for (const key of ["siblings", "workspaceContractsApplied", "noWorkspaceContractApplied", "privateContext", "removedSiblingReferences"]) expect(result, key).not.toHaveProperty(key);
    expect(result.findings[0]!.body).toBe(body);
    expect(result.findings[0]).not.toHaveProperty("references");
    expect(Object.keys(JSON.parse(JSON.stringify(result))).sort()).toEqual(
      ["batches", "change", "contracts", "coverage", "engine", "execution", "findings", "format", "instructionChanges", "provider", "riskMap", "summary", "threadReplies"].sort(),
    );
  });
});
