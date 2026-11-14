import { describe, expect, test } from "bun:test";
import { loadCatalog, loadRepoChoice } from "./catalog";
import { renderTemplate } from "./render";
import { resolveTemplate } from "./resolve";

const catalog = loadCatalog();
const ids = (choice: unknown) =>
  resolveTemplate(catalog, loadRepoChoice(JSON.stringify(choice), catalog)).sections.map((e) => e.id);
const render = (choice: unknown) =>
  renderTemplate(resolveTemplate(catalog, choice === null ? null : loadRepoChoice(JSON.stringify(choice), catalog)), catalog.version);

describe("resolveTemplate", () => {
  test("the default is the catalog's default entries in order", () => {
    const resolved = resolveTemplate(catalog, null);
    expect(resolved.sections.map((e) => e.id)).toEqual(catalog.sections.filter((e) => e.default).map((e) => e.id));
    expect(resolved.preamble).toEqual([]);
  });

  test("an empty choice equals the default", () => {
    expect(render({})).toBe(render(null));
  });

  test("add puts a catalog section at its catalog position", () => {
    const list = ids({ add: ["screenshots", "rollback"] });
    expect(list.indexOf("screenshots")).toBe(list.indexOf("evidence") + 1);
    expect(list.indexOf("rollback")).toBe(list.indexOf("how-to-test") + 1);
  });

  test("drop removes optional sections and nothing else", () => {
    const list = ids({ drop: ["decisions", "checks", "agent-context"] });
    expect(list).not.toContain("decisions");
    expect(list).not.toContain("checks");
    expect(list).toContain("decisions-status");
    expect(list).toContain("notes");
  });

  test("a custom entry goes after the id it names, in declared order", () => {
    const list = ids({
      custom: [
        { id: "first", kind: "section", heading: "First", after: "evidence" },
        { id: "second", kind: "section", heading: "Second", after: "evidence" },
        { id: "inner", kind: "details", summary: "Inner", after: "first" },
      ],
    });
    const at = list.indexOf("evidence");
    expect(list.slice(at, at + 5)).toEqual(["evidence", "first", "inner", "second", "decisions"]);
  });

  test("a custom entry with no after goes before the Wachiman block; a custom row ends the table", () => {
    const list = ids({
      custom: [
        { id: "last-section", kind: "section", heading: "Last" },
        { id: "team", kind: "status-row", label: "Team" },
      ],
    });
    expect(list.indexOf("last-section")).toBe(list.indexOf("wachiman") - 1);
    expect(list.indexOf("team")).toBe(list.indexOf("decisions-status") + 1);
    expect(list.slice(-2)).toEqual(["wachiman", "footer"]);
  });

  test("an after naming a dropped section still places the entry where that section was", () => {
    const list = ids({ drop: ["decisions"], custom: [{ id: "mine", kind: "section", heading: "Mine", after: "decisions" }] });
    expect(list.indexOf("mine")).toBe(list.indexOf("evidence") + 1);
  });

  test("custom entries are optional unless they say so and are never locked", () => {
    const entry = resolveTemplate(catalog, loadRepoChoice(JSON.stringify({ custom: [{ id: "m", kind: "section", heading: "M", required: true }] }), catalog))
      .sections.find((e) => e.id === "m")!;
    expect(entry).toMatchObject({ custom: true, locked: false, required: true });
  });
});
