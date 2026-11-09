/**
 * The packed tarball, installed the way a user installs it (`npm i -g <file>`), with no registry
 * for the package: `scripts/verify-package.sh` does the work and CI runs the same script in a
 * clean Node container. Here it runs on POSIX machines that have bash, node, npm and bun; on
 * Windows the dedicated CI job runs the launcher tests and an install of the tarball instead.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const script = join(import.meta.dir, "..", "scripts", "verify-package.sh");
const tools = ["bash", "node", "npm", "bun"].every((tool) => Bun.which(tool));

function run(args: string[]) {
  const out = Bun.spawnSync(["bash", script, ...args], { env: { ...process.env, npm_config_offline: "" } });
  return { code: out.exitCode, stdout: out.stdout.toString(), stderr: out.stderr.toString() };
}

describe.skipIf(!tools || process.platform === "win32")("scripts/verify-package.sh", () => {
  test("with Bun: version, npm exec from the installed copy, doctor on fixture dependencies, isolation", () => {
    const r = run([]);
    expect(r.stderr).not.toContain("FAIL");
    expect(r.code).toBe(0);
    for (const line of ["wachiman --version ->", "agent-review --version ->", "npm exec -- wachiman --version from the installed copy", "wachiman doctor --json against fixture dependencies", "did not reach the engine"]) {
      expect(r.stdout).toContain(line);
    }
  }, 180_000);

  test("without Bun: exit 2 and the install line", () => {
    const r = run(["--without-bun"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("without Bun: exit 2 and the line: wachiman needs Bun 1.3 or later: https://bun.sh");
  }, 120_000);
});
