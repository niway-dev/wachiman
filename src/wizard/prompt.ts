/**
 * Prompts on `node:readline` (design section 6): one question at a time, no dependency (ADR 0002).
 * `select`, `text` and `confirm` print their default, take Enter as that default, and return `null`
 * when the person cancels with Escape, Ctrl-C or Ctrl-D.
 *
 * On a real terminal (stdin and the prompt output are both TTYs) the session is "fancy": steps get
 * a marker, `select` becomes an arrow-key menu with a highlighted row (numbers still move the
 * highlight, see `./keys.ts`), and the session can play the intro, show a spinner and close with a
 * "Next steps" box. Everywhere else, and for every test that feeds lines, the output is the plain
 * numbered list and one-line questions, byte for byte.
 *
 * The streams are injectable. A test feeds the lines a person would type; on a real terminal the
 * input is a TTY, Escape and Ctrl-C come as key events, and Ctrl-D ends the input. On a piped
 * stream a line that is only Escape (U+001B) or Ctrl-C (U+0003) cancels as well, which is how a
 * script says it.
 */
import { createInterface, emitKeypressEvents, type Interface } from "node:readline";
import { playIntro } from "./intro";
import { reduceSelect } from "./keys";
import { describeCommand, fit, renderBox, stripAnsi, symbols, terminalStyle, type NextStepSink, type Tone } from "./style";

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

export interface Prompter extends NextStepSink {
  /** Numbered list; Enter takes `defaultIndex` (0-based), which is printed with `(default)`. On a terminal: an arrow-key menu that starts on it. */
  select<T>(label: string, choices: Choice<T>[], defaultIndex: number): Promise<T | null>;
  /** `defaultValue` is printed in brackets and taken on Enter; `validate` returns an error text, or undefined when valid. Asks again until valid or cancelled. */
  text(label: string, defaultValue: string | undefined, validate?: (value: string) => string | undefined): Promise<string | null>;
  confirm(label: string, defaultYes: boolean): Promise<boolean | null>;
  /** Prints a line to the prompt output (a preview, a summary, an error). */
  say(line: string, tone?: Tone): void;
  /** A stage can start before the route (and therefore the total) is known. */
  step(label: string, index: number, total?: number): void;
  /** True when stdin and the prompt output are both terminals. Only then are the extras below active. */
  readonly fancy: boolean;
  /** The police-car intro, or its one-line header. Does nothing without a terminal. A Ctrl-C during it cancels the next question. */
  intro(version: string): Promise<void>;
  /** Runs slow work behind a spinner line that ends in a check mark (or a warning when `ok` says the result is bad). Without a terminal it only runs the work. The spinner turns only while `work` yields to the event loop; a synchronous `work` shows its first frame, then the check mark. */
  task<T>(label: string, work: () => T | Promise<T>, ok?: (result: T) => boolean): Promise<T>;
  /** A closing step that is more than one command, for the "Next steps" box printed by `close`. */
  nextAction(note: string, commands?: string[]): void;
  /** Gives the terminal back (raw mode off, input paused) so a child process can use it; the next question takes it again. Typed-ahead answers are kept. */
  suspend(): void;
  /** Ends the session: prints the "Next steps" box when there is one, then `suspend`. */
  close(): void;
}

const CANCEL_LINES = new Set(["\u001b", "\u0003", "\u0004"]);

type Terminal = NodeJS.ReadableStream & { isTTY?: boolean; isRaw?: boolean; setRawMode?: (mode: boolean) => unknown };
type TerminalOut = NodeJS.WritableStream & { isTTY?: boolean; columns?: number };

export function createPrompter(io: PromptIO, env: Record<string, string | undefined> = process.env): Prompter {
  const paint = terminalStyle(io.output as { isTTY?: boolean }, env);
  const sym = symbols(env);
  const input = io.input as Terminal;
  const output = io.output as TerminalOut;
  // readline's cursor editing also emits ANSI; a redirected prompt output must
  // stay plain even when stdin itself is still a terminal.
  const terminal = input.isTTY === true && output.isTTY === true;
  const fancy = terminal;
  const canRaw = terminal && typeof input.setRawMode === "function";
  const queue: string[] = [];
  const next: { note: string; commands: string[] }[] = [];
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
  /** A question on a terminal: a marker, the label, and the default or answers in dim text. */
  const question = (label: string, hint: string, colon: boolean) =>
    fancy ? `${paint("?", "accent")} ${paint(label, "strong")}${hint ? ` ${paint(hint, "muted")}` : ""}${colon ? ":" : ""} ` : `${label}${hint ? ` ${hint}` : ""}${colon ? ":" : ""} `;

  /** The one line an answered question collapses to: a check mark, the question and the answer. The answer keeps its room; the question gives way first (at least 12 columns), then the answer. */
  const summary = (label: string, answer: string, ok: boolean) => {
    const width = Math.max(20, (output.columns ?? 80) - 1);
    const room = width - 4 - [...answer].length;
    const [shortLabel, shown] = room >= 12 ? [fit(label, room), answer] : [fit(label, 12), fit(answer, Math.max(4, width - 4 - 12))];
    return `${ok ? paint(sym.done, "success") : paint("-", "muted")} ${shortLabel}  ${paint(shown, ok ? "accent" : "muted")}`;
  };
  /** On a terminal, replaces the question and the answer the person just typed (as many rows as they filled) with the summary line. */
  const settle = (asked: string, typed: string, label: string, answer: string) => {
    if (!fancy) return;
    const rows = Math.max(1, Math.ceil(([...stripAnsi(asked)].length + [...typed].length) / Math.max(20, output.columns ?? 80)));
    output.write(`\x1b[${rows}A\x1b[J${summary(label, answer, true)}\n`);
  };

  /** The numbered list and `Choice [n]:` line: used without a terminal, with typed-ahead input, and when raw mode is missing. */
  async function numberedSelect<T>(label: string, choices: Choice<T>[], defaultIndex: number): Promise<T | null> {
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
  }

  /** The arrow-key menu: raw mode, one repaint per key, collapsed to a single line when answered. */
  function arrowSelect<T>(label: string, choices: Choice<T>[], defaultIndex: number): Promise<T | null> {
    suspend();
    emitKeypressEvents(input);
    const wasRaw = input.isRaw === true;
    const width = Math.max(20, (output.columns ?? 80) - 1);
    const hint = `↑/↓ move · enter select${choices.length > 1 ? ` · 1-${choices.length} jump` : ""} · esc cancel`;
    const lines = (index: number) => {
      const rows = [`${paint("?", "accent")} ${paint(fit(label, width - 2), "strong")}`];
      choices.forEach((c, i) => {
        const text = fit(`${i === index ? sym.pointer : " "} ${i + 1}. ${c.label}`, width - 2);
        rows.push(`  ${i === index ? paint(text, "highlight") : text}`);
        if (c.description) rows.push(`       ${paint(fit(c.description, width - 7), "muted")}`);
      });
      rows.push(`  ${paint(fit(hint, width - 2), "muted")}`);
      return rows;
    };
    let shown = 0;
    const draw = (rows: string[]) => {
      output.write(`${shown > 0 ? `\x1b[${shown}A\x1b[J` : ""}${rows.map((r) => `${r}\n`).join("")}`);
      shown = rows.length;
    };
    return new Promise((resolve) => {
      let state = { index: defaultIndex, typed: "", count: choices.length };
      const finish = (picked: number | null) => {
        input.off("keypress", onChoiceKey);
        input.off("end", onEnd);
        input.setRawMode!(wasRaw);
        input.pause();
        // Collapse the menu to one line: the question and the answer, or the question alone.
        draw([summary(label, picked === null ? "(cancelled)" : choices[picked].label, picked !== null)]);
        output.write("\x1b[?25h");
        if (picked === null) cancelled = true;
        resolve(picked === null ? null : choices[picked].value);
      };
      const onChoiceKey = (text: string, key?: { name?: string; ctrl?: boolean; sequence?: string }) => {
        const result = reduceSelect(state, text, key);
        state = result.state;
        if (result.outcome === "submit") return finish(state.index);
        if (result.outcome === "cancel") return finish(null);
        draw(lines(state.index));
      };
      const onEnd = () => finish(null);
      input.setRawMode!(true);
      input.on("keypress", onChoiceKey);
      input.once("end", onEnd);
      input.resume();
      output.write("\x1b[?25l");
      draw(lines(defaultIndex));
    });
  }

  const stepLabel = (label: string, index: number, total?: number) =>
    fancy ? `\n${paint(`${sym.step} ${label}`, "highlight")}  ${paint(`step ${index}${total === undefined ? "" : ` of ${total}`}`, "muted")}` : `\nStep ${index}${total === undefined ? "" : `/${total}`}  ${label}`;

  const prompter: Prompter = {
    say,
    fancy,
    step(label, index, total) {
      say(stepLabel(label, index, total), fancy ? undefined : "accent");
    },
    suspend,
    close() {
      if (fancy && next.length > 0) {
        const rows = next.flatMap((n, i) => [
          { text: `${i + 1}. ${n.note}`, tone: "strong" as Tone },
          ...n.commands.map((c) => ({ text: `     ${c}`, tone: "accent" as Tone })),
        ]);
        io.output.write(`\n${renderBox("Next steps", rows, output.columns ?? 80, env, paint).join("\n")}\n`);
      }
      next.length = 0;
      suspend();
    },
    nextStep(command, note) {
      next.push({ note: note ? note[0].toUpperCase() + note.slice(1) : describeCommand(command), commands: [command] });
    },
    nextAction(note, commands = []) {
      next.push({ note, commands });
    },
    async intro(version) {
      // A caller that already played it (the launcher, before it dispatches) marks the environment.
      if (!fancy || env.WACHIMAN_INTRO_DONE) return;
      suspend();
      const result = await playIntro({ term: { input, output }, env, version });
      if (result === "interrupted") {
        io.output.write("\n");
        cancelled = true;
      }
    },
    async task(label, work, ok) {
      if (!fancy) return work();
      suspend();
      const frames = sym.spinner;
      let frame = 0;
      const line = (mark: string) => `\r\x1b[2K${mark} ${label}`;
      output.write(`\x1b[?25l${line(paint(frames[0], "accent"))}…`);
      const timer = setInterval(() => output.write(`${line(paint(frames[++frame % frames.length], "accent"))}…`), 80);
      let result: T | undefined;
      let good = false;
      try {
        result = await work();
        good = ok ? ok(result) : true;
        return result;
      } finally {
        clearInterval(timer);
        output.write(`${line(good ? paint(sym.done, "success") : paint(sym.warn, "warning"))}\n\x1b[?25h`);
      }
    },
    async select(label, choices, defaultIndex) {
      if (canRaw && cancelled) return null; // an earlier Ctrl-C (also during the intro) ends the whole session
      if (canRaw && queue.length === 0 && !ended) return arrowSelect(label, choices, defaultIndex);
      return numberedSelect(label, choices, defaultIndex);
    },
    async text(label, defaultValue, validate) {
      for (;;) {
        const hint = defaultValue !== undefined && defaultValue !== "" ? `[${defaultValue}]` : "";
        const asked = question(label, hint, true);
        const line = await ask(asked);
        if (line === null) return null;
        const answer = line.trim() === "" && defaultValue !== undefined ? defaultValue : line.trim();
        const problem = validate?.(answer);
        if (problem === undefined) {
          settle(asked, line, label, answer);
          return answer;
        }
        say(problem, "error");
      }
    },
    async confirm(label, defaultYes) {
      for (;;) {
        const asked = question(label, defaultYes ? "[Y/n]" : "[y/N]", false);
        const line = await ask(asked);
        if (line === null) return null;
        const answer = line.trim().toLowerCase();
        const decided = answer === "" ? defaultYes : answer === "y" || answer === "yes" ? true : answer === "n" || answer === "no" ? false : undefined;
        if (decided !== undefined) {
          settle(asked, line, label, decided ? "yes" : "no");
          return decided;
        }
        say("Answer y or n.", "error");
      }
    },
  };
  return prompter;
}
