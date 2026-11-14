import { UsageError } from "../config";
import { parseFlags } from "../flags";
import type { RawInitFlags } from "./options";

export const initUsage =
  "wachiman init [--mode github|local|both] [--project-kind monorepo|single] [--operator <login>] [--version <tag>] [--path <file>] [--force] [--dry-run] [--yes] [--repo-dir <dir>]";

/** The arguments after `init` (`--repo-dir` is already taken out and arrives as `repoDir`). Pure; an unknown flag is a usage error. */
export function parseInitFlags(argv: string[], repoDir: string): RawInitFlags {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true, repoDir };
  const { positionals, values, booleans } = parseFlags(
    argv,
    { values: ["--mode", "--project-kind", "--operator", "--version", "--path"], booleans: ["--force", "--dry-run", "--yes"] },
    "init",
  );
  if (positionals.length > 0) throw new UsageError(`init takes no argument "${positionals[0]}".`);
  return {
    ...(values["--mode"] !== undefined ? { mode: values["--mode"] } : {}),
    ...(values["--project-kind"] !== undefined ? { projectKind: values["--project-kind"] } : {}),
    ...(values["--operator"] !== undefined ? { operator: values["--operator"] } : {}),
    ...(values["--version"] !== undefined ? { version: values["--version"] } : {}),
    ...(values["--path"] !== undefined ? { path: values["--path"] } : {}),
    ...(booleans["--force"] ? { force: true } : {}),
    ...(booleans["--dry-run"] ? { dryRun: true } : {}),
    ...(booleans["--yes"] ? { yes: true } : {}),
    repoDir,
  };
}
