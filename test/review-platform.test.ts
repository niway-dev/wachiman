import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generatePlatformWorkflow } from "../scripts/generate-review-platform";

// review.yml and review-platform.yml are the same review; only the second grants `id-token: write`,
// because a called workflow cannot hold a permission its caller did not grant.
const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const review = read(".github/workflows/review.yml");
const platform = read(".github/workflows/review-platform.yml");

type Workflow = {
  on: { workflow_call: { inputs: Record<string, { type: string; default?: unknown }> } };
  jobs: Record<string, { permissions?: Record<string, string>; steps?: { env?: Record<string, string> }[] }>;
};
const parse = (text: string) => Bun.YAML.parse(text) as Workflow;

const LEDGER_ENV = [
  "AGENT_REVIEW_LEDGER_URL",
  "AGENT_REVIEW_DAILY_BUDGET_USD",
  "AGENT_REVIEW_WEEKLY_BUDGET_USD",
  "AGENT_REVIEW_LIMIT_MODE",
  "AGENT_REVIEW_LIMIT_BYPASS",
  "AGENT_REVIEW_LEDGER_UNAVAILABLE",
];

describe("review-platform.yml", () => {
  test("is exactly what scripts/generate-review-platform.ts writes from review.yml", () => {
    expect(platform).toBe(generatePlatformWorkflow(review));
  });

  test("review.yml grants no id-token anywhere: callers that granted nothing extra keep working", () => {
    expect(review).not.toMatch(/^\s+id-token:/m);
    for (const job of Object.values(parse(review).jobs)) expect(job.permissions).not.toHaveProperty("id-token");
  });

  test("every job of review-platform.yml grants id-token: write and nothing else changed in its permissions", () => {
    const plain = parse(review).jobs;
    const enrolled = parse(platform).jobs;
    expect(Object.keys(enrolled)).toEqual(Object.keys(plain));
    for (const [name, job] of Object.entries(enrolled)) {
      expect(job.permissions?.["id-token"]).toBe("write");
      const { "id-token": _granted, ...rest } = job.permissions ?? {};
      expect(rest).toEqual(plain[name]!.permissions ?? {});
    }
  });

  test("both workflows have the same inputs, and the ledger inputs have the documented types and defaults", () => {
    const plain = parse(review).on.workflow_call.inputs;
    expect(parse(platform).on.workflow_call.inputs).toEqual(plain);
    expect(plain.ledger_url).toMatchObject({ type: "string", default: "" });
    expect(plain.daily_budget_usd).toMatchObject({ type: "number", default: 0 });
    expect(plain.weekly_budget_usd).toMatchObject({ type: "number", default: 0 });
    expect(plain.limit_mode).toMatchObject({ type: "string", default: "fail" });
    expect(plain.limit_bypass).toMatchObject({ type: "boolean", default: false });
    expect(plain.ledger_unavailable).toMatchObject({ type: "string", default: "run" });
  });

  test("the three engine steps of both workflows pass the ledger settings to the engine", () => {
    for (const text of [review, platform]) {
      const steps = Object.values(parse(text).jobs).flatMap((job) => job.steps ?? []);
      const engine = steps.filter((step) => step.env && "AGENT_REVIEW_OPERATOR" in step.env);
      expect(engine).toHaveLength(3);
      for (const step of engine) {
        for (const name of LEDGER_ENV) expect(step.env).toHaveProperty(name);
        expect(step.env!.AGENT_REVIEW_LEDGER_URL).toBe("${{ inputs.ledger_url }}");
        // 0 means unset: the engine gets an empty string, never a limit of zero dollars.
        expect(step.env!.AGENT_REVIEW_DAILY_BUDGET_USD).toBe("${{ inputs.daily_budget_usd != 0 && inputs.daily_budget_usd || '' }}");
        expect(step.env!.AGENT_REVIEW_WEEKLY_BUDGET_USD).toBe("${{ inputs.weekly_budget_usd != 0 && inputs.weekly_budget_usd || '' }}");
      }
    }
  });

  test("the default caller template stays on review.yml; the enrolled form is a comment that the init anchors do not see", () => {
    const template = read("templates/wachiman-review-caller.yml");
    expect(template.match(/\/review\.yml@/g)).toHaveLength(1);
    expect(template.match(/operator: EDIT-THIS-github-login/g)).toHaveLength(1);
    expect(template).toMatch(/^\s*#.*review-platform\.yml@/m);
    expect(template).toMatch(/^\s*#.*id-token: write/m);
    expect(template).toMatch(/^\s*#.*ledger_url/m);
    // No uncommented line mentions the platform workflow.
    expect(template.split("\n").filter((line) => !/^\s*#/.test(line) && line.includes("review-platform.yml"))).toEqual([]);
  });
});
