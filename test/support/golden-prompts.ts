/**
 * Golden prompts: every prompt a fake-provider test sends is recorded, in order, and compared
 * byte for byte with `test/fixtures/golden-prompts/<tag>.jsonl`. The fixtures were recorded on the
 * engine before the review core was extracted (spec D3), so a refactor that changes what the
 * model is asked fails here. See the fixtures' README for when and how to regenerate them.
 */
import { afterAll, expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProviderRequest } from "../../src/providers/types";

const DIR = join(import.meta.dir, "..", "fixtures", "golden-prompts");
const recorded = new Map<string, string[]>();

function safeReal(p: string) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** Paths that differ per run become placeholders, so a prompt compares across machines. */
export function normalisePrompt(request: ProviderRequest) {
  let text = request.prompt;
  const head = new Set([request.cwd, safeReal(request.cwd)]);
  const roots = [request.cwd, ...request.addDirs].flatMap((p) => [p, safeReal(p)]);
  // Longest first, so `/private/var/...` is replaced before `/var/...`.
  const unique = [...new Set(roots)].sort((a, b) => b.length - a.length);
  for (const root of unique) text = text.replaceAll(root, head.has(root) ? "<HEAD_DIR>" : "<RUN_DIR>");
  return text;
}

/** Called by every FakeProvider.run; `tag` is the test file's basename without `.test.ts`. */
export function recordPrompt(tag: string, request: ProviderRequest) {
  recorded.set(tag, [...(recorded.get(tag) ?? []), normalisePrompt(request)]);
}

/**
 * Compares what this file recorded with its fixture, byte for byte, in order. With
 * WACHI_UPDATE_GOLDEN=1 it writes the fixture instead. Run the whole file: a `-t` filter or
 * `.only` changes the order and the count, and the message says so.
 */
export function checkGoldenPrompts(tag: string) {
  afterAll(() => {
    const prompts = recorded.get(tag) ?? [];
    const path = join(DIR, `${tag}.jsonl`);
    const lines = prompts.map((prompt, i) => JSON.stringify({ n: i + 1, prompt }));
    if (process.env.WACHI_UPDATE_GOLDEN === "1") {
      mkdirSync(DIR, { recursive: true });
      writeFileSync(path, `${lines.join("\n")}\n`);
      return;
    }
    if (!existsSync(path)) throw new Error(`${path} is missing: run WACHI_UPDATE_GOLDEN=1 bun test ${tag}`);
    const expected = readFileSync(path, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { n: number; prompt: string });
    expect(
      prompts.length,
      `${tag}: ${prompts.length} prompts recorded, fixture has ${expected.length}; run the whole file without -t or .only`,
    ).toBe(expected.length);
    prompts.forEach((prompt, i) => {
      if (prompt !== expected[i].prompt) {
        // `toBe` on two long strings prints a readable diff.
        expect(prompt, `${tag} request #${i + 1} differs from the golden prompt`).toBe(expected[i].prompt);
      }
    });
  });
}
