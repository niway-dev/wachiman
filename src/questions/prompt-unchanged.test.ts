import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Batches whose added lines show none of the patterns must get the exact prompt they got before the
 * data-path questions existed: a UI, stylesheet, docs or incremental batch pays nothing for them.
 * The fixture is the output of `scripts/prompt-golden.ts` run on origin/main 47933f0. It also pins
 * the rest of the prompt, so an intended prompt change regenerates it in the same commit.
 */
test("a batch without a data-path pattern gets the prompt from before the questions, byte for byte", () => {
  const root = join(import.meta.dir, "..", "..");
  const proc = Bun.spawnSync(["bun", join(root, "scripts", "prompt-golden.ts"), root]);
  expect(proc.exitCode).toBe(0);
  const expected = readFileSync(join(import.meta.dir, "fixtures", "prompt-before-questions.txt"), "utf-8");
  expect(proc.stdout.toString()).toBe(expected);
});
