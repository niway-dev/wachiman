/**
 * `wachiman init` (command contract section 5.5): parse, prompt, resolve, then the one impure
 * half. It writes the chosen workflow file and its `.bak` copy and, when the repository kind is
 * given or answered, the settings file `.wachiman.yml` (ADR 0048), after the person has seen what
 * will be written (or named `--yes` or no terminal with every mandatory flag). In every mode it also
 * adds the pointer to the wachiman-loop skill to `AGENTS.md` or `CLAUDE.md` (src/init/agents.ts). With
 * `--pr-template` (or a yes to the question) it also installs the PR description template, files
 * only, as `wachiman pr-template install` does: `.github/pull_request_template.md` and, when there
 * is something to keep, `.github/pr-template.json`. An existing unmanaged template is adopted and
 * replaced (a `.bak` copy is kept). A refusal or failure there is reported, saying what was and
 * was not written, and does not fail the rest of init. It never commits, pushes, opens a pull
 * request or creates a secret. Its only network use is one optional `gh api user`
 * (src/init/github-login.ts, up to 10 s) to suggest the operator, and only on a terminal in github
 * or both mode; Wachiman itself makes no request (no `fetch`).
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { CommandIo } from "../accounts/commands";
import { UsageError } from "../config";
import { spawnGit, type GitRunner } from "../evidence";
import { repositoryKey } from "../history/store";
import { isInteractive, type TerminalStreams } from "../wizard/interactive";
import { loadTerminalUi } from "../wizard/load";
import type { Outcome, Prompter, PromptIO } from "../wizard/prompt";
import type { Ui } from "../wizard/ui";
import { projectCommands, quoteArgument } from "../wizard/command";
import { previewInstall, runInstall, TEMPLATE_FILE, type Deps as PrTemplateDeps } from "../pr-template/install";
import { CHOICE_FILE } from "../pr-template/catalog";
import { parseInitFlags } from "./args";
import { buildDocument, failureDocument, printDocument, type FileAction, type InitReport } from "./json";
import { DEFAULT_WORKFLOW_REF, initModes, resolveInitOptions, type InitMode, type InitOptions, type RawInitFlags } from "./options";
import { checkSupplied, promptForInit } from "./prompt";
import { planSettings, SETTINGS_PATH, writeSettings, type SettingsPlan } from "./settings";
import { callerHeader, renderCallerWorkflow } from "./render";
import { inspectTarget, sameWorkflow, writeWorkflow, type WriteHooks } from "./write";
import { describePointer, planPointer } from "./agents";
import { writeManagedFile } from "../pr-template/write";

/** What `pr-template install` can write; the report names the ones a failed install did not reach. */
const PR_TEMPLATE_FILES = [CHOICE_FILE, TEMPLATE_FILE];

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
  /** A scripted terminal `Ui`, for a test of the terminal session. Not set: Clack, on a terminal. */
  ui?: Ui;
  /** An open prompt session; the caller closes it. Otherwise one is opened over `promptIO` or the terminal. */
  prompter?: Prompter;
  /** What `wachiman setup` means from here: runs the setup wizard in the same process, sharing `prompter`. */
  bindNow?: (prompter: Prompter, mode: "local" | "both", closing: SessionClosing) => Promise<number>;
  /** The login of the signed-in `gh` user, offered as the default operator. Not set: no default. */
  githubLogin?: () => string | undefined;
  /** The directory a relative `--repo-dir` was resolved against, for the `setup` line. Default: `process.cwd()`. */
  cwd?: string;
  hooks?: WriteHooks;
  /** Dependencies of the PR description template install (`wachiman pr-template install`). */
  prTemplate?: PrTemplateDeps;
  /** Filled by a later stage; read by `runInitCommand` when it closes the session. */
  closing?: SessionClosing;
  /** The same hook for the settings file, for a test. */
  settingsHooks?: WriteHooks;
  /** Set by `--json`: `runInit` records what it did to each file here, and prints no rendered workflow. */
  report?: InitReport;
}

/**
 * What a later stage (setup) wants the session to say when it ends. `warning` closes the session
 * without the red "Stopped.": the work is saved and one named step is left.
 */
export interface SessionClosing {
  warning?: string;
}

const TEMPLATE = join(import.meta.dir, "..", "..", "templates", "wachiman-review-caller.yml");
const readDefaultTemplate = () => readFileSync(TEMPLATE, "utf8");

const openSession = async (deps: InitDeps, env: Record<string, string | undefined>, ui: Awaited<ReturnType<typeof loadTerminalUi>>) => {
  if (deps.prompter) return { prompter: deps.prompter, close: (_outcome: Outcome, _message?: string) => {} };
  const prompter = await ui.openPrompter(deps.promptIO ?? { input: process.stdin, output: process.stderr }, env, deps.ui ? { ui: deps.ui } : undefined);
  // The message is the last line of the session: without it a saved run with one step left would end as "Stopped.".
  return { prompter, close: (outcome: Outcome, message?: string) => prompter.close(outcome, message) };
};

/** How a finished run ends the session: 0 is done, 130 a cancel, anything else a stop. */
const outcomeOf = (code: number): Outcome => (code === 0 ? "done" : code === 130 ? "cancelled" : "failed");

/** `init` as `cli.ts` runs it. A parse failure under `--json` is still one JSON document with exit 2. */
export async function runInitFromArgv(argv: string[], repoDir: string, env: Record<string, string | undefined>, io: CommandIo, deps: InitDeps = {}): Promise<number> {
  let flags: RawInitFlags;
  try {
    flags = parseInitFlags(argv, repoDir);
  } catch (error) {
    if (!(error instanceof UsageError) || !argv.includes("--json")) throw error;
    const at = argv.indexOf("--mode");
    const named = at >= 0 ? argv[at + 1] : undefined;
    const mode = initModes.includes(named as InitMode) ? (named as InitMode) : null;
    io.stderr(error.message);
    printDocument(io.stdout, failureDocument({ mode, dryRun: argv.includes("--dry-run"), repoDir: resolve(deps.cwd ?? process.cwd(), repoDir), report: {}, code: "usage", message: error.message }));
    return 2;
  }
  return runInitCommand(flags, env, io, deps);
}

/** `--json`: never asks, prints one document, and sends every human line to stderr. */
async function runInitJson(flags: RawInitFlags, io: CommandIo, deps: InitDeps): Promise<number> {
  const report: InitReport = {};
  const defaultWorkflowRef = "defaultWorkflowRef" in deps ? deps.defaultWorkflowRef : DEFAULT_WORKFLOW_REF;
  let repoDir = resolve(deps.cwd ?? process.cwd(), flags.repoDir ?? ".");
  const named = flags.mode as InitMode;
  let mode: InitMode | null = initModes.includes(named) ? named : null;
  // Anything else init would print on stdout is a human line here.
  const quiet: CommandIo = { stdout: (text) => io.stderr(text.replace(/\n$/, "")), stderr: io.stderr };
  try {
    repoDir = worktreeRoot(flags.repoDir ?? ".", deps.git);
    const resolved = resolveInitOptions(flags, { interactive: false, defaultWorkflowRef });
    if (!resolved.ok) throw new UsageError(resolved.error);
    mode = resolved.options.mode;
    await runInit(resolved.options, quiet, { ...deps, prompter: undefined, report });
    printDocument(io.stdout, buildDocument({ mode, dryRun: resolved.options.github?.dryRun ?? resolved.options.dryRun === true, repoDir, report }));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const usage = error instanceof UsageError;
    io.stderr(message);
    printDocument(io.stdout, failureDocument({ mode, dryRun: flags.dryRun === true, repoDir, report, code: usage ? "usage" : "failed", message }));
    return usage ? 2 : 1;
  }
}

/** From the parsed flags: asks what is missing when a person can be asked, resolves, and runs. */
export async function runInitCommand(flags: RawInitFlags, env: Record<string, string | undefined>, io: CommandIo, deps: InitDeps = {}): Promise<number> {
  if (flags.json) return runInitJson(flags, io, deps);
  // Fail before asking for an operator or account in an unusable target.
  const root = worktreeRoot(flags.repoDir ?? ".", deps.git);
  const interactive = deps.interactive ?? isInteractive(flags, env, deps.streams ?? { stdin: process.stdin, stdout: process.stdout });
  const defaultWorkflowRef = "defaultWorkflowRef" in deps ? deps.defaultWorkflowRef : DEFAULT_WORKFLOW_REF;
  // The terminal UI (chalk and Clack) is loaded only when questions are asked.
  const ui = interactive ? await loadTerminalUi() : undefined;
  const session = ui ? await openSession(deps, env, ui) : undefined;
  if (ui) io = ui.wizardIo(io, (deps.promptIO?.output ?? process.stderr) as { isTTY?: boolean }, env, session?.prompter);
  let outcome: Outcome = "failed";
  const closing: SessionClosing = {};
  try {
    let answered = flags;
    if (session) {
      checkSupplied(flags);
      // Only the command that opened the session plays the intro; a caller that passed its own prompter did already,
      // and the launcher marks WACHIMAN_INTRO_DONE, which `prompter.intro` honors.
      if (!deps.prompter) await session.prompter.intro(deps.version ?? "unknown", "Let's put a watch post on this repo.");
      session.prompter.step("Project", 1);
      session.prompter.say(root, "muted");
      const asked = await promptForInit(flags, { defaultWorkflowRef, githubLogin: deps.githubLogin }, session.prompter);
      if (asked === null) {
        io.stderr("cancelled: nothing was written.");
        outcome = "cancelled";
        return 130;
      }
      answered = asked;
    }
    const resolved = resolveInitOptions(answered, { interactive, defaultWorkflowRef });
    if (!resolved.ok) throw new UsageError(resolved.error);
    const code = await runInit(resolved.options, io, { ...deps, prompter: session?.prompter, closing });
    // A saved run with one step left (a failed sign-in) ends neutrally, not as "Stopped.". The exit code is unchanged.
    outcome = code !== 0 && code !== 130 && closing.warning !== undefined ? "done" : outcomeOf(code);
    return code;
  } finally {
    session?.close(outcome, closing.warning);
  }
}

/** The only impure half: writes under confirm. */
export async function runInit(options: InitOptions, io: CommandIo, deps: InitDeps = {}): Promise<number> {
  const cwd = deps.cwd ?? process.cwd();
  // Before anything is rendered or written: this must be a git repository.
  const root = worktreeRoot(options.repoDir, deps.git);
  // The agent pointer is planned here, so a malformed block refuses the run before anything is written.
  const pointer = planPointer(root);
  const { github } = options;
  const dryRun = github?.dryRun ?? options.dryRun === true;
  const report = deps.report;
  const prompter = options.interactive ? deps.prompter : undefined;
  let written: string | undefined;
  let templateDone = false;
  let templateInstalled = false;
  /** Installs the PR description template once, at the end of the workflow work. A refusal or a failure is a report, not a failure of init. Returns whether it is in place. */
  const installTemplate = (): boolean => {
    if (!options.prTemplate) return false;
    if (templateDone) return templateInstalled;
    templateDone = true;
    const existed = new Set(PR_TEMPLATE_FILES.filter((f) => existsSync(join(root, f))));
    const backups = new Map<string, string>();
    // `install` reports each file it writes through `onWrite`; that tells a failure that wrote nothing from one that stopped halfway.
    const wrote: string[] = [];
    const record = (file: string, backup?: string) => {
      wrote.push(file);
      if (backup !== undefined) backups.set(file, isAbsolute(backup) && !relative(root, backup).startsWith("..") ? relative(root, backup) : backup);
    };
    try {
      // Same semantics as `pr-template install` with no --force and no --commit: init never commits.
      runInstall({ force: false, commit: false }, root, io, { ...deps.prTemplate, onWrite: record });
      templateInstalled = true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (wrote.length === 0) {
        io.stderr(`pr-template: not installed: ${reason}`);
      } else {
        const missing = PR_TEMPLATE_FILES.filter((f) => !wrote.includes(f));
        io.stderr(`pr-template: only part of the install was done: ${reason}`);
        io.stderr(`pr-template: written: ${wrote.join(", ")}; not written: ${missing.length > 0 ? missing.join(", ") : "nothing else"}.`);
      }
      io.stderr("The rest of init is unaffected. See `wachiman pr-template status`.");
    }
    if (report) {
      const entry = (path: string): { path: string; action: FileAction; backup?: string } => {
        if (wrote.includes(path)) return { path, action: existed.has(path) ? "replaced" : "created", ...(backups.has(path) ? { backup: backups.get(path) } : {}) };
        return { path, action: templateInstalled ? "unchanged" : "refused" };
      };
      report.template = [entry(TEMPLATE_FILE), ...(wrote.includes(CHOICE_FILE) ? [entry(CHOICE_FILE)] : [])];
    }
    return templateInstalled;
  };

  /** A dry run: what installing the template would do, without writing. */
  const previewTemplate = () => {
    if (!report || !options.prTemplate) return;
    const preview = previewInstall(root, deps.prTemplate);
    report.template = [{ path: TEMPLATE_FILE, action: { create: "would-create", replace: "would-replace", unchanged: "unchanged", refused: "refused" }[preview] as FileAction }];
  };

  // The settings file: planned first (a link or a non-file in the way fails before anything is written), written under the same confirm.
  const plan = options.settings ? planSettings(root, options.settings.kind) : undefined;
  let settingsToWrite = plan && plan.action !== "same" ? plan : undefined;
  let settingsWritten = false;
  if (plan?.action === "same") io.stderr(`${SETTINGS_PATH} already says kind: ${plan.kind}.`);
  if (report && plan?.action === "same") report.settings = { path: SETTINGS_PATH, action: "unchanged" };
  else if (report && plan && dryRun) report.settings = { path: SETTINGS_PATH, action: plan.action === "create" ? "would-create" : options.settings?.force ? "would-replace" : "refused" };
  if (settingsToWrite && dryRun) {
    io.stderr(`would write ${SETTINGS_PATH} (kind: ${settingsToWrite.kind})`);
    if (settingsToWrite.action === "change" && !options.settings?.force) {
      io.stderr(`note: ${SETTINGS_PATH} says kind: ${settingsToWrite.from ?? "(none)"}; a real run needs --force to change it.`);
    }
  }
  if (settingsToWrite?.action === "change" && !dryRun && !prompter && !options.settings?.force) {
    if (report) report.settings = { path: SETTINGS_PATH, action: "refused" };
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
    if (report) report.settings = { path: SETTINGS_PATH, action: settingsToWrite.action === "create" ? "created" : "replaced" };
    io.stderr(`wrote ${SETTINGS_PATH} (kind: ${settingsToWrite.kind}).`);
  };

  /** The pointer to the wachiman-loop skill, last among the files: a run refused or cancelled above writes none of them. */
  const writePointer = () => {
    if (pointer.action === "same") {
      io.stderr(`${pointer.file} already has the wachiman pointer; unchanged.`);
      return;
    }
    writeManagedFile({ repoDir: root, relativePath: pointer.file, content: pointer.content, inspected: pointer.inspected, now: (deps.now ?? (() => new Date().toISOString()))(), label: "init", backup: false, hooks: deps.hooks });
    const how = pointer.action === "create" ? "created" : pointer.action === "append" ? "added to" : "replaced in";
    io.stderr(`wrote the wachiman pointer: ${how} ${pointer.file}.`);
  };

  /** The settings file alone, with no workflow to write: shows it, asks what needs asking. Returns an exit code to stop with, or undefined to go on. */
  const askSettingsAlone = async (): Promise<number | undefined> => {
    if (!prompter || !settingsToWrite) return undefined;
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
      if (!answer) {
        io.stderr("not written.");
        settingsToWrite = undefined;
      }
    }
    return undefined;
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
    // A re-run after a failure finds its own earlier output: the same workflow, not a conflict.
    const unchanged = inspected.exists && sameWorkflow(readFileSync(inspected.target, "utf8"), rendered);

    if (github.dryRun) {
      if (unchanged) io.stderr(`note: ${shown} is unchanged.`);
      else if (inspected.exists && !github.force && !prompter) io.stderr(`note: ${shown} exists; a real run needs --force to replace it (a .bak copy is kept).`);
      for (const line of describePointer(pointer)) io.stderr(line);
      if (options.prTemplate) io.stderr("note: --dry-run writes nothing, so the PR description template is not installed; `wachiman pr-template show` prints it.");
      if (report) {
        const refused = inspected.exists && !unchanged && !github.force;
        report.workflow = { path: shown, action: unchanged ? "unchanged" : refused ? "refused" : inspected.exists ? "would-replace" : "would-create", content: rendered };
        previewTemplate();
      } else io.stdout(rendered);
      return 0;
    }
    if (inspected.exists && !github.force && !prompter && !unchanged) {
      if (report) report.workflow = { path: shown, action: "refused" };
      throw new UsageError(`A workflow already exists at ${shown}. Re-run with --force to replace it (a .bak copy is kept).`);
    }
    if (unchanged) {
      io.stderr(`${shown} is unchanged: it already holds what init would write.`);
      if (prompter && settingsToWrite) {
        const code = await askSettingsAlone();
        if (code !== undefined) return code;
      }
      written = shown;
      if (report) report.workflow = { path: shown, action: "unchanged" };
    } else if (prompter) {
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
      // A re-run asks to replace, and the default is yes: the person is running init again on purpose, and the earlier file is kept as a .bak copy.
      const answer = await prompter.confirm(inspected.exists ? "Replace the existing workflow? A .bak copy is kept." : "Write it?", true);
      if (answer === null) {
        io.stderr("cancelled: nothing was written.");
        return 130;
      }
      if (!answer) {
        io.stderr("not written.");
        const templateIn = installTemplate();
        // The closing line of a terminal session says what happened, not "All set".
        if (prompter.fancy) prompter.close("done", templateIn ? "The workflow was not written; the PR description template is in place." : "Nothing was written.");
        return 0;
      }
    } else {
      io.stderr(`writing ${shown} (${inspected.exists ? "replacing the existing file; a .bak copy is kept" : "new"}).`);
    }
    if (!unchanged) {
      // The workflow first: it is what the run is for. If the settings file then fails, the error says the workflow stays.
      const result = writeWorkflow({ repoDir: root, relativePath: github.path, content: rendered, inspected, now, hooks: deps.hooks });
      written = shown;
      if (report) report.workflow = { path: shown, action: inspected.exists ? "replaced" : "created", ...(result.backup ? { backup: join(dirname(github.path), basename(result.backup)) } : {}) };
      io.stderr(`wrote ${shown}${result.backup ? `; the earlier file is kept as ${join(dirname(github.path), basename(result.backup))}` : ""}.`);
    }
    // The template is reported and never fails init, so it goes before the settings file, which can throw.
    installTemplate();
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

  if (!github && dryRun) {
    // A local dry run previews the files init would write and writes none (decision 4 of the agent-operated setup spec).
    if (options.prTemplate) io.stderr("note: --dry-run writes nothing, so the PR description template is not installed; `wachiman pr-template show` prints it.");
    previewTemplate();
    if (!options.settings && !options.prTemplate) {
      io.stderr("dry run: nothing would be written. Local mode has no workflow; a project kind or the PR template are the only files it writes.");
      for (const command of projectCommands("setup", options.repoDir, cwd)) io.stderr(`Next, on this machine: ${command}   (binds this repository to a Claude account)`);
    }
    return 0;
  }
  if (!github && settingsToWrite && prompter) {
    const code = await askSettingsAlone();
    if (code !== undefined) return code;
    commitSettings();
  } else if (!github) commitSettings();
  if (!github && settingsWritten) {
    if (prompter?.fancy) prompter.nextAction(`Commit ${SETTINGS_PATH} so the repository kind travels with it. init does not commit.`, [`git add ${SETTINGS_PATH}`, 'git commit -m "Record the repository kind for Wachiman"']);
    else io.stderr(`Commit ${SETTINGS_PATH} like any file; init does not commit.`);
  }
  installTemplate();
  writePointer();

  if (options.mode === "github") {
    io.stderr("github: pending; workflow written, add the secret and submit the workflow. Remote readiness was not checked.");
    return 0;
  }
  if (prompter && deps.bindNow) {
    try {
      const code = await deps.bindNow(prompter, options.mode, deps.closing ?? {});
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
