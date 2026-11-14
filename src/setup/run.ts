/**
 * `wachiman setup` (command contract section 5.4): parse, prompt, resolve, run. Without a
 * terminal, or with `--yes`, it is the slice-0 command: `--profile` names a profile that already
 * resolves. On a terminal it asks (see `./prompt.ts`) and saves the one locked config transaction
 * that registers the proposed profile, if any, and binds the repository. A model is never called;
 * nothing is written under the repository.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import {
  binaryProblem,
  checkExternalConfigDir,
  checkNewProfileName,
  closeSetup,
  loadConfig,
  projectShow,
  runProfile,
  runSetup,
  type AccountDeps,
  type CommandIo,
  type InteractiveSpawn,
} from "../accounts/commands";
import { updateConfig, wachimanHome, type ProfileEntry, type ProjectBinding, type WachimanConfigV1 } from "../accounts/config";
import { confirmProfile, confirmProfileAsync, type AsyncSpawnFn } from "../accounts/confirm";
import { managedDir } from "../accounts/profile-list";
import { lookupProfileRef, profileLine } from "../accounts/resolve";
import { UsageError } from "../config";
import { repositoryKey } from "../history/store";
import { claimManagedProfile, setupProfile } from "../profiles";
import { isInteractive, type TerminalStreams } from "../wizard/interactive";
import { loadTerminalUi } from "../wizard/load";
import type { Outcome, Prompter, PromptIO } from "../wizard/prompt";
import { resolveSetupOptions, type RawSetupFlags } from "./options";
import { promptForSetup, setupStepTotal, type PendingProfile } from "./prompt";

export interface SetupDeps extends AccountDeps {
  /** The person already chose local setup in init. */
  fromInit?: boolean;
  /** Both mode has one extra workflow stage before account setup. */
  initMode?: "local" | "both";
  /** Filled when the run ends with the work saved and one step left: the session then closes with this warning, not "Stopped.". */
  closing?: { warning?: string };
  /** The commands that bind later; printed when a run started from init ends without saving a binding. */
  unboundHints?: readonly string[];
  streams?: TerminalStreams;
  promptIO?: PromptIO;
  /** The asynchronous probe of the account, for a test; the default runs `claude` without blocking the terminal. */
  spawnAsync?: AsyncSpawnFn;
  /** An open prompt session (shared with `init`); the caller closes it. */
  prompter?: Prompter;
}

const ALIAS_NOTE =
  "If your `claude` is a shell alias or function that sets CLAUDE_CONFIG_DIR, Wachiman does not see it: register that directory with `wachiman profile add <name> --config-dir <dir>` and run `wachiman init` again.";

const defaultInteractiveSpawn: InteractiveSpawn = (binary, args, opts) => spawnSync(binary, args, opts);

export async function runSetupCommand(flags: RawSetupFlags, env: Record<string, string | undefined>, io: CommandIo, deps: SetupDeps = {}): Promise<number> {
  const interactive = !flags.yes && (deps.interactive ?? isInteractive(flags, env, deps.streams ?? { stdin: process.stdin, stdout: process.stdout }));
  if (!interactive) {
    const resolved = resolveSetupOptions(flags, { interactive: false });
    if (!resolved.ok) throw new UsageError(resolved.error);
    const { options } = resolved;
    return runSetup({ repoDir: options.repoDir, profile: options.profile, yes: flags.yes === true, json: options.json }, env, io, { ...deps, interactive: false });
  }

  const repoDir = flags.repoDir ?? ".";
  const home = wachimanHome(env);
  const userHome = deps.userHome ?? homedir();
  const now = deps.now ?? (() => new Date().toISOString());
  const config = loadConfig(home);
  const repo = repositoryKey(repoDir, deps.git);
  const current = config && Object.hasOwn(config.projects, repo.key) ? config.projects[repo.key] : undefined;
  const lookup = (profiles: WachimanConfigV1["profiles"], name: string) =>
    lookupProfileRef(name, { profiles, home, managedDirExists: (n) => existsSync(managedDir(home, n)) });
  if (flags.profile !== undefined) {
    const found = lookup(config?.profiles ?? {}, flags.profile);
    if (!found.ok) throw new UsageError(found.problem);
  }

  // The terminal UI (chalk and Clack) is loaded only when questions are asked.
  const ui = await loadTerminalUi();
  const prompter = deps.prompter ?? (await ui.openPrompter(deps.promptIO ?? { input: process.stdin, output: process.stderr }, env));
  const ownsPrompter = deps.prompter === undefined;
  io = ui.wizardIo(io, (deps.promptIO?.output ?? process.stderr) as { isTTY?: boolean }, env, prompter);
  /** What already happened on disk or in Claude and cannot be rolled back; reported whenever the run ends early. */
  const effects: string[] = [];
  const reportEffects = () => {
    if (effects.length === 0) return;
    io.stderr("These already happened and were not undone:");
    for (const effect of effects) io.stderr(`  - ${effect}`);
  };

  const createManaged = (name: string) => {
    // The sign-in is a child that needs the terminal for itself.
    prompter.suspend();
    const dir = managedDir(home, name);
    const existed = existsSync(dir);
    let started = false;
    const spawn = deps.interactiveSpawn ?? defaultInteractiveSpawn;
    try {
      setupProfile({
        name,
        home,
        env,
        print: io.stderr,
        register: false,
        spawn: (binary, args, opts) => {
          started = true;
          return spawn(binary, args, opts);
        },
      });
    } finally {
      if (!existed && existsSync(dir)) effects.push(`created the managed directory ${dir}`);
      if (started) effects.push(`opened Claude for the sign-in in ${dir}; Wachiman does not read the outcome and cannot undo it`);
    }
  };

  let outcome: Outcome = "failed";
  let closing: string | undefined;
  try {
    // Only the command that opened the session plays the intro; `init` already did when it hands over,
    // and so did the launcher (it marks WACHIMAN_INTRO_DONE, which `prompter.intro` honors).
    if (ownsPrompter) await prompter.intro(deps.doctor?.version ?? "unknown", "Let's choose which Claude account stands guard.");
    let answers;
    try {
      answers = await promptForSetup(flags, { repo, current, config, home, userHome, createManaged, fromInit: deps.fromInit, initMode: deps.initMode }, prompter);
    } catch (error) {
      // A failed sign-in step still leaves the managed directory behind; say so before the error surfaces.
      reportEffects();
      throw error;
    }
    if (answers.kind === "cancelled") {
      // Unreachable with effects: the only step that touches disk or Claude (the managed sign-in) is the last prompt.
      io.stderr("cancelled: no configuration changes saved.");
      for (const hint of deps.unboundHints ?? []) io.stderr(`Next, on this machine: ${hint}   (binds this repository to a Claude account)`);
      outcome = "cancelled";
      return 130;
    }
    if (answers.kind === "declined") {
      io.stderr("nothing saved: the configuration is unchanged.");
      for (const hint of deps.unboundHints ?? []) io.stderr(`Next, on this machine: ${hint}   (binds this repository to a Claude account)`);
      outcome = "done";
      closing = "Nothing was saved.";
      return 0;
    }
    const resolved = resolveSetupOptions(answers.flags, { interactive: true });
    if (!resolved.ok) throw new UsageError(resolved.error);
    const { profile: name } = resolved.options;

    try {
      save({ home, name, repo, repoDir, pending: answers.pending, userHome, now, lookup });
    } catch (error) {
      // Nothing was saved, but what was confirmed earlier still happened.
      reportEffects();
      throw error;
    }
    io.stderr(`bound: ${repo.name} → ${name} (home config${answers.pending ? `, with the new profile ${answers.pending.name}` : ""}; nothing written in the repository)`);

    const after = loadConfig(home);
    const found = lookup(after?.profiles ?? {}, name);
    if (!found.ok) throw new UsageError(found.problem);
    const resolvedProfile = { profile: found.profile, rung: "binding" as const, overridden: [] };
    io.stderr(profileLine(resolvedProfile));
    // The real probe is asynchronous, so the spinner turns while `claude` runs; a test's fake `spawn` is synchronous and is called as it always was.
    const probe = () =>
      deps.spawn ? confirmProfile(resolvedProfile, env, deps.spawn, deps.doctor?.confirmIo) : confirmProfileAsync(resolvedProfile, env, deps.spawnAsync, deps.doctor?.confirmIo);
    // An Enter typed meanwhile must not reach "Sign in now?" through a live readline.
    prompter.suspend();
    let status = await prompter.task("Checking your Claude account", probe, (s) => s.ok);
    const signedOut = !status.ok && status.stage === "auth" && status.auth !== undefined && status.auth.exitCode !== 0;
    // True once the user was told the account state in its own words, so the generic warning would repeat it.
    let explained = false;
    // Whether the sign-in is still the failure after the offer (accepted or not).
    let signInPending = !status.ok && status.stage === "auth";
    const signInCommand = found.profile.kind === "default" ? "claude auth login" : `wachiman profile login ${name}`;
    // Only a Wachiman-managed or registered profile can be signed in from here (`wachiman profile login`); the default one is the person's own claude.
    if (signedOut && found.profile.kind !== "default") {
      io.stderr(status.problem);
      const answer = await prompter.confirm("Sign in now?", true);
      if (answer === null) {
        io.stderr(`cancelled: the binding of ${repo.name} to ${name} was saved and stays; you are not signed in (run \`wachiman profile login ${name}\`).`);
        outcome = "cancelled";
        return 130;
      }
      if (answer) {
        prompter.suspend();
        const code = runProfile({ kind: "login", profile: name }, env, io, { ...deps, interactive: true, interactiveSpawn: deps.interactiveSpawn });
        if (code === 130) {
          io.stderr(`cancelled: the binding of ${repo.name} to ${name} was saved and stays.`);
          outcome = "cancelled";
          return 130;
        }
        status = await prompter.task("Checking your Claude account", probe, (s) => s.ok);
        signInPending = !status.ok && status.stage === "auth";
      } else {
        io.stderr(`not signed in: run \`${signInCommand}\` before \`wachiman local\`.`);
        explained = true;
      }
    }
    if (status.ok) io.stderr(`account: signed in (${status.auth.authMethod}; claude ${status.binary.version})`);
    else if (!explained) io.stderr(`warning: ${status.problem} Fix: ${status.fix}`);

    const total = setupStepTotal(deps.fromInit, deps.initMode);
    prompter.step("Checks and next actions", total, total);
    const result: { failedRequired?: number } = {};
    const code = closeSetup(repoDir, env, io, deps, result);
    if (flags.json) io.stdout(`${JSON.stringify(projectShow(repoDir, env, deps), null, 2)}\n`);
    outcome = code === 0 ? "done" : code === 130 ? "cancelled" : "failed";
    // Everything is saved; the sign-in is what is left. That is a warning to act on, not a stop. The exit code stays as the
    // doctor decided (1: a required check failed), because scripts read it as "this machine is not ready".
    if (code !== 0 && code !== 130 && signInPending) {
      const only = result.failedRequired === 1;
      const warning = only
        ? `Saved. One step left: sign in to Claude (\`${signInCommand}\`), then run \`wachiman init\` again or \`wachiman doctor\`.`
        : `Saved. Some checks still need attention, including the Claude sign-in (\`${signInCommand}\`); then run \`wachiman init\` again or \`wachiman doctor\`.`;
      // Wachiman starts the binary itself, so it never sees a shell alias or function that sets the configuration directory.
      const text = found.profile.kind === "default" ? `${warning} ${ALIAS_NOTE}` : warning;
      if (deps.closing) deps.closing.warning = text;
      else closing = text;
      outcome = "done";
    }
    return code;
  } finally {
    if (ownsPrompter) prompter.close(outcome, closing);
  }
}

/** One locked transaction: the proposed profile and the binding together, revalidated against whatever changed since they were read. */
function save(p: {
  home: string;
  name: string;
  repo: ReturnType<typeof repositoryKey>;
  repoDir: string;
  pending?: PendingProfile;
  userHome: string;
  now: () => string;
  lookup: (profiles: WachimanConfigV1["profiles"], name: string) => ReturnType<typeof lookupProfileRef>;
}) {
  const binding: ProjectBinding = {
    profile: p.name,
    keyedBy: p.repo.keyedBy,
    ...(p.repo.keyedBy === "remote" && p.repo.remote ? { remote: p.repo.remote } : {}),
    name: p.repo.name,
    boundAt: p.now(),
    boundFrom: p.repoDir,
  };
  updateConfig({ home: p.home }, (latest) => {
    let profiles = latest.profiles;
    const { pending } = p;
    if (pending?.kind === "external") {
      checkNewProfileName(pending.name, p.home);
      if (Object.hasOwn(profiles, pending.name)) throw new UsageError(`"${pending.name}" was registered meanwhile; run \`wachiman setup\` again.`);
      const configDir = checkExternalConfigDir(pending.configDir, p.home, p.userHome, "Configuration directory");
      if (pending.binary !== undefined) {
        const problem = binaryProblem(pending.binary);
        if (problem) throw new UsageError(`${pending.binary} ${problem}.`);
      }
      const entry: ProfileEntry = { kind: "external", configDir, ...(pending.binary ? { binary: pending.binary } : {}), createdAt: p.now() };
      profiles = { ...profiles, [pending.name]: entry };
    } else if (pending?.kind === "managed") {
      if (!existsSync(pending.configDir)) throw new UsageError(`${pending.configDir} no longer exists; run \`wachiman setup\` again.`);
      profiles = claimManagedProfile(latest, pending.name, pending.configDir).profiles;
    }
    // The profile may have been removed since it was read.
    const found = p.lookup(profiles, p.name);
    if (!found.ok) throw new UsageError(found.problem);
    return { ...latest, profiles, projects: { ...latest.projects, [p.repo.key]: binding } };
  });
}
