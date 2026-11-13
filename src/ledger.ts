/**
 * The client of the spend ledger service: one synchronous call to reserve before a run, one to
 * settle after it (or to record a run that could not reserve), and the signed receipt that settling
 * returns. Like `gh`, the network goes through a binary the runner has (`curl`), so the engine stays
 * synchronous and dependency-free (ADR 0002). Imports only `node:` builtins.
 *
 * What may leave the machine is fixed by this file: a reserve carries amounts, the trigger and the
 * pull request number; a settle or record carries the amount spent and the calls the engine
 * already prints as `wachiman-cost` lines. No code, no finding text, no title, no credential.
 */
import { spawnSync } from "node:child_process";
import { createPublicKey, verify } from "node:crypto";

/**
 * `curl`'s exit status and output; the HTTP status is read from the output (see `call`). `stdin` is the
 * text curl reads as its configuration (`--config -`): every secret and every payload travels there,
 * never in `args`, because the argument list of a process is readable by every other process on the
 * machine and capped at 128 KB per argument. Copy this split for any new route.
 */
export type CurlFn = (args: string[], stdin?: string) => { status: number; stdout: string; stderr: string };

/** Twenty seconds at most, and no redirect is followed (curl's default: no `--location`). */
export const defaultCurl: CurlFn = (args, stdin) => {
  const run = spawnSync("curl", ["--silent", "--show-error", "--max-time", "20", ...args], { encoding: "utf8", input: stdin });
  return { status: run.status ?? 1, stdout: run.stdout ?? "", stderr: run.stderr ?? run.error?.message ?? "" };
};

const ESCAPES: Record<string, string> = { "\\": "\\\\", '"': '\\"', "\t": "\\t", "\n": "\\n", "\r": "\\r", "\v": "\\v" };

/**
 * One curl configuration file (`curl --config -`): `option = "value"` lines. Inside the double quotes
 * curl reads `\\`, `\"`, `\t`, `\n`, `\r` and `\v` as escapes, so these are the only characters changed.
 */
export const curlConfig = (entries: [option: string, value: string][]): string =>
  entries.map(([option, value]) => `${option} = "${value.replace(/[\\"\t\n\r\v]/g, (c) => ESCAPES[c]!)}"\n`).join("");

export interface LedgerEnv {
  ACTIONS_ID_TOKEN_REQUEST_URL?: string;
  ACTIONS_ID_TOKEN_REQUEST_TOKEN?: string;
}

/** The ledger cannot answer: a network error, a timeout, a 5xx or a 429. Only these are an outage. */
export class LedgerUnavailable extends Error {}

/**
 * Something answered, but not the way the ledger does: a redirect, a 400, 404 or 405, a 200 whose body
 * is not the documented JSON, a grant that is not a sane amount. That is a wrong `ledger_url` or a
 * broken service, not an outage, so `ledger_unavailable` does not apply: the run stops. The message is
 * ready to show.
 */
export class LedgerBadAnswer extends Error {}

/**
 * The job cannot ask the ledger at all: it holds no OIDC request token. A configuration error that
 * retrying does not fix, so it is not an outage (`ledger_unavailable` does not apply to it).
 */
export class LedgerNotPermitted extends Error {}

export type RefusalReason = "limit" | "weekly_limit" | "repository_limit" | "not_linked" | "unauthorized";

export interface Refusal {
  reason: RefusalReason;
  period?: "day" | "week";
  accountSpentUsd?: number;
  accountLimitUsd?: number;
  day?: string;
  week?: string;
  resetsAt?: string;
}

/** The ledger answered and said no. */
export class LedgerRefused extends Error {
  constructor(readonly refusal: Refusal) {
    super(`The ledger refused the run: ${refusal.reason}.`);
  }
}

export interface Reservation {
  reservationId: string;
  grantedUsd: number;
  accountLeftUsd: number;
  repositoryLeftUsd: number | null;
  day: string;
  week: string;
  weekLeftUsd: number | null;
}

export interface Receipt {
  account: string;
  repository: string;
  run_id: string;
  usd: number;
  day: string;
}

export interface ReserveRequest {
  wantedUsd: number;
  callerLimitUsd?: number;
  callerWeeklyLimitUsd?: number;
  trigger: string;
  forced: boolean;
  pr?: number;
}

/** One model call, with the field names of the `wachiman-cost` line (`ledgerCall` in `cost.ts`). */
export interface LedgerCall {
  operation: string;
  label: string;
  model: string;
  turns: number;
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number | null;
  costKnown: boolean;
  terminal_reason: string;
  auth: string;
}

const b64url = (text: string) => Buffer.from(text, "utf8").toString("base64url");

/** The ledger url as configured, minus any trailing slashes, so `${base}/v1/...` has one slash. */
const base = (ledgerUrl: string) => ledgerUrl.replace(/\/+$/, "");

/** Whether an HTTP status means "try later": a server error or a rate limit. Anything else unexpected is not an outage. */
const isOutage = (status: number) => status >= 500 || status === 429;

/** The error for an answer the client cannot use: an outage for 5xx and 429, a wrong-address problem for the rest. */
function unusable(route: string, status: number, what: string): Error {
  return isOutage(status)
    ? new LedgerUnavailable(`The ledger could not ${what} (HTTP ${status}).`)
    : new LedgerBadAnswer(
        `\`ledger_url\` does not look like the spend ledger: POST ${route} answered HTTP ${status}, not the documented answer. Check that \`ledger_url\` is the ledger's address.`,
      );
}

/**
 * One request. `args` ends with the url; `secret` is what must not appear in argv (headers, data) and
 * goes to curl on stdin. The HTTP status is the last line of the output (`-w "\n%{http_code}"`).
 */
function call(curl: CurlFn, args: string[], secret: [option: string, value: string][]): { status: number; body: string } {
  const run = curl(["--config", "-", "-o", "-", "-w", "\n%{http_code}", ...args], curlConfig(secret));
  if (run.status !== 0) throw new LedgerUnavailable(`curl failed (exit ${run.status}): ${run.stderr.trim()}`);
  const cut = run.stdout.lastIndexOf("\n");
  const status = Number(run.stdout.slice(cut + 1).trim());
  if (cut < 0 || !Number.isInteger(status)) throw new LedgerUnavailable("curl returned no HTTP status.");
  return { status, body: run.stdout.slice(0, cut) };
}

const parseObject = (body: string): Record<string, unknown> | undefined => {
  try {
    const value: unknown = JSON.parse(body);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
};

const post = (ledgerUrl: string, route: string, token: string, payload: unknown, curl: CurlFn) =>
  call(curl, ["-X", "POST", `${base(ledgerUrl)}${route}`], [
    ["header", `Authorization: Bearer ${token}`],
    ["header", "Content-Type: application/json"],
    ["data", JSON.stringify(payload)],
  ]);

/**
 * A GitHub OIDC token for `audience`. Needs `id-token: write` in the job, which only
 * `review-platform.yml` grants; without the request variables there is nothing to retry.
 */
export function requestIdToken(env: LedgerEnv, audience: string, curl: CurlFn): string {
  const url = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) throw new LedgerNotPermitted("this job has no OIDC token: id-token: write is not granted");
  const { status, body } = call(curl, [`${url}&audience=${encodeURIComponent(audience)}`], [["header", `Authorization: Bearer ${bearer}`]]);
  const value = parseObject(body)?.value;
  if (status !== 200 || typeof value !== "string" || value === "") {
    if (isOutage(status)) throw new LedgerUnavailable(`GitHub did not issue an id token (HTTP ${status}).`);
    throw new LedgerBadAnswer(
      `GitHub did not issue an OIDC token for the ledger (HTTP ${status}). Check that the job has \`id-token: write\` and calls review-platform.yml.`,
    );
  }
  return value;
}

const REASONS: readonly RefusalReason[] = ["limit", "weekly_limit", "repository_limit", "not_linked", "unauthorized"];
const DEFAULT_REASON: Record<number, RefusalReason> = { 402: "limit", 401: "unauthorized", 403: "not_linked" };

/** A refusal from the documented JSON, or from the status alone when the body is something else. */
function refusalOf(status: number, body: string): Refusal | null {
  const json = parseObject(body) ?? {};
  const reason = REASONS.find((r) => r === json.reason) ?? DEFAULT_REASON[status];
  if (!reason) return null;
  const refusal: Refusal = { reason };
  if (json.period === "day" || json.period === "week") refusal.period = json.period;
  if (typeof json.accountSpentUsd === "number") refusal.accountSpentUsd = json.accountSpentUsd;
  if (typeof json.accountLimitUsd === "number") refusal.accountLimitUsd = json.accountLimitUsd;
  if (typeof json.day === "string") refusal.day = json.day;
  if (typeof json.week === "string") refusal.week = json.week;
  if (typeof json.resetsAt === "string") refusal.resetsAt = json.resetsAt;
  return refusal;
}

export function reserve(ledgerUrl: string, token: string, req: ReserveRequest, curl: CurlFn): Reservation {
  const payload = {
    wantedUsd: req.wantedUsd,
    ...(req.callerLimitUsd === undefined ? {} : { callerLimitUsd: req.callerLimitUsd }),
    ...(req.callerWeeklyLimitUsd === undefined ? {} : { callerWeeklyLimitUsd: req.callerWeeklyLimitUsd }),
    trigger: req.trigger,
    forced: req.forced,
    ...(req.pr === undefined ? {} : { pr: req.pr }),
  };
  const { status, body } = post(ledgerUrl, "/v1/reserve", token, payload, curl);
  if (status >= 400 && status < 500) {
    const refusal = refusalOf(status, body);
    if (refusal) throw new LedgerRefused(refusal);
  }
  const json = parseObject(body);
  if (status !== 200 || !json || typeof json.reservationId !== "string" || typeof json.grantedUsd !== "number") {
    throw unusable("/v1/reserve", status, "reserve");
  }
  // A grant that is not a finite, non-negative amount is a malformed answer: never a budget.
  if (!Number.isFinite(json.grantedUsd) || json.grantedUsd < 0) {
    throw new LedgerBadAnswer(
      `\`ledger_url\` does not look like the spend ledger: POST /v1/reserve granted ${String(json.grantedUsd)}, which is not an amount. Check that \`ledger_url\` is the ledger's address.`,
    );
  }
  return {
    reservationId: json.reservationId,
    grantedUsd: json.grantedUsd,
    accountLeftUsd: Number(json.accountLeftUsd),
    repositoryLeftUsd: typeof json.repositoryLeftUsd === "number" ? json.repositoryLeftUsd : null,
    day: String(json.day),
    week: String(json.week),
    weekLeftUsd: typeof json.weekLeftUsd === "number" ? json.weekLeftUsd : null,
  };
}

export function settle(
  ledgerUrl: string,
  token: string,
  reservationId: string,
  spentUsd: number,
  calls: LedgerCall[],
  curl: CurlFn,
): { receipt: Receipt; signature: string } {
  const { status, body } = post(ledgerUrl, "/v1/settle", token, { reservationId, spentUsd, calls }, curl);
  const json = parseObject(body);
  const receipt = json?.receipt;
  if (status !== 200 || !isReceipt(receipt) || typeof json?.signature !== "string") {
    throw unusable("/v1/settle", status, "settle");
  }
  return { receipt, signature: json.signature };
}

/**
 * Records a run that could not reserve because the ledger was unreachable, now that it may be
 * reachable again. Stored apart from reserved runs; idempotent per run on the server.
 */
export function record(
  ledgerUrl: string,
  token: string,
  run: { spentUsd: number; calls: LedgerCall[]; trigger: string; pr?: number },
  curl: CurlFn,
): void {
  const payload = {
    spentUsd: run.spentUsd,
    calls: run.calls,
    trigger: run.trigger,
    ...(run.pr === undefined ? {} : { pr: run.pr }),
    reason: "unreserved",
  };
  const { status } = post(ledgerUrl, "/v1/record", token, payload, curl);
  if (status !== 200) throw unusable("/v1/record", status, "record the run");
}

function isReceipt(value: unknown): value is Receipt {
  const r = value as Record<string, unknown> | null;
  return (
    typeof r === "object" &&
    r !== null &&
    typeof r.account === "string" &&
    typeof r.repository === "string" &&
    typeof r.run_id === "string" &&
    typeof r.usd === "number" &&
    typeof r.day === "string"
  );
}

export const receiptFooter = (receipt: Receipt, signature: string) => `<!-- wachi:receipt ${b64url(JSON.stringify(receipt))}.${signature} -->`;

const RECEIPT_LINE = /<!-- wachi:receipt ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+) -->/g;

/** The last receipt line in `body`, or null when there is none or it is damaged. */
export function readReceipt(body: string): { receipt: Receipt; signature: string } | null {
  const last = [...body.matchAll(RECEIPT_LINE)].pop();
  if (!last) return null;
  try {
    const receipt: unknown = JSON.parse(Buffer.from(last[1]!, "base64url").toString("utf8"));
    return isReceipt(receipt) ? { receipt, signature: last[2]! } : null;
  } catch {
    return null;
  }
}

/** The bytes the ledger signs: JSON with keys in a fixed order (shared contract with the Worker). */
export const canonicalReceipt = (r: Receipt): Uint8Array =>
  new TextEncoder().encode(JSON.stringify({ account: r.account, repository: r.repository, run_id: r.run_id, usd: r.usd, day: r.day }));

/** Whether `signature` (base64url Ed25519) is the ledger's over `receipt`. A bad key or signature is false. */
export function verifyReceipt(receipt: Receipt, signature: string, publicKeyPem: string): boolean {
  try {
    return verify(null, canonicalReceipt(receipt), createPublicKey(publicKeyPem), Buffer.from(signature, "base64url"));
  } catch {
    return false;
  }
}
