/**
 * The command layer of `wachiman pr-template check`, `strip` and `risk`: argument parsing and the
 * runners that read files and call git and gh. The rules live in check.ts, strip.ts and pr-risk.ts.
 *
 * Exit codes: 0 passes, 1 findings, 2 a configuration, usage or tool problem. `check` reads
 * `.github/pr-template.json` (from the working tree for a file, from the PR's head commit for
 * `--pr`); `strip` and `risk` never read it (ADR 0051).
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { UsageError } from "../config";
import { parseFlags } from "../flags";
import { CHOICE_FILE, loadCatalog, loadRepoChoice, type Catalog } from "./catalog";
import { checkDescription, type CheckResult, type Finding } from "./check";
import {
  changesFromGit, commitMessagesFromGit, defaultRunner, ghFileAt, ghPrDiff, ghPrView, gitFileAt, gitHead, ToolError, type CommandRunner,
} from "./gh";
import { computeRisk, formatRisk, parseRiskExtension, RISK_EXTENSION_FILE, type ChangedFile, type RiskExtension } from "./pr-risk";
import { resolveTemplate, type ResolvedTemplate } from "./resolve";
import { stripDescription } from "./strip";

export const DEFAULT_BASE = "origin/main";

export const checkUsage =
  "wachiman pr-template check [<file>] [--pr <n>] [--repo <owner/name>] [--title <t>] [--head <sha>] [--base <ref>] [--allow-breaking]";
export const stripUsage = "wachiman pr-template strip <file>";
export const riskUsage = "wachiman pr-template risk [--base <ref>]";

export interface CheckOptions {
  /** A description on disk (the title is then required). */
  file?: string;
  /** A pull request number (title, body, head, commits and files then come from gh). */
  pr?: number;
  repo?: string;
  title?: string;
  head?: string;
  base: string;
  allowBreaking: boolean;
}
export interface StripOptions { file: string }
export interface RiskOptions { base: string }

export interface PrTemplateIo {
  stdout: (text: string) => void;
  stderr: (line: string) => void;
}

export interface PrTemplateDeps {
  /** Runs git and gh. Default: the real tools. */
  run?: CommandRunner;
  /** The catalog. Default: the shipped one. */
  catalog?: Catalog;
  /** Where a relative `<file>` argument resolves: the directory the command was given. Default: the repository directory. */
  fileBase?: string;
}

const helpRequested = (argv: string[]) => argv.includes("--help") || argv.includes("-h");

/** `argv` is what follows `check`. */
export function parseCheckArgs(argv: string[]): CheckOptions | { help: true } {
  if (helpRequested(argv)) return { help: true };
  const { positionals, values, booleans } = parseFlags(
    argv,
    { values: ["--pr", "--repo", "--title", "--head", "--base"], booleans: ["--allow-breaking"] },
    "pr-template check",
  );
  if (positionals.length > 1) throw new UsageError(`check takes one file, got "${positionals.join('", "')}".`);
  const file = positionals[0];
  const prText = values["--pr"];
  if ((file === undefined) === (prText === undefined)) throw new UsageError("check needs either a file or --pr <number>.");
  let pr: number | undefined;
  if (prText !== undefined) {
    if (!/^[1-9][0-9]*$/.test(prText)) throw new UsageError(`--pr must be a pull request number, got "${prText}".`);
    pr = Number(prText);
    for (const flag of ["--title", "--head", "--base"]) {
      if (values[flag] !== undefined) throw new UsageError(`${flag} goes with a file; with --pr the title, head and base come from the pull request.`);
    }
  } else {
    if (values["--repo"] !== undefined) throw new UsageError("--repo goes with --pr.");
    if (values["--title"] === undefined) throw new UsageError("check <file> needs --title.");
  }
  return {
    ...(file !== undefined ? { file } : {}),
    ...(pr !== undefined ? { pr } : {}),
    ...(values["--repo"] !== undefined ? { repo: values["--repo"] } : {}),
    ...(values["--title"] !== undefined ? { title: values["--title"] } : {}),
    ...(values["--head"] !== undefined ? { head: values["--head"] } : {}),
    base: values["--base"] ?? DEFAULT_BASE,
    allowBreaking: booleans["--allow-breaking"] === true,
  };
}

/** `argv` is what follows `strip`. */
export function parseStripArgs(argv: string[]): StripOptions | { help: true } {
  if (helpRequested(argv)) return { help: true };
  const { positionals } = parseFlags(argv, { values: [], booleans: [] }, "pr-template strip");
  if (positionals.length !== 1) throw new UsageError("strip needs one file.");
  return { file: positionals[0]! };
}

/** `argv` is what follows `risk`. */
export function parseRiskArgs(argv: string[]): RiskOptions | { help: true } {
  if (helpRequested(argv)) return { help: true };
  const { positionals, values } = parseFlags(argv, { values: ["--base"], booleans: [] }, "pr-template risk");
  if (positionals.length > 0) throw new UsageError(`risk takes no argument "${positionals[0]}".`);
  return { base: values["--base"] ?? DEFAULT_BASE };
}

// --------------------------------------------------------------------------- helpers

const PREFIX = "wachiman pr-template";

function templateFor(catalog: Catalog, choiceText: string | null): ResolvedTemplate {
  return resolveTemplate(catalog, choiceText === null ? null : loadRepoChoice(choiceText, catalog));
}

/** A file in the working tree, or null when it is not there. */
function readIfPresent(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new ToolError(`cannot read ${path}: ${(err as Error).message}`);
  }
}

function report(result: CheckResult, io: PrTemplateIo): number {
  for (const f of result.findings) io.stderr(`${PREFIX}: ${f.code}: ${f.message}`);
  if (!result.ok) return 1;
  io.stdout("ok\n");
  return 0;
}

const keyOf = (f: Finding) => `${f.code}: ${f.message}`;

/** What the other template would say differently, as lines for the output. */
function compareLines(source: string, here: Finding[], base: Finding[]): string[] {
  const hereKeys = new Set(here.map(keyOf));
  const baseKeys = new Set(base.map(keyOf));
  const onlyBase = base.filter((f) => !hereKeys.has(keyOf(f)));
  const onlyHere = here.filter((f) => !baseKeys.has(keyOf(f)));
  if (onlyBase.length === 0 && onlyHere.length === 0) return [`the template on the base branch (${source}) would report the same.`];
  return [
    `the template on the base branch (${source}) would report differently:`,
    ...onlyBase.map((f) => `  only the base template reports: ${keyOf(f)}`),
    ...onlyHere.map((f) => `  only this pull request's template reports: ${keyOf(f)}`),
  ];
}

function extensionFrom(text: string | null, warn: (line: string) => void): RiskExtension | null {
  return text === null ? null : parseRiskExtension(text, warn);
}

// --------------------------------------------------------------------------- check

export function runCheck(opts: CheckOptions, repoDir: string, io: PrTemplateIo, deps: PrTemplateDeps = {}): number {
  try {
    return opts.pr !== undefined ? checkPr(opts.pr, opts, io, deps) : checkFile(opts, repoDir, io, deps);
  } catch (err) {
    if (err instanceof UsageError || err instanceof ToolError) {
      io.stderr(`${PREFIX}: error: ${err.message}`);
      return 2;
    }
    throw err;
  }
}

function checkFile(opts: CheckOptions, repoDir: string, io: PrTemplateIo, deps: PrTemplateDeps): number {
  const run = deps.run ?? defaultRunner;
  const catalog = deps.catalog ?? loadCatalog();
  const warn = (line: string) => io.stderr(`${PREFIX}: warning: ${line}`);

  const file = resolve(deps.fileBase ?? repoDir, opts.file!);
  let body: string;
  try {
    body = readFileSync(file, "utf8");
  } catch (err) {
    throw new ToolError(`cannot read ${opts.file}: ${(err as Error).message}`);
  }
  const template = templateFor(catalog, readIfPresent(join(repoDir, CHOICE_FILE)));

  let head = opts.head;
  if (!head) {
    try {
      head = gitHead(run, repoDir);
    } catch (err) {
      warn(`footer head comparison skipped: ${(err as Error).message}`);
    }
  }
  let files: ChangedFile[] | undefined;
  let riskExtension: RiskExtension | null = null;
  let riskError: string | undefined;
  let commitMessages: string[] = [];
  // two independent reads: a failure in one is reported as its own step and never discards the other
  try {
    const found = changesFromGit(run, repoDir, opts.base);
    files = found.changes;
    riskExtension = extensionFrom(gitFileAt(run, repoDir, found.mergeBase, RISK_EXTENSION_FILE), warn);
  } catch (err) {
    riskError = (err as Error).message;
    files = undefined;
    warn(`the risk floor could not be computed: ${riskError}`);
  }
  try {
    commitMessages = commitMessagesFromGit(run, repoDir, opts.base);
  } catch (err) {
    warn(`commit message check skipped: ${(err as Error).message}`);
  }

  return report(
    checkDescription({
      body,
      title: opts.title,
      head,
      template,
      catalog,
      ...(files !== undefined ? { files, riskExtension } : {}),
      ...(riskError !== undefined ? { riskError } : {}),
      commitMessages,
      allowBreaking: opts.allowBreaking,
      warn,
    }),
    io,
  );
}

function checkPr(number: number, opts: CheckOptions, io: PrTemplateIo, deps: PrTemplateDeps): number {
  const run = deps.run ?? defaultRunner;
  const catalog = deps.catalog ?? loadCatalog();
  const warn = (line: string) => io.stderr(`${PREFIX}: warning: ${line}`);

  const pr = ghPrView(run, number, opts.repo);
  // the PR's own template, read at its head commit and never from the working tree
  const template = templateFor(catalog, ghFileAt(run, pr.headRepo, CHOICE_FILE, pr.headSha));

  let files: ChangedFile[] | undefined;
  let riskError: string | undefined;
  try {
    files = ghPrDiff(run, number, opts.repo);
  } catch (err) {
    riskError = (err as Error).message;
  }
  // the risk extension comes from the base branch, so a PR cannot lower its own floor; a file that
  // cannot be fetched is an error (exit 2), never a lower floor
  let riskExtension: RiskExtension | null = null;
  try {
    riskExtension = extensionFrom(ghFileAt(run, pr.baseRepo, RISK_EXTENSION_FILE, pr.baseRef), warn);
  } catch (err) {
    if (!(err instanceof ToolError)) throw err;
    throw new ToolError(`cannot read ${RISK_EXTENSION_FILE} from ${pr.baseRepo}@${pr.baseRef}: ${err.message}`);
  }

  const common = {
    body: pr.body,
    title: pr.title,
    head: pr.headSha,
    catalog,
    ...(files !== undefined ? { files, riskExtension } : {}),
    ...(riskError !== undefined ? { riskError } : {}),
    commitMessages: pr.commitMessages,
    allowBreaking: opts.allowBreaking,
  };
  const result = checkDescription({ ...common, template, warn });

  const changesTemplate = pr.paths.includes(CHOICE_FILE) || (files ?? []).some((f) => f.path === CHOICE_FILE);
  if (changesTemplate) {
    io.stdout("checked against the template in this pull request\n");
    // the comparison is advisory: when the base's template cannot be fetched, the result below still stands
    let baseText: string | null | undefined;
    try {
      baseText = ghFileAt(run, pr.baseRepo, CHOICE_FILE, pr.baseRef);
    } catch (err) {
      if (!(err instanceof ToolError)) throw err;
      io.stdout(`the comparison with the template on the base branch is unavailable: ${err.message}\n`);
    }
    if (baseText !== undefined) {
      const source = baseText === null ? "the default, the base has no .github/pr-template.json" : CHOICE_FILE;
      try {
        const baseResult = checkDescription({ ...common, template: templateFor(catalog, baseText) });
        for (const line of compareLines(source, result.findings, baseResult.findings)) io.stdout(`${line}\n`);
      } catch (err) {
        if (!(err instanceof UsageError)) throw err;
        io.stdout(`the template on the base branch is not valid, so there is nothing to compare with: ${err.message}\n`);
      }
    }
  }
  return report(result, io);
}

// --------------------------------------------------------------------------- strip and risk

export function runStrip(opts: StripOptions, repoDir: string, io: PrTemplateIo, deps: PrTemplateDeps = {}): number {
  try {
    let text: string;
    try {
      text = readFileSync(resolve(repoDir, opts.file), "utf8");
    } catch (err) {
      throw new ToolError(`cannot read ${opts.file}: ${(err as Error).message}`);
    }
    io.stdout(stripDescription(text, deps.catalog ? { catalog: deps.catalog } : {}));
    return 0;
  } catch (err) {
    if (err instanceof UsageError || err instanceof ToolError) {
      io.stderr(`${PREFIX}: error: ${err.message}`);
      return 2;
    }
    throw err;
  }
}

export function runRisk(opts: RiskOptions, repoDir: string, io: PrTemplateIo, deps: PrTemplateDeps = {}): number {
  const run = deps.run ?? defaultRunner;
  const warn = (line: string) => io.stderr(`${PREFIX}: warning: ${line}`);
  try {
    const { mergeBase, changes } = changesFromGit(run, repoDir, opts.base);
    const extension = extensionFrom(gitFileAt(run, repoDir, mergeBase, RISK_EXTENSION_FILE), warn);
    io.stdout(`${formatRisk(computeRisk(changes, extension, warn))}\n`);
    return 0;
  } catch (err) {
    if (err instanceof ToolError) {
      // Only a failure to find the merge base says the base ref is the problem; any other git or gh failure is not about it.
      const aboutBase = /^git merge-base failed/.test(err.message);
      io.stderr(`${PREFIX}: error: ${err.message}${aboutBase ? ` (pass --base <ref> if ${opts.base} does not exist)` : ""}`);
      return 2;
    }
    throw err;
  }
}
