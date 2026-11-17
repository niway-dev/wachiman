import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config";
import { GhError, review, type Deps, type GhFn, type ReviewOutput } from "./engine";
import { CLAIMS_SCHEMA } from "./fidelity/claims-call";
import { BLOCK_END, BLOCK_START } from "./fidelity/digest";
import type { ProviderAdapter, ProviderRequest, ProviderResult } from "./providers/types";

// PR Confidence through review(): the description block is written after the review, never in a
// dry run, never fails the review, and an incremental or scoped review does not grade.

const BASE = "b".repeat(40);
const HEAD = "a".repeat(40);
const REVIEW_URL = "https://github.com/o/r/pull/7#pullrequestreview-99";
const AUTHOR_BODY = "Retries failed uploads.\n\nSee the ticket.";

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
    const claims = request.outputSchema === CLAIMS_SCHEMA;
    const output: unknown = claims
      ? { claims: [{ text: "Retries failed uploads.", vague: false }] }
      : ({
          files_reviewed: ["src/a.ts"],
          files_skipped: [],
          findings: [],
          thread_replies: [],
          summary: "Fine.",
          claim_assignments: [
            { path: "src/a.ts", claim: 0, verdict: "supports", evidence: [{ path: "src/a.ts", line: 2 }] },
          ],
        } satisfies ReviewOutput);
    return { costUsd: 0.02, turns: 1, durationMs: 1, terminalReason: "success", isError: false, raw: {}, structuredOutput: output };
  }
}

interface World {
  patches: { body: string }[];
  reviews: unknown[];
  body: string;
}

/** One pull request, one changed file, no earlier review. The description changes with each PATCH. */
function fakeGh(world: World, opts: { failPatch?: boolean } = {}): GhFn {
  return (args, input) => {
    const line = args.join(" ");
    if (/contents\//.test(line)) throw new GhError("gh: Not Found (HTTP 404)", 404, "Not Found");
    if (line.startsWith("api repos/o/r/pulls/7 ")) return BASE;
    if (line.startsWith("pr view"))
      return JSON.stringify({ headRefOid: HEAD, title: "Retry uploads", body: world.body, author: { login: "u" } });
    if (line.includes("/pulls/7/files"))
      return JSON.stringify({ filename: "src/a.ts", additions: 3, deletions: 0, patch: "@@ -0,0 +1,3 @@\n+one;\n+two;\n+three;" });
    if (line.includes("-X PATCH repos/o/r/pulls/7")) {
      if (opts.failPatch) throw new Error("gh: HTTP 403");
      const { body } = JSON.parse(input ?? "{}") as { body: string };
      world.patches.push({ body });
      world.body = body;
      return "{}";
    }
    if (line.includes("-X POST repos/o/r/pulls/7/reviews")) {
      world.reviews.push(JSON.parse(input ?? "{}"));
      return JSON.stringify({ html_url: REVIEW_URL });
    }
    if (line.includes("/pulls/7/reviews")) return "";
    throw new Error(`unexpected gh call: ${line}`);
  };
}

async function run(env: Record<string, string>, opts: { failPatch?: boolean; words?: string[]; body?: string } = {}) {
  const head = mkdtempSync(join(tmpdir(), "conf-review-head-"));
  mkdirSync(join(head, "src"));
  writeFileSync(join(head, "src/a.ts"), "one;\ntwo;\nthree;\n");
  const world: World = { patches: [], reviews: [], body: opts.body ?? AUTHOR_BODY };
  const provider = new FakeProvider();
  const warnings: string[] = [];
  const logs: string[] = [];
  const deps: Deps = {
    gh: fakeGh(world, opts),
    provider,
    config: loadConfig({ WACHIMAN_VERIFY: "0", ...env }, () => {}),
    repoDir: head,
    log: (l) => logs.push(l),
    warn: (w) => warnings.push(w),
    sleep: () => {},
    now: () => Date.UTC(2026, 10, 11),
  };
  await review(deps, "o/r", 7, opts.words ?? []);
  return { world, provider, warnings, logs: logs.join("\n") };
}

describe("the description block after a review", () => {
  test("is written after the review, keeps the author's text, and links the review", async () => {
    const r = await run({ WACHIMAN_CONFIDENCE: "1" });
    expect(r.world.reviews).toHaveLength(1);
    expect(r.world.patches).toHaveLength(1);
    const body = r.world.body;
    expect(body.endsWith(`\n\n${AUTHOR_BODY}`)).toBe(true);
    expect(body).toContain(BLOCK_START);
    expect(body).toContain(BLOCK_END);
    expect(body).toContain("A (trial)");
    expect(body).toContain(REVIEW_URL);
    expect(body).toContain(`o/r`);
    // Two calls: the claims list and the one batch.
    expect(r.provider.requests).toHaveLength(2);
  });

  test("the review comment carries a short PR Confidence line", async () => {
    const r = await run({ WACHIMAN_CONFIDENCE: "1" });
    const posted = r.world.reviews[0] as { body: string };
    expect(posted.body).toContain("PR Confidence: A");
  });

  test("a second review replaces the block and leaves the text outside it byte for byte", async () => {
    const first = (await run({ WACHIMAN_CONFIDENCE: "1" })).world.body;
    const second = (await run({ WACHIMAN_CONFIDENCE: "1", WACHIMAN_DRY_RUN: "0" }, { body: first })).world.body;
    expect(second.split(BLOCK_START)).toHaveLength(2);
    expect(second.endsWith(`\n\n${AUTHOR_BODY}`)).toBe(true);
    expect(second.slice(second.indexOf(BLOCK_END))).toBe(first.slice(first.indexOf(BLOCK_END)));
  });

  test("a failed write is a warning: the review is still posted and nothing throws", async () => {
    const r = await run({ WACHIMAN_CONFIDENCE: "1" }, { failPatch: true });
    expect(r.world.reviews).toHaveLength(1);
    expect(r.world.patches).toHaveLength(0);
    expect(r.warnings.join("\n")).toContain("PR Confidence");
  });

  test("a dry run posts nothing and writes nothing", async () => {
    const r = await run({ WACHIMAN_CONFIDENCE: "1", WACHIMAN_DRY_RUN: "1" });
    expect(r.world.reviews).toHaveLength(0);
    expect(r.world.patches).toHaveLength(0);
  });

  test("with the flag off there is no claims call and the description is untouched", async () => {
    const r = await run({});
    expect(r.provider.requests).toHaveLength(1);
    expect(r.world.patches).toHaveLength(0);
    expect(r.world.body).toBe(AUTHOR_BODY);
    expect((r.world.reviews[0] as { body: string }).body).not.toContain("PR Confidence");
  });

  test("a scoped review does not grade: no claims call, and the block says cannot say", async () => {
    const r = await run({ WACHIMAN_CONFIDENCE: "1" }, { words: ["src/a.ts"] });
    expect(r.provider.requests.every((q) => q.outputSchema !== CLAIMS_SCHEMA)).toBe(true);
    expect(r.world.body).toContain("cannot say");
    expect(r.world.body).not.toMatch(/\bA \(trial\)/);
  });
});
