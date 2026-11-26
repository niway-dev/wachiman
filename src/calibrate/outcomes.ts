/**
 * Reads what happened to each Wachiman finding on GitHub: the outcome of its thread and who opened the
 * pull request. Pure classifiers plus one reader that takes the `gh` function, so tests never touch the network.
 */
import { isWachiFinding, type GhFn } from "../engine";
import { parseLabel, parseVerdict, type RawComment } from "../precision";

export type Outcome = "fixed" | "declined" | "wrong" | "none";
export type AuthorKind = "owner" | "agent";
import type { Confidence, Severity } from "../engine";

export type { Confidence, Severity };

const FIXED = /\b(?:fixed|done|addressed|applied|settled|resolved|updated)\b|^\W*(?:added|agreed)\b/i;
const DECLINED =
  /declin|won'?t fix|not fixing|\bkeeping\b|\bintentional(?:ly)?\b|by design|no change|out of scope|on purpose|not changing|no longer applies|as intended|\bdeliberate(?:ly)?\b|kept as is|^\W*(?:not changed|verified:|confirmed:|checked against)|the claim holds/i;
/** An agent signs its replies with a callout: `> 🤖 **Model responding on behalf of Name**`. */
const ON_BEHALF = /responding on behalf of/i;

/** The first meaningful line of a reply: not empty and not a quoted (`>`) callout line. */
const meaningfulLine = (body: string) => body.split("\n").find((l) => l.trim() !== "" && !l.trimStart().startsWith(">")) ?? "";

/** Who wrote a reply: an agent when it carries the "responding on behalf of" callout, otherwise the owner. */
export const replyKind = (body: string): AuthorKind => (ON_BEHALF.test(body) ? "agent" : "owner");

/**
 * The outcome one human reply states, or "none" when it states none. A `Verdict:` line that reads "wrong"
 * wins. Otherwise only the reply's first meaningful line counts (empty lines and `>` callout lines are
 * skipped), and when it holds both a fix word and a decline word the earlier one wins ("Declined: done by design" is declined, "Fixed in 64198cf. Not fixing the rest" is fixed).
 */
export function classifyReply(body: string): Outcome {
  if (parseVerdict(body) === "wrong") return "wrong";
  const first = meaningfulLine(body);
  const fixed = first.search(FIXED);
  const declined = first.search(DECLINED);
  if (fixed === -1 && declined === -1) return "none";
  if (declined === -1) return "fixed";
  if (fixed === -1) return "declined";
  return fixed < declined ? "fixed" : "declined";
}

/**
 * The outcome of a thread and who wrote the deciding reply: the first reply, in order, that states an outcome.
 * `kind` is absent when nothing was decided. Replies must be the humans' only (an agent posts from the owner's account).
 */
export function decideThread(replies: readonly { body: string }[]): { outcome: Outcome; kind?: AuthorKind } {
  for (const reply of replies) {
    const outcome = classifyReply(reply.body);
    if (outcome !== "none") return { outcome, kind: replyKind(reply.body) };
  }
  return { outcome: "none" };
}

export const classifyThread = (replies: readonly { body: string }[]): Outcome => decideThread(replies).outcome;

/**
 * Who stands behind a pull request, the fallback for a finding no reply decided. Agents post their replies
 * from the owner's account, so the login cannot split them; the pull request's own attribution can. `agent` when the body carries a "Generated with"
 * line of Claude Code or Codex, or the author is a bot; otherwise `owner`.
 */
export function authorKind(pr: { body?: string | null; author?: { login?: string; is_bot?: boolean } | null }): AuthorKind {
  const body = pr.body ?? "";
  if (body.includes("Generated with [Claude Code]") || body.includes("Generated with Codex")) return "agent";
  const login = pr.author?.login ?? "";
  if (pr.author?.is_bot || login.endsWith("[bot]") || login.startsWith("app/")) return "agent";
  return "owner";
}

export interface FindingComment extends RawComment {
  path?: string;
  line?: number | null;
  original_line?: number | null;
  html_url?: string;
}

export interface OutcomeFinding {
  id: string;
  repo: string;
  pr: number;
  commentId: number;
  url: string;
  path: string;
  line: number | null;
  /** The comment as posted, with the priority word still in it. */
  body: string;
  severity: Severity;
  confidence: Confidence | undefined;
  outcome: Outcome;
  kind: AuthorKind;
}

const BOT = "github-actions[bot]";
const SEVERITIES: readonly string[] = ["blocker", "fix", "consider", "info"];

/** Each Wachiman root finding of one pull request with the outcome of its thread. Findings with an old or unreadable label are left out. */
export function findingsOf(repo: string, pr: number, kind: AuthorKind, comments: FindingComment[]): OutcomeFinding[] {
  const roots = comments.filter((c) => c.user.login === BOT && !c.in_reply_to_id && isWachiFinding(c.body, c.created_at));
  return roots.flatMap((root) => {
    const label = parseLabel(root.body);
    if (!label || !SEVERITIES.includes(label.severity)) return [];
    const replies = comments.filter((c) => c.in_reply_to_id === root.id && c.user.login !== BOT && !c.user.login.endsWith("[bot]"));
    const confidence =
      label.confidence === "high" || label.confidence === "medium" || label.confidence === "low" ? label.confidence : undefined;
    const decided = decideThread(replies);
    return [
      {
        id: `${repo}#${pr}:${root.id}`,
        repo,
        pr,
        commentId: root.id,
        url: root.html_url ?? `https://github.com/${repo}/pull/${pr}#discussion_r${root.id}`,
        path: root.path ?? "",
        line: root.line ?? root.original_line ?? null,
        body: root.body,
        severity: label.severity as Severity,
        confidence,
        outcome: decided.outcome,
        // The deciding reply says who answered; an unanswered finding falls back to the pull request's attribution.
        kind: decided.kind ?? kind,
      },
    ];
  });
}

/** The last `prs` pull requests of a repository (open, closed and merged), read through `gh`. */
export function readFindings(gh: GhFn, repo: string, prs: number): OutcomeFinding[] {
  const list = JSON.parse(gh(["pr", "list", "-R", repo, "--state", "all", "--limit", String(prs), "--json", "number,body,author"])) as {
    number: number;
    body?: string | null;
    author?: { login?: string; is_bot?: boolean } | null;
  }[];
  return list.flatMap((pr) => {
    const comments = (
      JSON.parse(gh(["api", "--paginate", "--slurp", `repos/${repo}/pulls/${pr.number}/comments`])) as FindingComment[][]
    ).flat();
    return findingsOf(repo, pr.number, authorKind(pr), comments);
  });
}
