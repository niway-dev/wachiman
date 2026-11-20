/**
 * What a distributed-repo run (spec "How a run picks its siblings") hands the review core: the
 * contracts the change applied, and the sibling snapshots read for them. Plain data plus the two
 * prompt sections, so the core imports nothing from `src/workspace/`: the manifest, the per-user
 * file and git are read by the local command before the core starts, and the GitHub mode never
 * builds one of these.
 *
 * `ResolvedSibling` is also the record a later unit turns into the result's `siblings[]`: every
 * field of the spec's report line is here (member, rule and its source, fallback, sha, age of the
 * last fetch, not cloned / not watched).
 */
import type { ReviewFile } from "./engine";

export type SiblingStatus =
  /** Read at `sha`. */
  | "read"
  /** The member's folder holds no clone: nothing was read. */
  | "not-cloned"
  /** The per-user file says `watch: false`: nothing was read. */
  | "not-watched"
  /** The `local` rule read the sibling's `HEAD` commit; its uncommitted changes were not read. */
  | "uncommitted-not-read"
  /** Cloned, but no commit or file could be read (no commit at `HEAD`, a blob absent locally): `unreadable` says why. */
  | "unreadable";

/** One sibling read (or not) at one commit, for the contracts that asked for it. */
export interface ResolvedSibling {
  /** The member's `dir` in the manifest. */
  member: string;
  /** `owner/name`, as the manifest lists it. */
  repo: string;
  /** A missing or unknown visibility is already `private`. */
  visibility: "public" | "private";
  /** The names of the contracts that asked for it; empty for a member added by hand with `--sibling` alone. */
  contracts: string[];
  /** The contracts (of those above) whose source of truth is this member. Absent when none is. */
  sourceOfTruthOf?: string[];
  /** Added with `--sibling`: it reaches every batch, not only those that triggered a contract. */
  byHand: boolean;
  /** The rule that applied by precedence, and where it came from. */
  rule: "pinned" | "local" | "tip";
  ruleSource: "default" | "manifest" | "user-file";
  /** What was actually read; differs from `rule` after a fallback. */
  readAs: "pinned" | "local" | "tip";
  /** Why the rule could not be resolved and another was read. */
  fallback?: string;
  /** The full commit read. Absent when nothing was read. */
  sha?: string;
  /** `tip` only: when the sibling was last fetched (ISO 8601), or `"unknown"`. */
  fetchedAt?: string;
  /** The tracked paths extracted into the snapshot. */
  paths: string[];
  status: SiblingStatus;
  /** Why a cloned sibling could not be read (`status` is `unreadable`). */
  unreadable?: string;
  /** Where the snapshot is, for this run only. Absent when nothing was read. */
  dir?: string;
  droppedSymlinks: string[];
  droppedSubmodules: string[];
}

/**
 * A reference into a sibling, as a finding of the result carries it (ADR 0043 decision 2): rendered as
 * `member@sha:path:line`, with the short commit in text and the full one here.
 */
export interface SiblingReference {
  member: string;
  /** The full commit of the snapshot the line was checked in. */
  sha: string;
  path: string;
  /** Positive, and inside that snapshot's file. */
  line: number;
}

/** A workspace contract that the change applied. */
export interface ContractReading {
  name: string;
  /** The changed paths that matched, as the reviewed repository names them: the new path, or the old path of a rename. */
  triggerPaths: string[];
  /** The `dir` of the reviewed member. */
  reviewedMember: string;
  /** The roles the reviewed member has in the contract (none when it only holds the source of truth). */
  reviewedRoles: ("provider" | "consumer")[];
  /** The reviewed member holds the source of truth. */
  holdsSource: boolean;
  sides: { member: string; role: "provider" | "consumer"; paths: string[] }[];
  sourceOfTruth: { member: string; paths: string[] };
}

export interface DistributedContext {
  /** The manifest the run used. */
  manifestPath: string;
  /** The reviewed member's `dir`. */
  reviewed: string;
  /** The contracts applied; empty when none was (the report says so in one line). */
  contracts: ContractReading[];
  /** Every sibling of the run: those read and those not cloned or not watched. */
  siblings: ResolvedSibling[];
}

/** One sibling as the result carries it: the row of the run without the snapshot's directory, which is for this run only. */
export type ResultSibling = Omit<ResolvedSibling, "dir">;

/** What a result of a distributed-repo run adds (the optional fields of result `/2`); the engine puts these on it. */
export interface DistributedResultFields {
  siblings: ResultSibling[];
  /** The names of the workspace contracts the change applied. */
  workspaceContractsApplied: string[];
  /** Present, and true, when none applied. */
  noWorkspaceContractApplied?: true;
  /** Present when a sibling that was read is not public: its members (ADR 0042 decision 5). */
  privateContext?: { members: string[] };
  /** How many references into a sibling could not be checked and were removed. */
  removedSiblingReferences: number;
}

const readable = (s: ResolvedSibling) => s.dir !== undefined && s.sha !== undefined && (s.status === "read" || s.status === "uncommitted-not-read");
const short = (sha: string) => sha.slice(0, 7);

/** The contracts of the run that a file of this batch triggered, by its new name or the one it had before a rename. */
function triggeredBy(context: DistributedContext, files: ReviewFile[]) {
  const names = new Set(files.flatMap((f) => (f.previous_filename ? [f.filename, f.previous_filename] : [f.filename])));
  return context.contracts.filter((c) => c.triggerPaths.some((p) => names.has(p)));
}

const unique = (dirs: (string | undefined)[]) => [...new Set(dirs.filter((d): d is string => d !== undefined))];

function memberLine(context: DistributedContext, contract: ContractReading, member: string): string {
  const roles = contract.sides.filter((s) => s.member === member).map((s) => `${s.role} (${s.paths.join(", ")})`);
  if (contract.sourceOfTruth.member === member) roles.push(`source of truth (${contract.sourceOfTruth.paths.join(", ")})`);
  const what = roles.join("; ");
  if (member === contract.reviewedMember) return `- ${member}, the repository under review: ${what}`;
  const sibling = context.siblings.find((s) => s.member === member && s.contracts.includes(contract.name));
  if (!sibling) return `- ${member}: ${what}. Not read.`;
  if (readable(sibling)) {
    const count = `${sibling.paths.length} file${sibling.paths.length === 1 ? "" : "s"}`;
    const uncommitted = sibling.status === "uncommitted-not-read" ? "; its uncommitted changes were not read" : "";
    return `- ${member}: ${what}. Read at commit ${sibling.sha} (${count}), in ${sibling.dir}${uncommitted}.`;
  }
  const why =
    sibling.status === "not-cloned"
      ? "not cloned: not checked"
      : sibling.status === "not-watched"
        ? "not watched: not checked"
        : `could not be read (${sibling.unreadable ?? "unknown reason"}): not checked`;
  return `- ${member}: ${what}. ${why}.`;
}

/**
 * What one provider call over `files` gets of the distributed-repo run: the prompt section, and the
 * snapshot directories to add. Only a call that holds a file which triggered a contract gets the
 * contract sections and the directories of the siblings those contracts read; a member added by hand
 * with `--sibling` reaches every call. Any other call, and any run with nothing to add, gets an empty
 * section and no directory, so its prompt and arguments are exactly those of a run without the feature.
 */
export function batchDistributed(context: DistributedContext | undefined, files: ReviewFile[]): { section: string; dirs: string[] } {
  if (!context) return { section: "", dirs: [] };
  const triggered = triggeredBy(context, files);
  const byHand = context.siblings.filter((s) => s.byHand && readable(s));
  if (triggered.length === 0 && byHand.length === 0) return { section: "", dirs: [] };

  const lines: string[] = ["", "## Workspace contracts and sibling repositories (read-only)", ""];
  lines.push(
    triggered.length > 0
      ? "This change touches files that a contract of the workspace manifest covers. The directories below hold other repositories of the same workspace, as plain files frozen at the commit named. They are context, not part of the change: read them with Read, Glob and Grep, and never write to them. A sibling that is not listed as read was not read, so do not guess what it holds."
      : "The directories below hold other repositories of the same workspace, as plain files frozen at the commit named. They are context, not part of the change: read them with Read, Glob and Grep, and never write to them.",
    "",
  );
  for (const contract of triggered) {
    const covered = unique(files.flatMap((f) => [f.filename, f.previous_filename ?? undefined]).filter((p) => p !== undefined && contract.triggerPaths.includes(p)));
    lines.push(`### Contract \`${contract.name}\``);
    lines.push(`- Changed files it covers: ${covered.join(", ")}`);
    const members = [...new Set([...contract.sides.map((s) => s.member), contract.sourceOfTruth.member])];
    for (const member of members) lines.push(memberLine(context, contract, member));
    lines.push("");
  }
  if (byHand.length > 0) {
    lines.push("### Added by hand with --sibling");
    for (const s of byHand) lines.push(`- ${s.member}: read at commit ${s.sha}, in ${s.dir}.`);
    lines.push("");
  }
  const reads = unique(
    [
      ...triggered.flatMap((c) => context.siblings.filter((s) => s.contracts.includes(c.name) && readable(s))),
      ...byHand,
    ].map((s) => s.dir),
  ).map((dir) => context.siblings.find((s) => s.dir === dir)!);
  const example = reads[0] ? `${reads[0].member}@${short(reads[0].sha!)}:path/to/file:12` : "member@3f2a9c1:path/to/file:12";
  lines.push(
    `${triggered.length > 0 ? "Check, for each contract above: a copy in this repository that drifts from its source of truth, and the consumers of a changed provider path that the change would break." : "Check whether the change breaks a consumer in a sibling, or drifts from a source of truth a sibling holds."} Report a problem as a finding on the changed file of this repository, and name the sibling location in the finding's text as \`member@sha:path:line\`, with the first 7 characters of the commit: for example \`${example}\`. The line must exist in that sibling's files at that commit.`,
    "",
  );
  return { section: lines.join("\n"), dirs: reads.map((s) => s.dir!) };
}

/** What the verifier gets: every sibling snapshot of the run, whichever contract or batch it came from. */
export function verifierDistributed(context: DistributedContext | undefined): { section: string; dirs: string[] } {
  const read = (context?.siblings ?? []).filter(readable);
  if (read.length === 0) return { section: "", dirs: [] };
  const lines = [
    "",
    "## Sibling repositories (read-only)",
    "",
    "The review of this change read other repositories of the same workspace, as plain files frozen at the commit named. They are context, not part of the change. A finding can rest on a premise that lives there: check it there with Read, Glob and Grep before you refute it, and never write to them.",
    ...read.map((s) => `- ${s.member}@${short(s.sha!)}: ${s.dir} (${s.byHand ? "added by hand" : `contract${s.contracts.length === 1 ? "" : "s"} ${s.contracts.join(", ")}`})`),
    "",
  ];
  return { section: lines.join("\n"), dirs: unique(read.map((s) => s.dir)) };
}

/**
 * The fields a distributed-repo run adds to its result. A sibling is private unless the manifest
 * says `public` (the row already carries that), and only a sibling that was read counts: one that
 * was not cloned, not watched or unreadable put nothing into the review.
 */
export function distributedResultFields(context: DistributedContext, removedReferences: number): DistributedResultFields {
  const private_ = [...new Set(context.siblings.filter((s) => readable(s) && s.visibility !== "public").map((s) => s.member))];
  return {
    siblings: context.siblings.map(({ dir: _dir, ...row }) => row),
    workspaceContractsApplied: context.contracts.map((c) => c.name),
    ...(context.contracts.length === 0 ? { noWorkspaceContractApplied: true as const } : {}),
    ...(private_.length > 0 ? { privateContext: { members: private_ } } : {}),
    removedSiblingReferences: removedReferences,
  };
}

/** The label of ADR 0042 decision 5, as the terminal, the Markdown report and the review loop print it. */
export const privateContextLine = (members: string[]) => `Built with private context from: ${members.join(", ")}. Do not paste its text into a public place.`;
