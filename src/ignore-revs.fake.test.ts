import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config";
import { GhError, githubFormatOnly, review, type Deps, type GhFn, type ReviewOutput } from "./engine";
import type { ProviderAdapter, ProviderRequest, ProviderResult } from "./providers/types";

// Routing by `.git-blame-ignore-revs` in a pull request run (ADR 0063): a file only listed
// formatting commits touched is reviewed by `format_model`, priced with its own figure, and the
// size-gate comment shows both groups. The engine reads the file and the commits through GitHub,
// never through git on the checkout.

const BASE = "b".repeat(40);
const HEAD = "abc1234" + "0".repeat(33);
const FORMAT_SHA = "f0f0f0f" + "1".repeat(33);
const WORK_SHA = "d1d1d1d" + "2".repeat(33);

class FakeProvider implements ProviderAdapter {
  readonly requests: ProviderRequest[] = [];
  constructor(
    readonly name: string,
    private readonly cost: number,
  ) {}
  preflight() {}
  modelLabel() {
    return this.name;
  }
  leaksSecret() {
    return false;
  }
  /** The files a request names, in the prompt's "These files" list. */
  filesOf(request: ProviderRequest): string[] {
    return [...request.prompt.split("This part holds exactly these files")[1].split("\n\n")[0].matchAll(/^- (\S+) \+/gm)].map((m) => m[1]);
  }
  get files(): string[] {
    return this.requests.flatMap((r) => this.filesOf(r));
  }
  async run(request: ProviderRequest): Promise<ProviderResult> {
    this.requests.push(request);
    const output: ReviewOutput = { files_reviewed: this.filesOf(request), files_skipped: [], findings: [], contracts: [], thread_replies: [], summary: "ok" };
    return { costUsd: this.cost, turns: 1, durationMs: 1, terminalReason: "success", isError: false, raw: {}, structuredOutput: output };
  }
}

const bigFile = (name: string, lines = 1000) => ({
  filename: name,
  additions: lines,
  deletions: 0,
  patch: `@@ -0,0 +1,${lines} @@\n${Array.from({ length: lines }, (_, k) => `+line ${k}`).join("\n")}`,
});

interface Options {
  /** The text of `.git-blame-ignore-revs` at the head; omitted for a repository without one. */
  ignoreRevs?: string;
  /** The commits of the pull request, oldest first, with the files each one touched. */
  commits?: { sha: string; paths: string[] }[];
  /** Make the commits endpoint fail. */
  commitsFail?: boolean;
  /** The file count each commit's page reports, as the engine's jq prints it; omitted prints none. */
  fileCount?: number;
}

function world(files: ReturnType<typeof bigFile>[], o: Options = {}) {
  const calls: string[] = [];
  const posted: { kind: "comment" | "patch" | "review"; body: string }[] = [];
  const gh: GhFn = (args, input) => {
    const line = args.join(" ");
    calls.push(line);
    if (line.startsWith("pr comment")) {
      posted.push({ kind: "comment", body: input ?? "" });
      return "";
    }
    if (args.includes("PATCH")) {
      posted.push({ kind: "patch", body: args[args.length - 1].replace(/^body=/, "") });
      return "{}";
    }
    if (args.includes("POST")) {
      if (line.includes("/pulls/7/reviews")) posted.push({ kind: "review", body: JSON.parse(input ?? "{}").body });
      return "{}";
    }
    if (line.includes("/issues/7/comments")) return "";
    if (line.startsWith("pr view")) return JSON.stringify({ headRefOid: HEAD, title: "t", body: "b", author: { login: "u" } });
    if (line.startsWith("api repos/o/r/pulls/7 ")) return BASE;
    if (line.includes("/pulls/7/files")) return files.map((f) => JSON.stringify(f)).join("\n");
    if (line.includes("/pulls/7/reviews")) return "";
    if (line.includes("/pulls/7/comments")) return "";
    if (line.includes("/pulls/7/commits")) {
      if (o.commitsFail) throw new Error("gh: Server Error (HTTP 500)");
      return (o.commits ?? []).map((c) => c.sha).join("\n");
    }
    const commit = line.match(/repos\/o\/r\/commits\/([0-9a-f]{40})\?per_page=100/);
    if (commit) {
      const paths = (o.commits ?? []).find((c) => c.sha === commit[1])?.paths ?? [];
      return [...(o.fileCount === undefined ? [] : [`\u0001${o.fileCount}`]), ...paths].join("\n");
    }
    if (line.startsWith("api graphql")) return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } });
    if (line.includes("/contents/")) {
      const m = line.match(/contents\/(.+)\?ref=(.+)$/);
      if (m && m[1] === ".git-blame-ignore-revs" && m[2] === HEAD && o.ignoreRevs !== undefined) {
        return JSON.stringify({ type: "file", encoding: "base64", content: Buffer.from(o.ignoreRevs).toString("base64") });
      }
      throw new GhError("gh: Not Found (HTTP 404)", 404, "Not Found");
    }
    if (line.match(/compare\/(\S+?)\.\.\.(\S+)/)) return JSON.stringify({ status: "ahead", files });
    throw new Error(`unexpected gh call: ${line}`);
  };
  return { gh, calls, posted };
}

async function run(w: ReturnType<typeof world>, env: Record<string, string> = {}, withFormat = true) {
  const main = new FakeProvider("main-model", 0.2);
  const format = new FakeProvider("format-model", 0.01);
  const logs: string[] = [];
  const deps: Deps = {
    gh: w.gh,
    provider: main,
    ...(withFormat ? { formatProvider: format } : {}),
    config: loadConfig({ WACHIMAN_VERIFY: "0", WACHIMAN_TRIGGER: "synchronize", WACHIMAN_MODEL: "claude-sonnet-5-5", WACHIMAN_OPERATOR: "owner", ...env }),
    repoDir: mkdtempSync(join(tmpdir(), "ignore-revs-head-")),
    log: (l) => void logs.push(l),
    warn: () => {},
    lineCounter: () => 100,
    sleep: () => {},
  };
  await review(deps, "o/r", 7, []);
  return { main, format, logs: logs.join("\n") };
}

const FILES = [bigFile("src/fmt.ts", 20), bigFile("src/work.ts", 20), bigFile("src/both.ts", 20)];
const COMMITS = [
  { sha: FORMAT_SHA, paths: ["src/fmt.ts", "src/both.ts"] },
  { sha: WORK_SHA, paths: ["src/work.ts", "src/both.ts"] },
];
const LISTING = `# formatter run\n${FORMAT_SHA} # bun fmt\n`;

describe("a file changed only by listed commits is reviewed by format_model (AC17)", () => {
  test("it goes to the format provider; a file also touched by an unlisted commit stays with the main one", async () => {
    const w = world(FILES, { ignoreRevs: LISTING, commits: COMMITS });
    const { main, format } = await run(w);
    expect(format.files.sort()).toEqual(["src/fmt.ts"]);
    expect(main.files.sort()).toEqual(["src/both.ts", "src/work.ts"]);
  });

  test("without a .git-blame-ignore-revs file every file goes to the main model and no commit is read", async () => {
    const w = world(FILES, { commits: COMMITS });
    const { main, format } = await run(w);
    expect(format.requests).toEqual([]);
    expect(main.files.sort()).toEqual(["src/both.ts", "src/fmt.ts", "src/work.ts"]);
    expect(w.calls.some((c) => c.includes("/commits"))).toBe(false);
  });

  test("a listing that names no commit of the range reads no commit's files", async () => {
    const w = world(FILES, { ignoreRevs: `${"e".repeat(40)}\n`, commits: COMMITS });
    const { format } = await run(w);
    expect(format.requests).toEqual([]);
    expect(w.calls.some((c) => /repos\/o\/r\/commits\//.test(c))).toBe(false);
  });

  test("an error reading the commits sends every file to the main model and never fails the review", async () => {
    const w = world(FILES, { ignoreRevs: LISTING, commits: COMMITS, commitsFail: true });
    const { main, format, logs } = await run(w);
    expect(format.requests).toEqual([]);
    expect(main.files.length).toBe(3);
    expect(logs).toContain("could not be used");
  });

  test("no format provider keeps the one-model behaviour and reads no commits", async () => {
    const w = world(FILES, { ignoreRevs: LISTING, commits: COMMITS });
    const { main } = await run(w, {}, false);
    expect(main.files.length).toBe(3);
    expect(w.calls.some((c) => c.includes("/pulls/7/commits"))).toBe(false);
  });

  test("an empty format_model is the default model, so the commits are still read", async () => {
    const w = world(FILES, { ignoreRevs: LISTING, commits: COMMITS });
    const { format } = await run(w, { WACHIMAN_FORMAT_MODEL: "" });
    expect(format.files).toEqual(["src/fmt.ts"]);
    expect(w.calls.some((c) => c.includes("/pulls/7/commits"))).toBe(true);
  });
});

describe("githubFormatOnly reads the pull request through GitHub (AC17)", () => {
  const names = FILES.map((f) => f.filename);

  test("a range longer than 100 commits is not routed and no commit's files are read", () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ sha: i.toString(16).padStart(40, "0"), paths: [] as string[] }));
    many[0] = { sha: FORMAT_SHA, paths: ["src/fmt.ts"] };
    const w = world(FILES, { ignoreRevs: LISTING, commits: many });
    const notes: string[] = [];
    expect(githubFormatOnly(w.gh, "o/r", 7, HEAD, names, (l) => notes.push(l))).toEqual([]);
    expect(w.calls.some((c) => /repos\/o\/r\/commits\//.test(c))).toBe(false);
    expect(notes.join("\n")).toContain("101 commits");
  });

  test("the answer is the names, in the order of the files", () => {
    const w = world(FILES, { ignoreRevs: LISTING, commits: COMMITS });
    expect(githubFormatOnly(w.gh, "o/r", 7, HEAD, names, () => {})).toEqual(["src/fmt.ts"]);
  });

  test("a commit that touched 3000 files is not trusted: nothing is routed and the note says why", () => {
    const w = world(FILES, { ignoreRevs: LISTING, commits: COMMITS, fileCount: 3000 });
    const notes: string[] = [];
    expect(githubFormatOnly(w.gh, "o/r", 7, HEAD, names, (l) => notes.push(l))).toEqual([]);
    expect(notes.join("\n")).toContain("3000 or more files");
  });

  test("a commit under the cap with its count printed is routed as before", () => {
    const w = world(FILES, { ignoreRevs: LISTING, commits: COMMITS, fileCount: 2 });
    expect(githubFormatOnly(w.gh, "o/r", 7, HEAD, names, () => {})).toEqual(["src/fmt.ts"]);
  });

  test("a renamed file is matched by either of its names", () => {
    const w = world(FILES, { ignoreRevs: LISTING, commits: [{ sha: FORMAT_SHA, paths: ["src/fmt.ts", "src/old-fmt.ts"] }] });
    expect(githubFormatOnly(w.gh, "o/r", 7, HEAD, [...names, "src/old-fmt.ts"], () => {})).toEqual(["src/fmt.ts", "src/old-fmt.ts"]);
  });
});

describe("the estimate prices each group with its own figure (AC18)", () => {
  /** 30 files of 1,000 lines: 30 main batches, about $9.60 at the Sonnet figure, above the $3 default room. */
  const LARGE = Array.from({ length: 30 }, (_, i) => bigFile(`pkg${i}/mod.ts`));
  const FORMATTED = LARGE.slice(0, 25).map((f) => f.filename);
  const commits = [
    { sha: FORMAT_SHA, paths: FORMATTED },
    { sha: WORK_SHA, paths: LARGE.slice(25).map((f) => f.filename) },
  ];

  test("a review that the gate would skip is started when most of its files are format-only (AC17, AC18)", async () => {
    const without = await run(world(LARGE, { commits }));
    expect(without.main.requests.length).toBe(0);

    const w = world(LARGE, { ignoreRevs: LISTING, commits });
    const { main, format } = await run(w);
    expect(format.files.length).toBe(25);
    expect(main.files.length).toBe(5);
  });

  test("the size-gate comment shows both groups, each with its model and figure", async () => {
    const few = world(LARGE, { ignoreRevs: LISTING, commits: [{ sha: FORMAT_SHA, paths: FORMATTED.slice(0, 4) }, { sha: WORK_SHA, paths: LARGE.slice(4).map((f) => f.filename) }] });
    const { main, format } = await run(few);
    expect(main.requests.length + format.requests.length).toBe(0);
    const body = few.posted.map((p) => p.body).join("\n");
    expect(body).toContain("for `claude-sonnet-5-5`");
    expect(body).toContain("for `claude-haiku-5-5` at low effort");
    expect(body).toContain("changed only by commits in `.git-blame-ignore-revs`");
    expect(body).toContain("$0.015 a batch");
  });
});

describe("the review lists the files read by the cheaper model on their own line (AC19)", () => {
  const reviewBody = (w: ReturnType<typeof world>) => w.posted.filter((p) => p.kind === "review").map((p) => p.body).join("\n");

  test("one paragraph names the model, the effort and the reason, and a collapsed list names the files", async () => {
    const w = world(FILES, { ignoreRevs: LISTING, commits: COMMITS });
    await run(w);
    const body = reviewBody(w);
    expect(body).toContain("ℹ️ **1 file reviewed by `claude-haiku-5-5` at effort low**: changed only by commits in `.git-blame-ignore-revs`.");
    expect(body).toContain("<details><summary>Files reviewed by `claude-haiku-5-5`</summary>");
    expect(body).toContain("- `src/fmt.ts`");
    expect(body).not.toContain("- `src/work.ts`");
  });

  test("a review with no format-only file has no such line", async () => {
    const w = world(FILES, { commits: COMMITS });
    await run(w);
    expect(reviewBody(w)).not.toContain("reviewed by `claude-haiku-5-5`");
  });

  test("the list is bounded: 40 files show 30 names and the count of the rest", async () => {
    const many = Array.from({ length: 40 }, (_, i) => bigFile(`pkg${String(i).padStart(2, "0")}/mod.ts`, 5));
    const w = world(many, { ignoreRevs: LISTING, commits: [{ sha: FORMAT_SHA, paths: many.map((f) => f.filename) }] });
    await run(w);
    const body = reviewBody(w);
    expect(body).toContain("40 files reviewed by `claude-haiku-5-5` at effort low");
    expect(body.match(/^- `pkg\d\d\/mod\.ts`$/gm)?.length).toBe(30);
    expect(body).toContain("- and 10 more");
  });
});
