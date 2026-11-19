import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageError } from "../config";
import { parseRepoSettings } from "../repo-settings";
import { git } from "../../test/support/temp-repo";
import { checkMemory, runMemory } from "./command";
import { entryId } from "./entries";

function entry(rule: string, scope: string, over: { why?: string } = {}) {
  const fields = { kind: "convention" as const, scope, rule, why: over.why ?? "because" };
  return `### ${entryId(fields)} ${rule}\n\n- kind: convention\n- scope: ${scope}\n- rule: ${rule}\n- why: ${fields.why}\n- evidence:\n  - 2026-11-18 instruction\n- added: 2026-11-18\n`;
}
const INDEX = (rows: [string, string][], body = "") => `# Memory\n\n| Glob | File |\n| --- | --- |\n${rows.map(([g, f]) => `| \`${g}\` | \`${f}\` |`).join("\n")}\n\n${body}`;
const REPO = ["src/a.ts", "docs/adr/0001.md", "README.md"];
const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n") + "\n";
const check = (files: Record<string, string>, settings?: string) => checkMemory({ files, repoFiles: REPO, settings: settings === undefined ? undefined : parseRepoSettings(settings) });

describe("checkMemory", () => {
  test("a healthy memory has no problems", () => {
    const files = { "index.md": INDEX([["src/**", "src.md"]], entry("repo wide", "**")), "src.md": entry("src rule", "src/**") };
    expect(check(files)).toEqual([]);
  });

  test("a malformed entry is reported with its file and line", () => {
    const bad = entry("rule", "src/**").replace("- kind: convention\n", "- kind: rule\n");
    const problems = check({ "index.md": INDEX([["src/**", "src.md"]]), "src.md": `# Src\n\n${bad}` });
    expect(problems).toContainEqual({ file: "src.md", line: 5, message: 'kind must be "convention" or "exception", got "rule"' });
  });

  test("an entry whose heading id does not match its digest is reported", () => {
    const wrong = entry("rule", "src/**").replace(/^### [0-9a-f]{7}/, "### 0000000");
    const problems = check({ "index.md": INDEX([["src/**", "src.md"]]), "src.md": wrong });
    expect(problems.some((p) => p.file === "src.md" && p.line === 1 && p.message.includes("does not match its digest"))).toBe(true);
  });

  test("an index glob and an entry scope that match no file are reported at their lines", () => {
    const problems = check({ "index.md": INDEX([["nowhere/**", "src.md"]]), "src.md": entry("rule", "gone/**") });
    expect(problems).toContainEqual({ file: "index.md", line: 5, message: "glob `nowhere/**` matches no file in the repository" });
    expect(problems).toContainEqual({ file: "src.md", line: 1, message: "scope `gone/**` of entry matches no file in the repository" });
  });

  test("an index row naming a file that is not there, and an area file the index does not list, are reported", () => {
    const problems = check({ "index.md": INDEX([["src/**", "missing.md"]]), "stray.md": "text\n" });
    expect(problems).toContainEqual({ file: "index.md", line: 5, message: "maps to `missing.md`, which is not in .wachiman/memory/" });
    expect(problems).toContainEqual({ file: "stray.md", line: 1, message: "is not listed in index.md, so no review loads it" });
  });

  test("a folder without index.md is reported", () => {
    expect(check({ "src.md": "x\n" })).toContainEqual({ file: "index.md", line: 1, message: "is missing: without it no review loads any memory" });
  });

  test("the archive is checked for malformed entries but needs no index row", () => {
    const problems = check({ "index.md": INDEX([]), "archive.md": "### zzz bad\n" });
    expect(problems.map((p) => p.file)).toEqual(["archive.md"]);
  });

  test("an index over max_index_lines, and an area file that cannot fit beside the index, are budget overruns", () => {
    const over = check({ "index.md": lines(200) }, "memory:\n  max_index_lines: 150\n");
    expect(over).toContainEqual({ file: "index.md", line: 151, message: "has 200 lines, over memory.max_index_lines (150)" });
    const wide = check({ "index.md": INDEX([["src/**", "src.md"]]), "src.md": lines(395) }, "memory:\n  max_loaded_lines: 400\n");
    expect(wide.some((p) => p.file === "src.md" && p.message.includes("max_loaded_lines (400)"))).toBe(true);
  });
});

describe("wachiman memory check", () => {
  function repo(files: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), "memory-check-"));
    git(dir, "init", "-q");
    for (const [path, content] of Object.entries({ "src/a.ts": "a\n", ...files })) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    return dir;
  }
  const io = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { stdout: (t: string) => void out.push(t), stderr: (l: string) => void err.push(l) } };
  };

  test("exits 0 on a healthy memory", () => {
    const dir = repo({ ".wachiman/memory/index.md": INDEX([["src/**", "src.md"]]), ".wachiman/memory/src.md": entry("r", "src/**") });
    const o = io();
    expect(runMemory(["check"], dir, o.io)).toBe(0);
    expect(o.out.join("")).toContain("memory ok");
  });

  test("exits non-zero and prints each problem as path:line: message", () => {
    const dir = repo({ ".wachiman/memory/index.md": INDEX([["nowhere/**", "src.md"]]), ".wachiman/memory/src.md": entry("r", "src/**").replace("- why: because\n", "") });
    const o = io();
    expect(runMemory(["check"], dir, o.io)).toBe(1);
    const text = o.err.join("\n");
    expect(text).toContain(".wachiman/memory/index.md:5: glob `nowhere/**` matches no file in the repository");
    expect(text).toContain(".wachiman/memory/src.md:1: missing why");
  });

  test("a repository with no memory folder has nothing to check", () => {
    const o = io();
    expect(runMemory(["check"], repo({}), o.io)).toBe(0);
    expect(o.out.join("")).toContain("no .wachiman/memory/");
  });

  test("an unknown subcommand is a usage error and --help prints the page", () => {
    expect(() => runMemory(["frobnicate"], "/tmp", io().io)).toThrow(UsageError);
    const o = io();
    expect(runMemory(["check", "--help"], "/tmp", o.io)).toBe(0);
    expect(o.out.join("")).toContain("wachiman memory check");
  });

  test("a broken .wachiman.yml is a usage error", () => {
    const dir = repo({ ".wachiman/memory/index.md": "x\n", ".wachiman.yml": "model: [unclosed\n" });
    expect(() => runMemory(["check"], dir, io().io)).toThrow(UsageError);
  });
});
