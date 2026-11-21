/**
 * `wachiman pr-template <subcommand>`: the one entry that `src/cli.ts` calls. It picks the
 * subcommand, parses its arguments and runs it; the work is in install.ts (show, install, status),
 * check-run.ts (check, strip, risk) and format.ts. No subcommand, `--help` and `-h` print the
 * command's page; `<subcommand> --help` prints that subcommand's page. An unknown subcommand is a
 * usage error (exit 2), like every configuration problem the subcommands throw.
 */
import { resolve } from "node:path";
import { UsageError } from "../config";
import { commandHelp } from "../help";
import {
  parseCheckArgs,
  parseRiskArgs,
  parseStripArgs,
  runCheck,
  runRisk,
  runStrip,
  type PrTemplateDeps,
  type PrTemplateIo,
} from "./check-run";
import { defaultRunner } from "./gh";
import { parseFormatArgs, runFormat } from "./format";
import { parseInstallArgs, parseShowArgs, parseStatusArgs, runInstall, runShow, runStatus, type Deps as InstallDeps } from "./install";

export const SUBCOMMANDS = ["show", "install", "status", "check", "format", "risk", "strip"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

export interface PrTemplateRunDeps {
  /** show, install and status. */
  install?: InstallDeps;
  /** check, strip and risk. */
  check?: PrTemplateDeps;
  /** format. */
  format?: Parameters<typeof runFormat>[3];
}

/**
 * The repository's top level for `dir`, from `git rev-parse --show-toplevel` run there (an argument
 * array, no shell). Not a git repository, or no git: `dir` itself, so the command still works in a
 * plain directory.
 */
function repositoryRoot(dir: string): string {
  const r = defaultRunner(["git", "rev-parse", "--show-toplevel"], dir);
  const top = r.code === 0 ? r.stdout.trim() : "";
  return top === "" ? dir : top;
}

const isSubcommand = (word: string): word is Subcommand => (SUBCOMMANDS as readonly string[]).includes(word);

/** `argv` is what follows `pr-template`. Returns the exit code: 0, 1 findings or a state to act on, 2 usage or configuration. */
export function runPrTemplate(argv: string[], repoDir: string, io: PrTemplateIo, deps: PrTemplateRunDeps = {}): number {
  const [first, ...rest] = argv;
  if (first === undefined || first === "--help" || first === "-h") return (io.stdout(commandHelp(["pr-template"])!), 0);
  if (!isSubcommand(first)) {
    throw new UsageError(`Unknown pr-template subcommand "${first}". Use one of: ${SUBCOMMANDS.join(", ")}.`);
  }
  // The managed files live at the repository's top level, wherever the command was pointed inside it;
  // `risk` already asks git, so it keeps the directory it was given.
  const root = first === "risk" || first === "strip" ? repoDir : repositoryRoot(repoDir);
  // `check` reads a relative file argument from `fileBase`, by default the directory the command was given
  // (`--repo-dir`). Unless a caller passes its own runner, `gh` and `git` run at the repository root, which is
  // also where `.github/` is read. `strip` and `format` take their file against the directory or root they are given.
  const check: PrTemplateDeps = {
    ...deps.check,
    fileBase: deps.check?.fileBase ?? repoDir,
    run: deps.check?.run ?? ((cmd, cwd) => defaultRunner(cmd, cwd ?? root)),
  };
  const help = () => (io.stdout(commandHelp(["pr-template", first])!), 0);
  switch (first) {
    case "show": {
      const parsed = parseShowArgs(rest);
      return "help" in parsed ? help() : runShow(parsed, root, io, deps.install);
    }
    case "install": {
      const parsed = parseInstallArgs(rest);
      return "help" in parsed ? help() : runInstall(parsed, root, io, deps.install);
    }
    case "status": {
      const parsed = parseStatusArgs(rest);
      return "help" in parsed ? help() : runStatus(parsed, root, io, deps.install);
    }
    case "check": {
      const parsed = parseCheckArgs(rest);
      return "help" in parsed ? help() : runCheck(parsed, root, io, check);
    }
    case "format": {
      const parsed = parseFormatArgs(rest);
      if ("help" in parsed) return help();
      // format.ts resolves its file against the root it is given, so the argument is made absolute here.
      return runFormat(parsed.file !== undefined ? { ...parsed, file: resolve(repoDir, parsed.file) } : parsed, root, io, deps.format);
    }
    case "risk": {
      const parsed = parseRiskArgs(rest);
      return "help" in parsed ? help() : runRisk(parsed, repoDir, io, check);
    }
    case "strip": {
      const parsed = parseStripArgs(rest);
      return "help" in parsed ? help() : runStrip(parsed, repoDir, io, check);
    }
  }
}
