/**
 * Which account a review runs on (ADR 0029): profile names, and the precedence that turns a flag,
 * a project binding, an environment variable and a configured default into one profile.
 *
 * Nothing here touches the disk or the environment: `resolveProfile` is a pure function of what
 * it is handed, so a test can cover every rung. A rung with a value that does not resolve fails
 * there; it never falls through to a lower rung, because the one outcome this must prevent is a
 * review reaching the wrong account.
 */
import { join } from "node:path";
import { UsageError } from "../config";
import type { ProfileEntry } from "./config";

/** A registered or managed profile's name; `default` is a built-in, never a name. */
export const PROFILE_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** The name a bare `isolated` and a bare `--setup-profile` mean. */
export const ISOLATED_NAME = "isolated";

export function checkProfileName(name: string) {
  if (!PROFILE_NAME.test(name)) {
    throw new UsageError(
      `"${name}" is not a profile name: use 1 to 32 lowercase letters, digits or dashes, starting with a letter or digit.`,
    );
  }
  return name;
}

/**
 * What a spelling asks for. `isolated` and `isolated:<n>` name a managed profile only; a bare name
 * is a registered profile of either kind, or an unregistered managed directory.
 */
export type ParsedProfileRef = { kind: "default" } | { kind: "name"; name: string; managedOnly: boolean };

/** `default`, `isolated`, `isolated:<name>` or a profile name; anything else is a usage error. */
export function parseProfileRef(value: string): ParsedProfileRef {
  if (value === "default") return { kind: "default" };
  if (value === ISOLATED_NAME) return { kind: "name", name: ISOLATED_NAME, managedOnly: true };
  if (value.startsWith("isolated:")) return { kind: "name", name: checkProfileName(value.slice("isolated:".length)), managedOnly: true };
  return { kind: "name", name: checkProfileName(value), managedOnly: false };
}

export type ProfileRef =
  | { kind: "default" }
  | { kind: "managed"; name: string; configDir: string; registered: boolean }
  | { kind: "external"; name: string; configDir: string; binary?: string };

/** Where a name is looked up: the registered entries, then `<home>/claude-<name>`. */
export interface ProfileLookup {
  profiles: Record<string, ProfileEntry>;
  home: string;
  managedDirExists: (name: string) => boolean;
}

/** The profile a spelling names, or why it names nothing. */
export function lookupProfileRef(value: string, lookup: ProfileLookup): { ok: true; profile: ProfileRef } | { ok: false; problem: string } {
  let parsed: ParsedProfileRef;
  try {
    parsed = parseProfileRef(value);
  } catch (error) {
    return { ok: false, problem: error instanceof Error ? error.message : String(error) };
  }
  if (parsed.kind === "default") return { ok: true, profile: { kind: "default" } };
  const { name, managedOnly } = parsed;
  const entry = Object.hasOwn(lookup.profiles, name) ? lookup.profiles[name] : undefined;
  if (entry) {
    if (entry.kind === "managed") return { ok: true, profile: { kind: "managed", name, configDir: entry.configDir, registered: true } };
    if (managedOnly) {
      return { ok: false, problem: `"${value}" names a managed profile, but "${name}" is registered as an external profile; use --profile ${name}.` };
    }
    return { ok: true, profile: { kind: "external", name, configDir: entry.configDir, ...(entry.binary ? { binary: entry.binary } : {}) } };
  }
  if (lookup.managedDirExists(name)) {
    return { ok: true, profile: { kind: "managed", name, configDir: join(lookup.home, `claude-${name}`), registered: false } };
  }
  return {
    ok: false,
    problem: `profile "${name}" is not registered and ${join(lookup.home, `claude-${name}`)} does not exist; run \`wachiman profile list\`, or \`wachiman --setup-profile ${name}\` to create it.`,
  };
}
