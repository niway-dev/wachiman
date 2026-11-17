/**
 * Loads the terminal UI of a wizard on demand. `init` and `setup` import this file, which has no
 * import of chalk or Clack: the packages are only reached by the dynamic `import()` below, in the
 * branch that asks questions on a terminal. A run with `--yes`, `--json`, `--dry-run`, a pipe or CI
 * never loads them, and neither does a clone that never ran `bun install`, which gets one clear
 * message instead of a stack trace when it asks for the terminal screens.
 */
import { UsageError } from "../config";

export type TerminalUi = Pick<typeof import("./prompt"), "openPrompter"> & Pick<typeof import("./style"), "wizardIo">;

export async function loadTerminalUi(): Promise<TerminalUi> {
  try {
    const [prompt, style] = await Promise.all([import("./prompt"), import("./style")]);
    return { openPrompter: prompt.openPrompter, wizardIo: style.wizardIo };
  } catch (error) {
    if (isMissingPackage(error)) {
      throw new UsageError(
        "The terminal screens need the packages in package.json (chalk and @clack/prompts). Run `bun install` in this clone, install wachiman from npm, or pass the answers as flags with --yes.",
      );
    }
    throw error;
  }
}

/** Bun and Node say it with a code or with the text; either is a package that is not installed. */
export function isMissingPackage(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | undefined;
  return e?.code === "ERR_MODULE_NOT_FOUND" || /Cannot find (package|module) '(chalk|@clack\/[a-z-]+|sisteransi|fast-[a-z-]+)/.test(e?.message ?? "");
}
