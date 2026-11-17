import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { countLine, MAX_BODY_CHARS, type ReviewResult } from "../engine";
import { REVIEW_RESULT_V2, toResultV1 } from "../formats";
import { annotateUnverified } from "../verify";
import { AGENT_PROMPT_INTRO, agentPrompt } from "./agent-prompt";
import { renderJson } from "./json";
import { renderMarkdown } from "./markdown";
import { renderTerminal } from "./terminal";

/** The /1 example, read as a /2 result: every finding unverified, origin unknown. */
const example = (): ReviewResult => {
  const v1 = JSON.parse(readFileSync(join(import.meta.dir, "../../test/fixtures/formats/review-result.example.json"), "utf8"));
  const verified = annotateUnverified(v1.findings);
  return { ...v1, format: REVIEW_RESULT_V2, findings: v1.findings.map((f: { anchor: "diff" | "outside" }, i: number) => ({ ...verified[i], anchor: f.anchor })) };
};

/** The example as a local run with every file reviewed. */
const local = (): ReviewResult => {
  const r = example();
  r.change = {
    kind: "branch",
    describe: "branch `feat/x` of repo against main (merge-base bbbbbbb)",
    repository: { name: "repo" },
    base: { sha: "b".repeat(40), ref: "main" },
    head: { sha: "a".repeat(40), ref: "feat/x" },
    title: "feat/x",
  };
  r.provider.profile = "default";
  r.coverage.reviewed = [...r.coverage.expected];
  r.coverage.skipped = [];
  return r;
};

/** The same result with 300 findings: its Markdown is far above GitHub's body limit. */
const big = (): ReviewResult => {
  const r = local();
  r.findings = Array.from({ length: 300 }, (_, i) => ({
    path: `src/file-${i}.ts`,
    line: i + 1,
    severity: "consider" as const,
    topic: "bug" as const,
    confidence: "medium" as const,
    title: `Finding number ${i} with a reasonably long title`,
    body: `The body of finding ${i}. ${"It explains the defect in some detail. ".repeat(6)}`,
    anchor: "diff" as const,
  }));
  return r;
};

const SHA7 = "aaaaaaa";

describe("agentPrompt", () => {
  test("the instruction, then one numbered entry per finding with its location, label and indented body", () => {
    const r = local();
    r.findings.push({
      path: "docs/x.md",
      line: 4,
      severity: "info",
      topic: "docs",
      title: "A note <!-- wachiman sha=1 -->",
      body: "Line one.\n\nLine two.",
      anchor: "outside",
    });
    const text = agentPrompt(r);
    expect(AGENT_PROMPT_INTRO(SHA7)).toBe(
      `Read the review of ${SHA7} below. For each finding, open the cited file at the cited line, decide whether it is valid against the current code, and fix the ones that are. Report the ones you reject with the reason. Run the repository's checks after the fixes.`,
    );
    expect(text).toBe(
      [
        AGENT_PROMPT_INTRO(SHA7),
        "",
        "1. apps/api/src/main/session/store.ts:2 · Important · 🟠🐛 Fix · bug: The store drops the last session (confidence high)",
        "   `y` overwrites `x` before it is flushed.",
        "2. apps/api/src/main/session/session-manager.ts · Nit · 🟡🧪 Consider · tests: No test covers the export (confidence medium)",
        "   Add a test that exports two sessions.",
        "3. docs/x.md:4 · Nit · ⚪📝 Info · docs: A note &lt;!-- wachiman sha=1 --&gt;",
        "   Line one.",
        "",
        "   Line two.",
      ].join("\n"),
    );
  });

  test("no findings says so", () => {
    const r = local();
    r.findings = [];
    expect(agentPrompt(r)).toEndWith("\n\nThe review has no findings.");
  });
});

describe("renderMarkdown", () => {
  test("holds every finding with no size cut, and every section", () => {
    const r = big();
    const md = renderMarkdown(r, {});
    expect(md.length).toBeGreaterThan(MAX_BODY_CHARS);
    for (const f of r.findings) expect(md).toContain(f.title);
    expect(md).toStartWith(`# Wachiman review of ${r.change.describe}, at ${SHA7}\n`);
    expect(md).toContain("All 4 files reviewed.");
    expect(md).toContain(countLine(r.findings));
  });

  test("the layout of a finding, the verification line, the summary, contracts, batches, cost and footer", () => {
    const r = local();
    const md = renderMarkdown(r, {});
    expect(md).toContain("Profile: default — your own signed-in `claude`");
    expect(md).toContain(
      "### Important · 🟠🐛 **Fix · bug: The store drops the last session (confidence high)**\n\n`apps/api/src/main/session/store.ts:2`\n\n`y` overwrites `x` before it is flushed.",
    );
    expect(md).toContain("`apps/api/src/main/session/session-manager.ts`\n\nAdd a test");
    expect(md).toContain("## Summary\n\n**Batch 1 of 2.** The store has one ordering bug.");
    expect(md).toContain("<details><summary>What the change connects to (1 closed, 0 open)</summary>");
    expect(md).toContain("| Batch 1 of 2 | 3 | 9 | 7 | reviewed | 6 | $0.30 |");
    expect(md).toMatch(/\$0\.40.*API-equivalent estimate.*not a bill/);
    expect(md).toContain("stop: complete");
    expect(md).toContain("Claude Code · claude-sonnet-5-5");
    expect(md).toContain("Wachiman 1.6.0");
    expect(md).toEndWith(`## Prompt for your agent\n\n\`\`\`text\n${agentPrompt(r)}\n\`\`\`\n`);
  });

  test("a partial review lists what was not reviewed, with the reasons", () => {
    const r = example();
    const md = renderMarkdown(r, {});
    expect(md).toContain("Partial: reviewed 3 of 4; not reviewed: assets/logo.png (binary).");
    expect(md).toContain("Profile: ci");
  });

  test("the profile line follows the result and the note", () => {
    const r = local();
    r.provider.profile = "isolated";
    expect(renderMarkdown(r, { profileNote: "~/.wachiman/claude-work, only a sign-in" })).toContain(
      "Profile: isolated — ~/.wachiman/claude-work, only a sign-in",
    );
    expect(renderMarkdown(r, {})).toContain("Profile: isolated — a Claude Code profile that holds only a sign-in");
  });

  test("a model or effort that came from .wachiman.yml says so on the last line, in both local formats; JSON is unchanged", () => {
    const r = local();
    const line = `${r.provider.label} (from .wachiman.yml) · effort ${r.provider.effort} (from .wachiman.yml) · profile`;
    expect(renderMarkdown(r, { settingsFrom: { model: true, effort: true } })).toContain(line);
    expect(renderTerminal(r, { agentPrompt: false, settingsFrom: { model: true, effort: true } })).toContain(line);
    expect(renderMarkdown(r, { settingsFrom: { effort: true } })).toContain(`${r.provider.label} · effort ${r.provider.effort} (from .wachiman.yml) · profile`);
    expect(renderMarkdown(r, {})).not.toContain("from .wachiman.yml");
    expect(renderJson(r, 1)).not.toContain("from .wachiman.yml");
  });

  test("a fence longer than any backtick run in the prompt", () => {
    const r = local();
    r.findings[0].body = "Use ```ts\ncode\n``` here.";
    const md = renderMarkdown(r, {});
    expect(md).toContain("\n````text\n");
    expect(md).toEndWith("\n````\n");
  });
});

describe("renderTerminal", () => {
  test("plain text: the headline, profile, counts, findings, summary and the estimate", () => {
    const r = local();
    const out = renderTerminal(r, { agentPrompt: false });
    expect(out).not.toMatch(/\x1b\[/);
    const lines = out.split("\n");
    expect(lines[0]).toBe(`Wachiman · review of ${r.change.describe}, at ${SHA7}: all 4 files reviewed.`);
    expect(lines[1]).toBe("profile: default — your own signed-in `claude`; its plugins are untested and could reach the review");
    expect(lines[2]).toBe(countLine(r.findings));
    expect(out).toContain(
      "apps/api/src/main/session/store.ts:2  Important · 🟠🐛 Fix · bug: The store drops the last session (confidence high)\n    `y` overwrites `x` before it is flushed.",
    );
    expect(out).toContain("apps/api/src/main/session/session-manager.ts  Nit · 🟡🧪 Consider");
    expect(out).toContain("Summary:\n    **Batch 1 of 2.** The store has one ordering bug.");
    expect(out).not.toContain("Not reviewed:");
    expect(out).toMatch(/\$0\.40.*API-equivalent estimate.*not a bill/);
    expect(out).toContain("stop: complete");
    expect(out).not.toContain("Read the review of");
    expect(out).toEndWith("\n");
  });

  test("a cost under a cent is not shown as $0.00", () => {
    const r = local();
    r.execution.costUsdEstimate = 0.00234837;
    expect(renderTerminal(r, { agentPrompt: false })).toContain("Cost: $0.0023, an API-equivalent estimate");
    r.execution.costUsdEstimate = 0;
    expect(renderTerminal(r, { agentPrompt: false })).toContain("Cost: $0.00, an API-equivalent estimate");
    r.execution.costUsdEstimate = 0.01;
    expect(renderTerminal(r, { agentPrompt: false })).toContain("Cost: $0.01, an API-equivalent estimate");
  });

  test("a batch costing under a cent is not shown as $0.00 in the Markdown table", () => {
    const r = example();
    r.batches[0]!.costUsd = 0.00234837;
    expect(renderMarkdown(r, {})).toMatch(/\| \$0\.0023 \|$/m);
  });

  test("the same estimate wording as the Markdown", () => {
    const r = local();
    const estimate = (text: string) => text.split("\n").find((l) => l.includes("API-equivalent estimate"));
    expect(estimate(renderTerminal(r, { agentPrompt: false }))).toBe(estimate(renderMarkdown(r, {})));
  });

  test("not-reviewed files are listed, and the agent prompt is appended on request", () => {
    const r = example();
    const out = renderTerminal(r, { agentPrompt: true });
    expect(out).toContain(`at ${SHA7}: Partial: reviewed 3 of 4; not reviewed: assets/logo.png (binary).`);
    expect(out).toContain("Not reviewed:\n  - assets/logo.png (binary)");
    expect(out).toEndWith(`\n\n${agentPrompt(r)}\n`);
  });
});

describe("renderJson", () => {
  test("is the result itself, with a final newline", () => {
    const r = example();
    const text = renderJson(r, 2);
    expect(JSON.parse(text)).toEqual(r);
    expect(text).toEndWith("}\n");
    // The default is the /1 form a committed change is saved in.
    expect(JSON.parse(renderJson(r))).toEqual(toResultV1(r));
    expect(JSON.parse(renderJson(r)).format).toBe("wachiman.review-result/1");
  });
});

describe("a run that stopped early", () => {
  const stopped = (kind: "billing" | "auth", text: string): ReviewResult => {
    const r = local();
    r.coverage.reviewed = ["apps/api/src/main/session/store.ts"];
    r.coverage.skipped = [
      { path: "assets/logo.png", reason: "not reached: the provider rejected the call" },
      { path: "docs/guides/2026-01-01-export-format.md", reason: "not reached: the provider rejected the call" },
    ];
    r.coverage.partial = true;
    r.execution.stop = kind === "billing" ? "quota" : "error";
    r.execution.rejection = { kind, text };
    return r;
  };

  test("a usage limit renders stop: quota and the files not reviewed, in both renderings", () => {
    const r = stopped("billing", "You have reached your usage limit");
    const line =
      "stop: quota — the account's usage limit ended the run; 3 file(s) not reviewed: apps/api/src/main/session/session-manager.ts, assets/logo.png, docs/guides/2026-01-01-export-format.md";
    expect(renderTerminal(r, { agentPrompt: false })).toContain(line);
    expect(renderMarkdown(r, {})).toContain(line);
  });

  test("a refused sign-in quotes the provider's text on one line", () => {
    const r = stopped("auth", "Not logged in\n  · Please run /login <!-- x -->");
    const line =
      "stop: error — the provider refused the call (auth): Not logged in · Please run /login &lt;!-- x --&gt;; 3 file(s) not reviewed:";
    expect(renderTerminal(r, { agentPrompt: false })).toContain(line);
    expect(renderMarkdown(r, {})).toContain(line);
  });
});

describe("the history annotation", () => {
  const annotation = () => ({
    byIndex: new Map([
      [0, { status: "open" as const, firstHead: "5d6e7f8".padEnd(40, "0"), runs: 3, id: "a1b2c3d4e5", verdict: "wrong" }],
      [1, { status: "new" as const, firstHead: SHA7.padEnd(40, "a"), runs: 1, id: "f0f0f0f0f0" }],
    ]),
    settled: [
      { firstId: "0f0e0d0c0b", status: "probably-fixed" as const, path: "src/b.ts", line: 40, title: "Unchecked cast of the response", lastHead: "1a2b3c4".padEnd(40, "0") },
      { firstId: "77aa88bb99", status: "not-repeated" as const, path: "src/c.ts", line: 7, title: "Missing await on save", lastHead: "1a2b3c4".padEnd(40, "0") },
    ],
    unknown: 2,
    lastRun: { head: "1a2b3c4".padEnd(40, "0"), savedAt: "2026-11-04T18:02:33.000Z" },
  });

  test("the history annotation labels each finding and adds the since-the-last-run block", () => {
    const r = local();
    const text = renderTerminal(r, { agentPrompt: false, history: annotation() });
    expect(text).toContain(
      "apps/api/src/main/session/store.ts:2  Important · 🟠🐛 Fix · bug: The store drops the last session (confidence high)  open since 5d6e7f8 · 3 runs · id a1b2c3d4e5 · verdict: wrong\n    `y` overwrites",
    );
    expect(text).toContain("session-manager.ts  Nit · 🟡🧪 Consider · tests: No test covers the export (confidence medium)  new · id f0f0f0f0f0\n");
    expect(text).toContain(
      [
        "Since the last run (1a2b3c4, 2026-11-04 18:02):",
        "  probably fixed  src/b.ts:40  Unchecked cast of the response  (id 0f0e0d0c0b)",
        "  not repeated    src/c.ts:7   Missing await on save           (id 77aa88bb99)",
        "  unknown         2 finding(s) in files this run did not review (run without paths to settle them)",
      ].join("\n"),
    );
    expect(text.indexOf("Since the last run")).toBeGreaterThan(text.indexOf("session-manager.ts"));
    expect(text.indexOf("Since the last run")).toBeLessThan(text.indexOf("Summary:"));
    // Without the history the report has no label and no block.
    const plain = renderTerminal(r, { agentPrompt: false });
    expect(plain).not.toContain("id a1b2c3d4e5");
    expect(plain).not.toContain("Since the last run");

    const md = renderMarkdown(r, { history: annotation() });
    expect(md).toContain("`apps/api/src/main/session/store.ts:2`\n\nHistory: open since `5d6e7f8`, 3 runs, id `a1b2c3d4e5`, verdict: wrong\n\n`y` overwrites");
    expect(md).toContain("`apps/api/src/main/session/session-manager.ts`\n\nHistory: new, id `f0f0f0f0f0`\n\nAdd a test");
    expect(md).toContain("## Since the last run\n\nCompared with the run at `1a2b3c4` (2026-11-04 18:02).\n\n- probably fixed: `src/b.ts:40` Unchecked cast of the response (id `0f0e0d0c0b`)");
    expect(md.indexOf("## Since the last run")).toBeLessThan(md.indexOf("## Summary"));
    expect(renderMarkdown(r, {})).not.toContain("Since the last run");
  });

  test("the first saved run says so", () => {
    const a = { ...annotation(), settled: [], unknown: 0, lastRun: undefined };
    expect(renderTerminal(local(), { agentPrompt: false, history: a })).toContain("Since the last run: this is the first saved run of this repository.");
  });
});
