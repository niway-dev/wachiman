import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildArgs, packageVersion, skillFilesOf } from "../scripts/build-exe";

const root = join(import.meta.dir, "..");

describe("buildArgs", () => {
  const args = buildArgs({ outfile: "out/wachiman.exe", version: "1.10.0", target: "bun-windows-x64", skillFiles: ["skills/a/SKILL.md"] });

  test("compiles for Windows with both autoloads off, so the working directory's bunfig and dotenv file are never read", () => {
    expect(args.slice(0, 2)).toEqual(["build", "--compile"]);
    expect(args.slice(args.indexOf("--target"), args.indexOf("--target") + 2)).toEqual(["--target", "bun-windows-x64"]);
    expect(args).toContain("--no-compile-autoload-dotenv");
    expect(args).toContain("--no-compile-autoload-bunfig");
    expect(args).not.toContain("--compile-autoload-dotenv");
    expect(args).not.toContain("--compile-autoload-bunfig");
  });

  test("bakes the release version in as a string define and writes only the named outfile", () => {
    expect(args[args.indexOf("--define") + 1]).toBe('WACHIMAN_VERSION="1.10.0"');
    expect(args.slice(-2)).toEqual(["--outfile", "out/wachiman.exe"]);
  });

  test("embeds the files under their repository-relative names: the CLI entry first, then every skill file", () => {
    expect(args).toContain("--asset-naming=[dir]/[name].[ext]");
    expect(args.slice(args.indexOf("--root"), args.indexOf("--root") + 2)).toEqual(["--root", "."]);
    expect(args.slice(args.indexOf("src/cli.ts"), args.indexOf("src/cli.ts") + 2)).toEqual(["src/cli.ts", "skills/a/SKILL.md"]);
  });

  test("no target means this machine, and a version that could smuggle an argument or a quote is refused", () => {
    expect(buildArgs({ outfile: "o", version: "1.0.0", skillFiles: [] })).not.toContain("--target");
    for (const bad of ["", '1.0.0"', "1.0.0 --x", "--version", "$(x)"]) {
      expect(() => buildArgs({ outfile: "o", version: bad, skillFiles: [] })).toThrow(/not a release version/);
    }
  });
});

describe("the repository", () => {
  test("lists the skill files with forward slashes in a stable order", () => {
    const files = skillFilesOf(root);
    expect(files).toContain("skills/wachiman-review/SKILL.md");
    expect(files.every((f) => f.startsWith("skills/") && !f.includes("\\"))).toBe(true);
    expect(files).toEqual([...files].sort());
  });

  test("the version it would build is the package's", () => {
    expect(packageVersion(root)).toMatch(/^\d+\.\d+\.\d+/);
  });
});
