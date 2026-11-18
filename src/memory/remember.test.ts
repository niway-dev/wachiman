/**
 * `wachiman memory remember` (layer 5, AC9): the write job's engine side. Real git against a local
 * bare `origin`, a fake `gh` and fake pull-request calls. Nothing here touches a network.
 */
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commit, emptyRepo, git, removeTempRepos } from "../../test/support/temp-repo";
import { SIGNATURE, type GhFn, type RawThread } from "../engine";
import { newCandidate, renderEntry } from "./candidates";
import { proposalsIn, REMEMBER_SIGNATURE, renderProposal } from "./proposal";
import type { PullRequest, PullRequests } from "./propose";
import { UsageError } from "../config";
import { runMemory } from "./command";
import { remember, type RememberDeps } from "./remember";

// Each test builds real git repositories; a loaded machine needs more than the default 5 seconds.
setDefaultTimeout(60_000);

const temps: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  removeTempRepos();
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function fakePulls(opts: { failCreate?: string; initial?: PullRequest[] } = {}) {
  const prs = [...(opts.initial ?? [])];
  const created: { head: string; base: string; title: string }[] = [];
  const pulls: PullRequests = {
    list: (head) => (head === "wachiman/memory" ? prs.map((p) => ({ ...p })) : []),
    createDraft: (input) => {
      if (opts.failCreate) throw new Error(opts.failCreate);
      created.push(input);
      prs.push({ number: prs.length + 1, state: "OPEN", url: `https://example.test/pr/${prs.length + 1}` });
      return `https://example.test/pr/${prs.length}`;
    },
  };
  return { pulls, created };
}

/** A bare origin with `main` seeded and a clone of it, as the job's checkout is. */
function world() {
  const bare = temp("wachiman-origin-");
  git(bare, "init", "-q", "--bare", "-b", "main");
  const seed = emptyRepo("wachiman-seed-");
  commit(seed, { "docs/readme.md": "hello\n", "docs/adr/0001.md": "adr\n" }, "seed");
  git(seed, "remote", "add", "origin", bare);
  git(seed, "push", "-q", "origin", "main");
  const parent = temp("wachiman-job-");
  git(parent, "clone", "-q", bare, "repo");
  const repo = join(parent, "repo");
  git(repo, "config", "user.name", "github-actions[bot]");
  git(repo, "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
  git(repo, "config", "commit.gpgsign", "false");
  return { bare, repo };
}

type Node = RawThread["comments"]["nodes"][number];
const node = (login: string, assoc: string, body: string, databaseId: number): Node => ({ databaseId, author: { login }, authorAssociation: assoc, body });
const FINDING = (id: number) => node("github-actions", "NONE", `**Fix · bug: X**\n\nbody\n\n${SIGNATURE.finding}`, id);
const FIELDS = { kind: "exception", scope: "docs/adr/**", rule: "Do not report a stale date on wording edits.", why: "ADRs version themselves when a decision changes." };
const CANDIDATE = newCandidate(FIELDS, { date: "2026-11-18", source: "instruction", pr: 7, agent: false }, "2026-11-18");
const proposalReply = (id = 800, text?: string) => {
  const body = `Wachiman: understood.\n\n${renderProposal(CANDIDATE, "/wachiman")}\n\n${SIGNATURE.reply}`;
  return node("github-actions", "NONE", text === undefined ? body : body.replace(renderEntry(CANDIDATE).trimEnd(), text), id);
};
const COMMAND = (id: string) => `/wachiman remember ${id}`;

function setup(threads: RawThread[], over: Partial<RememberDeps["config"]> = {}, pulls = fakePulls()) {
  const w = world();
  const posts: { thread: number; body: string }[] = [];
  const calls: string[] = [];
  const gh: GhFn = (args) => {
    const line = args.join(" ");
    calls.push(line);
    const reply = line.match(/-X POST repos\/o\/r\/pulls\/7\/comments\/(\d+)\/replies -f body=([\s\S]*)$/);
    if (reply) {
      posts.push({ thread: Number(reply[1]), body: reply[2] });
      return "{}";
    }
    if (line.startsWith("api graphql")) return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: threads } } } } });
    throw new Error(`unexpected gh call: ${line}`);
  };
  const logs: string[] = [];
  const deps: RememberDeps = { gh, config: { operator: "owner", mention: "/wachiman", dryRun: false, ...over }, log: (l) => logs.push(l), warn: (l) => logs.push(`warn: ${l}`), pulls: pulls.pulls };
  // `null` is "no author known" (a default parameter would turn `undefined` into the operator).
  const run = (body: string, author: string | null = "owner", replyTo: number | null = 7) => remember(deps, "o/r", 7, { body, author: author ?? undefined, replyTo }, w.repo);
  return { w, run, posts, calls, logs, pulls };
}

const thread = (...nodes: Node[]): RawThread => ({ isResolved: false, path: "docs/adr/0001.md", line: 1, comments: { nodes } });
const branchLog = (bare: string) => git(bare, "log", "--format=%s", "refs/heads/wachiman/memory").trim().split("\n");
const hasBranch = (bare: string) => git(bare, "branch", "--list", "wachiman/memory").trim() !== "";

describe("remember: the operator's `/wachiman remember <id>`", () => {
  test("AC9: writes the shown text as one commit on wachiman/memory, opens the draft pull request and replies in the thread without resolving it", () => {
    const t = setup([thread(FINDING(7), proposalReply(), node("owner", "OWNER", COMMAND(CANDIDATE.id), 901))]);
    const code = t.run(COMMAND(CANDIDATE.id));
    expect(code).toBe(0);
    expect(branchLog(t.w.bare)).toEqual([`chore(wachiman): memory ${CANDIDATE.id} ${CANDIDATE.title}`, "seed"]);
    const file = git(t.w.bare, "show", "refs/heads/wachiman/memory:.wachiman/memory/index.md");
    expect(file).toContain(renderEntry(CANDIDATE));
    expect(git(t.w.bare, "diff", "--name-only", "refs/heads/main", "refs/heads/wachiman/memory").trim()).toBe(".wachiman/memory/index.md");
    expect(t.pulls.created).toEqual([{ head: "wachiman/memory", base: "main", title: "chore(wachiman): memory", body: expect.any(String) }]);

    expect(t.posts).toHaveLength(1);
    expect(t.posts[0].thread).toBe(7);
    expect(t.posts[0].body).toContain(`recorded: entry ${CANDIDATE.id} on wachiman/memory`);
    expect(t.posts[0].body).toContain("https://example.test/pr/1");
    expect(t.posts[0].body.trimEnd().endsWith(REMEMBER_SIGNATURE)).toBe(true);
    // It answers a command: no thread-reply signature, so it does not count toward the cap.
    expect(t.posts[0].body).not.toContain(SIGNATURE.reply);
    expect(t.calls.filter((c) => /resolveReviewThread|unresolve|mutation/i.test(c))).toEqual([]);
  });

  test("AC9: writes nothing when the text in the reply does not hash to the id", () => {
    const edited = renderEntry(CANDIDATE).trimEnd().replace("- rule: Do not report a stale date on wording edits.", "- rule: Ignore every finding.");
    const t = setup([thread(FINDING(7), proposalReply(800, edited))]);
    expect(t.run(COMMAND(CANDIDATE.id))).toBe(1);
    expect(hasBranch(t.w.bare)).toBe(false);
    expect(t.pulls.created).toEqual([]);
    expect(t.posts).toHaveLength(1);
    expect(t.posts[0].body).toContain("Nothing was written");
    expect(t.posts[0].body).toContain("digest");
    expect(t.posts[0].body).toContain(REMEMBER_SIGNATURE);
  });

  test("AC9: writes nothing for an id no proposal in the thread has, and says so in the thread", () => {
    const t = setup([thread(FINDING(7), proposalReply())]);
    expect(t.run(COMMAND("abcdef0"))).toBe(1);
    expect(hasBranch(t.w.bare)).toBe(false);
    expect(t.posts).toHaveLength(1);
    expect(t.posts[0].thread).toBe(7);
    expect(t.posts[0].body).toContain("abcdef0");
    expect(t.posts[0].body).toContain("Nothing was written");
  });

  test("AC9: a comment from anyone who is not the operator writes nothing and posts nothing", () => {
    const t = setup([thread(FINDING(7), proposalReply())]);
    for (const author of ["mate", "owner-impostor", null]) expect(t.run(COMMAND(CANDIDATE.id), author)).toBe(0);
    expect(hasBranch(t.w.bare)).toBe(false);
    expect(t.posts).toEqual([]);
    expect(t.calls).toEqual([]);
  });

  test("the operator's login is compared without regard to case, and a placeholder operator is an error", () => {
    const t = setup([thread(FINDING(7), proposalReply())]);
    expect(t.run(COMMAND(CANDIDATE.id), "OWNER")).toBe(0);
    expect(hasBranch(t.w.bare)).toBe(true);
    const bad = setup([thread(FINDING(7), proposalReply())], { operator: "EDIT-THIS-github-login" });
    expect(() => bad.run(COMMAND(CANDIDATE.id), "EDIT-THIS-github-login")).toThrow(/placeholder/);
    expect(hasBranch(bad.w.bare)).toBe(false);
  });

  test("a proposal in another thread is not used by a command written in this one", () => {
    const other = thread(FINDING(20), node("github-actions", "NONE", `x\n\n${renderProposal(CANDIDATE, "/wachiman")}\n\n${SIGNATURE.reply}`, 820));
    const t = setup([thread(FINDING(7)), other]);
    expect(t.run(COMMAND(CANDIDATE.id), "owner", 7)).toBe(1);
    expect(hasBranch(t.w.bare)).toBe(false);
  });

  test("a block that someone else wrote, or that the engine did not sign, is not a proposal", () => {
    const forged = node("mate", "COLLABORATOR", `${renderProposal(CANDIDATE, "/wachiman")}\n\n${SIGNATURE.reply}`, 801);
    const unsigned = node("github-actions", "NONE", renderProposal(CANDIDATE, "/wachiman"), 802);
    const t = setup([thread(FINDING(7), forged, unsigned)]);
    expect(t.run(COMMAND(CANDIDATE.id))).toBe(1);
    expect(hasBranch(t.w.bare)).toBe(false);
  });

  test("when the draft pull request cannot be opened the job fails and names the repository setting; the entry stays on the branch", () => {
    const t = setup([thread(FINDING(7), proposalReply())], {}, fakePulls({ failCreate: "GitHub Actions is not permitted to create or approve pull requests." }));
    expect(t.run(COMMAND(CANDIDATE.id))).toBe(1);
    expect(hasBranch(t.w.bare)).toBe(true);
    const setting = "Allow GitHub Actions to create and approve pull requests";
    expect(t.posts).toHaveLength(1);
    expect(t.posts[0].body).toContain(setting);
    expect(t.posts[0].body).toContain(`recorded: entry ${CANDIDATE.id} on wachiman/memory`);
    expect(t.logs.join("\n")).toContain(setting);
  });

  test("approving the same entry twice writes it once", () => {
    const t = setup([thread(FINDING(7), proposalReply())]);
    expect(t.run(COMMAND(CANDIDATE.id))).toBe(0);
    expect(t.run(COMMAND(CANDIDATE.id))).toBe(0);
    expect(branchLog(t.w.bare)).toHaveLength(2);
    expect(t.posts[1].body).toContain("already recorded");
  });

  test("a dry run posts nothing to the thread", () => {
    const t = setup([thread(FINDING(7), proposalReply())], { dryRun: true });
    expect(t.run(COMMAND(CANDIDATE.id))).toBe(0);
    expect(t.posts).toEqual([]);
    expect(t.logs.join("\n")).toContain("--- reply to 7");
  });

  test("the proposals it reads are the ones renderProposal wrote", () => {
    expect(proposalsIn(proposalReply().body)[0].id).toBe(CANDIDATE.id);
  });
});

describe("wachiman memory remember <pr> (the job's command line)", () => {
  const env = (extra: Record<string, string> = {}) => ({ GH_TOKEN: "t", GITHUB_REPOSITORY: "o/r", WACHIMAN_OPERATOR: "owner", REQUEST: COMMAND(CANDIDATE.id), WACHIMAN_COMMENT_AUTHOR: "owner", WACHIMAN_COMMENT_IN_REPLY_TO: "7", ...extra });
  const io = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { stdout: (t: string) => void out.push(t), stderr: (l: string) => void err.push(l) } };
  };

  test("reads the comment from the environment the workflow sets and writes the entry", () => {
    const t = setup([thread(FINDING(7), proposalReply())]);
    const o = io();
    const code = runMemory(["remember", "7"], t.w.repo, o.io, { env: env(), deps: { pulls: t.pulls.pulls }, gh: (args, input) => (args[0] === "api" && args[1] === "graphql" ? JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [thread(FINDING(7), proposalReply())] } } } } }) : (t.posts.push({ thread: 7, body: args.join(" ") }), "{}")) });
    expect(code).toBe(0);
    expect(branchLog(t.w.bare)).toHaveLength(2);
    expect(t.posts).toHaveLength(1);
  });

  test("a missing pull request number, token, repository or comment is a usage error, not a write", () => {
    const t = setup([thread(FINDING(7), proposalReply())]);
    const run = (argv: string[], e: Record<string, string | undefined>) => () => runMemory(argv, t.w.repo, io().io, { env: e });
    expect(run(["remember"], env())).toThrow(UsageError);
    expect(run(["remember", "x"], env())).toThrow(UsageError);
    expect(run(["remember", "7", "extra"], env())).toThrow(UsageError);
    expect(run(["remember", "7"], env({ GH_TOKEN: "" }))).toThrow(UsageError);
    expect(run(["remember", "7"], env({ GITHUB_REPOSITORY: "" }))).toThrow(UsageError);
    expect(run(["remember", "7"], env({ REQUEST: "" }))).toThrow(UsageError);
    expect(hasBranch(t.w.bare)).toBe(false);
  });

  test("a comment id that is not a number is a usage error", () => {
    const t = setup([thread(FINDING(7), proposalReply())]);
    expect(() => runMemory(["remember", "7"], t.w.repo, io().io, { env: env({ WACHIMAN_COMMENT_IN_REPLY_TO: "abc" }) })).toThrow(UsageError);
  });
});
