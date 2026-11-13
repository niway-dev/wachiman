/**
 * Key handling of the arrow-key menu, as a pure function so it can be tested without a terminal.
 * The input is what `readline.emitKeypressEvents` gives: the typed text and a key description.
 *
 * Up and Down move the highlight (wrapping at both ends), Home and End jump to the first and last
 * row, a number moves the highlight to that row (two digits for a list longer than nine), Enter
 * confirms, and Escape, Ctrl-C and Ctrl-D cancel. A number never confirms by itself: the Enter that
 * people type after it would otherwise fall through to the next question.
 */
export interface KeyEvent {
  name?: string;
  ctrl?: boolean;
  sequence?: string;
}

export interface SelectState {
  index: number;
  /** The digits typed so far, "" when none. */
  typed: string;
  count: number;
}

export type SelectOutcome = "none" | "submit" | "cancel";

export function reduceSelect(state: SelectState, text: string | undefined, key: KeyEvent | undefined): { state: SelectState; outcome: SelectOutcome } {
  const stay = (patch: Partial<SelectState> = {}): { state: SelectState; outcome: SelectOutcome } => ({ state: { ...state, ...patch }, outcome: "none" });
  const name = key?.name;
  if (key?.ctrl && (name === "c" || name === "d")) return { state, outcome: "cancel" };
  if (name === "escape") return { state, outcome: "cancel" };
  if (name === "return" || name === "enter") return { state, outcome: "submit" };
  if (name === "up") return stay({ index: (state.index - 1 + state.count) % state.count, typed: "" });
  if (name === "down") return stay({ index: (state.index + 1) % state.count, typed: "" });
  if (name === "home") return stay({ index: 0, typed: "" });
  if (name === "end") return stay({ index: state.count - 1, typed: "" });
  if (name === "backspace") return stay({ typed: "" });
  const digit = text !== undefined && /^[0-9]$/.test(text) ? text : undefined;
  if (digit !== undefined) {
    const valid = (s: string) => /^[1-9][0-9]*$/.test(s) && Number(s) <= state.count;
    const typed = valid(state.typed + digit) ? state.typed + digit : valid(digit) ? digit : state.typed;
    return typed === state.typed ? stay() : stay({ typed, index: Number(typed) - 1 });
  }
  return stay();
}
