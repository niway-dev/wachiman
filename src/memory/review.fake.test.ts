import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config";
import { reviewChange, reviewOptionsOf, type CoreDeps, type ReviewInput, type ReviewOptions, type ReviewOutput } from "../engine";
import { toResultV1 } from "../formats";
import type { ProviderAdapter, ProviderRequest, ProviderResult } from "../providers/types";
import { validate } from "../../test/support/json-schema";
import { parseRepoSettings } from "../repo-settings";
import { loadMemory, type MemorySource } from "./load";

class FakeProvider implements ProviderAdapter {
  readonly name = "fake";
  readonly requests: ProviderRequest[] = [];
  preflight() {}
  modelLabel() {
    return "Fake Model 1 via Fake CLI 0.1";
  }
  leaksSecret() {
    return false;
  }
  async run(request: ProviderRequest): Promise<ProviderResult> {
    this.requests.push(request);
    const structuredOutput: ReviewOutput = { files_reviewed: ["src/a.ts"], files_skipped: [], findings: [], thread_replies: [], summary: "Looks fine." };
    return { costUsd: 0, turns: 1, durationMs: 1, terminalReason: "success", isError: false, raw: {}, structuredOutput };
  }
}

const ROOT = join(import.meta.dir, "..", "..");
const resultSchema = JSON.parse(readFileSync(join(ROOT, "docs/formats/review-result.v2.schema.json"), "utf8"));
const branchFixture = JSON.parse(readFileSync(join(ROOT, "test/fixtures/formats/review-input.branch.json"), "utf8"));

function branchInput(): ReviewInput {
  const headDir = mkdtempSync(join(tmpdir(), "memory-head-"));
  mkdirSync(join(headDir, "src"));
  writeFileSync(join(headDir, "src/a.ts"), "const a = 1;\nconst b = 2;\nconst c = 3;\n");
  writeFileSync(join(headDir, "src/b.ts"), "export const d = 4;\nexport const e = 5;\n");
  return { ...structuredClone(branchFixture), headDir };
}

const deps = (provider: FakeProvider): CoreDeps => ({ provider, log: () => {}, warn: () => {}, lineCounter: undefined, sleep: () => {}, rateLimitBackoffMs: 0, git: undefined, now: undefined, costs: undefined, engineVersion: undefined });
const options = (over: Partial<ReviewOptions> = {}): ReviewOptions => ({ ...reviewOptionsOf(loadConfig({ WACHIMAN_VERIFY: "0" }), 5), ...over });

const INDEX = "# Memory\n\n| Glob | File |\n| --- | --- |\n| `src/**` | `src.md` |\n";
const source = (files: Record<string, string>, settings?: string): MemorySource => ({
  list: () => Object.keys(files),
  read: (n) => files[n] ?? null,
  settings: () => (settings === undefined ? undefined : parseRepoSettings(settings)),
});
const REV = "b".repeat(40);

describe("a review with repository memory (layer 1: loaded, selected, budgeted, recorded)", () => {
  test("with no memory the result has no memory field and validates against the schema", async () => {
    const provider = new FakeProvider();
    const result = await reviewChange(branchInput(), options(), deps(provider));
    expect("memory" in result).toBe(false);
    expect(result.summary).toBe("Looks fine.");
    expect(validate(resultSchema, JSON.parse(JSON.stringify(result)))).toEqual([]);
  });

  test("loaded memory changes neither the prompt nor the summary, and the record names the revision and the files", async () => {
    const plain = new FakeProvider();
    const plainResult = await reviewChange(branchInput(), options(), deps(plain));
    const withMemory = new FakeProvider();
    const memory = loadMemory(source({ "index.md": INDEX, "src.md": "rule\n" }), REV, ["src/a.ts"], () => {})!;
    const result = await reviewChange(branchInput(), options({ memory }), deps(withMemory));

    const prompts = (p: FakeProvider) => p.requests.map((r) => r.prompt.replace(/memory-head-\w+/g, "H").replace(/wachiman-review-\w+/g, "R"));
    expect(prompts(withMemory)).toEqual(prompts(plain));
    expect(result.summary).toBe(plainResult.summary);
    expect(result.memory).toEqual({
      revision: REV,
      files: [
        { path: ".wachiman/memory/index.md", lines: 5 },
        { path: ".wachiman/memory/src.md", lines: 1 },
      ],
      leftOut: [],
      overBudget: false,
      indexOverBudget: false,
      budget: { maxIndexLines: 150, maxLoadedLines: 400, loadedLines: 6 },
    });
    expect(result.memory).not.toHaveProperty("entries");
    expect(validate(resultSchema, JSON.parse(JSON.stringify(result)))).toEqual([]);
    expect("memory" in toResultV1(result)).toBe(false);
  });

  test("over budget, the summary says so and names the files left out; the record says it too", async () => {
    const big = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n") + "\n";
    const memory = loadMemory(source({ "index.md": INDEX, "src.md": big }, "memory:\n  max_loaded_lines: 20\n"), REV, ["src/a.ts"], () => {})!;
    const result = await reviewChange(branchInput(), options({ memory }), deps(new FakeProvider()));
    expect(result.memory?.overBudget).toBe(true);
    expect(result.memory?.leftOut).toEqual([".wachiman/memory/src.md"]);
    expect(result.summary).toStartWith("Looks fine.\n\n");
    expect(result.summary).toContain("Memory over budget");
    expect(result.summary).toContain(".wachiman/memory/src.md");
    expect(validate(resultSchema, JSON.parse(JSON.stringify(result)))).toEqual([]);
  });
});
