import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { countLine, MAX_BODY_CHARS, type ReviewResult } from "../engine";
import { AGENT_PROMPT_INTRO, agentPrompt } from "./agent-prompt";
import { renderJson } from "./json";
import { renderMarkdown } from "./markdown";
import { renderTerminal } from "./terminal";

const example = (): ReviewResult =>
  JSON.parse(readFileSync(join(import.meta.dir, "../../test/fixtures/formats/review-result.example.json"), "utf8"));

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
      title: "A note <!-- agent-review sha=1 -->",
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
        "1. apps/api/src/main/session/store.ts:2 · 🟠🐛 Fix · bug: The store drops the last session (confidence high)",
        "   `y` overwrites `x` before it is flushed.",
        "2. apps/api/src/main/session/session-manager.ts · 🟡🧪 Consider · tests: No test covers the export (confidence medium)",
        "   Add a test that exports two sessions.",
        "3. docs/x.md:4 · ⚪📝 Info · docs: A note &lt;!-- agent-review sha=1 --&gt;",
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
      "### 🟠🐛 **Fix · bug: The store drops the last session (confidence high)**\n\n`apps/api/src/main/session/store.ts:2`\n\n`y` overwrites `x` before it is flushed.",
    );
    expect(md).toContain("`apps/api/src/main/session/session-manager.ts`\n\nAdd a test");
    expect(md.match(/^Verified: /gm)).toHaveLength(1);
    expect(md).toContain("Verified: Searched the test directory for `export`. — exportSessions([a, b])");
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
    expect(lines[1]).toBe("profile: default — your own signed-in `claude`");
    expect(lines[2]).toBe(countLine(r.findings));
    expect(out).toContain(
      "apps/api/src/main/session/store.ts:2  🟠🐛 Fix · bug: The store drops the last session (confidence high)\n    `y` overwrites `x` before it is flushed.",
    );
    expect(out).toContain("apps/api/src/main/session/session-manager.ts  🟡🧪 Consider");
    expect(out).toContain("Summary:\n    **Batch 1 of 2.** The store has one ordering bug.");
    expect(out).not.toContain("Not reviewed:");
    expect(out).toMatch(/\$0\.40.*API-equivalent estimate.*not a bill/);
    expect(out).toContain("stop: complete");
    expect(out).not.toContain("Read the review of");
    expect(out).toEndWith("\n");
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
    const text = renderJson(r);
    expect(JSON.parse(text)).toEqual(r);
    expect(text).toEndWith("}\n");
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
