/**
 * The seam between the prompt wrapper (`./prompt.ts`) and Clack (`@clack/prompts`). `Ui` is the small
 * surface the wrapper needs; `loadUi` implements it over Clack, loaded with a dynamic `import()` so
 * that nothing outside a person's terminal session ever loads the package (ADR 0002, amendment
 * 2026-11-13). A test passes its own `Ui` and scripts the answers, with no terminal involved.
 *
 * Answers are option indexes, never the caller's values: a value may be a symbol or an object, and
 * Clack compares and prints values. A cancelled prompt (Escape, Ctrl-C) is `null`.
 */

export interface UiOption {
  /** The index of the choice in the caller's list. */
  value: number;
  label: string;
  hint?: string;
  /** Shown but not pickable. */
  disabled?: boolean;
}

export type LogKind = "message" | "info" | "success" | "warn" | "error" | "step";

export interface UiSpinner {
  start(message: string): void;
  /** Ends the line with a check mark. */
  stop(message: string): void;
  /** Ends the line as needing attention. */
  fail(message: string): void;
}

export interface Ui {
  intro(title: string): void;
  outro(message: string): void;
  cancel(message: string): void;
  select(o: { message: string; options: UiOption[]; initial: number }): Promise<number | null>;
  /** A list the person filters by typing. */
  autocomplete(o: { message: string; options: UiOption[]; initial: number; placeholder?: string }): Promise<number | null>;
  /** `validate` gets the typed text; an empty answer with a `defaultValue` is validated as that default. */
  text(o: { message: string; placeholder?: string; defaultValue?: string; validate: (value: string) => string | undefined }): Promise<string | null>;
  confirm(o: { message: string; initial: boolean }): Promise<boolean | null>;
  note(message: string, title?: string): void;
  log(kind: LogKind, message: string): void;
  spinner(): UiSpinner;
}

export interface UiStreams {
  input: NodeJS.ReadableStream;
  /** stderr: prompts never go to stdout, which belongs to a command's result. */
  output: NodeJS.WritableStream;
}

export async function loadUi(streams: UiStreams): Promise<Ui> {
  const clack = await import("@clack/prompts");
  const io = { input: streams.input as NodeJS.ReadStream, output: streams.output as NodeJS.WriteStream };
  const answer = <T>(value: T | symbol): T | null => (clack.isCancel(value) ? null : (value as T));
  return {
    intro: (title) => clack.intro(title, io),
    outro: (message) => clack.outro(message, io),
    cancel: (message) => clack.cancel(message, io),
    select: async (o) => answer(await clack.select<number>({ message: o.message, options: o.options, initialValue: o.initial, ...io })),
    autocomplete: async (o) =>
      answer(await clack.autocomplete<number>({ message: o.message, options: o.options, initialValue: o.initial, placeholder: o.placeholder, maxItems: 8, ...io })),
    text: async (o) =>
      answer(
        await clack.text({
          message: o.message,
          placeholder: o.placeholder,
          defaultValue: o.defaultValue,
          validate: (value) => o.validate(value === undefined || (value.trim() === "" && o.defaultValue !== undefined) ? (o.defaultValue ?? "") : value.trim()),
          ...io,
        }),
      ),
    confirm: async (o) => answer(await clack.confirm({ message: o.message, initialValue: o.initial, ...io })),
    note: (message, title) => clack.note(message, title, io),
    log: (kind, message) => clack.log[kind](message, io),
    spinner: () => {
      const s = clack.spinner(io);
      return { start: (m) => s.start(m), stop: (m) => s.stop(m), fail: (m) => s.error(m) };
    },
  };
}
