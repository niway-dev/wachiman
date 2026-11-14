import { describe, expect, test } from "bun:test";
import { BATCH_CONCURRENCY, GhError, review, type Deps, type GhFn, type ReviewOutput } from "./engine";
import { loadConfig as loadConfigWithDefaults } from "./config";
import type { ProviderAdapter, ProviderAuth, ProviderRequest, ProviderResult } from "./providers/types";

/** Batches run side by side: these tests use a provider whose calls last as long as the test says. */
const loadConfig = (env: Record<string, string | undefined>) => loadConfigWithDefaults({ WACHIMAN_VERIFY: "0", ...env });

const BASE = "b".repeat(40);

/** One file of six changed lines per batch: with a six-line batch size, every file is its own batch. */
const fileName = (n: number) => `src/f${n}.ts`;
const filesOf = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    filename: fileName(i + 1),
    additions: 6,
    deletions: 0,
    patch: "@@ -0,0 +1,6 @@\n+a\n+b\n+c\n+d\n+e\n+f",
  }));
const ONE_FILE_EACH = { WACHIMAN_BATCH_LINES: "6" };

function fakeGh(files: ReturnType<typeof filesOf>, posted: { review?: { body: string; comments: unknown[] } }): GhFn {
  return (args, input) => {
    const line = args.join(" ");
    if (line.includes("contents/")) throw new GhError("gh: Not Found (HTTP 404)", 404, "Not Found");
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

interface Plan {
  /** How long the call for this file lasts. */
  delayMs: number;
  /** What it costs; by default the cap it was given, which is the worst case for a budget. */
  costUsd?: (request: ProviderRequest) => number;
  rejected?: boolean;
  /** What a rejected call says; by default the same text for every batch. */
  errorText?: string;
}

/** Answers each call by the file its prompt names, after the time the plan gives it. */
class TimedProvider implements ProviderAdapter {
  readonly name = "fake";
  auth: ProviderAuth | undefined;
  readonly requests: ProviderRequest[] = [];
  /** The file of each call, in the order the calls started. */
  readonly started: string[] = [];
  /** The file of each call, in the order the calls finished. */
  readonly finished: string[] = [];
  inFlight = 0;
  maxInFlight = 0;
  constructor(private readonly plan: (file: string) => Plan) {}
  preflight() {}
  modelLabel() {
    return "Fake Model 1 via Fake CLI 0.1";
  }
  leaksSecret() {
    return false;
  }
  async run(request: ProviderRequest): Promise<ProviderResult> {
    this.requests.push(request);
    // The files this call must review: the list after "This part holds exactly these files".
    const held = request.prompt.split("This part holds exactly these files")[1] ?? "";
    const file = held.match(/- (src\/f\d+\.ts) /)?.[1] ?? "";
    this.started.push(file);
    const plan = this.plan(file);
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await new Promise((resolve) => setTimeout(resolve, plan.delayMs));
    this.inFlight--;
    this.finished.push(file);
    const base = { costUsd: plan.costUsd?.(request) ?? 0.01, turns: 1, durationMs: plan.delayMs, raw: {} };
    if (plan.rejected)
      return {
        ...base,
        isError: true,
        terminalReason: "error",
        errorText: plan.errorText ?? "API Error: 400 Your credit balance is too low to access the Anthropic API.",
        providerError: "billing",
      };
    const output: ReviewOutput = {
      files_reviewed: [file],
      files_skipped: [],
      findings: [],
      thread_replies: [],
      summary: `${file} fine.`,
    };
    return { ...base, isError: false, terminalReason: "success", structuredOutput: output };
  }
}

function run(count: number, provider: TimedProvider, env: Record<string, string> = {}) {
  const posted: { review?: { body: string; comments: unknown[] } } = {};
  const logs: string[] = [];
  const deps: Deps = {
    gh: fakeGh(filesOf(count), posted),
    provider,
    config: loadConfig({ ...ONE_FILE_EACH, ...env }),
    log: (line) => logs.push(line),
    warn: () => {},
  };
  return { posted, logs, done: review(deps, "o/r", 7, []) };
}

describe("batches run side by side", () => {
  test("the limit is four, and a fifth batch waits for a free slot", async () => {
    expect(BATCH_CONCURRENCY).toBe(4);
    const provider = new TimedProvider(() => ({ delayMs: 30 }));
    const r = run(7, provider);
    await r.done;
    expect(provider.requests).toHaveLength(7);
    expect(provider.maxInFlight).toBe(4);
    // The first four are launched together; the other three wait their turn, in risk order.
    expect(provider.started.slice(0, 4)).toEqual([1, 2, 3, 4].map(fileName));
    expect(r.logs.filter((l) => /^batch \d+\/7: started \(\d of 4 running/.test(l))).toHaveLength(7);
  });

  test("the report lists the batches in batch order when they finish out of order", async () => {
    // Batch 1 is the slowest and batch 3 the fastest, so they finish 3, 2, 1.
    const delay: Record<string, number> = { [fileName(1)]: 90, [fileName(2)]: 50, [fileName(3)]: 10 };
    const provider = new TimedProvider((file) => ({ delayMs: delay[file] ?? 10 }));
    const r = run(3, provider);
    await r.done;
    expect(provider.finished).toEqual([fileName(3), fileName(2), fileName(1)]);
    const body = r.posted.review?.body ?? "";
    const rows = [1, 2, 3].map((n) => body.indexOf(`| Batch ${n} of 3 |`));
    expect(rows.every((i) => i >= 0)).toBe(true);
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
    const parts = [1, 2, 3].map((n) => body.indexOf(`**Batch ${n} of 3.**`));
    expect(parts.every((i) => i >= 0)).toBe(true);
    expect(parts).toEqual([...parts].sort((a, b) => a - b));
    // Every line a batch prints names it, so interleaved lines can still be told apart.
    const started = r.logs.filter((l) => l.includes(": started ("));
    expect(started.every((l) => /^batch \d\/3: /.test(l))).toBe(true);
  });

  test("a total that fits only some batches runs the riskiest ones and never spends past it", async () => {
    // Each call costs its whole cap. The batch cap is 0.50 and the total 1.20: batches 1 and 2 reserve
    // 0.50 each, batch 3 the 0.20 left, and batch 4 finds nothing once the others finished.
    const provider = new TimedProvider(() => ({ delayMs: 20, costUsd: (q) => q.maxBudgetUsd ?? 0 }));
    const r = run(4, provider, { WACHIMAN_BATCH_BUDGET_USD: "0.5", WACHIMAN_BUDGET_USD: "1.2" });
    await r.done;
    expect(provider.requests).toHaveLength(3);
    const caps = provider.requests.map((q) => q.maxBudgetUsd);
    expect(caps[0]).toBeCloseTo(0.5, 5);
    expect(caps[1]).toBeCloseTo(0.5, 5);
    expect(caps[2]).toBeCloseTo(0.2, 5);
    const body = r.posted.review?.body ?? "";
    expect(body).toContain("| Batch 4 of 4 |");
    expect(body).toContain("not run: budget spent");
    expect(body).toContain("$1.20</sub>");
    const spent = provider.requests.reduce((sum, q) => sum + (q.maxBudgetUsd ?? 0), 0);
    expect(spent).toBeLessThanOrEqual(1.2 + 1e-9);
  });

  test("a batch waits for reserved money that comes back, instead of being skipped", async () => {
    // Calls cost little: what batches 1 to 3 reserved and did not spend is enough for batch 4.
    const provider = new TimedProvider(() => ({ delayMs: 20, costUsd: () => 0.05 }));
    const r = run(4, provider, { WACHIMAN_BATCH_BUDGET_USD: "0.5", WACHIMAN_BUDGET_USD: "1.2" });
    await r.done;
    expect(provider.requests).toHaveLength(4);
    expect(r.posted.review?.body).not.toContain("not run: budget spent");
  });

  test("a rejection stops new batches; the ones already running finish", async () => {
    // Batch 1 is refused at once. Batches 2 to 4 are in flight and finish; 5 and 6 never start.
    const provider = new TimedProvider((file) =>
      file === fileName(1) ? { delayMs: 10, rejected: true } : { delayMs: 60 },
    );
    const r = run(6, provider);
    await r.done;
    expect(provider.requests).toHaveLength(4);
    expect(provider.finished).toHaveLength(4);
    const body = r.posted.review?.body ?? "";
    expect(body).toContain("| Batch 5 of 6 |");
    expect(body.match(/not run: provider rejected the call/g)?.length).toBe(2);
    expect(r.logs.filter((l) => /^batch [56]\/6: started/.test(l))).toHaveLength(0);
  });

  test("when two batches are refused, the report names the first batch's refusal, not the first to finish", async () => {
    // Batch 2 is refused first, batch 1 a moment later.
    const provider = new TimedProvider((file) =>
      file === fileName(1)
        ? { delayMs: 60, rejected: true, errorText: "API Error: 400 Your credit balance is too low (from batch ONE)." }
        : { delayMs: 10, rejected: true, errorText: "API Error: 400 Your credit balance is too low (from batch TWO)." },
    );
    const r = run(2, provider);
    await r.done;
    expect(provider.finished).toEqual([fileName(2), fileName(1)]);
    const body = r.posted.review?.body ?? "";
    expect(body).toContain("from batch ONE");
    expect(body).not.toContain("from batch TWO");
  });
});
