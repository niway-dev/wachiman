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

describe("the memory_proposals input reaches every engine step that parses a reply", () => {
  for (const file of ["review.yml", "wachiman-platform.yml", "review-platform.yml"]) {
    test(`${file}: the review, threads and comment steps all get WACHIMAN_MEMORY_PROPOSALS`, () => {
      const steps = Object.values(jobsOf(`.github/workflows/${file}`)).flatMap((j) => j.steps);
      for (const command of ["cli.ts review ", "cli.ts threads ", "cli.ts comment "]) {
        const step = steps.find((s) => s.run?.includes(command));
        expect(step, `${file} ${command}`).toBeDefined();
        expect(step!.env?.WACHIMAN_MEMORY_PROPOSALS, `${file} ${command}`).toBe("${{ inputs.memory_proposals }}");
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
    // The command word: the body starts with the mention, `/wachi` or `@claude`.
    expect(gate).toContain("startsWith(github.event.comment.body, inputs.mention)");
    expect(gate).toContain("startsWith(github.event.comment.body, '/wachi')");
    expect(gate).toContain("startsWith(github.event.comment.body, '@claude')");
    expect(gate).toContain("github.event.pull_request.head.repo.full_name == github.repository");
    // The approval is the whole comment (the job checks the exact shape): a mention mid-body never starts it.
    expect(gate).not.toMatch(/contains\(github\.event\.comment\.body, (inputs\.mention|'\/wachi|'@claude)/);
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

  test("hands the engine the comment's author and thread, the operator and the mention, and the git identity of the push", () => {
    const run = jobs.remember.steps.find((s) => s.run?.includes("memory remember"))!;
    expect(run.env).toMatchObject({
      GH_TOKEN: "${{ github.token }}",
      PR: "${{ github.event.pull_request.number }}",
      REQUEST: "${{ github.event.comment.body }}",
      WACHIMAN_COMMENT_AUTHOR: "${{ github.event.comment.user.login }}",
      WACHIMAN_COMMENT_IN_REPLY_TO: "${{ github.event.comment.in_reply_to_id }}",
      WACHIMAN_MENTION: "${{ inputs.mention }}",
      WACHIMAN_OPERATOR: "${{ inputs.operator }}",
    });
    for (const name of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"]) expect(run.env?.[name], name).toBeTruthy();
    // The engine reads the repository from the runner's own variable, which the workflow does not override.
    expect(run.env?.GITHUB_REPOSITORY).toBeUndefined();
  });

  test("approvals never cancel one another: one concurrency group per comment, nothing cancelled", () => {
    // GitHub keeps one pending run per group, so a shared group would drop the second of three quick approvals.
    const job = jobs.remember as Job & { concurrency?: { group?: string; "cancel-in-progress"?: boolean } };
    expect(job.concurrency?.group).toBe("wachiman-memory-${{ github.event.comment.id }}");
    expect(job.concurrency?.["cancel-in-progress"]).toBe(false);
  });

  test("names the repository setting a token needs to open the pull request", () => {
    expect(text).toContain("Allow GitHub Actions to create and approve pull requests");
  });
});
