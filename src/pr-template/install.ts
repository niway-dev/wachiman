/**
 * `wachiman pr-template show | install | status` (ADR 0050, ADR 0052). The installed
 * `.github/pull_request_template.md` is generated from the catalog and the repository's
 * `.github/pr-template.json`; this file reads both, decides what to write, adopts an unmanaged
 * template, keeps backups where something hand-made would be replaced, and, when asked, makes one
 * commit of the files it wrote.
 *
 * Refusals and invalid configuration throw (`UsageError`, exit 2); the functions return the exit
 * code otherwise. Progress and notes go to `io.stderr`; `show` prints the template, `status` its
 * answer and `install --commit` the commit hash to `io.stdout`.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { UsageError } from "../config";
import { parseFlags } from "../flags";
import { analyzeUnmanaged, mergeAdoption } from "./adopt";
import { CHOICE_FILE, PrTemplateConfigError, loadCatalog, loadRepoChoice, type Catalog } from "./catalog";
import { parseStamp, renderTemplate, templateState } from "./render";
import { resolveTemplate } from "./resolve";
import { inspectManagedTarget, writeManagedFile, type TargetState, type WriteHooks } from "./write";

export const TEMPLATE_FILE = ".github/pull_request_template.md";
const LABEL = "pr-template";

export interface Io {
  stdout(text: string): void;
  stderr(line: string): void;
}

export interface GitResult {
  status: number;
  stdout: string;
  stderr: string;
}
/** Runs git with an argument list (never a shell string) in `cwd`. */
export type GitRunner = (args: string[], cwd: string) => GitResult;

export interface Deps {
  /** An ISO timestamp; names the backups. */
  now?: () => string;
  git?: GitRunner;
  /** Where a relative `--from` path is resolved from; default `process.cwd()`. */
  cwd?: string;
  catalog?: Catalog;
  hooks?: WriteHooks;
}

const defaultGit: GitRunner = (args, cwd) => {
  const run = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { status: run.status ?? 1, stdout: run.stdout ?? "", stderr: run.error ? String(run.error.message) : (run.stderr ?? "") };
};

// ------------------------------------------------------------------ arguments

export interface Help {
  help: true;
}
export interface ShowOptions {
  help?: undefined;
  from?: string;
}
export interface InstallOptions {
  help?: undefined;
  from?: string;
  force: boolean;
  commit: boolean;
}
export interface StatusOptions {
  help?: undefined;
  json: boolean;
}

export const showUsage = "wachiman pr-template show [--from <json>]";
export const installUsage = "wachiman pr-template install [--from <json>] [--force] [--commit]";
export const statusUsage = "wachiman pr-template status [--json]";

const wantsHelp = (argv: string[]) => argv.includes("--help") || argv.includes("-h");

function parse(argv: string[], command: string, spec: { values: string[]; booleans: string[] }) {
  const parsed = parseFlags(argv, spec, `pr-template ${command}`);
  if (parsed.positionals.length > 0) throw new UsageError(`pr-template ${command} takes no argument "${parsed.positionals[0]}".`);
  return parsed;
}

/** The arguments after `pr-template show`. Pure; a bad flag is a usage error. */
export function parseShowArgs(argv: string[]): ShowOptions | Help {
  if (wantsHelp(argv)) return { help: true };
  const { values } = parse(argv, "show", { values: ["--from"], booleans: [] });
  return values["--from"] !== undefined ? { from: values["--from"] } : {};
}

/** The arguments after `pr-template install`. */
export function parseInstallArgs(argv: string[]): InstallOptions | Help {
  if (wantsHelp(argv)) return { help: true };
  const { values, booleans } = parse(argv, "install", { values: ["--from"], booleans: ["--force", "--commit"] });
  return { ...(values["--from"] !== undefined ? { from: values["--from"] } : {}), force: booleans["--force"] === true, commit: booleans["--commit"] === true };
}

/** The arguments after `pr-template status`. */
export function parseStatusArgs(argv: string[]): StatusOptions | Help {
  if (wantsHelp(argv)) return { help: true };
  const { booleans } = parse(argv, "status", { values: [], booleans: ["--json"] });
  return { json: booleans["--json"] === true };
}

// ------------------------------------------------------------------ reading

interface Managed {
  inspected: TargetState;
  text: string | null;
}

/** The file at `relativePath` (null when absent), looked at without following a link. */
function readManaged(repoDir: string, relativePath: string): Managed {
  const inspected = inspectManagedTarget(repoDir, relativePath, LABEL);
  return { inspected, text: inspected.exists ? readFileSync(inspected.target, "utf8") : null };
}

function readFrom(path: string, deps: Deps): string {
  const file = resolve(deps.cwd ?? process.cwd(), path);
  try {
    return readFileSync(file, "utf8");
  } catch (err) {
    throw new UsageError(`--from ${path} cannot be read: ${(err as Error).message}`);
  }
}

/** Two JSON texts that say the same thing, whatever their spacing. */
function sameJson(a: string, b: string): boolean {
  try {
    return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
  } catch {
    return false;
  }
}

const nowIso = (deps: Deps) => (deps.now ?? (() => new Date().toISOString()))();
const lf = (text: string) => text.replace(/\r\n/g, "\n");

function generate(catalog: Catalog, choiceText: string | null): string {
  const choice = choiceText === null ? null : loadRepoChoice(choiceText, catalog);
  return renderTemplate(resolveTemplate(catalog, choice), catalog.version);
}

// ------------------------------------------------------------------ show

export function runShow(opts: ShowOptions, repoDir: string, io: Io, deps: Deps = {}): number {
  const catalog = deps.catalog ?? loadCatalog();
  const choiceText = opts.from !== undefined ? readFrom(opts.from, deps) : readManaged(repoDir, CHOICE_FILE).text;
  io.stdout(generate(catalog, choiceText));
  return 0;
}

// ------------------------------------------------------------------ status

const HUMAN: Record<string, string> = { "edited-by-hand": "edited by hand" };

export function runStatus(opts: StatusOptions, repoDir: string, io: Io, deps: Deps = {}): number {
  const catalog = deps.catalog ?? loadCatalog();
  const choiceText = readManaged(repoDir, CHOICE_FILE).text;
  const state = templateState({ catalog, fileText: readManaged(repoDir, TEMPLATE_FILE).text, choiceText });
  if (opts.json) {
    io.stdout(`${JSON.stringify({ state: state.state, version: state.version, installedVersion: state.installedVersion })}\n`);
    if (state.problem !== undefined) io.stderr(state.problem);
    return state.state === "current" ? 0 : 1;
  }
  const name = HUMAN[state.state] ?? state.state;
  const installed = state.installedVersion === null ? "" : ` (installed version ${state.installedVersion}, this Wachiman generates version ${state.version})`;
  const lines: Record<string, string> = {
    missing: `missing: ${TEMPLATE_FILE} does not exist.\nNext: run \`wachiman pr-template install\`.`,
    current: `current: ${TEMPLATE_FILE} matches what ${CHOICE_FILE} and version ${state.version} generate.\nNothing to do.`,
    outdated: `outdated: ${TEMPLATE_FILE} is not what this Wachiman generates${installed}.\nNext: run \`wachiman pr-template install\`; it rewrites the file and keeps no backup, because the file is regenerable.`,
    "edited-by-hand": `edited by hand: ${TEMPLATE_FILE} no longer matches its stamp${installed}.\nNext: move the change into ${CHOICE_FILE} (a "preamble" line or a custom section), then run \`wachiman pr-template install --force\`; the edited file is kept as a backup.`,
    unmanaged: choiceText === null
      ? `unmanaged: ${TEMPLATE_FILE} has no Wachiman stamp.\nNext: run \`wachiman pr-template install\`; it adopts the file, keeps a backup and prints what moved.`
      : `unmanaged: ${TEMPLATE_FILE} has no Wachiman stamp.\nNext: run \`wachiman pr-template install --force\`; plain install refuses because ${CHOICE_FILE} already exists. With --force both files get a backup and what the old file adds is merged into ${CHOICE_FILE}.`,
    invalid: `invalid: ${state.problem ?? `${CHOICE_FILE} is not a valid definition`}\nNext: fix ${CHOICE_FILE}, or remove it to use the default template. Nothing falls back on its own.`,
  };
  io.stdout(`${lines[state.state] ?? name}\n`);
  return state.state === "current" ? 0 : 1;
}

// ------------------------------------------------------------------ install

/**
 * Where backups go: `<git common dir>/wachiman/backups`, which is never tracked, is not in the working
 * tree for a formatter or linter to scan, and survives the removal of a linked worktree. Without a git
 * directory they stay next to the file.
 */
function backupDirOf(repoDir: string, git: GitRunner): string | undefined {
  const run = git(["rev-parse", "--git-common-dir"], repoDir);
  const out = run.stdout.trim();
  if (run.status !== 0 || out === "") return undefined;
  return join(resolve(repoDir, out), "wachiman", "backups");
}

export function runInstall(opts: InstallOptions, repoDir: string, io: Io, deps: Deps = {}): number {
  const catalog = deps.catalog ?? loadCatalog();
  const now = nowIso(deps);
  const template = readManaged(repoDir, TEMPLATE_FILE);
  const json = readManaged(repoDir, CHOICE_FILE);

  const fromText = opts.from !== undefined ? readFrom(opts.from, deps) : null;
  if (fromText !== null) {
    loadRepoChoice(fromText, catalog);
    if (json.text !== null && !sameJson(json.text, fromText) && !opts.force) {
      throw new UsageError(`${CHOICE_FILE} already exists and differs from ${opts.from}. Re-run with --force to replace it (a backup is kept), or edit it by hand.`);
    }
  }
  let choiceText = fromText ?? json.text;

  const state = templateState({ catalog, fileText: template.text, choiceText });
  if (state.state === "invalid") throw new PrTemplateConfigError(state.problem ?? `${CHOICE_FILE} is not valid.`);

  let backupTemplate = false;
  const writeTemplate = state.state !== "current";
  const notes: string[] = [];

  if (state.state === "edited-by-hand") {
    if (!opts.force) {
      throw new UsageError(`${TEMPLATE_FILE} was edited by hand, so it is not replaced. Move the change into ${CHOICE_FILE}, or re-run with --force (a backup is kept).`);
    }
    backupTemplate = true;
  } else if (state.state === "unmanaged") {
    if (json.text !== null && !opts.force) {
      throw new UsageError(
        `${TEMPLATE_FILE} is not managed by Wachiman and ${CHOICE_FILE} already exists. Re-run with --force: both files get a backup and what the old file adds is merged into the JSON.`,
      );
    }
    const baseChoice = choiceText === null ? null : loadRepoChoice(choiceText, catalog);
    const adoption = analyzeUnmanaged(template.text!, { catalog, existingCustom: baseChoice?.custom ?? [], existingDrop: baseChoice?.drop ?? [] });
    const merged = mergeAdoption(choiceText === null ? null : (JSON.parse(choiceText) as Record<string, unknown>), adoption);
    const contributes = adoption.custom.length > 0 || adoption.preamble.length > 0 || adoption.add.length > 0;
    if (choiceText !== null || contributes) choiceText = `${JSON.stringify(merged, null, 2)}\n`;
    notes.push(`adopting the unmanaged ${TEMPLATE_FILE}; the old file is kept as a backup (the path is printed when it is written).`, ...adoption.report.map((l) => `  ${l}`));
    backupTemplate = true;
  }

  // Everything that can be decided without writing is computed here. A later write can still fail after the
  // JSON was written; each error names what was and was not replaced.
  const content = generate(catalog, choiceText);
  const writeJson = choiceText !== null && (json.text === null || !sameJson(json.text, choiceText));

  for (const note of notes) io.stderr(note);
  const written: string[] = [];
  const backupDir = backupDirOf(repoDir, deps.git ?? defaultGit);
  const report = (relativePath: string, result: { target: string; backup?: string }) => {
    written.push(result.target);
    io.stderr(`wrote ${relativePath}${result.backup ? `; the earlier file is kept as ${result.backup}` : ""}.`);
  };
  if (writeJson && choiceText !== null) {
    report(CHOICE_FILE, writeManagedFile({ repoDir, relativePath: CHOICE_FILE, content: choiceText, inspected: json.inspected, now, label: LABEL, backup: json.text !== null, backupDir, hooks: deps.hooks }));
  }
  if (writeTemplate) {
    report(TEMPLATE_FILE, writeManagedFile({ repoDir, relativePath: TEMPLATE_FILE, content, inspected: template.inspected, now, label: LABEL, backup: backupTemplate, backupDir, hooks: deps.hooks }));
  } else {
    io.stderr(`${TEMPLATE_FILE} is already current; nothing to do.`);
  }

  if (!opts.commit) return 0;
  if (written.length === 0) {
    io.stderr("nothing was written, so there is nothing to commit.");
    return 0;
  }
  const hadStamp = template.text !== null && parseStamp(lf(template.text)) !== null;
  const message = hadStamp ? `docs: update the PR description template to version ${catalog.version}` : "docs: install the Wachiman PR description template";
  return commitFiles(written, message, repoDir, io, deps.git ?? defaultGit);
}

/** One commit of exactly these paths: a pathspec commit leaves anything else that is staged out. Hooks run; nothing is pushed. */
function commitFiles(paths: string[], message: string, repoDir: string, io: Io, git: GitRunner): number {
  const fail = (what: string, r: GitResult) => {
    io.stderr(`${what} failed (exit ${r.status}): ${(r.stderr || r.stdout).trim()}`);
    io.stderr("The files stay written; commit them yourself, or fix the problem and run the command again.");
    return 1;
  };
  const add = git(["add", "--", ...paths], repoDir);
  if (add.status !== 0) return fail("git add", add);
  const commit = git(["commit", "-m", message, "--", ...paths], repoDir);
  if (commit.status !== 0) return fail("git commit", commit);
  const head = git(["rev-parse", "HEAD"], repoDir);
  if (head.status !== 0) return fail("git rev-parse HEAD", head);
  const hash = head.stdout.trim();
  io.stderr(`committed ${paths.length} file${paths.length === 1 ? "" : "s"}: ${message}`);
  io.stdout(`${hash}\n`);
  return 0;
}
