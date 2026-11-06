import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Textual checks, not a YAML parse: the repository has no YAML dependency (ADR 0002). They pin the
// places that must agree for the daily limit (ADR 0021): the inputs, the OIDC permission and the
// environment the engine reads.
const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const workflow = read(".github/workflows/review.yml");

const input = (name: string) =>
  workflow.match(new RegExp(`\\n {6}${name}:\\n([\\s\\S]*?)(?=\\n {6}[a-z_]+:\\n|\\n {4}secrets:)`))?.[1] ?? "";

describe("daily limit inputs (ADR 0021)", () => {
  test("ledger_url is a string, unset by default", () => {
    expect(input("ledger_url")).toMatch(/type: string/);
    expect(input("ledger_url")).toMatch(/default: ""/);
  });

  test("daily_budget_usd is a number, 0 (unset) by default", () => {
    expect(input("daily_budget_usd")).toMatch(/type: number/);
    expect(input("daily_budget_usd")).toMatch(/default: 0$/m);
  });

  test("daily_limit_mode is a string that defaults to fail", () => {
    expect(input("daily_limit_mode")).toMatch(/type: string/);
    expect(input("daily_limit_mode")).toMatch(/default: fail$/m);
  });

  test("daily_limit_bypass is a boolean that defaults to false", () => {
    expect(input("daily_limit_bypass")).toMatch(/type: boolean/);
    expect(input("daily_limit_bypass")).toMatch(/default: false$/m);
  });
});

describe("the OIDC permission", () => {
  test("the three jobs of the reusable workflow grant id-token: write", () => {
    const blocks = [...workflow.matchAll(/\n {4}permissions:\n((?: {6}[a-z-]+: \w+\n)+)/g)].map((m) => m[1]);
    expect(blocks).toHaveLength(3);
    for (const block of blocks) expect(block).toContain("id-token: write");
  });

  test("both caller templates grant id-token: write", () => {
    expect(read("templates/agent-review-caller.yml")).toMatch(/^permissions: \{[^}]*id-token: write[^}]*\}$/m);
    const copy = read("templates/caller-workflow.yml");
    const blocks = [...copy.matchAll(/\n {4}permissions:\n((?: {6}[a-z-]+: \w+.*\n)+)/g)].map((m) => m[1]);
    expect(blocks).toHaveLength(3);
    for (const block of blocks) expect(block).toContain("id-token: write");
  });
});

describe("the engine steps export the daily limit settings", () => {
  const steps = ["Review the pull request", "Answer the pending threads", "Review or answer"];
  for (const name of steps) {
    test(`"${name}" exports the four variables`, () => {
      const start = workflow.indexOf(`- name: ${name}\n`);
      expect(start).toBeGreaterThan(-1);
      const step = workflow.slice(start, workflow.indexOf("run:", start));
      expect(step).toContain("AGENT_REVIEW_LEDGER_URL: ${{ inputs.ledger_url }}");
      expect(step).toContain(
        "AGENT_REVIEW_DAILY_BUDGET_USD: ${{ inputs.daily_budget_usd != 0 && inputs.daily_budget_usd || '' }}",
      );
      expect(step).toContain("AGENT_REVIEW_DAILY_LIMIT_MODE: ${{ inputs.daily_limit_mode }}");
      expect(step).toContain("AGENT_REVIEW_DAILY_LIMIT_BYPASS: ${{ inputs.daily_limit_bypass }}");
    });
  }
});
