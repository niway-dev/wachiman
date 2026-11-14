/**
 * Publishing the loop summary (ADR 0054): find the open pull request of the current branch with
 * `gh`, then create the summary as a comment on it, or edit in place the comment the signed-in
 * account already posted with the marker. Nothing here runs unless the developer asked for it
 * (`--publish`, or `publishLoopSummary: true` in `.wachiman.yml`): the comment is posted under
 * their GitHub account, so it is their choice, never a default.
 *
 * `gh` is the only way out and it acts as the account `gh` is signed in with; which account that
 * should be for a repository is the developer's setup, not this module's. A comment is found by its
 * first line, the marker, and by its author, so a comment somebody else wrote with the same marker is
 * never edited.
 */
import { spawnSync } from "node:child_process";
import { UsageError } from "../config";
import { SUMMARY_MARKER } from "./summary";

export interface GhResult {
  status: number | null;
  stdout: string;
  stderr: string;
}
/** Runs `gh <args>` in the repository, with `input` on stdin when given. */
export type GhRunner = (args: string[], input?: string) => GhResult;

const GH_TIMEOUT_MS = 60_000;
/** GitHub refuses a comment above 65,536 characters; stay clear of it. */
export const MAX_COMMENT_CHARS = 60_000;

export function spawnGh(repoDir: string, env: Record<string, string | undefined>): GhRunner {
  return (args, input) => {
    const run = spawnSync("gh", args, {
      cwd: repoDir,
      encoding: "utf8",
      timeout: GH_TIMEOUT_MS,
      env: { ...env, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" } as NodeJS.ProcessEnv,
      ...(input !== undefined ? { input } : { stdio: ["ignore", "pipe", "pipe"] }),
    });
    const missing = (run.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
    return { status: missing ? 127 : run.status, stdout: run.stdout ?? "", stderr: missing ? "gh is not installed or not on PATH" : (run.stderr ?? run.error?.message ?? "") };
  };
}

export interface Published {
  action: "created" | "updated";
  url: string;
  pullRequest: string;
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 300);

/** Runs a `gh` call that must succeed, or fails with what `gh` said. */
function must(gh: GhRunner, what: string, args: string[], input?: string): string {
  const out = gh(args, input);
  if (out.status !== 0) {
    const said = oneLine(out.stderr || out.stdout) || (out.status === null ? `gh did not finish within ${GH_TIMEOUT_MS / 1000} seconds or was stopped` : `gh exited ${out.status}`);
    throw new UsageError(`could not ${what}: ${said}`);
  }
  return out.stdout;
}

export function publishSummary(body: string, branch: string, gh: GhRunner): Published {
  if (body.length > MAX_COMMENT_CHARS) throw new UsageError(`the summary is ${body.length} characters; GitHub comments stop at 65,536, so it was not published.`);

  const listed = must(gh, "list the pull requests of this branch", ["pr", "list", "--head", branch, "--state", "open", "--json", "number,url,isCrossRepository", "--limit", "5"]);
  let prs: { number: number; url: string; isCrossRepository?: boolean }[];
  try {
    prs = JSON.parse(listed);
  } catch {
    throw new UsageError("could not read the pull request list gh returned.");
  }
  // `--head` matches the branch name only: a pull request from a fork that happens to share the name is not this branch's.
  if (Array.isArray(prs)) prs = prs.filter((p) => p.isCrossRepository !== true);
  if (!Array.isArray(prs) || prs.length === 0) throw new UsageError(`no open pull request has ${branch} as its head; open it first, then publish the summary.`);
  if (prs.length > 1) throw new UsageError(`more than one open pull request has ${branch} as its head (${prs.map((p) => `#${p.number}`).join(", ")}); publish by hand.`);
  const pr = prs[0];
  const target = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)$/.exec(pr.url ?? "");
  if (!target || Number(target[3]) !== pr.number) throw new UsageError("could not tell which repository the pull request is in.");
  const repo = `repos/${target[1]}/${target[2]}`;

  const login = must(gh, "tell which GitHub account gh acts as", ["api", "user", "--jq", ".login"]).trim();
  if (!/^[\w-]+(\[bot\])?$/.test(login)) throw new UsageError("could not read the GitHub account gh acts as.");

  // The oldest comment of this account that starts with the marker: the one this command made, or an earlier run's.
  const found = must(gh, "list the comments of the pull request", [
    "api",
    "--paginate",
    `${repo}/issues/${pr.number}/comments?per_page=100`,
    "--jq",
    `.[] | select(.user.login == ${JSON.stringify(login)} and (.body | startswith(${JSON.stringify(SUMMARY_MARKER)}))) | .id`,
  ])
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /^\d+$/.test(l));

  const payload = JSON.stringify({ body });
  const answer = found
    ? must(gh, "edit the summary comment", ["api", "-X", "PATCH", `${repo}/issues/comments/${found}`, "--input", "-", "--jq", ".html_url"], payload)
    : must(gh, "create the summary comment", ["api", "-X", "POST", `${repo}/issues/${pr.number}/comments`, "--input", "-", "--jq", ".html_url"], payload);
  return { action: found ? "updated" : "created", url: answer.trim(), pullRequest: pr.url };
}
