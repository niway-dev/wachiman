/**
 * The lockfile check: a deterministic read of a lockfile diff, with no model call. Lockfiles stay
 * out of the model's review (`DEFAULT_EXCLUDE`: huge, generated), but a lockfile change can hide the
 * one thing a supply-chain change needs: a package nobody declared, or a package allowed to run
 * install scripts. This module finds those two things in `bun.lock` and `package-lock.json` and
 * reports them as findings with fixed wording, on the lockfile line.
 *
 * It reads the lockfile at the head (full text) and the diff (to know which lines are new). A
 * package is new when its entry line is added by the diff and no removed line names the same
 * package, so a version bump is not new. Other lockfile formats are not checked.
 */
import { readFileSync, statSync } from "node:fs";
import { repoFileResolver } from "./contracts";
import type { Finding, ReviewFile } from "./engine";

/** The only lockfile formats the check reads. */
export type LockfileKind = "bun" | "npm";

export function isCheckedLockfile(path: string): LockfileKind | null {
  const base = path.slice(path.lastIndexOf("/") + 1);
  if (base === "bun.lock") return "bun";
  if (base === "package-lock.json") return "npm";
  return null;
}

/** What a reader sees for each rule: fixed, so the same change is worded the same every time. The package is the line the thread sits on. */
export const LOCKFILE_MESSAGES = {
  undeclared: {
    title: "Lockfile adds a package that no package.json declares",
    body: "This lockfile line adds a package that no package.json of the workspace lists, and that no other package in the lockfile depends on. A dependency change should start in a package.json. Find out where it came from before anyone runs an install. No model read this file: the check compares the lockfile with the workspace's package.json files.",
  },
  trusted: {
    title: "Lockfile lets a new package run install scripts",
    body: "This line adds a package to `trustedDependencies`, the list of packages Bun lets run install scripts. Those scripts run on a developer machine and in CI, with access to their secrets. Confirm the package is needed and that a package.json declares it. No model read this file.",
  },
  installScript: {
    title: "Lockfile adds a package that runs an install script",
    body: "This package is new in the lockfile and declares an install script (`hasInstallScript`), which npm runs on every install, on developer machines and in CI, with access to their secrets. Confirm the package is expected. No model read this file.",
  },
} as const;

/** One package entry of a lockfile. */
export interface LockPackage {
  /** The package's name (`@scope/name`), from its identity, not from where it sits. */
  name: string;
  /** Every other name the entry answers to (an alias, the key's own name): what a dependency may call it. */
  aliases: string[];
  /** Names it depends on: dependencies, optional dependencies and peer dependencies. */
  dependencies: string[];
  /** 1-based line of the entry in the file. */
  line: number;
  /** A workspace member: declared by being one. */
  workspace: boolean;
  /** npm: the line of `"hasInstallScript": true` inside the entry. */
  installScriptLine?: number;
}

export interface ParsedLockfile {
  packages: LockPackage[];
  /** Names a package.json of the workspace declares directly, and the workspace members themselves. */
  declared: Set<string>;
  /** Bun's install-script allow list, with the line of each name. */
  trusted: { name: string; line: number }[];
  /** Each workspace the lockfile lists, by path, with the names the lockfile records it declares. */
  workspaces: { path: string; declared: string[] }[];
}

/** JSONC as Bun writes it (comments, trailing commas) as JSON text. Strings are left alone. */
export function stripJsonc(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
    } else if (c === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j] as string)) j++;
      if (text[j] === "}" || text[j] === "]") i++;
      else {
        out += c;
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;
const namesIn = (obj: unknown, fields: readonly string[]): string[] =>
  isRecord(obj) ? fields.flatMap((f) => (isRecord(obj[f]) ? Object.keys(obj[f] as object) : [])) : [];

/** `name` of `name@version`, scoped names included. */
const nameOfIdent = (ident: string): string | null => ident.match(/^(@[^/@]+\/[^@]+|[^@]+)@/)?.[1] ?? null;

/** The last package name in a bun.lock key: `parent/@scope/child` is `@scope/child`. */
function nameOfKey(key: string): string {
  const parts = key.split("/");
  const last = parts[parts.length - 1] as string;
  const before = parts[parts.length - 2];
  return before !== undefined && before.startsWith("@") ? `${before}/${last}` : last;
}

/** A line that opens an entry: `"key": [` or `"key": {`, with the key unescaped. */
const ENTRY_LINE = /^\s*("(?:[^"\\]|\\.)*")\s*:\s*[[{]/;
function entryKey(line: string): string | null {
  const m = line.match(ENTRY_LINE);
  if (!m) return null;
  try {
    return JSON.parse(m[1] as string) as string;
  } catch {
    return null;
  }
}

/** The 1-based line of each entry key, from the line that opens `section` on. First one wins. */
function entryLines(text: string, section: string): Map<string, number> {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim().startsWith(`"${section}"`));
  const out = new Map<string, number>();
  if (start === -1) return out;
  for (let i = start + 1; i < lines.length; i++) {
    const key = entryKey(lines[i] as string);
    if (key !== null && !out.has(key)) out.set(key, i + 1);
  }
  return out;
}

/** The lines of a diff: new-side numbers of the added ones, and the text of the removed ones. */
export function addedLines(patch: string): { added: Set<number>; removed: string[] } {
  const added = new Set<number>();
  const removed: string[] = [];
  let next = 0;
  for (const row of patch.split("\n")) {
    const hunk = row.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) next = Number(hunk[1]);
    else if (row.startsWith("+")) added.add(next++);
    else if (row.startsWith("-")) removed.push(row.slice(1));
    else if (row.startsWith(" ")) next++;
  }
  return { added, removed };
}

export function parseBunLock(text: string): ParsedLockfile | null {
  let doc: unknown;
  try {
    doc = JSON.parse(stripJsonc(text));
  } catch {
    return null;
  }
  if (!isRecord(doc) || !isRecord(doc.workspaces) || !isRecord(doc.packages)) return null;
  const lines = entryLines(text, "packages");
  const packages: LockPackage[] = [];
  for (const [key, entry] of Object.entries(doc.packages)) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
    const ident = entry[0];
    const name = nameOfIdent(ident) ?? nameOfKey(key);
    const keyName = nameOfKey(key);
    packages.push({
      name,
      aliases: keyName === name ? [] : [keyName],
      dependencies: namesIn(entry[2], ["dependencies", "optionalDependencies", "peerDependencies"]),
      line: lines.get(key) ?? 0,
      workspace: /@workspace:/.test(ident),
    });
  }
  const workspaces = Object.entries(doc.workspaces).map(([path, ws]) => ({
    path,
    declared: [...(isRecord(ws) && typeof ws.name === "string" ? [ws.name] : []), ...namesIn(ws, DEPENDENCY_FIELDS)],
  }));
  const trusted = trustedEntries(text, Array.isArray(doc.trustedDependencies) ? doc.trustedDependencies : []);
  return { packages, declared: new Set(workspaces.flatMap((w) => w.declared)), trusted, workspaces };
}

/** Each name of `trustedDependencies` with the line it is written on (the key's line for a one-line list). */
function trustedEntries(text: string, names: unknown[]): { name: string; line: number }[] {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim().startsWith('"trustedDependencies"'));
  if (start === -1) return [];
  let end = start;
  if (!/\]/.test(lines[start] as string)) while (end < lines.length - 1 && !/\]/.test(lines[end] as string)) end++;
  return names
    .filter((n): n is string => typeof n === "string")
    .map((name) => {
      const quoted = JSON.stringify(name);
      for (let i = start; i <= end; i++) if ((lines[i] as string).includes(quoted)) return { name, line: i + 1 };
      return { name, line: start + 1 };
    });
}

const NODE_MODULES = "node_modules/";

export function parseNpmLock(text: string): ParsedLockfile | null {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(doc) || !isRecord(doc.packages)) return null;
  const lines = entryLines(text, "packages");
  const body = text.split("\n");
  const packages: LockPackage[] = [];
  const workspaces: ParsedLockfile["workspaces"] = [];
  for (const [key, entry] of Object.entries(doc.packages)) {
    if (!isRecord(entry)) continue;
    const at = key.lastIndexOf(NODE_MODULES);
    if (at === -1) {
      // The root and the workspace members: their own package.json declares directly.
      workspaces.push({
        path: key,
        declared: [...(typeof entry.name === "string" ? [entry.name] : []), ...namesIn(entry, DEPENDENCY_FIELDS)],
      });
      continue;
    }
    const name = key.slice(at + NODE_MODULES.length);
    const line = lines.get(key) ?? 0;
    const pkg: LockPackage = {
      name,
      aliases: [],
      dependencies: namesIn(entry, ["dependencies", "optionalDependencies", "peerDependencies"]),
      line,
      // A link is a workspace member installed into node_modules.
      workspace: entry.link === true,
    };
    if (entry.hasInstallScript === true && line > 0) {
      for (let i = line; i < body.length; i++) {
        if (/^\s*"hasInstallScript"\s*:\s*true/.test(body[i] as string)) {
          pkg.installScriptLine = i + 1;
          break;
        }
        // The next package started: this one has no such line (it was written some other way).
        if (entryKey(body[i] as string)?.includes(NODE_MODULES)) break;
      }
    }
    packages.push(pkg);
  }
  return { packages, declared: new Set(workspaces.flatMap((w) => w.declared)), trusted: [], workspaces };
}

/** The declared names of one workspace, from its package.json when the head has a readable one. */
function declaredIn(content: string | null): string[] | null {
  if (content === null) return null;
  try {
    const json: unknown = JSON.parse(content);
    return isRecord(json) ? [...namesIn(json, DEPENDENCY_FIELDS), ...(typeof json.name === "string" ? [json.name] : [])] : null;
  } catch {
    return null;
  }
}

/**
 * The names the workspace declares directly. A workspace whose package.json the head holds is
 * declared by that file alone (the lockfile's own copy of its dependencies is what a hand edit
 * would change); the lockfile's listing stands only for one whose file cannot be read. Workspace
 * members are declared by being members.
 */
function declaredNames(parsed: ParsedLockfile, lockfileDir: string, read: (path: string) => string | null): Set<string> {
  const names = new Set<string>();
  for (const ws of parsed.workspaces) {
    const file = [lockfileDir, ws.path, "package.json"].filter((p) => p !== "").join("/");
    for (const n of declaredIn(read(file)) ?? ws.declared) names.add(n);
  }
  for (const p of parsed.packages) if (p.workspace) names.add(p.name);
  return names;
}

/** Every package name reachable from `roots`, through the dependencies the lockfile records. */
function reachable(parsed: ParsedLockfile, roots: Set<string>): Set<string> {
  const byName = new Map<string, LockPackage[]>();
  for (const p of parsed.packages)
    for (const n of [p.name, ...p.aliases]) {
      const same = byName.get(n);
      if (same) same.push(p);
      else byName.set(n, [p]);
    }
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const name = queue.pop() as string;
    if (seen.has(name)) continue;
    seen.add(name);
    for (const p of byName.get(name) ?? []) {
      seen.add(p.name);
      for (const n of [...p.aliases, ...p.dependencies]) if (!seen.has(n)) queue.push(n);
    }
  }
  return seen;
}

/** The package a removed diff line names, or null. */
function removedName(kind: LockfileKind, row: string): string | null {
  const key = entryKey(row);
  if (key === null) return null;
  if (kind === "npm") {
    const at = key.lastIndexOf(NODE_MODULES);
    return at === -1 ? null : key.slice(at + NODE_MODULES.length);
  }
  const ident = row.match(/^\s*"(?:[^"\\]|\\.)*"\s*:\s*\[\s*"((?:[^"\\]|\\.)*)"/)?.[1];
  return (ident ? nameOfIdent(ident) : null) ?? nameOfKey(key);
}

const finding = (path: string, line: number, kind: keyof typeof LOCKFILE_MESSAGES): Finding => ({
  path,
  line,
  severity: "fix",
  topic: "security",
  title: LOCKFILE_MESSAGES[kind].title,
  body: LOCKFILE_MESSAGES[kind].body,
});

export interface LockfileCheck {
  findings: Finding[];
  /** A lockfile of a checked kind that could not be read, with the reason: the check says nothing about it. */
  unchecked: { path: string; reason: string }[];
}

/**
 * The findings for the lockfiles among `files` (their diff) read at the head through `read`, which
 * returns a file's text or null. A lockfile of another kind is ignored; a checked one that cannot be
 * read, parsed or compared (no diff) is named in `unchecked`, never reported as clean.
 */
export function lockfileFindings(files: Pick<ReviewFile, "filename" | "patch">[], read: (path: string) => string | null): LockfileCheck {
  const findings: Finding[] = [];
  const unchecked: LockfileCheck["unchecked"] = [];
  for (const file of files) {
    const kind = isCheckedLockfile(file.filename);
    if (kind === null) continue;
    if (!file.patch) {
      unchecked.push({ path: file.filename, reason: "GitHub sent no diff for it" });
      continue;
    }
    const text = read(file.filename);
    const parsed = text === null ? null : kind === "bun" ? parseBunLock(text) : parseNpmLock(text);
    if (!parsed) {
      unchecked.push({
        path: file.filename,
        reason: text === null ? "it could not be read at the head" : "it is not a lockfile this check understands",
      });
      continue;
    }
    const dir = file.filename.includes("/") ? file.filename.slice(0, file.filename.lastIndexOf("/")) : "";
    const diff = addedLines(file.patch);
    const before = new Set(diff.removed.map((row) => removedName(kind, row)).filter((n): n is string => n !== null));
    const reach = reachable(parsed, declaredNames(parsed, dir, read));
    for (const pkg of parsed.packages) {
      // A bump moves an existing entry: it is not an undeclared addition. But a bump that gains the
      // install-script line is the way a new script reaches an old package, so that line counts alone.
      if (diff.added.has(pkg.line) && !before.has(pkg.name) && !reach.has(pkg.name) && !pkg.workspace)
        findings.push(finding(file.filename, pkg.line, "undeclared"));
      if (pkg.installScriptLine !== undefined && diff.added.has(pkg.installScriptLine) && !pkg.workspace)
        findings.push(finding(file.filename, pkg.installScriptLine, "installScript"));
    }
    const removedTrusted = new Set(
      diff.removed.map((row) => row.match(/^\s*"((?:[^"\\]|\\.)*)",?\s*$/)?.[1]).filter((n): n is string => n !== undefined),
    );
    for (const t of parsed.trusted)
      if (diff.added.has(t.line) && !removedTrusted.has(t.name)) findings.push(finding(file.filename, t.line, "trusted"));
  }
  return { findings, unchecked };
}

/** A lockfile bigger than this is not read: a real one is far smaller, and the head is untrusted. */
const MAX_LOCKFILE_BYTES = 20 * 1024 * 1024;

/**
 * `lockfileFindings` over the checked-out head at `headDir`. A path that leaves the directory (a
 * symlink pointing out) reads as missing, as for every other head read the engine does.
 */
export function lockfileCheckOf(files: Pick<ReviewFile, "filename" | "patch">[], headDir: string): LockfileCheck {
  const resolve = repoFileResolver(headDir);
  return lockfileFindings(files, (path) => {
    const real = resolve(path);
    if (real === null) return null;
    try {
      return statSync(real).size > MAX_LOCKFILE_BYTES ? null : readFileSync(real, "utf8");
    } catch {
      return null;
    }
  });
}
