/**
 * The packed tarball, installed the way a user installs it (`npm i -g <file>`), with no registry
 * for the package: `scripts/verify-package.sh` does the work and CI runs the same script in a
 * clean Node container. The tarball is installed without its dependencies (an install with
 * `--ignore-scripts` leaves a stub where Bun should be, and the terminal-screen packages are copied
 * from this checkout's node_modules, so `bun install` must have run), so these checks need no network. The real dependency is
 * checked by `--bundled-bun`, which needs the registry and runs in CI only. Here it runs on POSIX
 * machines that have bash, node, npm, tar and bun; on Windows the dedicated CI job runs the
 * launcher tests and an install of the tarball instead.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "..", "scripts", "verify-package.sh");
const tools = ["bash", "node", "npm", "tar", "bun"].every((tool) => Bun.which(tool));
// The script copies the terminal-screen packages from this checkout, so a clone that never ran `bun install` skips it.
const installed = ["chalk", "@clack/prompts"].every((pkg) => existsSync(join(import.meta.dir, "..", "node_modules", pkg, "package.json")));

function run(args: string[], cwd?: string) {
  const out = Bun.spawnSync(["bash", script, ...args], { cwd, env: { ...process.env, npm_config_offline: "" } });
  return { code: out.exitCode, stdout: out.stdout.toString(), stderr: out.stderr.toString() };
}

describe.skipIf(!tools || !installed || process.platform === "win32")("scripts/verify-package.sh", () => {
  test("with Bun: version, npm exec from the installed copy, doctor on fixture dependencies, isolation", () => {
    const r = run([]);
    expect(r.stderr).not.toContain("FAIL");
    expect(r.code).toBe(0);
    for (const line of ["wachiman --version ->", "bundled Bun is a stub, so the Bun on PATH ran", "terminal screens: chalk and @clack/prompts load from the installed copy and NO_COLOR is honored", "npm exec -- wachiman --version from the installed copy", "wachiman doctor --json against fixture dependencies", "did not reach the engine"]) {
      expect(r.stdout).toContain(line);
    }
  }, 180_000);

  test("without Bun, bundled missing or a stub: exit 2 and the install line", () => {
    const r = run(["--without-bun"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("without Bun (no bundled Bun): exit 2 and the line: wachiman needs Bun 1.3 or later: https://bun.sh");
    expect(r.stdout).toContain("without Bun (a stub bundled Bun): exit 2 and the line: wachiman needs Bun 1.3 or later: https://bun.sh");
  }, 120_000);

  test("a relative --tarball, as the release workflow passes it, is found after the script changes directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "wachiman-relative-tarball-"));
    mkdirSync(join(dir, "dist"));
    try {
      const packed = Bun.spawnSync(["npm", "pack", "--pack-destination", join(dir, "dist"), "--ignore-scripts", "--json"], { cwd: join(import.meta.dir, "..") });
      expect(packed.exitCode).toBe(0);
      const name = JSON.parse(packed.stdout.toString())[0].filename as string;
      const r = run(["--tarball", join("dist", name), "--without-bun"], dir);
      expect(r.stderr).not.toContain("FAIL");
      expect(r.code).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
