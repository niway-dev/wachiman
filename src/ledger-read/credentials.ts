/**
 * The read credentials of the ledger: `<home>/ledger/credentials.json` (`{url, token}`, mode 0600),
 * or `WACHIMAN_LEDGER_URL` / `WACHIMAN_LEDGER_TOKEN`, which override the file field by field. The
 * token is written only here. It is never printed, logged or put in any other file (ADR 0039).
 */
import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { UsageError } from "../config";

export const ledgerDir = (home: string) => join(home, "ledger");
export const credentialsPath = (home: string) => join(ledgerDir(home), "credentials.json");

export interface LedgerCredentials {
  url: string;
  token: string;
}

/** The base URL of the ledger: https, or http only for a loopback address; no user info; no trailing slash. */
export function normaliseLedgerUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new UsageError(`"${raw}" is not a URL.`);
  }
  const loopback = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback)) throw new UsageError("The ledger URL must be https (http is accepted only for localhost).");
  if (u.username !== "" || u.password !== "") throw new UsageError("The ledger URL must not carry a user name or password.");
  u.hash = "";
  u.search = "";
  return u.toString().replace(/\/+$/, "");
}

/** Writes `text` to `path` at 0600 through a temporary name beside it, in a 0700 directory. */
export function writePrivateFile(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp-${process.pid}`;
  const fd = openSync(tmp, "w", 0o600);
  try {
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // Already gone.
    }
    throw error;
  }
}

export function writeCredentials(home: string, credentials: LedgerCredentials) {
  const url = normaliseLedgerUrl(credentials.url);
  if (credentials.token.trim() === "") throw new UsageError("The read token is empty.");
  writePrivateFile(credentialsPath(home), `${JSON.stringify({ url, token: credentials.token.trim() }, null, 2)}\n`);
}

/** True when a file was removed. */
export function deleteCredentials(home: string): boolean {
  try {
    unlinkSync(credentialsPath(home));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function readFile(home: string): Partial<LedgerCredentials> {
  let text: string;
  try {
    text = readFileSync(credentialsPath(home), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  try {
    const parsed = JSON.parse(text);
    return {
      ...(typeof parsed?.url === "string" ? { url: parsed.url } : {}),
      ...(typeof parsed?.token === "string" ? { token: parsed.token } : {}),
    };
  } catch {
    throw new UsageError(`${credentialsPath(home)} is not valid JSON; run \`wachiman ledger connect <url>\` again.`);
  }
}

/** The credentials in force (environment over file), or undefined when the ledger is not connected. */
export function resolveCredentials(home: string, env: Record<string, string | undefined>): LedgerCredentials | undefined {
  const file = readFile(home);
  const url = env.WACHIMAN_LEDGER_URL || file.url;
  const token = env.WACHIMAN_LEDGER_TOKEN || file.token;
  if (!url || !token) return undefined;
  return { url: normaliseLedgerUrl(url), token };
}
