import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { LINT_BUN } from "../ratchet";

const plugin = resolve(import.meta.dir, "plugin.js");
const RULE = "local/comments-point-to-docs";

let dir: string;
let messages: { ruleId: string; message: string; line: number }[];

const source = [
  "#!/usr/bin/env bun",
  '/// <reference types="bun" />',
  "// explains the obvious", // 3 prose
  "// See docs/real.md", // 4 pointer ok
  "// See docs/real.md#some-anchor", // 5 pointer with anchor ok
  "// See docs/missing.md", // 6 missing target
  "// See docs/missing.md#anchor", // 7 missing target
  "// See docs/real.md for why", // 8 prose after the pointer
  "// See below", // 9 not a path: prose
  "/* See docs/real.md */", // 10 block pointer ok
  "/** Exported thing. */", // 11 JSDoc prose
  "/** See docs/real.md */", // 12 JSDoc pointer ok
  "export const a: number = 1;",
  "// @ts-expect-error the argument is deliberately wrong", // 14 ok
  "// @ts-expect-error", // 15 no reason
  "// @ts-ignore", // 16 no reason
  "// @ts-ignore legacy typing", // 17 ok
  "// eslint-disable-next-line no-empty -- the probe may throw", // 18 ok
  "// eslint-disable-next-line no-empty", // 19 no reason
  "// oxlint-disable no-empty -- generated block", // 20 ok
  "// eslint-enable no-empty", // 21 ok
  "// TODO: fix this", // 22 prose
  "// const old = 1;", // 23 prose (commented-out code)
  "export const b = 1; // trailing explanation", // 24 prose
  "",
].join("\n");

const reported = (line: number) => messages.filter((m) => m.line === line);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "wachiman-comment-rule-"));
  mkdirSync(join(dir, "docs"));
  writeFileSync(join(dir, "docs", "real.md"), "# real\n");
  writeFileSync(join(dir, "bunfig.toml"), `[lint]\nplugins = [${JSON.stringify(plugin)}]\n\n[lint.rules]\n"${RULE}" = "error"\n`);
  writeFileSync(join(dir, "sample.ts"), source);
  const run = spawnSync("bunx", [`bun@${LINT_BUN}`, "lint", "--format", "json", "--no-script"], { cwd: dir, encoding: "utf8" });
  const files = JSON.parse(run.stdout) as { filePath: string; messages: typeof messages }[];
  messages = files.flatMap((f) => f.messages).filter((m) => m.ruleId === RULE);
}, 120_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("local/comments-point-to-docs, run through bun lint", () => {
  test("reports prose: a line comment, a block comment, a TODO, commented-out code and a trailing comment", () => {
    for (const line of [3, 8, 9, 22, 23, 24])
      expect(reported(line).map((m) => m.message)).toEqual([expect.stringContaining("Comments are not allowed")]);
  });

  test("JSDoc on an exported symbol is prose, and a JSDoc pointer is not", () => {
    expect(reported(11)).toHaveLength(1);
    expect(reported(12)).toHaveLength(0);
  });

  test("accepts a pointer to a file that exists, with or without an anchor, as a line or a block comment", () => {
    for (const line of [4, 5, 10, 12]) expect(reported(line)).toHaveLength(0);
  });

  test("reports a pointer to a missing file with its own message naming the target", () => {
    expect(reported(6).map((m) => m.message)).toEqual([expect.stringContaining("`docs/missing.md`, which does not exist")]);
    expect(reported(7).map((m) => m.message)).toEqual([expect.stringContaining("`docs/missing.md`, which does not exist")]);
  });

  test("accepts the shebang, a triple-slash reference and a ts directive or lint directive with a reason", () => {
    for (const line of [1, 2, 14, 17, 18, 20, 21]) expect(reported(line)).toHaveLength(0);
  });

  test("reports a ts directive or a lint disable without a reason, each with its own message", () => {
    for (const line of [15, 16])
      expect(reported(line).map((m) => m.message)).toEqual([expect.stringContaining("`@ts-` directive needs a reason")]);
    expect(reported(19).map((m) => m.message)).toEqual([expect.stringContaining("disable directive needs a reason")]);
  });

  test("reports nothing else", () => {
    expect(messages.map((m) => m.line).sort((a, b) => a - b)).toEqual([3, 6, 7, 8, 9, 11, 15, 16, 19, 22, 23, 24]);
  });
});
