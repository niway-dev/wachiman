/**
 * A scripted `Ui` for the tests of the terminal session: the answers a person would give, in order
 * (`null` is a cancel), and a record of everything the session drew. No terminal and no Clack.
 */
import type { LogKind, Ui, UiOption } from "../../src/wizard/ui";

export type Event =
  | { kind: "intro"; title: string }
  | { kind: "outro"; message: string }
  | { kind: "cancel"; message: string }
  | { kind: "select" | "autocomplete"; message: string; options: UiOption[]; initial: number }
  | { kind: "text"; message: string; placeholder?: string; defaultValue?: string }
  | { kind: "confirm"; message: string; initial: boolean }
  | { kind: "note"; message: string; title?: string }
  | { kind: "log"; level: LogKind; message: string }
  | { kind: "spinner"; action: "start" | "stop" | "fail"; message: string };

export interface FakeUi extends Ui {
  events: Event[];
  /** The events of one kind, in order. */
  of: <K extends Event["kind"]>(kind: K) => Extract<Event, { kind: K }>[];
}

/** `answers` are consumed by select, autocomplete, text and confirm in the order they are asked. */
export function fakeUi(answers: (number | string | boolean | null)[] = []): FakeUi {
  const events: Event[] = [];
  const queue = [...answers];
  const take = <T>(): T | null => {
    if (queue.length === 0) throw new Error("the fake Ui ran out of answers");
    return queue.shift() as T | null;
  };
  return {
    events,
    of: (kind) => events.filter((e) => e.kind === kind) as never,
    intro: (title) => void events.push({ kind: "intro", title }),
    outro: (message) => void events.push({ kind: "outro", message }),
    cancel: (message) => void events.push({ kind: "cancel", message }),
    select: async (o) => (events.push({ kind: "select", ...o }), take<number>()),
    autocomplete: async (o) => (events.push({ kind: "autocomplete", ...o }), take<number>()),
    text: async (o) => {
      events.push({ kind: "text", message: o.message, placeholder: o.placeholder, defaultValue: o.defaultValue });
      // Like Clack: the typed text is validated; a bad one is a problem shown and asked again, which a test models by giving the next answer.
      for (;;) {
        const typed = take<string>();
        if (typed === null) return null;
        const checked = typed.trim() === "" && o.defaultValue !== undefined ? o.defaultValue : typed.trim();
        const problem = o.validate(checked);
        if (problem === undefined) return typed;
        events.push({ kind: "log", level: "error", message: problem });
      }
    },
    confirm: async (o) => (events.push({ kind: "confirm", ...o }), take<boolean>()),
    note: (message, title) => void events.push({ kind: "note", message, title }),
    log: (level, message) => void events.push({ kind: "log", level, message }),
    spinner: () => ({
      start: (message) => void events.push({ kind: "spinner", action: "start", message }),
      stop: (message) => void events.push({ kind: "spinner", action: "stop", message }),
      fail: (message) => void events.push({ kind: "spinner", action: "fail", message }),
    }),
  };
}
