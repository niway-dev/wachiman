/**
 * The keys of `workspace.manifest.json` that Wachiman reads (spec "The manifest keys Wachiman
 * reads", ADR 0044). The workspace kit owns the file; any other key is ignored. Everything that
 * can name a place on disk is checked here, before a sibling is touched: a member `dir` or a path
 * glob that climbs out of its folder is refused, never cleaned up.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { UsageError } from "../config";

export const MANIFEST_FILE = "workspace.manifest.json";
/** The only `format` this version reads. */
export const MANIFEST_FORMAT = "workspace/1";

export type ManifestErrorCode = "unreadable" | "format" | "invalid" | "path-escape";

/** A manifest Wachiman refuses; the message names the file or key that is wrong. */
export class ManifestError extends UsageError {
  constructor(
    message: string,
    readonly code: ManifestErrorCode,
  ) {
    super(message);
    this.name = "ManifestError";
  }
}

export type VersionRuleName = "pinned" | "local" | "tip";
export const VERSION_RULES: readonly VersionRuleName[] = ["pinned", "local", "tip"];

/** Where a consumer declares the exact version of a provider, read from the reviewed head. */
export interface PinSpec {
  /** A JSON file in the reviewed repository, relative to its top level. */
  file: string;
  /** A path of literal keys, never a dotted string: package names contain dots. */
  key: string[];
  /** The sibling's tag, with `{version}` replaced by the pinned version. */
  tag: string;
}

/** A version rule as written in the manifest or in the per-user file. */
export interface VersionSpec {
  rule: VersionRuleName;
  /** `pinned` only: a literal ref of the sibling. */
  ref?: string;
  pin?: PinSpec;
}

export type Visibility = "public" | "private";

export interface Member {
  dir: string;
  repo: string;
  visibility: Visibility;
  version?: VersionSpec;
}

export type Role = "provider" | "consumer";

export interface ContractSide {
  member: string;
  role: Role;
  paths: string[];
}

export interface Contract {
  name: string;
  sides: ContractSide[];
  sourceOfTruth: { member: string; paths: string[] };
  version?: VersionSpec;
}

export interface Manifest {
  format: typeof MANIFEST_FORMAT;
  members: Member[];
  contracts: Contract[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const invalid = (message: string) => new ManifestError(message, "invalid");
const escape = (message: string) => new ManifestError(message, "path-escape");

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v !== "";

/** An absolute path in either flavour: `/x`, `\x`, `C:\x`, `C:/x`. A manifest is read on every platform. */
const looksAbsolute = (p: string) => isAbsolute(p) || /^([\\/]|[A-Za-z]:)/.test(p);

/** A `..` segment, also one inside a brace group (`{..,src}/a`). */
const climbs = (p: string) => /(^|[\\/{,])\.\.($|[\\/},])/.test(p);

/** A relative path or glob that stays below its folder; `where` names the key for the message. */
function assertContained(value: string, where: string) {
  if (looksAbsolute(value)) throw escape(`${where} "${value}" is an absolute path; it must be relative.`);
  if (climbs(value)) throw escape(`${where} "${value}" contains a ".." segment; it must stay inside its folder.`);
}

function parsePaths(raw: unknown, where: string): string[] {
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every(isNonEmptyString)) throw invalid(`${where} must be a non-empty list of path globs.`);
  for (const glob of raw as string[]) assertContained(glob, `${where} glob`);
  return [...(raw as string[])];
}

/**
 * Reads a `{ rule, ref?, pin? }` object. Shared with the per-user file, which uses the same shape;
 * `where` names the key in the message.
 */
export function parseVersionSpec(raw: unknown, where: string, fail: (message: string) => Error = invalid): VersionSpec {
  if (!isRecord(raw)) throw fail(`${where} must be an object with a "rule".`);
  const rule = raw.rule;
  if (typeof rule !== "string" || !VERSION_RULES.includes(rule as VersionRuleName))
    throw fail(`${where}.rule must be one of ${VERSION_RULES.join(", ")}, got ${JSON.stringify(rule)}.`);
  const spec: VersionSpec = { rule: rule as VersionRuleName };
  if (raw.ref !== undefined) {
    if (!isNonEmptyString(raw.ref) || raw.ref.startsWith("-")) throw fail(`${where}.ref must be a ref name, got ${JSON.stringify(raw.ref)}.`);
    spec.ref = raw.ref;
  }
  if (raw.pin !== undefined) {
    const pin = raw.pin;
    if (!isRecord(pin) || !isNonEmptyString(pin.file) || !isNonEmptyString(pin.tag)) throw fail(`${where}.pin must hold a "file" and a "tag".`);
    if (!Array.isArray(pin.key) || pin.key.length === 0 || !pin.key.every((k) => typeof k === "string"))
      throw fail(`${where}.pin.key must be a non-empty array of literal keys (a dotted string would break names such as "chart.js").`);
    if (looksAbsolute(pin.file) || climbs(pin.file)) throw fail(`${where}.pin.file "${pin.file}" must be a relative path without "..".`);
    spec.pin = { file: pin.file, key: [...(pin.key as string[])], tag: pin.tag };
  }
  return spec;
}

const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

/** The real path of `path`: its deepest existing ancestor is resolved and the missing segments are appended, so a member that is not cloned still compares by real path. */
function realOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(realOrSelf(parent), basename(path));
  }
}

/** `./app/` and `app` name one folder: strip leading `./` and trailing `/`, collapse `.` and doubled separators. */
const normaliseDir = (dir: string) => posix.normalize(dir.replaceAll("\\", "/")).replace(/^(\.\/)+/, "").replace(/\/+$/, "") || ".";

function parseMember(raw: unknown, index: number, coordinatorDir: string): Member {
  const where = `members[${index}]`;
  if (!isRecord(raw)) throw invalid(`${where} must be an object.`);
  if (!isNonEmptyString(raw.dir)) throw invalid(`${where}.dir must be a folder name relative to the coordinator.`);
  if (!isNonEmptyString(raw.repo)) throw invalid(`${where}.repo must be "owner/name".`);
  assertContained(raw.dir, `${where}.dir`);
  const dir = normaliseDir(raw.dir);
  const lexical = resolve(coordinatorDir, dir);
  if (!inside(resolve(coordinatorDir), lexical)) throw escape(`${where}.dir "${dir}" does not name a folder inside the coordinator.`);
  if (!inside(realOrSelf(coordinatorDir), realOrSelf(lexical)))
    throw escape(`${where}.dir "${dir}" resolves outside the coordinator (a symbolic link?); refusing to read it.`);
  const member: Member = { dir, repo: raw.repo, visibility: raw.visibility === "public" ? "public" : "private" };
  if (raw.version !== undefined) member.version = parseVersionSpec(raw.version, `${where}.version`);
  return member;
}

function parseContract(raw: unknown, index: number, dirs: Set<string>): Contract {
  const where = `contracts[${index}]`;
  if (!isRecord(raw)) throw invalid(`${where} must be an object.`);
  if (!isNonEmptyString(raw.name)) throw invalid(`${where}.name must be a non-empty string.`);
  const name = raw.name;
  const known = (member: unknown, at: string) => {
    if (!isNonEmptyString(member) || !dirs.has(member)) throw invalid(`${at} names member ${JSON.stringify(member)}, which is not in "members" (contract "${name}").`);
    return member;
  };
  if (!Array.isArray(raw.sides)) throw invalid(`${where}.sides must be a list (contract "${name}").`);
  const sides: ContractSide[] = raw.sides.map((side, i) => {
    const at = `${where}.sides[${i}]`;
    if (!isRecord(side)) throw invalid(`${at} must be an object.`);
    if (side.role !== "provider" && side.role !== "consumer") throw invalid(`${at}.role must be provider or consumer, got ${JSON.stringify(side.role)} (contract "${name}").`);
    return { member: known(side.member, `${at}.member`), role: side.role, paths: parsePaths(side.paths, `${at}.paths`) };
  });
  if (!sides.some((s) => s.role === "provider")) throw invalid(`Contract "${name}" has no provider side.`);
  if (!sides.some((s) => s.role === "consumer")) throw invalid(`Contract "${name}" has no consumer side.`);
  const source = raw.sourceOfTruth;
  if (!isRecord(source)) throw invalid(`${where}.sourceOfTruth must name a member and paths (contract "${name}").`);
  const contract: Contract = {
    name,
    sides,
    sourceOfTruth: { member: known(source.member, `${where}.sourceOfTruth.member`), paths: parsePaths(source.paths, `${where}.sourceOfTruth.paths`) },
  };
  if (raw.version !== undefined) contract.version = parseVersionSpec(raw.version, `${where}.version`);
  return contract;
}

/**
 * Validates a manifest. `coordinatorDir` is the folder that holds the file: member directories are
 * resolved against it, and one that leaves it (by `..`, by an absolute path, or by a symbolic link
 * that exists) is refused.
 */
export function parseManifest(text: string, coordinatorDir: string): Manifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw invalid(`${MANIFEST_FILE} is not valid JSON: ${(error as Error).message}`);
  }
  if (!isRecord(raw)) throw invalid(`${MANIFEST_FILE} must hold a JSON object.`);
  if (raw.format !== MANIFEST_FORMAT)
    throw new ManifestError(
      `${MANIFEST_FILE} has format ${raw.format === undefined ? "(no \"format\" key)" : JSON.stringify(raw.format)}; this version of Wachiman reads only "${MANIFEST_FORMAT}" and does not guess.`,
      "format",
    );
  if (!Array.isArray(raw.members)) throw invalid(`${MANIFEST_FILE}: "members" must be a list.`);
  const members = raw.members.map((m, i) => parseMember(m, i, coordinatorDir));
  const dirs = new Set<string>();
  for (const member of members) {
    if (dirs.has(member.dir)) throw invalid(`${MANIFEST_FILE}: member dir "${member.dir}" appears twice.`);
    dirs.add(member.dir);
  }
  const rawContracts = raw.contracts ?? [];
  if (!Array.isArray(rawContracts)) throw invalid(`${MANIFEST_FILE}: "contracts" must be a list.`);
  const contracts = rawContracts.map((c, i) => parseContract(c, i, dirs));
  const names = new Set<string>();
  for (const contract of contracts) {
    if (names.has(contract.name)) throw invalid(`${MANIFEST_FILE}: contract name "${contract.name}" appears twice.`);
    names.add(contract.name);
  }
  return { format: MANIFEST_FORMAT, members, contracts };
}

/** Reads and validates the manifest at `path`; its folder is the coordinator. */
export function readManifest(path: string): Manifest {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new ManifestError(`Cannot read ${path}: ${(error as Error).message}`, "unreadable");
  }
  return parseManifest(text, dirname(path));
}

/** True when `dir` holds a manifest file. */
export const hasManifest = (dir: string) => existsSync(resolve(dir, MANIFEST_FILE));
