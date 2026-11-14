import { describe, expect, test } from "bun:test";
import { PrTemplateConfigError, loadCatalog, loadRepoChoice, parseCatalog, type Catalog } from "./catalog";
import { parseStamp, renderTemplate, stampHashOf, templateState } from "./render";
import { resolveTemplate } from "./resolve";

const catalog = loadCatalog();
const render = (choice: unknown = null, cat: Catalog = catalog) =>
  renderTemplate(resolveTemplate(cat, choice === null ? null : loadRepoChoice(JSON.stringify(choice), cat)), cat.version);
const MARKER = ["BREAKING", "CHANGE"].join(" ");

describe("renderTemplate, default", () => {
  const text = render();
  const lines = text.split("\n");

  test("the first line is the stamp and its hash covers everything below it", () => {
    const stamp = parseStamp(text)!;
    expect(lines[0]).toBe(`<!-- wachiman:pr-template version=1 sha256=${stamp.sha256} -->`);
    expect(stamp.version).toBe(1);
    expect(stamp.sha256).toBe(stampHashOf(text.slice(text.indexOf("\n") + 1)));
  });

  test("status rows, headings and details come in the earlier checker's order", () => {
    const rows = [...text.matchAll(/^\| \*\*(.+?)\*\* \|/gm)].map((m) => m[1]);
    expect(rows).toEqual(["Type", "Issue", "Risk", "Rollout", "Release", "Evidence", "Decisions"]);
    expect([...text.matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual(["Needs you", "What", "Why", "Evidence", "Decisions"]);
    expect([...text.matchAll(/<summary><b>(.+?)<\/b>/g)].map((m) => m[1])).toEqual([
      "Changes", "How to test", "Not verified", "Checks", "Agent context", "Notes",
    ]);
  });

  test("carries the Wachiman block and a footer with a {sha} placeholder", () => {
    expect(text).toContain("<!-- wachiman:confidence:start -->\n<!-- wachiman:confidence:end -->");
    expect(text.trimEnd().endsWith("<sub>Describes commit {sha}.</sub>")).toBe(true);
    expect(text).not.toMatch(/<model>|<sha>/);
    expect(text).not.toContain("Written by");
  });

  test("keeps the details summaries with their counters and the risk guide", () => {
    expect(text).toContain("<details><summary><b>Changes</b>: N facts, F files, +A −D</summary>");
    expect(text).toContain("<details><summary><b>Not verified</b> (N)</summary>");
    expect(text).toContain("Start from `wachiman pr-template risk`");
    expect(text).toContain("| **Issue** | <!-- [ABC-123: issue title](link), or None --> |");
  });

  test("names no private repository or company", () => {
    expect(text).not.toMatch(/cs-tack|cs-write-handoff|pento|\.claude/i);
  });

  test("guide comments are wrapped and end with a newline", () => {
    expect(text.endsWith("\n")).toBe(true);
    for (const line of lines) if (!line.startsWith("| **") && !line.startsWith("<!-- wachiman") && !line.startsWith("<!-- PR")) expect(line.length).toBeLessThan(110);
  });

  test("is deterministic", () => {
    expect(render()).toBe(text);
    expect(render({})).toBe(text);
  });
});

describe("renderTemplate, with a repository choice", () => {
  test("the preamble sits under the intro comment and above the status table", () => {
    const text = render({ preamble: ["- [ ] I said whether an AI tool wrote part of this.", "- [ ] **Outside contributors only:** I accept CLA.md."] });
    const body = text.split("\n").slice(1).join("\n");
    const first = body.indexOf("- [ ] I said");
    expect(first).toBeGreaterThan(body.indexOf("-->"));
    expect(first).toBeLessThan(body.indexOf("| | |"));
    expect(text).toContain("- [ ] I said whether an AI tool wrote part of this.\n- [ ] **Outside contributors only:** I accept CLA.md.\n\n| | |");
  });

  test("a multi-line preamble entry stays together", () => {
    const text = render({ preamble: ["- [ ] wrapped\n      line two"] });
    expect(text).toContain("- [ ] wrapped\n      line two\n\n| | |");
  });

  test("added, dropped and custom entries show up in the output", () => {
    const text = render({
      add: ["screenshots"],
      drop: ["decisions"],
      custom: [
        { id: "migration-notes", kind: "section", heading: "Migration notes", after: "evidence", guide: "Say what to run." },
        { id: "team", kind: "status-row", label: "Team", guide: "Owning team" },
      ],
    });
    expect([...text.matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual(["Needs you", "What", "Why", "Evidence", "Migration notes", "Screenshots"]);
    expect(text).toContain("| **Team** | <!-- Owning team --> |");
    expect(text).toContain("<!-- Say what to run. -->");
  });

  test("a custom row without a guide leaves an empty cell", () => {
    expect(render({ custom: [{ id: "team", kind: "status-row", label: "Team" }] })).toContain("| **Team** |  |");
  });
});

describe("refusing the breaking-change marker", () => {
  const rejected = (choice: unknown) => expect(() => render(choice)).toThrow(PrTemplateConfigError);

  test("in a custom guide comment", () => {
    rejected({ custom: [{ id: "m", kind: "section", heading: "M", guide: `Never write ${MARKER}: here` }] });
    rejected({ custom: [{ id: "m", kind: "section", heading: "M", guide: "the breaking-change footer" }] });
  });

  test("in the preamble, whatever the case or the separator", () => {
    rejected({ preamble: [`${MARKER.toLowerCase()}: x`] });
    rejected({ preamble: ["BREAKING-CHANGE: x"] });
  });

  test("as a title-style marker", () => {
    rejected({ preamble: ["feat!: drop the flag"] });
    rejected({ preamble: ["fix(api)!: rename"] });
  });

  test("in a custom heading", () => {
    rejected({ custom: [{ id: "m", kind: "section", heading: `${MARKER} notes` }] });
  });

  test("the shipped default carries none", () => {
    expect(() => render()).not.toThrow();
  });
});

describe("parseStamp", () => {
  test("round trips and returns the body", () => {
    const text = render();
    const stamp = parseStamp(text)!;
    expect(`<!-- wachiman:pr-template version=${stamp.version} sha256=${stamp.sha256} -->\n${stamp.body}`).toBe(text);
  });

  test("is null without a stamp, with a malformed one, or when it is not the first line", () => {
    expect(parseStamp("# hello\n")).toBeNull();
    expect(parseStamp("<!-- wachiman:pr-template version=x sha256=abc -->\n")).toBeNull();
    expect(parseStamp(`\n${render()}`)).toBeNull();
  });
});

describe("templateState", () => {
  const input = (fileText: string | null, choiceText: string | null = null) => ({ catalog, fileText, choiceText });
  const fresh = render();

  test("missing", () => {
    expect(templateState(input(null))).toEqual({ state: "missing", version: 1, installedVersion: null });
  });

  test("unmanaged", () => {
    expect(templateState(input("## What\n"))).toEqual({ state: "unmanaged", version: 1, installedVersion: null });
  });

  test("current, also with Windows line endings", () => {
    expect(templateState(input(fresh))).toEqual({ state: "current", version: 1, installedVersion: 1 });
    expect(templateState(input(fresh.replace(/\n/g, "\r\n"))).state).toBe("current");
  });

  test("edited by hand when the body no longer matches its hash", () => {
    expect(templateState(input(`${fresh}extra line\n`)).state).toBe("edited-by-hand");
    expect(templateState(input(fresh.replace("## What", "## Whut"))).state).toBe("edited-by-hand");
  });

  test("outdated when the JSON changed after install", () => {
    const next = JSON.stringify({ add: ["screenshots"] });
    expect(templateState(input(fresh, next))).toEqual({ state: "outdated", version: 1, installedVersion: 1 });
  });

  test("outdated when the catalog moved to a newer version", () => {
    const bumped = parseCatalog(JSON.stringify({ ...JSON.parse(JSON.stringify(catalog)), version: 2 }));
    expect(templateState({ catalog: bumped, fileText: fresh, choiceText: null })).toEqual({ state: "outdated", version: 2, installedVersion: 1 });
  });

  test("a custom template is current against its own JSON, not outdated for differing from the default", () => {
    const json = JSON.stringify({ drop: ["decisions"], preamble: ["- [ ] hi"] });
    const custom = render(JSON.parse(json));
    expect(custom).not.toBe(fresh);
    expect(templateState(input(custom, json)).state).toBe("current");
  });

  test("invalid when the JSON breaks a rule, even when the file is missing, without falling back", () => {
    const bad = JSON.stringify({ drop: ["footer"] });
    const state = templateState(input(fresh, bad));
    expect(state).toMatchObject({ state: "invalid", version: 1, installedVersion: 1 });
    expect(state.problem).toMatch(/"footer" is locked/);
    expect(templateState(input(null, "{")).state).toBe("invalid");
  });

  test("invalid when the repository's text would carry the breaking-change marker", () => {
    const json = JSON.stringify({ preamble: ["feat!: x"] });
    expect(templateState(input(fresh, json)).state).toBe("invalid");
  });
});
