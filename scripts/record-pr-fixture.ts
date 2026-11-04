#!/usr/bin/env bun
/**
 * Records what the GitHub connector reads for a pull request, as a parity fixture for
 * `test/parity.test.ts` (spec D13, level b):
 *
 *   bun scripts/record-pr-fixture.ts <pr> [owner/repo]   writes test/fixtures/parity/pr-<pr>.json
 *
 * It reads the pull request (head and base), the merge-base from the compare API, the files list
 * with the same `jq` as `listFiles`, and the instruction files at the merge-base through
 * `readBaseInstructions`. Needs `gh`, signed in; reads only.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultGh, listFiles, readBaseInstructions, type BaseInstructions, type GhFn, type ReviewFile } from "../src/engine";

export interface PrFixture {
  pr: number;
  repo: string;
  headSha: string;
  /** The pull request's `base.sha`, which GitHub mode puts in `change.base.sha`. */
  baseSha: string;
  mergeBase: string;
  baseRef: string;
  meta: { title?: string; body?: string; author?: { login?: string } | null };
  /** As `listFiles` returns them: a missing patch or rename is `null`. */
  files: ReviewFile[];
  /** At the merge-base, so both connectors are given the same instructions. */
  instructions: BaseInstructions;
}

export function recordPrFixture(gh: GhFn, repo: string, pr: number, warn: (line: string) => void = () => {}): PrFixture {
  const pull = JSON.parse(gh(["api", `repos/${repo}/pulls/${pr}`, "--jq", "{head: .head.sha, base: .base.sha, ref: .base.ref, title, body, author: {login: .user.login}}"]));
  const mergeBase = gh(["api", `repos/${repo}/compare/${pull.base}...${pull.head}`, "--jq", ".merge_base_commit.sha"]).trim();
  if (!/^[0-9a-f]{40}$/.test(mergeBase)) throw new Error(`No merge-base for #${pr}: ${mergeBase}`);
  return {
    pr,
    repo,
    headSha: pull.head,
    baseSha: pull.base,
    mergeBase,
    baseRef: pull.ref,
    meta: { title: pull.title ?? undefined, body: pull.body ?? undefined, author: pull.author },
    files: listFiles(gh, repo, pr),
    instructions: readBaseInstructions(gh, repo, mergeBase, warn),
  };
}

if (import.meta.main) {
  const [prArg, repo = "niway-dev/wachiman"] = process.argv.slice(2);
  const pr = Number(prArg);
  if (!Number.isInteger(pr) || pr <= 0) {
    console.error("Usage: bun scripts/record-pr-fixture.ts <pr> [owner/repo]");
    process.exit(2);
  }
  const fixture = recordPrFixture(defaultGh, repo, pr, (l) => console.error(l));
  const path = join(import.meta.dir, "..", "test", "fixtures", "parity", `pr-${pr}.json`);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`${path}: head ${fixture.headSha}, merge-base ${fixture.mergeBase}, ${fixture.files.length} files`);
}
