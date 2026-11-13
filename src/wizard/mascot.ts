/**
 * The intro of the interactive commands: a colored `wachiman` chip with "On watch." and the
 * version, then Wachi, the guard, drawn as a small rounded face under a peaked cap, with a short
 * line typed out next to it.
 *
 *    ┌  wachiman  On watch. v1.14.0
 *    │
 *    │     ▄███▄
 *    │   ▄██▀◆▀██▄
 *    │  ▀▀▀▀▀▀▀▀▀▀▀
 *    │  ╭─────────╮
 *    │  │ ◉  ‿  ◉ │   Wachi: Shift started. Let's watch this repo.
 *    │  ╰─────────╯
 *
 * The art is original and lives here as data. `mascotScene` and `chipTitle` are pure, so tests read
 * them; `playIntro` does the typing.
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

/** The face under the cap: eyes, mouth. The pieces are painted separately. */
const FACE = { left: "◉", mouth: "‿", right: "◉" } as const;

export interface MascotOptions {
  paint: Paint;
  /** `TERM=dumb`: ASCII only. */
  ascii: boolean;
  columns: number;
  /** What Wachi says. */
  message: string;
}

export interface MascotScene {
  /** Rows printed whole before the line that is typed. */
  top: string[];
  /** The start of the typed line: the face row with Wachi's name. Printed without a newline. */
  lead: string;
  /** The text typed after `lead`. */
  message: string;
  /** Rows printed whole after the typed line. */
  bottom: string[];
}

/** Narrower than this, the line goes under the face instead of beside it. */
export const SIDE_BY_SIDE_COLUMNS = 66;

export function mascotScene({ paint, ascii, columns, message }: MascotOptions): MascotScene {
  const cap = (text: string) => paint(text, "brand");
  const edge = (text: string) => paint(text, "muted");
  const badge = ascii ? "*" : "◆";
  const eyes = ascii ? "o" : FACE.left;
  const mouth = ascii ? "u" : FACE.mouth;
  const art = ascii
    ? {
        crown: ["   .---.", "  /--*--\\", " ==========="],
        top: "+---------+",
        bottom: "+---------+",
        side: "|",
      }
    : {
        crown: ["   ▄███▄", " ▄██▀◆▀██▄", "▀▀▀▀▀▀▀▀▀▀▀"],
        top: "╭─────────╮",
        bottom: "╰─────────╯",
        side: "│",
      };
  const crown = art.crown.map((row) => row.split(badge).map(cap).join(paint(badge, "warning")));
  const face = `${edge(art.side)} ${paint(eyes, "strong")}  ${paint(mouth, "brand")}  ${paint(ascii ? "o" : FACE.right, "strong")} ${edge(art.side)}`;
  const box = [...crown, edge(art.top)];
  const name = `${paint(`${NAME}:`, "brand")} `;
  if (columns >= SIDE_BY_SIDE_COLUMNS) return { top: box, lead: `${face}   ${name}`, message, bottom: [edge(art.bottom)] };
  // A narrow terminal: the whole face first, then the line on its own row.
  return { top: [...box, face, edge(art.bottom)], lead: name, message, bottom: [] };
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
    let typed = 0;
    for (const ch of [...scene.message]) {
      if (stop) break;
      output.write(ch);
      typed += 1;
      await Promise.race([sleep(TYPE_MS), new Promise<void>((resolve) => (wake = resolve))]);
    }
    // A key skipped the typing: the rest of the line appears at once.
    output.write([...scene.message].slice(typed).join(""));
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
