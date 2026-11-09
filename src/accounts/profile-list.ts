/**
 * What `profile list` shows and `doctor --all-profiles` walks: the registered profiles plus the
 * managed directories under the Wachiman home that no entry names, and which repositories use each.
 * It looks at the home's listing only; it opens nothing inside any profile directory.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { WachimanConfigV1 } from "./config";
import { parseProfileRef, type ProfileRef } from "./resolve";

export const managedDir = (home: string, name: string) => join(home, `claude-${name}`);

/** Whether a stored profile reference (`work-a`, `isolated:work-a`) names `name`. */
export function refersTo(ref: string, name: string) {
  try {
    const parsed = parseProfileRef(ref);
    return parsed.kind === "name" && parsed.name === name;
  } catch {
    return false;
  }
}

/** The repositories (keys) whose binding names `name`. */
export function usedBy(config: WachimanConfigV1 | undefined, name: string) {
  return Object.entries(config?.projects ?? {})
    .filter(([, binding]) => refersTo(binding.profile, name))
    .map(([key]) => key);
}

export interface ProfileListEntry {
  name: string;
  kind: ProfileRef["kind"];
  configDir?: string;
  binary?: string;
  registered: boolean;
  usedBy: string[];
}

export interface ProfileList {
  format: "wachiman.profiles/1";
  defaultProfile?: string;
  profiles: ProfileListEntry[];
}

/** Registered profiles plus the `claude-*` directories under the home that no entry names. Looks at the home's listing only. */
export function buildProfileList(home: string, config: WachimanConfigV1 | undefined): ProfileList {
  const profiles: ProfileListEntry[] = Object.entries(config?.profiles ?? {}).map(([name, entry]) => ({
    name,
    kind: entry.kind,
    configDir: entry.configDir,
    ...(entry.kind === "external" && entry.binary ? { binary: entry.binary } : {}),
    registered: true,
    usedBy: usedBy(config, name),
  }));
  let names: string[] = [];
  try {
    names = readdirSync(home, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith("claude-"))
      .map((d) => d.name.slice("claude-".length))
      .filter((n) => /^[a-z0-9][a-z0-9-]{0,31}$/.test(n) && !Object.hasOwn(config?.profiles ?? {}, n))
      .sort();
  } catch {
    // No home yet: nothing unregistered.
  }
  for (const name of names) {
    profiles.push({ name, kind: "managed", configDir: managedDir(home, name), registered: false, usedBy: usedBy(config, name) });
  }
  return { format: "wachiman.profiles/1", ...(config?.defaultProfile !== undefined ? { defaultProfile: config.defaultProfile } : {}), profiles };
}

