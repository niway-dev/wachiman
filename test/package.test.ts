/**
 * What `npm publish` would upload, checked from `npm pack --dry-run --json` (no tarball is written,
 * no registry is contacted): the source tree is not the package, so the packed file list is.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const npm = Bun.which("npm");

function packedFiles(): string[] {
  // On Windows npm is `npm.cmd`, which only a shell can start.
  const command = process.platform === "win32" ? ["cmd.exe", "/d", "/s", "/c", "npm"] : [npm!];
  const out = Bun.spawnSync([...command, "pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, env: { ...process.env, npm_config_offline: "true" } });
  expect(out.exitCode).toBe(0);
  const [report] = JSON.parse(out.stdout.toString());
  return report.files.map((f: { path: string }) => f.path.replaceAll("\\", "/"));
}

describe("package.json", () => {
  test("is the public package wachiman whose bins are the Node launcher", () => {
    expect(pkg.name).toBe("wachiman");
    expect(pkg.private).toBe(false);
    expect(pkg.bin).toEqual({ wachiman: "bin/wachiman.js", "agent-review": "bin/wachiman.js" });
    expect(pkg.type).toBe("module");
  });

  test("requires Bun 1.3 and a Node that can run the launcher", () => {
    expect(pkg.engines).toEqual({ bun: ">=1.3", node: ">=18" });
  });

  test("has no runtime dependency of any kind (ADR 0002)", () => {
    for (const key of ["dependencies", "optionalDependencies", "peerDependencies", "bundledDependencies", "bundleDependencies"]) expect(pkg[key]).toBeUndefined();
  });

  test("publishes publicly with provenance and runs no install-time script", () => {
    expect(pkg.publishConfig).toEqual({ access: "public", provenance: true });
    for (const hook of ["preinstall", "install", "postinstall", "prepare", "prepublishOnly", "prepack", "postpack"]) expect(pkg.scripts?.[hook]).toBeUndefined();
  });

  test("every bin exists, is a Node script, and the shipped launcher module is listed in files", () => {
    for (const path of Object.values<string>(pkg.bin)) expect(readFileSync(join(root, path), "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(pkg.files).toContain("bin/launcher-args.js");
  });
});

describe.skipIf(!npm)("npm pack --json", () => {
  const files = packedFiles();

  test("ships the launcher, the engine, the skills, the templates, bunfig.toml, the licence and the manifest", () => {
    for (const path of ["package.json", "bin/wachiman.js", "bin/launcher-args.js", "src/cli.ts", "src/install-kind.ts", "src/providers/claude-code.settings.json", "bunfig.toml", "LICENSE", "README.md"]) {
      expect(files).toContain(path);
    }
    expect(files.some((f) => f.startsWith("skills/wachiman-review/"))).toBe(true);
    expect(files.some((f) => f.startsWith("skills/wachiman-audit/"))).toBe(true);
    expect(files).toContain("templates/wachiman-review-caller.yml");
  });

  test("no test file, fixture, document, workflow, script or dependency tree is shipped", () => {
    const bad = files.filter((f) => /\.test\.ts$/.test(f) || /(^|\/)(node_modules|test|docs|fixtures|\.github|scripts|\.claude)\//.test(f));
    expect(bad).toEqual([]);
  });

  test("everything shipped is under an allowed top-level entry", () => {
    const allowed = new Set(["package.json", "bunfig.toml", "LICENSE", "README.md", "CHANGELOG.md"]);
    const stray = files.filter((f) => !allowed.has(f) && !/^(bin|src|skills|templates)\//.test(f));
    expect(stray).toEqual([]);
  });

  test("the bin entries are among the packed files", () => {
    for (const path of Object.values<string>(pkg.bin)) expect(files).toContain(path);
  });
});
