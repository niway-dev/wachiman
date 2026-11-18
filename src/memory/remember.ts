/**
 * `wachiman memory remember <pr>`: the write job of repository memory in Actions (layer 5, spec
 * decisions 9 and 10).
 *
 * An operator's comment `/wachiman remember <id>` in a thread approves the memory entry that an earlier
 * reply in that thread showed. This command, run by its own workflow job (the only one with `contents:
 * write`), reads that reply back from GitHub, checks that the digest of the shown text is the id the
 * operator approved, and writes the text with the same path as `memory propose`: one commit on
 * `wachiman/memory`, plus a draft pull request. Nothing here calls a model, and the model never holds
 * a credential.
 *
 * It refuses, writing nothing, when the commenter is not the operator, when no reply of the engine's own
 * in that thread shows the id, or when the text shown does not hash to that id. It replies in the thread
 * with a signature that is not the thread-reply signature, so the reply does not count toward the
 * two-reply cap, and it never resolves the thread.
 */
import { loadConfig, operatorProblem, UsageError } from "../config";
import { defaultGh, fetchThreads, isWachiReply, neutralise, parseCommand, type GhFn } from "../engine";
import { proposeCandidate, type ProposeResult, type PullRequests } from "./propose";
import { candidateFromShown, proposalsIn, REMEMBER_SIGNATURE } from "./proposal";

/** The repository setting a workflow token needs to open a pull request. */
export const PULL_REQUEST_SETTING = "Allow GitHub Actions to create and approve pull requests";

export interface RememberDeps {
  gh: GhFn;
  config: { operator: string; mention: string; dryRun: boolean };
  log: (line: string) => void;
  warn: (line: string) => void;
  /** The two pull request calls of the write path; tests pass a fake. */
  pulls?: PullRequests;
  /** The write path itself; tests may pass a fake. Default: `proposeCandidate`. */
  propose?: typeof proposeCandidate;
}

export interface RememberRequest {
  /** The text of the comment that asked. */
  body: string;
  /** Its author's login, as GitHub sends it. Unset means nobody is trusted. */
  author: string | undefined;
  /** The thread's first comment when the comment is a reply, else null. */
  replyTo: number | null;
}

/** Text from git or GitHub, shown in a block that nothing inside it can close. */
const block = (text: string) => {
  const safe = neutralise(text.trim());
  const fence = "`".repeat(Math.max(3, ...(safe.match(/`+/g) ?? []).map((run) => run.length + 1)));
  return `${fence}text\n${safe}\n${fence}`;
};

/** What must not reach a public thread even inside a block: a token shaped like GitHub's, and the path of the job's checkout. */
const scrub = (text: string, repoDir: string) => {
  const hidden = text.replace(/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{8,}/g, "[redacted]");
  const dir = repoDir.replace(/\/+$/, "");
  return dir === "" ? hidden : hidden.split(dir).join("<repo>");
};

const reply = (lines: string[]) => `${lines.join("\n\n")}\n\n${REMEMBER_SIGNATURE}`;

/** Returns the exit code: 0 when the entry is recorded (or was already), or when the comment is not for this job; 1 when nothing was written or the pull request could not be opened. */
export function remember(deps: RememberDeps, repo: string, pr: number, request: RememberRequest, repoDir: string): number {
  const { operator, mention, dryRun } = deps.config;
  // Before anything else, as `comment` does: a placeholder operator would let a stranger who registered that login write memory.
  const problem = operatorProblem(operator);
  if (problem) throw new Error(problem);
  if (request.author === undefined || request.author.toLowerCase() !== operator.toLowerCase()) {
    deps.warn(`Comment by ${request.author ?? "an unknown author"}, not the operator ${operator}; nothing was written.`);
    return 0;
  }
  const command = parseCommand(request.body, mention);
  if (command?.kind !== "remember") {
    deps.warn(`The comment is not \`${mention} remember <id>\`; nothing was written.`);
    return 0;
  }
  if (request.replyTo === null) {
    deps.warn("The comment is not a reply in a thread, so no proposal can be found; nothing was written.");
    return 1;
  }
  const root = request.replyTo;
  const post = (lines: string[]) => {
    const body = reply(lines);
    if (dryRun) {
      deps.log(`--- reply to ${root} (dry run, not posted) ---\n${body}`);
      return;
    }
    try {
      deps.gh(["api", "-X", "POST", `repos/${repo}/pulls/${pr}/comments/${root}/replies`, "-f", `body=${body}`]);
    } catch (error) {
      deps.warn(`could not reply in the thread: ${error instanceof Error ? error.message : error}`);
    }
  };
  // `why` is the engine's own sentence. `detail` is text from git, GitHub or the shown proposal: the log gets it as it is, the
  // thread gets it scrubbed and only inside `block()`, so error text cannot add markdown, a mention or a marker, or show a token or the checkout's path.
  const refuse = (why: string, detail?: string) => {
    deps.warn(`remember ${command.id}: ${why}${detail ? ` ${detail}` : ""} Nothing was written.`);
    post([`Nothing was written for \`${command.id}\`. ${why}`, ...(detail ? [block(scrub(detail, repoDir))] : [])]);
    return 1;
  };

  const thread = fetchThreads(deps.gh, repo, pr).find((t) => t.comments.nodes[0]?.databaseId === root);
  // Only the engine's own signed replies carry a proposal: `proposalsIn` reads the markers the engine writes, and a comment by anyone else is not looked at.
  const shown = (thread?.comments.nodes ?? [])
    .filter(isWachiReply)
    .flatMap((n) => proposalsIn(n.body))
    .filter((p) => p.id === command.id)
    .at(-1);
  if (!shown) return refuse(`No reply of Wachiman in this thread proposes an entry with the id \`${command.id}\`.`);
  const built = candidateFromShown(shown.text, command.id);
  if (!built.candidate) return refuse("The text shown does not match the id. The id is the digest of the entry text, and only text that hashes to it is written. The problem:", built.problem);

  if (dryRun) {
    deps.log(`dry run: would record entry ${command.id} on wachiman/memory.`);
    post([`Wachiman: would record the entry \`${command.id}\` (dry run).`]);
    return 0;
  }

  const out: string[] = [];
  const errors: string[] = [];
  let result: ProposeResult;
  try {
    result = (deps.propose ?? proposeCandidate)(built.candidate, repoDir, { stdout: (text) => void out.push(text.trim()), stderr: (line) => void errors.push(line) }, { pulls: deps.pulls });
  } catch (error) {
    return refuse("The write failed:", String(error instanceof Error ? error.message : error));
  }
  for (const line of errors) deps.warn(line);
  if (!result.recorded) return refuse("The write was refused:", errors.join("\n"));

  const recorded = block(out.join("\n"));
  if (result.pullRequestFailed) {
    const note = `The entry is on the branch \`wachiman/memory\`, but the draft pull request could not be opened. A workflow token can open one only when the repository setting "${PULL_REQUEST_SETTING}" is on (Settings, Actions, General). Turn it on, or open the pull request from that branch by hand.`;
    deps.warn(`remember ${command.id}: ${note}`);
    post([`Wachiman: recorded the entry \`${command.id}\` as shown, without a pull request.`, recorded, note]);
    return 1;
  }
  post([
    `Wachiman: recorded the entry \`${command.id}\` exactly as shown.`,
    recorded,
    "It is not active until a person merges the draft pull request. Reviews read the memory from the base commit.",
  ]);
  return 0;
}

export interface RememberContext {
  env?: Record<string, string | undefined>;
  gh?: GhFn;
  pulls?: PullRequests;
}

/**
 * `argv` is what follows `memory remember`: the pull request number. The comment comes from the
 * environment the workflow sets (`REQUEST`, `WACHIMAN_COMMENT_AUTHOR`, `WACHIMAN_COMMENT_IN_REPLY_TO`),
 * the same variables `comment` reads; the token and the repository are `GH_TOKEN` and `GITHUB_REPOSITORY`.
 */
export function runRemember(argv: string[], repoDir: string, io: { stdout: (text: string) => void; stderr: (line: string) => void }, ctx: RememberContext = {}): number {
  const env = ctx.env ?? process.env;
  const [prArg, ...extra] = argv;
  if (!/^[1-9]\d*$/.test(prArg ?? "")) throw new UsageError("memory remember needs a pull request number.");
  if (extra.length > 0) throw new UsageError(`memory remember takes only a pull request number, got "${extra[0]}".`);
  const need = (name: string) => {
    const value = env[name];
    if (value === undefined || value === "") throw new UsageError(`${name} is not set`);
    return value;
  };
  need("GH_TOKEN");
  const repo = need("GITHUB_REPOSITORY");
  const body = need("REQUEST");
  const raw = env.WACHIMAN_COMMENT_IN_REPLY_TO ?? "";
  if (raw !== "" && !/^\d+$/.test(raw)) throw new UsageError(`WACHIMAN_COMMENT_IN_REPLY_TO must be a comment id, got "${raw}".`);
  const config = loadConfig(env);
  return remember(
    { gh: ctx.gh ?? defaultGh, config: { operator: config.operator, mention: config.mention, dryRun: config.dryRun }, log: (line) => io.stdout(`${line}\n`), warn: io.stderr, pulls: ctx.pulls },
    repo,
    Number(prArg),
    { body, author: env.WACHIMAN_COMMENT_AUTHOR || undefined, replyTo: raw === "" ? null : Number(raw) },
    repoDir,
  );
}
