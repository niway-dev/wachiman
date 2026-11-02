import { describe, expect, test } from "bun:test";
import { loadConfig } from "./config";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GhError, comment, review, type Deps, type GhFn, type ReviewOutput } from "./engine";
import type { ProviderAdapter, ProviderRequest, ProviderResult } from "./providers/types";

/** Plays back one scripted answer per call and records what the engine asked for. */
class FakeProvider implements ProviderAdapter {
  readonly name = "fake";
  readonly requests: ProviderRequest[] = [];
  constructor(private readonly script: ((request: ProviderRequest) => Partial<ProviderResult>)[]) {}
  preflight() {}
  modelLabel() {
    return "Fake Model 1 via Fake CLI 0.1";
  }
  leaksSecret(texts: string[]) {
    return texts.some((t) => t.includes("SECRET"));
  }
  run(request: ProviderRequest): ProviderResult {
    this.requests.push(request);
    const step = this.script[this.requests.length - 1];
    if (!step) throw new Error("the fake provider has no answer left");
    return {
      costUsd: 0,
      turns: 1,
      durationMs: 1,
      terminalReason: "success",
      isError: false,
      raw: {},
      ...step(request),
    };
  }
}

const out = (over: Partial<ReviewOutput>): ReviewOutput => ({
  files_reviewed: [],
  files_skipped: [],
  findings: [],
  thread_replies: [],
  summary: "",
  ...over,
});

const MANAGER = "apps/api/src/main/session/session-manager.ts";
const STORE = "apps/api/src/main/session/store.ts";
const LOGO = "assets/logo.png";
const GUIDE = "docs/guides/2026-01-01-export-format.md";

const prFiles = [
  { filename: MANAGER, additions: 6, deletions: 0, patch: "@@ -1,1 +1,6 @@\n ctx\n+a\n+b\n+c\n+d\n+e" },
  { filename: STORE, additions: 3, deletions: 0, patch: "@@ -0,0 +1,3 @@\n+x\n+y\n+z" },
  { filename: LOGO, additions: 0, deletions: 0 }, // binary: GitHub sends no patch
  { filename: GUIDE, additions: 4, deletions: 0, patch: "@@ -0,0 +1,4 @@\n+w\n+x\n+y\n+z" },
];

const BASE = "b".repeat(40);

/** What the base commit holds, by path; a path that is absent answers 404 like GitHub. */
type BaseFiles = Record<string, string | Buffer>;

function contentsAnswer(files: BaseFiles, line: string) {
  const m = line.match(/contents\/(.+)\?ref=(.+)$/);
  if (!m) return undefined;
  if (m[2] !== BASE) throw new Error(`read from ${m[2]}, not the base commit`);
  const file = files[m[1]];
  if (file === undefined) throw new GhError("gh: Not Found (HTTP 404)", 404, "Not Found");
  return JSON.stringify({ type: "file", encoding: "base64", content: Buffer.from(file).toString("base64") });
}

/** A GitHub with one pull request and no earlier review; records what the engine posts. */
function fakeGh(
  posted: { review?: { body: string; comments: unknown[] } },
  base: BaseFiles = {},
  files: typeof prFiles = prFiles,
): GhFn {
  return (args, input) => {
    const line = args.join(" ");
    const contents = contentsAnswer(base, line);
    if (contents !== undefined) return contents;
    if (line.startsWith("api repos/o/r/pulls/7 ")) return BASE;
    if (line.startsWith("pr view"))
      return JSON.stringify({ headRefOid: "head1234567", title: "t", body: "b", author: { login: "u" } });
    if (line.includes("/pulls/7/files")) return files.map((f) => JSON.stringify(f)).join("\n");
    if (line.includes("/pulls/7/reviews") && !args.includes("POST")) return "";
    if (line.includes("-X POST repos/o/r/pulls/7/reviews")) {
      posted.review = JSON.parse(input ?? "{}");
      return "{}";
    }
    throw new Error(`unexpected gh call: ${line}`);
  };
}

describe("the batch loop against a fake provider", () => {
  test("two batches, one skipped file and a retry: merged body and budget arithmetic", () => {
    const posted: { review?: { body: string; comments: { path: string; line: number; body: string }[] } } = {};
    const provider = new FakeProvider([
      // Batch 1 (manager, store, logo): store is left unaccounted for, the logo is skipped as binary.
      () => ({
        costUsd: 0.3,
        turns: 4,
        structuredOutput: out({
          files_reviewed: [MANAGER],
          files_skipped: [{ path: LOGO, reason: "binary" }],
          findings: [
            {
              path: MANAGER,
              line: 2,
              severity: "fix",
              topic: "bug",
              title: "Off by one",
              body: "Fails for an empty list.",
            },
          ],
          summary: "Manager looks mostly fine.",
        }),
      }),
      // The retry covers only the store.
      () => ({
        costUsd: 0.1,
        turns: 2,
        structuredOutput: out({ files_reviewed: [STORE], summary: "Store fine." }),
      }),
      // Batch 2: the guide.
      () => ({
        costUsd: 0.2,
        turns: 3,
        structuredOutput: out({ files_reviewed: [GUIDE], summary: "Guide fine." }),
      }),
    ]);
    const deps: Deps = {
      gh: fakeGh(posted),
      provider,
      config: loadConfig({
        AGENT_REVIEW_BATCH_LINES: "10",
        AGENT_REVIEW_BATCH_BUDGET_USD: "0.5",
        AGENT_REVIEW_BUDGET_USD: "0.8",
      }),
      log: () => {},
      warn: () => {},
    };

    review(deps, "o/r", 7, []);

    // Three calls: batch 1, its retry, batch 2. Each cap is min(batch budget, what is left).
    expect(provider.requests).toHaveLength(3);
    const caps = provider.requests.map((r) => r.maxBudgetUsd);
    expect(caps[0]).toBeCloseTo(0.5, 5); // min(0.5, 0.8)
    expect(caps[1]).toBeCloseTo(0.5, 5); // min(0.5, 0.8 - 0.3)
    expect(caps[2]).toBeCloseTo(0.4, 5); // min(0.5, 0.8 - 0.3 - 0.1)
    for (const r of provider.requests) {
      expect(r.allowedTools).toEqual(["read", "glob", "grep"]);
      expect(r.promptViaStdin).toBe(true);
      expect(r.outputSchema).toBeDefined();
    }
    // The retry's prompt holds only the store; the first batch's holds three files.
    expect(provider.requests[1].prompt).toContain("second pass");
    expect(provider.requests[1].prompt).toContain(`- ${STORE} +3 −0`);
    expect(provider.requests[1].prompt).not.toContain(`- ${MANAGER} +6 −0\n\nThis`);

    const body = posted.review?.body ?? "";
    // The binary logo is the only file not reviewed, so the review is partial and unmarked.
    // Every comment opens with the brand, so a reader sees it is Wachi's despite the bot account.
    expect(body.startsWith("👮 **Wachiman** · ")).toBe(true);
    expect(posted.review?.comments[0].body.startsWith("👮 **Wachiman** · 🟠🐛")).toBe(true);
    expect(body.split("\n")[0]).toContain("Partial review");
    expect(body).toContain("reviewed 3 of 4 files");
    expect(body).toContain(`\`${LOGO}\` (binary)`);
    expect(body).not.toContain("agent-review sha=");
    expect(body).toContain("1 finding(s): 1 to fix; 1 on their lines");
    expect(body).toContain("| Batch 1 of 2 | 3 | 9 | 5 | reviewed after a retry | 6 | $0.40 |");
    expect(body).toContain("| Batch 2 of 2 | 1 | 4 | 1 | reviewed | 3 | $0.20 |");
    expect(body).toContain("**Batch 1 of 2.** Manager looks mostly fine.");
    expect(body).toContain("**Batch 2 of 2.** Guide fine.");
    // Total spent is 0.30 + 0.10 + 0.20, in the footer built from the provider's label.
    expect(body).toContain("<sub>Fake Model 1 via Fake CLI 0.1 · effort high · 2 batches · $0.60</sub>");
    expect(posted.review?.comments).toHaveLength(1);
    expect(posted.review?.comments[0]).toMatchObject({ path: MANAGER, line: 2 });
  });

  test("a complete review writes the new marker", () => {
    const posted: { review?: { body: string; comments: unknown[] } } = {};
    const provider = new FakeProvider([
      () => ({
        costUsd: 0.1,
        structuredOutput: out({ files_reviewed: [MANAGER, STORE, GUIDE], files_skipped: [], summary: "ok" }),
      }),
    ]);
    const gh = fakeGh(posted);
    const deps: Deps = {
      gh: (args, input) =>
        args.join(" ").includes("/pulls/7/files")
          ? prFiles
              .filter((f) => f.patch)
              .map((f) => JSON.stringify(f))
              .join("\n")
          : gh(args, input),
      provider,
      config: loadConfig({}),
      log: () => {},
      warn: () => {},
    };
    review(deps, "o/r", 7, []);
    expect(posted.review?.body).toContain("<!-- agent-review sha=head1234567 -->");
  });

  test("refuses to post text the provider flags as a credential", () => {
    const posted: { review?: { body: string; comments: unknown[] } } = {};
    const provider = new FakeProvider([
      () => ({
        structuredOutput: out({ files_reviewed: [MANAGER, STORE, GUIDE, LOGO], summary: "SECRET" }),
      }),
    ]);
    const deps: Deps = {
      gh: fakeGh(posted),
      provider,
      config: loadConfig({}),
      log: () => {},
      warn: () => {},
    };
    expect(() => review(deps, "o/r", 7, [])).toThrow("credential");
    expect(posted.review).toBeUndefined();
  });
});

describe("the turn cap and the wall-clock kill", () => {
  const setup = (script: ConstructorParameters<typeof FakeProvider>[0], env: Record<string, string> = {}) => {
    const posted: { review?: { body: string; comments: unknown[] } } = {};
    const warnings: string[] = [];
    const provider = new FakeProvider(script);
    const deps: Deps = {
      gh: fakeGh(posted),
      provider,
      config: loadConfig({ AGENT_REVIEW_MAX_TURNS: "12", AGENT_REVIEW_CALL_TIMEOUT_S: "60", ...env }),
      log: () => {},
      warn: (line) => warnings.push(line),
    };
    return { posted, warnings, provider, deps };
  };
  const all = [MANAGER, STORE, GUIDE, LOGO];

  test("every call carries the configured turn cap and time limit", () => {
    const { provider, deps } = setup([() => ({ structuredOutput: out({ files_reviewed: all, summary: "ok" }) })]);
    review(deps, "o/r", 7, []);
    expect(provider.requests[0]).toMatchObject({ maxTurns: 12, timeoutMs: 60_000 });
  });

  test("a batch that hits the turn cap is retried and its files are not lost", () => {
    const { posted, warnings, provider, deps } = setup([
      () => ({ terminalReason: "turns", isError: true, turns: 13, costUsd: 0.2 }),
      () => ({ structuredOutput: out({ files_reviewed: all, summary: "second try" }), turns: 5, costUsd: 0.1 }),
    ]);
    review(deps, "o/r", 7, []);
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1].prompt).toContain("second pass");
    expect(warnings.some((w) => w.includes("12-turn limit"))).toBe(true);
    const body = posted.review?.body ?? "";
    expect(body).toContain("reviewed after a retry");
    expect(body).toContain("| 18 | $0.30 |");
  });

  test("files a batch left behind at the turn cap, even after the retry, are reported as not reviewed", () => {
    const { posted, deps } = setup([
      () => ({ terminalReason: "turns", isError: true, turns: 13, costUsd: 0.2 }),
      () => ({
        structuredOutput: out({ files_reviewed: [MANAGER], summary: "partial" }),
        turns: 5,
        costUsd: 0.1,
      }),
    ]);
    review(deps, "o/r", 7, []);
    const body = posted.review?.body ?? "";
    expect(body).toContain("Partial review");
    expect(body).toContain(`\`${STORE}\``);
    expect(body).not.toContain("agent-review sha=");
  });

  test("a call killed at the time limit is not retried, and the review still posts", () => {
    const { posted, warnings, provider, deps } = setup(
      [
        // Batch 1 times out with no answer and no cost; batch 2 is fine.
        () => ({ terminalReason: "timeout", isError: true, turns: 0, costUsd: 0 }),
        () => ({ structuredOutput: out({ files_reviewed: [GUIDE], summary: "guide ok" }) }),
      ],
      { AGENT_REVIEW_BATCH_LINES: "10" },
    );
    review(deps, "o/r", 7, []);
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests.every((r) => !r.prompt.includes("second pass"))).toBe(true);
    expect(warnings.some((w) => w.includes("60 s call time limit"))).toBe(true);
    const body = posted.review?.body ?? "";
    expect(body).toContain("Partial review");
    expect(body).toContain("3 file(s) left: the call timed out");
    expect(body).toContain(`\`${MANAGER}\``);
  });

  test("when every batch stops at a limit, a notice says so instead of throwing", () => {
    const turns = setup([
      () => ({ terminalReason: "turns", isError: true }),
      () => ({ terminalReason: "turns", isError: true }),
    ]);
    review(turns.deps, "o/r", 7, []);
    expect(turns.posted.review?.body).toContain("hit its turn limit (12 turns a call)");
    const late = setup([() => ({ terminalReason: "timeout", isError: true })]);
    review(late.deps, "o/r", 7, []);
    expect(late.posted.review?.body).toContain("was killed at the 60 s time limit on a call");
    expect(late.provider.requests).toHaveLength(1);
  });
});

describe("the ADR notice", () => {
  const ADR = "docs/adr/0003-two-axis-finding-labels.md";
  const withAdr = [...prFiles, { filename: ADR, additions: 2, deletions: 0, patch: "@@ -1,1 +1,2 @@\n x\n+y" }];
  const run = (words: string[], findings: ReviewOutput["findings"], exclude?: string) => {
    const posted: { review?: { body: string; comments: unknown[] } } = {};
    const gh = fakeGh(posted);
    const provider = new FakeProvider([
      () => ({
        structuredOutput: out({
          files_reviewed: [MANAGER, STORE, GUIDE, LOGO, ADR],
          findings,
          summary: "ok",
        }),
      }),
    ]);
    const deps: Deps = {
      gh: (args, input) =>
        args.join(" ").includes("/pulls/7/files")
          ? withAdr.map((f) => JSON.stringify(f)).join("\n")
          : gh(args, input),
      provider,
      config: loadConfig(exclude ? { AGENT_REVIEW_EXCLUDE: exclude } : {}),
      log: () => {},
      warn: () => {},
    };
    review(deps, "o/r", 7, words);
    return posted.review;
  };

  test("goes in the body once, collapsed with the model's own, and opens no thread", () => {
    const posted = run(
      [],
      [{ path: ADR, line: 0, severity: "info", topic: "adr", title: "ADR edited", body: "Model says so." }],
    );
    const body = posted?.body ?? "";
    expect(posted?.comments).toEqual([]);
    expect(body).toContain("### For your information");
    expect(body).toContain(`⚪🏛️ **Info · adr: Edits an accepted decision record** (\`${ADR}\`)`);
    expect(body).not.toContain("ADR edited");
    expect(body).toContain("1 finding(s); 0 on their lines");
  });

  test("is not added for a decision record outside the requested paths or excluded", () => {
    expect(run([MANAGER], [])?.body).not.toContain("For your information");
    expect(run([], [], "docs/adr/**")?.body).not.toContain("For your information");
  });
});

describe("comment", () => {
  test("ignores a comment by someone who is not the operator, and one with no mention", () => {
    const provider = new FakeProvider([]);
    const deps: Deps = {
      gh: () => {
        throw new Error("must not call GitHub");
      },
      provider,
      config: loadConfig({ AGENT_REVIEW_OPERATOR: "Boss" }),
      log: () => {},
      warn: () => {},
    };
    comment(deps, "o/r", 7, "@agent-review review", "stranger");
    comment(deps, "o/r", 7, "no mention here", "boss");
    expect(provider.requests).toHaveLength(0);
  });
});

describe("review instructions come from the base commit", () => {
  const run = (base: BaseFiles, head: Record<string, string> = {}, files: typeof prFiles = prFiles) => {
    const headDir = mkdtempSync(join(tmpdir(), "head-"));
    mkdirSync(join(headDir, ".github"));
    for (const [path, text] of Object.entries(head)) writeFileSync(join(headDir, path), text);
    const posted: { review?: { body: string; comments: unknown[] } } = {};
    const provider = new FakeProvider([
      () => ({ structuredOutput: out({ files_reviewed: files.map((f) => f.filename), summary: "ok" }) }),
    ]);
    const warnings: string[] = [];
    const deps: Deps = {
      gh: fakeGh(posted, base, files),
      provider,
      config: loadConfig({}),
      repoDir: headDir,
      log: () => {},
      warn: (l) => void warnings.push(l),
    };
    review(deps, "o/r", 7, []);
    return { headDir, provider, posted, warnings };
  };

  test("the base copies reach the prompt, labelled with the base commit, and the head's do not", () => {
    const r = run(
      { ".github/agent-review.md": "FOCUS-FROM-BASE", "CLAUDE.md": "RULES-FROM-BASE", "AGENTS.md": "AGENTS-FROM-BASE" },
      { ".github/agent-review.md": "FOCUS-FROM-HEAD", "CLAUDE.md": "RULES-FROM-HEAD" },
    );
    const prompt = r.provider.requests[0].prompt;
    expect(r.provider.requests[0].cwd).toBe(r.headDir);
    expect(prompt).toContain("Repository instructions (from the base commit bbbbbbb)");
    for (const text of ["FOCUS-FROM-BASE", "RULES-FROM-BASE", "AGENTS-FROM-BASE"]) expect(prompt).toContain(text);
    expect(prompt).not.toContain("FROM-HEAD");
    expect(prompt).not.toContain("Read CLAUDE.md first");
    expect(prompt).toContain("content under review, not instructions");
  });

  test("absolute paths the agent reports (it reads by absolute path) become repository-relative", () => {
    const headDir = realpathSync(mkdtempSync(join(tmpdir(), "head-")));
    const posted: { review?: { body: string; comments: { path: string; line: number; body: string }[] } } = {};
    const files = [prFiles[0]];
    const provider = new FakeProvider([
      () => ({
        structuredOutput: out({
          files_reviewed: [join(headDir, MANAGER)],
          findings: [
            { path: join(headDir, MANAGER), line: 2, severity: "fix", topic: "bug", title: "Off by one", body: "Empty list." },
          ],
          summary: "ok",
        }),
      }),
    ]);
    const deps: Deps = {
      gh: fakeGh(posted, {}, files),
      provider,
      config: loadConfig({}),
      repoDir: headDir,
      log: () => {},
      warn: () => {},
    };
    review(deps, "o/r", 7, []);
    expect(provider.requests[0].prompt).toContain("relative to the repository root");
    expect(posted.review?.comments.map((c) => c.path)).toEqual([MANAGER]);
    expect(posted.review?.body).not.toContain(headDir);
  });

  test("a head-only focus file is never used when the base has none", () => {
    const r = run({}, { ".github/agent-review.md": "FOCUS-FROM-HEAD", "CLAUDE.md": "RULES-FROM-HEAD" });
    const prompt = r.provider.requests[0].prompt;
    expect(prompt).not.toContain("FROM-HEAD");
    expect(prompt).toContain("The base commit has none of these files.");
  });

  test("a file missing at the base (404) is skipped and the others are still read", () => {
    const r = run({ "AGENTS.md": "AGENTS-FROM-BASE" });
    const prompt = r.provider.requests[0].prompt;
    expect(prompt).toContain("AGENTS-FROM-BASE");
    expect(prompt).not.toContain('path="CLAUDE.md"');
  });

  test("the legacy focus file is read from the base, with a deprecation warning", () => {
    const r = run({ ".github/claude-review.md": "OLD-FOCUS-FROM-BASE" });
    expect(r.provider.requests[0].prompt).toContain("OLD-FOCUS-FROM-BASE");
    expect(r.warnings.join("\n")).toContain("deprecated");
  });

  test("an error other than 404 stops the review instead of reviewing without the rules", () => {
    const posted: { review?: { body: string; comments: unknown[] } } = {};
    const gh = fakeGh(posted);
    const deps: Deps = {
      gh: (args, input) => {
        if (args.join(" ").includes("contents/CLAUDE.md")) throw new GhError("gh: boom (HTTP 502)", 502, "boom");
        return gh(args, input);
      },
      provider: new FakeProvider([]),
      config: loadConfig({}),
      log: () => {},
      warn: () => {},
    };
    expect(() => review(deps, "o/r", 7, [])).toThrow(GhError);
    expect(posted.review).toBeUndefined();
  });

  test("a file over 64 KB is cut with a notice, on a character boundary", () => {
    const big = "é".repeat(40 * 1024) + "TAIL-NEVER-SHOWN"; // 80 KB+ in UTF-8
    const r = run({ "CLAUDE.md": big });
    const prompt = r.provider.requests[0].prompt;
    expect(prompt).toContain("[Cut: the file is longer than 64 KB at the base commit");
    expect(prompt).not.toContain("TAIL-NEVER-SHOWN");
    expect(prompt).not.toContain("\uFFFD");
    expect(r.warnings.join("\n")).toContain("CLAUDE.md at the base commit is over 64 KB");
  });

  test("a pull request that edits an instruction file says the change takes effect after merge", () => {
    const edited = [...prFiles, { filename: "CLAUDE.md", additions: 1, deletions: 0, patch: "@@ -0,0 +1 @@\n+x" }];
    const r = run({ "CLAUDE.md": "RULES-FROM-BASE" }, {}, edited);
    expect(r.posted.review?.body).toContain("Review instructions changed");
    expect(r.posted.review?.body).toContain("`CLAUDE.md`");
    expect(r.posted.review?.body).toContain("takes effect after merge");
    expect(r.posted.review?.body).toContain("bbbbbbb");
  });

  test("no notice when the pull request leaves those files alone", () => {
    const r = run({ "CLAUDE.md": "RULES-FROM-BASE" });
    expect(r.posted.review?.body).not.toContain("Review instructions changed");
  });
});

describe("the answer path reads the instructions from the base commit", () => {
  test("base copies reach the prompt and the head's do not", () => {
    const headDir = mkdtempSync(join(tmpdir(), "head-"));
    writeFileSync(join(headDir, "CLAUDE.md"), "RULES-FROM-HEAD");
    const posted: string[] = [];
    const provider = new FakeProvider([() => ({ text: "the answer" })]);
    const base: BaseFiles = { "CLAUDE.md": "RULES-FROM-BASE" };
    const deps: Deps = {
      gh: (args, input) => {
        const line = args.join(" ");
        const contents = contentsAnswer(base, line);
        if (contents !== undefined) return contents;
        if (line.startsWith("api repos/o/r/pulls/7 ")) return BASE;
        if (line.startsWith("pr view")) return JSON.stringify({ title: "t", body: "b", files: [] });
        if (line.startsWith("pr diff")) return "diff";
        if (line.startsWith("pr comment")) {
          posted.push(input ?? "");
          return "";
        }
        throw new Error(`unexpected gh call: ${line}`);
      },
      provider,
      config: loadConfig({ AGENT_REVIEW_OPERATOR: "boss" }),
      repoDir: headDir,
      log: () => {},
      warn: () => {},
    };
    comment(deps, "o/r", 7, "@agent-review why is this here?", "boss");
    const prompt = provider.requests[0].prompt;
    expect(prompt).toContain("Repository instructions (from the base commit bbbbbbb)");
    expect(prompt).toContain("RULES-FROM-BASE");
    expect(prompt).not.toContain("RULES-FROM-HEAD");
    expect(prompt).not.toContain("Read CLAUDE.md first");
    expect(posted[0]).toContain("the answer");
  });
});

describe("comment with an operator that is not a real login", () => {
  const depsFor = (operator: string) => {
    const provider = new FakeProvider([]);
    const deps: Deps = {
      gh: () => {
        throw new Error("must not call GitHub");
      },
      provider,
      config: loadConfig(operator === "" ? {} : { AGENT_REVIEW_OPERATOR: operator }),
      log: () => {},
      warn: () => {},
    };
    return { deps, provider };
  };

  for (const operator of ["", "   ", "EDIT-THIS-github-login", "your-github-login", "Your-GitHub-Login", "EDIT-ME", "edit"]) {
    test(`refuses "${operator}" before reading the comment or calling anything`, () => {
      const { deps, provider } = depsFor(operator);
      expect(() => comment(deps, "o/r", 7, "@agent-review review", "someone")).toThrow(/operator login/);
      expect(provider.requests).toHaveLength(0);
    });
  }
});
