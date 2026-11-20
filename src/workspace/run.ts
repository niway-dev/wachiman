/**
 * The workspace side of a `wachiman local --distributed-repo` run: decide whether the mode is on,
 * and when it is, turn the changed files into the contracts they apply and the sibling snapshots to
 * read (spec "How a run picks its siblings"). It is the only caller of `findWorkspace`, the version
 * rules and the snapshots outside their own tests, and only `local.ts` calls it, so the GitHub mode
 * never reaches the manifest, the per-user file or a sibling. Nothing here fetches.
 *
 * Two steps, because the mode must be known (and its exit-2 rules applied) before the change is
 * even built, while the contracts need the changed files:
 *
 * 1. `decideDistributed`: reads at most the per-user file, and a manifest only when the run asked
 *    for the mode (the flag, or a per-user entry that says `on`).
 * 2. `prepareDistributed`: matches, resolves versions and takes the snapshots. `release()` removes
 *    them; the caller runs it in a `finally`.
 */
import { homedir } from "node:os";
import { UsageError } from "../config";
import type { DistributedContext, ContractReading, ResolvedSibling } from "../distributed";
import type { ReviewFile } from "../engine";
import type { GitRunner } from "../evidence";
import { addSibling, findWorkspace, matchContracts, planReads, repoSlug, type AppliedContract, type Change, type FoundWorkspace, type PlannedRead } from "./discover";
import { workspaceGit } from "./git";
import type { Contract } from "./manifest";
import { chooseRule, resolveVersion, type ResolvedVersion } from "./versions";
import { snapshotSibling, type SiblingSnapshot } from "./snapshot";
import { readUserFile, USER_FILE_NAME, userFilePath } from "./user-file";

const GIT_TIMEOUT_MS = 30_000;

export interface DecideRequest {
  /** `--distributed-repo` (true), `--no-distributed-repo` (false) or neither. */
  flag: boolean | undefined;
  /** The `--sibling` directories, in the order given. */
  siblings: string[];
  repoDir: string;
  /** `wachimanHome(env)`: where `workspaces.json` is. */
  home: string;
  git: GitRunner;
  warn: (line: string) => void;
}

export type Decision =
  | { on: false }
  | {
      on: true;
      /** The flag asked for it, or the per-user default did. */
      reason: "flag" | "default";
      /** The per-user file that turned it on, for the default-on line. */
      defaultFile?: string;
      found: FoundWorkspace;
      /** Top level of the reviewed repository. */
      repoTop: string;
    };

const text = (git: GitRunner, cwd: string, args: string[]) => {
  const out = git(args, { cwd, timeoutMs: GIT_TIMEOUT_MS });
  return out.status === 0 && !out.error ? out.stdout.trim() : undefined;
};

/** `~` for the user's home, as the spec's default-on line writes the file. */
export function homeRelative(path: string): string {
  const home = homedir();
  return home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;
}

/**
 * Whether this run is a distributed-repo run, and in which workspace. `--no-distributed-repo` reads
 * nothing. Without a flag the per-user file is read, and only the manifests of entries that say
 * `distributedRepo: "on"` are opened: an off entry, and a manifest found by walking up, are never
 * read. `--sibling` without the mode, a flag with no workspace, and a `--sibling` that is not a
 * member are usage errors (exit 2).
 */
export function decideDistributed(request: DecideRequest): Decision {
  const { flag, siblings, repoDir, home, git, warn } = request;
  if (flag === false) return { on: false };

  const asked = flag === true;
  let userFile;
  try {
    userFile = readUserFile(home);
  } catch (error) {
    // A broken file must not stop reviews that never asked for the mode, but it must not widen one that did.
    if (asked || siblings.length > 0 || !(error instanceof UsageError)) throw error;
    warn(`distributed-repo: ${error.message} It was ignored, so the mode is off for this run.`);
    return needSibling(siblings);
  }

  let repoTop = repoDir;
  let origin: string | undefined;
  const locate = () => {
    repoTop = text(git, repoDir, ["rev-parse", "--show-toplevel"]) ?? repoDir;
    origin = text(git, repoDir, ["remote", "get-url", "origin"]);
  };
  const warnings: string[] = [];
  let found: FoundWorkspace | undefined;
  if (asked) {
    locate();
    found = findWorkspace(repoTop, origin, userFile, warnings);
  } else {
    const on = userFile.workspaces.filter((w) => w.distributedRepo === "on");
    if (on.length > 0) {
      locate();
      found = findWorkspace(repoTop, origin, { ...userFile, workspaces: on }, warnings, { walkUp: false });
    }
  }
  for (const line of warnings) warn(line);

  if (!found) {
    if (asked) {
      const slug = repoSlug(origin);
      throw new UsageError(
        `--distributed-repo found no workspace for ${repoTop}${slug ? ` (${slug})` : ""}: no entry of ${userFilePath(home)} and no ${"workspace.manifest.json"} above it lists this repository as a member. ` +
          `Add the repository to the manifest, or list the manifest in ${USER_FILE_NAME}.`,
      );
    }
    return needSibling(siblings);
  }
  // Fail before the review starts, not after: every --sibling must be a member other than this one.
  for (const dir of siblings) addSibling(found, [], dir);
  return { on: true, reason: asked ? "flag" : "default", ...(asked ? {} : { defaultFile: userFilePath(home) }), found, repoTop };
}

/** The mode is off: `--sibling` has nothing to attach to. */
function needSibling(siblings: string[]): { on: false } {
  if (siblings.length > 0) {
    throw new UsageError(
      "--sibling needs distributed-repo mode. Pass --distributed-repo, or set distributedRepo to \"on\" for this workspace in workspaces.json.",
    );
  }
  return { on: false };
}

export interface PrepareRequest {
  /** The files of the review: new names, with `previous_filename` for a rename; a deleted file keeps its name. */
  files: ReviewFile[];
  /** The reviewed head, where a `pinned` rule reads the consumer's pin. */
  headSha: string;
  /** The `--sibling` directories; already validated by `decideDistributed`. */
  siblings: string[];
  warn: (line: string) => void;
  git?: GitRunner;
}

export interface PreparedDistributed {
  context: DistributedContext;
  /** Removes every snapshot. Safe to call more than once. */
  release: () => void;
}

/** What `--sibling` asks for when no contract reads the member: a stand-in contract that no rule is declared for. */
const HAND_CONTRACT = (reviewedMember: string): Contract => ({ name: "--sibling", sides: [], sourceOfTruth: { member: reviewedMember, paths: [] } });

const resolutionKey = (r: ResolvedVersion) => JSON.stringify([r.rule, r.ruleSource, r.readAs, r.fallback ?? "", r.sha ?? "", r.unreadable ?? "", r.uncommitted ?? false, r.fetchedAt ?? ""]);
const union = (lists: string[][]) => [...new Set(lists.flat())];

function readingOf(found: FoundWorkspace, applied: AppliedContract): ContractReading {
  const { contract, triggers } = applied;
  const reviewed = found.reviewed.dir;
  return {
    name: contract.name,
    triggerPaths: [...new Set(triggers.map((t) => t.path))],
    reviewedMember: reviewed,
    reviewedRoles: [...new Set(contract.sides.filter((s) => s.member === reviewed).map((s) => s.role))],
    holdsSource: contract.sourceOfTruth.member === reviewed,
    sides: contract.sides.map((s) => ({ member: s.member, role: s.role, paths: [...s.paths] })),
    sourceOfTruth: { member: contract.sourceOfTruth.member, paths: [...contract.sourceOfTruth.paths] },
  };
}

/**
 * Matches the changed files against the contracts, plans what to read, resolves one commit per
 * (contract, member) and snapshots it. A sibling that is not cloned, not watched or cannot be read
 * is a row of the context with its status, never a silent skip, and never stops the review.
 */
export function prepareDistributed(decision: Extract<Decision, { on: true }>, request: PrepareRequest): PreparedDistributed {
  const { found, repoTop } = decision;
  const git = request.git ?? workspaceGit;
  const changes: Change[] = request.files.map((f) => ({
    path: f.filename,
    ...(f.previous_filename ? { oldPath: f.previous_filename } : {}),
    status: f.previous_filename ? "renamed" : "changed",
  }));
  const applied = matchContracts(found.manifest, found.reviewed.dir, changes);
  let plan: PlannedRead[] = planReads(found, applied);
  const byHand = new Set(request.siblings);
  for (const dir of request.siblings) plan = addSibling(found, plan, dir);

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

  const siblings: ResolvedSibling[] = [];
  try {
    for (const read of plan) {
      const hand = byHand.has(read.member.dir);
      const base = {
        member: read.member.dir,
        repo: read.member.repo,
        visibility: read.member.visibility,
        byHand: hand,
        droppedSymlinks: [] as string[],
        droppedSubmodules: [] as string[],
      };
      const entries = read.contracts.length > 0 ? read.contracts : [{ name: "--sibling", globs: read.globs }];
      const contractOf = (name: string): Contract =>
        applied.find((a) => a.contract.name === name)?.contract ?? HAND_CONTRACT(found.reviewed.dir);

      if (read.status !== "ready") {
        // Not read, so no version: the row says which rule would have applied, for the report.
        const { rule, ruleSource } = ruleOf(found, contractOf(entries[0]!.name), read);
        siblings.push({ ...base, contracts: read.contracts.map((c) => c.name), rule, ruleSource, readAs: rule, paths: [], status: read.status });
        continue;
      }

      // One commit per (contract, member); contracts that resolve alike share one snapshot.
      const groups = new Map<string, { resolved: ResolvedVersion; contracts: string[]; globs: string[][] }>();
      for (const entry of entries) {
        const resolved = resolveVersion(
          { contract: contractOf(entry.name), reviewed: found.reviewed, member: read.member, ...(found.user ? { user: found.user } : {}), reviewedDir: repoTop, reviewedHead: request.headSha, siblingDir: read.dir },
          git,
        );
        const key = resolutionKey(resolved);
        const group = groups.get(key) ?? { resolved, contracts: [], globs: [] };
        if (read.contracts.length > 0) group.contracts.push(entry.name);
        group.globs.push(entry.globs);
        groups.set(key, group);
      }

      for (const { resolved, contracts, globs } of groups.values()) {
        const row: ResolvedSibling = {
          ...base,
          contracts,
          rule: resolved.rule,
          ruleSource: resolved.ruleSource,
          readAs: resolved.readAs,
          ...(resolved.fallback ? { fallback: resolved.fallback } : {}),
          ...(resolved.readAs === "tip" && resolved.fetchedAt ? { fetchedAt: resolved.fetchedAt } : {}),
          paths: [],
          status: "read",
        };
        if (!resolved.sha) {
          siblings.push({ ...row, status: "unreadable", unreadable: resolved.unreadable ?? "no commit could be resolved" });
          request.warn(`distributed-repo: ${read.member.dir} was not read: ${resolved.unreadable ?? "no commit could be resolved"}.`);
          continue;
        }
        try {
          const snapshot = snapshotSibling(read.dir, resolved.sha, hand ? ["**"] : union(globs), git);
          snapshots.push(snapshot);
          siblings.push({
            ...row,
            sha: resolved.sha,
            paths: snapshot.paths,
            dir: snapshot.dir,
            droppedSymlinks: snapshot.droppedSymlinks,
            droppedSubmodules: snapshot.droppedSubmodules,
            status: resolved.uncommitted ? "uncommitted-not-read" : "read",
          });
        } catch (error) {
          const why = error instanceof Error ? error.message : String(error);
          siblings.push({ ...row, sha: resolved.sha, status: "unreadable", unreadable: why });
          request.warn(`distributed-repo: ${read.member.dir} at ${resolved.sha.slice(0, 7)} was not read: ${why}`);
        }
      }
    }
  } catch (error) {
    release();
    throw error;
  }

  return {
    context: { manifestPath: found.manifestPath, reviewed: found.reviewed.dir, contracts: applied.map((a) => readingOf(found, a)), siblings },
    release,
  };
}

/** The rule that would apply to a member that is not read, for the row that reports it. */
function ruleOf(found: FoundWorkspace, contract: Contract, read: PlannedRead) {
  const { spec, source } = chooseRule(contract, read.member, found.user);
  return { rule: spec.rule, ruleSource: source };
}
