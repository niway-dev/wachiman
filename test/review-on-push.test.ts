import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Textual checks, not a YAML parse: the repository has no YAML dependency (ADR 0002). They pin the
// three places that must agree for a push to be reviewed once (ADR 0011).
const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("review on push (ADR 0011)", () => {
  test("both caller templates listen for synchronize", () => {
    expect(read("templates/agent-review-caller.yml")).toMatch(
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
    const job = text.slice(text.indexOf("\n  review:"), text.indexOf("\n  on-demand:"));
    const condition = job.match(/\n {4}if: \|\n([\s\S]*?)\n {4}runs-on:/)?.[1] ?? "";
    expect(condition).toContain("(github.event.action != 'synchronize' || inputs.review_on_push)");
    expect(condition).toContain("github.event.pull_request.draft == false");
    expect(condition).toContain("github.event.pull_request.head.repo.full_name == github.repository");
    expect(condition).toContain("github.actor != 'dependabot[bot]'");
    // A burst of pushes runs once: the older run is cancelled, per pull request.
    expect(job).toMatch(/group: agent-review-\$\{\{ github\.event\.pull_request\.number \}\}\n\s+cancel-in-progress: true/);
    // The skipped branch prefixes are still checked inside the job.
    expect(job).toContain("skip_branch_prefixes");
  });

  test("the copy template keeps the same gates and the per-pull-request concurrency", () => {
    const text = read("templates/caller-workflow.yml");
    const job = text.slice(text.indexOf("\n  review:"), text.indexOf("\n  on-demand:"));
    expect(job).toContain("!startsWith(github.head_ref, 'release-please--')");
    expect(job).toMatch(/group: agent-review-\$\{\{ github\.event\.pull_request\.number \}\}\n\s+cancel-in-progress: true/);
  });
});
