import type { LedgerAccount, ReserveInput } from "./account-object";
import { findAccount, parseAccounts, type Account } from "./accounts";
import { fetchGithubJwks, TokenInvalid, verifyGithubToken, type GithubClaims, type JwksFetch } from "./oidc";
import { receiptPublicKeyPem, signReceipt } from "./receipt";

/** The Durable Object class must be exported from the Worker entry so the ACCOUNTS binding resolves. */
export { LedgerAccount } from "./account-object";

/**
 * The HTTP surface of the ledger (ADR 0021, ADR 0022). Snake_case JSON on the wire, one `switch`
 * on method and path. Every route but `/v1/public-key` needs a GitHub OIDC bearer token.
 */
export interface WorkerEnv {
  ACCOUNTS: DurableObjectNamespace<LedgerAccount>;
  /** The OIDC audience callers request, compared exactly. Empty refuses every request. */
  LEDGER_AUDIENCE: string;
  /** Secret: the account table, JSON. */
  ACCOUNTS_JSON: string;
  /** Secret: Ed25519 private key (JWK as a JSON string) that signs receipts. */
  RECEIPT_PRIVATE_KEY_JWK: string;
  /** The matching public key (JWK as a JSON string); the PEM served to verifiers is derived from it. */
  RECEIPT_PUBLIC_KEY_JWK: string;
  /** Tests only: a JWKS URL used instead of GitHub's. */
  JWKS_URL?: string;
}

const json = (body: unknown, status = 200): Response => Response.json(body, { status });

/** Verifies the bearer token, or returns the 401 to send. */
async function authenticate(request: Request, env: WorkerEnv): Promise<GithubClaims | Response> {
  const unauthorized = (detail: string) => json({ reason: "unauthorized", detail }, 401);
  if (!env.LEDGER_AUDIENCE) return unauthorized("LEDGER_AUDIENCE is not set");
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/i.exec(header);
  if (!match) return unauthorized("missing bearer token");
  const jwks: JwksFetch = env.JWKS_URL
    ? async () => {
        const res = await fetch(env.JWKS_URL as string);
        if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
        return (await res.json()) as { keys: JsonWebKey[] };
      }
    : fetchGithubJwks;
  try {
    return await verifyGithubToken(match[1] as string, env.LEDGER_AUDIENCE, jwks);
  } catch (e) {
    if (e instanceof TokenInvalid) return unauthorized(e.message);
    return json({ reason: "unavailable", detail: "token verification could not run" }, 503);
  }
}

async function bodyOf(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const isAmount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const badRequest = (detail: string) => json({ reason: "bad_request", detail }, 400);

async function reserve(request: Request, env: WorkerEnv, accounts: Account[], claims: GithubClaims): Promise<Response> {
  const link = findAccount(accounts, claims.repository_id);
  if (!link) return json({ reason: "not_linked", repository: claims.repository }, 403);
  const body = await bodyOf(request);
  if (!body || !isAmount(body.wanted_usd) || typeof body.trigger !== "string") {
    return badRequest("wanted_usd (number >= 0) and trigger (string) are required");
  }
  if (body.caller_limit_usd !== undefined && !isAmount(body.caller_limit_usd)) {
    return badRequest("caller_limit_usd must be a number >= 0");
  }
  const input: ReserveInput = {
    repository_id: claims.repository_id,
    repository: claims.repository,
    run_id: claims.run_id,
    run_attempt: claims.run_attempt,
    trigger: body.trigger,
    // An automatic trigger cannot force, whatever the body says.
    forced: body.forced === true && claims.event_name === "issue_comment",
    wanted_usd: body.wanted_usd,
    account_limit_usd: link.account.limit_usd,
    ...(body.caller_limit_usd !== undefined ? { caller_limit_usd: body.caller_limit_usd } : {}),
    ...(link.repository.limit_usd !== undefined ? { repository_limit_usd: link.repository.limit_usd } : {}),
  };
  const result = await env.ACCOUNTS.get(env.ACCOUNTS.idFromName(link.account.account_id)).reserve(input);
  const { ok, ...rest } = result;
  return json(rest, ok ? 200 : 402);
}

async function settle(request: Request, env: WorkerEnv, accounts: Account[], claims: GithubClaims): Promise<Response> {
  const link = findAccount(accounts, claims.repository_id);
  if (!link) return json({ reason: "not_linked", repository: claims.repository }, 403);
  const body = await bodyOf(request);
  if (!body || typeof body.reservation_id !== "string" || !isAmount(body.spent_usd)) {
    return badRequest("reservation_id (string) and spent_usd (number >= 0) are required");
  }
  const settled = await env.ACCOUNTS.get(env.ACCOUNTS.idFromName(link.account.account_id)).settle({
    reservation_id: body.reservation_id,
    repository_id: claims.repository_id,
    spent_usd: body.spent_usd,
  });
  if (!settled.ok) return json({ reason: "not_found" }, 404);
  const entry = settled.entry;
  const receipt = {
    account: link.account.account_id,
    repository: entry.repository,
    run_id: entry.run_id,
    usd: entry.settled_usd as number,
    day: entry.day,
  };
  const signature = await signReceipt(receipt, JSON.parse(env.RECEIPT_PRIVATE_KEY_JWK) as JsonWebKey);
  return json({ receipt, signature });
}

async function today(env: WorkerEnv, accounts: Account[], claims: GithubClaims): Promise<Response> {
  const link = findAccount(accounts, claims.repository_id);
  if (!link) return json({ reason: "not_linked", repository: claims.repository }, 403);
  const out = await env.ACCOUNTS.get(env.ACCOUNTS.idFromName(link.account.account_id)).today(link.account.limit_usd);
  // The object knows no tags: fold its per-repository totals through the table. A repository
  // with several tags counts in each, so the tag totals can add up to more than spent_usd.
  const tagsOf = new Map(link.account.repositories.map((r) => [r.repository, r.tags ?? []]));
  const byTag = new Map<string, number>();
  for (const r of out.by_repository) {
    for (const tag of tagsOf.get(r.repository) ?? []) byTag.set(tag, (byTag.get(tag) ?? 0) + r.usd);
  }
  const by_tag = [...byTag].map(([tag, usd]) => ({ tag, usd })).sort((a, b) => b.usd - a.usd || a.tag.localeCompare(b.tag));
  return json({ ...out, account: link.account.account_id, by_tag });
}

async function publicKey(env: WorkerEnv): Promise<Response> {
  const jwk = JSON.parse(env.RECEIPT_PUBLIC_KEY_JWK) as JsonWebKey;
  return json({ alg: "Ed25519", jwk, pem: await receiptPublicKeyPem(jwk) });
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const route = `${request.method} ${new URL(request.url).pathname}`;
    switch (route) {
      case "GET /v1/public-key":
        return publicKey(env);
      case "POST /v1/reserve":
      case "POST /v1/settle":
      case "GET /v1/today": {
        const claims = await authenticate(request, env);
        if (claims instanceof Response) return claims;
        let accounts: Account[];
        try {
          accounts = parseAccounts(env.ACCOUNTS_JSON);
        } catch {
          return json({ reason: "misconfigured", detail: "ACCOUNTS_JSON is invalid" }, 500);
        }
        if (route === "POST /v1/reserve") return reserve(request, env, accounts, claims);
        if (route === "POST /v1/settle") return settle(request, env, accounts, claims);
        return today(env, accounts, claims);
      }
      default:
        return json({ reason: "not_found" }, 404);
    }
  },
};
