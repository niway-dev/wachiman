/**
 * The intro of the interactive commands: a colored `wachiman` chip with "On watch." and the
 * version, then Wachi, the guard: a wide rounded face with a W badge, round ◉ eyes and a small ‿ smile,
 * with a short line typed out next to the eyes. While it types, Wachi blinks once, and it winks
 * (one eye) when the line is done.
 *
 *    ┌  wachiman  On watch. v1.14.0
 *    │
 *    │  ╭─────────────╮
 *    │  │      W      │
 *    │  │             │
 *    │  │   ◉     ◉   │   Wachi: Shift started. Let's watch this repo.
 *    │  │      ‿      │
 *    │  │             │
 *    │  ╰─────────────╯
 *
 * Every row of the face is 15 columns wide (13 inside: the eyes row is 3 + 1 + 5 + 1 + 3): a new row or variant must keep that sum,
 * or the right border shifts. The art is original and lives here as data. `mascotScene` and
 * `chipTitle` are pure, so tests read them; `playIntro` does the typing.
 *
 * Rules the player keeps:
 * - The typing runs only on a real terminal with color, outside CI, and without
 *   WACHIMAN_NO_ANIMATION. Anywhere else (and with NO_COLOR or TERM=dumb) the same scene is printed
 *   at once, with no escape code but color.
 * - Any key skips the typing; Ctrl-C ends it (the caller then cancels).
 * - The cursor is always restored, also on an exception and on process exit.
 */
import { BRAND_HEX, colorLevel, makeChalk, terminalStyle, type Paint } from "./style";
import type { Ui } from "./ui";

export const NAME = "Wachi";
export const DEFAULT_LINE = "Shift started. Let's watch this repo.";

/** Inside width of the face; every row pads to it. */
export const FACE_INSIDE = 13;

export interface MascotOptions {
  paint: Paint;
  /** `TERM=dumb`: ASCII only. */
  ascii: boolean;
  columns: number;
  /** What Wachi says. */
  message: string;
}

/** Which eyes are open: both, neither (a blink) or only the left one (a wink). */
export type Eyes = "open" | "blink" | "wink";

export interface MascotScene {
  /** Rows printed whole before the line that is typed. */
  top: string[];
  /** The start of the typed line: the eyes row with Wachi's name. Printed without a newline. */
  lead: string;
  /**
   * `lead` with the eyes closed or winking, for redrawing the typed line in place. Absent on a
   * narrow terminal, where the eyes are not on the typed line and so cannot be redrawn.
   */
  leads?: Record<Eyes, string>;
  /** The text typed after `lead`. */
  message: string;
  /** Rows printed whole after the typed line. */
  bottom: string[];
}

/** Narrower than this, the line goes under the face instead of beside it. */
export const SIDE_BY_SIDE_COLUMNS = 66;

export function mascotScene({ paint, ascii, columns, message }: MascotOptions): MascotScene {
  const edge = (text: string) => paint(text, "muted");
  const g = ascii
    ? { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|", eye: "o", shut: "-", mark: "u" }
    : { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│", eye: "◉", shut: "─", mark: "‿" };
  const border = (l: string, r: string) => edge(`${l}${g.h.repeat(FACE_INSIDE)}${r}`);
  const center = (text: string) => {
    const pad = (FACE_INSIDE - text.length) / 2;
    return [" ".repeat(Math.floor(pad)), " ".repeat(Math.ceil(pad))] as const;
  };
  const centered = (text: string, tone: Parameters<Paint>[1]) => {
    const [l, r] = center(text);
    return `${edge(g.v)}${l}${paint(text, tone)}${r}${edge(g.v)}`;
  };
  const badge = centered("W", "warning");
  const open = paint(g.eye, "strong");
  const shut = paint(g.shut, "strong");
  const eyesRow = (left: string, right: string) => `${edge(g.v)}   ${left}     ${right}   ${edge(g.v)}`;
  const eyes = eyesRow(open, open);
  const blank = `${edge(g.v)}${" ".repeat(FACE_INSIDE)}${edge(g.v)}`;
  const mark = centered(g.mark, "brand");
  const name = `${paint(`${NAME}:`, "brand")} `;
  const top = [border(g.tl, g.tr), badge, blank];
  const bottom = [mark, blank, border(g.bl, g.br)];
  if (columns >= SIDE_BY_SIDE_COLUMNS) {
    // The blink and wink redraw the line from its start with a carriage return, which only works
    // when the line did not wrap: the 3-column row prefix, the face, the gap, the name, the text.
    const width = ROW_PREFIX + FACE_INSIDE + 2 + 3 + NAME.length + 2 + [...message].length;
    if (width > columns) return { top, lead: `${eyes}   ${name}`, message, bottom };
    const leads: Record<Eyes, string> = {
      open: `${eyes}   ${name}`,
      blink: `${eyesRow(shut, shut)}   ${name}`,
      wink: `${eyesRow(open, shut)}   ${name}`,
    };
    return { top, lead: leads.open, leads, message, bottom };
  }
  // A narrow terminal: the whole face first, then the line on its own row.
  return { top: [...top, eyes, ...bottom], lead: name, message, bottom: [] };
}

/** The first line of the session: the chip, "On watch." and the version. */
export function chipTitle(version: string, output: { isTTY?: boolean }, env: Record<string, string | undefined>): string {
  const c = makeChalk(output, env);
  const chip = colorLevel(output, env) === 0 ? "wachiman" : c.bgHex(BRAND_HEX).hex("#0b1020").bold(" wachiman ");
  return `${chip}  On watch. ${terminalStyle(output, env)(`v${version}`, "muted")}`;
}

export interface IntroTerminal {
  /** stderr, the stream the prompts use. */
  output: NodeJS.WritableStream & { isTTY?: boolean; columns?: number };
  input: NodeJS.ReadableStream & { isTTY?: boolean; isRaw?: boolean; setRawMode?: (mode: boolean) => unknown };
}

/** Whether the typing may play; anywhere else the scene is printed at once. */
export function canAnimate(term: IntroTerminal, env: Record<string, string | undefined>) {
  return (
    term.output.isTTY === true &&
    term.input.isTTY === true &&
    typeof term.input.setRawMode === "function" &&
    colorLevel(term.output, env) > 0 &&
    !env.CI &&
    !env.WACHIMAN_NO_ANIMATION &&
    (term.output.columns ?? 80) >= 40
  );
}

export type IntroResult = "static" | "played" | "skipped" | "interrupted";

const HIDE = "\x1b[?25l";
const SHOW = "\x1b[?25h";
/** One character every 18 ms: the 37-character default line takes about 0.7 s. */
export const TYPE_MS = 18;
/** playIntro prints each row after the muted bar and two spaces. */
const ROW_PREFIX = 3;
/** A blink keeps both eyes shut this long. */
export const BLINK_MS = 140;
/** After the line is typed, Wachi waits this long, then winks for `WINK_MS`. */
export const WINK_DELAY_MS = 250;
export const WINK_MS = 420;

export interface IntroOptions {
  ui: Ui;
  term: IntroTerminal;
  env: Record<string, string | undefined>;
  version: string;
  /** What Wachi says; the default is `DEFAULT_LINE`. */
  line?: string;
  /** Replaced in tests; the default is a timer. */
  sleep?: (ms: number) => Promise<void>;
}

export async function playIntro({ ui, term, env, version, line = DEFAULT_LINE, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }: IntroOptions): Promise<IntroResult> {
  const { output, input } = term;
  const paint = terminalStyle(output, env);
  const scene = mascotScene({ paint, ascii: env.TERM === "dumb", columns: output.columns ?? 80, message: line });
  const bar = paint(env.TERM === "dumb" ? "|" : "│", "muted");
  const row = (text: string) => `${bar}  ${text}`;
  ui.intro(chipTitle(version, output, env));
  output.write(`${bar}\n${scene.top.map((r) => `${row(r)}\n`).join("")}`);
  if (!canAnimate(term, env)) {
    output.write(`${row(scene.lead)}${scene.message}\n${scene.bottom.map((r) => `${row(r)}\n`).join("")}`);
    return "static";
  }
  const wasRaw = input.isRaw === true;
  let stop: "skipped" | "interrupted" | undefined;
  let wake: (() => void) | undefined;
  const onData = (chunk: Buffer | string) => {
    stop = String(chunk).includes("\u0003") ? "interrupted" : (stop ?? "skipped");
    wake?.();
  };
  const restoreCursor = () => void output.write(SHOW);
  process.once("exit", restoreCursor);
  try {
    input.setRawMode!(true);
    input.on("data", onData);
    input.resume();
    output.write(`${HIDE}${row(scene.lead)}`);
    await Promise.race([sleep(120), new Promise<void>((resolve) => (wake = resolve))]);
    const chars = [...scene.message];
    const pause = (ms: number) => Promise.race([sleep(ms), new Promise<void>((resolve) => (wake = resolve))]);
    // Redraw the typed line in place with other eyes: carriage return, then lead and text again.
    const face = (eyes: Eyes, text: string) => void output.write(`\r${row(scene.leads![eyes])}${text}`);
    const blinkAt = scene.leads ? Math.floor(chars.length / 3) : -1;
    let typed = 0;
    for (const ch of chars) {
      if (stop) break;
      if (typed === blinkAt) {
        const sofar = chars.slice(0, typed).join("");
        face("blink", sofar);
        await pause(BLINK_MS);
        face("open", sofar);
      }
      output.write(ch);
      typed += 1;
      await pause(TYPE_MS);
    }
    // A key skipped the typing: the rest of the line appears at once.
    output.write(chars.slice(typed).join(""));
    if (!stop && scene.leads) {
      await pause(WINK_DELAY_MS);
      if (!stop) {
        face("wink", scene.message);
        await pause(WINK_MS);
        face("open", scene.message);
      }
    }
  } finally {
    input.off("data", onData);
    input.setRawMode!(wasRaw);
    input.pause();
    output.write(`\n${SHOW}`);
    process.off("exit", restoreCursor);
  }
  output.write(scene.bottom.map((r) => `${row(r)}\n`).join(""));
  return stop ?? "played";
}
