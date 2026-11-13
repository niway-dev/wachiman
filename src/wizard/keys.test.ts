import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { emitKeypressEvents } from "node:readline";
import { reduceSelect, type KeyEvent, type SelectState } from "./keys";

const at = (index: number, count = 4, typed = ""): SelectState => ({ index, count, typed });
const press = (state: SelectState, name: string, text?: string, extra: Partial<KeyEvent> = {}) => reduceSelect(state, text, { name, ...extra });

/** What a terminal sends for a key, decoded by the same function the prompts use. */
async function decode(bytes: string): Promise<{ text?: string; name?: string; ctrl?: boolean }[]> {
  const input = new PassThrough();
  emitKeypressEvents(input);
  const seen: { text?: string; name?: string; ctrl?: boolean }[] = [];
  input.on("keypress", (text, key) => seen.push({ text, name: key?.name, ctrl: key?.ctrl }));
  input.write(bytes);
  await new Promise((r) => setTimeout(r, 5));
  return seen;
}

describe("what the terminal sends", () => {
  test("arrow sequences decode to up, down, home and end", async () => {
    expect((await decode("\x1b[A"))[0].name).toBe("up");
    expect((await decode("\x1b[B"))[0].name).toBe("down");
    expect((await decode("\x1b[H"))[0].name).toBe("home");
    expect((await decode("\x1b[F"))[0].name).toBe("end");
    expect((await decode("\x1bOA"))[0].name).toBe("up"); // application cursor mode
  });

  test("Enter, Ctrl-C and a digit decode as the reducer expects", async () => {
    expect((await decode("\r"))[0].name).toBe("return");
    expect((await decode("\u0003"))[0]).toMatchObject({ name: "c", ctrl: true });
    expect((await decode("2"))[0].text).toBe("2");
  });
});

describe("reduceSelect", () => {
  test("down and up move the highlight and wrap at both ends", () => {
    expect(press(at(0), "down").state.index).toBe(1);
    expect(press(at(3), "down").state.index).toBe(0);
    expect(press(at(0), "up").state.index).toBe(3);
    expect(press(at(2), "up").state.index).toBe(1);
  });

  test("home and end jump to the first and last row", () => {
    expect(press(at(2), "home").state.index).toBe(0);
    expect(press(at(1), "end").state.index).toBe(3);
  });

  test("Enter confirms the highlighted row, and moving never confirms", () => {
    expect(press(at(2), "return").outcome).toBe("submit");
    expect(press(at(2), "enter").outcome).toBe("submit");
    expect(press(at(2), "down").outcome).toBe("none");
  });

  test("Escape, Ctrl-C and Ctrl-D cancel", () => {
    expect(press(at(1), "escape").outcome).toBe("cancel");
    expect(press(at(1), "c", undefined, { ctrl: true }).outcome).toBe("cancel");
    expect(press(at(1), "d", undefined, { ctrl: true }).outcome).toBe("cancel");
  });

  test("a plain c or d is not a cancellation", () => {
    expect(press(at(1), "c", "c").outcome).toBe("none");
  });

  test("a number moves the highlight to that row but does not confirm it", () => {
    const r = reduceSelect(at(0), "3", { name: "3" });
    expect(r.state.index).toBe(2);
    expect(r.outcome).toBe("none");
  });

  test("a number beyond the list is ignored", () => {
    expect(reduceSelect(at(1), "9", { name: "9" }).state.index).toBe(1);
    expect(reduceSelect(at(1), "0", { name: "0" }).state.index).toBe(1);
  });

  test("a list longer than nine takes two digits, and a second digit that does not fit starts over", () => {
    const one = reduceSelect(at(0, 12), "1", { name: "1" });
    expect(one.state.index).toBe(0);
    const twelve = reduceSelect(one.state, "2", { name: "2" });
    expect(twelve.state.index).toBe(11);
    const restarted = reduceSelect(twelve.state, "3", { name: "3" });
    expect(restarted.state.index).toBe(2);
  });

  test("moving with the arrows forgets the digits typed", () => {
    const typed = reduceSelect(at(0, 12), "1", { name: "1" }).state;
    expect(press(typed, "down").state.typed).toBe("");
  });

  test("other keys change nothing", () => {
    const s = at(2);
    expect(reduceSelect(s, "x", { name: "x" })).toEqual({ state: s, outcome: "none" });
    expect(reduceSelect(s, undefined, undefined)).toEqual({ state: s, outcome: "none" });
  });
});
