/**
 * `wachiman skills install|uninstall`: copies the two agent skills into the directories where
 * coding agents look for them, marks each copy so it can be told from anyone else's, and removes
 * only what it installed (command contract section 5.9).
 */
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync, type Stats } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { wachimanHome } from "../accounts/config";
import { UsageError } from "../config";

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

const isUnder = (path: string, parent: string) => {
  const rel = relative(parent, path);
  return rel === "" || (rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\") && !isAbsolute(rel));
};

/** `path` with its deepest existing ancestor resolved through symlinks; the rest is appended as written. */
function resolveThroughExisting(path: string): string {
  const missing: string[] = [];
  let current = resolve(path);
  for (;;) {
    try {
      return join(realpathSync.native(current), ...missing.reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolve(path);
      missing.push(current.slice(parent.length + 1));
      current = parent;
    }
  }
}

/** Throws before anything is written when a target is the Wachiman home or below it, as written or through a symlink. */
function refuseWachimanHome(targets: string[], home: string) {
  const protectedPaths = [...new Set([resolve(home), resolveThroughExisting(home)])];
  for (const target of targets) {
    const seen = [resolve(target), resolveThroughExisting(target)];
    if (seen.some((path) => protectedPaths.some((p) => isUnder(path, p)))) {
      throw new UsageError(`refusing ${target}: it is under the Wachiman home ${resolve(home)}, which holds isolated review profiles that must stay empty.`);
    }
  }
}

const lstatOrUndefined = (path: string): Stats | undefined => {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
};

/** A path the marker may list: relative, `/`-separated, no empty, `.` or `..` segment, not the marker itself. */
const isSafeRelative = (rel: string) =>
  rel !== MARKER_FILE && !rel.includes("\\") && !rel.includes("\0") && !isAbsolute(rel) && rel.split("/").every((part) => part !== "" && part !== "." && part !== "..");

/** The ownership marker of a copy, or undefined when it is missing, not ours, malformed or lists an unsafe path. */
function readMarker(dest: string): SkillInstallMarker | undefined {
  const path = join(dest, MARKER_FILE);
  if (!lstatOrUndefined(path)?.isFile()) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<SkillInstallMarker>;
    if (parsed.format !== "wachiman.skill-install/1" || typeof parsed.version !== "string" || typeof parsed.installedAt !== "string") return undefined;
    const files = parsed.files;
    if (typeof files !== "object" || files === null || Array.isArray(files)) return undefined;
    for (const [rel, hash] of Object.entries(files)) if (!isSafeRelative(rel) || typeof hash !== "string") return undefined;
    return parsed as SkillInstallMarker;
  } catch {
    return undefined;
  }
}

/**
 * How a marked file stands now: `absent`, `intact` (a regular file, reached without crossing a
 * symlink, whose bytes hash to the marker's value), or `modified` (anything else).
 */
function fileState(dest: string, rel: string, hash: string): "absent" | "intact" | "modified" {
  const parts = rel.split("/");
  let current = dest;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const stat = lstatOrUndefined(current);
    if (stat === undefined) return "absent";
    const last = index === parts.length - 1;
    if (last ? !stat.isFile() : !stat.isDirectory()) return "modified";
  }
  return sha256(readFileSync(current)) === hash ? "intact" : "modified";
}

/** Creates the directories above `rel` inside `dest`, refusing to pass through a symlink or a file. */
function ensureRealDirs(dest: string, rel: string) {
  let current = dest;
  for (const part of rel.split("/").slice(0, -1)) {
    current = join(current, part);
    const stat = lstatOrUndefined(current);
    if (stat === undefined) mkdirSync(current);
    else if (!stat.isDirectory()) throw new Error(`${current} is not a directory`);
  }
}

function writeInside(dest: string, rel: string, bytes: Uint8Array) {
  ensureRealDirs(dest, rel);
  const path = join(dest, ...rel.split("/"));
  const temp = `${path}.wachiman-${process.pid}.tmp`;
  writeFileSync(temp, bytes);
  renameSync(temp, path);
}

/** Removes the directories that held `rels` and are now empty, deepest first, never through a symlink. */
function pruneEmptyDirs(dest: string, rels: string[]) {
  const dirs = new Set<string>();
  for (const rel of rels) {
    const parts = rel.split("/").slice(0, -1);
    for (let n = 1; n <= parts.length; n++) dirs.add(parts.slice(0, n).join("/"));
  }
  for (const dir of [...dirs].sort((a, b) => b.split("/").length - a.split("/").length)) {
    const path = join(dest, ...dir.split("/"));
    if (lstatOrUndefined(path)?.isDirectory() && readdirSync(path).length === 0) rmdirSync(path);
  }
}

type Entry = SkillInstallReport["entries"][number];

/** Why `dest` is not ours to touch, or undefined with its marker when it is. */
function ownership(dest: string): { marker: SkillInstallMarker } | { reason: string } {
  const stat = lstatOrUndefined(dest);
  if (stat?.isSymbolicLink()) return { reason: "it is a symlink, not a copy; it was not followed" };
  if (!stat?.isDirectory()) return { reason: "it is not a directory" };
  const marker = readMarker(dest);
  return marker ? { marker } : { reason: `it has no ownership marker (${MARKER_FILE}), so it was not installed by wachiman` };
}

function installOne(dest: string, source: string, deps: SkillsDeps): Entry {
  const stat = lstatOrUndefined(dest);
  let replaced: SkillInstallMarker | undefined;
  if (stat !== undefined) {
    const owned = ownership(dest);
    if ("reason" in owned) return { target: dest, action: "preserved", reason: owned.reason };
    const modified = Object.entries(owned.marker.files).filter(([rel, hash]) => fileState(dest, rel, hash) === "modified").map(([rel]) => rel);
    if (modified.length > 0) return { target: dest, action: "preserved", reason: `locally modified (${modified.join(", ")})` };
    replaced = owned.marker;
  }
  const files = listFiles(source);
  if (replaced) {
    const known = replaced.files;
    const collisions = files.filter((rel) => !(rel in known) && lstatOrUndefined(join(dest, ...rel.split("/"))) !== undefined);
    if (collisions.length > 0) return { target: dest, action: "preserved", reason: `the new version would overwrite files wachiman did not install (${collisions.join(", ")})` };
  }
  const hashes: Record<string, string> = {};
  mkdirSync(dest, { recursive: true });
  for (const rel of files) {
    const bytes = readFileSync(join(source, ...rel.split("/")));
    hashes[rel] = sha256(bytes);
    writeInside(dest, rel, bytes);
  }
  if (replaced) {
    const dropped = Object.keys(replaced.files).filter((rel) => !(rel in hashes));
    for (const rel of dropped) if (fileState(dest, rel, replaced.files[rel]) === "intact") unlinkSync(join(dest, ...rel.split("/")));
    pruneEmptyDirs(dest, dropped);
  }
  const marker: SkillInstallMarker = { format: "wachiman.skill-install/1", version: deps.version ?? "unknown", installedAt: (deps.now?.() ?? new Date()).toISOString(), files: hashes };
  writeInside(dest, MARKER_FILE, Buffer.from(`${JSON.stringify(marker, null, 2)}\n`));
  return { target: dest, action: "installed" };
}

function uninstallOne(dest: string): Entry | undefined {
  if (lstatOrUndefined(dest) === undefined) return undefined;
  const owned = ownership(dest);
  if ("reason" in owned) return { target: dest, action: "preserved", reason: owned.reason };
  const { marker } = owned;
  const intact: string[] = [];
  const modified: string[] = [];
  for (const [rel, hash] of Object.entries(marker.files)) {
    const state = fileState(dest, rel, hash);
    if (state === "intact") intact.push(rel);
    else if (state === "modified") modified.push(rel);
  }
  for (const rel of intact) unlinkSync(join(dest, ...rel.split("/")));
  pruneEmptyDirs(dest, intact);
  if (modified.length > 0) {
    const kept = Object.fromEntries(modified.map((rel) => [rel, marker.files[rel]]));
    writeInside(dest, MARKER_FILE, Buffer.from(`${JSON.stringify({ ...marker, files: kept }, null, 2)}\n`));
    return { target: dest, action: "preserved", reason: `locally modified (${modified.join(", ")}) and kept; the other installed files were removed` };
  }
  unlinkSync(join(dest, MARKER_FILE));
  const rest = readdirSync(dest);
  if (rest.length === 0) rmdirSync(dest);
  return rest.length === 0 ? { target: dest, action: "removed" } : { target: dest, action: "removed", reason: `kept files that are not wachiman's (${rest.join(", ")})` };
}

/**
 * Installs or removes both skills in every target directory. A target under the Wachiman home
 * throws a UsageError before anything is written. A copy that is not ours (no marker, a symlink, a
 * file, a modified file) is reported `preserved` and warned about, never overwritten or followed.
 */
export function installSkills(opts: SkillsOptions, env: Record<string, string | undefined>, deps: SkillsDeps = {}): SkillInstallReport {
  const userHome = deps.userHome ?? homedir();
  const source = deps.sourceDir ?? skillsSourceDir();
  const warn = deps.warn ?? (() => {});
  const targets = targetDirs(opts, env, userHome);
  refuseWachimanHome(targets, wachimanHome(env));
  const entries: Entry[] = [];
  for (const target of targets) {
    for (const name of SKILL_NAMES) {
      const dest = join(target, name);
      let entry: Entry | undefined;
      try {
        entry = opts.action === "install" ? installOne(dest, join(source, name), deps) : uninstallOne(dest);
      } catch (error) {
        entry = { target: dest, action: "failed", reason: error instanceof Error ? error.message : String(error) };
      }
      if (!entry) continue;
      if (entry.action === "preserved") warn(`left ${dest} in place: ${entry.reason}`);
      else if (entry.action === "failed") warn(`could not ${opts.action} ${dest}: ${entry.reason}`);
      else if (entry.reason) warn(`${dest}: ${entry.reason}`);
      entries.push(entry);
    }
  }
  return { format: "wachiman.skills/1", entries, exitCode: entries.some((e) => e.action === "failed") ? 1 : 0 };
}

export const skillsUsage = `wachiman skills install [--dir <path>]… [--json]
wachiman skills uninstall [--dir <path>]…`;

/** `--dir` may repeat; `--json` belongs to `install`; `--help` is `{ help: true }` before anything else is checked. */
export function parseSkillsArgs(argv: string[]): SkillsOptions | { help: true } {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  const [action, ...rest] = argv;
  if (action !== "install" && action !== "uninstall") {
    throw new UsageError(action === undefined ? "skills needs install or uninstall." : `skills: unknown subcommand "${action}"; use install or uninstall.`);
  }
  const dirs: string[] = [];
  let json = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--dir" || arg.startsWith("--dir=")) {
      const value = arg === "--dir" ? rest[++i] : arg.slice("--dir=".length);
      if (value === undefined || value === "" || (arg === "--dir" && value.startsWith("--"))) throw new UsageError("--dir needs a directory.");
      dirs.push(value);
    } else if (arg === "--json" && action === "install") {
      json = true;
    } else if (arg.startsWith("--")) {
      throw new UsageError(`skills ${action} does not take ${arg.split("=")[0]}.`);
    } else {
      throw new UsageError(`skills ${action} takes no argument "${arg}".`);
    }
  }
  return { action, dirs, json };
}

export interface SkillsIo { stdout: (text: string) => void; stderr: (line: string) => void }

/** Runs the command: the result on stdout (one document with `--json`), warnings on stderr; the exit code. */
export function runSkills(opts: SkillsOptions, env: Record<string, string | undefined>, io: SkillsIo, deps: SkillsDeps = {}): number {
  const report = installSkills(opts, env, { ...deps, warn: (line) => io.stderr(`wachiman: ${line}`) });
  if (opts.json) io.stdout(`${JSON.stringify(report, null, 2)}\n`);
  else for (const entry of report.entries) if (entry.action === "installed" || entry.action === "removed") io.stdout(`${entry.action} ${entry.target}\n`);
  return report.exitCode;
}
