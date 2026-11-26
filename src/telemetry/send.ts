/**
 * The one network call of the usage summary: one POST, one attempt, 2 seconds, every failure swallowed.
 * Nothing is queued on disk and nothing is printed; the review's output and exit code never depend
 * on it. The contract is docs/telemetry-api.md.
 */
import { MAX_SUMMARY_BYTES, serialiseSummary, type TelemetrySummary } from "./summary";

export const ENDPOINT = "https://usage.wachiman-api.dev/v1/usage";
export const TIMEOUT_MS = 2000;

type Env = Record<string, string | undefined>;

/** `WACHIMAN_TELEMETRY_URL` (for tests) when it is an https URL or a loopback http one; otherwise nothing. */
function endpointOf(env: Env): string | undefined {
  const set = env.WACHIMAN_TELEMETRY_URL;
  if (set === undefined || set === "") return ENDPOINT;
  try {
    const url = new URL(set);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return url.protocol === "https:" || (url.protocol === "http:" && loopback) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Sends `summary`. Resolves in at most about `TIMEOUT_MS`; never rejects, whatever the endpoint does. */
export async function sendSummary(summary: TelemetrySummary, opts: { env: Env; fetch?: typeof fetch }): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const url = endpointOf(opts.env);
    const body = serialiseSummary(summary);
    if (url === undefined || body === null || Buffer.byteLength(body) > MAX_SUMMARY_BYTES) return;
    const request = (opts.fetch ?? fetch)(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).then(
      () => undefined,
      () => undefined,
    );
    // The abort signal ends the request; this race is the guarantee when a stack ignores it.
    await Promise.race([request, new Promise<void>((resolve) => (timer = setTimeout(resolve, TIMEOUT_MS)))]);
  } catch {
    // Telemetry never fails a review.
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
