/**
 * `skills install|uninstall` on a fixture home: a temporary user home, Wachiman home and Claude
 * configuration directories, and a fixture copy of the two skills. Nothing here reads or writes
 * the real home.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { UsageError } from "../config";
import { MARKER_FILE, SKILL_NAMES, installSkills, parseSkillsArgs, runSkills, type SkillsDeps } from "./install";

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

describe("skills install: copies it does not own", () => {
  const only = (f: ReturnType<typeof fixture>) => installSkills({ action: "install", dirs: [] }, f.env, f.deps);

  test("a copy without a marker is left as it is and warned about, and the other copies are still installed", () => {
    const f = fixture();
    const own = join(f.userHome, ".claude", "skills", "wachiman-review");
    mkdirSync(own, { recursive: true });
    writeFileSync(join(own, "SKILL.md"), "my own edited skill\n");
    const report = only(f);

    expect(readFileSync(join(own, "SKILL.md"), "utf8")).toBe("my own edited skill\n");
    expect(readdirSync(own)).toEqual(["SKILL.md"]);
    const entry = report.entries.find((e) => e.target === own)!;
    expect(entry.action).toBe("preserved");
    expect(entry.reason).toContain("no ownership marker");
    expect(f.warnings.filter((w) => w.includes(own))).toHaveLength(1);
    expect(f.warnings[0]).toMatch(/^left .* in place: /);
    expect(existsSync(join(f.userHome, ".claude", "skills", "wachiman-audit", MARKER_FILE))).toBe(true);
    expect(existsSync(join(f.userHome, ".agents", "skills", "wachiman-review", MARKER_FILE))).toBe(true);
    expect(report.exitCode).toBe(0);
  });

  test("a symlink where the copy goes (the contributor link of install-local.sh) is left and warned, never followed", () => {
    const f = fixture();
    const clone = temp("wachiman-clone-skill-");
    writeFileSync(join(clone, "SKILL.md"), "the contributor's clone\n");
    const link = join(f.userHome, ".claude", "skills", "wachiman-review");
    mkdirSync(join(f.userHome, ".claude", "skills"));
    symlinkSync(clone, link);
    const report = only(f);

    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readdirSync(clone)).toEqual(["SKILL.md"]);
    expect(readFileSync(join(clone, "SKILL.md"), "utf8")).toBe("the contributor's clone\n");
    expect(report.entries.find((e) => e.target === link)!.action).toBe("preserved");
    expect(f.warnings.some((w) => w.includes(link))).toBe(true);
  });

  test("a plain file where the copy goes is left and warned", () => {
    const f = fixture();
    const target = join(f.userHome, ".agents", "skills", "wachiman-audit");
    mkdirSync(join(f.userHome, ".agents", "skills"), { recursive: true });
    writeFileSync(target, "a file\n");
    only(f);
    expect(readFileSync(target, "utf8")).toBe("a file\n");
    expect(f.warnings.some((w) => w.includes(target))).toBe(true);
  });

  test("a marker that is not ours (wrong format, unsafe path) counts as no marker", () => {
    const f = fixture();
    const copy = join(f.userHome, ".agents", "skills", "wachiman-review");
    mkdirSync(copy, { recursive: true });
    writeFileSync(join(copy, "SKILL.md"), "mine\n");
    writeFileSync(join(copy, MARKER_FILE), JSON.stringify({ format: "wachiman.skill-install/1", version: "1", installedAt: "x", files: { "../escape.md": "00" } }));
    only(f);
    expect(readFileSync(join(copy, "SKILL.md"), "utf8")).toBe("mine\n");
    expect(f.warnings.some((w) => w.includes(copy))).toBe(true);
  });

  test("an unmodified marked copy is replaced by the new version, and a file the new version dropped is removed", () => {
    const f = fixture();
    only(f);
    const copy = join(f.userHome, ".claude", "skills", "wachiman-review");
    writeFileSync(join(f.source, "wachiman-review", "SKILL.md"), "# wachiman-review v2\n");
    rmSync(join(f.source, "wachiman-review", "references"), { recursive: true });
    const report = installSkills({ action: "install", dirs: [] }, f.env, { ...f.deps, version: "10.0.0" });

    expect(readFileSync(join(copy, "SKILL.md"), "utf8")).toBe("# wachiman-review v2\n");
    expect(existsSync(join(copy, "references", "notes.md"))).toBe(false);
    expect(JSON.parse(readFileSync(join(copy, MARKER_FILE), "utf8")).version).toBe("10.0.0");
    expect(report.entries.find((e) => e.target === copy)!.action).toBe("installed");
    expect(f.warnings).toEqual([]);
  });

  test("a locally modified marked copy is left in place with a warning", () => {
    const f = fixture();
    only(f);
    const copy = join(f.userHome, ".claude", "skills", "wachiman-review");
    writeFileSync(join(copy, "SKILL.md"), "# edited by me\n");
    writeFileSync(join(f.source, "wachiman-review", "SKILL.md"), "# wachiman-review v2\n");
    const report = only(f);

    expect(readFileSync(join(copy, "SKILL.md"), "utf8")).toBe("# edited by me\n");
    expect(readFileSync(join(copy, "references", "notes.md"), "utf8")).toBe("notes of wachiman-review\n");
    const entry = report.entries.find((e) => e.target === copy)!;
    expect(entry.action).toBe("preserved");
    expect(entry.reason).toContain("SKILL.md");
    expect(f.warnings.some((w) => w.includes(copy) && w.includes("modified"))).toBe(true);
    // The unmodified sibling copies were replaced.
    expect(readFileSync(join(f.userHome, ".agents", "skills", "wachiman-review", "SKILL.md"), "utf8")).toBe("# wachiman-review v2\n");
  });

  test("an unrecognised file the user added to a marked copy survives a reinstall", () => {
    const f = fixture();
    only(f);
    const copy = join(f.userHome, ".claude", "skills", "wachiman-review");
    writeFileSync(join(copy, "MY-NOTES.md"), "keep me\n");
    only(f);
    expect(readFileSync(join(copy, "MY-NOTES.md"), "utf8")).toBe("keep me\n");
  });

  test("a marked file replaced by a symlink counts as modified and is not written through", () => {
    const f = fixture();
    only(f);
    const copy = join(f.userHome, ".claude", "skills", "wachiman-review");
    const outside = join(temp("outside-"), "victim.md");
    writeFileSync(outside, "outside\n");
    rmSync(join(copy, "SKILL.md"));
    symlinkSync(outside, join(copy, "SKILL.md"));
    const report = only(f);
    expect(readFileSync(outside, "utf8")).toBe("outside\n");
    expect(report.entries.find((e) => e.target === copy)!.action).toBe("preserved");
  });

  test("a user file the old marker does not list is never overwritten by a version that ships that path", () => {
    const f = fixture();
    only(f);
    const copy = join(f.userHome, ".claude", "skills", "wachiman-review");
    writeFileSync(join(copy, "notes.md"), "my notes\n");
    writeFileSync(join(f.source, "wachiman-review", "notes.md"), "shipped notes\n");
    writeFileSync(join(f.source, "wachiman-review", "SKILL.md"), "# v2\n");
    const report = only(f);

    expect(readFileSync(join(copy, "notes.md"), "utf8")).toBe("my notes\n");
    expect(readFileSync(join(copy, "SKILL.md"), "utf8")).toBe("# wachiman-review\n");
    const entry = report.entries.find((e) => e.target === copy)!;
    expect(entry.action).toBe("preserved");
    expect(entry.reason).toContain("notes.md");
  });

  test("a user symlink where the new version ships a file is not replaced", () => {
    const f = fixture();
    only(f);
    const copy = join(f.userHome, ".claude", "skills", "wachiman-review");
    const outside = join(temp("outside-"), "victim.md");
    writeFileSync(outside, "outside\n");
    symlinkSync(outside, join(copy, "notes.md"));
    writeFileSync(join(f.source, "wachiman-review", "notes.md"), "shipped notes\n");
    const report = only(f);

    expect(lstatSync(join(copy, "notes.md")).isSymbolicLink()).toBe(true);
    expect(readFileSync(outside, "utf8")).toBe("outside\n");
    const entry = report.entries.find((e) => e.target === copy)!;
    expect(entry.action).toBe("preserved");
    expect(entry.reason).toContain("notes.md");
  });
});

describe("skills uninstall: only what it installed", () => {
  const install = (f: ReturnType<typeof fixture>) => installSkills({ action: "install", dirs: [] }, f.env, f.deps);
  const uninstall = (f: ReturnType<typeof fixture>) => installSkills({ action: "uninstall", dirs: [] }, f.env, f.deps);

  test("marked copies are removed, with their empty directories, and the skills directory itself stays", () => {
    const f = fixture();
    install(f);
    const report = uninstall(f);
    for (const dir of [".agents", ".claude", ".claude-work"]) {
      for (const name of SKILL_NAMES) expect(existsSync(join(f.userHome, dir, "skills", name))).toBe(false);
      expect(existsSync(join(f.userHome, dir, "skills"))).toBe(true);
    }
    expect(report.entries.every((e) => e.action === "removed")).toBe(true);
    expect(report.entries).toHaveLength(3 * SKILL_NAMES.length);
    expect(report.exitCode).toBe(0);
    expect(f.warnings).toEqual([]);
  });

  test("a copy without a marker is not removed, whatever its name, and is warned about", () => {
    const f = fixture();
    install(f);
    const unmarked = join(f.userHome, ".claude", "skills", "wachiman-review");
    rmSync(join(unmarked, MARKER_FILE));
    const report = uninstall(f);

    expect(readFileSync(join(unmarked, "SKILL.md"), "utf8")).toBe("# wachiman-review\n");
    expect(report.entries.find((e) => e.target === unmarked)!.action).toBe("preserved");
    expect(f.warnings.some((w) => w.includes(unmarked))).toBe(true);
    expect(existsSync(join(f.userHome, ".agents", "skills", "wachiman-review"))).toBe(false);
    expect(existsSync(join(f.userHome, ".claude", "skills", "wachiman-audit"))).toBe(false);
  });

  test("a symlink is never followed or removed", () => {
    const f = fixture();
    const clone = temp("wachiman-clone-skill-");
    writeFileSync(join(clone, "SKILL.md"), "the clone\n");
    mkdirSync(join(f.userHome, ".claude", "skills"));
    symlinkSync(clone, join(f.userHome, ".claude", "skills", "wachiman-review"));
    uninstall(f);
    expect(lstatSync(join(f.userHome, ".claude", "skills", "wachiman-review")).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(clone, "SKILL.md"), "utf8")).toBe("the clone\n");
    expect(f.warnings.some((w) => w.includes("symlink"))).toBe(true);
  });

  test("a marked copy a symlink was swapped into is not followed: the symlinked file is kept, nothing outside is touched", () => {
    const f = fixture();
    install(f);
    const copy = join(f.userHome, ".claude", "skills", "wachiman-review");
    const outside = join(temp("outside-"), "victim.md");
    writeFileSync(outside, "outside\n");
    rmSync(join(copy, "references"), { recursive: true });
    symlinkSync(dirname(outside), join(copy, "references"));
    uninstall(f);
    expect(readFileSync(outside, "utf8")).toBe("outside\n");
    expect(lstatSync(join(copy, "references")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(copy, "SKILL.md"))).toBe(false);
  });

  test("an edited file and an unrecognised file in a marked copy are kept with a warning; untouched files go", () => {
    const f = fixture();
    install(f);
    const copy = join(f.userHome, ".claude", "skills", "wachiman-review");
    writeFileSync(join(copy, "SKILL.md"), "# my edits\n");
    writeFileSync(join(copy, "MY-NOTES.md"), "mine\n");
    const report = uninstall(f);

    expect(readFileSync(join(copy, "SKILL.md"), "utf8")).toBe("# my edits\n");
    expect(readFileSync(join(copy, "MY-NOTES.md"), "utf8")).toBe("mine\n");
    expect(existsSync(join(copy, "references"))).toBe(false);
    expect(report.entries.find((e) => e.target === copy)!.action).toBe("preserved");
    expect(f.warnings.some((w) => w.includes(copy) && w.includes("SKILL.md"))).toBe(true);
    // A second uninstall after the user reverts nothing still preserves the edit, and still removes nothing else.
    const again = uninstall(f);
    expect(again.entries.find((e) => e.target === copy)!.action).toBe("preserved");
    expect(readFileSync(join(copy, "SKILL.md"), "utf8")).toBe("# my edits\n");
  });

  test("an unrecognised file alone keeps the directory but the copy still counts as removed, with a warning", () => {
    const f = fixture();
    install(f);
    const copy = join(f.userHome, ".agents", "skills", "wachiman-audit");
    writeFileSync(join(copy, "MY-NOTES.md"), "mine\n");
    const report = uninstall(f);
    expect(readdirSync(copy)).toEqual(["MY-NOTES.md"]);
    const entry = report.entries.find((e) => e.target === copy)!;
    expect(entry.action).toBe("removed");
    expect(entry.reason).toContain("MY-NOTES.md");
  });

  test("a skills directory with nothing installed in it is left alone and nothing is reported for it", () => {
    const f = fixture();
    mkdirSync(join(f.userHome, ".claude", "skills", "someone-elses-skill"), { recursive: true });
    const report = uninstall(f);
    expect(report.entries).toEqual([]);
    expect(existsSync(join(f.userHome, ".claude", "skills", "someone-elses-skill"))).toBe(true);
    expect(existsSync(join(f.userHome, ".agents"))).toBe(false);
  });
});

describe("skills command line", () => {
  test("--dir repeats, --json belongs to install, and every other shape is a usage error", () => {
    expect(parseSkillsArgs(["install", "--dir", "/a", "--dir=/b", "--json"])).toEqual({ action: "install", dirs: ["/a", "/b"], json: true });
    expect(parseSkillsArgs(["uninstall", "--dir", "/a"])).toEqual({ action: "uninstall", dirs: ["/a"], json: false });
    expect(parseSkillsArgs(["install"])).toEqual({ action: "install", dirs: [], json: false });
    expect(parseSkillsArgs(["install", "--help"])).toEqual({ help: true });
    expect(parseSkillsArgs(["--help"])).toEqual({ help: true });
    for (const bad of [[], ["frob"], ["install", "extra"], ["install", "--dir"], ["install", "--dir="], ["install", "--dir", "--json"], ["uninstall", "--json"], ["install", "--json=1"], ["install", "--force"]]) {
      expect(() => parseSkillsArgs(bad)).toThrow(UsageError);
    }
  });

  test("runSkills prints one line per installed copy on stdout and warnings on stderr; --json prints exactly one document", () => {
    const f = fixture();
    const own = join(f.userHome, ".claude", "skills", "wachiman-review");
    mkdirSync(own, { recursive: true });
    const out: string[] = [];
    const err: string[] = [];
    const io = { stdout: (t: string) => out.push(t), stderr: (l: string) => err.push(l) };
    expect(runSkills({ action: "install", dirs: [], json: false }, f.env, io, f.deps)).toBe(0);
    expect(out.join("")).toContain(`installed ${join(f.userHome, ".agents", "skills", "wachiman-review")}\n`);
    expect(out.join("")).not.toContain(own);
    expect(err.some((l) => l.includes(own))).toBe(true);

    out.length = 0;
    expect(runSkills({ action: "install", dirs: [], json: true }, f.env, io, f.deps)).toBe(0);
    const doc = JSON.parse(out.join(""));
    expect(doc.format).toBe("wachiman.skills/1");
    expect(doc.entries.find((e: { target: string }) => e.target === own)).toMatchObject({ action: "preserved" });
  });
});
