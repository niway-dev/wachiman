import { parseProfileRef } from "../accounts/resolve";
import { UsageError } from "../config";

export interface RawSetupFlags {
  profile?: string;
  repoDir?: string;
  yes?: boolean;
  json?: boolean;
  help?: boolean;
}

export interface SetupOptions {
  /** A registered name, `default`, or `isolated[:<name>]`. */
  profile: string;
  repoDir: string;
  interactive: boolean;
  json: boolean;
}

export type ResolveResult<T> = { ok: true; options: T } | { ok: false; error: string };

/** Validates the flags, whoever produced them: the parser or the prompts. Whether the profile resolves is the run's business. */
export function resolveSetupOptions(flags: RawSetupFlags, ctx: { interactive: boolean }): ResolveResult<SetupOptions> {
  if (flags.profile === undefined) return { ok: false, error: "setup needs --profile <name> when it cannot ask; run wachiman profile list" };
  try {
    parseProfileRef(flags.profile);
  } catch (error) {
    if (error instanceof UsageError) return { ok: false, error: error.message };
    throw error;
  }
  return { ok: true, options: { profile: flags.profile, repoDir: flags.repoDir ?? ".", interactive: ctx.interactive, json: flags.json === true } };
}
