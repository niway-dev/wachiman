/**
 * A scripted terminal for the wizard tests: the lines a person would type, in order, and
 * everything the prompts print. No TTY is involved; the prompt module reads the stream as lines.
 */
import { PassThrough, Writable } from "node:stream";
import type { PromptIO } from "../../src/wizard/prompt";

/** What a person's keys turn into on a piped stream: Escape and Ctrl-C are lines of their own. */
export const ESC = "\u001b";
export const CTRL_C = "\u0003";

export interface Scripted extends PromptIO {
  /** Everything the prompts printed, as one string. */
  printed: () => string;
}

/** `lines` are fed in order; the stream then ends, which is what Ctrl-D does. */
export function scripted(lines: string[]): Scripted {
  const input = new PassThrough();
  let out = "";
  const output = new Writable({
    write(chunk, _enc, done) {
      out += chunk.toString();
      done();
    },
  });
  input.end(lines.map((l) => `${l}\n`).join(""));
  return { input, output, printed: () => out };
}
