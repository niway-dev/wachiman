/**
 * `skills install|uninstall` through the real entry point, in a child process whose HOME and
 * WACHIMAN_HOME are temporary directories. The skills copied are the repository's own.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const cli = join(import.meta.dir, "cli.ts");
const repoSkills = join(import.meta.dir, "..", "skills");
const scratch: string[] = [];
afterAll(() => scratch.forEach((d) => rmSync(d, { recursive: true, force: true })));

function machine() {
  const userHome = realpathSync(mkdtempSync(join(tmpdir(), "wachiman-cli-skills-")));
  scratch.push(userHome);
  mkdirSync(join(userHome, ".claude"));
  const env: Record<string, string> = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: userHome, USER: "dev" };
  const run = (args: string[], extra: Record<string, string> = {}) => {
    const out = Bun.spawnSync([process.execPath, cli, ...args], { env: { ...env, ...extra }, stdin: "ignore", cwd: userHome });
    return { code: out.exitCode, stdout: out.stdout.toString(), stderr: out.stderr.toString() };
  };
  return { userHome, run };
}

describe("skills through the CLI", () => {
  test("install copies the repository's skills into the fixture home, byte for byte, and exits 0", () => {
    const m = machine();
    const out = m.run(["skills", "install"]);
    expect(out.code).toBe(0);
    for (const dir of [".agents", ".claude"]) {
      for (const name of ["wachiman-review", "wachiman-audit"]) {
        const copy = join(m.userHome, dir, "skills", name);
        expect(readFileSync(join(copy, "SKILL.md"), "utf8")).toBe(readFileSync(join(repoSkills, name, "SKILL.md"), "utf8"));
        expect(lstatSync(copy).isSymbolicLink()).toBe(false);
        expect(JSON.parse(readFileSync(join(copy, ".wachiman-skill.json"), "utf8")).version).toMatch(/^\d+\.\d+\.\d+/);
        expect(out.stdout).toContain(`installed ${copy}\n`);
      }
    }
  });

  test("a Wachiman home that holds a target is refused with exit 2 and nothing is written", () => {
    const m = machine();
    const out = m.run(["skills", "install", "--dir", join(m.userHome, ".wachiman", "skills")]);
    expect(out.code).toBe(2);
    expect(out.stderr).toContain("under the Wachiman home");
    expect(existsSync(join(m.userHome, ".agents"))).toBe(false);
    expect(existsSync(join(m.userHome, ".claude", "skills"))).toBe(false);
    // WACHIMAN_HOME moves the protected directory.
    const custom = join(m.userHome, "elsewhere");
    const moved = m.run(["skills", "install", "--dir", join(custom, "skills")], { WACHIMAN_HOME: custom });
    expect(moved.code).toBe(2);
    expect(existsSync(join(custom, "skills"))).toBe(false);
  });

  test("a copy without a marker is left with a warning on stderr and the run still exits 0", () => {
    const m = machine();
    const own = join(m.userHome, ".claude", "skills", "wachiman-review");
    mkdirSync(own, { recursive: true });
    writeFileSync(join(own, "SKILL.md"), "mine\n");
    const out = m.run(["skills", "install"]);
    expect(out.code).toBe(0);
    expect(readFileSync(join(own, "SKILL.md"), "utf8")).toBe("mine\n");
    expect(out.stderr).toContain(`left ${own} in place`);
    expect(out.stdout).not.toContain(own);
  });

  test("uninstall removes what install put there and nothing else; --json install prints one document", () => {
    const m = machine();
    const other = join(m.userHome, ".claude", "skills", "someone-elses");
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, "SKILL.md"), "theirs\n");
    const json = m.run(["skills", "install", "--json"]);
    expect(JSON.parse(json.stdout)).toMatchObject({ format: "wachiman.skills/1", exitCode: 0 });
    expect(m.run(["skills", "uninstall"]).code).toBe(0);
    expect(readdirSync(join(m.userHome, ".claude", "skills"))).toEqual(["someone-elses"]);
    expect(readFileSync(join(other, "SKILL.md"), "utf8")).toBe("theirs\n");
    expect(readdirSync(join(m.userHome, ".agents", "skills"))).toEqual([]);
  });

  test("usage errors exit 2, and --help exits 0 without touching the home", () => {
    const m = machine();
    expect(m.run(["skills"]).code).toBe(2);
    expect(m.run(["skills", "frob"]).code).toBe(2);
    expect(m.run(["skills", "uninstall", "--json"]).code).toBe(2);
    expect(m.run(["skills", "install", "--repo-dir", m.userHome]).code).toBe(2);
    const help = m.run(["skills", "install", "--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("wachiman skills install");
    expect(existsSync(join(m.userHome, ".agents"))).toBe(false);
  });
});
