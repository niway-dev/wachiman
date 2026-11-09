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
 *   wachiman history                list and judge what `local --history` kept on this laptop
 *   wachiman setup --profile <name> bind this repository to an account profile (home config only)
 *   wachiman doctor                 explain what a local run would use and what would fail
 *   wachiman profile …              list, create, add, login, remove and default account profiles
 *   wachiman project show|unbind    inspect or remove this repository's binding
 *   wachiman --setup-profile [name] sign in an isolated Claude Code profile under the Wachiman home
 *
 * Exit codes: 0 posted or nothing to do; 1 engine error (nothing posted); 2 usage error.
 * The settings are documented in docs/cli.md.
 */
import { existsSync, readFileSync, statSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";
import { writeStepSummary, type CallCost } from "./cost";
import { loadConfig, UsageError } from "./config";
import { historyUsage, parseHistoryArgs, runHistory } from "./history/command";
import { comment, defaultGh, review, threadReplies, type Deps } from "./engine";
import { localUsage, parseLocalArgs, runLocal } from "./local";
import { parseProfileArgs, parseProjectArgs, parseSetupArgs, profileUsage, projectUsage, runProfile, runProject, runSetup, setupUsage } from "./accounts/commands";
import { wachimanHome } from "./accounts/config";
import { doctorUsage, parseDoctorArgs, runDoctor } from "./doctor/run";
import { DEFAULT_ISOLATED_NAME, setupProfile } from "./profiles";
import { getProvider, PROVIDER_NAMES, UnknownProviderError } from "./providers";

export const USAGE = `Usage:
  wachiman review <pr> [paths…] [--repo-dir <dir>]   Review a pull request (or only the given paths)
  wachiman comment <pr> [--repo-dir <dir>]           Handle the comment in $REQUEST (a review or an answer)
  wachiman threads <pr> [--repo-dir <dir>]           Answer the pending Wachiman threads (an automatic run)
  ${localUsage}
                                                     Review the committed branch of a clone on your
                                                     signed-in claude, and print it; nothing is posted.
                                                     --commit: that one commit (<commit>^ → <commit>);
                                                     --from: that commit forward (<commit>^ → HEAD)
  ${historyUsage}
                                                     List, judge and forget the findings kept by
                                                     \`local --history\`; reads files and local git
                                                     metadata only: no claude, no GitHub
  ${setupUsage}
                                                     Bind this repository to an account profile that
                                                     already exists; written in the Wachiman home, never
                                                     in the repository. Without --profile it needs a TTY
                                                     (the guided wizard comes later)
  ${doctorUsage}
                                                     Explain what a local run would use and what would
                                                     fail; exit 1 when a required check fails
  ${profileUsage.split("\n").join("\n  ")}
                                                     Manage account profiles; a managed profile lives in
                                                     ~/.wachiman/claude-<name>, an external one is your own
                                                     Claude configuration directory, used in place
  ${projectUsage.split("\n").join("\n  ")}
  wachiman --setup-profile [<name>]                  Sign in an isolated profile, ~/.wachiman/claude-<name>
                                                     (an alias of \`wachiman profile create\`)
  wachiman --help | --version

Options:
  --repo-dir <dir>                   The checked-out pull request head: every file the engine reads
                                     and the agent's working directory. Default: the current directory.
                                     For \`local\`: the clone whose branch is reviewed.

Environment:
  GH_TOKEN, GITHUB_REPOSITORY        required (not read by \`local\` or \`--setup-profile\`)
  ANTHROPIC_API_KEY                  required by the claude-code provider (not in a dry run);
                                     \`local\` refuses to start when it is set
  REQUEST                            the comment text, for \`comment\`
  AGENT_REVIEW_COMMENT_AUTHOR        the login of the comment's author, for \`comment\` and \`threads\`
  AGENT_REVIEW_*                     optional settings; see docs/cli.md

Exit codes: 0 posted or nothing to do, 1 engine error, 2 usage error.
\`local\`: 0 a report was printed, 1 no call returned a review, 2 usage error, 130 interrupted.
\`history\`: 0 listed (or nothing to list), 2 usage error, including an unknown finding id.
\`doctor\`: 0 every required check passed, 1 one failed. \`setup\`: 1 when its closing doctor summary failed.
Guide: docs/local-review.md`;

/** package.json sits one level above src/; in a copied layout it may belong to someone else. */
export function readVersion(dir = import.meta.dir) {
  try {
    const path = join(dir, "..", "package.json");
    if (!existsSync(path)) return "unknown";
    const pkg = JSON.parse(readFileSync(path, "utf8"));
    return pkg.name === "agent-review" ? String(pkg.version) : "unknown";
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

function required(env: Record<string, string | undefined>, name: string) {
  const value = env[name];
  if (value === undefined || value === "") throw new UsageError(`${name} is not set`);
  return value;
}

/** `setup`, `doctor`, `profile` and `project`: no GitHub, no model call; the account store and the machine only. */
function runAccountCommand(mode: "setup" | "doctor" | "profile" | "project", args: string[], repoDir: string, env: Record<string, string | undefined>) {
  const io = { stdout: (text: string) => writeAll(1, text), stderr: (line: string) => console.error(line) };
  const deps = { doctor: { version: readVersion() } };
  if (mode === "profile") return runProfile(parseProfileArgs(args), env, io, deps);
  if (mode === "project") return runProject(parseProjectArgs(args, repoDir), env, io, deps);
  if (mode === "setup") {
    const parsed = parseSetupArgs(args, repoDir);
    if ("help" in parsed) return (io.stdout(`${setupUsage}\n`), 0);
    return runSetup(parsed, env, io, deps);
  }
  const parsed = parseDoctorArgs(args, repoDir);
  if ("help" in parsed) return (io.stdout(`${doctorUsage}\n`), 0);
  return runDoctor(parsed, env, io, deps.doctor);
}

export function main(argv: string[], env: Record<string, string | undefined>): number {
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
    const { repoDir, rest: args } = extractRepoDir(argv);
    if (mode === "local") {
      // No GitHub: no token, no repository, no `gh` function anywhere on this path.
      return runLocal(parseLocalArgs(args.slice(1)), repoDir, env, {
        stdout: (text) => writeAll(1, text),
        stderr: (line) => console.error(line),
        engineVersion: readVersion(),
      });
    }
    if (mode === "setup" || mode === "doctor" || mode === "profile" || mode === "project") {
      return runAccountCommand(mode, args.slice(1), repoDir, env);
    }
    if (mode === "history") {
      return runHistory(parseHistoryArgs(args.slice(1)), repoDir, env, { stdout: (text) => writeAll(1, text), stderr: (line) => console.error(line) });
    }
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
    const config = mode === "comment" ? { ...loaded, trigger: "comment" } : mode === "threads" ? { ...loaded, trigger: "thread" } : loaded;
    const provider = getProvider(config.provider, config);
    required(env, "GH_TOKEN");
    const repo = required(env, "GITHUB_REPOSITORY");
    const request = mode === "comment" ? required(env, "REQUEST") : "";
    const costs: CallCost[] = [];
    const deps: Deps = {
      costs,
      gh: defaultGh,
      provider,
      config,
      repoDir,
      engineVersion: readVersion(),
      log: (line) => console.log(line),
      warn: (line) => console.error(line),
    };
    // Before any call is paid for: a missing binary or settings file would fail every batch.
    try {
      provider.preflight();
    } catch (error) {
      console.error(`wachiman: ${error instanceof Error ? error.message : error}`);
      return 1;
    }
    try {
      if (mode === "review") review(deps, repo, pr, rest);
      else if (mode === "threads") threadReplies(deps, repo, pr, env.AGENT_REVIEW_COMMENT_AUTHOR || undefined);
      else comment(deps, repo, pr, request, env.AGENT_REVIEW_COMMENT_AUTHOR || undefined);
    } finally {
      // Also after a failed run: the calls it made were paid for.
      writeStepSummary(costs, env);
    }
    return 0;
  } catch (error) {
    if (error instanceof UsageError || error instanceof UnknownProviderError) {
      console.error(`wachiman: ${error.message}\n\n${USAGE}`);
      return 2;
    }
    console.error(`wachiman: ${error instanceof Error ? error.message : error}`);
    return 1;
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2), process.env));
