#!/usr/bin/env bun
/**
 * Snapshots the raw GitHub data behind every Wachiman, Pullfrog and CodeRabbit review in a list
 * of repositories, so the dataset can be rebuilt without the API (reviews are deleted, logs expire
 * after 90 days by default).
 *
 * Usage:
 *   bun scripts/benchmark-dataset/fetch.ts --repos niway-dev/kaipu-bench-wachi,niway-dev/kaipu-record \
 *     --out docs/benchmark/dataset/raw [--only-wachiman] [--logs] [--workflows "Agent review,Pullfrog"] [--refresh]
 *
 * Output, per pull request: <out>/<repo>/pr-<N>/{pr,review-comments,reviews,issue-comments,runs}.json,
 * <out>/<repo>/pr-<N>/logs/run-<id>.log.gz and a `meta.json` written last. A pull request whose
 * `updated_at` has not changed since its `meta.json` is skipped, so the script is idempotent and
 * cheap to re-run; `--refresh` forces a full re-fetch. <out>/<repo>/_index.json lists every pull
 * request seen, with what was kept, and <out>/<repo>/_runs.json is the repository's run list.
 *
 * Private repositories: point `--out` outside any git repository. This script never decides what
 * may be committed; the caller does.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { gh, ghPaginate, pool } from "./gh.ts";
import { hasWachimanSignature } from "./parse.ts";

interface Options {
  repos: string[];
  out: string;
  onlyWachiman: boolean;
  logs: boolean;
  refresh: boolean;
  concurrency: number;
  /** Workflow names or files whose runs are listed one by one, to get past the 1000-run cap. */
  workflows: string[];
  /** Pull requests kept even when --only-wachiman finds no signature, as "owner/repo#N". */
  keep: Set<string>;
}

function parseArgs(argv: string[]): Options {
  const o: Options = { repos: [], out: "", onlyWachiman: false, logs: false, refresh: false, concurrency: 4, keep: new Set(), workflows: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => argv[++i] ?? "";
    if (a === "--repos") o.repos = value().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--out") o.out = value();
    else if (a === "--only-wachiman") o.onlyWachiman = true;
    else if (a === "--logs") o.logs = true;
    else if (a === "--refresh") o.refresh = true;
    else if (a === "--concurrency") o.concurrency = Number(value()) || 4;
    else if (a === "--workflows") o.workflows = value().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--keep") for (const k of value().split(",")) o.keep.add(k.trim());
    else throw new Error(`unknown argument: ${a}`);
  }
  if (o.repos.length === 0 || !o.out) {
    throw new Error("usage: fetch.ts --repos owner/repo[,owner/repo] --out <dir> [--only-wachiman] [--logs] [--refresh] [--concurrency N] [--workflows a,b] [--keep owner/repo#N,...]");
  }
  return o;
}

const write = (path: string, data: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 1)}\n`);
};

const readJson = <T>(path: string): T | null => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
};

interface ApiUser {
  login?: string;
  type?: string;
}
interface ApiPrListItem {
  number: number;
  title: string;
  state: string;
  updated_at: string;
  created_at: string;
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
}
interface RunListItem {
  databaseId: number;
  workflowName: string;
  headBranch: string;
  headSha: string;
  event: string;
  status: string;
  conclusion: string;
  createdAt: string;
  updatedAt: string;
  displayTitle: string;
  url: string;
}

/** Logs are kept only for review runs; a repository's CI logs are large and not part of the dataset. */
const REVIEW_WORKFLOW = /review|wachi|pullfrog|coderabbit/i;

const pickUser = (u: ApiUser | null | undefined) => (u ? { login: u.login, type: u.type } : null);

const RUN_FIELDS = "databaseId,workflowName,headBranch,headSha,event,status,conclusion,createdAt,updatedAt,displayTitle,url";

/**
 * The repository's run list. `gh run list` returns at most the 1000 newest runs of all workflows,
 * which can be two weeks of CI; `--workflows` lists each review workflow on its own so the older
 * review runs are still found (their logs expire after 90 days regardless).
 */
async function fetchRuns(repo: string, repoDir: string, workflows: string[]): Promise<RunListItem[]> {
  const lists = workflows.length > 0 ? workflows : [""];
  const byId = new Map<number, RunListItem>();
  for (const w of lists) {
    const args = ["run", "list", "--repo", repo, "--limit", "1000", "--json", RUN_FIELDS, ...(w ? ["--workflow", w] : [])];
    const r = await gh(args);
    if (!r.ok) {
      write(join(repoDir, "_runs-error.json"), { workflow: w, error: r.stderr.trim() });
      continue;
    }
    for (const run of JSON.parse(r.stdout) as RunListItem[]) byId.set(run.databaseId, run);
  }
  const runs = [...byId.values()].sort((a, b) => a.databaseId - b.databaseId);
  write(join(repoDir, "_runs.json"), runs);
  return runs;
}

/** The runs that belong to a pull request: its branch's own runs, and comment-triggered runs titled like it. */
function runsOf(pr: { title: string; head: { ref: string } }, runs: RunListItem[]): RunListItem[] {
  return runs.filter(
    (r) => r.headBranch === pr.head.ref || ((r.event === "issue_comment" || r.event === "pull_request_review_comment") && r.displayTitle === pr.title),
  );
}

async function fetchPr(repo: string, item: ApiPrListItem, o: Options, repoDir: string, runs: RunListItem[]) {
  const n = item.number;
  const dir = join(repoDir, `pr-${n}`);
  const meta = readJson<{ updated_at?: string; logsFetched?: boolean }>(join(dir, "meta.json"));
  if (!o.refresh && meta?.updated_at === item.updated_at && (!o.logs || meta.logsFetched)) {
    return { number: n, status: "unchanged" as const, wachiman: existsSync(join(dir, "reviews.json")) };
  }

  // Reviews and issue comments first: with --only-wachiman a pull request without a signature there costs two calls.
  const [rv, ic] = await Promise.all([
    ghPaginate<Record<string, any>>(`repos/${repo}/pulls/${n}/reviews?per_page=100`),
    ghPaginate<Record<string, any>>(`repos/${repo}/issues/${n}/comments?per_page=100`),
  ]);
  if (!rv.ok || !ic.ok) {
    const error = [rv.ok ? "" : rv.error, ic.ok ? "" : ic.error].filter(Boolean).join(" | ");
    return { number: n, status: "error" as const, error, wachiman: false };
  }
  const early = [...rv.items, ...ic.items].some((x) => hasWachimanSignature(x.body ?? ""));
  if (o.onlyWachiman && !early && !o.keep.has(`${repo}#${n}`)) {
    rmSync(dir, { recursive: true, force: true });
    return { number: n, status: "skipped" as const, wachiman: false };
  }
  const [prRes, rc] = await Promise.all([
    gh(["api", "--hostname", "github.com", `repos/${repo}/pulls/${n}`]),
    ghPaginate<Record<string, any>>(`repos/${repo}/pulls/${n}/comments?per_page=100`),
  ]);
  if (!prRes.ok || !rc.ok) {
    const error = [prRes.ok ? "" : prRes.stderr, rc.ok ? "" : rc.error].filter(Boolean).join(" | ");
    return { number: n, status: "error" as const, error, wachiman: false };
  }
  const pr = JSON.parse(prRes.stdout);
  const reviewComments = rc.items.map((c) => ({
    id: c.id, user: pickUser(c.user), path: c.path, line: c.line, original_line: c.original_line,
    start_line: c.start_line, side: c.side, position: c.position, original_position: c.original_position,
    commit_id: c.commit_id, original_commit_id: c.original_commit_id, in_reply_to_id: c.in_reply_to_id ?? null,
    pull_request_review_id: c.pull_request_review_id, subject_type: c.subject_type,
    created_at: c.created_at, updated_at: c.updated_at, html_url: c.html_url, body: c.body,
  }));
  const reviews = rv.items.map((r) => ({
    id: r.id, user: pickUser(r.user), state: r.state, commit_id: r.commit_id,
    submitted_at: r.submitted_at, html_url: r.html_url, body: r.body,
  }));
  const issueComments = ic.items.map((c) => ({
    id: c.id, user: pickUser(c.user), created_at: c.created_at, updated_at: c.updated_at, html_url: c.html_url, body: c.body,
  }));

  const wachiman = early || reviewComments.some((x) => hasWachimanSignature(x.body ?? ""));

  write(join(dir, "pr.json"), {
    number: pr.number, title: pr.title, body: pr.body, state: pr.state, merged: pr.merged, draft: pr.draft,
    user: pickUser(pr.user), created_at: pr.created_at, updated_at: pr.updated_at, closed_at: pr.closed_at,
    html_url: pr.html_url, base: { ref: pr.base?.ref, sha: pr.base?.sha }, head: { ref: pr.head?.ref, sha: pr.head?.sha, repo: pr.head?.repo?.full_name },
    changed_files: pr.changed_files, additions: pr.additions, deletions: pr.deletions, labels: (pr.labels ?? []).map((l: any) => l.name),
  });
  write(join(dir, "review-comments.json"), reviewComments);
  write(join(dir, "reviews.json"), reviews);
  write(join(dir, "issue-comments.json"), issueComments);

  const mine = runsOf({ title: pr.title, head: { ref: pr.head?.ref } }, runs);
  const runInfo: Record<string, unknown>[] = [];
  let logsFetched = true;
  for (const run of mine) {
    const info: Record<string, unknown> = { ...run, log: "not-requested" };
    if (o.logs && REVIEW_WORKFLOW.test(run.workflowName)) {
      const path = join(dir, "logs", `run-${run.databaseId}.log.gz`);
      if (existsSync(path)) info.log = "ok";
      else if (run.status !== "completed") info.log = "in-progress";
      else if (run.conclusion === "skipped") info.log = "skipped";
      else {
        const r = await gh(["run", "view", String(run.databaseId), "--repo", repo, "--log"], 2);
        if (r.ok && r.stdout.length > 0) {
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, gzipSync(Buffer.from(r.stdout)));
          info.log = "ok";
        } else {
          // `gh run view --log` prints nothing for a run whose jobs never started; "log not found" is a run that never started a job; a 404 or 410 is a log GitHub no longer keeps.
          info.log = /log not found/i.test(r.stderr) ? "not-found" : /expired|410|404/i.test(r.stderr) ? "expired" : r.ok ? "empty" : `error: ${r.stderr.trim().slice(0, 160) || "no message"}`;
          logsFetched = String(info.log).startsWith("error") ? false : logsFetched;
        }
      }
    }
    runInfo.push(info);
  }
  write(join(dir, "runs.json"), runInfo);
  write(join(dir, "meta.json"), { updated_at: pr.updated_at, fetched_at: new Date().toISOString(), logsFetched: o.logs ? logsFetched : false });
  return { number: n, status: "fetched" as const, wachiman };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  for (const repo of o.repos) {
    const repoDir = join(o.out, repo.split("/")[1] ?? repo);
    mkdirSync(repoDir, { recursive: true });
    const list = await ghPaginate<ApiPrListItem>(`repos/${repo}/pulls?state=all&per_page=100`);
    if (!list.ok) {
      console.error(`${repo}: cannot list pull requests: ${list.error}`);
      write(join(repoDir, "_error.json"), { error: list.error });
      continue;
    }
    const prs = list.items.sort((a, b) => a.number - b.number);
    const runs = await fetchRuns(repo, repoDir, o.workflows);
    const counts: Record<string, number> = {};
    const index: Record<string, unknown>[] = [];
    await pool(prs, o.concurrency, async (item) => {
      const res = await fetchPr(repo, item, o, repoDir, runs);
      counts[res.status] = (counts[res.status] ?? 0) + 1;
      index.push({ number: item.number, title: item.title, state: item.state, head: item.head.ref, result: res.status, ...("error" in res ? { error: res.error } : {}) });
    });
    index.sort((a, b) => (a.number as number) - (b.number as number));
    write(join(repoDir, "_index.json"), index);
    console.log(`${repo}: ${prs.length} PRs, ${runs.length} runs listed; ${JSON.stringify(counts)}`);
  }
}

if (import.meta.main) await main();
