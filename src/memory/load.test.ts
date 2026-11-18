import { describe, expect, test } from "bun:test";
import { UsageError } from "../config";
import { parseRepoSettings } from "../repo-settings";
import { entryId } from "./entries";
import { globsOf, globSpecificity, loadMemory, matchesGlob, memoryNotice, memoryRecord, type MemorySource } from "./load";

const REV = "b".repeat(40);

/** An entry whose heading id is right, with `extra` filler lines so a file can be made any size. */
function entry(rule: string, scope = "**", extra = 0) {
  const fields = { kind: "convention" as const, scope, rule, why: "because" };
  const filler = Array.from({ length: extra }, (_, i) => `  filler ${i}`).join("\n");
  return `### ${entryId(fields)} ${rule}\n\n- kind: convention\n- scope: ${scope}\n- rule: ${rule}\n${filler ? `${filler}\n` : ""}- why: because\n- evidence:\n  - 2026-11-18 instruction\n- added: 2026-11-18\n`;
}

const indexOf = (rows: [string, string][], body = "") => `# Memory\n\n| Glob | File |\n| --- | --- |\n${rows.map(([g, f]) => `| \`${g}\` | \`${f}\` |`).join("\n")}\n\n${body}`;

function source(files: Record<string, string>, settingsText?: string): MemorySource & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    list: () => Object.keys(files),
    read: (name) => {
      reads.push(name);
      return files[name] ?? null;
    },
    settings: () => {
      if (settingsText === undefined) return undefined;
      return parseRepoSettings(settingsText);
    },
  };
}

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n") + "\n";

describe("globsOf", () => {
  test.each([
    ["src/**/*.{ts,tsx}", ["src/**/*.{ts,tsx}"]],
    ["a/*, b/*.{js,jsx}", ["a/*", "b/*.{js,jsx}"]],
    ["{a,b}/*, c/**", ["{a,b}/*", "c/**"]],
  ])("%s splits only on commas outside braces", (scope, expected) => expect(globsOf(scope)).toEqual(expected));
});

describe("matchesGlob", () => {
  test.each([
    ["apps/desktop/**", "apps/desktop/src/a.ts", true],
    ["apps/desktop/**", "apps/mobile/a.ts", false],
    ["**", "anything/at/all.md", true],
    ["docs/adr/**", "docs/adr/0031.md", true],
    ["*.md", "README.md", true],
    ["*.md", "docs/a.md", false],
    ["docs/adr/**, apps/**", "apps/x.ts", true],
    ["src/**/*.{ts,tsx}", "src/a/b.tsx", true],
  ])("%s against %s is %p", (glob, path, expected) => expect(matchesGlob(glob, path)).toBe(expected));

  test("a more specific glob has a higher specificity", () => {
    expect(globSpecificity("apps/desktop/src/**")).toBeGreaterThan(globSpecificity("apps/desktop/**"));
    expect(globSpecificity("apps/desktop/**")).toBeGreaterThan(globSpecificity("**"));
    expect(globSpecificity("apps/desktop/**")).toBeGreaterThan(globSpecificity("**/*.ts"));
  });
});

describe("loadMemory", () => {
  test("a repository with no memory folder has no memory", () => {
    expect(loadMemory(source({}), REV, ["a.ts"], () => {})).toBeUndefined();
  });

  test("loads index.md and only the area files whose glob matches a changed path, naming the revision and the files", () => {
    const src = source({
      "index.md": indexOf([["apps/desktop/**", "apps-desktop.md"], ["packages/ui/**", "packages-ui.md"]], entry("repo wide")),
      "apps-desktop.md": entry("desktop rule", "apps/desktop/**"),
      "packages-ui.md": entry("ui rule", "packages/ui/**"),
      "archive.md": entry("old rule"),
    });
    const load = loadMemory(src, REV, ["apps/desktop/src/main.ts", "README.md"], () => {})!;
    expect(load.revision).toBe(REV);
    expect(load.files.map((f) => f.path)).toEqual([".wachiman/memory/index.md", ".wachiman/memory/apps-desktop.md"]);
    expect(load.leftOut).toEqual([]);
    expect(load.overBudget).toBe(false);
    expect(load.entries.map((e) => e.rule).sort()).toEqual(["desktop rule", "repo wide"]);
    expect(src.reads).not.toContain("packages-ui.md");
    expect(src.reads).not.toContain("archive.md");
  });

  test("an area file that index.md does not list is not loaded", () => {
    const src = source({ "index.md": indexOf([]), "stray.md": entry("stray") });
    const load = loadMemory(src, REV, ["a.ts"], () => {})!;
    expect(load.files.map((f) => f.path)).toEqual([".wachiman/memory/index.md"]);
    expect(src.reads).not.toContain("stray.md");
  });

  test("a row that points outside the folder or at archive.md loads nothing", () => {
    // The source lists the odd names too, so only the plain-name guard keeps them out.
    const rows: [string, string][] = [["**", "../secret.md"], ["**", "sub/deep.md"], ["**", "..\\win.md"], ["**", ".hidden.md"], ["**", "archive.md"], ["**", "index.md"]];
    const src = source({
      "index.md": indexOf(rows),
      "../secret.md": entry("secret"),
      "sub/deep.md": entry("deep"),
      "..\\win.md": entry("win"),
      ".hidden.md": entry("hidden"),
      "archive.md": entry("old"),
    });
    const load = loadMemory(src, REV, ["a.ts"], () => {})!;
    expect(load.files.map((f) => f.path)).toEqual([".wachiman/memory/index.md"]);
    expect(src.reads).toEqual(["index.md"]);
  });

  test("a folder with no index.md loads nothing and says so", () => {
    const warned: string[] = [];
    const load = loadMemory(source({ "a.md": entry("x") }), REV, ["a.ts"], (l) => warned.push(l))!;
    expect(load.files).toEqual([]);
    expect(warned.join("\n")).toContain("no index.md");
  });

  test("a listed index.md the source cannot return does not claim the folder has none", () => {
    const warned: string[] = [];
    const src: MemorySource = { list: () => ["index.md"], read: () => null, settings: () => undefined };
    expect(loadMemory(src, REV, ["a.ts"], (l) => warned.push(l))!.files).toEqual([]);
    expect(warned.join("\n")).not.toContain("has no index.md");
    expect(warned.join("\n")).toContain("could not be read");
  });

  test("over the loaded budget it loads the most specific files first and names what it left out", () => {
    const src = source(
      {
        "index.md": indexOf([["apps/**", "broad.md"], ["apps/desktop/src/**", "narrow.md"], ["apps/desktop/**", "middle.md"]]),
        "broad.md": lines(30),
        "middle.md": lines(30),
        "narrow.md": lines(30),
      },
      "memory:\n  max_loaded_lines: 85\n",
    );
    const load = loadMemory(src, REV, ["apps/desktop/src/a.ts"], () => {})!;
    expect(load.files.map((f) => f.path)).toEqual([".wachiman/memory/index.md", ".wachiman/memory/narrow.md", ".wachiman/memory/middle.md"]);
    expect(load.leftOut).toEqual([".wachiman/memory/broad.md"]);
    expect(load.overBudget).toBe(true);
    expect(load.budget.loadedLines).toBeLessThanOrEqual(85);
  });

  test("it stops at the first file that does not fit: a less specific file that would fit does not take its place", () => {
    const src = source(
      {
        "index.md": indexOf([["apps/desktop/src/**", "narrow.md"], ["apps/**", "broad.md"]]),
        "narrow.md": lines(60),
        "broad.md": lines(5),
      },
      "memory:\n  max_loaded_lines: 50\n",
    );
    const load = loadMemory(src, REV, ["apps/desktop/src/a.ts"], () => {})!;
    expect(load.files.map((f) => f.path)).toEqual([".wachiman/memory/index.md"]);
    expect(load.leftOut).toEqual([".wachiman/memory/narrow.md", ".wachiman/memory/broad.md"]);
    expect(src.reads).not.toContain("broad.md");
  });

  test("an index longer than the loaded budget is loaded up to the budget and reported over budget", () => {
    const src = source({ "index.md": lines(500) }, "memory:\n  max_loaded_lines: 100\n");
    const load = loadMemory(src, REV, [], () => {})!;
    expect(load.files).toEqual([{ path: ".wachiman/memory/index.md", lines: 100, truncated: true }]);
    expect(load.overBudget).toBe(true);
  });

  test("an index over max_index_lines but within the loaded budget is loaded whole and still reported", () => {
    const src = source({ "index.md": lines(200) }, "memory:\n  max_index_lines: 150\n");
    const load = loadMemory(src, REV, [], () => {})!;
    expect(load.files[0].lines).toBe(200);
    expect(load.indexOverBudget).toBe(true);
    expect(load.overBudget).toBe(true);
    expect(load.leftOut).toEqual([]);
  });

  test("within budget nothing is reported over budget", () => {
    const load = loadMemory(source({ "index.md": lines(10) }), REV, [], () => {})!;
    expect(load.overBudget).toBe(false);
    expect(load.indexOverBudget).toBe(false);
  });

  test("a broken settings file leaves the defaults and warns", () => {
    const warned: string[] = [];
    const src: MemorySource = { list: () => ["index.md"], read: () => lines(3), settings: () => { throw new UsageError("not valid YAML"); } };
    const load = loadMemory(src, REV, [], (l) => warned.push(l))!;
    expect(load.budget.maxLoadedLines).toBe(400);
    expect(warned.join("\n")).toContain("not valid YAML");
  });

  test("an ignored setting is a notice", () => {
    const warned: string[] = [];
    loadMemory(source({ "index.md": lines(3) }, "memory:\n  max_index_lines: -1\n"), REV, [], (l) => warned.push(l));
    expect(warned.join("\n")).toContain("memory.max_index_lines must be a positive whole number");
  });
});

describe("memoryNotice", () => {
  test("an index over max_index_lines that was loaded whole does not claim the memory did not fit", () => {
    const load = loadMemory(source({ "index.md": lines(200) }, "memory:\n  max_index_lines: 150\n"), REV, [], () => {})!;
    const notice = memoryNotice(load)!;
    expect(notice).toContain("`index.md` is over its 150-line budget");
    expect(notice).toContain("memory.max_index_lines");
    expect(notice).not.toContain("loaded whole");
    expect(notice).not.toContain("does not fit");
    expect(notice).not.toContain("for lack of room");
  });

  test("files left out say the memory does not fit and name them", () => {
    const load = loadMemory(source({ "index.md": indexOf([["**", "a.md"]]), "a.md": lines(30) }, "memory:\n  max_loaded_lines: 20\n"), REV, ["x.ts"], () => {})!;
    const notice = memoryNotice(load)!;
    expect(notice).toContain("does not fit in 20 lines");
    expect(notice).toContain(".wachiman/memory/a.md");
  });

  test("within budget there is no notice", () => {
    expect(memoryNotice(loadMemory(source({ "index.md": lines(5) }), REV, [], () => {})!)).toBeUndefined();
  });
});

describe("memoryRecord", () => {
  test("is the load without its entries", () => {
    const load = loadMemory(source({ "index.md": indexOf([], entry("one")) }), REV, [], () => {})!;
    const record = memoryRecord(load);
    expect(record).not.toHaveProperty("entries");
    expect(record.revision).toBe(REV);
    expect(record.files).toEqual(load.files);
  });
});
