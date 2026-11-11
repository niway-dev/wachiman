import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { comment, GhError, type Deps, type GhFn } from "./engine";
import { loadConfig } from "./config";
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
  leaksSecret() {
    return false;
  }
  run(request: ProviderRequest): ProviderResult {
    this.requests.push(request);
    const step = this.script[this.requests.length - 1];
    if (!step) throw new Error("the fake provider has no answer left");
    return { costUsd: 0, turns: 1, durationMs: 1, terminalReason: "success", isError: false, raw: {}, ...step(request) };
  }
}

const HEAD = "head1234567";
const BASE = "b".repeat(40);
const FINDING = `🟠 **Fix · logic: retry ignores budget**\n\nThe loop does not read the budget.\n\n<!-- wachi:finding -->`;
const REVIEW = `👮 **Wachiman** · review of the whole pull request, at \`head123\`.\n\n## Risk map\n\nRead first: src/a.ts\n\n<sub>x</sub>\n\n<!-- wachi:review -->\n\n<!-- agent-review sha=${HEAD} -->`;

/** A checkout with one five-line file, which the answer's references are checked against. */
function checkout() {
  const dir = mkdtempSync(join(tmpdir(), "ask-head-"));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/a.ts"), "1\n2\n3\n4\n5\n");
  return dir;
}

/**
 * A GitHub with one pull request. `reviewBodies` are the bot's reviews, oldest first; the threads
 * are the GraphQL reply. The comment the engine posts arrives on stdin of `pr comment`.
 */
function fakeGh(reviewBodies: string[]): GhFn {
  return (args) => {
    const line = args.join(" ");
    if (line.includes("contents/")) throw new GhError("gh: Not Found (HTTP 404)", 404, "Not Found");
    if (line.startsWith("api repos/o/r/pulls/7 ")) return BASE;
    if (line.startsWith("pr view")) return JSON.stringify({ title: "t", body: "b", files: [], headRefOid: HEAD });
    if (line.startsWith("pr diff")) return "diff";
    if (line.includes("/pulls/7/reviews"))
      return reviewBodies.map((body) => JSON.stringify({ body, submitted_at: "2026-11-10T10:00:00Z" })).join("\n");
    if (line.startsWith("api graphql"))
      return JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [
                  {
                    isResolved: true,
                    path: "src/a.ts",
                    line: 2,
                    comments: {
                      nodes: [
                        {
                          databaseId: 1,
                          author: { login: "github-actions" },
                          authorAssociation: "NONE",
                          body: FINDING,
                          createdAt: "2026-11-10T10:00:00Z",
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      });
    if (line.startsWith("pr comment")) return "";
    throw new Error(`unexpected gh call: ${line}`);
  };
}

function depsFor(provider: FakeProvider, gh: GhFn, posted: string[], repoDir = checkout()): Deps {
  return {
    gh: (args, input) => {
      if (args[0] === "pr" && args[1] === "comment") posted.push(input ?? "");
      return gh(args, input);
    },
    provider,
    config: loadConfig({ AGENT_REVIEW_OPERATOR: "boss" }),
    repoDir,
    log: () => {},
    warn: () => {},
  };
}

const ANSWER = {
  sections: [
    {
      title: "Overview",
      body: "The retry loop ignores the budget.",
      refs: [
        { path: "src/a.ts", line: 3 },
        { path: "src/a.ts", line: 99 },
      ],
    },
  ],
  not_answered: "",
};

/** The review file the prompt points at, read from the directory the provider was given. */
function reviewFileOf(request: ProviderRequest) {
  return readFileSync(join(request.addDirs[0], "review.md"), "utf8");
}

describe("the on-demand answer on a pull request", () => {
  test("reads the latest review and the finding threads, and posts checked, linked references", () => {
    const posted: string[] = [];
    const provider = new FakeProvider([() => ({ structuredOutput: ANSWER })]);
    comment(depsFor(provider, fakeGh([REVIEW]), posted), "o/r", 7, "/wachiman why does the retry ignore the budget?", "boss");

    const request = provider.requests[0];
    expect(request.prompt).toContain("review.md holds the review Wachiman already ran on this change");
    expect(request.prompt).toContain("<request>\n/wachiman why does the retry ignore the budget?\n</request>");
    const review = reviewFileOf(request);
    expect(review).toContain("## Risk map");
    expect(review).toContain("retry ignores budget");
    expect(review).toContain('"resolved": true');

    expect(posted).toHaveLength(1);
    const body = posted[0];
    expect(body).toContain("### Overview");
    expect(body).toContain(`[\`src/a.ts:3\`](https://github.com/o/r/blob/${HEAD}/src/a.ts#L3)`);
    expect(body).not.toContain("#L99");
    expect(body).toContain("1 reference could not be checked and was removed.");
  });

  test("with no earlier review the prompt says so, and no review file is written", () => {
    const posted: string[] = [];
    const provider = new FakeProvider([() => ({ structuredOutput: ANSWER })]);
    comment(depsFor(provider, fakeGh([]), posted), "o/r", 7, "@agent-review why is this here?", "boss");
    const request = provider.requests[0];
    expect(request.prompt).toContain("No review of this change is available");
    expect(request.prompt).not.toContain("holds the review Wachiman already ran");
    expect(request.addDirs).toHaveLength(1);
  });

  test("a previous review is read only from the engine's own reviews", () => {
    const posted: string[] = [];
    const provider = new FakeProvider([() => ({ structuredOutput: ANSWER })]);
    const stranger = "A review by someone else, with no signature.";
    comment(depsFor(provider, fakeGh([REVIEW, stranger]), posted), "o/r", 7, "@agent-review why?", "boss");
    expect(reviewFileOf(provider.requests[0])).toContain("## Risk map");
    expect(reviewFileOf(provider.requests[0])).not.toContain(stranger);
  });

  test("explain, and a bare mention, ask for the walkthrough", () => {
    for (const request of ["/wachiman explain", "@agent-review"]) {
      const posted: string[] = [];
      const provider = new FakeProvider([() => ({ structuredOutput: ANSWER })]);
      comment(depsFor(provider, fakeGh([REVIEW]), posted), "o/r", 7, request, "boss");
      const prompt = provider.requests[0].prompt;
      expect(prompt, request).toContain("No question was asked, so explain the change");
      expect(prompt, request).toContain("1. What the change does");
      expect(prompt, request).not.toContain("<request>");
    }
  });

  test("an answer with no sections and no reason is the existing error", () => {
    const posted: string[] = [];
    const provider = new FakeProvider([() => ({ structuredOutput: { sections: [], not_answered: "" } })]);
    expect(() => comment(depsFor(provider, fakeGh([REVIEW]), posted), "o/r", 7, "/wachiman why?", "boss")).toThrow(
      "The agent did not answer",
    );
    expect(posted).toHaveLength(0);
  });
});
