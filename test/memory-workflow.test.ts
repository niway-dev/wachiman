import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// AC9: the review jobs keep `contents: read`; memory is written by one separate job with its own token
// permissions, and that job never runs a model or reads the pull request's code.
const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
type Job = { permissions?: Record<string, string>; if?: string; steps: { name?: string; uses?: string; run?: string; with?: Record<string, string>; env?: Record<string, string> }[] };
const jobsOf = (path: string) => (Bun.YAML.parse(read(path)) as { jobs: Record<string, Job> }).jobs;

describe("the review workflows write nothing to the repository", () => {
  for (const file of ["review.yml", "wachiman-platform.yml", "review-platform.yml"]) {
    test(`${file}: no job holds contents: write, and every job reads contents`, () => {
      for (const [name, job] of Object.entries(jobsOf(`.github/workflows/${file}`))) {
        expect(job.permissions?.contents, `${file} job ${name}`).toBe("read");
      }
    });
  }
});

describe("wachiman-memory.yml", () => {
  const text = read(".github/workflows/wachiman-memory.yml");
  const jobs = jobsOf(".github/workflows/wachiman-memory.yml");

  test("has one job, and it is the only one that writes: contents and pull-requests, nothing else", () => {
    expect(Object.keys(jobs)).toEqual(["remember"]);
    expect(jobs.remember.permissions).toEqual({ contents: "write", "pull-requests": "write" });
  });

  test("starts only for the operator's reply that says remember, on a head in this repository, and never for a bot", () => {
    const gate = jobs.remember.if ?? "";
    expect(gate).toContain("github.event_name == 'pull_request_review_comment'");
    expect(gate).toContain("github.event.comment.user.login == inputs.operator");
    expect(gate).toContain("github.event.comment.user.type != 'Bot'");
    expect(gate).toContain("github.event.comment.in_reply_to_id");
    expect(gate).toContain("contains(github.event.comment.body, 'remember')");
    expect(gate).toContain("github.event.pull_request.head.repo.full_name == github.repository");
  });

  test("passes no model credential and checks out the default branch, never the pull request's head", () => {
    expect(text).not.toMatch(/ANTHROPIC|CLAUDE_CODE|secrets\./);
    expect(text).not.toContain("pull_request.head.sha");
    const checkouts = jobs.remember.steps.filter((s) => s.uses?.startsWith("actions/checkout"));
    const repo = checkouts.find((s) => s.with?.path === "repo")!;
    expect(repo.with?.ref).toBe("${{ github.event.repository.default_branch }}");
    // The engine is never the repository's code, and it holds no credential.
    const engine = checkouts.find((s) => s.with?.path === "engine")!;
    expect(engine.with?.ref).toBe("${{ job.workflow_sha }}");
    expect(engine.with?.["persist-credentials"]).toBe(false);
  });

  test("runs the engine with --no-env-file and its own bunfig.toml, the comment only through the environment", () => {
    const run = jobs.remember.steps.find((s) => s.run?.includes("memory remember"))!;
    expect(run.run).toContain("bun --no-env-file --config=bunfig.toml src/cli.ts memory remember");
    expect(run.run).not.toContain("${{");
    expect(run.env?.REQUEST).toBe("${{ github.event.comment.body }}");
    expect(run.env?.WACHIMAN_OPERATOR).toBe("${{ inputs.operator }}");
  });

  test("names the repository setting a token needs to open the pull request", () => {
    expect(text).toContain("Allow GitHub Actions to create and approve pull requests");
  });
});
