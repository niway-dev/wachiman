import { describe, expect, test } from "bun:test";
import type { PrFile } from "../engine";
import { QUESTIONS, renderDataPathQuestions, selectQuestions } from "./index";

const file = (filename: string, ...added: string[]): PrFile => ({
  filename,
  additions: added.length,
  deletions: 0,
  patch: `@@ -0,0 +1,${added.length} @@\n${added.map((l) => `+${l}`).join("\n")}`,
});

const ids = (files: PrFile[]) => selectQuestions(files).map((q) => q.id);

describe("the registry", () => {
  test("holds the five questions once each, in a fixed order", () => {
    expect(QUESTIONS.map((q) => q.id)).toEqual([
      "destructive-step",
      "read-error-as-empty",
      "overlapping-calls",
      "bounded-wait",
      "stale-write-back",
    ]);
  });

  test("every question has a title, at most 120 words of text, and no markdown heading", () => {
    for (const q of QUESTIONS) {
      expect(q.title.trim()).not.toBe("");
      expect(q.title).not.toContain("\n");
      expect(q.text.trim().split(/\s+/).length).toBeLessThanOrEqual(120);
      expect(q.text).not.toMatch(/^#/m);
    }
  });
});

describe("selectQuestions", () => {
  test("selects nothing for a batch whose added lines show no pattern", () => {
    expect(ids([file("src/a.ts", "export const a = 1;"), file("README.md", "rm -rf build")])).toEqual([]);
    expect(ids([])).toEqual([]);
  });

  test("selects the question whose pattern a file's added lines show", () => {
    expect(ids([file("src/main/heal.ts", "  unlinkSync(source);")])).toEqual(["destructive-step"]);
  });

  test("a file with no patch selects nothing", () => {
    expect(ids([{ filename: "src/heal.ts", additions: 900, deletions: 0 }])).toEqual([]);
  });

  test("only added lines count: a removed or unchanged line never selects", () => {
    const f: PrFile = {
      filename: "src/main/heal.ts",
      additions: 1,
      deletions: 1,
      patch: "@@ -1,2 +1,2 @@\n-  unlinkSync(source);\n   unlinkSync(other);\n+  const x = 1;",
    };
    expect(ids([f])).toEqual([]);
  });

  test("lists a question once however many files show it, in registry order", () => {
    const heal = file("src/main/heal.ts", "  unlinkSync(source);");
    const wait = file("src/main/probe.ts", "const PROBE_TIMEOUT_MS = 2000;");
    const again = file("src/main/other.ts", "  rmSync(path);");
    expect(ids([wait, heal, again])).toEqual(["destructive-step", "bounded-wait"]);
    expect(ids([again, heal, wait])).toEqual(["destructive-step", "bounded-wait"]);
  });

  test("every question can be selected by a batch (the trigger is wired, not just exported)", () => {
    const shown: Record<string, PrFile> = {
      "destructive-step": file("src/main/a.ts", "  unlinkSync(source);"),
      "read-error-as-empty": file(
        "src/main/b.ts",
        "async function open() {",
        "  try {",
        "    return JSON.parse(await readFile(path, 'utf8'));",
        "  } catch {",
        "    return {};",
        "  }",
        "}",
        "async function save(x) { await writeFile(path, JSON.stringify(x)); }",
      ),
      "overlapping-calls": file("src/main/c.ts", "  const v = await load();", "  this.cache.set(key, v);"),
      "bounded-wait": file("src/main/d.ts", "const PROBE_TIMEOUT_MS = 2000;"),
      "stale-write-back": file("src/main/e.ts", "  await writeIdentity(dir, pendingName);"),
    };
    for (const [id, f] of Object.entries(shown)) expect(ids([f])).toContain(id);
  });
});

describe("renderDataPathQuestions", () => {
  test("is empty for no question and lists title and text for each selected one", () => {
    expect(renderDataPathQuestions([])).toBe("");
    const text = renderDataPathQuestions(QUESTIONS.slice(0, 2));
    expect(text.startsWith("\n\n## Risks this part's added lines show\n")).toBe(true);
    for (const q of QUESTIONS.slice(0, 2)) expect(text).toContain(`### ${q.title}\n\n${q.text}`);
    expect(text).not.toContain(QUESTIONS[2]!.title);
    expect(text).toContain("`contracts`");
    expect(text).toContain("finding");
  });
});
