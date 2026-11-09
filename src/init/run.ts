/**
 * `wachiman init` (command contract section 5.5): parse, prompt, resolve, then the one impure
 * half. It writes only the chosen workflow file and its `.bak` copy, after the person has seen
 * what will be written (or named `--yes` or no terminal with every mandatory flag). It never
 * commits, pushes, opens a pull request or creates a secret, and it makes no network request.
 */
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { CommandIo } from "../accounts/commands";
import { UsageError } from "../config";
import type { GitRunner } from "../evidence";
import { repositoryKey } from "../history/store";
import { isInteractive, type TerminalStreams } from "../wizard/interactive";
import { createPrompter, type Prompter, type PromptIO } from "../wizard/prompt";
import { DEFAULT_WORKFLOW_REF, resolveInitOptions, type InitOptions, type RawInitFlags } from "./options";
import { promptForInit } from "./prompt";
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
  bindNow?: (prompter: Prompter) => Promise<number>;
  /** The directory a relative `--repo-dir` was resolved against, for the `setup` line. Default: `process.cwd()`. */
  cwd?: string;
  hooks?: WriteHooks;
}

const TEMPLATE = join(import.meta.dir, "..", "..", "templates", "wachiman-review-caller.yml");
const readDefaultTemplate = () => readFileSync(TEMPLATE, "utf8");

/** The line that hands over to `setup`. */
export function setupLine(repoDir: string, cwd: string) {
  return repoDir === cwd ? "wachiman setup" : `wachiman setup --repo-dir ${repoDir}`;
}

const openSession = (deps: InitDeps) => {
  if (deps.prompter) return { prompter: deps.prompter, close: () => {} };
  const prompter = createPrompter(deps.promptIO ?? { input: process.stdin, output: process.stderr });
  return { prompter, close: () => prompter.close() };
};

/** From the parsed flags: asks what is missing when a person can be asked, resolves, and runs. */
export async function runInitCommand(flags: RawInitFlags, env: Record<string, string | undefined>, io: CommandIo, deps: InitDeps = {}): Promise<number> {
  const interactive = deps.interactive ?? isInteractive(flags, env, deps.streams ?? { stdin: process.stdin, stdout: process.stdout });
  const defaultWorkflowRef = "defaultWorkflowRef" in deps ? deps.defaultWorkflowRef : DEFAULT_WORKFLOW_REF;
  const session = interactive ? openSession(deps) : undefined;
  try {
    let answered = flags;
    if (session) {
      const asked = await promptForInit(flags, { defaultWorkflowRef }, session.prompter);
      if (asked === null) {
        io.stderr("cancelled: nothing was written.");
        return 130;
      }
      answered = asked;
    }
    const resolved = resolveInitOptions(answered, { interactive, defaultWorkflowRef });
    if (!resolved.ok) throw new UsageError(resolved.error);
    return await runInit(resolved.options, io, { ...deps, prompter: session?.prompter });
  } finally {
    session?.close();
  }
}

/** The only impure half: writes under confirm. */
export async function runInit(options: InitOptions, io: CommandIo, deps: InitDeps = {}): Promise<number> {
  const cwd = deps.cwd ?? process.cwd();
  // Before anything is rendered or written: this must be a git repository.
  repositoryKey(options.repoDir, deps.git);
  const { github } = options;
  const prompter = options.interactive ? deps.prompter : undefined;
  let written: string | undefined;

  if (github) {
    const now = (deps.now ?? (() => new Date().toISOString()))();
    const rendered = renderCallerWorkflow((deps.readTemplate ?? readDefaultTemplate)(), {
      operator: github.operator,
      tag: github.tag,
      header: callerHeader({ version: deps.version ?? "unknown", now }),
    });
    const inspected = inspectTarget(options.repoDir, github.path);
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
      io.stderr(`--- ${shown} (${inspected.exists ? "would overwrite" : "new"})`);
      io.stderr(rendered.replace(/\n$/, ""));
      const answer = await prompter.confirm("Write it?", true);
      if (answer === null) {
        io.stderr("cancelled: nothing was written.");
        return 130;
      }
      if (!answer) {
        io.stderr("not written.");
        return 0;
      }
    } else {
      io.stderr(`writing ${shown} (${inspected.exists ? "replacing the existing file; a .bak copy is kept" : "new"}).`);
    }
    const result = writeWorkflow({ repoDir: options.repoDir, relativePath: github.path, content: rendered, inspected, now, hooks: deps.hooks });
    written = shown;
    io.stderr(`wrote ${shown}${result.backup ? `; the earlier file is kept as ${join(dirname(github.path), basename(result.backup))}` : ""}.`);
    io.stderr("Two things are left to do in GitHub:");
    io.stderr("  1. Add the repository secret ANTHROPIC_API_KEY (a Console key; Actions runs are billed to it): Settings, Secrets and variables, Actions.");
    io.stderr(`  2. Open a pull request that adds ${shown}. init does not commit, push or open one.`);
    io.stderr("Local runs use your signed-in claude, never this key.");
  }

  if (options.mode === "github") return 0;
  if (prompter && deps.bindNow) {
    const answer = await prompter.confirm("Run wachiman setup now to bind this repository to a Claude account?", true);
    if (answer === null) {
      io.stderr(written ? `cancelled: ${written} was written and stays; nothing else was changed.` : "cancelled: nothing was written.");
      return 130;
    }
    if (answer) {
      const code = await deps.bindNow(prompter);
      if (code === 130 && written) io.stderr(`${written} was written before setup was cancelled and stays in place.`);
      return code;
    }
  }
  io.stderr(`Next, on this machine: ${setupLine(options.repoDir, cwd)}   (binds this repository to a Claude account)`);
  return 0;
}
