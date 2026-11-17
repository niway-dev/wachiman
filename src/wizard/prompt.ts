/**
 * The prompt wrapper of the wizards (design section 6): `select`, `text` and `confirm` print their
 * default, take Enter as that default, and return `null` when the person cancels.
 *
 * There are two sessions behind one `Prompter`:
 *
 * - On a real terminal (stdin and the prompt output are both TTYs) the session is "fancy" and runs
 *   on Clack (`./prompt-fancy.ts`, through the `Ui` seam in `./ui.ts`): the mascot intro, arrow-key
 *   menus, a spinner, notes and an outro. `openPrompter` loads Clack for it.
 * - Everywhere else, and for every test that feeds lines, the session is the plain one below on
 *   `node:readline`: the numbered list and one-line questions, byte for byte as they always were.
 *   No prompt, color or animation is ever drawn outside a terminal.
 *
 * The streams are injectable. A test feeds the lines a person would type; a piped line that is only
 * Escape (U+001B) or Ctrl-C (U+0003) cancels, which is how a script says it, and so does the stream
 * ending (Ctrl-D). A test of the fancy session passes its own `Ui` and scripts the answers.
 */
import { createInterface, type Interface } from "node:readline";
import { createFancyPrompter, usableDefault } from "./prompt-fancy";
import { terminalStyle, type NextStepSink, type Tone } from "./style";
import { loadUi, type Ui } from "./ui";

export interface PromptIO {
  input: NodeJS.ReadableStream;
  /** stderr: prompts never go to stdout, which belongs to a command's result. */
  output: NodeJS.WritableStream;
}

export interface Choice<T> {
  label: string;
  value: T;
  description?: string;
  /** Shown with "(coming soon)" and never pickable. A default index never lands on one. */
  disabled?: boolean;
}

export type Outcome = "done" | "cancelled" | "failed";

export interface Prompter extends NextStepSink {
  /** Numbered list; Enter takes `defaultIndex` (0-based), which is printed with `(default)`. On a terminal: an arrow-key menu that starts on it. */
  select<T>(label: string, choices: Choice<T>[], defaultIndex: number): Promise<T | null>;
  /** A long list. On a terminal the person types to filter it; without one it is the numbered list of `select`. */
  autocomplete<T>(label: string, choices: Choice<T>[], defaultIndex: number): Promise<T | null>;
  /** `defaultValue` is printed in brackets and taken on Enter; `validate` returns an error text, or undefined when valid. Asks again until valid or cancelled. */
  text(label: string, defaultValue: string | undefined, validate?: (value: string) => string | undefined): Promise<string | null>;
  confirm(label: string, defaultYes: boolean): Promise<boolean | null>;
  /** Prints a line to the prompt output (a preview, a summary, an error). On a terminal it sits inside the session frame; an empty line prints nothing there. */
  say(line: string, tone?: Tone): void;
  /** A boxed block with a title (a summary, a file preview). Without a terminal: the title, then the lines. */
  note(body: string, title?: string): void;
  /** A stage can start before the route (and therefore the total) is known. */
  step(label: string, index: number, total?: number): void;
  /** True when the session is a terminal one. Only then are the extras below active. */
  readonly fancy: boolean;
  /** The chip, "On watch." and Wachi with a line typed out (`line`), or the same scene printed at once. Does nothing without a terminal. A Ctrl-C during it cancels the next question. */
  intro(version: string, line?: string): Promise<void>;
  /** Runs slow work behind a spinner that ends in a check mark (or a warning when `ok` says the result is bad). Without a terminal it only runs the work. The spinner turns only while `work` yields to the event loop. */
  task<T>(label: string, work: () => T | Promise<T>, ok?: (result: T) => boolean): Promise<T>;
  /** A closing step that is more than one command, for the "Next steps" note printed by `close`. */
  nextAction(note: string, commands?: string[]): void;
  /** Gives the terminal back (raw mode off, input paused) so a child process can use it; the next question takes it again. Typed-ahead answers are kept. */
  suspend(): void;
  /** Ends the session: the "Next steps" note when there is one, then the outro (or the cancel line), then `suspend`. Only the first call prints. */
  close(outcome?: Outcome, message?: string): void;
}

type Terminal = NodeJS.ReadableStream & { isTTY?: boolean };
type TerminalOut = NodeJS.WritableStream & { isTTY?: boolean };

/** Stdin and the prompt output are both terminals. */
export const isTerminal = (io: PromptIO) => (io.input as Terminal).isTTY === true && (io.output as TerminalOut).isTTY === true;

/**
 * The session for a command that opens one: a fancy one (Clack loaded here) on a terminal, the
 * plain one anywhere else. `deps.ui` replaces Clack, for a test.
 */
export async function openPrompter(io: PromptIO, env: Record<string, string | undefined> = process.env, deps: { ui?: Ui } = {}): Promise<Prompter> {
  if (deps.ui) return createPrompter(io, env, deps.ui);
  return isTerminal(io) ? createPrompter(io, env, await loadUi(io)) : createPrompter(io, env);
}

const CANCEL_LINES = new Set(["\u001b", "\u0003", "\u0004"]);

/** The plain session, or the fancy one when a `Ui` is given. */
export function createPrompter(io: PromptIO, env: Record<string, string | undefined> = process.env, ui?: Ui): Prompter {
  if (ui) return createFancyPrompter(io, env, ui);
  const paint = terminalStyle(io.output as { isTTY?: boolean }, env);
  const queue: string[] = [];
  let rl: Interface | undefined;
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

  const open = () => {
    if (rl) return;
    const mine = createInterface({ input: io.input, terminal: false, crlfDelay: Infinity });
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
  };
  const suspend = () => {
    const mine = rl;
    if (!mine) return;
    rl = undefined;
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
    io.output.write(question);
    return nextLine();
  };

  /** The numbered list and `Choice [n]:` line. A disabled choice is listed but cannot be picked. */
  async function numberedSelect<T>(label: string, choices: Choice<T>[], requestedDefault: number): Promise<T | null> {
    const defaultIndex = usableDefault(choices, requestedDefault);
    say(label, "accent");
    choices.forEach((c, i) => {
      if (c.disabled) {
        say(`  ${i + 1}. ${c.label} (coming soon)`, "muted");
        return;
      }
      say(`  ${i + 1}. ${c.label}${i === defaultIndex ? " (default)" : ""}`, i === defaultIndex ? "accent" : undefined);
      if (c.description) say(`     ${c.description}`, "muted");
    });
    for (;;) {
      const line = await ask(`Choice [${defaultIndex + 1}]: `);
      if (line === null) return null;
      const answer = line.trim();
      if (answer === "") return choices[defaultIndex].value;
      const n = Number(answer);
      if (/^\d+$/.test(answer) && n >= 1 && n <= choices.length) {
        if (choices[n - 1].disabled) {
          say(`Option ${n} is not available yet. Pick another number, or press Enter for ${defaultIndex + 1}.`, "error");
          continue;
        }
        return choices[n - 1].value;
      }
      say(`Enter a number from 1 to ${choices.length}, or press Enter for ${defaultIndex + 1}.`, "error");
    }
  }

  return {
    say,
    fancy: false,
    step(label, index, total) {
      say(`\nStep ${index}${total === undefined ? "" : `/${total}`}  ${label}`, "accent");
    },
    note(body, title) {
      if (title) say(title, "accent");
      for (const line of body.split("\n")) say(`  ${line}`);
    },
    suspend,
    close() {
      suspend();
    },
    // The plain session keeps its closing `next:` lines as they were printed; only a terminal session gathers them into a note.
    nextStep() {},
    nextAction() {},
    async intro() {},
    async task(_label, work) {
      return work();
    },
    select: numberedSelect,
    autocomplete: numberedSelect,
    async text(label, defaultValue, validate) {
      for (;;) {
        const hint = defaultValue !== undefined && defaultValue !== "" ? `[${defaultValue}]` : "";
        const line = await ask(`${label}${hint ? ` ${hint}` : ""}: `);
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
        const decided = answer === "" ? defaultYes : answer === "y" || answer === "yes" ? true : answer === "n" || answer === "no" ? false : undefined;
        if (decided !== undefined) return decided;
        say("Answer y or n.", "error");
      }
    },
  };
}
