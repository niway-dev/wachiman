/**
 * Which commit of a sibling a review reads (spec "Version rules", ADR 0044). One rule per
 * (contract, member), chosen by precedence; a rule that cannot be resolved falls back, never
 * silently: the result says what was asked, what was read, and why they differ. Only local git
 * reads happen here. Wachiman never fetches, pulls or clones (ADR 0019).
 */
import { statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnGit, type GitRunner } from "../evidence";
import type { Contract, Member, VersionRuleName, VersionSpec } from "./manifest";
import type { UserWorkspace } from "./user-file";

export type RuleSource = "default" | "manifest" | "user-file";

export interface ResolvedVersion {
  contract: string;
  /** The sibling's `dir`. */
  member: string;
  /** The rule that applied by precedence. */
  rule: VersionRuleName;
  ruleSource: RuleSource;
  /** What was actually read; differs from `rule` after a fallback. */
  readAs: VersionRuleName;
  /** The commit read; absent when the sibling has no readable commit (see `unreadable`). */
  sha?: string;
  /** Why the rule could not be resolved and another was read. */
  fallback?: string;
  /** Why no commit could be read at all. */
  unreadable?: string;
  /** `local` only: the sibling has uncommitted changes to tracked files. They are not read. */
  uncommitted?: boolean;
  /** `tip` only: when the sibling was last fetched (`FETCH_HEAD`'s modification time, ISO 8601), or `"unknown"`. */
  fetchedAt?: string;
}

const DEFAULT_RULE: VersionSpec = { rule: "pinned" };

/** The version spec that applies to `member` in `contract`: first match of the spec's precedence. */
export function chooseRule(contract: Contract, member: Member, user?: UserWorkspace): { spec: VersionSpec; source: RuleSource } {
  const levels: [VersionSpec | undefined, RuleSource][] = [
    [user?.versions[contract.name], "user-file"],
    [user?.versions[member.dir], "user-file"],
    [contract.version, "manifest"],
    [member.version, "manifest"],
  ];
  for (const [spec, source] of levels) if (spec) return { spec, source };
  return { spec: DEFAULT_RULE, source: "default" };
}

export interface VersionContext {
  contract: Contract;
  /** The reviewed member, as the manifest lists it. */
  reviewed: Member;
  /** The sibling being read. */
  member: Member;
  user?: UserWorkspace;
  /** Top level of the reviewed repository, and its head commit: where a `pin` is read. */
  reviewedDir: string;
  reviewedHead: string;
  /** Top level of the sibling's clone. */
  siblingDir: string;
}

const TIMEOUT_MS = 30_000;
/** An exact version: three numbers and optional pre-release and build parts. No range, no prefix, no `workspace:*`. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z][0-9A-Za-z.-]*)?(\+[0-9A-Za-z.-]+)?$/;

const text = (git: GitRunner, cwd: string, args: string[]) => {
  const out = git(args, { cwd, timeoutMs: TIMEOUT_MS });
  return out.status === 0 && !out.error ? out.stdout.trim() : undefined;
};

/** The commit a full ref name or SHA names in `dir`, or undefined. */
function commitOf(git: GitRunner, dir: string, name: string) {
  return text(git, dir, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${name}^{commit}`]);
}

const rolesIn = (contract: Contract, member: string) => new Set(contract.sides.filter((s) => s.member === member).map((s) => s.role));

type Attempt = { sha: string } | { why: string };

/** The `pinned` rule: the commit the consumer's own head says it uses. */
function pinned(spec: VersionSpec, ctx: VersionContext, git: GitRunner): Attempt {
  if (!rolesIn(ctx.contract, ctx.reviewed.dir).has("consumer"))
    return { why: `pinned reads a provider for a consumer, and ${ctx.reviewed.dir} is not a consumer in contract ${ctx.contract.name}` };
  if (!rolesIn(ctx.contract, ctx.member.dir).has("provider"))
    return { why: `pinned reads a provider for a consumer, and ${ctx.member.dir} is not a provider in contract ${ctx.contract.name}` };
  if (spec.ref !== undefined) {
    const sha = commitOf(git, ctx.siblingDir, spec.ref);
    return sha ? { sha } : { why: `the pinned ref "${spec.ref}" is not in ${ctx.member.dir}'s local refs` };
  }
  const pin = spec.pin;
  if (!pin) return { why: "no pin declared (neither a ref nor a pin with a file, key and tag)" };
  const blob = git(["cat-file", "blob", `${ctx.reviewedHead}:${pin.file}`], { cwd: ctx.reviewedDir, timeoutMs: TIMEOUT_MS });
  if (blob.status !== 0 || blob.error) return { why: `${pin.file} not found at the reviewed head` };
  let value: unknown;
  try {
    value = JSON.parse(blob.stdout);
  } catch {
    return { why: `${pin.file} at the reviewed head is not valid JSON` };
  }
  for (const key of pin.key) {
    if (typeof value !== "object" || value === null || Array.isArray(value) || !Object.hasOwn(value, key))
      return { why: `key ${JSON.stringify(pin.key)} not found in ${pin.file} at the reviewed head` };
    value = (value as Record<string, unknown>)[key];
  }
  if (typeof value !== "string") return { why: `key ${JSON.stringify(pin.key)} in ${pin.file} is not a string` };
  if (!EXACT_VERSION.test(value)) return { why: `${JSON.stringify(value)} in ${pin.file} is a range or not an exact version` };
  const tag = pin.tag.replaceAll("{version}", value);
  const sha = commitOf(git, ctx.siblingDir, `refs/tags/${tag}`);
  return sha ? { sha } : { why: `tag ${tag} is not in ${ctx.member.dir}'s local refs` };
}

/** `FETCH_HEAD`'s modification time in the sibling's git directories, newest first; "unknown" when it has none. */
function fetchedAt(git: GitRunner, dir: string): string {
  const times: number[] = [];
  for (const flag of ["--absolute-git-dir", "--git-common-dir"]) {
    const found = text(git, dir, ["rev-parse", flag]);
    if (!found) continue;
    try {
      times.push(statSync(join(resolve(dir, found), "FETCH_HEAD")).mtimeMs);
    } catch {
      // No FETCH_HEAD there.
    }
  }
  return times.length === 0 ? "unknown" : new Date(Math.max(...times)).toISOString();
}

/**
 * Resolves the version of one sibling for one contract. `local` and `tip` read what is there; `pinned`
 * reads the tag the reviewed head pins and otherwise falls back to `tip`, and `tip` without a
 * recorded remote default falls back to `local`. The reason of every fallback is in the result.
 */
export function resolveVersion(ctx: VersionContext, git: GitRunner = spawnGit): ResolvedVersion {
  const { spec, source } = chooseRule(ctx.contract, ctx.member, ctx.user);
  const result: ResolvedVersion = { contract: ctx.contract.name, member: ctx.member.dir, rule: spec.rule, ruleSource: source, readAs: spec.rule };
  const reasons: string[] = [];

  if (spec.rule === "pinned") {
    const attempt = pinned(spec, ctx, git);
    if ("sha" in attempt) return { ...result, sha: attempt.sha };
    reasons.push(attempt.why);
    result.readAs = "tip";
  }
  if (result.readAs === "tip") {
    const sha = commitOf(git, ctx.siblingDir, "refs/remotes/origin/HEAD");
    if (sha) return { ...result, sha, fetchedAt: fetchedAt(git, ctx.siblingDir), ...(reasons.length ? { fallback: `${reasons.join("; ")}; read tip instead` } : {}) };
    reasons.push(`${ctx.member.dir} records no remote default branch (refs/remotes/origin/HEAD)`);
    result.readAs = "local";
  }
  // readAs is "local": asked for, or the last fallback.
  const sha = commitOf(git, ctx.siblingDir, "HEAD");
  if (reasons.length) result.fallback = `${reasons.join("; ")}; read local HEAD instead`;
  if (!sha) return { ...result, unreadable: `${ctx.member.dir} has no commit at HEAD to read` };
  const dirty = text(git, ctx.siblingDir, ["status", "--porcelain", "--untracked-files=no"]);
  return { ...result, sha, ...(dirty ? { uncommitted: true } : {}) };
}
