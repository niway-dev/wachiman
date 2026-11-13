#!/usr/bin/env bun
/**
 * Writes `.github/workflows/review-platform.yml` from `.github/workflows/review.yml`.
 *
 * The two workflows are the same review. The platform one also grants `id-token: write` in each job,
 * which the engine needs to ask the spend ledger for a GitHub OIDC token. They are two files because
 * a called reusable workflow cannot hold a permission its caller did not grant: putting the
 * permission in `review.yml` would break every caller that has not granted it, so only callers that
 * choose `review-platform.yml` grant it.
 *
 *   bun scripts/generate-review-platform.ts          write the file
 *   bun scripts/generate-review-platform.ts --check  exit 1 if the committed file is not what this writes
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
export const REVIEW_PATH = join(root, ".github", "workflows", "review.yml");
export const PLATFORM_PATH = join(root, ".github", "workflows", "review-platform.yml");

const FIRST_LINE = "name: Wachiman review (reusable)\n";

const HEADER = `name: Wachiman review with the spend ledger (reusable)

# GENERATED from .github/workflows/review.yml by scripts/generate-review-platform.ts. Do not edit it:
# change review.yml and run \`bun scripts/generate-review-platform.ts\`; a test fails when this file is
# not what the script writes.
#
# It is the same review as review.yml, except that each job also grants \`id-token: write\`. The engine
# uses that permission to ask the spend ledger (\`ledger_url\`) for a GitHub OIDC token. Call this
# workflow only to enroll in the ledger: the caller must grant \`id-token: write\` too (in the caller's
# job), because a called workflow cannot hold a permission its caller did not grant. Callers that do
# not use a ledger call review.yml and change nothing. See docs/install.md and docs/costs.md.
#
# Everything below this block is review.yml, unchanged.
`;

/** One permissions block of a job: the key at four spaces, its entries at six. */
const PERMISSIONS = /\n {4}permissions:\n((?: {6}[a-z-]+: \w+\n)+)/g;

/** The text of `review-platform.yml` for the text of `review.yml`. Throws when review.yml is not in the expected shape. */
export function generatePlatformWorkflow(review: string): string {
  if (!review.startsWith(FIRST_LINE)) throw new Error("review.yml must start with its `name:` line.");
  let blocks = 0;
  const body = review.slice(FIRST_LINE.length).replace(PERMISSIONS, (block) => {
    blocks += 1;
    if (/ {6}id-token:/.test(block)) throw new Error("review.yml must not grant id-token itself: only review-platform.yml does.");
    return `${block}      id-token: write\n`;
  });
  if (blocks === 0) throw new Error("No job permissions block found in review.yml.");
  return `${HEADER}${body}`;
}

if (import.meta.main) {
  const generated = generatePlatformWorkflow(readFileSync(REVIEW_PATH, "utf8"));
  if (process.argv.includes("--check")) {
    const same = readFileSync(PLATFORM_PATH, "utf8") === generated;
    if (!same) console.error("review-platform.yml is not what scripts/generate-review-platform.ts writes. Run: bun scripts/generate-review-platform.ts");
    process.exit(same ? 0 : 1);
  }
  writeFileSync(PLATFORM_PATH, generated);
  console.log(`wrote ${PLATFORM_PATH}`);
}
