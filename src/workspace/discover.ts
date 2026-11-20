/**
 * How a run picks its siblings (spec "How a run picks its siblings", steps 1 to 3): find the
 * workspace of the reviewed repository, match the changed paths against the contracts, and choose
 * which members and paths to read. Reads nothing from a sibling and never fetches; the version of
 * each sibling is `versions.ts`, the files are `snapshot.ts`.
 */
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { UsageError } from "../config";
import { normaliseRemote } from "../history/store";
import { MANIFEST_FILE, ManifestError, readManifest, type Contract, type Manifest, type Member } from "./manifest";
import { own, type UserFile, type UserWorkspace } from "./user-file";

export class WorkspaceError extends UsageError {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceError";
  }
}

/** `owner/name` of a remote URL, lower case, as a manifest `repo` is written; undefined when the URL names no owner and repository. */
export function repoSlug(origin: string | undefined): string | undefined {
  if (origin === undefined || origin.trim() === "") return undefined;
  const { text, parsed } = normaliseRemote(origin);
  let path = text;
  if (parsed) {
    try {
      path = new URL(text).pathname;
    } catch {
      return undefined;
    }
  }
  const parts = path.split("/").filter(Boolean);
  return parts.length < 2 ? undefined : parts.join("/").toLowerCase();
}

const realOrSelf = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

export interface FoundWorkspace {
  /** The folder that holds the manifest. */
  coordinator: string;
  manifestPath: string;
  manifest: Manifest;
  /** The member the reviewed repository is. */
  reviewed: Member;
  /** The per-user entry, when the workspace came from `workspaces.json`. */
  user?: UserWorkspace;
}

/** Where a member is cloned: the per-user override, else its `dir` in the coordinator. */
export const memberDir = (coordinator: string, member: Member, user?: UserWorkspace) => (user && own(user.members, member.dir))?.dir ?? join(coordinator, member.dir);

/** The member that is the reviewed repository: by `repo` against the origin, then by where it is cloned. */
function memberOf(manifest: Manifest, coordinator: string, repoTop: string, slug: string | undefined, user?: UserWorkspace): Member | undefined {
  const byRepo = slug === undefined ? undefined : manifest.members.find((m) => m.repo.toLowerCase() === slug);
  if (byRepo) return byRepo;
  const top = realOrSelf(repoTop);
  return manifest.members.find((m) => realOrSelf(memberDir(coordinator, m, user)) === top);
}

const isMissing = (error: unknown) => (error as { code?: string }).code === "unreadable" && /ENOENT/.test((error as Error).message);
const isManifestError = (error: unknown): error is ManifestError => error instanceof ManifestError;

/**
 * The workspace the repository at `repoTop` belongs to: the first per-user entry whose manifest
 * lists it (by `repo` against `origin`, then by directory), else the first manifest met walking up
 * from the parent of `repoTop`. Undefined when there is none, or when the manifest found by walking
 * up does not list this repository. A per-user entry whose manifest file is gone, or is invalid, is
 * skipped and a message naming its path is pushed to `warnings`, so one broken entry never fails
 * the review of a repository that is not in it. A manifest found by walking up that is invalid is
 * refused. The walk stops after `ceiling`, when given (a folder above `repoTop`); tests use it to
 * stay inside a folder they own. With `walkUp: false` only the per-user entries are looked at, so a
 * run that is not asking for the mode reads no manifest it was not told about.
 */
export function findWorkspace(
  repoTop: string,
  origin: string | undefined,
  userFile: UserFile,
  warnings: string[],
  options: { walkUp?: boolean; ceiling?: string } = {},
): FoundWorkspace | undefined {
  const { ceiling } = options;
  const slug = repoSlug(origin);
  for (const user of userFile.workspaces) {
    let manifest: Manifest;
    try {
      manifest = readManifest(user.manifest);
    } catch (error) {
      if (isMissing(error)) {
        warnings.push(`The workspace manifest ${user.manifest} listed in workspaces.json does not exist; skipping it.`);
        continue;
      }
      if (isManifestError(error)) {
        warnings.push(`The workspace manifest ${user.manifest} listed in workspaces.json is invalid and was skipped: ${error.message}`);
        continue;
      }
      throw error;
    }
    const coordinator = dirname(user.manifest);
    const reviewed = memberOf(manifest, coordinator, repoTop, slug, user);
    if (reviewed) return { coordinator, manifestPath: user.manifest, manifest, reviewed, user };
  }
  if (options.walkUp === false) return undefined;
  let dir = dirname(resolve(repoTop));
  for (;;) {
    const manifestPath = join(dir, MANIFEST_FILE);
    if (existsSync(manifestPath)) {
      const manifest = readManifest(manifestPath);
      const reviewed = memberOf(manifest, dir, repoTop, slug);
      return reviewed ? { coordinator: dir, manifestPath, manifest, reviewed } : undefined;
    }
    const parent = dirname(dir);
    if (parent === dir || (ceiling !== undefined && dir === resolve(ceiling))) return undefined;
    dir = parent;
  }
}

/** A changed path of the review. `oldPath` is the path before a rename; a deleted file's `path` is the path it had. */
export interface Change {
  path: string;
  oldPath?: string;
  status: string;
}

export interface Trigger {
  /** The changed path that matched: the new path, or the old path of a rename. */
  path: string;
  /** Matched a path of the reviewed member's own side, or of the source of truth it holds. */
  via: "side" | "source";
}

export interface AppliedContract {
  contract: Contract;
  triggers: Trigger[];
}

const matcher = (globs: string[]) => {
  const compiled = globs.map((g) => new Bun.Glob(g));
  return (path: string) => compiled.some((g) => g.match(path));
};

/**
 * The contracts a change applies (step 2). A contract applies when a changed path (new, old of a
 * rename, or deleted) matches a side of the reviewed member, or the source-of-truth paths when the
 * reviewed member holds the source. `reviewed` is the member's `dir`.
 */
export function matchContracts(manifest: Manifest, reviewed: string, changes: Change[]): AppliedContract[] {
  const candidates = [...new Set(changes.flatMap((c) => (c.oldPath !== undefined && c.oldPath !== c.path ? [c.path, c.oldPath] : [c.path])))];
  const applied: AppliedContract[] = [];
  for (const contract of manifest.contracts) {
    const sideGlobs = contract.sides.filter((s) => s.member === reviewed).flatMap((s) => s.paths);
    const matchesSide = sideGlobs.length > 0 ? matcher(sideGlobs) : undefined;
    const matchesSource = contract.sourceOfTruth.member === reviewed ? matcher(contract.sourceOfTruth.paths) : undefined;
    const triggers: Trigger[] = [];
    for (const path of candidates) {
      if (matchesSide?.(path)) triggers.push({ path, via: "side" });
      else if (matchesSource?.(path)) triggers.push({ path, via: "source" });
    }
    if (triggers.length > 0) applied.push({ contract, triggers });
  }
  return applied;
}

export type ReadStatus = "ready" | "not-cloned" | "not-watched";

export interface PlannedRead {
  member: Member;
  /** Where the member is cloned, whether or not it is there. */
  dir: string;
  /** The globs to read, merged across contracts. */
  globs: string[];
  /** Which contract asked for which globs; empty for a member added by hand. Versions resolve per contract. */
  contracts: { name: string; globs: string[] }[];
  status: ReadStatus;
}

export function statusOf(found: FoundWorkspace, member: Member, dir: string): ReadStatus {
  if ((found.user && own(found.user.members, member.dir))?.watch === false) return "not-watched";
  return existsSync(join(dir, ".git")) ? "ready" : "not-cloned";
}

const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];

/**
 * What to read for the applied contracts (step 3): each other side's member and paths, and the
 * source of truth's when another member holds it, merged per member. A member that is not cloned
 * or not watched is still listed, with its status, so the report can say so.
 */
export function planReads(found: FoundWorkspace, applied: AppliedContract[]): PlannedRead[] {
  const byMember = new Map<string, PlannedRead>();
  const add = (contract: string, memberName: string, globs: string[]) => {
    if (memberName === found.reviewed.dir) return;
    let read = byMember.get(memberName);
    if (!read) {
      const member = found.manifest.members.find((m) => m.dir === memberName)!;
      const dir = memberDir(found.coordinator, member, found.user);
      read = { member, dir, globs: [], contracts: [], status: statusOf(found, member, dir) };
      byMember.set(memberName, read);
    }
    read.globs = union(read.globs, globs);
    const entry = read.contracts.find((c) => c.name === contract);
    if (entry) entry.globs = union(entry.globs, globs);
    else read.contracts.push({ name: contract, globs: [...globs] });
  };
  for (const { contract } of applied) {
    for (const side of contract.sides) add(contract.name, side.member, side.paths);
    add(contract.name, contract.sourceOfTruth.member, contract.sourceOfTruth.paths);
  }
  return [...byMember.values()];
}

/**
 * `--sibling <dir>`: adds a member by hand with its whole tracked tree (`**`), or widens one
 * already planned to it. `dirName` must be the `dir` of a manifest member other than the reviewed one.
 */
export function addSibling(found: FoundWorkspace, reads: PlannedRead[], dirName: string): PlannedRead[] {
  const member = found.manifest.members.find((m) => m.dir === dirName);
  if (!member) throw new WorkspaceError(`--sibling "${dirName}" is not a member of ${found.manifestPath} (members: ${found.manifest.members.map((m) => m.dir).join(", ")}).`);
  if (member.dir === found.reviewed.dir) throw new WorkspaceError(`--sibling "${dirName}" is the reviewed repository itself.`);
  const dir = memberDir(found.coordinator, member, found.user);
  const hand: PlannedRead = { member, dir, globs: ["**"], contracts: [], status: statusOf(found, member, dir) };
  const existing = reads.find((r) => r.member.dir === member.dir);
  if (!existing) return [...reads, hand];
  return reads.map((r) => (r === existing ? { ...r, globs: ["**"] } : r));
}
