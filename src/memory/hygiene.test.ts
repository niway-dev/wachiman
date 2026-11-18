/**
 * Memory hygiene (layer 6): likely duplicates, archive suggestions, the local record of last use,
 * and `wachiman memory archive`. Deterministic; no model, no network.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../../test/support/temp-repo";
import { runMemory } from "./command";
import { entryId, parseMemoryFile, type MemoryEntry } from "./entries";
import { archiveEntry, archiveSuggestions, DUPLICATE_THRESHOLD, entriesUsed, findDuplicates, memoryUsePath, readMemoryUse, recordMemoryUse, scopesOverlap, similarity } from "./hygiene";
import { repositoryKey } from "../history/store";

const temps: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function block(rule: string, over: { kind?: "convention" | "exception"; scope?: string; added?: string; holdsWhile?: string } = {}) {
  const f = { kind: over.kind ?? "convention", scope: over.scope ?? "src/**", rule, why: "because" };
  const id = entryId({ ...f, ...(over.holdsWhile ? { holdsWhile: over.holdsWhile } : {}) });
  return { id, text: `### ${id} ${rule}\n\n- kind: ${f.kind}\n- scope: ${f.scope}\n- rule: ${rule}\n- why: because\n${over.holdsWhile ? `- holds while: ${over.holdsWhile}\n` : ""}- evidence:\n  - 2026-01-01 operator instruction, branch x\n- added: ${over.added ?? "2026-11-01"}\n` };
}
const entriesOf = (...texts: string[]): MemoryEntry[] => parseMemoryFile("index.md", `# Memory\n\n${texts.join("\n")}`).entries;

describe("likely duplicates", () => {
  test("the measure is the overlap of lowercase word sets, and the threshold is documented", () => {
    expect(DUPLICATE_THRESHOLD).toBe(0.8);
    expect(similarity("Prefer named exports.", "prefer NAMED exports")).toBe(1);
    expect(similarity("Prefer named exports in modules", "Prefer default exports in modules")).toBeCloseTo(4 / 6);
    expect(similarity("a b", "c d")).toBe(0);
  });

  test("scopes overlap when one literal prefix contains the other", () => {
    expect(scopesOverlap("src/**", "src/api/*.ts")).toBe(true);
    expect(scopesOverlap("**", "docs/**")).toBe(true);
    expect(scopesOverlap("src/**", "docs/**")).toBe(false);
    expect(scopesOverlap("docs/**, src/a/**", "src/a/b.ts")).toBe(true);
  });

  test("two entries of one kind with overlapping scopes and near-identical rules are a pair; other combinations are not", () => {
    const a = block("Prefer named exports over default exports in every module");
    const b = block("Prefer named exports over default exports in every module.", { scope: "src/api/**" });
    const otherKind = block("Prefer named exports over default exports in every module", { kind: "exception", scope: "src/**" });
    const otherScope = block("Prefer named exports over default exports in every module", { scope: "docs/**" });
    const different = block("Name test files after the module they cover");
    const pairs = findDuplicates(entriesOf(a.text, b.text, otherKind.text, otherScope.text, different.text));
    expect(pairs.map((p) => [p.a.id, p.b.id])).toEqual([[a.id, b.id]]);
    expect(pairs[0].similarity).toBe(1);
  });

  test("entries in archive.md are not compared", () => {
    const a = block("Prefer named exports over default exports in every module");
    const b = block("Prefer named exports over default exports in every module!", { scope: "src/**" });
    const archived = parseMemoryFile("archive.md", `# A\n\n${b.text}`).entries;
    expect(findDuplicates([...entriesOf(a.text), ...archived])).toEqual([]);
  });
});

describe("archive suggestions", () => {
  const e = (added: string) => entriesOf(block(`rule ${added}`, { added }).text)[0];
  test("an entry never used is measured from its added date; a recorded use replaces it", () => {
    const old = e("2026-06-01");
    const fresh = e("2026-11-01");
    const usedRecently = e("2026-01-01");
    const all = [old, fresh, usedRecently];
    const s = archiveSuggestions(all, { [usedRecently.id]: "2026-11-10" }, 90, "2026-11-18");
    expect(s.map((x) => x.entry.id)).toEqual([old.id]);
    expect(s[0]).toMatchObject({ since: "2026-06-01", usedEver: false, days: 170 });
  });

  test("exactly archive_after_days is not yet old; one day more is", () => {
    const x = e("2026-08-20"); // 90 days before 2026-11-18
    expect(archiveSuggestions([x], {}, 90, "2026-11-18")).toEqual([]);
    expect(archiveSuggestions([x], {}, 89, "2026-11-18")).toHaveLength(1);
  });

  test("a use older than the added date does not make the entry look older", () => {
    const x = e("2026-11-01");
    expect(archiveSuggestions([x], { [x.id]: "2025-01-01" }, 90, "2026-11-18")).toEqual([]);
  });
});

describe("last use", () => {
  test("is recorded per repository under the history store, 0600, keeping the latest date per id", () => {
    const home = temp("wachiman-use-home-");
    expect(readMemoryUse(home, "repo-1")).toEqual({});
    recordMemoryUse(home, "repo-1", ["aaaaaaa", "bbbbbbb"], "2026-11-10");
    recordMemoryUse(home, "repo-1", ["aaaaaaa"], "2026-11-05");
    recordMemoryUse(home, "repo-1", ["bbbbbbb"], "2026-11-12");
    expect(readMemoryUse(home, "repo-1")).toEqual({ aaaaaaa: "2026-11-10", bbbbbbb: "2026-11-12" });
    expect(readMemoryUse(home, "repo-2")).toEqual({});
    expect(memoryUsePath(home, "repo-1")).toBe(join(home, "history", "repo-1", "memory-use.json"));
    expect(statSync(memoryUsePath(home, "repo-1")).mode & 0o777).toBe(0o600);
  });

  test("recording nothing creates nothing, and a corrupt record reads as empty", () => {
    const home = temp("wachiman-use-home-");
    recordMemoryUse(home, "repo-1", [], "2026-11-10");
    expect(existsSync(join(home, "history"))).toBe(false);
    mkdirSync(join(home, "history", "repo-1"), { recursive: true });
    writeFileSync(memoryUsePath(home, "repo-1"), "{not json");
    expect(readMemoryUse(home, "repo-1")).toEqual({});
  });

  test("an unreadable or foreign-format record is never overwritten: recording throws and the file stays as it was", () => {
    const home = temp("wachiman-use-home-");
    mkdirSync(join(home, "history", "repo-1"), { recursive: true });
    for (const text of ["{not json", JSON.stringify({ format: "wachiman.memory-use/2", used: {} })]) {
      writeFileSync(memoryUsePath(home, "repo-1"), text);
      expect(() => recordMemoryUse(home, "repo-1", ["aaaaaaa"], "2026-11-10")).toThrow(/memory-use\.json/);
      expect(readFileSync(memoryUsePath(home, "repo-1"), "utf8")).toBe(text);
    }
  });

  test("a review used a convention whose scope the diff reaches and an exception that muted a finding", () => {
    const conv = block("Prefer named exports", { scope: "src/**" });
    const far = block("Docs are short", { scope: "docs/**" });
    const exc = block("Do not report wording", { kind: "exception", scope: "src/**" });
    const memory = { entries: entriesOf(conv.text, far.text, exc.text) } as Parameters<typeof entriesUsed>[0];
    expect(entriesUsed(memory, ["src/a.ts"], [])).toEqual([conv.id]);
    expect(entriesUsed(memory, ["src/a.ts"], [{ entry: exc.id }]).sort()).toEqual([conv.id, exc.id].sort());
    expect(entriesUsed(undefined, ["src/a.ts"], [])).toEqual([]);
  });
});

describe("archiveEntry", () => {
  test("moves one entry's text to archive.md, created when absent, and leaves the others untouched", () => {
    const a = block("Rule A");
    const b = block("Rule B");
    const index = `# Memory\n\nIntro text.\n\n${a.text}\n${b.text}`;
    const r = archiveEntry({ "index.md": index }, a.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.from).toBe("index.md");
    expect(r.files["index.md"]).toBe(`# Memory\n\nIntro text.\n\n${b.text}`);
    expect(r.files["archive.md"]).toContain(a.text);
    expect(parseMemoryFile("archive.md", r.files["archive.md"]).problems).toEqual([]);
    expect(parseMemoryFile("archive.md", r.files["archive.md"]).entries.map((x) => x.id)).toEqual([a.id]);
  });

  test("removes only the entry's own block and its one separating blank line; every other byte stays", () => {
    const a = block("Rule A");
    const b = block("Rule B");
    const c = block("Rule C");
    const index = `# Memory\n\n\n\nIntro  text.\n\n\n${a.text}\n${b.text}\n\n\n${c.text}`;
    const r = archiveEntry({ "index.md": index }, b.id);
    expect(r.ok && r.files["index.md"]).toBe(`# Memory\n\n\n\nIntro  text.\n\n\n${a.text}\n\n\n${c.text}`);
    const last = archiveEntry({ "index.md": index }, c.id);
    expect(last.ok && last.files["index.md"]).toBe(`# Memory\n\n\n\nIntro  text.\n\n\n${a.text}\n${b.text}\n\n`);
  });

  test("appends to an existing archive.md; an unknown or already archived id is refused", () => {
    const a = block("Rule A");
    const b = block("Rule B");
    const r = archiveEntry({ "index.md": `# M\n\n${a.text}`, "archive.md": `# Archive\n\n${b.text}` }, a.id);
    expect(r.ok && r.files["archive.md"]).toBe(`# Archive\n\n${b.text}\n${a.text}`);
    expect(archiveEntry({ "index.md": "# M\n" }, "0000000")).toEqual({ ok: false, reason: "no entry 0000000 in .wachiman/memory/." });
    expect(archiveEntry({ "index.md": "# M\n", "archive.md": `# A\n\n${b.text}` }, b.id)).toEqual({ ok: false, reason: `entry ${b.id} is already in archive.md.` });
  });
});

describe("wachiman memory check suggestions and memory archive", () => {
  const NOW = new Date("2026-11-18T10:00:00Z");
  function setup(blocks: string[], extra: Record<string, string> = {}) {
    const dir = temp("memory-hygiene-");
    git(dir, "init", "-q");
    const files = { "src/a.ts": "a\n", ".wachiman/memory/index.md": `# Memory\n\n${blocks.join("\n")}`, ...extra };
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    const home = temp("memory-hygiene-home-");
    const run = (argv: string[], env: Record<string, string | undefined> = {}) => {
      let stdout = "";
      let stderr = "";
      const code = runMemory(argv, dir, { stdout: (t) => (stdout += t), stderr: (l) => (stderr += `${l}\n`) }, { env: { WACHIMAN_HOME: home, ...env }, now: () => NOW });
      return { code, stdout, stderr };
    };
    return { dir, home, run, key: () => repositoryKey(dir).key };
  }
  const A = "Prefer named exports over default exports in every module";

  test("duplicates and old entries are suggestions on stdout, apart from problems, and never change the exit code", () => {
    const a = block(A);
    const b = block(`${A}.`, { scope: "src/**" });
    const old = block("Name files after their module", { added: "2026-05-01" });
    const s = setup([a.text, b.text, old.text]);
    const r = s.run(["check"]);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("memory ok");
    expect(r.stdout).toContain(`suggestion: ${a.id} and ${b.id} look like duplicates`);
    expect(r.stdout).toContain(`suggestion: ${old.id}`);
    expect(r.stdout).toContain("never used");
    expect(r.stdout).toContain(`wachiman memory archive ${old.id}`);
    expect(r.stdout).not.toContain(`suggestion: ${a.id} not used`);
  });

  test("a recorded use postpones the archive suggestion; memory.archive_after_days sets the limit", () => {
    const old = block("Name files after their module", { added: "2026-05-01" });
    const s = setup([old.text]);
    recordMemoryUse(s.home, s.key(), [old.id], "2026-11-01");
    expect(s.run(["check"]).stdout).not.toContain("suggestion");
    writeFileSync(join(s.dir, ".wachiman.yml"), "memory:\n  archive_after_days: 10\n");
    const r = s.run(["check"]);
    expect(r.stdout).toContain(`suggestion: ${old.id} last used 2026-11-01 (17 days ago)`);
  });

  test("in GitHub Actions there is no record, so no archive suggestion is made, but duplicates still are", () => {
    const a = block(A);
    const b = block(`${A}.`);
    const old = block("Name files after their module", { added: "2026-05-01" });
    const r = setup([a.text, b.text, old.text]).run(["check"], { GITHUB_ACTIONS: "true" });
    expect(r.stdout).toContain("look like duplicates");
    expect(r.stdout).not.toContain("never used");
  });

  test("a problem still exits 1 and suggestions are printed after it", () => {
    const old = block("Name files after their module", { added: "2026-05-01" });
    const s = setup([old.text], { ".wachiman/memory/extra.md": "# not listed\n" });
    const r = s.run(["check"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("extra.md:1: is not listed in index.md");
    expect(r.stdout).toContain(`suggestion: ${old.id}`);
  });

  test("archive moves the entry in the working tree only, on the explicit command", () => {
    const a = block("Rule A");
    const b = block("Rule B");
    const s = setup([a.text, b.text]);
    const r = s.run(["archive", a.id]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`archived: ${a.id} moved from index.md to archive.md`);
    expect(r.stdout).toContain("not committed");
    const dir = join(s.dir, ".wachiman/memory");
    expect(readFileSync(join(dir, "index.md"), "utf8")).not.toContain(a.id);
    expect(readFileSync(join(dir, "index.md"), "utf8")).toContain(b.id);
    expect(readFileSync(join(dir, "archive.md"), "utf8")).toContain(a.text);
    expect(git(s.dir, "diff", "--cached", "--name-only").trim()).toBe("");
    expect(s.run(["check"]).code).toBe(0);
  });

  test("a failed write to archive.md leaves the entry in its source file", () => {
    const a = block("Rule A");
    const s = setup([a.text], { ".wachiman/memory/archive.md/keep": "x" });
    const path = join(s.dir, ".wachiman/memory/index.md");
    const before = readFileSync(path, "utf8");
    expect(() => s.run(["archive", a.id])).toThrow();
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  test("archive of an unknown id or without an id writes nothing and fails", () => {
    const s = setup([block("Rule A").text]);
    const before = readFileSync(join(s.dir, ".wachiman/memory/index.md"), "utf8");
    const r = s.run(["archive", "0000000"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("no entry 0000000");
    expect(readFileSync(join(s.dir, ".wachiman/memory/index.md"), "utf8")).toBe(before);
    expect(existsSync(join(s.dir, ".wachiman/memory/archive.md"))).toBe(false);
    expect(() => s.run(["archive"])).toThrow(/takes one entry id/);
  });
});
