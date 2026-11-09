import { isInteractive as ttyInteractive } from "../accounts/commands";

/** The stream properties that decide it; `process.stdin` and `process.stdout` satisfy this. */
export interface TerminalStreams {
  stdin: { isTTY?: boolean };
  stdout: { isTTY?: boolean };
}

/**
 * Whether a wizard may ask questions: `--yes` is absent, stdin and stdout are terminals, and `CI`
 * is not `true`. Computed once per command (types spec section 8, invariant 14).
 */
export function isInteractive(flags: { yes?: boolean }, env: Record<string, string | undefined>, streams: TerminalStreams) {
  if (flags.yes) return false;
  return ttyInteractive(env, { stdin: streams.stdin.isTTY === true, stdout: streams.stdout.isTTY === true });
}
