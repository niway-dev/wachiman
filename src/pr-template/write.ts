/**
 * Writing one managed file safely. `wachiman init` and `wachiman pr-template` share it: no
 * symbolic link may stand in for a directory of the path or for the target, an existing file may be
 * copied to a backup that never overwrites another backup, and the new content goes in through an
 * exclusive temporary file and a rename after the target is found unchanged since it was
 * inspected.
 *
 * `label` is the command named in the messages ("init", "pr-template").
 */
import { randomBytes } from "node:crypto";
import { constants, copyFileSync, linkSync, lstatSync, mkdirSync, realpathSync, renameSync, unlinkSync, writeFileSync, type Stats } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { UsageError } from "../config";

export interface TargetState {
  /** The real path the file is written to: the real repository root plus the relative path. */
  target: string;
  exists: boolean;
  identity?: string;
}

const identityOf = (s: Stats) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}`;

const lstatOrNull = (path: string) => {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

/** Looks at the target and its ancestors without following a link; refuses anything that is not a plain directory chain and a plain file. */
export function inspectManagedTarget(repoDir: string, relativePath: string, label: string): TargetState {
  const root = realpathSync(repoDir);
  let current = root;
  const parts = relativePath.split("/");
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    const stat = lstatOrNull(current);
    if (stat === null) break;
    if (stat.isSymbolicLink()) throw new UsageError(`${current} is a symbolic link; ${label} does not write through links. Replace it with a real directory.`);
    if (!stat.isDirectory()) throw new UsageError(`${current} is not a directory; ${label} cannot write ${relativePath}.`);
    const real = realpathSync(current);
    if (real !== root && !real.startsWith(root + sep)) throw new UsageError(`${current} resolves outside the repository (${real}); ${label} refuses it.`);
  }
  const target = join(root, relativePath);
  const stat = lstatOrNull(target);
  if (stat === null) return { target, exists: false };
  if (stat.isSymbolicLink()) throw new UsageError(`${target} is a symbolic link; ${label} does not write through links.`);
  if (!stat.isFile()) throw new UsageError(`${target} exists and is not a regular file.`);
  return { target, exists: true, identity: identityOf(stat) };
}

/** `YYYYMMDD-HHMMSS` in UTC, from an ISO timestamp. */
export const backupStamp = (iso: string) => iso.replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

export interface WriteHooks {
  /** Runs after the temporary file is complete and before it replaces the target; a test changes the target here. */
  beforeCommit?: () => void;
}

/**
 * Writes `content` to the inspected target. With `backup`, an existing file is copied to
 * `<target>.bak-<stamp>` first (`-2`, `-3`… when that name is taken); without it, an existing file
 * is simply replaced. It is replaced only if it is the same file that was inspected. A new file is
 * linked into place, which fails if one appeared meanwhile. Returns the backup path when one was
 * made.
 */
export function writeManagedFile(p: {
  repoDir: string;
  relativePath: string;
  content: string;
  inspected: TargetState;
  now: string;
  label: string;
  backup: boolean;
  hooks?: WriteHooks;
}): { target: string; backup?: string } {
  const { inspected, label } = p;
  const dir = dirname(inspected.target);
  mkdirSync(dir, { recursive: true });
  // The directories exist now: look again, so a link planted between the first look and the mkdir is still refused.
  const again = inspectManagedTarget(p.repoDir, p.relativePath, label);
  if (again.exists !== inspected.exists || again.identity !== inspected.identity) {
    throw new UsageError(`${inspected.target} changed while ${label} was running; nothing was written. Run it again.`);
  }
  let backup: string | undefined;
  if (inspected.exists && p.backup) {
    const stamp = backupStamp(p.now);
    for (let n = 1; backup === undefined; n++) {
      const candidate = `${inspected.target}.bak-${stamp}${n === 1 ? "" : `-${n}`}`;
      try {
        copyFileSync(inspected.target, candidate, constants.COPYFILE_EXCL);
        backup = candidate;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
  }
  const tmp = join(dir, `.${basename(inspected.target)}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`);
  writeFileSync(tmp, p.content, { flag: "wx", mode: 0o644 });
  try {
    p.hooks?.beforeCommit?.();
    if (inspected.exists) {
      const now = lstatOrNull(inspected.target);
      if (now === null || now.isSymbolicLink() || identityOf(now) !== inspected.identity) {
        throw new UsageError(`${inspected.target} changed while ${label} was running; it was not replaced.${backup ? ` A copy of the earlier file is at ${backup}.` : ""}`);
      }
      renameSync(tmp, inspected.target);
    } else {
      try {
        linkSync(tmp, inspected.target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new UsageError(`${inspected.target} appeared while ${label} was running; nothing was written.`);
        throw error;
      }
    }
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      // Renamed into place, or already gone.
    }
  }
  return { target: inspected.target, ...(backup ? { backup } : {}) };
}
