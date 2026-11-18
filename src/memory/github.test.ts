import { describe, expect, test } from "bun:test";
import { GhError, readBaseMemory, type GhFn } from "../engine";

const BASE = "b".repeat(40);
const HEAD = "a".repeat(40);
const INDEX = "# Memory\n\n| Glob | File |\n| --- | --- |\n| `apps/**` | `apps.md` |\n";

const b64 = (text: string) => ({ type: "file", encoding: "base64", content: Buffer.from(text).toString("base64") });
const notFound = () => new GhError("gh: Not Found (HTTP 404)", 404, "Not Found");

/** A repository whose base and head differ: the head's memory has an extra rule the base lacks. */
function repo() {
  const calls: string[] = [];
  const files: Record<string, Record<string, string>> = {
    [BASE]: { ".wachiman/memory/index.md": INDEX, ".wachiman/memory/apps.md": "BASE RULE\n", ".wachiman.yml": "memory:\n  max_loaded_lines: 50\n" },
    [HEAD]: { ".wachiman/memory/index.md": `${INDEX}HEAD ADDITION\n`, ".wachiman/memory/apps.md": "HEAD RULE\n", ".wachiman/memory/new.md": "HEAD ONLY\n" },
  };
  const gh: GhFn = (args) => {
    const url = args[1];
    calls.push(url);
    const [path, ref] = url.replace("repos/o/r/contents/", "").split("?ref=");
    const tree = files[ref] ?? {};
    if (path === ".wachiman/memory") {
      const names = Object.keys(tree).filter((p) => p.startsWith(".wachiman/memory/"));
      if (names.length === 0) throw notFound();
      return JSON.stringify([...names.map((n) => ({ type: "file", name: n.split("/").pop() })), { type: "dir", name: "sub" }]);
    }
    if (!(path in tree)) throw notFound();
    return JSON.stringify(b64(tree[path]));
  };
  return { gh, calls };
}

describe("readBaseMemory", () => {
  test("reads the folder and the settings at the base commit and never asks for the head", () => {
    const { gh, calls } = repo();
    const load = readBaseMemory(gh, "o/r", BASE, ["apps/x.ts"], () => {})!;
    expect(load.revision).toBe(BASE);
    expect(load.files.map((f) => f.path)).toEqual([".wachiman/memory/index.md", ".wachiman/memory/apps.md"]);
    expect(load.entries).toEqual([]);
    expect(load.budget.maxLoadedLines).toBe(50);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.endsWith(`ref=${BASE}`))).toBe(true);
  });

  test("an area file the changed paths do not select is not requested", () => {
    const { gh, calls } = repo();
    readBaseMemory(gh, "o/r", BASE, ["docs/readme.md"], () => {});
    expect(calls.some((c) => c.includes("apps.md"))).toBe(false);
  });

  test("a repository with no memory folder at the base makes one request and has no memory", () => {
    const { gh, calls } = repo();
    expect(readBaseMemory(gh, "o/r", "c".repeat(40), ["apps/x.ts"], () => {})).toBeUndefined();
    expect(calls).toEqual([`repos/o/r/contents/.wachiman/memory?ref=${"c".repeat(40)}`]);
  });

  test("a file longer than the read limit loads its start and warns; one GitHub does not return is not loaded", () => {
    const big = (text: string, content = true) => ({ type: "file", encoding: content ? "base64" : "none", content: content ? Buffer.from(text).toString("base64") : "" });
    const tree: Record<string, unknown> = { "index.md": big(INDEX + "x\n".repeat(40_000)), "apps.md": big("", false) };
    const gh: GhFn = (args) => {
      const path = args[1].replace("repos/o/r/contents/", "").split("?ref=")[0];
      if (path === ".wachiman/memory") return JSON.stringify(Object.keys(tree).map((name) => ({ type: "file", name })));
      const name = path.replace(".wachiman/memory/", "");
      if (name in tree) return JSON.stringify(tree[name]);
      throw notFound();
    };
    const warned: string[] = [];
    const load = readBaseMemory(gh, "o/r", BASE, ["apps/x.ts"], (l) => warned.push(l))!;
    expect(load.files.map((f) => f.path)).toEqual([".wachiman/memory/index.md"]);
    expect(warned.some((w) => w.includes("index.md is longer than 64 KB"))).toBe(true);
    expect(warned.some((w) => w.includes("apps.md is over 1 MB"))).toBe(true);
  });

  test("an error other than not-found from GitHub propagates", () => {
    const gh: GhFn = () => {
      throw new GhError("gh: boom (HTTP 502)", 502, "boom");
    };
    expect(() => readBaseMemory(gh, "o/r", BASE, [], () => {})).toThrow("boom");
  });
});
