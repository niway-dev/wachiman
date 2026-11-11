import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ADR 0032 decision 9 and the workflow rule: a workflow may pre-filter by author so that a
// collaborator's question reaches the engine, but the engine decides. The text of each workflow is
// checked line by line; the project has no YAML parser, and none is added for this.

const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const REUSABLE = ".github/workflows/review.yml";
const COPY = "templates/caller-workflow.yml";
const CALLER = "templates/wachiman-review-caller.yml";
const FILES = [REUSABLE, COPY].map((path) => ({ path, text: read(path) }));

/** The `if:` block that follows a job's name, up to the next `runs-on:`. */
function ifBlockOf(text: string, jobKey: string) {
  const start = text.indexOf(`\n  ${jobKey}:\n`);
  if (start < 0) throw new Error(`no job ${jobKey}`);
  const after = text.slice(start);
  const block = after.match(/\n    if: \|\n([\s\S]*?)\n    runs-on:/);
  if (!block) throw new Error(`no if: in ${jobKey}`);
  return block[1];
}

/** One job's text, from its key line under `jobs:` to the next job key. */
function jobOf(text: string, jobKey: string) {
  const jobs = text.slice(text.indexOf("\njobs:\n"));
  const start = jobs.indexOf(`\n  ${jobKey}:\n`);
  if (start < 0) throw new Error(`no job ${jobKey}`);
  const rest = jobs.slice(start + 1);
  const next = rest.slice(1).search(/\n  [a-z-]+:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

/** The lines of a `with:` input (`      name:`) and its indented body, as one string. */
function inputOf(text: string, name: string) {
  const lines = text.split("\n");
  const at = lines.indexOf(`      ${name}:`);
  if (at < 0) throw new Error(`no input ${name}`);
  const body: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (line !== "" && !line.startsWith("        ")) break;
    body.push(line);
  }
  return body.join("\n");
}

/** The text of every `run:` step (its own line and the more indented lines under it). */
function runBlocksOf(text: string) {
  const lines = text.split("\n");
  const blocks: string[] = [];
  lines.forEach((line, i) => {
    const run = line.match(/^(\s*)run:/);
    if (!run) return;
    const indent = run[1].length;
    const body = [line];
    for (const next of lines.slice(i + 1)) {
      if (next.trim() !== "" && next.length - next.trimStart().length <= indent) break;
      body.push(next);
    }
    blocks.push(body.join("\n"));
  });
  return blocks;
}

describe("the workflows let a collaborator's question reach the engine, and nothing else", () => {
  for (const { path, text } of FILES) {
    test(`${path}: the on-demand and thread jobs admit only a start-with-mention comment from a collaborator`, () => {
      for (const job of ["threads", "on-demand"]) {
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

    test(`${path}: no run step reads an event value; the event reaches the engine through env only`, () => {
      for (const block of runBlocksOf(text)) {
        expect(block, `${path}: ${block.split("\n")[0].trim()}`).not.toContain("github.event");
      }
    });
  }

  test("review.yml: a top-level comment is routed only from the operator or a write collaborator starting with the mention", () => {
    const block = ifBlockOf(read(REUSABLE), "threads");
    // A reply is required only for the operator's comments that do not start with the mention.
    expect(block).toMatch(/github\.event\.comment\.user\.login == inputs\.operator && github\.event\.comment\.in_reply_to_id/);
    expect(block).not.toMatch(/^\s*github\.event\.comment\.in_reply_to_id &&/m);
    // The collaborator branch is gated by the askers input, and the fork check stays.
    expect(block).toMatch(/inputs\.askers == 'write' &&\s*contains\(fromJSON/);
    expect(block).toContain("github.event.pull_request.head.repo.full_name == github.repository");
  });

  test("review.yml: the on-demand collaborator branch requires askers write", () => {
    expect(ifBlockOf(read(REUSABLE), "on-demand")).toMatch(/inputs\.askers == 'write' &&\s*contains\(fromJSON/);
  });

  test("copy template: the collaborator branches sit behind the askers literal, which the copy's env sets", () => {
    const text = read(COPY);
    expect(text).toContain("  AGENT_REVIEW_ASKERS: operator\n");
    expect(text).toContain("  AGENT_REVIEW_ASK_CEILING_USD: 3\n");
    for (const job of ["threads", "on-demand"]) {
      expect(ifBlockOf(text, job), job).toMatch(/'operator' == 'write' &&\s*contains\(fromJSON/);
    }
    expect(ifBlockOf(text, "threads")).toMatch(/github\.event\.comment\.user\.login == 'your-github-login' && github\.event\.comment\.in_reply_to_id/);
  });

  test("review.yml: askers and ask_ceiling_usd are inputs with the defaults operator and 3", () => {
    const text = read(REUSABLE);
    const askers = inputOf(text, "askers");
    expect(askers).toContain("type: string");
    expect(askers).toContain("default: operator");
    const ceiling = inputOf(text, "ask_ceiling_usd");
    expect(ceiling).toContain("type: number");
    expect(ceiling).toContain("default: 3");
  });

  test("review.yml: the threads and on-demand engine steps receive both inputs through env", () => {
    const text = read(REUSABLE);
    for (const job of ["threads", "on-demand"]) {
      const body = jobOf(text, job);
      expect(body, job).toContain("AGENT_REVIEW_ASKERS: ${{ inputs.askers }}");
      expect(body, job).toContain("AGENT_REVIEW_ASK_CEILING_USD: ${{ inputs.ask_ceiling_usd }}");
    }
    // A question routed from the threads job to `comment` is capped by the answer budget.
    expect(jobOf(text, "threads")).toContain("AGENT_REVIEW_ANSWER_BUDGET_USD: ${{ inputs.answer_budget_usd }}");
  });

  test("the caller template lists both inputs as commented entries", () => {
    const text = read(CALLER);
    expect(text).toMatch(/^ {6}# askers: write\b/m);
    expect(text).toMatch(/^ {6}# ask_ceiling_usd: 3\b/m);
  });

  test("review.yml: the on-demand concurrency keeps the operator's group and cancels only for the operator", () => {
    const concurrency = jobOf(read(REUSABLE), "on-demand").match(/\n    concurrency:\n([\s\S]*?)\n    permissions:/)?.[1] ?? "";
    expect(concurrency).toContain(
      "      group: agent-review-on-demand-${{ github.event.issue.number }}${{ github.event.comment.user.login != inputs.operator && '-ask' || '' }}",
    );
    expect(concurrency).toContain("      cancel-in-progress: ${{ github.event.comment.user.login == inputs.operator }}");
    expect(jobOf(read(REUSABLE), "threads")).toContain("cancel-in-progress: false");
  });

  test("copy template: the on-demand concurrency keeps the operator's group and cancels only for the operator", () => {
    const concurrency = jobOf(read(COPY), "on-demand").match(/\n    concurrency:\n([\s\S]*?)\n    permissions:/)?.[1] ?? "";
    expect(concurrency).toContain(
      "      group: agent-on-demand-${{ github.event.issue.number }}${{ github.event.comment.user.login != 'your-github-login' && '-ask' || '' }}",
    );
    expect(concurrency).toContain("      cancel-in-progress: ${{ github.event.comment.user.login == 'your-github-login' }}");
  });

  test("review.yml passes the thread reply's place to the thread-only run through env", () => {
    const text = FILES[0].text;
    const threads = text.slice(text.indexOf("\n  threads:\n"), text.indexOf("\n  on-demand:\n"));
    for (const name of ["AGENT_REVIEW_COMMENT_ID", "AGENT_REVIEW_COMMENT_IN_REPLY_TO", "AGENT_REVIEW_COMMENT_PATH", "AGENT_REVIEW_COMMENT_LINE", "REQUEST"]) {
      expect(threads).toContain(`${name}: \${{ github.event.comment.`);
    }
    expect(threads).toContain("github.event.comment.line || github.event.comment.original_line");
  });
});
