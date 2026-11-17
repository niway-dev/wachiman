#!/usr/bin/env bun
/**
 * Writes `.github/workflows/wachiman-platform.yml` and its alias `.github/workflows/review-platform.yml`
 * from `.github/workflows/review.yml`. The alias is the old name, which releases v1.14.0 and later
 * contain, so callers pinned to it keep working. Both files have identical jobs and inputs.
 *
 * The two workflows are the same review. The platform one also grants `id-token: write` in each job,
 * which the engine needs to ask the spend ledger for a GitHub OIDC token. They are two files because
 * a called reusable workflow cannot hold a permission its caller did not grant: putting the
 * permission in `review.yml` would break every caller that has not granted it, so only callers that
 * choose `wachiman-platform.yml` grant it.
 *
 * Folding the two files back into one depends on what GitHub does with a caller that does not grant
 * `id-token: write`; that is checked on the first real enrolled run, outside this repository.
 *
 *   bun scripts/generate-wachiman-platform.ts          write both files
 *   bun scripts/generate-wachiman-platform.ts --check  exit 1 if a committed file is not what this writes
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
export const REVIEW_PATH = join(root, ".github", "workflows", "review.yml");
export const PLATFORM_PATH = join(root, ".github", "workflows", "wachiman-platform.yml");
export const ALIAS_PATH = join(root, ".github", "workflows", "review-platform.yml");

const ALIAS_NOTICE = "# Deprecated name, kept so existing callers keep working. New callers use wachiman-platform.yml.\n";

const FIRST_LINE = "name: Wachiman review (reusable)\n";

const HEADER = `name: Wachiman review with the spend ledger (reusable)

# GENERATED from .github/workflows/review.yml by scripts/generate-wachiman-platform.ts. Do not edit it:
# change review.yml and run \`bun scripts/generate-wachiman-platform.ts\`; a test fails when this file is
# not what the script writes.
#
# It is the same review as review.yml, except that each job also grants \`id-token: write\`. The engine
# uses that permission to ask the spend ledger (\`ledger_url\`) for a GitHub OIDC token. Call this
# workflow only to enroll in the ledger: the caller must grant \`id-token: write\` too (in the caller's
# job), because a called workflow cannot hold a permission its caller did not grant. Callers that do
# not use a ledger call review.yml and change nothing. See docs/install.md and docs/costs.md.
#
# Everything below this block is review.yml, unchanged except the added \`id-token: write\` lines.
`;

/** One permissions block of a job: the key at four spaces, its entries at six. */
const PERMISSIONS = /\n {4}permissions:\n((?: {6}[a-z-]+: \w+\n)+)/g;

/** The text of `wachiman-platform.yml` for the text of `review.yml`. Throws when review.yml is not in the expected shape. */
export function generatePlatformWorkflow(review: string): string {
  if (!review.startsWith(FIRST_LINE)) throw new Error("review.yml must start with its `name:` line.");
  let blocks = 0;
  const body = review.slice(FIRST_LINE.length).replace(PERMISSIONS, (block) => {
    blocks += 1;
    if (/ {6}id-token:/.test(block)) throw new Error("review.yml must not grant id-token itself: only wachiman-platform.yml does.");
    return `${block}      id-token: write\n`;
  });
  if (blocks === 0) throw new Error("No job permissions block found in review.yml.");
  return `${HEADER}${body}`;
}

/** The text of the alias file: the platform workflow under its old name, with a deprecation comment on top. */
export function generateAliasWorkflow(review: string): string {
  return `${ALIAS_NOTICE}${generatePlatformWorkflow(review)}`;
}

if (import.meta.main) {
  const review = readFileSync(REVIEW_PATH, "utf8");
  const outputs: [string, string][] = [
    [PLATFORM_PATH, generatePlatformWorkflow(review)],
    [ALIAS_PATH, generateAliasWorkflow(review)],
  ];
  if (process.argv.includes("--check")) {
    const stale = outputs.filter(([path, text]) => !existsSync(path) || readFileSync(path, "utf8") !== text);
    for (const [path] of stale) console.error(`${path} is not what scripts/generate-wachiman-platform.ts writes. Run: bun scripts/generate-wachiman-platform.ts`);
    process.exit(stale.length === 0 ? 0 : 1);
  }
  for (const [path, text] of outputs) {
    writeFileSync(path, text);
    console.log(`wrote ${path}`);
  }
}
