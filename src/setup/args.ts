import { UsageError } from "../config";
import { parseFlags } from "../flags";
import type { RawSetupFlags } from "./options";

/** The arguments after `setup` (`--repo-dir` is already taken out and arrives as `repoDir`). Pure; an unknown flag is a usage error. */
export function parseSetupFlags(argv: string[], repoDir: string): RawSetupFlags {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true, repoDir };
  const { positionals, values, booleans } = parseFlags(argv, { values: ["--profile"], booleans: ["--yes", "--json"] }, "setup");
  if (positionals.length > 0) throw new UsageError(`setup takes no argument "${positionals[0]}".`);
  return {
    ...(values["--profile"] !== undefined ? { profile: values["--profile"] } : {}),
    ...(booleans["--yes"] ? { yes: true } : {}),
    ...(booleans["--json"] ? { json: true } : {}),
    repoDir,
  };
}
