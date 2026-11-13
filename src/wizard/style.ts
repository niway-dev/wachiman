/** Terminal colors are an enhancement: labels carry the meaning in plain output. */
export type Tone = "accent" | "muted" | "success" | "warning" | "error" | "strong" | "highlight";

const CODES: Record<Tone, string> = { accent: "36", muted: "2", success: "32", warning: "33", error: "31", strong: "1", highlight: "1;36" };

export function terminalStyle(output: { isTTY?: boolean }, env: Record<string, string | undefined>) {
  const color = output.isTTY === true && !env.NO_COLOR && env.TERM !== "dumb";
  return (text: string, tone: Tone) => color ? `\x1b[${CODES[tone]}m${text}\x1b[0m` : text;
}

/** The glyphs of the terminal UI; a `dumb` terminal gets ASCII. Each glyph has words next to it, so none carries meaning alone. */
export function symbols(env: Record<string, string | undefined>) {
  return env.TERM === "dumb"
    ? { pointer: ">", done: "+", failed: "x", warn: "!", step: "*", spinner: ["|", "/", "-", "\\"], box: { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|" } }
    : {
        pointer: "❯",
        done: "✔",
        failed: "✖",
        warn: "▲",
        step: "◆",
        spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
        box: { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" },
      };
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
export const stripAnsi = (text: string) => text.replace(ANSI, "");

/** Truncates plain text (no escape codes) to `width` columns, so a repainted menu never wraps and its line count stays exact. */
export function fit(text: string, width: number) {
  const chars = [...text];
  return chars.length <= width ? text : `${chars.slice(0, Math.max(1, width - 1)).join("")}…`;
}

/** Word wrap of plain text; a word longer than the width is kept whole. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line !== "" && [...line].length + 1 + [...word].length > width) {
      lines.push(line);
      line = word;
    } else line = line === "" ? word : `${line} ${word}`;
  }
  lines.push(line);
  return lines;
}

/**
 * A titled box around plain rows. Each row wraps to the terminal width and is padded so the right
 * edge lines up; leading spaces of a row are kept as its indent (commands, continuation lines).
 */
export function renderBox(
  title: string,
  rows: (string | { text: string; tone: Tone })[],
  columns: number,
  env: Record<string, string | undefined>,
  paint: (text: string, tone: Tone) => string,
): string[] {
  const b = symbols(env).box;
  // One column short of the terminal width: a line that fills the last column makes some terminals break twice.
  const inner = Math.max(20, Math.min(columns - 6, 74));
  const body = rows.flatMap((row) => {
    const { text, tone } = typeof row === "string" ? { text: row, tone: undefined } : row;
    const indent = text.match(/^ */)![0];
    // A numbered row wraps under its text, not under its number.
    const hang = " ".repeat(text.slice(indent.length).match(/^\d+\. /)?.[0].length ?? 0);
    return wrap(text.slice(indent.length), inner - indent.length - hang.length).map((l, i) => ({ text: `${indent}${i === 0 ? "" : hang}${l}`, tone }));
  });
  const width = Math.min(inner, Math.max(...body.map((l) => [...l.text].length), [...title].length + 2));
  const rule = b.h.repeat(Math.max(0, width - [...title].length - 1));
  return [
    `${paint(`${b.tl}${b.h} `, "muted")}${paint(title, "strong")}${paint(` ${rule}${b.tr}`, "muted")}`,
    ...body.map(({ text, tone }) => {
      const pad = " ".repeat(Math.max(0, width - [...text].length));
      return `${paint(b.v, "muted")} ${tone ? paint(text, tone) : text}${pad} ${paint(b.v, "muted")}`;
    }),
    paint(`${b.bl}${b.h.repeat(width + 2)}${b.br}`, "muted"),
  ];
}

/** What a terminal session offers `wizardIo`: whether it is a real terminal, and a place to collect the closing hints. */
export interface NextStepSink {
  fancy: boolean;
  nextStep: (command: string, note?: string) => void;
}

/** What a closing hint is for, when the hint itself only names the command. */
export function describeCommand(command: string): string {
  if (/^wachiman local\b/.test(command)) return "Review your branch on your signed-in Claude";
  if (/^wachiman doctor\b/.test(command)) return "See which checks need attention";
  if (/^wachiman setup\b/.test(command)) return "Bind this repository to a Claude account";
  return "Run";
}

/**
 * Only human-facing stderr is decorated; stdout remains byte-for-byte data. With a terminal
 * session the closing `next:` hints are collected into the session's "Next steps" box.
 */
export function wizardIo<T extends { stderr: (line: string) => void }>(io: T, output: { isTTY?: boolean }, env: Record<string, string | undefined>, session?: NextStepSink): T {
  const paint = terminalStyle(output, env);
  const mark = symbols(env);
  return { ...io, stderr: (line: string) => {
    const next = session?.fancy ? /^(?:next|Next, on this machine): (\S.*?)(?: {3}\((.*)\))?$/.exec(line) : null;
    if (next) return session!.nextStep(next[1], next[2]);
    const tone = /^(bound:|wrote |account: signed in|All required checks passed|local: ready)/.test(line) ? "success"
      : /^(warning:|cancelled:|not written|nothing saved|These already happened|local: not ready|github: pending)/.test(line) ? "warning" : undefined;
    io.stderr(tone ? paint(session?.fancy && tone === "success" ? `${mark.done} ${line}` : line, tone) : line);
  } };
}
