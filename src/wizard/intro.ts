/**
 * The intro of the interactive commands: a small pixel-art police car, drawn with Unicode half
 * blocks and 256-color ANSI, drives up to a guard (about 1.3 s), then the animation is wiped and a
 * one-line header stays: `👮 wachiman v1.14.0 · on watch`.
 *
 * The art is original and lives here as data: sprites are character grids, and `introFrames` lists
 * what changes from frame to frame (car position, which way the lights point, the guard's wave,
 * the road). `renderFrame` turns one frame into text lines. Both are pure, so tests read them.
 *
 * Rules the player keeps:
 * - It never blocks: any key skips it, and Ctrl-C ends it (the caller then cancels).
 * - It runs only on a real terminal with color, outside CI, and without WACHIMAN_NO_ANIMATION.
 *   Everywhere else the static one-line header is printed.
 * - The cursor is always restored and the animation lines are always cleared, also on an exception
 *   and on process exit.
 * - The lights swap red and blue every 400 ms (2.5 per second) and never go dark, below the
 *   3-per-second line for flashing content.
 */
import { terminalStyle } from "./style";

/** Palette keys to xterm-256 color numbers. */
const PALETTE: Record<string, number> = {
  O: 237, // outline
  W: 255, // body
  S: 28, // green stripe
  C: 111, // glass
  H: 247, // hub
  Y: 227, // headlight
  B: 25, // uniform blue
  K: 234, // boots and belt
  F: 216, // skin
  D: 244, // road dash
  R: 196, // red light
  U: 33, // blue light
};

/** Facing right. `L` and `M` are the two lights of the roof bar; their colors swap between frames. */
export const CAR_SPRITE = [
  "........LLMM........",
  ".......OOOOOO.......",
  "......OWWWWWWO......",
  ".....OWCCWCCCWO.....",
  "..OOOOOOOOOOOOOOOO..",
  ".OWWWWWWWWWWWWWWWWY.",
  ".OSSSSSSSSSSSSSSSSO.",
  ".OSOOOOSSSSSSOOOOSO.",
  "...OHHO......OHHO...",
] as const;

export const GUARD_SPRITE = {
  idle: ["..BBB..", ".BBBBB.", "..FFF..", "..FFF..", ".BBBBB.", ".BBBBB.", "..B.B..", "..K.K.."],
  /** The arm that faces the car goes up: the stop sign. */
  wave: ["..BBB..", ".BBBBB.", "F.FFF..", "F.FFF..", "BBBBBB.", ".BBBBB.", "..B.B..", "..K.K.."],
} as const;

export interface IntroFrame {
  /** Column of the car's left edge; negative while it is still entering. */
  carX: number;
  /** 0: left light red, right light blue. 1: swapped. */
  lights: 0 | 1;
  wave: boolean;
  /** Shifts the dashes of the road so it seems to move under the wheels. */
  road: number;
}

export const FRAME_MS = 40;
const DRIVE_FRAMES = 24;
const SETTLE_FRAMES = 8;
/** 10 frames of 40 ms: one swap of the lights every 400 ms. */
const LIGHT_FRAMES = 10;
const ROWS = 5;

const carWidth = CAR_SPRITE[0].length;
const guardWidth = GUARD_SPRITE.idle[0].length;

/** Width of the scene for a terminal `columns` wide; the intro does not play below 40 columns. */
export const sceneWidth = (columns: number) => Math.max(carWidth + guardWidth + 8, Math.min(columns - 2, 56));

/** Every frame of the intro for a scene `width` columns wide. */
export function introFrames(width: number): IntroFrame[] {
  const start = -carWidth;
  const end = width - guardWidth - carWidth - 2;
  const frames: IntroFrame[] = [];
  for (let i = 0; i < DRIVE_FRAMES + SETTLE_FRAMES; i++) {
    const t = Math.min(1, i / (DRIVE_FRAMES - 1));
    const eased = 1 - (1 - t) * (1 - t);
    const carX = Math.round(start + (end - start) * eased);
    frames.push({ carX, lights: Math.floor(i / LIGHT_FRAMES) % 2 === 0 ? 0 : 1, wave: i >= DRIVE_FRAMES - 4, road: -carX });
  }
  return frames;
}

/** The pixel grid of one frame: `ROWS * 2` rows of `width` palette keys (`.` is empty). */
export function frameGrid(frame: IntroFrame, width: number): string[][] {
  const grid = Array.from({ length: ROWS * 2 }, () => Array<string>(width).fill("."));
  const put = (sprite: readonly string[], x: number, y: number, light?: { L: string; M: string }) => {
    sprite.forEach((row, dy) =>
      [...row].forEach((ch, dx) => {
        if (ch === ".") return;
        const col = x + dx;
        if (col < 0 || col >= width) return;
        grid[y + dy][col] = light && (ch === "L" || ch === "M") ? light[ch] : ch;
      }),
    );
  };
  const ground = ROWS * 2 - 1;
  for (let c = 0; c < width; c++) if (((c + frame.road) % 6 + 6) % 6 < 3) grid[ground][c] = "D";
  put(CAR_SPRITE, frame.carX, 0, frame.lights === 0 ? { L: "R", M: "U" } : { L: "U", M: "R" });
  put(frame.wave ? GUARD_SPRITE.wave : GUARD_SPRITE.idle, width - guardWidth, 1);
  return grid;
}

const fg = (n: number) => `38;5;${n}`;
const bg = (n: number) => `48;5;${n}`;

/** Two pixel rows become one text row of half blocks. With `color` false only the shapes are kept. */
export function renderFrame(frame: IntroFrame, width: number, color = true): string[] {
  const grid = frameGrid(frame, width);
  const lines: string[] = [];
  for (let row = 0; row < ROWS; row++) {
    let line = "";
    for (let c = 0; c < width; c++) {
      const top = grid[row * 2][c];
      const bottom = grid[row * 2 + 1][c];
      if (top === "." && bottom === ".") line += " ";
      else if (!color) line += top !== "." && bottom !== "." ? "█" : top !== "." ? "▀" : "▄";
      else if (top === bottom) line += `\x1b[${fg(PALETTE[top])}m█\x1b[0m`;
      else if (top === ".") line += `\x1b[${fg(PALETTE[bottom])}m▄\x1b[0m`;
      else if (bottom === ".") line += `\x1b[${fg(PALETTE[top])}m▀\x1b[0m`;
      else line += `\x1b[${fg(PALETTE[top])};${bg(PALETTE[bottom])}m▀\x1b[0m`;
    }
    lines.push(line);
  }
  return lines;
}

/** The line the intro leaves behind. */
export function headerLine(version: string, env: Record<string, string | undefined>, output: { isTTY?: boolean }) {
  const paint = terminalStyle(output, env);
  return `👮 ${paint("wachiman", "strong")} ${paint(`v${version} · on watch`, "muted")}`;
}

export interface IntroTerminal {
  /** stderr, the stream the prompts use. */
  output: NodeJS.WritableStream & { isTTY?: boolean; columns?: number };
  input: NodeJS.ReadableStream & { isTTY?: boolean; isRaw?: boolean; setRawMode?: (mode: boolean) => unknown };
}

/** Whether the animation may play; anywhere else the static header is printed. */
export function canAnimate(term: IntroTerminal, env: Record<string, string | undefined>) {
  return (
    term.output.isTTY === true &&
    term.input.isTTY === true &&
    typeof term.input.setRawMode === "function" &&
    !env.NO_COLOR &&
    !env.CI &&
    !env.WACHIMAN_NO_ANIMATION &&
    env.TERM !== "dumb" &&
    (term.output.columns ?? 80) >= 40
  );
}

export type IntroResult = "static" | "played" | "skipped" | "interrupted";

const HIDE = "\x1b[?25l";
const SHOW = "\x1b[?25h";

export interface IntroOptions {
  term: IntroTerminal;
  env: Record<string, string | undefined>;
  version: string;
  /** Replaced in tests; the default is a timer. */
  sleep?: (ms: number) => Promise<void>;
}

export async function playIntro({ term, env, version, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }: IntroOptions): Promise<IntroResult> {
  const { output, input } = term;
  const header = `${headerLine(version, env, output)}\n`;
  if (!canAnimate(term, env)) {
    output.write(header);
    return "static";
  }
  const width = sceneWidth(output.columns ?? 80);
  const wasRaw = input.isRaw === true;
  let stop: "skipped" | "interrupted" | undefined;
  let wake: (() => void) | undefined;
  const onData = (chunk: Buffer | string) => {
    stop = String(chunk).includes("\u0003") ? "interrupted" : (stop ?? "skipped");
    wake?.();
  };
  const restoreCursor = () => void output.write(SHOW);
  process.once("exit", restoreCursor);
  let drawn = false;
  try {
    input.setRawMode!(true);
    input.on("data", onData);
    input.resume();
    output.write(HIDE);
    for (const frame of introFrames(width)) {
      // Move back over the lines of the previous frame, then draw this one.
      output.write(`${drawn ? `\x1b[${ROWS}A` : ""}${renderFrame(frame, width).map((l) => `${l}\x1b[K\n`).join("")}`);
      drawn = true;
      if (stop) break;
      await Promise.race([sleep(FRAME_MS), new Promise<void>((resolve) => (wake = resolve))]);
      if (stop) break;
    }
  } finally {
    input.off("data", onData);
    input.setRawMode!(wasRaw);
    input.pause();
    if (drawn) output.write(`\x1b[${ROWS}A\x1b[J`);
    output.write(SHOW);
    process.off("exit", restoreCursor);
  }
  output.write(header);
  return stop ?? "played";
}
