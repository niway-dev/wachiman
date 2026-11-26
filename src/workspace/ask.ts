/**
 * The workspace side of `wachiman ask` (ADR 0043 decision 5, spec "`ask` and history"): turn the
 * `siblings` rows a stored review kept into snapshots again, each at the commit the review read.
 * `ask` selects no sibling of its own, so the rows are the only input: no manifest contract is
 * matched and no version rule is resolved here, the SHA is the one stored.
 *
 * A sibling that cannot be read again (the member is not cloned, not watched, no longer in the
 * manifest, or the commit is gone from its clone) never fails the answer: it comes back as a row
 * with its reason, so the answer can name it and the references into it are removed and counted.
 * Nothing here fetches, pulls or clones: a commit `git cat-file -e` cannot find counts as gone.
 */
import { existsSync } from "node:fs";
import { UsageError } from "../config";
import type { ResolvedSibling, ResultSibling } from "../distributed";
import type { GitRunner } from "../evidence";
import { findWorkspace, memberDir, statusOf, type FoundWorkspace } from "./discover";
import { workspaceGit } from "./git";
import { snapshotSibling, type SiblingSnapshot } from "./snapshot";
import { readUserFile } from "./user-file";

const GIT_TIMEOUT_MS = 30_000;
const short = (sha: string) => sha.slice(0, 7);
const firstLine = (text: string) => text.trim().split("\n")[0] ?? "";

export interface AskSiblingsRequest {
  /** The reviewed repository, as `ask` was given it. */
  repoDir: string;
  /** `wachimanHome(env)`: where `workspaces.json` is. */
  home: string;
  git?: GitRunner;
  warn: (line: string) => void;
}

export interface AskSiblings {
  /** One row per member and commit the review read, with `dir` when its snapshot was re-created, and `unreadable` when not; then the members the review itself did not read. */
  siblings: ResolvedSibling[];
  /** Removes every snapshot. Safe to call more than once. */
  release: () => void;
}

/** A path of the stored row as a glob that matches only that path. */
const literal = (path: string) => path.replace(/[\\*?[\]{}()!]/g, "\\$&");

const readAtReview = (row: ResultSibling) => row.sha !== undefined && (row.status === "read" || row.status === "uncommitted-not-read");

/** Why a row the review itself did not read is listed: what the review said then. */
function notReadThen(row: ResultSibling): string {
  if (row.status === "not-cloned") return "it was not cloned when the review ran";
  if (row.status === "not-watched") return "it was not watched when the review ran";
  return `it could not be read when the review ran (${row.unreadable ?? "unknown reason"})`;
}

function locate(request: AskSiblingsRequest, warnings: string[]): FoundWorkspace | string {
  const git = request.git ?? workspaceGit;
  const text = (args: string[]) => {
    const out = git(args, { cwd: request.repoDir, timeoutMs: GIT_TIMEOUT_MS });
    return out.status === 0 && !out.error ? out.stdout.trim() : undefined;
  };
  try {
    const userFile = readUserFile(request.home);
    const repoTop = text(["rev-parse", "--show-toplevel"]) ?? request.repoDir;
    const found = findWorkspace(repoTop, text(["remote", "get-url", "origin"]), userFile, warnings);
    return found ?? "no workspace manifest lists this repository, so the sibling's clone cannot be found";
  } catch (error) {
    if (error instanceof UsageError) return firstLine(error.message);
    throw error;
  }
}

/**
 * Re-creates the snapshots of the siblings a stored review read. The caller releases them in a
 * `finally`, also when the call fails.
 */
export function rematerialiseSiblings(rows: readonly ResultSibling[], request: AskSiblingsRequest): AskSiblings {
  const git = request.git ?? workspaceGit;
  const snapshots: SiblingSnapshot[] = [];
  const release = () => {
    for (const snapshot of snapshots.splice(0)) {
      try {
        snapshot.remove();
      } catch {
        // Already gone.
      }
    }
  };

  // One snapshot per (member, commit): rows that read the same commit under several contracts share it.
  const wanted = new Map<string, { row: ResultSibling; paths: Set<string> }>();
  const notRead: ResolvedSibling[] = [];
  for (const row of rows) {
    if (readAtReview(row)) {
      const key = `${row.member}@${row.sha}`;
      const entry = wanted.get(key) ?? { row, paths: new Set<string>() };
      for (const path of row.paths ?? []) entry.paths.add(path);
      wanted.set(key, entry);
    } else if (!notRead.some((n) => n.member === row.member)) {
      notRead.push({
        ...row,
        paths: [],
        droppedSymlinks: row.droppedSymlinks ?? [],
        droppedSubmodules: row.droppedSubmodules ?? [],
        status: "unreadable",
        unreadable: notReadThen(row),
      });
    }
  }

  const siblings: ResolvedSibling[] = [];
  try {
    if (wanted.size > 0) {
      const warnings: string[] = [];
      const found = locate(request, warnings);
      for (const line of warnings) request.warn(line);
      for (const { row, paths } of wanted.values()) {
        const unreadable = (why: string): ResolvedSibling => ({
          ...row,
          paths: [],
          droppedSymlinks: row.droppedSymlinks ?? [],
          droppedSubmodules: row.droppedSubmodules ?? [],
          status: "unreadable",
          unreadable: why,
        });
        if (typeof found === "string") {
          siblings.push(unreadable(found));
          continue;
        }
        const member = found.manifest.members.find((m) => m.dir === row.member);
        if (!member) {
          siblings.push(unreadable("the member is not in the workspace manifest any more"));
          continue;
        }
        const dir = memberDir(found.coordinator, member, found.user);
        const status = statusOf(found, member, dir);
        if (status === "not-watched") {
          siblings.push(unreadable("not watched: watch is false for it in the per-user file"));
          continue;
        }
        if (status === "not-cloned" || !existsSync(dir)) {
          siblings.push(unreadable("not cloned: there is no clone to read it from"));
          continue;
        }
        const sha = row.sha!;
        const probe = git(["cat-file", "-e", `${sha}^{commit}`], { cwd: dir, timeoutMs: GIT_TIMEOUT_MS });
        if (probe.status !== 0 || probe.error) {
          siblings.push(unreadable(`the commit ${short(sha)} is gone from its clone; Wachiman never fetches`));
          continue;
        }
        try {
          const snapshot = snapshotSibling(dir, sha, [...paths].map(literal), git);
          snapshots.push(snapshot);
          siblings.push({
            ...row,
            paths: snapshot.paths,
            dir: snapshot.dir,
            droppedSymlinks: snapshot.droppedSymlinks,
            droppedSubmodules: snapshot.droppedSubmodules,
            status: "read",
          });
        } catch (error) {
          siblings.push(unreadable(firstLine(error instanceof Error ? error.message : String(error))));
        }
      }
    }
  } catch (error) {
    release();
    throw error;
  }
  return { siblings: [...siblings, ...notRead], release };
}
