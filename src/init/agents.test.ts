import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageError } from "../config";
import { POINTER_BEGIN, POINTER_END, planPointer, pointerBlock, withPointer } from "./agents";
import { emptyRepo, removeTempRepos, write } from "../../test/support/temp-repo";

afterAll(() => removeTempRepos());

const block = pointerBlock();

describe("the pointer block", () => {
  test("is two or three lines between the stable markers, and names the skill and the memory folder", () => {
    const lines = block.trimEnd().split("\n");
    expect(lines[0]).toBe(POINTER_BEGIN);
    expect(lines[lines.length - 1]).toBe(POINTER_END);
    expect(lines.length - 2).toBeGreaterThanOrEqual(2);
    expect(lines.length - 2).toBeLessThanOrEqual(3);
    expect(block).toContain("`wachiman-loop` skill");
    expect(block).toContain("wachiman skills install");
    expect(block).toContain("`.wachiman/memory/`");
  });
});

describe("withPointer", () => {
  test("an empty file becomes the block alone", () => {
    expect(withPointer("", "AGENTS.md")).toBe(block);
  });

  test("a file with text is appended to, with a blank line between, and the text is kept as it was", () => {
    const current = "# Notes\n\nRun the tests with bun test.\n";
    expect(withPointer(current, "AGENTS.md")).toBe(`${current}\n${block}`);
  });

  test("a file without a final newline gets one before the blank line", () => {
    expect(withPointer("# Notes", "AGENTS.md")).toBe(`# Notes\n\n${block}`);
  });

  test("a re-run replaces the block between the markers, and does not duplicate it", () => {
    const once = withPointer("# Notes\n", "AGENTS.md");
    expect(withPointer(once, "AGENTS.md")).toBe(once);
    const twice = withPointer(withPointer(once, "AGENTS.md"), "AGENTS.md");
    expect(twice.split(POINTER_BEGIN).length - 1).toBe(1);
  });

  test("an old block between the markers is replaced, and the text around it is untouched", () => {
    const stale = `# Top\n\n${POINTER_BEGIN}\nold words\n${POINTER_END}\n\n# Bottom\nkeep me\n`;
    expect(withPointer(stale, "CLAUDE.md")).toBe(`# Top\n\n${block}\n# Bottom\nkeep me\n`);
  });

  test("a file with no final newline keeps its last line when a block is replaced", () => {
    const stale = `${POINTER_BEGIN}\nold\n${POINTER_END}\nlast line`;
    expect(withPointer(stale, "AGENTS.md")).toBe(`${block}last line`);
  });

  test("a begin marker without an end marker, or two pairs, is refused and nothing is guessed", () => {
    expect(() => withPointer(`${POINTER_BEGIN}\nno end\n`, "AGENTS.md")).toThrow(UsageError);
    expect(() => withPointer(`${block}\n${block}`, "AGENTS.md")).toThrow(UsageError);
    expect(() => withPointer(`${POINTER_END}\n${POINTER_BEGIN}\n`, "AGENTS.md")).toThrow(UsageError);
  });

  test("a marker that is not alone on its line is refused, so a re-run cannot duplicate the block", () => {
    expect(() => withPointer(`see ${POINTER_BEGIN} here\n`, "AGENTS.md")).toThrow(UsageError);
  });
});

describe("planPointer chooses the file", () => {
  const fresh = () => emptyRepo("wachiman-agents-");

  test("AGENTS.md when it exists, even if CLAUDE.md exists too", () => {
    const dir = fresh();
    write(dir, { "AGENTS.md": "a\n", "CLAUDE.md": "c\n" });
    const plan = planPointer(dir);
    expect(plan.file).toBe("AGENTS.md");
    expect(plan.action).toBe("append");
  });

  test("CLAUDE.md when only it exists", () => {
    const dir = fresh();
    write(dir, { "CLAUDE.md": "c\n" });
    const plan = planPointer(dir);
    expect(plan.file).toBe("CLAUDE.md");
    expect(plan.action).toBe("append");
  });

  test("AGENTS.md is created when neither exists", () => {
    const dir = fresh();
    const plan = planPointer(dir);
    expect(plan).toMatchObject({ file: "AGENTS.md", action: "create", content: block });
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
  });

  test("a file that already holds the same block is reported as the same and is not rewritten", () => {
    const dir = fresh();
    write(dir, { "AGENTS.md": withPointer("# x\n", "AGENTS.md") });
    expect(planPointer(dir)).toMatchObject({ file: "AGENTS.md", action: "same" });
  });

  test("a symbolic link where the file would be is refused", () => {
    const dir = fresh();
    const outside = mkdtempSync(join(tmpdir(), "wachiman-agents-out-"));
    writeFileSync(join(outside, "elsewhere.md"), "x\n");
    symlinkSync(join(outside, "elsewhere.md"), join(dir, "AGENTS.md"));
    expect(() => planPointer(dir)).toThrow(UsageError);
    expect(readFileSync(join(outside, "elsewhere.md"), "utf8")).toBe("x\n");
    rmSync(outside, { recursive: true, force: true });
  });
});
