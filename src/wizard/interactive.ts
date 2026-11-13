import { isInteractive as ttyInteractive } from "../accounts/commands";

/** The stream properties that decide it; `process.stdin` and `process.stdout` satisfy this. */
export interface TerminalStreams {
  stdin: { isTTY?: boolean };
  stdout: { isTTY?: boolean };
}

export interface LauncherStreams {
  stdin: { isTTY?: boolean };
  stdout: { isTTY?: boolean };
  stderr: { isTTY?: boolean };
}

/** The launcher opens on a real terminal outside CI; anything else gets the help text it always got. */
export function shouldLaunch(env: Record<string, string | undefined>, streams: LauncherStreams): boolean {
  return streams.stdin.isTTY === true && streams.stdout.isTTY === true && streams.stderr.isTTY === true && !env.CI;
}

/**
 * Whether a wizard may ask questions: `--yes` is absent, stdin and stdout are terminals, and `CI`
 * is neither `true` nor `1`. Computed once per command (types spec section 8, invariant 14).
 */
export function isInteractive(flags: { yes?: boolean }, env: Record<string, string | undefined>, streams: TerminalStreams) {
  if (flags.yes) return false;
  return ttyInteractive(env, { stdin: streams.stdin.isTTY === true, stdout: streams.stdout.isTTY === true });
}
