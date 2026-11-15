/** Publishing the summary against a fake `gh`: which calls it makes, and that it never touches a comment it does not own. */
import { describe, expect, test } from "bun:test";
import { UsageError } from "../config";
import { MAX_COMMENT_CHARS, publishSummary, type GhResult, type GhRunner } from "./publish";
import { SUMMARY_MARKER } from "./summary";

const PR = { number: 7, url: "https://github.com/niway-dev/wachiman/pull/7" };
const BODY = `${SUMMARY_MARKER}\nbody\n`;

/** A scripted `gh`: answers by the first words of the call and records every call. */
function fakeGh(answers: { prs?: unknown; login?: string; commentIds?: string; fail?: string }) {
  const calls: { args: string[]; input?: string }[] = [];
  const ok = (stdout: string): GhResult => ({ status: 0, stdout, stderr: "" });
  const gh: GhRunner = (args, input) => {
    calls.push({ args, input });
    if (answers.fail && args.join(" ").includes(answers.fail)) return { status: 1, stdout: "", stderr: `boom from ${answers.fail}` };
    if (args[0] === "pr") return ok(JSON.stringify(answers.prs ?? [PR]));
    if (args[0] === "api" && args[1] === "user") return ok(`${answers.login ?? "csdev19"}\n`);
    if (args[0] === "api" && args.includes("--paginate")) return ok(answers.commentIds ?? "");
    if (args.includes("PATCH")) return ok("https://github.com/niway-dev/wachiman/pull/7#issuecomment-99\n");
    if (args.includes("POST")) return ok("https://github.com/niway-dev/wachiman/pull/7#issuecomment-100\n");
    return { status: 1, stdout: "", stderr: "unexpected call" };
  };
  return { gh, calls };
}

describe("publishSummary", () => {
  test("it says each step before its gh call, so a slow gh is never silent", () => {
    const f = fakeGh({});
    const said: string[] = [];
    publishSummary(BODY, "feat/x", (a, i) => {
      said.push(`say:${said.length}`);
      return f.gh(a, i);
    }, (step) => said.push(step));
    expect(said.filter((x) => !x.startsWith("say:"))).toEqual([
      "list the pull requests of this branch",
      "tell which GitHub account gh acts as",
      "list the comments of the pull request",
      "create the summary comment",
    ]);
    // Each step is said right before its own call.
    expect(said.slice(0, 2)).toEqual(["list the pull requests of this branch", "say:1"]);
  });

  test("with no summary comment yet, it creates one on the open pull request of the branch", () => {
    const f = fakeGh({});
    const done = publishSummary(BODY, "feat/x", f.gh);
    expect(done).toEqual({ action: "created", url: "https://github.com/niway-dev/wachiman/pull/7#issuecomment-100", pullRequest: PR.url });
    expect(f.calls[0].args).toEqual(["pr", "list", "--head", "feat/x", "--state", "open", "--json", "number,url,isCrossRepository", "--limit", "5"]);
    const post = f.calls.find((c) => c.args.includes("POST"))!;
    expect(post.args).toContain("repos/niway-dev/wachiman/issues/7/comments");
    expect(JSON.parse(post.input!)).toEqual({ body: BODY });
  });

  test("with a summary comment of the same account already there, it edits that one in place", () => {
    const f = fakeGh({ commentIds: "55\n61\n" });
    const done = publishSummary(BODY, "feat/x", f.gh);
    expect(done.action).toBe("updated");
    const patch = f.calls.find((c) => c.args.includes("PATCH"))!;
    expect(patch.args).toContain("repos/niway-dev/wachiman/issues/comments/55");
    expect(f.calls.some((c) => c.args.includes("POST"))).toBe(false);
  });

  test("the comment is looked up by the signed-in account and by the marker as the first characters", () => {
    const f = fakeGh({ login: "someone-else" });
    publishSummary(BODY, "feat/x", f.gh);
    const lookup = f.calls.find((c) => c.args.includes("--paginate"))!;
    const jq = lookup.args[lookup.args.indexOf("--jq") + 1];
    expect(jq).toContain('.user.login == "someone-else"');
    expect(jq).toContain(`startswith(${JSON.stringify(SUMMARY_MARKER)})`);
  });

  test.each([
    ["no open pull request", { prs: [] }, /no open pull request has feat\/x as its head/],
    ["two open pull requests", { prs: [PR, { number: 8, url: "https://github.com/niway-dev/wachiman/pull/8" }] }, /more than one open pull request/],
    ["a pull request url that is not GitHub's", { prs: [{ number: 7, url: "https://example.com/pull/7" }] }, /which repository/],
    ["gh failing to list", { fail: "pr list" }, /could not list the pull requests of this branch: boom from pr list/],
    ["gh failing to post", { fail: "POST" }, /could not create the summary comment: boom from POST/],
    ["a login that cannot go in a filter", { login: 'x" or true or "' }, /could not read the GitHub account/],
  ])("%s is a usage error", (_name, answers, message) => {
    const f = fakeGh(answers as never);
    expect(() => publishSummary(BODY, "feat/x", f.gh)).toThrow(UsageError);
    expect(() => publishSummary(BODY, "feat/x", f.gh)).toThrow(message);
  });

  test("a pull request from a fork that shares the branch name is never the target", () => {
    const fork = { number: 9, url: "https://github.com/niway-dev/wachiman/pull/9", isCrossRepository: true };
    const own = { ...PR, isCrossRepository: false };
    const both = fakeGh({ prs: [fork, own] });
    expect(publishSummary(BODY, "feat/x", both.gh).pullRequest).toBe(PR.url);
    const onlyFork = fakeGh({ prs: [fork] });
    expect(() => publishSummary(BODY, "feat/x", onlyFork.gh)).toThrow(/no open pull request has feat\/x as its head/);
    expect(onlyFork.calls).toHaveLength(1);
  });

  test("a gh call that did not finish says so instead of reporting a null exit", () => {
    const gh: GhRunner = () => ({ status: null, stdout: "", stderr: "" });
    expect(() => publishSummary(BODY, "feat/x", gh)).toThrow(/did not finish within 60 seconds/);
  });

  test("a summary over GitHub's comment limit is refused before any call", () => {
    const f = fakeGh({});
    expect(() => publishSummary("x".repeat(MAX_COMMENT_CHARS + 1), "feat/x", f.gh)).toThrow(/was not published/);
    expect(f.calls).toHaveLength(0);
  });
});
