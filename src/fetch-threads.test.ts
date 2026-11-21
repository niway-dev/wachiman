import { describe, expect, test } from "bun:test";
import { GhError, SIGNATURE, earlierThreadCount, fetchThreadPages, fetchThreads, type GhFn, type RawThread } from "./engine";

/** An open thread started by the engine's own finding comment. */
const botThread = (id: number, over: Partial<RawThread> = {}): RawThread => ({
  isResolved: false,
  path: "src/a.ts",
  line: 1,
  comments: {
    nodes: [{ databaseId: id, author: { login: "github-actions" }, authorAssociation: "NONE", body: `| 👮 **Wachiman** | t |\n\nbody\n\n${SIGNATURE.finding}` }],
  },
  ...over,
});

const humanThread = (id: number): RawThread => ({
  isResolved: false,
  path: "src/a.ts",
  line: 1,
  comments: { nodes: [{ databaseId: id, author: { login: "alice" }, authorAssociation: "MEMBER", body: "a question" }] },
});

type Page = { nodes: RawThread[]; next?: string } | Error;

/** A `gh` that serves review-thread pages in order, recording the cursor each call asked for. */
function pagedGh(pages: Page[]) {
  const asked: (string | null)[] = [];
  const gh: GhFn = (args) => {
    const after = args.find((a) => a.startsWith("after="));
    const call = asked.length;
    asked.push(after ? after.slice("after=".length) : null);
    const page = pages[Math.min(call, pages.length - 1)];
    if (page instanceof Error) throw page;
    const pageInfo = page.next ? { hasNextPage: true, endCursor: page.next } : { hasNextPage: false, endCursor: null };
    return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { pageInfo, nodes: page.nodes } } } } });
  };
  return { gh, asked };
}

const down = () => new GhError("GitHub answered 502", 502, "Bad Gateway");

describe("fetchThreads", () => {
  test("one page without pageInfo (an older fake, or a short list) is one call", () => {
    const calls: string[][] = [];
    const gh: GhFn = (args) => {
      calls.push(args);
      return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [botThread(1)] } } } } });
    };
    expect(fetchThreads(gh, "o/r", 7)).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  test("reads every page, past the first 100 threads, passing each page's cursor to the next", () => {
    const first = Array.from({ length: 100 }, (_, i) => botThread(i + 1));
    const second = Array.from({ length: 40 }, (_, i) => botThread(200 + i));
    const { gh, asked } = pagedGh([{ nodes: first, next: "cursor-1" }, { nodes: second }]);
    const threads = fetchThreads(gh, "o/r", 7);
    expect(threads).toHaveLength(140);
    expect(asked).toEqual([null, "cursor-1"]);
  });

  test("a page that fails after the first keeps what was read, as before pagination existed", () => {
    const { gh } = pagedGh([{ nodes: [botThread(1)], next: "c1" }, down()]);
    expect(fetchThreads(gh, "o/r", 7)).toHaveLength(1);
  });

  test("a first page that fails still throws, as it always did", () => {
    const { gh } = pagedGh([down()]);
    expect(() => fetchThreads(gh, "o/r", 7)).toThrow(GhError);
  });
});

describe("fetchThreadPages", () => {
  test("says whether every page was read", () => {
    const ok = fetchThreadPages(pagedGh([{ nodes: [botThread(1)], next: "c1" }, { nodes: [botThread(2)] }]).gh, "o/r", 7);
    expect(ok.complete).toBe(true);
    expect(ok.threads).toHaveLength(2);
    const cut = fetchThreadPages(pagedGh([{ nodes: [botThread(1)], next: "c1" }, down()]).gh, "o/r", 7);
    expect(cut.complete).toBe(false);
    expect(cut.threads).toHaveLength(1);
  });

  test("a cursor that does not advance stops instead of looping, and the read is incomplete", () => {
    const { gh, asked } = pagedGh([{ nodes: [botThread(1)], next: "same" }, { nodes: [botThread(2)], next: "same" }]);
    const result = fetchThreadPages(gh, "o/r", 7);
    expect(result.complete).toBe(false);
    expect(asked).toHaveLength(2);
  });

  test("an answer that is not a list of threads is a failed page, not an empty one", () => {
    const gh: GhFn = () => JSON.stringify({ data: { repository: null } });
    expect(fetchThreadPages(gh, "o/r", 7).complete).toBe(false);
    expect(fetchThreadPages(() => "not json", "o/r", 7).complete).toBe(false);
  });
});

describe("earlierThreadCount", () => {
  test("counts the engine's own unresolved finding threads across every page", () => {
    const { gh } = pagedGh([
      { nodes: [botThread(1), humanThread(2), botThread(3, { isResolved: true })], next: "c1" },
      { nodes: [botThread(4), botThread(5)] },
    ]);
    expect(earlierThreadCount(gh, "o/r", 7)).toBe(3);
  });

  test("is 0 when there are none", () => {
    expect(earlierThreadCount(pagedGh([{ nodes: [humanThread(1)] }]).gh, "o/r", 7)).toBe(0);
  });

  test("is 'unknown' when a later page fails: a partial count would read as 'nothing open'", () => {
    const { gh } = pagedGh([{ nodes: [], next: "c1" }, down()]);
    expect(earlierThreadCount(gh, "o/r", 7)).toBe("unknown");
  });

  test("is 'unknown' when the first page fails", () => {
    expect(earlierThreadCount(pagedGh([down()]).gh, "o/r", 7)).toBe("unknown");
  });
});
