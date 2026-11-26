/**
 * The consent store and the one rule that decides whether a summary may be sent.
 *
 * The choice lives in the user's Wachiman home (`telemetry.json`), never in a repository, so a pull
 * request cannot turn it on. Unset (no file, or a file that is not exactly a choice) means never
 * asked, and never sends. See docs/specs/2026-11-24-optional-usage-telemetry-design.md.
 */
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { doNotTrack, usageDataAllowed } from "../tracking";

type Env = Record<string, string | undefined>;

export interface Consent {
  choice: "yes" | "no";
  /** A random v4 UUID, created on the first yes and kept across `off` and `on`. Never derived from anything. */
  installation?: string;
}

export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const consentPath = (home: string) => join(home, "telemetry.json");

/** The consent file exists but could not be read (not "missing"); writing over it would lose the stored choice and ID. */
export class ConsentUnreadableError extends Error {
  constructor(path: string, cause: unknown) {
    super(`wachiman: the telemetry choice at ${path} could not be read (${cause instanceof Error ? cause.message : String(cause)}); nothing was changed.`);
    this.name = "ConsentUnreadableError";
  }
}

/**
 * The stored choice; `undefined` when the file is missing or anything but a well-formed choice.
 * Throws `ConsentUnreadableError` when the file exists but cannot be read.
 */
export function readConsent(home: string): Consent | undefined {
  let parsed: unknown;
  let text: string;
  try {
    text = readFileSync(consentPath(home), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new ConsentUnreadableError(consentPath(home), error);
  }
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const { choice, installation } = parsed as Record<string, unknown>;
  if (choice !== "yes" && choice !== "no") return undefined;
  if (installation === undefined) return choice === "no" ? { choice } : undefined;
  if (typeof installation !== "string" || !UUID_V4.test(installation)) return undefined;
  return { choice, installation };
}

function writeConsent(home: string, consent: Consent): void {
  mkdirSync(home, { recursive: true });
  const path = consentPath(home);
  writeFileSync(path, `${JSON.stringify(consent)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Stores the answer. A yes keeps the installation ID that exists or makes one; a no keeps the one that exists and makes none. */
export function recordChoice(home: string, choice: "yes" | "no"): Consent {
  const existing = readConsent(home)?.installation;
  const installation = existing ?? (choice === "yes" ? randomUUID() : undefined);
  const consent: Consent = installation === undefined ? { choice } : { choice, installation };
  writeConsent(home, consent);
  return consent;
}

/** A new installation ID, the choice unchanged. `undefined` (and nothing written) when there is no ID to replace. */
export function resetInstallation(home: string): Consent | undefined {
  const existing = readConsent(home);
  if (existing?.installation === undefined) return undefined;
  const consent: Consent = { choice: existing.choice, installation: randomUUID() };
  writeConsent(home, consent);
  return consent;
}

const set = (value: string | undefined) => value !== undefined && value.trim() !== "";

/** What blocks sending right now, whatever the stored choice. Any non-empty `CI` or `GITHUB_ACTIONS` counts: it errs toward privacy. */
export function blockedBy(env: Env): string[] {
  const out: string[] = [];
  // `usageDataAllowed` is the one gate (CONTRIBUTING.md); `doNotTrack` is read here only to name it.
  if (!usageDataAllowed(env) && doNotTrack(env)) out.push("DO_NOT_TRACK");
  if (env.WACHIMAN_TELEMETRY?.trim() === "0") out.push("WACHIMAN_TELEMETRY=0");
  if (set(env.CI)) out.push("CI");
  if (set(env.GITHUB_ACTIONS)) out.push("GITHUB_ACTIONS");
  return out;
}

/** True only with a stored yes (and its installation ID) and nothing in the environment blocking it. Nothing turns it on without the yes. */
export function telemetryAllowed(env: Env, consent: Consent | undefined): boolean {
  if (consent?.choice !== "yes" || consent.installation === undefined) return false;
  return usageDataAllowed(env) && blockedBy(env).length === 0;
}
