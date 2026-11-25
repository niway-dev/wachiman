import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig as loadConfigWithDefaults } from "./config";
import { GhError, lastEngineMarker, readAutoCost, readSignedStateBlock, review, type Deps, type GhFn, type ReviewOutput } from "./engine";
import type { ProviderAdapter, ProviderRequest, ProviderResult } from "./providers/types";

// ADR 0060, through the whole engine: `review()` posts one review and its signed footer ends with
// the marker (when there is one), the state block and the attempt line, in that order. Each kind of
// review is driven the way a real run reaches it; the pieces (the codec, the footer readers, the
// notices) have their own files.

const loadConfig = (env: Record<string, string | undefined>) => loadConfigWithDefaults({ WACHIMAN_VERIFY: "0", ...env });

const MANAGER = "src/manager.ts";
const STORE = "src/store.ts";
const LOGO = "assets/logo.png";
const BASE = "b".repeat(40);
const HEAD = "head1234567";
const LAST = "old1111111";

const files = [
  { filename: MANAGER, additions: 6, deletions: 0, patch: "@@ -1,1 +1,6 @@\n ctx\n+a\n+b\n+c\n+d\n+e" },
  { filename: STORE, additions: 3, deletions: 0, patch: "@@ -0,0 +1,3 @@\n+x\n+y\n+z" },
  { filename: LOGO, additions: 0, deletions: 0 },
];

class Scripted implements ProviderAdapter {
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
  async run(request: ProviderRequest): Promise<ProviderResult> {
    this.requests.push(request);
    const step = this.script[this.requests.length - 1];
    if (!step) throw new Error("the fake provider has no answer left");
    return { costUsd: 0.1, turns: 1, durationMs: 1, terminalReason: "success", isError: false, raw: {}, ...step(request) };
  }
}

const out = (over: Partial<ReviewOutput>): ReviewOutput => ({
  files_reviewed: [],
  files_skipped: [],
  findings: [],
  thread_replies: [],
  summary: "ok",
  ...over,
});

const finding = (line: number, severity: "blocker" | "fix" | "consider" | "info", path = MANAGER) => ({
  path,
  line,
  severity,
  topic: "bug" as const,
  title: `Finding ${severity} ${line}`,
  body: "Detail.",
});

/** A head checkout where the logo is a real binary (NUL bytes), so the engine, not the model, sets it aside. */
function headWithLogo() {
  const dir = mkdtempSync(join(tmpdir(), "state-head-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, LOGO), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]));
  return dir;
}

interface Post {
  body: string;
  comments: unknown[];
}

interface World {
  provider: Scripted;
  posts: Post[];
  deps: Deps;
}

/**
 * A GitHub with one pull request. `prior` is the body of an earlier bot review (then a push compares
 * `LAST...HEAD`); `refuseFirst` makes the first POST that carries inline comments fail with the
 * validation 422 that makes the engine move them into the body.
 */
function world(
  script: ConstructorParameters<typeof Scripted>[0],
  opts: { prior?: string; since?: typeof files; refuseFirst?: boolean; env?: Record<string, string>; pr?: typeof files } = {},
): World {
  const posts: Post[] = [];
  let refused = false;
  const pr = opts.pr ?? files;
  const gh: GhFn = (args, input) => {
    const line = args.join(" ");
    const contents = line.match(/contents\/(.+)\?ref=(.+)$/);
    if (contents) throw new GhError("gh: Not Found (HTTP 404)", 404, "Not Found");
    if (line.startsWith("api repos/o/r/pulls/7 ")) return BASE;
    if (line.startsWith("pr view"))
      return JSON.stringify({ headRefOid: HEAD, baseRefName: "main", title: "t", body: "b", author: { login: "u" } });
    if (line.includes("/pulls/7/files")) return pr.map((f) => JSON.stringify(f)).join("\n");
    if (line.includes("/pulls/7/reviews") && !args.includes("POST")) {
      return opts.prior
        ? JSON.stringify({ id: 1, user: { login: "github-actions[bot]" }, body: opts.prior, submitted_at: "2026-10-30T00:00:00Z" })
        : "";
    }
    if (line.startsWith("api graphql")) return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } });
    const compare = line.match(/compare\/(\S+?)\.\.\.(\S+)/);
    if (compare) {
      // `base...last` is what the earlier review saw; `last...head` is what changed since.
      return JSON.stringify({ status: "ahead", files: compare[1] === BASE ? files : (opts.since ?? pr) });
    }
    if (line.includes("-X POST repos/o/r/pulls/7/reviews")) {
      const post = JSON.parse(input ?? "{}") as Post;
      if (opts.refuseFirst && !refused && post.comments.length > 0) {
        refused = true;
        throw new GhError("gh: Unprocessable Entity (HTTP 422)", 422, "Validation Failed", [
          { resource: "PullRequestReviewComment", code: "custom", message: "Line could not be resolved" },
        ]);
      }
      posts.push(post);
      return "{}";
    }
    throw new Error(`unexpected gh call: ${line}`);
  };
  const provider = new Scripted(script);
  const deps: Deps = {
    gh,
    provider,
    config: loadConfig(opts.env ?? {}),
    log: () => {},
    warn: () => {},
    sleep: () => {},
    repoDir: headWithLogo(),
    engineVersion: "1.2.3",
  };
  return { provider, posts, deps };
}

const tail = (body: string) => body.split("\n\n").slice(-3);
const isState = (part: string) => /^<!-- wachi:state [A-Za-z0-9_-]+ -->$/.test(part);

describe("a full review through the engine (AC1, AC2)", () => {
  test("counts its findings by severity and by placement, between the marker and the attempt line", async () => {
    const w = world([
      () => ({
        structuredOutput: out({
          files_reviewed: [MANAGER, STORE],
          findings: [
            finding(2, "fix"), // on a changed line: a thread
            finding(3, "consider"), // a thread
            finding(4, "info"), // information is listed in the body only
            finding(99, "consider"), // a line the diff does not hold: outside the diff
          ],
        }),
      }),
    ]);
    await review(w.deps, "o/r", 7, []);
    expect(w.posts).toHaveLength(1);
    const body = w.posts[0]!.body;
    const state = readSignedStateBlock(body);
    expect(state).not.toBeNull();
    expect(state).toMatchObject({
      format: "wachiman.review-state/1",
      engine: "1.2.3",
      head: HEAD,
      status: "complete",
      reason: null,
      findings: { total: 4, by_severity: { blocker: 0, fix: 1, consider: 2, info: 1 }, unthreaded_blocking: 0 },
    });
    // The placements add up to the total, and the threads are the inline comments that were sent.
    const placed = state!.findings.by_placement;
    expect(placed.inline + placed.body + placed.outside_diff).toBe(4);
    expect(placed.inline).toBe(w.posts[0]!.comments.length);
    expect(placed.inline).toBe(2);
    expect(placed.outside_diff).toBe(1);
    expect(placed.body).toBe(1);
    // Order of the footer: the marker, then the block, then the attempt line.
    const [marker, block, attempt] = tail(body);
    expect(marker).toBe(`<!-- wachiman sha=${HEAD} -->`);
    expect(isState(block!)).toBe(true);
    expect(attempt).toMatch(/^<!-- wachi:attempt id=[0-9a-f-]{36} -->$/);
    expect(state!.attempt).toBe(attempt!.match(/id=([0-9a-f-]{36})/)![1]!);
    // The readers that existed before the block still read the footer (AC5).
    expect(lastEngineMarker([{ body }])).toBe(HEAD);
    expect(readAutoCost(body)).toBeNull();
  });

  test("when GitHub refuses the inline comments, the review posted second counts them under body (AC16)", async () => {
    const w = world(
      [
        () => ({
          structuredOutput: out({
            files_reviewed: [MANAGER, STORE],
            findings: [finding(2, "blocker"), finding(3, "fix"), finding(4, "info")],
          }),
        }),
      ],
      { refuseFirst: true },
    );
    await review(w.deps, "o/r", 7, []);
    // The first POST was refused, so the one that landed has no inline comment and its body lists them.
    expect(w.posts).toHaveLength(1);
    expect(w.posts[0]!.comments).toEqual([]);
    const state = readSignedStateBlock(w.posts[0]!.body);
    expect(state?.findings).toEqual({
      total: 3,
      by_severity: { blocker: 1, fix: 1, consider: 0, info: 1 },
      by_placement: { inline: 0, body: 3, outside_diff: 0 },
      // The two blocking findings lost their threads when they moved.
      unthreaded_blocking: 2,
    });
    expect(tail(w.posts[0]!.body).some(isState)).toBe(true);
    expect(w.posts[0]!.body.match(/<!-- wachi:state /g)).toHaveLength(1);
  });

  test("a partial review says partial and keeps the partial marker the next push reads", async () => {
    const w = world(
      [
        () => ({ terminalReason: "turns", isError: true, turns: 13 }),
        () => ({ structuredOutput: out({ files_reviewed: [MANAGER], findings: [finding(2, "fix")] }) }),
      ],
      { env: { WACHIMAN_MAX_TURNS: "12" }, pr: files.filter((f) => f.filename !== LOGO) },
    );
    await review(w.deps, "o/r", 7, []);
    const body = w.posts[0]!.body;
    const state = readSignedStateBlock(body);
    expect(state).toMatchObject({ status: "partial", reason: null, findings: { total: 1, by_severity: { fix: 1 } } });
    expect(body).toContain("<!-- wachi:partial ");
    expect(body).not.toContain("<!-- wachiman sha=");
    const [partial, block, attempt] = tail(body);
    expect(partial).toMatch(/^<!-- wachi:partial /);
    expect(isState(block!)).toBe(true);
    expect(attempt).toMatch(/^<!-- wachi:attempt /);
    // The partial marker is still what the next push reads, as an engine marker at this commit.
    expect(lastEngineMarker([{ body }])).toBe(HEAD);
  });

  test("a review that reads only some of the pull request's files says scoped and how many", async () => {
    const w = world([() => ({ structuredOutput: out({ files_reviewed: [STORE], findings: [finding(1, "info", STORE)] }) })], {
      pr: files.filter((f) => f.filename !== LOGO),
    });
    await review(w.deps, "o/r", 7, [STORE]);
    const state = readSignedStateBlock(w.posts[0]!.body);
    expect(state).toMatchObject({ status: "scoped", scope: 1, findings: { total: 1 } });
    // A scoped review moves no marker: the last unscoped review's start point stays.
    expect(lastEngineMarker([{ body: w.posts[0]!.body }])).toBeNull();
  });

  test("the all-binary notice says its scope and carries no finding; asked for some paths, it is scoped", async () => {
    const whole = world([], { pr: [files[2]!] });
    await review(whole.deps, "o/r", 7, []);
    expect(whole.provider.requests).toHaveLength(0);
    expect(readSignedStateBlock(whole.posts[0]!.body)).toMatchObject({
      status: "complete",
      scope: "binary_only",
      reason: null,
      findings: { total: 0 },
    });
    const asked = world([], { pr: [files[2]!] });
    await review(asked.deps, "o/r", 7, [LOGO]);
    expect(readSignedStateBlock(asked.posts[0]!.body)).toMatchObject({ status: "scoped", scope: "binary_only", findings: { total: 0 } });
  });
});

describe("a push after a review whose footer carries a block (AC5)", () => {
  const PRIOR_STATE = Buffer.from(
    JSON.stringify({
      format: "wachiman.review-state/1",
      engine: "1.0.0",
      head: LAST,
      attempt: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "complete",
      reason: null,
      findings: {
        total: 1,
        by_severity: { blocker: 0, fix: 1, consider: 0, info: 0 },
        by_placement: { inline: 1, body: 0, outside_diff: 0 },
        unthreaded_blocking: 0,
      },
    }),
  ).toString("base64url");
  const prior = [
    "👮 **Wachiman** · review of the whole pull request, at `old1111`: all 3 files reviewed.",
    "<sub>x</sub>",
    "<!-- wachi:review -->",
    `<!-- wachiman sha=${LAST} -->`,
    `<!-- wachi:state ${PRIOR_STATE} -->`,
    "<!-- wachi:attempt id=11111111-1111-4111-8111-111111111111 -->",
  ].join("\n\n");

  test("starts from the commit the earlier review's marker names, reviews only what changed, and writes its own block", async () => {
    const changed = [{ ...files[1]!, patch: "@@ -0,0 +1,4 @@\n+x\n+y\n+z\n+extra", additions: 4 }];
    const w = world([() => ({ structuredOutput: out({ files_reviewed: [STORE], findings: [finding(2, "consider", STORE)] }) })], {
      prior,
      since: changed,
      pr: [files[0]!, changed[0]!, files[2]!],
    });
    await review(w.deps, "o/r", 7, []);
    // The review began at the earlier commit: the prompt covers the changed file only.
    expect(w.provider.requests).toHaveLength(1);
    expect(w.provider.requests[0]!.prompt).toContain(`- ${STORE} +4 −0`);
    expect(w.provider.requests[0]!.prompt).not.toContain(`- ${MANAGER} +6`);
    const body = w.posts[0]!.body;
    expect(body.split("\n")[0]).toContain("changes since `old1111` at `head123`");
    // Its own block describes this review, at the new head, not the earlier one.
    const state = readSignedStateBlock(body);
    expect(state).toMatchObject({ head: HEAD, status: "complete", findings: { total: 1, by_severity: { consider: 1 } } });
    expect(state!.attempt).not.toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(tail(body).some(isState)).toBe(true);
  });
});
