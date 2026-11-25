/**
 * The per-user workspace file, `<Wachiman home>/workspaces.json` (spec "The per-user workspace
 * file"): where a manifest is, whether `--distributed-repo` is the default for it, where a member
 * is cloned when not inside the coordinator, which members are not watched, and version rules the
 * user sets for their own machine. Never committed. A missing file is an empty list; a key this
 * version does not know is ignored; a key it knows but cannot read is refused, because guessing
 * would widen what a review reads.
 */
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { UsageError } from "../config";
import { normaliseDir, parseVersionSpec, type VersionSpec } from "./manifest";

export class UserFileError extends UsageError {
  constructor(message: string) {
    super(message);
    this.name = "UserFileError";
  }
}

export interface UserMember {
  /** Where this member is cloned, when not inside the coordinator (absolute). */
  dir?: string;
  /** `false` leaves a cloned member out of every read, reported as "not watched". */
  watch?: boolean;
}

export interface UserWorkspace {
  /** Absolute path of the manifest file. */
  manifest: string;
  /** The default when no flag is given. */
  distributedRepo: "on" | "off";
  /** Keyed by the member's manifest `dir`. */
  members: Record<string, UserMember>;
  /** Keyed by a contract name or a member `dir`. */
  versions: Record<string, VersionSpec>;
}

export interface UserFile {
  version: 1;
  workspaces: UserWorkspace[];
}

export const USER_FILE_NAME = "workspaces.json";
export const userFilePath = (wachimanHome: string) => join(wachimanHome, USER_FILE_NAME);

/** An own entry of a record keyed by a name from a file (`constructor` and `toString` are names, not inherited functions). */
export const own = <T>(record: Record<string, T>, key: string): T | undefined => (Object.hasOwn(record, key) ? record[key] : undefined);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const refuse = (message: string) => new UserFileError(`${USER_FILE_NAME}: ${message}`);

function parseWorkspace(raw: unknown, index: number): UserWorkspace {
  const where = `workspaces[${index}]`;
  if (!isRecord(raw)) throw refuse(`${where} must be an object.`);
  if (typeof raw.manifest !== "string" || raw.manifest === "")
    throw refuse(`${where}.manifest must be the absolute path of a manifest file.`);
  if (!isAbsolute(raw.manifest)) throw refuse(`${where}.manifest must be an absolute path, got "${raw.manifest}".`);
  const distributedRepo = raw.distributedRepo ?? "off";
  if (distributedRepo !== "on" && distributedRepo !== "off")
    throw refuse(`${where}.distributedRepo must be "on" or "off", got ${JSON.stringify(raw.distributedRepo)}.`);
  const members: Record<string, UserMember> = Object.create(null);
  if (raw.members !== undefined) {
    if (!isRecord(raw.members)) throw refuse(`${where}.members must be an object keyed by member dir.`);
    for (const [name, value] of Object.entries(raw.members)) {
      const at = `${where}.members.${name}`;
      if (!isRecord(value)) throw refuse(`${at} must be an object.`);
      const member: UserMember = {};
      if (value.dir !== undefined) {
        if (typeof value.dir !== "string" || !isAbsolute(value.dir))
          throw refuse(`${at}.dir must be an absolute path, got ${JSON.stringify(value.dir)}.`);
        member.dir = value.dir;
      }
      if (value.watch !== undefined) {
        if (typeof value.watch !== "boolean") throw refuse(`${at}.watch must be true or false, got ${JSON.stringify(value.watch)}.`);
        member.watch = value.watch;
      }
      // Keyed like the manifest's normalised `dir`: `./app/` and `app` are one member.
      members[normaliseDir(name)] = member;
    }
  }
  const versions: Record<string, VersionSpec> = Object.create(null);
  if (raw.versions !== undefined) {
    if (!isRecord(raw.versions)) throw refuse(`${where}.versions must be an object keyed by contract name or member dir.`);
    for (const [name, value] of Object.entries(raw.versions)) versions[name] = parseVersionSpec(value, `${where}.versions.${name}`, refuse);
    // A key written as a member `dir` in the manifest (`./app/`) also answers to the normalised `dir`; a contract name is never replaced.
    for (const name of Object.keys(versions)) {
      const dir = normaliseDir(name);
      if (dir !== name && !Object.hasOwn(versions, dir)) versions[dir] = versions[name];
    }
  }
  return { manifest: raw.manifest, distributedRepo, members, versions };
}

export function parseUserFile(text: string): UserFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw refuse(`not valid JSON: ${(error as Error).message}`);
  }
  if (!isRecord(raw)) throw refuse("the file must hold a JSON object.");
  if (raw.version !== 1) throw refuse(`version must be 1, got ${JSON.stringify(raw.version)}.`);
  if (!Array.isArray(raw.workspaces)) throw refuse("workspaces must be a list.");
  return { version: 1, workspaces: raw.workspaces.map(parseWorkspace) };
}

/** Reads `<home>/workspaces.json`; a missing file is an empty list. `home` is `wachimanHome(env)`. */
export function readUserFile(home: string): UserFile {
  const path = userFilePath(home);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, workspaces: [] };
    throw new UserFileError(`Cannot read ${path}: ${(error as Error).message}`);
  }
  try {
    return parseUserFile(text);
  } catch (error) {
    if (error instanceof UserFileError) throw new UserFileError(`${path}: ${error.message.replace(`${USER_FILE_NAME}: `, "")}`);
    throw error;
  }
}
