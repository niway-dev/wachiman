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
import { createInterface, emitKeypressEvents } from "node:readline";

export interface PromptIO {
  input: NodeJS.ReadableStream;
  /** stderr: prompts never go to stdout, which belongs to a command's result. */
  output: NodeJS.WritableStream;
}

export interface Choice<T> {
  label: string;
  value: T;
}

export interface Prompter {
  /** Numbered list; Enter takes `defaultIndex` (0-based), which is printed with `(default)`. */
  select<T>(label: string, choices: Choice<T>[], defaultIndex: number): Promise<T | null>;
  /** `defaultValue` is printed in brackets and taken on Enter; `validate` returns an error text, or undefined when valid. Asks again until valid or cancelled. */
  text(label: string, defaultValue: string | undefined, validate?: (value: string) => string | undefined): Promise<string | null>;
  confirm(label: string, defaultYes: boolean): Promise<boolean | null>;
  /** Prints a line to the prompt output (a preview, a summary, an error). */
  say(line: string): void;
  close(): void;
}

const CANCEL_LINES = new Set(["\u001b", "\u0003", "\u0004"]);

export function createPrompter(io: PromptIO): Prompter {
  const terminal = (io.input as { isTTY?: boolean }).isTTY === true;
  const rl = createInterface({ input: io.input, ...(terminal ? { output: io.output } : {}), terminal, crlfDelay: Infinity });
  rl.setPrompt("");
  const queue: string[] = [];
  let waiter: ((line: string | null) => void) | undefined;
  let ended = false;
  let cancelled = false;

  const cancel = () => {
    cancelled = true;
    const w = waiter;
    waiter = undefined;
    w?.(null);
  };
  rl.on("line", (line) => {
    if (waiter) {
      const w = waiter;
      waiter = undefined;
      w(line);
    } else queue.push(line);
  });
  rl.on("close", () => {
    ended = true;
    if (waiter) cancel();
  });
  rl.on("SIGINT", () => {
    io.output.write("\n");
    cancel();
  });
  if (terminal) {
    emitKeypressEvents(io.input, rl);
    io.input.on("keypress", (_text: string, key?: { name?: string }) => {
      if (key?.name === "escape") {
        io.output.write("\n");
        cancel();
      }
    });
  }

  /** The next line the person submits, or null once they cancelled. */
  const nextLine = (): Promise<string | null> => {
    if (cancelled) return Promise.resolve(null);
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
  const say = (line: string) => void io.output.write(`${line}\n`);
  const ask = (question: string) => {
    io.output.write(question);
    return nextLine();
  };

  return {
    say,
    close: () => rl.close(),
    async select(label, choices, defaultIndex) {
      say(label);
      choices.forEach((c, i) => say(`  ${i + 1}. ${c.label}${i === defaultIndex ? " (default)" : ""}`));
      for (;;) {
        const line = await ask(`Choice [${defaultIndex + 1}]: `);
        if (line === null) return null;
        const answer = line.trim();
        if (answer === "") return choices[defaultIndex].value;
        const n = Number(answer);
        if (/^\d+$/.test(answer) && n >= 1 && n <= choices.length) return choices[n - 1].value;
        say(`Enter a number from 1 to ${choices.length}, or press Enter for ${defaultIndex + 1}.`);
      }
    },
    async text(label, defaultValue, validate) {
      for (;;) {
        const line = await ask(defaultValue !== undefined && defaultValue !== "" ? `${label} [${defaultValue}]: ` : `${label}: `);
        if (line === null) return null;
        const answer = line.trim() === "" && defaultValue !== undefined ? defaultValue : line.trim();
        const problem = validate?.(answer);
        if (problem === undefined) return answer;
        say(problem);
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
        say("Answer y or n.");
      }
    },
  };
}
