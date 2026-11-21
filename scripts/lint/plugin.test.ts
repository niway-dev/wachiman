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
  "// explains the obvious",
  "// See docs/real.md",
  "// See docs/real.md#some-anchor",
  "// See docs/missing.md",
  "// See docs/missing.md#anchor",
  "// See docs/real.md for why",
  "// See below",
  "/* See docs/real.md */",
  "/** Exported thing. */",
  "/** See docs/real.md */",
  "export const a: number = 1;",
  "// @ts-expect-error the argument is deliberately wrong",
  "// @ts-expect-error",
  "// @ts-ignore",
  "// @ts-ignore legacy typing",
  "// eslint-disable-next-line no-empty -- the probe may throw",
  "// eslint-disable-next-line no-empty",
  "// oxlint-disable no-empty -- generated block",
  "// eslint-enable no-empty",
  "// TODO: fix this",
  "// const old = 1;",
  "export const b = 1; // trailing explanation",
  "// See docs/real.md.",
  "/* a block comment with prose */",
  "// See docs/",
  "// See ../outside.md",
  "// See /etc/hosts",
  "// @ts-check because the types matter here",
  "// eslint-enable the rule again, see the discussion",
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
  if (run.status !== 0 && run.status !== 1)
    throw new Error(`bunx bun@${LINT_BUN} lint failed (needs network on first use): ${run.stderr.slice(0, 500)}`);
  const files = JSON.parse(run.stdout) as { filePath: string; messages: typeof messages }[];
  messages = files.flatMap((f) => f.messages).filter((m) => m.ruleId === RULE);
}, 120_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("local/comments-point-to-docs, run through bun lint", () => {
  test("reports prose: a line comment, a block comment, a TODO, commented-out code and a trailing comment", () => {
    for (const line of [3, 8, 9, 22, 23, 24, 26])
      expect(reported(line).map((m) => m.message)).toEqual([expect.stringContaining("Comments are not allowed")]);
  });

  test("JSDoc on an exported symbol is prose, and a JSDoc pointer is not", () => {
    expect(reported(11)).toHaveLength(1);
    expect(reported(12)).toHaveLength(0);
  });

  test("accepts a pointer to a file that exists, with or without an anchor, as a line or a block comment", () => {
    for (const line of [4, 5, 10, 12]) expect(reported(line)).toHaveLength(0);
  });

  test("a pointer may end with a period", () => {
    expect(reported(25)).toHaveLength(0);
  });

  test("a pointer to a directory, outside the repository or to an absolute path is reported as a missing target", () => {
    for (const line of [27, 28, 29])
      expect(reported(line).map((m) => m.message)).toEqual([expect.stringContaining("which is not a file in the repository")]);
  });

  test("reports a pointer to a missing file with its own message naming the target", () => {
    expect(reported(6).map((m) => m.message)).toEqual([
      expect.stringContaining("`docs/missing.md`, which is not a file in the repository"),
    ]);
    expect(reported(7).map((m) => m.message)).toEqual([
      expect.stringContaining("`docs/missing.md`, which is not a file in the repository"),
    ]);
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
    expect(messages.map((m) => m.line).sort((a, b) => a - b)).toEqual([3, 6, 7, 8, 9, 11, 15, 16, 19, 22, 23, 24, 26, 27, 28, 29, 30, 31]);
  });
});
