/**
 * The names of the colors the terminal UI uses, with no import: `src/help.ts` and `src/cli.ts` take
 * these types without loading `chalk`. The painter that turns a tone into escape codes is
 * `terminalStyle` in `./style.ts`.
 */
export type Tone = "accent" | "muted" | "success" | "warning" | "error" | "strong" | "highlight" | "brand";

/** Paints plain text in a tone; the identity function when the output has no color. */
export type Paint = (text: string, tone: Tone) => string;

export const plain: Paint = (text) => text;
