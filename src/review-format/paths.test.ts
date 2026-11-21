import { describe, expect, test } from "bun:test";
import { MAX_NAME, displayLocation, displayPaths, shortName } from "./paths";

describe("shortName", () => {
  test("keeps a name of 40 characters or fewer", () => {
    const name = "a".repeat(40);
    expect(shortName(name)).toBe(name);
    expect(shortName("run.ts")).toBe("run.ts");
  });

  test("keeps the first and the last word around an ellipsis", () => {
    const name = "0051-a-pull-request-is-checked-against-its-own-template-and-locked-sections-come-from-wachiman.md";
    expect(name.length).toBeGreaterThan(MAX_NAME);
    expect(shortName(name)).toBe("0051-…-wachiman.md");
  });

  test("words split on a hyphen or an underscore, and the joiners are kept", () => {
    expect(shortName("very_long_snake_case_name_that_goes_on_and_on_forever.test.ts")).toBe("very_…_forever.test.ts");
  });

  test("a long name with no words to drop keeps both ends of it and fits in 40", () => {
    const name = `${"a".repeat(30)}${"b".repeat(30)}.ts`;
    const short = shortName(name);
    expect(short.length).toBeLessThanOrEqual(MAX_NAME);
    expect(short).toContain("…");
    expect(short.startsWith("aaa")).toBe(true);
    expect(short.endsWith("b.ts")).toBe(true);
  });

  test("when the first and last words alone are over 40, the name is cut in the middle", () => {
    const name = `${"a".repeat(30)}-mid-${"b".repeat(30)}.ts`;
    const short = shortName(name);
    expect(short.length).toBeLessThanOrEqual(MAX_NAME);
    expect(short).toContain("…");
  });
});

describe("displayPaths", () => {
  test("shows the file name alone when nothing collides", () => {
    const shown = displayPaths(["src/engine.ts", "docs/adr/0055-x.md", "src/engine.ts"]);
    expect(shown.get("src/engine.ts")).toBe("engine.ts");
    expect(shown.get("docs/adr/0055-x.md")).toBe("0055-x.md");
  });

  test("two directories with the same name each get the shortest suffix that tells them apart", () => {
    const shown = displayPaths(["src/init/run.ts", "src/setup/run.ts"]);
    expect(shown.get("src/init/run.ts")).toBe("init/run.ts");
    expect(shown.get("src/setup/run.ts")).toBe("setup/run.ts");
  });

  test("the same path twice is one location, not a collision", () => {
    expect(displayPaths(["src/run.ts", "src/run.ts"]).get("src/run.ts")).toBe("run.ts");
  });

  test("a third file widens only the paths that still look alike", () => {
    const shown = displayPaths(["src/init/run.ts", "lib/init/run.ts", "src/setup/run.ts", "README.md"]);
    expect(shown.get("src/init/run.ts")).toBe("src/init/run.ts");
    expect(shown.get("lib/init/run.ts")).toBe("lib/init/run.ts");
    expect(shown.get("src/setup/run.ts")).toBe("setup/run.ts");
    expect(shown.get("README.md")).toBe("README.md");
  });

  test("a path that is the tail of another still gets its own text", () => {
    const shown = displayPaths(["run.ts", "src/run.ts"]);
    expect(shown.get("run.ts")).toBe("run.ts");
    expect(shown.get("src/run.ts")).toBe("src/run.ts");
  });

  test("two long names that shorten to the same text are told apart by their directories", () => {
    const a = `a/${"x".repeat(5)}-${"m".repeat(20)}-${"n".repeat(20)}-end.ts`;
    const b = `b/${"x".repeat(5)}-${"o".repeat(20)}-${"p".repeat(20)}-end.ts`;
    expect(shortName(a.split("/")[1])).toBe(shortName(b.split("/")[1]));
    const shown = displayPaths([a, b]);
    expect(shown.get(a)).not.toBe(shown.get(b));
    expect(shown.get(a)?.startsWith("a/")).toBe(true);
    expect(shown.get(b)?.startsWith("b/")).toBe(true);
  });
});

describe("displayPaths at full depth", () => {
  test("two files of one directory whose shortened names are equal show their full paths", () => {
    const a = `docs/adr/0051-a-${"x".repeat(30)}-from-wachiman.md`;
    const b = `docs/adr/0051-b-${"y".repeat(30)}-from-wachiman.md`;
    expect(shortName(a.split("/")[2])).toBe(shortName(b.split("/")[2]));
    const shown = displayPaths([a, b, "src/other.ts"]);
    expect(shown.get(a)).toBe(a);
    expect(shown.get(b)).toBe(b);
    expect(shown.get("src/other.ts")).toBe("other.ts");
  });
});

describe("displayLocation", () => {
  test("adds the line, and none for a finding about the whole file", () => {
    expect(displayLocation("run.ts", 12)).toBe("run.ts:12");
    expect(displayLocation("run.ts", 0)).toBe("run.ts");
  });
});
