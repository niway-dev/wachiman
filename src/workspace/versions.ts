/**
 * Which commit of a sibling a review reads (spec "Version rules", ADR 0044). One rule per
 * (contract, member), chosen by precedence; a rule that cannot be resolved falls back, never
 * silently: the result says what was asked, what was read, and why they differ. Only local git
 * reads happen here. Wachiman never fetches, pulls or clones (ADR 0019).
 */
import { statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { GitRunner } from "../evidence";
import { workspaceGit } from "./git";
import type { Contract, Member, VersionRuleName, VersionSpec } from "./manifest";
import { own, type UserWorkspace } from "./user-file";

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
  /** `local` only: `git status` failed or timed out, so whether the sibling has uncommitted changes is not known. */
  uncommittedUnknown?: boolean;
  /** `tip` only: when the sibling was last fetched (`FETCH_HEAD`'s modification time, ISO 8601), or `"unknown"`. */
  fetchedAt?: string;
}

const DEFAULT_RULE: VersionSpec = { rule: "pinned" };

/** The version spec that applies to `member` in `contract`: first match of the spec's precedence. */
export function chooseRule(contract: Contract, member: Member, user?: UserWorkspace): { spec: VersionSpec; source: RuleSource } {
  const levels: [VersionSpec | undefined, RuleSource][] = [
    [user && own(user.versions, contract.name), "user-file"],
    [user && own(user.versions, member.dir), "user-file"],
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

/** The commit a full ref name or SHA names in `dir`, or undefined. Callers pass a validated literal, never user text as an expression; the `^{commit}` is appended here. */
function commitOf(git: GitRunner, dir: string, name: string) {
  return text(git, dir, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${name}^{commit}`]);
}

/** A full object id: 40 hex digits (SHA-1) or 64 (SHA-256). */
const FULL_SHA = /^([0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
/** Revision syntax that would make a name an expression (`v1~1`, `a..b`, `main@{1}`) instead of a ref name. */
const REVISION_SYNTAX = /[~^:?*[\\]|@\{|\.\./;

/** Why `name` cannot be used as a literal ref name, or undefined when it can. */
function badRefName(git: GitRunner, dir: string, name: string): string | undefined {
  if (name === "" || REVISION_SYNTAX.test(name)) return `"${name}" is a revision expression, not a ref name`;
  const check = git(["check-ref-format", `refs/tags/${name}`], { cwd: dir, timeoutMs: TIMEOUT_MS });
  return check.status === 0 && !check.error ? undefined : `"${name}" is not a valid ref name`;
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
    if (FULL_SHA.test(spec.ref)) {
      const sha = commitOf(git, ctx.siblingDir, spec.ref);
      return sha ? { sha } : { why: `the pinned commit "${spec.ref}" is not in ${ctx.member.dir}'s local objects` };
    }
    const bad = badRefName(git, ctx.siblingDir, spec.ref);
    if (bad) return { why: `the pinned ref ${bad}` };
    for (const namespace of ["tags", "heads", "remotes"]) {
      const sha = commitOf(git, ctx.siblingDir, `refs/${namespace}/${spec.ref}`);
      if (sha) return { sha };
    }
    return { why: `the pinned ref "${spec.ref}" is not in ${ctx.member.dir}'s local refs` };
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
  const bad = badRefName(git, ctx.siblingDir, tag);
  if (bad) return { why: `the pin tag ${bad}` };
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
export function resolveVersion(ctx: VersionContext, git: GitRunner = workspaceGit): ResolvedVersion {
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
  // `text` gives undefined when git failed or timed out, and "" when the tree is clean: only the latter is clean.
  return { ...result, sha, ...(dirty === undefined ? { uncommittedUnknown: true } : dirty ? { uncommitted: true } : {}) };
}
