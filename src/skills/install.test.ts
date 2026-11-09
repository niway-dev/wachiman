/**
 * `skills install|uninstall` on a fixture home: a temporary user home, Wachiman home and Claude
 * configuration directories, and a fixture copy of the two skills. Nothing here reads or writes
 * the real home.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageError } from "../config";
import { MARKER_FILE, SKILL_NAMES, installSkills, type SkillsDeps } from "./install";

const scratch: string[] = [];
const temp = (prefix: string) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  scratch.push(dir);
  return dir;
};
afterAll(() => scratch.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A user home with `.claude`, `.claude-work` and a file named `.claude-notes`, plus a source tree with both skills. */
function fixture() {
  const userHome = temp("wachiman-skills-home-");
  const source = temp("wachiman-skills-src-");
  for (const name of SKILL_NAMES) {
    mkdirSync(join(source, name, "references"), { recursive: true });
    writeFileSync(join(source, name, "SKILL.md"), `# ${name}\n`);
    writeFileSync(join(source, name, "references", "notes.md"), `notes of ${name}\n`);
  }
  mkdirSync(join(userHome, ".claude"));
  mkdirSync(join(userHome, ".claude-work"));
  writeFileSync(join(userHome, ".claude-notes"), "not a directory\n");
  const wachimanHome = join(userHome, ".wachiman");
  const env: Record<string, string | undefined> = { WACHIMAN_HOME: wachimanHome };
  const warnings: string[] = [];
  const deps: SkillsDeps = {
    userHome,
    sourceDir: source,
    version: "9.9.9",
    now: () => new Date("2026-11-09T12:00:00.000Z"),
    warn: (line) => warnings.push(line),
  };
  return { userHome, source, wachimanHome, env, warnings, deps };
}

describe("skills install: where the copies land", () => {
  test("both skills are copied, not linked, into every target directory of the fixture home", () => {
    const f = fixture();
    const configDir = temp("claude-config-dir-");
    const extra = join(temp("wachiman-skills-extra-"), "my-skills");
    const report = installSkills({ action: "install", dirs: [extra] }, { ...f.env, CLAUDE_CONFIG_DIR: configDir }, f.deps);

    const targets = [
      join(f.userHome, ".agents", "skills"),
      join(f.userHome, ".claude", "skills"),
      join(f.userHome, ".claude-work", "skills"),
      join(configDir, "skills"),
      extra,
    ];
    for (const target of targets) {
      for (const name of SKILL_NAMES) {
        const copy = join(target, name);
        expect(lstatSync(copy).isDirectory()).toBe(true);
        expect(readFileSync(join(copy, "SKILL.md"), "utf8")).toBe(`# ${name}\n`);
        expect(readFileSync(join(copy, "references", "notes.md"), "utf8")).toBe(`notes of ${name}\n`);
        const marker = JSON.parse(readFileSync(join(copy, MARKER_FILE), "utf8"));
        expect(marker.format).toBe("wachiman.skill-install/1");
        expect(marker.version).toBe("9.9.9");
        expect(marker.installedAt).toBe("2026-11-09T12:00:00.000Z");
        expect(Object.keys(marker.files).sort()).toEqual(["SKILL.md", "references/notes.md"]);
        expect(marker.files["SKILL.md"]).toMatch(/^[0-9a-f]{64}$/);
      }
    }
    expect(report.entries.filter((e) => e.action === "installed")).toHaveLength(targets.length * SKILL_NAMES.length);
    expect(report.exitCode).toBe(0);
    // Nothing else: no `.claude-notes/skills` (a file, not a directory) and no new `~/.claude-*`.
    expect(readdirSync(f.userHome).sort()).toEqual([".agents", ".claude", ".claude-notes", ".claude-work"]);
    expect(f.warnings).toEqual([]);
  });

  test("a Claude directory that does not exist is not created", () => {
    const f = fixture();
    rmSync(join(f.userHome, ".claude"), { recursive: true });
    installSkills({ action: "install", dirs: [] }, f.env, f.deps);
    expect(existsSync(join(f.userHome, ".claude"))).toBe(false);
    expect(existsSync(join(f.userHome, ".agents", "skills", "wachiman-review", "SKILL.md"))).toBe(true);
  });

  test("a CLAUDE_CONFIG_DIR that is not an existing directory is skipped", () => {
    const f = fixture();
    const missing = join(f.userHome, "nowhere");
    installSkills({ action: "install", dirs: [] }, { ...f.env, CLAUDE_CONFIG_DIR: missing }, f.deps);
    expect(existsSync(missing)).toBe(false);
  });

  test("a target named twice (CLAUDE_CONFIG_DIR is ~/.claude, plus --dir) is copied once", () => {
    const f = fixture();
    const report = installSkills({ action: "install", dirs: [join(f.userHome, ".claude", "skills")] }, { ...f.env, CLAUDE_CONFIG_DIR: join(f.userHome, ".claude") }, f.deps);
    const claude = report.entries.filter((e) => e.target.startsWith(join(f.userHome, ".claude", "skills")));
    expect(claude).toHaveLength(SKILL_NAMES.length);
  });
});

/** Every path under `dir`, so a refusal can be shown to have written nothing. */
function tree(dir: string, prefix = ""): string[] {
  return readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap((e) => {
    const rel = prefix === "" ? e.name : `${prefix}/${e.name}`;
    return e.isDirectory() ? [rel, ...tree(dir, rel)] : [rel];
  });
}

describe("skills install: the Wachiman home is refused", () => {
  const refuses = (f: ReturnType<typeof fixture>, opts: Parameters<typeof installSkills>[0], env = f.env, action: "install" | "uninstall" = "install") => {
    let error: unknown;
    try {
      installSkills({ ...opts, action }, env, f.deps);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(UsageError);
    return (error as UsageError).message;
  };

  test("a --dir under ~/.wachiman is refused and nothing is written in any other target", () => {
    const f = fixture();
    mkdirSync(f.wachimanHome);
    const before = tree(f.userHome);
    const message = refuses(f, { action: "install", dirs: [join(f.wachimanHome, "claude-isolated", "skills")] });
    expect(message).toContain(f.wachimanHome);
    expect(tree(f.userHome)).toEqual(before);
  });

  test("the Wachiman home itself is refused, and so is a CLAUDE_CONFIG_DIR that is a managed profile", () => {
    const f = fixture();
    mkdirSync(join(f.wachimanHome, "claude-isolated"), { recursive: true });
    const before = tree(f.userHome);
    refuses(f, { action: "install", dirs: [f.wachimanHome] });
    refuses(f, { action: "install", dirs: [] }, { ...f.env, CLAUDE_CONFIG_DIR: join(f.wachimanHome, "claude-isolated") });
    expect(tree(f.userHome)).toEqual(before);
  });

  test("WACHIMAN_HOME moves the protected directory; the default ~/.wachiman is then an ordinary path", () => {
    const f = fixture();
    const custom = temp("custom-wachiman-home-");
    refuses(f, { action: "install", dirs: [join(custom, "skills")] }, { WACHIMAN_HOME: custom });
    const report = installSkills({ action: "install", dirs: [join(f.userHome, ".wachiman", "skills")] }, { WACHIMAN_HOME: custom }, f.deps);
    expect(report.exitCode).toBe(0);
  });

  test("a skills directory that is a symlink into ~/.wachiman is refused", () => {
    const f = fixture();
    mkdirSync(join(f.wachimanHome, "claude-isolated"), { recursive: true });
    symlinkSync(join(f.wachimanHome, "claude-isolated"), join(f.userHome, ".claude", "skills"));
    const before = tree(join(f.wachimanHome));
    refuses(f, { action: "install", dirs: [] });
    expect(tree(f.wachimanHome)).toEqual(before);
    expect(existsSync(join(f.userHome, ".agents"))).toBe(false);
  });

  test("a not-yet-existing path below a symlink into ~/.wachiman is refused too", () => {
    const f = fixture();
    mkdirSync(f.wachimanHome);
    const link = join(f.userHome, "alias");
    symlinkSync(f.wachimanHome, link);
    refuses(f, { action: "install", dirs: [join(link, "deep", "skills")] });
    expect(tree(f.wachimanHome)).toEqual([]);
  });

  test("uninstall refuses the same targets", () => {
    const f = fixture();
    refuses(f, { action: "uninstall", dirs: [join(f.wachimanHome, "skills")] }, f.env, "uninstall");
  });
});
