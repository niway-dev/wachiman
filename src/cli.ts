#!/usr/bin/env bun
/**
 * wachiman: advisory pull request reviews by an agent CLI.
 *
 *   wachiman review <pr> [paths…]   review it; after the first review, only what changed
 *                                       since the last reviewed commit
 *   wachiman comment <pr>           route the operator's comment, read from $REQUEST, to a
 *                                       review or an answer
 *   wachiman threads <pr>           answer the pending Wachiman threads, with no review; only
 *                                       when the head was already reviewed
 *   wachiman local [paths…]         review the committed branch of a clone on the signed-in
 *                                       `claude`, and print it; no GitHub call (src/local.ts)
 *   wachiman loop [--base <ref>]   one review round of a fix loop on the signed-in `claude`; exit 0
 *                                       converged, 10 findings open, 11 stopped (src/loop/command.ts)
 *   wachiman ask [question…]        answer a question about the local change, or explain it; one
 *                                       call, no GitHub request, grounded in the stored review (src/local-ask.ts)
 *   wachiman history                list and judge what `local --history` kept on this laptop
 *   wachiman status                 what the local history kept and its estimated cost; files only
 *   wachiman ledger connect|disconnect|pull  connect to the spend ledger and download its entries (src/ledger-read/)
 *   wachiman dashboard              spend, findings and loops across every repository in the history, as one
 *                                       static HTML file or JSON, from a rebuildable index (src/store/)
 *   wachiman setup [--profile <name>] bind this repository to an account profile (home config only);
 *                                       on a terminal without --profile it asks
 *   wachiman init                   write the GitHub caller workflow, or hand over to `setup`
 *   wachiman doctor                 explain what a local run would use and what would fail
 *   wachiman profile …              list, create, add, login, remove and default account profiles
 *   wachiman project show|unbind    inspect or remove this repository's binding
 *   wachiman skills install|uninstall  copy the agent skills into place, or remove what was copied
 *   wachiman --setup-profile [name] sign in an isolated Claude Code profile under the Wachiman home
 *
 * Exit codes: 0 posted or nothing to do; 1 engine error (nothing posted); 2 usage error; 3 the spend
 * ledger stopped the run before any model call (a limit with `limit_mode: fail`, a repository it does
 * not know, a job without an OIDC token, or an unreachable ledger with `ledger_unavailable: stop`);
 * 130 cancelled (`local`, `loop`, `setup`, `init`); `loop` also exits 10 and 11 (see its help).
 * The settings are documented in docs/cli.md.
 */
import { existsSync, readFileSync, statSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";
import { writeStepSummary, type CallCost } from "./cost";
import { loadConfig, UsageError } from "./config";
import { historyUsage, parseHistoryArgs, runHistory } from "./history/command";
import { parseStatusArgs, runStatus, statusUsage } from "./status/command";
import { dashboardUsage, parseDashboardArgs, runDashboard } from "./store/command";
import { ledgerUsage, parseLedgerArgs, runLedger } from "./ledger-read/command";
import { pullLedger } from "./ledger-read/pull";
import { LedgerStopped, SpendLimitReached, comment, defaultGh, isThreadQuestion, review, threadReplies, type Deps, type GhFn, type ReviewLineComment } from "./engine";
import { localUsage, parseLocalArgs, runLocal } from "./local";
import { loopUsage, parseLoopArgs, runLoop } from "./loop/command";
import { askUsage, parseAskArgs, runAsk } from "./local-ask";
import { parseProfileArgs, parseProjectArgs, profileUsage, projectUsage, runProfile, runProject, setupUsage } from "./accounts/commands";
import { wachimanHome } from "./accounts/config";
import { parseSkillsArgs, runSkills, skillsUsage } from "./skills/install";
import { doctorUsage, parseDoctorArgs, runDoctor } from "./doctor/run";
import { initUsage, parseInitFlags } from "./init/args";
import { DEFAULT_WORKFLOW_REF } from "./init/options";
import { runInitCommand } from "./init/run";
import { projectCommands } from "./wizard/command";
import { DEFAULT_ISOLATED_NAME, setupProfile } from "./profiles";
import { resetConfidence } from "./fidelity/sink";
import { getProvider, PROVIDER_NAMES, UnknownProviderError } from "./providers";
import { parseSetupFlags } from "./setup/args";
import { runSetupCommand } from "./setup/run";

export const USAGE = `Usage:
  wachiman review <pr> [paths…] [--repo-dir <dir>]   Review a pull request (or only the given paths)
  wachiman comment <pr> [--repo-dir <dir>]           Handle the comment in $REQUEST (a review or an answer)
  wachiman threads <pr> [--repo-dir <dir>]           Answer the pending Wachiman threads (an automatic run)
  wachiman reset-confidence <pr> [--commit <sha>]    Write "cannot say" into the PR Confidence block (no model call;
                                                     the first step of a review run, with AGENT_REVIEW_CONFIDENCE=1)
  ${localUsage}
                                                     Review the committed branch of a clone on your
                                                     signed-in claude, and print it; nothing is posted.
                                                     --commit: that one commit (<commit>^ → <commit>);
                                                     --from: that commit forward (<commit>^ → HEAD)
  ${loopUsage}
                                                     One round of a review loop on your signed-in claude:
                                                     --base starts it (round 1 reviews the whole range),
                                                     a call with a loop open continues it and reviews only
                                                     the commits since the last round. Fix, or judge a
                                                     finding wrong with a reason, between calls; the CLI
                                                     never edits code. Three rounds by default
  ${askUsage}
                                                     Answer a question about the change the scope flags
                                                     select, or explain it when no question is given. One
                                                     call on your signed-in claude; no GitHub request.
                                                     Grounded in the stored review of this change when
                                                     \`local --history\` kept one; never runs a review
  ${historyUsage}
                                                     List, judge and forget the findings kept by
                                                     \`local --history\`; reads files and local git
                                                     metadata only: no claude, no GitHub
  ${statusUsage}
                                                     What this laptop kept of its local runs and their
                                                     estimated cost, filterable; uses local history. GitHub
                                                     Actions runs are included only after \`ledger pull\`
                                                     (--refresh does it first); without a ledger they are not counted
  ${ledgerUsage.replaceAll("\n", "\n  ")}
                                                     Connect to the spend ledger with a read token and download
                                                     its entries into ~/.wachiman/ledger. \`pull\` and \`--refresh\`
                                                     are the only requests; nothing is ever sent from the laptop
  ${dashboardUsage}
                                                     Write one static HTML page (or print JSON) with the
                                                     spend per day and repository, the findings by severity
                                                     and verdict and the loop rounds of every repository in
                                                     the local history. Built from an index under the
                                                     Wachiman home that is rebuilt whenever it is missing or
                                                     out of date. It writes only that index and, without
                                                     --json, the page, and, like \`wachiman history\`, moves
                                                     a damaged run file aside. No claude, no GitHub, no
                                                     network, no server, no browser. --repo-dir is accepted
                                                     and unused
  ${setupUsage}
                                                     Bind this repository to an account profile; written
                                                     in the Wachiman home, never in the repository. On a
                                                     terminal without --profile it asks, and can register
                                                     or create a profile; without a terminal --profile
                                                     must name a profile that already exists
  ${initUsage}
                                                     Write the GitHub Actions caller workflow
                                                     (.github/workflows/wachiman-review.yml), or, with
                                                     --mode local, write nothing and hand over to setup.
                                                     --dry-run prints the file; --force keeps a .bak copy
  ${doctorUsage}
                                                     Explain what a local run would use and what would
                                                     fail; exit 1 when a required check fails
  ${profileUsage.split("\n").join("\n  ")}
                                                     Manage account profiles; a managed profile lives in
                                                     ~/.wachiman/claude-<name>, an external one is your own
                                                     Claude configuration directory, used in place
  ${projectUsage.split("\n").join("\n  ")}
  ${skillsUsage.split("\n").join("\n  ")}
                                                     Copy the wachiman-review, wachiman-loop and wachiman-audit agent
                                                     skills into ~/.agents/skills and each Claude Code
                                                     config directory; uninstall removes only the copies
                                                     it marked. Never touches ~/.wachiman
  wachiman --setup-profile [<name>]                  Sign in an isolated profile, ~/.wachiman/claude-<name>
                                                     (an alias of \`wachiman profile create\`)
  wachiman --help | --version

Options:
  --repo-dir <dir>                   The checked-out pull request head: every file the engine reads
                                     and the agent's working directory. Default: the current directory.
                                     For \`local\`: the clone whose branch is reviewed.

Environment:
  GH_TOKEN, GITHUB_REPOSITORY        required (not read by \`local\`, \`ask\` or \`--setup-profile\`)
  ANTHROPIC_API_KEY                  the claude-code provider needs this or CLAUDE_CODE_OAUTH_TOKEN
                                     (not in a dry run); \`local\` and \`ask\` refuse to start when it is set
  CLAUDE_CODE_OAUTH_TOKEN            a Claude subscription token (\`claude setup-token\`); if set, it is
                                     used and ANTHROPIC_API_KEY never reaches the agent
  REQUEST                            the comment text, for \`comment\`
  AGENT_REVIEW_COMMENT_AUTHOR        the login of the comment's author, for \`comment\` and \`threads\`
  AGENT_REVIEW_*                     optional settings; see docs/cli.md

Exit codes: 0 posted or nothing to do, 1 engine error, 2 usage error, 3 the spend ledger stopped the run
(a limit with \`limit_mode: fail\`, an unlinked repository, no OIDC token, or an unreachable ledger with
\`ledger_unavailable: stop\`); with \`limit_mode: notice\` a limit exits 0.
\`local\`: 0 a report was printed, 1 no call returned a review, 2 usage error, 130 interrupted.
\`loop\`: 0 converged, 10 findings still open, 11 stopped without converging (round cap or review failed), 2 usage error, 130 interrupted. A stop is never an approval.
\`ask\`: 0 an answer was printed (it may say what it could not answer), 1 no answer (the call failed or returned nothing usable), 2 usage error, 130 interrupted.
\`history\`: 0 listed (or nothing to list), 2 usage error, including an unknown finding id.
\`status\`: 0 printed (also with no run kept), 2 usage error.
\`dashboard\`: 0 written or printed (also with no run kept), 2 usage error, 1 the index or the page could not be written.
\`doctor\`: 0 every required check passed, 1 one failed. \`setup\`: 1 when its closing doctor summary failed.
\`setup\`, \`init\`: 130 cancelled (Escape, Ctrl-C, Ctrl-D); nothing pending is saved.
\`skills\`: 0 done (copies left in place are warned about), 1 a copy could not be written, 2 usage error or a refused target.
Guide: docs/local-review.md`;

/** package.json sits one level above src/; in a copied layout it may belong to someone else. */
export function readVersion(dir = import.meta.dir) {
  try {
    const path = join(dir, "..", "package.json");
    if (!existsSync(path)) return "unknown";
    const pkg = JSON.parse(readFileSync(path, "utf8"));
    return pkg.name === "wachiman" || pkg.name === "agent-review" ? String(pkg.version) : "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Takes `--repo-dir <dir>` or `--repo-dir=<dir>` out of the arguments. The directory is the
 * reviewed head, which the engine reads as data; it is not the engine's own working directory.
 */
export function extractRepoDir(argv: string[]) {
  const rest: string[] = [];
  let value: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--repo-dir") {
      value = argv[++i];
      if (value === undefined || value === "") throw new UsageError("--repo-dir needs a directory.");
    } else if (arg.startsWith("--repo-dir=")) {
      value = arg.slice("--repo-dir=".length);
      if (value === "") throw new UsageError("--repo-dir needs a directory.");
    } else {
      rest.push(arg);
    }
  }
  const repoDir = resolve(value ?? ".");
  if (!existsSync(repoDir) || !statSync(repoDir).isDirectory()) {
    throw new UsageError(`--repo-dir ${repoDir} is not a directory.`);
  }
  return { repoDir, rest };
}

/**
 * Writes all of `text` to a file descriptor before returning. `process.stdout.write` is
 * asynchronous on a pipe, and `process.exit` right after it cuts a long report short.
 */
export function writeAll(fd: number, text: string) {
  const bytes = Buffer.from(text);
  let offset = 0;
  while (offset < bytes.length) {
    try {
      offset += writeSync(fd, bytes, offset);
    } catch (error) {
      // A non-blocking pipe that is full: wait for the reader.
      if ((error as NodeJS.ErrnoException).code !== "EAGAIN") throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
}

/**
 * The command a run executes. A `threads` run whose trigger is a review comment and whose request asks
 * a question is `comment`: it is answered in the thread (ADR 0032 decision 4). Everything else keeps
 * its command.
 */
export function routeMode(mode: string, commentLine: ReviewLineComment | undefined, request: string, keyword: string) {
  return mode === "threads" && commentLine !== undefined && isThreadQuestion(request, keyword) ? "comment" : mode;
}

/**
 * The review comment a question was written on, from the workflow's environment (ADR 0032 decision 4).
 * Unset when the run is not about a review comment. Only the numbers and the path are read; the
 * comment's text is `REQUEST`.
 */
export function readCommentLine(env: Record<string, string | undefined>): ReviewLineComment | undefined {
  const id = env.AGENT_REVIEW_COMMENT_ID ?? "";
  if (id === "") return undefined;
  const number = (name: string) => {
    const raw = env[name] ?? "";
    if (raw === "") return null;
    if (!/^\d+$/.test(raw)) throw new UsageError(`${name} must be a comment id or a line number, got "${raw}".`);
    return Number(raw);
  };
  if (!/^\d+$/.test(id)) throw new UsageError(`AGENT_REVIEW_COMMENT_ID must be a comment id, got "${id}".`);
  return {
    id: Number(id),
    replyTo: number("AGENT_REVIEW_COMMENT_IN_REPLY_TO"),
    path: env.AGENT_REVIEW_COMMENT_PATH || null,
    line: number("AGENT_REVIEW_COMMENT_LINE"),
  };
}

function required(env: Record<string, string | undefined>, name: string) {
  const value = env[name];
  if (value === undefined || value === "") throw new UsageError(`${name} is not set`);
  return value;
}

/** `doctor`, `profile` and `project`: no GitHub, no model call; the account store and the machine only. */
function runAccountCommand(mode: "doctor" | "profile" | "project", args: string[], repoDir: string, env: Record<string, string | undefined>) {
  const io = { stdout: (text: string) => writeAll(1, text), stderr: (line: string) => console.error(line) };
  const deps = { doctor: { version: readVersion() } };
  if (mode === "profile") return runProfile(parseProfileArgs(args), env, io, deps);
  if (mode === "project") return runProject(parseProjectArgs(args, repoDir), env, io, deps);
  const parsed = parseDoctorArgs(args, repoDir);
  if ("help" in parsed) return (io.stdout(`${doctorUsage}\n`), 0);
  return runDoctor(parsed, env, io, deps.doctor);
}

/** `setup` and `init`: asked on a terminal, flags and exit code 2 otherwise. A cancellation is exit 130. */
async function runWizard(mode: "setup" | "init", args: string[], repoDir: string, env: Record<string, string | undefined>): Promise<number> {
  const io = { stdout: (text: string) => writeAll(1, text), stderr: (line: string) => console.error(line) };
  const version = readVersion();
  if (mode === "setup") {
    const flags = parseSetupFlags(args, repoDir);
    if (flags.help) return (io.stdout(`${setupUsage}\n`), 0);
    return runSetupCommand(flags, env, io, { doctor: { version } });
  }
  const flags = parseInitFlags(args, repoDir);
  if (flags.help) return (io.stdout(`${initUsage}\n`), 0);
  return runInitCommand(flags, env, io, {
    version,
    defaultWorkflowRef: DEFAULT_WORKFLOW_REF,
    // Choosing local/both already requests setup; keep its final write confirmation.
    bindNow: (prompter, mode) => runSetupCommand({ repoDir }, env, io, { doctor: { version }, interactive: true, prompter, fromInit: true, initMode: mode, unboundHints: projectCommands("setup", repoDir, process.cwd()) }),
  });
}

/**
 * `wachiman reset-confidence <pr> [--commit <sha>]`: the first step of a review run (ADR 0033
 * decision 14). It rewrites the PR Confidence block to `cannot say` for the commit under review
 * before the push wait, so a run cancelled during it leaves no letter from an older commit. No
 * model, no provider. A failure inside the reset itself (reading or writing the description) is a
 * warning and the exit code stays 0. A usage or configuration error is not: a bad pull request
 * number or flag, an invalid `AGENT_REVIEW_*` value, or a missing `GH_TOKEN` or
 * `GITHUB_REPOSITORY` exits non-zero. The workflow steps run it with `continue-on-error`.
 */
export function runResetConfidence(args: string[], env: Record<string, string | undefined>, gh: GhFn = defaultGh): number {
  const [prArg, ...flags] = args;
  const pr = Number(prArg);
  if (!/^\d+$/.test(prArg ?? "") || pr <= 0) throw new UsageError("reset-confidence needs a pull request number.");
  let commit: string | undefined;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] !== "--commit" || !flags[i + 1]) throw new UsageError(`reset-confidence: unexpected "${flags[i]}".`);
    commit = flags[++i];
  }
  const config = loadConfig(env);
  if (!config.confidence) return 0;
  required(env, "GH_TOKEN");
  const repo = required(env, "GITHUB_REPOSITORY");
  resetConfidence(
    { gh, dryRun: config.dryRun, log: (line) => console.log(line), warn: (line) => console.error(line) },
    repo,
    pr,
    commit,
  );
  return 0;
}

/** `--refresh`: download the ledger first. A failed download warns and leaves the files already on disk in use. */
async function refreshLedger(env: Record<string, string | undefined>) {
  try {
    const r = await pullLedger(wachimanHome(env), env, undefined);
    console.error(`wachiman: ledger refreshed (${r.entries} entries, ${r.from} to ${r.to}).`);
  } catch (error) {
    if (error instanceof UsageError) throw error;
    console.error(`wachiman: ledger refresh failed: ${error instanceof Error ? error.message : error}. Showing the entries already downloaded.`);
  }
}

export async function main(argv: string[], env: Record<string, string | undefined>): Promise<number> {
  const mode = argv[0];
  if (mode === "--help" || mode === "-h") {
    console.log(USAGE);
    return 0;
  }
  if (mode === "--version" || mode === "-v") {
    console.log(readVersion());
    return 0;
  }
  try {
    if (mode === "--setup-profile") {
      if (argv.length > 2) throw new UsageError("--setup-profile takes at most one profile name.");
      // One notice per run, before anything is created: the command is kept, but `profile create` is
      // where it is going (ADR 0029).
      console.error(`wachiman: --setup-profile is kept as an alias of \`wachiman profile create ${argv[1] ?? DEFAULT_ISOLATED_NAME}\`.`);
      setupProfile({ name: argv[1], home: wachimanHome(env), env });
      return 0;
    }
    if (mode === "skills") {
      // Before extractRepoDir: no repository is read, so `--repo-dir` is a usage error here.
      const parsed = parseSkillsArgs(argv.slice(1));
      if ("help" in parsed) return (writeAll(1, `${skillsUsage}\n`), 0);
      return runSkills(parsed, env, { stdout: (text) => writeAll(1, text), stderr: (line) => console.error(line) }, { version: readVersion() });
    }
    if (mode === "ledger") {
      // Before extractRepoDir: no repository is read. The only command that contacts the ledger (ADR 0039).
      const parsed = parseLedgerArgs(argv.slice(1));
      if ("help" in parsed) return (writeAll(1, `${ledgerUsage}\n`), 0);
      return await runLedger(parsed, env, { stdout: (text) => writeAll(1, text), stderr: (text) => void process.stderr.write(text) });
    }
    const { repoDir, rest: args } = extractRepoDir(argv);
    if (mode === "local") {
      // No GitHub: no token, no repository, no `gh` function anywhere on this path.
      return runLocal(parseLocalArgs(args.slice(1)), repoDir, env, {
        stdout: (text) => writeAll(1, text),
        stderr: (line) => console.error(line),
        engineVersion: readVersion(),
      });
    }
    if (mode === "loop") {
      // Like `local`: no GitHub token, no `gh` function anywhere on this path.
      return runLoop(parseLoopArgs(args.slice(1)), repoDir, env, {
        stdout: (text) => writeAll(1, text),
        stderr: (line) => console.error(line),
        engineVersion: readVersion(),
      });
    }
    if (mode === "ask") {
      // Like `local`: no GitHub token, no `gh` function anywhere on this path.
      return runAsk(parseAskArgs(args.slice(1)), repoDir, env, {
        stdout: (text) => writeAll(1, text),
        stderr: (line) => console.error(line),
        engineVersion: readVersion(),
      });
    }
    if (mode === "doctor" || mode === "profile" || mode === "project") {
      return runAccountCommand(mode, args.slice(1), repoDir, env);
    }
    if (mode === "setup" || mode === "init") return await runWizard(mode, args.slice(1), repoDir, env);
    if (mode === "status") {
      const parsed = parseStatusArgs(args.slice(1));
      if ("help" in parsed) return (writeAll(1, `${statusUsage}\n`), 0);
      if (parsed.refresh) await refreshLedger(env);
      return runStatus(parsed, repoDir, env, { stdout: (text) => writeAll(1, text), stderr: (line) => console.error(line), version: readVersion() });
    }
    if (mode === "dashboard") {
      const parsed = parseDashboardArgs(args.slice(1));
      if ("help" in parsed) return (writeAll(1, `${dashboardUsage}\n`), 0);
      if (parsed.refresh) await refreshLedger(env);
      return runDashboard(parsed, env, { stdout: (text) => writeAll(1, text), stderr: (line) => console.error(line) });
    }
    if (mode === "history") {
      return runHistory(parseHistoryArgs(args.slice(1)), repoDir, env, { stdout: (text) => writeAll(1, text), stderr: (line) => console.error(line) });
    }
    if (mode === "reset-confidence") return runResetConfidence(args.slice(1), env);
    const [, prArg, ...rest] = args;
    if (mode !== "review" && mode !== "comment" && mode !== "threads") {
      throw new UsageError(mode ? `Unknown command "${mode}".` : "No command given.");
    }
    const pr = Number(prArg);
    if (!/^\d+$/.test(prArg ?? "") || pr <= 0) {
      throw new UsageError(`${mode} needs a pull request number.`);
    }
    if (mode !== "review" && rest.length > 0) throw new UsageError(`${mode} takes no paths.`);
    // The mode decides who started the run, whatever the environment says: the operator's
    // command is never held to the automatic ceiling, and a thread run always is (ADR 0012).
    const loaded = loadConfig(env);
    const commentLine = mode === "review" ? undefined : readCommentLine(env);
    // A thread reply that asks a question is answered in its thread, as a line question (ADR 0032
    // decision 4); the rest of the thread-only run is unchanged. Its trigger is the question's, not
    // an automatic run's, so it does not spend from the automatic ceiling.
    const effective = routeMode(mode, commentLine, env.REQUEST ?? "", loaded.mention);
    const config = effective === "comment" ? { ...loaded, trigger: "comment" } : effective === "threads" ? { ...loaded, trigger: "thread" } : loaded;
    const provider = getProvider(config.provider, config);
    // The verifier is its own adapter on its own model, always at effort high (ADR 0027).
    const verifier = config.verify && mode !== "threads" ? getProvider(config.provider, { ...config, model: config.verifierModel, effort: "high" }) : undefined;
    required(env, "GH_TOKEN");
    const repo = required(env, "GITHUB_REPOSITORY");
    const request = effective === "comment" ? required(env, "REQUEST") : "";
    const costs: CallCost[] = [];
    const ledgerNotes: string[] = [];
    const deps: Deps = {
      costs,
      ledgerNotes,
      gh: defaultGh,
      provider,
      ...(verifier ? { verifier } : {}),
      config,
      repoDir,
      engineVersion: readVersion(),
      log: (line) => console.log(line),
      warn: (line) => console.error(line),
    };
    // Before any call is paid for: a missing binary or settings file would fail every batch.
    try {
      provider.preflight();
      verifier?.preflight();
    } catch (error) {
      console.error(`wachiman: ${error instanceof Error ? error.message : error}`);
      return 1;
    }
    try {
      if (effective === "review") review(deps, repo, pr, rest);
      else if (effective === "threads") threadReplies(deps, repo, pr, env.AGENT_REVIEW_COMMENT_AUTHOR || undefined);
      else comment(deps, repo, pr, request, env.AGENT_REVIEW_COMMENT_AUTHOR || undefined, commentLine);
    } finally {
      // Also after a failed run: the calls it made were paid for.
      writeStepSummary(costs, env, undefined, ledgerNotes);
    }
    return 0;
  } catch (error) {
    if (error instanceof UsageError || error instanceof UnknownProviderError) {
      console.error(`wachiman: ${error.message}\n\n${USAGE}`);
      return 2;
    }
    if (error instanceof SpendLimitReached) {
      // The notice is already posted. `notice` mode keeps the job green.
      if (error.mode === "notice") {
        console.log(`wachiman: spend limit reached: ${error.message}`);
        return 0;
      }
      console.error(`wachiman: spend limit reached: ${error.message}`);
      return 3;
    }
    if (error instanceof LedgerStopped) {
      console.error(`wachiman: ledger: ${error.message}`);
      return 3;
    }
    console.error(`wachiman: ${error instanceof Error ? error.message : error}`);
    return 1;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2), process.env));
