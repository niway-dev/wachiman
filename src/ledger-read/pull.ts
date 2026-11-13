/**
 * `GET /v1/entries`: the only network request the laptop makes to the ledger, made only by
 * `wachiman ledger pull` and by `--refresh`. The fetch function is injected so tests use no network.
 * Errors never include the token.
 */
import { UsageError } from "../config";
import { resolveCredentials } from "./credentials";
import { storePull } from "./files";
import { parseEntriesResponse } from "./types";

export const DEFAULT_PULL_DAYS = 35;
export const MAX_PULL_DAYS = 92;
const TIMEOUT_MS = 30_000;

export interface PullDeps {
  fetch: typeof fetch;
  now: () => Date;
}
export const realPullDeps: PullDeps = { fetch: (input, init) => fetch(input, init), now: () => new Date() };

export interface PullResult {
  account: string;
  from: string;
  to: string;
  entries: number;
  daysWritten: number;
  url: string;
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export async function pullLedger(home: string, env: Record<string, string | undefined>, sinceDays: number | undefined, deps: PullDeps = realPullDeps): Promise<PullResult> {
  const credentials = resolveCredentials(home, env);
  if (!credentials) throw new UsageError("No ledger is connected: run `wachiman ledger connect <url>` first.");
  const days = sinceDays ?? DEFAULT_PULL_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > MAX_PULL_DAYS) throw new UsageError(`--since takes 1 to ${MAX_PULL_DAYS} days, got ${days}.`);
  const now = deps.now();
  const to = dayOf(now);
  const from = dayOf(new Date(now.getTime() - (days - 1) * 86_400_000));
  const url = `${credentials.url}/v1/entries?from=${from}&to=${to}`;
  let res: Response;
  try {
    res = await deps.fetch(url, { headers: { authorization: `Bearer ${credentials.token}`, accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new Error(`could not reach the ledger at ${credentials.url}: ${error instanceof Error ? error.name : "network error"}`);
  }
  if (res.status === 401) throw new Error("the ledger refused the read token (401); run `wachiman ledger connect <url>` with a valid one.");
  if (!res.ok) throw new Error(`the ledger answered HTTP ${res.status}.`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error("the ledger answer is not JSON.");
  }
  const response = (() => {
    try {
      return parseEntriesResponse(body);
    } catch (error) {
      throw new Error(`unexpected ledger answer: ${error instanceof Error ? error.message : "invalid"}.`);
    }
  })();
  const stored = storePull(home, response, from, to, now.toISOString());
  return { account: response.account, from, to, entries: stored.entries, daysWritten: stored.daysWritten, url: credentials.url };
}
