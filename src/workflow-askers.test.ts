import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ADR 0032 decision 9 and the workflow rule: a workflow may pre-filter by author so that a
// collaborator's question reaches the engine, but the engine decides. The text of each workflow is
// checked line by line; the project has no YAML parser, and none is added for this.

const root = join(import.meta.dir, "..");
const FILES = [".github/workflows/review.yml", "templates/caller-workflow.yml"].map((path) => ({
  path,
  text: readFileSync(join(root, path), "utf8"),
}));

/** The `if:` block that follows a job's name, up to the next `runs-on:`. */
function ifBlockOf(text: string, jobKey: string) {
  const start = text.indexOf(`\n  ${jobKey}:\n`);
  if (start < 0) throw new Error(`no job ${jobKey}`);
  const after = text.slice(start);
  const block = after.match(/\n    if: \|\n([\s\S]*?)\n    runs-on:/);
  if (!block) throw new Error(`no if: in ${jobKey}`);
  return block[1];
}

describe("the workflows let a collaborator's question reach the engine, and nothing else", () => {
  for (const { path, text } of FILES) {
    test(`${path}: the on-demand and thread jobs admit only a start-with-mention comment from a collaborator`, () => {
      const jobs = path.includes("templates") ? ["threads", "on-demand"] : ["on-demand", "threads"];
      for (const job of jobs) {
        const block = ifBlockOf(text, job);
        expect(block, `${path} ${job}`).toContain('fromJSON(\'["OWNER","MEMBER","COLLABORATOR"]\')');
        expect(block, `${path} ${job}`).toMatch(/startsWith\(github\.event\.comment\.body, [^)]*\)/);
        // The operator's login is still the only way in for a comment that is not from a collaborator.
        expect(block, `${path} ${job}`).toMatch(/github\.event\.comment\.user\.login == (inputs\.operator|'your-github-login')/);
      }
    });

    test(`${path}: the comment body reaches a script only through env, never in a run step`, () => {
      for (const line of text.split("\n")) {
        if (!line.includes("github.event.comment.body")) continue;
        const isEnv = /^\s+REQUEST: \$\{\{ github\.event\.comment\.body \}\}$/.test(line);
        const isExpression = line.includes("contains(") || line.includes("startsWith(");
        expect(isEnv || isExpression, `${path}: ${line.trim()}`).toBe(true);
      }
    });
  }

  test("review.yml passes the thread reply's place to the thread-only run through env", () => {
    const text = FILES[0].text;
    const threads = text.slice(text.indexOf("\n  threads:\n"), text.indexOf("\n  on-demand:\n"));
    for (const name of ["AGENT_REVIEW_COMMENT_ID", "AGENT_REVIEW_COMMENT_IN_REPLY_TO", "AGENT_REVIEW_COMMENT_PATH", "AGENT_REVIEW_COMMENT_LINE", "REQUEST"]) {
      expect(threads).toContain(`${name}: \${{ github.event.comment.`);
    }
    expect(threads).toContain("github.event.comment.line || github.event.comment.original_line");
  });

  test("neither workflow sets askers or the ceiling: the caller cannot, so the engine's default holds", () => {
    for (const { path, text } of FILES) {
      expect(text, path).not.toContain("AGENT_REVIEW_ASKERS");
      expect(text, path).not.toContain("ask_ceiling_usd");
    }
  });
});
