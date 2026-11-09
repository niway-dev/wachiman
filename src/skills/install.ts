/**
 * `wachiman skills install|uninstall`: copies the two agent skills into the directories where
 * coding agents look for them, marks each copy so it can be told from anyone else's, and removes
 * only what it installed (command contract section 5.9).
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";

export const SKILL_NAMES = ["wachiman-review", "wachiman-audit"] as const;
export const MARKER_FILE = ".wachiman-skill.json";

export interface SkillsOptions { action: "install" | "uninstall"; dirs: string[]; json: boolean }
export interface SkillInstallReport {
  format: "wachiman.skills/1";
  entries: { target: string; action: "installed" | "removed" | "preserved" | "failed"; reason?: string }[];
  exitCode: 0 | 1;
}
interface SkillInstallMarker {
  format: "wachiman.skill-install/1";
  version: string;
  installedAt: string;
  files: Record<string, string>;
}

export interface SkillsDeps {
  userHome?: string;
  /** The directory that holds `wachiman-review/` and `wachiman-audit/`. */
  sourceDir?: string;
  version?: string;
  now?: () => Date;
  warn?: (line: string) => void;
}

/** Where the skills are read from: the package or clone root. The one place to swap for the embedded assets. */
export function skillsSourceDir() {
  return join(import.meta.dir, "..", "..", "skills");
}

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

/** Every regular file under `dir`, as `/`-separated relative paths. Symlinks and special files are skipped. */
function listFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listFiles(dir, rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out.sort();
}

const isDirectory = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** The skills directories to fill: `~/.agents/skills`, then each Claude configuration directory that exists, then `--dir`. */
function targetDirs(opts: SkillsOptions, env: Record<string, string | undefined>, userHome: string): string[] {
  const dirs = [join(userHome, ".agents", "skills")];
  const claude = [join(userHome, ".claude")];
  for (const name of readdirSync(userHome).sort()) if (name.startsWith(".claude-")) claude.push(join(userHome, name));
  if (env.CLAUDE_CONFIG_DIR) claude.push(resolve(env.CLAUDE_CONFIG_DIR));
  for (const dir of claude) if (isDirectory(dir)) dirs.push(join(dir, "skills"));
  for (const dir of opts.dirs) dirs.push(resolve(dir));
  return [...new Set(dirs)];
}

export function installSkills(opts: SkillsOptions, env: Record<string, string | undefined>, deps: SkillsDeps = {}): SkillInstallReport {
  const userHome = deps.userHome ?? homedir();
  const source = deps.sourceDir ?? skillsSourceDir();
  const entries: SkillInstallReport["entries"] = [];
  for (const target of targetDirs(opts, env, userHome)) {
    for (const name of SKILL_NAMES) {
      const dest = join(target, name);
      const files = listFiles(join(source, name));
      mkdirSync(dest, { recursive: true });
      const hashes: Record<string, string> = {};
      for (const rel of files) {
        const bytes = readFileSync(join(source, name, rel));
        hashes[rel] = sha256(bytes);
        mkdirSync(join(dest, rel, ".."), { recursive: true });
        writeFileSync(join(dest, rel), bytes);
      }
      const marker: SkillInstallMarker = { format: "wachiman.skill-install/1", version: deps.version ?? "unknown", installedAt: (deps.now?.() ?? new Date()).toISOString(), files: hashes };
      writeFileSync(join(dest, MARKER_FILE), `${JSON.stringify(marker, null, 2)}\n`);
      entries.push({ target: dest, action: "installed" });
    }
  }
  return { format: "wachiman.skills/1", entries, exitCode: entries.some((e) => e.action === "failed") ? 1 : 0 };
}
