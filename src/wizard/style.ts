/**
 * Colors and the glyph set of the terminal UI. This is a presentation module: it is the one place
 * the terminal's colors come from (`chalk`), and it is only loaded through a dynamic `import()` in `src/cli.ts` and `src/wizard/load.ts`, never by
 * the review engine (ADR 0002, amendment 2026-11-13).
 *
 * Color is an enhancement: labels carry the meaning in plain output. chalk 5.6 does not read
 * `NO_COLOR` (it only honors `FORCE_COLOR`), so the level is decided here, from the stream and the
 * environment, and handed to chalk.
 */
import { Chalk, type ChalkInstance } from "chalk";
import type { Paint, Tone } from "./tone";

export type { Paint, Tone } from "./tone";

/** The brand color: the blue of the guard's uniform. */
export const BRAND_HEX = "#4d8dff";

/**
 * 0 means no color: the output is not a terminal, `TERM` is `dumb`, or `NO_COLOR` is set and not
 * empty (an empty value is ignored, as no-color.org says). Otherwise 3 for a truecolor terminal,
 * 2 for a 256-color one, 1 for the rest.
 */
export function colorLevel(output: { isTTY?: boolean }, env: Record<string, string | undefined>): 0 | 1 | 2 | 3 {
  if (output.isTTY !== true || env.TERM === "dumb" || (env.NO_COLOR !== undefined && env.NO_COLOR !== "")) return 0;
  if (env.COLORTERM === "truecolor" || env.COLORTERM === "24bit") return 3;
  return /256color/.test(env.TERM ?? "") ? 2 : 1;
}

export function makeChalk(output: { isTTY?: boolean }, env: Record<string, string | undefined>): ChalkInstance {
  return new Chalk({ level: colorLevel(output, env) });
}

export function terminalStyle(output: { isTTY?: boolean }, env: Record<string, string | undefined>): Paint {
  const c = makeChalk(output, env);
  const tones: Record<Tone, ChalkInstance> = {
    accent: c.cyan,
    muted: c.dim,
    success: c.green,
    warning: c.yellow,
    error: c.red,
    strong: c.bold,
    highlight: c.bold.cyan,
    brand: c.bold.hex(BRAND_HEX),
  };
  return (text, tone) => tones[tone](text);
}

/** The glyphs of the terminal UI; a `dumb` terminal gets ASCII. Each glyph has words next to it, so none carries meaning alone. */
export function symbols(env: Record<string, string | undefined>) {
  return env.TERM === "dumb" ? { done: "+", failed: "x", warn: "!", bar: "|" } : { done: "✔", failed: "✖", warn: "▲", bar: "│" };
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
export const stripAnsi = (text: string) => text.replace(ANSI, "");

/** What a terminal session offers `wizardIo`: whether it is a real terminal, and a place to collect the closing hints. */
export interface NextStepSink {
  fancy: boolean;
  nextStep: (command: string, note?: string) => void;
  /** On a terminal session a status line is drawn inside the session frame instead of loose on stderr. */
  report?: (line: string, kind: "success" | "warning" | "info") => void;
}

/** A Windows hint names its shell first ("PowerShell: wachiman setup"); this drops that label. */
export function withoutShell(command: string): string {
  return command.replace(/^(PowerShell|Git Bash): /, "");
}

/** What a closing hint is for, when the hint itself only names the command. */
export function describeCommand(command: string): string {
  command = withoutShell(command);
  if (/^wachiman local\b/.test(command)) return "Review your branch on your signed-in Claude";
  if (/^wachiman doctor\b/.test(command)) return "See which checks need attention";
  if (/^wachiman setup\b/.test(command)) return "Bind this repository to a Claude account";
  return "Run";
}

const SUCCESS = /^(bound:|wrote |account: signed in|All required checks passed|local: ready)/;
const WARNING = /^(warning:|cancelled:|not written|nothing saved|These already happened|local: not ready|github: pending)/;

/**
 * Only human-facing stderr is decorated; stdout remains byte-for-byte data. With a terminal
 * session the closing `next:` hints are collected into the session's "Next steps" note, and every
 * other line is drawn inside the session frame.
 */
export function wizardIo<T extends { stderr: (line: string) => void }>(io: T, output: { isTTY?: boolean }, env: Record<string, string | undefined>, session?: NextStepSink): T {
  const paint = terminalStyle(output, env);
  return {
    ...io,
    stderr: (line: string) => {
      const next = session?.fancy ? /^(?:next|Next, on this machine): (\S.*?)(?: {3}\((.*)\))?$/.exec(line) : null;
      if (next) return session!.nextStep(next[1], next[2]);
      const kind = SUCCESS.test(line) ? "success" : WARNING.test(line) ? "warning" : "info";
      if (session?.fancy && session.report) return session.report(line, kind);
      const tone = kind === "success" ? "success" : kind === "warning" ? "warning" : undefined;
      io.stderr(tone ? paint(line, tone) : line);
    },
  };
}
