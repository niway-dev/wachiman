/**
 * Thin wrapper over the `gh` CLI for the benchmark dataset scripts. Everything the dataset holds
 * comes from the GitHub API through `gh`; nothing here runs a model.
 */

export interface GhResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** Runs `gh <args>` once. Never throws: callers decide what a failure means. */
export async function ghRaw(args: string[]): Promise<GhResult> {
  const proc = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  return { ok: code === 0, stdout, stderr };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Seconds until the core rate limit resets; reading it does not spend any of it. */
async function secondsToReset(): Promise<number> {
  const r = await ghRaw(["api", "--hostname", "github.com", "rate_limit", "--jq", ".resources.core.reset"]);
  const reset = Number(r.stdout.trim());
  return Number.isFinite(reset) && reset > 0 ? Math.max(5, Math.ceil(reset - Date.now() / 1000) + 5) : 60;
}

let waiting: Promise<void> | null = null;
/** One shared wait when the rate limit is hit, so parallel workers do not each poll. */
function waitForRateLimit(): Promise<void> {
  waiting ??= (async () => {
    const s = await secondsToReset();
    console.error(`rate limit reached; waiting ${s}s`);
    await sleep(s * 1000);
    waiting = null;
  })();
  return waiting;
}

/** Runs `gh <args>` and retries transient failures (5xx, network) a few times, and waits out a rate limit. */
export async function gh(args: string[], tries = 4): Promise<GhResult> {
  let last: GhResult = { ok: false, stdout: "", stderr: "not run" };
  for (let i = 0; i < tries; i++) {
    last = await ghRaw(args);
    if (last.ok) return last;
    if (/rate limit/i.test(last.stderr)) {
      await waitForRateLimit();
      i--;
      continue;
    }
    // A 404 or 403 on a resource is an answer, not a transient error.
    if (/HTTP (404|403|410|451)/.test(last.stderr) && !/rate limit/i.test(last.stderr)) return last;
    await sleep(1500 * (i + 1));
  }
  return last;
}

/** `gh api --paginate --slurp <endpoint>`: all pages of an array endpoint, flattened. */
export async function ghPaginate<T = unknown>(endpoint: string): Promise<{ ok: true; items: T[] } | { ok: false; error: string }> {
  const r = await gh(["api", "--hostname", "github.com", "--paginate", "--slurp", endpoint]);
  if (!r.ok) return { ok: false, error: r.stderr.trim() };
  const pages = JSON.parse(r.stdout) as unknown[];
  const items: T[] = [];
  for (const page of pages) {
    if (Array.isArray(page)) items.push(...(page as T[]));
    else items.push(page as T);
  }
  return { ok: true, items };
}

export async function ghJson<T = unknown>(endpoint: string): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  const r = await gh(["api", "--hostname", "github.com", endpoint]);
  if (!r.ok) return { ok: false, error: r.stderr.trim() };
  return { ok: true, value: JSON.parse(r.stdout) as T };
}

/** Runs `fn` over `items` with at most `limit` in flight. */
export async function pool<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
