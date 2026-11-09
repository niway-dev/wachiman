import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectInstall as detectFromDoctor } from "./doctor/checks";
import { readVersion } from "./cli";
import { detectInstall, readAsset } from "./install-kind";

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});
function layout(parent: string, pkgName: string, version = "9.9.9") {
  const root = join(mkdtempSync(join(tmpdir(), "layout-")), parent);
  scratch.push(root);
  mkdirSync(join(root, "src", "doctor"), { recursive: true });
  mkdirSync(join(root, "skills", "wachiman-review"), { recursive: true });
  mkdirSync(join(root, "templates"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: pkgName, version }));
  writeFileSync(join(root, "templates", "wachiman-review-caller.yml"), "name: caller\n");
  writeFileSync(join(root, "src", "providers.settings.json"), "{}");
  writeFileSync(join(root, "skills", "wachiman-review", "SKILL.md"), "# skill\n");
  return root;
}

describe("detectInstall", () => {
  test("a clone is the source layout and its root is the repository", () => {
    const root = layout("clone", "wachiman");
    expect(detectInstall("1.0.0", join(root, "src"))).toEqual({ kind: "source", root });
  });

  test("a package under node_modules is the npm layout with the package directory as root", () => {
    const root = layout(join("node_modules", "wachiman"), "wachiman");
    expect(detectInstall("1.0.0", join(root, "src"))).toEqual({ kind: "npm", root });
  });

  test("a bundled executable's module directory is the exe layout and carries the version", () => {
    expect(detectInstall("1.2.3", "/$bunfs/root")).toEqual({ kind: "exe", version: "1.2.3" });
    expect(detectInstall("1.2.3", "B:\\~BUN\\root")).toEqual({ kind: "exe", version: "1.2.3" });
  });

  test("the doctor's entry point, called from src/doctor, agrees with this module", () => {
    const npm = layout(join("node_modules", "wachiman"), "wachiman");
    expect(detectFromDoctor("1.0.0", join(npm, "src", "doctor"))).toEqual(detectInstall("1.0.0", join(npm, "src")));
  });

  test("with its default directory it reports this clone as the source layout", () => {
    const here = detectInstall("1.0.0");
    expect(here.kind).toBe("source");
    expect(here).toEqual({ kind: "source", root: join(import.meta.dir, "..") });
  });
});

describe("readAsset", () => {
  test("reads a template as text from the source layout and from the npm layout alike", () => {
    for (const parent of ["clone", join("node_modules", "wachiman")]) {
      const root = layout(parent, "wachiman");
      const install = detectInstall("1.0.0", join(root, "src"));
      expect(readAsset(install, "templates/wachiman-review-caller.yml")).toBe("name: caller\n");
    }
  });

  test("reads a skill file as bytes", () => {
    const root = layout("clone", "wachiman");
    const out = readAsset({ kind: "source", root }, "skills/wachiman-review/SKILL.md");
    expect(out).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(out as Uint8Array)).toBe("# skill\n");
  });

  test("refuses a name that leaves the package", () => {
    const root = layout("clone", "wachiman");
    expect(() => readAsset({ kind: "source", root }, "skills/../../etc/passwd" as never)).toThrow(/outside/);
    expect(() => readAsset({ kind: "source", root }, "skills/..\\x" as never)).toThrow(/outside/);
    expect(() => readAsset({ kind: "source", root }, "/etc/passwd" as never)).toThrow(/not an asset/);
  });

  test("the real repository serves its caller template and engine settings", () => {
    const install = detectInstall("1.0.0");
    expect(readAsset(install, "templates/wachiman-review-caller.yml")).toContain("wachiman");
    expect(JSON.parse(readAsset(install, "src/providers/claude-code.settings.json") as string)).toBeObject();
  });

  describe("the executable layout", () => {
    const exe = { kind: "exe", version: "1.0.0" } as const;
    /** Illustrative embedded files, keyed by the repository-relative name `--asset-naming` gives them. */
    const files: Record<string, string> = {
      "src/providers/claude-code.settings.json": '{"permissions":{"deny":["Bash"]}}',
      "templates/wachiman-review-caller.yml": "name: caller\n",
      "skills/wachiman-review/SKILL.md": "# skill\n",
    };
    const embedded = { has: (name: string) => name in files, read: (name: string) => new TextEncoder().encode(files[name]) };

    test("serves the settings and the template as text and a skill file as the bytes that were embedded", () => {
      expect(readAsset(exe, "src/providers/claude-code.settings.json", embedded)).toBe(files["src/providers/claude-code.settings.json"]);
      expect(readAsset(exe, "templates/wachiman-review-caller.yml", embedded)).toBe("name: caller\n");
      const skill = readAsset(exe, "skills/wachiman-review/SKILL.md", embedded);
      expect(skill).toBeInstanceOf(Uint8Array);
      expect(new TextDecoder().decode(skill as Uint8Array)).toBe("# skill\n");
    });

    test("a name that was not embedded is an error that names it, never an empty read", () => {
      expect(() => readAsset(exe, "skills/missing/SKILL.md", embedded)).toThrow(/skills\/missing\/SKILL\.md.*not embedded/);
    });

    test("refuses the same names as the other layouts", () => {
      expect(() => readAsset(exe, "skills/../x" as never, embedded)).toThrow(/outside|not an asset/);
      expect(() => readAsset(exe, "skills/..\\x" as never, embedded)).toThrow(/outside|not an asset/);
      expect(() => readAsset(exe, "/etc/passwd" as never, embedded)).toThrow(/not an asset/);
    });
  });
});

describe("readVersion", () => {
  test("the version baked in at build time wins, and needs no package.json beside the executable", () => {
    expect(readVersion("/$bunfs/root", "3.4.5")).toBe("3.4.5");
    expect(readVersion(join(layout("d", "wachiman", "2.3.4"), "src"), "3.4.5")).toBe("3.4.5");
  });

  test("an empty or absent build define falls back to the package.json beside the source", () => {
    expect(readVersion(join(layout("e", "wachiman", "2.3.4"), "src"), undefined)).toBe("2.3.4");
    expect(readVersion(join(layout("f", "wachiman", "2.3.4"), "src"), "")).toBe("2.3.4");
  });

  test("accepts a package named wachiman", () => {
    expect(readVersion(join(layout("a", "wachiman", "2.3.4"), "src"))).toBe("2.3.4");
  });

  test("still accepts the former package name agent-review", () => {
    expect(readVersion(join(layout("b", "agent-review", "1.9.0"), "src"))).toBe("1.9.0");
  });

  test("a package.json that belongs to someone else is unknown", () => {
    expect(readVersion(join(layout("c", "someone-elses-app", "5.0.0"), "src"))).toBe("unknown");
  });
});
