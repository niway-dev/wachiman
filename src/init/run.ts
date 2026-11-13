/**
 * `wachiman init` (command contract section 5.5): parse, prompt, resolve, then the one impure
 * half. It writes only the chosen workflow file and its `.bak` copy, and, when the repository kind
 * is given or answered, the settings file `.github/wachiman.yml` (ADR 0048), after the person has
 * seen what will be written (or named `--yes` or no terminal with every mandatory flag). It never
 * commits, pushes, opens a pull request or creates a secret, and it makes no network request.
 */
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { CommandIo } from "../accounts/commands";
import { UsageError } from "../config";
import { spawnGit, type GitRunner } from "../evidence";
import { repositoryKey } from "../history/store";
import { isInteractive, type TerminalStreams } from "../wizard/interactive";
import { loadTerminalUi } from "../wizard/load";
import type { Outcome, Prompter, PromptIO } from "../wizard/prompt";
import { projectCommands, quoteArgument } from "../wizard/command";
import { DEFAULT_WORKFLOW_REF, resolveInitOptions, type InitOptions, type RawInitFlags } from "./options";
import { checkSupplied, promptForInit } from "./prompt";
import { planSettings, SETTINGS_PATH, writeSettings, type SettingsPlan } from "./settings";
import { callerHeader, renderCallerWorkflow } from "./render";
import { inspectTarget, writeWorkflow, type WriteHooks } from "./write";

export interface InitDeps {
  /** The caller template. Default: `templates/wachiman-review-caller.yml` of this install. */
  readTemplate?: () => string;
  now?: () => string;
  /** Wachiman's own version, for the header comment. */
  version?: string;
  git?: GitRunner;
  /** The bundled known-published workflow ref. Default: `DEFAULT_WORKFLOW_REF`. */
  defaultWorkflowRef?: string | undefined;
  /** Overrides the terminal check, for a test. */
  interactive?: boolean;
  streams?: TerminalStreams;
  promptIO?: PromptIO;
  /** An open prompt session; the caller closes it. Otherwise one is opened over `promptIO` or the terminal. */
  prompter?: Prompter;
  /** What `wachiman setup` means from here: runs the setup wizard in the same process, sharing `prompter`. */
  bindNow?: (prompter: Prompter, mode: "local" | "both") => Promise<number>;
  /** The directory a relative `--repo-dir` was resolved against, for the `setup` line. Default: `process.cwd()`. */
  cwd?: string;
  hooks?: WriteHooks;
  /** The same hook for the settings file, for a test. */
  settingsHooks?: WriteHooks;
}

const TEMPLATE = join(import.meta.dir, "..", "..", "templates", "wachiman-review-caller.yml");
const readDefaultTemplate = () => readFileSync(TEMPLATE, "utf8");

const openSession = async (deps: InitDeps, env: Record<string, string | undefined>, ui: Awaited<ReturnType<typeof loadTerminalUi>>) => {
  if (deps.prompter) return { prompter: deps.prompter, close: (_outcome: Outcome) => {} };
  const prompter = await ui.openPrompter(deps.promptIO ?? { input: process.stdin, output: process.stderr }, env);
  return { prompter, close: (outcome: Outcome) => prompter.close(outcome) };
};

/** How a finished run ends the session: 0 is done, 130 a cancel, anything else a stop. */
const outcomeOf = (code: number): Outcome => (code === 0 ? "done" : code === 130 ? "cancelled" : "failed");

/** From the parsed flags: asks what is missing when a person can be asked, resolves, and runs. */
export async function runInitCommand(flags: RawInitFlags, env: Record<string, string | undefined>, io: CommandIo, deps: InitDeps = {}): Promise<number> {
  // Fail before asking for an operator or account in an unusable target.
  const root = worktreeRoot(flags.repoDir ?? ".", deps.git);
  const interactive = deps.interactive ?? isInteractive(flags, env, deps.streams ?? { stdin: process.stdin, stdout: process.stdout });
  const defaultWorkflowRef = "defaultWorkflowRef" in deps ? deps.defaultWorkflowRef : DEFAULT_WORKFLOW_REF;
  // The terminal UI (chalk and Clack) is loaded only when questions are asked.
  const ui = interactive ? await loadTerminalUi() : undefined;
  const session = ui ? await openSession(deps, env, ui) : undefined;
  if (ui) io = ui.wizardIo(io, (deps.promptIO?.output ?? process.stderr) as { isTTY?: boolean }, env, session?.prompter);
  let outcome: Outcome = "failed";
  try {
    let answered = flags;
    if (session) {
      checkSupplied(flags);
      // Only the command that opened the session plays the intro; a caller that passed its own prompter did already,
      // and the launcher marks WACHIMAN_INTRO_DONE, which `prompter.intro` honors.
      if (!deps.prompter) await session.prompter.intro(deps.version ?? "unknown", "Let's put a watch post on this repo.");
      session.prompter.step("Project", 1);
      session.prompter.say(root, "muted");
      const asked = await promptForInit(flags, { defaultWorkflowRef }, session.prompter);
      if (asked === null) {
        io.stderr("cancelled: nothing was written.");
        outcome = "cancelled";
        return 130;
      }
      answered = asked;
    }
    const resolved = resolveInitOptions(answered, { interactive, defaultWorkflowRef });
    if (!resolved.ok) throw new UsageError(resolved.error);
    const code = await runInit(resolved.options, io, { ...deps, prompter: session?.prompter });
    outcome = outcomeOf(code);
    return code;
  } finally {
    session?.close(outcome);
  }
}

/** The only impure half: writes under confirm. */
export async function runInit(options: InitOptions, io: CommandIo, deps: InitDeps = {}): Promise<number> {
  const cwd = deps.cwd ?? process.cwd();
  // Before anything is rendered or written: this must be a git repository.
  const root = worktreeRoot(options.repoDir, deps.git);
  const { github } = options;
  const prompter = options.interactive ? deps.prompter : undefined;
  let written: string | undefined;

  // The settings file: planned first (a link or a non-file in the way fails before anything is written), written under the same confirm.
  const plan = options.settings ? planSettings(root, options.settings.kind) : undefined;
  let settingsToWrite = plan && plan.action !== "same" ? plan : undefined;
  let settingsWritten = false;
  if (plan?.action === "same") io.stderr(`${SETTINGS_PATH} already says kind: ${plan.kind}.`);
  if (settingsToWrite && github?.dryRun) {
    io.stderr(`would write ${SETTINGS_PATH} (kind: ${settingsToWrite.kind})`);
    if (settingsToWrite.action === "change" && !options.settings?.force) {
      io.stderr(`note: ${SETTINGS_PATH} says kind: ${settingsToWrite.from ?? "(none)"}; a real run needs --force to change it.`);
    }
  }
  if (settingsToWrite?.action === "change" && !github?.dryRun && !prompter && !options.settings?.force) {
    throw new UsageError(`${SETTINGS_PATH} says kind: ${settingsToWrite.from ?? "(none)"}, not ${settingsToWrite.kind}. Re-run with --force to change it.`);
  }
  const settingsTitle = (p: Exclude<SettingsPlan, { action: "same" }>) => (p.action === "create" ? `${SETTINGS_PATH} (new)` : `${SETTINGS_PATH} (kind: ${p.from ?? "none"} to ${p.kind})`);
  const showSettings = (p: Exclude<SettingsPlan, { action: "same" }>) => {
    const body = p.action === "create" ? p.content.replace(/\n$/, "") : `kind: ${p.kind}`;
    if (prompter?.fancy) prompter.note(body, settingsTitle(p));
    else {
      io.stderr(`--- ${settingsTitle(p)}`);
      io.stderr(body);
    }
  };
  /** Asks before replacing a different `kind:`; false: kept as it is, null: cancelled. */
  const confirmChange = async (): Promise<boolean | null> => {
    if (!prompter || settingsToWrite?.action !== "change") return true;
    const { from, kind } = settingsToWrite;
    const answer = await prompter.confirm(from === undefined ? `Add kind: ${kind} to ${SETTINGS_PATH}?` : `Change kind from ${from} to ${kind} in ${SETTINGS_PATH}?`, true);
    if (answer === false) {
      io.stderr(`${SETTINGS_PATH} left as it is.`);
      settingsToWrite = undefined;
    }
    return answer;
  };
  const commitSettings = () => {
    if (!settingsToWrite) return;
    writeSettings(root, settingsToWrite, deps.settingsHooks);
    settingsWritten = true;
    io.stderr(`wrote ${SETTINGS_PATH} (kind: ${settingsToWrite.kind}).`);
  };

  if (github) {
    const now = (deps.now ?? (() => new Date().toISOString()))();
    const rendered = renderCallerWorkflow((deps.readTemplate ?? readDefaultTemplate)(), {
      operator: github.operator,
      tag: github.tag,
      header: callerHeader({ version: deps.version ?? "unknown", now }),
    });
    const inspected = inspectTarget(root, github.path);
    const shown = github.path;

    if (github.dryRun) {
      if (inspected.exists && !github.force) io.stderr(`note: ${shown} exists; a real run needs --force to replace it (a .bak copy is kept).`);
      io.stdout(rendered);
      return 0;
    }
    if (inspected.exists && !github.force) {
      throw new UsageError(`A workflow already exists at ${shown}. Re-run with --force to replace it (a .bak copy is kept).`);
    }
    if (prompter) {
      const preview = rendered.replace(/\n$/, "");
      // On a terminal the preview is a titled note in the session frame; otherwise it is the lines it always was.
      if (prompter.fancy) prompter.note(preview, `${shown} (${inspected.exists ? "would overwrite" : "new"})`);
      else {
        io.stderr(`--- ${shown} (${inspected.exists ? "would overwrite" : "new"})`);
        io.stderr(preview);
      }
      if (settingsToWrite) showSettings(settingsToWrite);
      const changeAnswer = await confirmChange();
      if (changeAnswer === null) {
        io.stderr("cancelled: nothing was written.");
        return 130;
      }
      const answer = await prompter.confirm("Write it?", true);
      if (answer === null) {
        io.stderr("cancelled: nothing was written.");
        return 130;
      }
      if (!answer) {
        io.stderr("not written.");
        // The closing line of a terminal session says what happened, not "All set".
        if (prompter.fancy) prompter.close("done", "Nothing was written.");
        return 0;
      }
    } else {
      io.stderr(`writing ${shown} (${inspected.exists ? "replacing the existing file; a .bak copy is kept" : "new"}).`);
    }
    // The workflow first: it is what the run is for. If the settings file then fails, the error says the workflow stays.
    const result = writeWorkflow({ repoDir: root, relativePath: github.path, content: rendered, inspected, now, hooks: deps.hooks });
    written = shown;
    io.stderr(`wrote ${shown}${result.backup ? `; the earlier file is kept as ${join(dirname(github.path), basename(result.backup))}` : ""}.`);
    try {
      commitSettings();
    } catch (error) {
      io.stderr(`${shown} was written before ${SETTINGS_PATH} failed and stays in place.`);
      throw error;
    }
    if (options.mode === "github") prompter?.step("Checks and next actions", 5, 5);
    if (prompter?.fancy) {
      // The same two things, as the closing "Next steps" box with the commands to run.
      prompter.nextAction("Add the repository secret ANTHROPIC_API_KEY (a Console key; Actions runs are billed to it): Settings, Secrets and variables, Actions.", ["gh secret set ANTHROPIC_API_KEY"]);
      const added = settingsWritten ? `${shown} and ${SETTINGS_PATH}` : shown;
      prompter.nextAction(`Open a pull request that adds ${added}. init does not commit, push or open one.`, [
        `git add ${quoteArgument(shown, "posix")}${settingsWritten ? ` ${SETTINGS_PATH}` : ""}`,
        `git commit -m "Add the Wachiman review workflow${settingsWritten ? " and settings" : ""}"`,
        "git push",
      ]);
      prompter.say("Local runs use your signed-in claude, never this key.", "muted");
    } else {
      io.stderr("Two things are left to do in GitHub:");
      io.stderr("  1. Add the repository secret ANTHROPIC_API_KEY (a Console key; Actions runs are billed to it): Settings, Secrets and variables, Actions.");
      io.stderr(`  2. Open a pull request that adds ${settingsWritten ? `${shown} and ${SETTINGS_PATH}` : shown}. init does not commit, push or open one.`);
      io.stderr("Local runs use your signed-in claude, never this key.");
    }
  }

  if (!github && settingsToWrite && prompter) {
    showSettings(settingsToWrite);
    const changeAnswer = await confirmChange();
    if (changeAnswer === null) {
      io.stderr("cancelled: nothing was written.");
      return 130;
    }
    if (settingsToWrite) {
      const answer = settingsToWrite.action === "create" ? await prompter.confirm(`Write ${SETTINGS_PATH}?`, true) : true;
      if (answer === null) {
        io.stderr("cancelled: nothing was written.");
        return 130;
      }
      if (answer) commitSettings();
      else io.stderr("not written.");
    }
  } else if (!github) commitSettings();
  if (!github && settingsWritten) {
    if (prompter?.fancy) prompter.nextAction(`Commit ${SETTINGS_PATH} so the repository kind travels with it. init does not commit.`, [`git add ${SETTINGS_PATH}`, 'git commit -m "Record the repository kind for Wachiman"']);
    else io.stderr(`Commit ${SETTINGS_PATH} like any file; init does not commit.`);
  }

  if (options.mode === "github") {
    io.stderr("github: pending; workflow written, add the secret and submit the workflow. Remote readiness was not checked.");
    return 0;
  }
  if (prompter && deps.bindNow) {
    try {
      const code = await deps.bindNow(prompter, options.mode);
      if (code === 130 && written) io.stderr(`${written} was written before setup was cancelled and stays in place.`);
      if (code !== 130 && written) io.stderr(`github: pending; ${written} is written. Secret and workflow submission still require action in GitHub.`);
      return code;
    } catch (error) {
      if (written) io.stderr(`${written} was written before setup failed and stays in place.`);
      throw error;
    }
  }

  if (written) io.stderr(`github: pending; ${written} is written. Secret and workflow submission still require action in GitHub.`);
  for (const command of projectCommands("setup", options.repoDir, cwd)) io.stderr(`Next, on this machine: ${command}   (binds this repository to a Claude account)`);
  return 0;
}

/** Workflows belong at the Git top level, including when init starts below it. */
function worktreeRoot(repoDir: string, git: GitRunner = spawnGit): string {
  repositoryKey(repoDir, git);
  const top = git(["rev-parse", "--show-toplevel"], { cwd: repoDir, timeoutMs: 10_000 });
  if (top.status !== 0 || top.stdout.trim() === "") {
    throw new UsageError(`${repoDir} is not inside a git work tree; run init from the repository or pass --repo-dir <its top level>.`);
  }
  return top.stdout.trim();
}
