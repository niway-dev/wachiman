import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Textual checks, not a YAML parse: the repository has no YAML dependency (ADR 0002). They pin the
// three places that must agree for a push to be reviewed once (ADR 0011).
const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("review on push (ADR 0011)", () => {
  test("both caller templates listen for synchronize", () => {
    expect(read("templates/wachiman-review-caller.yml")).toMatch(
      /^\s*pull_request: \{ types: \[opened, ready_for_review, synchronize\] \}$/m,
    );
    expect(read("templates/caller-workflow.yml")).toMatch(
      /^\s*pull_request:\n\s*types: \[opened, ready_for_review, synchronize\]$/m,
    );
  });

  test("the reusable workflow has a boolean review_on_push input, true by default", () => {
    const input = read(".github/workflows/review.yml").match(/\n {6}review_on_push:\n([\s\S]*?)(?=\n {4}secrets:)/);
    expect(input?.[1]).toMatch(/type: boolean/);
    expect(input?.[1]).toMatch(/default: true/);
  });

  test("the automatic job skips a push only when review_on_push is off, and keeps every other gate", () => {
    const text = read(".github/workflows/review.yml");
    const job = text.slice(text.indexOf("\n  review:"), text.indexOf("\n  threads:"));
    const condition = job.match(/\n {4}if: \|\n([\s\S]*?)\n {4}runs-on:/)?.[1] ?? "";
    expect(condition).toContain("(github.event.action != 'synchronize' || inputs.review_on_push)");
    expect(condition).toContain("github.event.pull_request.draft == false");
    expect(condition).toContain("github.event.pull_request.head.repo.full_name == github.repository");
    expect(condition).toContain("github.actor != 'dependabot[bot]'");
    // A burst of pushes runs once: the older run is cancelled, per pull request.
    expect(job).toMatch(/group: wachiman-review-\$\{\{ github\.event\.pull_request\.number \}\}\n\s+cancel-in-progress: true/);
    // The skipped branch prefixes are still checked inside the job.
    expect(job).toContain("skip_branch_prefixes");
  });

  test("the copy template keeps the same gates and the per-pull-request concurrency", () => {
    const text = read("templates/caller-workflow.yml");
    const job = text.slice(text.indexOf("\n  review:"), text.indexOf("\n  threads:"));
    expect(job).toContain("!startsWith(github.head_ref, 'release-please--')");
    expect(job).toMatch(/group: wachiman-review-\$\{\{ github\.event\.pull_request\.number \}\}\n\s+cancel-in-progress: true/);
  });
});

describe("push debounce", () => {
  const text = read(".github/workflows/review.yml");
  const job = text.slice(text.indexOf("\n  review:"), text.indexOf("\n  threads:"));

  test("the reusable workflow has a number push_debounce_seconds input, 180 by default", () => {
    const input = text.match(/\n {6}push_debounce_seconds:\n([\s\S]*?)(?=\n {4}secrets:)/);
    expect(input?.[1]).toMatch(/type: number/);
    expect(input?.[1]).toMatch(/default: 180/);
  });

  test("the wait step sleeps for synchronize only, before the head checkout, any model call and the review", () => {
    const steps = job.slice(job.indexOf("\n    steps:"));
    const start = steps.indexOf("- name: Wait for further pushes");
    const wait = steps.slice(start, steps.indexOf("\n      - name:", start + 1));
    expect(wait).toContain("if: github.event.action == 'synchronize'");
    expect(wait).toContain("DEBOUNCE: ${{ inputs.push_debounce_seconds }}");
    expect(wait).toContain('sleep "$seconds"');
    expect(wait).toContain('-gt 0');
    expect(start).toBeLessThan(steps.indexOf("- name: Checkout the pull request head"));
    expect(start).toBeLessThan(steps.indexOf("- name: Install Claude Code"));
    expect(start).toBeLessThan(steps.indexOf("cli.ts review"));
  });

  test("only the review job debounces: the thread and on-demand jobs have no wait", () => {
    expect(text.match(/Wait for further pushes/g)).toHaveLength(1);
  });

  test("the copy template's review job has the same wait step, driven by WACHIMAN_PUSH_DEBOUNCE_SECONDS (180)", () => {
    const copy = read("templates/caller-workflow.yml");
    expect(copy).toMatch(/WACHIMAN_PUSH_DEBOUNCE_SECONDS: 180\b/);
    const review = copy.slice(copy.indexOf("\n  review:"), copy.indexOf("\n  threads:"));
    const steps = review.slice(review.indexOf("\n    steps:"));
    const start = steps.indexOf("- name: Wait for further pushes");
    const wait = steps.slice(start, steps.indexOf("\n      - name:", start + 1));
    expect(wait).toContain("if: github.event.action == 'synchronize'");
    expect(wait).toContain('sleep "$seconds"');
    expect(wait).toContain("-gt 0");
    expect(start).toBeLessThan(steps.indexOf("- name: Install Claude Code"));
    expect(start).toBeLessThan(steps.indexOf("cli.ts review"));
    expect(copy.match(/Wait for further pushes/g)).toHaveLength(1);
  });

  test("the caller template documents the input", () => {
    expect(read("templates/wachiman-review-caller.yml")).toContain("push_debounce_seconds");
  });
});

// ADR 0033 decision 14: a run cancelled during the push wait must leave "cannot say" for the new
// commit, never a letter from an older one. The reset runs before the wait and calls no model.
describe("PR Confidence reset before the push wait", () => {
  const reusable = read(".github/workflows/review.yml");
  const copy = read("templates/caller-workflow.yml");
  const stepsOf = (text: string) => {
    const job = text.slice(text.indexOf("\n  review:"), text.indexOf("\n  threads:"));
    return job.slice(job.indexOf("\n    steps:"));
  };
  const stepText = (steps: string, name: string) => {
    const start = steps.indexOf(`- name: ${name}`);
    return steps.slice(start, steps.indexOf("\n      - name:", start + 1) === -1 ? undefined : steps.indexOf("\n      - name:", start + 1));
  };

  for (const [label, text, command] of [
    ["the reusable workflow", reusable, 'src/cli.ts reset-confidence "$PR" --commit "$HEAD_SHA"'],
    ["the copy template", copy, 'scripts/wachiman/cli.ts reset-confidence "$PR" --commit "$HEAD_SHA"'],
  ] as const) {
    test(`${label} resets the block before the wait, only for a push, and never blocks the review`, () => {
      const steps = stepsOf(text);
      const reset = stepText(steps, "Reset PR Confidence for this commit");
      expect(reset).toContain(command);
      expect(reset).toContain("github.event.action == 'synchronize'");
      expect(reset).toContain("continue-on-error: true");
      expect(reset).toContain("GH_TOKEN: ${{ github.token }}");
      // No model: no provider key and no review command in the step.
      expect(reset).not.toContain("ANTHROPIC_API_KEY");
      expect(reset).not.toMatch(/cli\.ts review/);
      const at = steps.indexOf("- name: Reset PR Confidence for this commit");
      expect(at).toBeGreaterThan(-1);
      expect(at).toBeLessThan(steps.indexOf("- name: Wait for further pushes"));
      expect(at).toBeLessThan(steps.indexOf("- name: Install Claude Code"));
      expect(at).toBeLessThan(steps.indexOf("cli.ts review"));
      expect(text.match(/Reset PR Confidence for this commit/g)).toHaveLength(1);
    });
  }

  test("the reusable workflow has a pr_confidence input, off by default, passed to the review and the reset", () => {
    const input = reusable.match(/\n {6}pr_confidence:\n([\s\S]*?)(?=\n {4}secrets:)/);
    expect(input?.[1]).toMatch(/type: boolean/);
    expect(input?.[1]).toMatch(/default: false/);
    const steps = stepsOf(reusable);
    expect(stepText(steps, "Reset PR Confidence for this commit")).toContain("inputs.pr_confidence");
    expect(stepText(steps, "Review the pull request")).toContain("WACHIMAN_CONFIDENCE: ${{ inputs.pr_confidence }}");
  });

  test("the copy template switches it with WACHIMAN_CONFIDENCE, off by default", () => {
    expect(copy).toMatch(/^ {2}WACHIMAN_CONFIDENCE: 0$/m);
    // No gate on the value: the command returns early when the flag is off (the engine accepts 1 and true).
    const reset = stepText(stepsOf(copy), "Reset PR Confidence for this commit");
    expect(reset).not.toContain("WACHIMAN_CONFIDENCE ==");
    expect(reset).toContain("github.event.action == 'synchronize'");
  });

  test("the caller template documents the input", () => {
    expect(read("templates/wachiman-review-caller.yml")).toContain("pr_confidence");
  });
});

describe("thread replies without a push (ADR 0012)", () => {
  const workflow = read(".github/workflows/review.yml");
  const jobOf = (text: string, name: string) => {
    const start = text.indexOf(`\n  ${name}:`);
    const rest = text.slice(start + 1);
    const end = rest.search(/\n {2}[a-z-]+:\n {4}name:/);
    return end === -1 ? rest : rest.slice(0, end);
  };

  test("both caller templates listen for pull_request_review_comment: created", () => {
    expect(read("templates/wachiman-review-caller.yml")).toMatch(
      /^\s*pull_request_review_comment: \{ types: \[created\] \}$/m,
    );
    expect(read("templates/caller-workflow.yml")).toMatch(/^\s*pull_request_review_comment:\n\s*types: \[created\]$/m);
  });

  test("the reusable threads job starts only for the operator's reply on a same-repository head, never a bot", () => {
    const job = jobOf(workflow, "threads");
    const condition = job.match(/\n {4}if: \|\n([\s\S]*?)\n {4}runs-on:/)?.[1] ?? "";
    expect(condition).toContain("github.event_name == 'pull_request_review_comment'");
    expect(condition).toContain("github.event.comment.in_reply_to_id");
    expect(condition).toContain("github.event.comment.user.login == inputs.operator");
    expect(condition).toContain("github.event.comment.user.type != 'Bot'");
    expect(condition).toContain("github.event.pull_request.head.repo.full_name == github.repository");
  });

  test("it has its own concurrency group that never cancels, and the review job's permissions", () => {
    const job = jobOf(workflow, "threads");
    expect(job).toMatch(
      /group: wachiman-review-threads-\$\{\{ github\.event\.pull_request\.number \}\}\n\s+cancel-in-progress: false/,
    );
    expect(job).toMatch(/permissions:\n\s+contents: read\n\s+pull-requests: write\n/);
    // The review job's group is another one, so a reply cannot cancel a push review.
    expect(jobOf(workflow, "review")).toContain("group: wachiman-review-${{ github.event.pull_request.number }}");
  });

  test("it runs the engine's threads command with the head as data and the comment's author", () => {
    const job = jobOf(workflow, "threads");
    expect(job).toContain('src/cli.ts threads "$PR" --repo-dir "$GITHUB_WORKSPACE/head"');
    expect(job).toContain("WACHIMAN_COMMENT_AUTHOR: ${{ github.event.comment.user.login }}");
    expect(job).toContain("WACHIMAN_TRIGGER: thread");
    expect(job).toContain("persist-credentials: false");
  });

  test("the copy template's threads job has the same gate and concurrency", () => {
    const job = jobOf(read("templates/caller-workflow.yml"), "threads");
    expect(job).toContain("github.event.comment.user.type != 'Bot'");
    expect(job).toContain("github.event.comment.in_reply_to_id");
    expect(job).toContain("github.event.pull_request.head.repo.full_name == github.repository");
    expect(job).toMatch(/group: wachiman-review-threads-\$\{\{ github\.event\.pull_request\.number \}\}\n\s+cancel-in-progress: false/);
    expect(job).toContain("cli.ts threads");
  });

  test("the ceiling and thread budget are number inputs with the spec's defaults, and each job passes the trigger", () => {
    const input = (name: string) => workflow.match(new RegExp(`\\n {6}${name}:\\n([\\s\\S]*?)(?=\\n {6}[a-z_]+:\\n|\\n {4}secrets:)`))?.[1] ?? "";
    expect(input("auto_budget_usd")).toMatch(/type: number/);
    expect(input("auto_budget_usd")).toMatch(/default: 6\b/);
    expect(input("threads_budget_usd")).toMatch(/type: number/);
    expect(input("threads_budget_usd")).toMatch(/default: 0\.25\b/);
    expect(jobOf(workflow, "review")).toContain("WACHIMAN_TRIGGER: ${{ github.event.action }}");
    expect(jobOf(workflow, "review")).toContain("WACHIMAN_AUTO_BUDGET_USD: ${{ inputs.auto_budget_usd }}");
    expect(jobOf(workflow, "on-demand")).toContain("WACHIMAN_TRIGGER: comment");
    expect(jobOf(workflow, "threads")).toContain("WACHIMAN_AUTO_BUDGET_USD: ${{ inputs.auto_budget_usd }}");
    expect(jobOf(workflow, "threads")).toContain("WACHIMAN_THREADS_BUDGET_USD: ${{ inputs.threads_budget_usd }}");
  });
});
