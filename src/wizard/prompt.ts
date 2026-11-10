/**
 * Plain prompts on `node:readline` (design section 6): one question at a time, no repaint, no
 * dependency (ADR 0002). `select`, `text` and `confirm` print their default, take Enter as that
 * default, and return `null` when the person cancels with Escape, Ctrl-C or Ctrl-D.
 *
 * The streams are injectable. A test feeds the lines a person would type; on a real terminal the
 * input is a TTY, Escape and Ctrl-C come as key events, and Ctrl-D ends the input. On a piped
 * stream a line that is only Escape (U+001B) or Ctrl-C (U+0003) cancels as well, which is how a
 * script says it.
 */
import { createInterface, emitKeypressEvents, type Interface } from "node:readline";
import { terminalStyle, type Tone } from "./style";

export interface PromptIO {
  input: NodeJS.ReadableStream;
  /** stderr: prompts never go to stdout, which belongs to a command's result. */
  output: NodeJS.WritableStream;
}

export interface Choice<T> {
  label: string;
  value: T;
  description?: string;
}

export interface Prompter {
  /** Numbered list; Enter takes `defaultIndex` (0-based), which is printed with `(default)`. */
  select<T>(label: string, choices: Choice<T>[], defaultIndex: number): Promise<T | null>;
  /** `defaultValue` is printed in brackets and taken on Enter; `validate` returns an error text, or undefined when valid. Asks again until valid or cancelled. */
  text(label: string, defaultValue: string | undefined, validate?: (value: string) => string | undefined): Promise<string | null>;
  confirm(label: string, defaultYes: boolean): Promise<boolean | null>;
  /** Prints a line to the prompt output (a preview, a summary, an error). */
  say(line: string, tone?: Tone): void;
  /** A stage can start before the route (and therefore the total) is known. */
  step(label: string, index: number, total?: number): void;
  /** Gives the terminal back (raw mode off, input paused) so a child process can use it; the next question takes it again. Typed-ahead answers are kept. */
  suspend(): void;
  close(): void;
}

const CANCEL_LINES = new Set(["\u001b", "\u0003", "\u0004"]);

export function createPrompter(io: PromptIO, env: Record<string, string | undefined> = process.env): Prompter {
  const paint = terminalStyle(io.output as { isTTY?: boolean }, env);
  const terminal = (io.input as { isTTY?: boolean }).isTTY === true;
  const queue: string[] = [];
  let rl: Interface | undefined;
  let onKey: ((text: string, key?: { name?: string }) => void) | undefined;
  let waiter: ((line: string | null) => void) | undefined;
  let ended = false;
  let cancelled = false;

  const cancel = () => {
    cancelled = true;
    const w = waiter;
    waiter = undefined;
    w?.(null);
  };
  // The stream itself ending (a script that ran out, a closed pipe) is Ctrl-D whether or not a reader is attached.
  io.input.once("end", () => {
    ended = true;
    if (waiter) cancel();
  });

  /** The terminal belongs to the prompts only while a question is open; a child that needs it calls `suspend` first. */
  const open = () => {
    if (rl) return;
    const mine = createInterface({ input: io.input, ...(terminal ? { output: io.output } : {}), terminal, crlfDelay: Infinity });
    rl = mine;
    mine.on("line", (line) => {
      if (waiter) {
        const w = waiter;
        waiter = undefined;
        w(line);
      } else queue.push(line);
    });
    mine.on("close", () => {
      if (rl !== mine) return; // closed by `suspend`, not by the person
      ended = true;
      if (waiter) cancel();
    });
    mine.on("SIGINT", () => {
      io.output.write("\n");
      cancel();
    });
    if (terminal) {
      emitKeypressEvents(io.input, mine);
      onKey = (_text, key) => {
        if (key?.name === "escape") {
          io.output.write("\n");
          cancel();
        }
      };
      io.input.on("keypress", onKey);
    }
  };
  const suspend = () => {
    const mine = rl;
    if (!mine) return;
    rl = undefined;
    if (onKey) io.input.off("keypress", onKey);
    onKey = undefined;
    mine.close();
  };

  /** The next line the person submits, or null once they cancelled. */
  const nextLine = (): Promise<string | null> => {
    if (cancelled) return Promise.resolve(null);
    open();
    const queued = queue.shift();
    if (queued !== undefined) {
      if (CANCEL_LINES.has(queued.trim())) {
        cancelled = true;
        return Promise.resolve(null);
      }
      return Promise.resolve(queued);
    }
    if (ended) {
      cancelled = true;
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      waiter = (line) => {
        if (line !== null && CANCEL_LINES.has(line.trim())) {
          cancelled = true;
          resolve(null);
        } else resolve(line);
      };
    });
  };
  const say = (line: string, tone?: Tone) => void io.output.write(`${tone ? paint(line, tone) : line}\n`);
  const ask = (question: string) => {
    open();
    // On a terminal readline owns the prompt, so its line refresh (Backspace, cursor keys) redraws the question too.
    if (terminal && rl) {
      rl.setPrompt(question);
      rl.prompt();
    } else io.output.write(question);
    return nextLine();
  };

  return {
    say,
    step(label, index, total) {
      say(`\nStep ${index}${total === undefined ? "" : `/${total}`}  ${label}`, "accent");
    },
    suspend,
    close: suspend,
    async select(label, choices, defaultIndex) {
      say(label, "accent");
      choices.forEach((c, i) => {
        say(`  ${i + 1}. ${c.label}${i === defaultIndex ? " (default)" : ""}`, i === defaultIndex ? "accent" : undefined);
        if (c.description) say(`     ${c.description}`, "muted");
      });
      for (;;) {
        const line = await ask(`Choice [${defaultIndex + 1}]: `);
        if (line === null) return null;
        const answer = line.trim();
        if (answer === "") return choices[defaultIndex].value;
        const n = Number(answer);
        if (/^\d+$/.test(answer) && n >= 1 && n <= choices.length) return choices[n - 1].value;
        say(`Enter a number from 1 to ${choices.length}, or press Enter for ${defaultIndex + 1}.`, "error");
      }
    },
    async text(label, defaultValue, validate) {
      for (;;) {
        const line = await ask(defaultValue !== undefined && defaultValue !== "" ? `${label} [${defaultValue}]: ` : `${label}: `);
        if (line === null) return null;
        const answer = line.trim() === "" && defaultValue !== undefined ? defaultValue : line.trim();
        const problem = validate?.(answer);
        if (problem === undefined) return answer;
        say(problem, "error");
      }
    },
    async confirm(label, defaultYes) {
      for (;;) {
        const line = await ask(`${label} ${defaultYes ? "[Y/n]" : "[y/N]"} `);
        if (line === null) return null;
        const answer = line.trim().toLowerCase();
        if (answer === "") return defaultYes;
        if (answer === "y" || answer === "yes") return true;
        if (answer === "n" || answer === "no") return false;
        say("Answer y or n.", "error");
      }
    },
  };
}
