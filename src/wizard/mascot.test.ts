import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { fakeUi } from "../../test/support/fake-ui";
import { canAnimate, chipTitle, DEFAULT_LINE, FACE_INSIDE, mascotScene, NAME, playIntro, SIDE_BY_SIDE_COLUMNS, TYPE_MS } from "./mascot";
import { stripAnsi, terminalStyle } from "./style";
import { plain } from "./tone";

function term(over: { isTTY?: boolean; columns?: number; inputTTY?: boolean } = {}) {
  const output = Object.assign(new PassThrough(), { isTTY: over.isTTY ?? true, columns: over.columns ?? 100 });
  const input = Object.assign(new PassThrough(), {
    isTTY: over.inputTTY ?? true,
    isRaw: false,
    modes: [] as boolean[],
    setRawMode(mode: boolean) {
      this.modes.push(mode);
    },
  });
  let written = "";
  output.on("data", (c) => (written += String(c)));
  return { output, input, written: () => written };
}

describe("the scene", () => {
  test("side by side on a wide terminal: the line is on the eyes row; a narrow one puts it below", () => {
    const wide = mascotScene({ paint: plain, ascii: false, columns: SIDE_BY_SIDE_COLUMNS, message: DEFAULT_LINE });
    expect(wide.top).toEqual(["╭─────────────╮", "│      W      │"]);
    expect(wide.lead).toBe(`│   ◉     ◉   │   ${NAME}: `);
    expect(wide.bottom).toEqual(["│      ‿      │", "╰─────────────╯"]);
    const narrow = mascotScene({ paint: plain, ascii: false, columns: SIDE_BY_SIDE_COLUMNS - 1, message: DEFAULT_LINE });
    expect(narrow.top).toEqual(["╭─────────────╮", "│      W      │", "│   ◉     ◉   │", "│      ‿      │", "╰─────────────╯"]);
    expect(narrow.lead).toBe(`${NAME}: `);
    expect(narrow.bottom).toEqual([]);
  });

  test("blink closes both eyes and wink closes only the right one, at the same width", () => {
    const s = mascotScene({ paint: plain, ascii: false, columns: SIDE_BY_SIDE_COLUMNS, message: DEFAULT_LINE });
    expect(s.leads?.open).toBe(`│   ◉     ◉   │   ${NAME}: `);
    expect(s.leads?.blink).toBe(`│   ─     ─   │   ${NAME}: `);
    expect(s.leads?.wink).toBe(`│   ◉     ─   │   ${NAME}: `);
    const narrow = mascotScene({ paint: plain, ascii: false, columns: SIDE_BY_SIDE_COLUMNS - 1, message: DEFAULT_LINE });
    expect(narrow.leads).toBeUndefined();
    // Wide enough for the face, but the line would wrap beside it: the line goes under the face.
    const line = "x".repeat(47);
    const wraps = mascotScene({ paint: plain, ascii: false, columns: 74, message: line });
    expect(wraps.lead).toBe(`${NAME}: `);
    expect(wraps.bottom).toEqual([]);
    expect(wraps.leads).toBeUndefined();
    expect(mascotScene({ paint: plain, ascii: false, columns: 75, message: line }).leads).toBeDefined();
  });

  test("every row of the face has the same width, so the right border never shifts", () => {
    for (const ascii of [false, true]) {
      const s = mascotScene({ paint: plain, ascii, columns: 10, message: "x" });
      expect(new Set(s.top.map((row) => [...row].length))).toEqual(new Set([FACE_INSIDE + 2]));
    }
  });

  test("TERM=dumb gets ASCII art only", () => {
    const s = mascotScene({ paint: plain, ascii: true, columns: 100, message: "hi" });
    const all = [...s.top, s.lead, ...s.bottom].join("\n");
    expect(all).not.toMatch(/[^\x00-\x7f]/);
  });

  test("the chip is plain text without color and a colored block with it", () => {
    expect(chipTitle("1.2.3", { isTTY: true }, { NO_COLOR: "1" })).toBe("wachiman  On watch. v1.2.3");
    const colored = chipTitle("1.2.3", { isTTY: true }, { TERM: "xterm" });
    expect(colored).toContain("\x1b[");
    expect(stripAnsi(colored)).toBe(" wachiman   On watch. v1.2.3");
  });
});

describe("when the typing may play", () => {
  test("only on a terminal with color, outside CI, without WACHIMAN_NO_ANIMATION", () => {
    const t = term();
    expect(canAnimate(t, { TERM: "xterm" })).toBe(true);
    expect(canAnimate(t, { TERM: "xterm", CI: "true" })).toBe(false);
    expect(canAnimate(t, { TERM: "xterm", WACHIMAN_NO_ANIMATION: "1" })).toBe(false);
    expect(canAnimate(t, { TERM: "xterm", NO_COLOR: "1" })).toBe(false);
    expect(canAnimate(t, { TERM: "dumb" })).toBe(false);
    expect(canAnimate(term({ isTTY: false }), { TERM: "xterm" })).toBe(false);
    expect(canAnimate(term({ inputTTY: false }), { TERM: "xterm" })).toBe(false);
    expect(canAnimate(term({ columns: 20 }), { TERM: "xterm" })).toBe(false);
  });
});

describe("playIntro", () => {
  test("static: prints the whole scene at once with no cursor codes, and never touches raw mode", async () => {
    const ui = fakeUi();
    const t = term();
    const result = await playIntro({ ui, term: t, env: { NO_COLOR: "1" }, version: "1.2.3" });
    expect(result).toBe("static");
    expect(ui.of("intro")[0].title).toBe("wachiman  On watch. v1.2.3");
    expect(t.written()).toContain(`${NAME}: ${DEFAULT_LINE}`);
    expect(t.written()).not.toContain("\x1b[?25");
    expect(t.input.modes).toEqual([]);
  });

  test("played: types every character, then restores raw mode and the cursor", async () => {
    const ui = fakeUi();
    const t = term();
    const sleeps: number[] = [];
    const result = await playIntro({ ui, term: t, env: { TERM: "xterm" }, version: "1.2.3", line: "Hi!", sleep: async (ms) => void sleeps.push(ms) });
    expect(result).toBe("played");
    expect(sleeps.filter((ms) => ms === TYPE_MS)).toHaveLength(3);
    expect(t.input.modes).toEqual([true, false]);
    expect(t.written()).toContain("\x1b[?25l");
    expect(t.written()).toContain("\x1b[?25h");
    expect(stripAnsi(t.written())).toContain("Hi!");
  });

  test("side by side, the whole face is drawn before the first letter, and the cursor ends under it", async () => {
    const ui = fakeUi();
    const t = term();
    let firstSleep = -1;
    await playIntro({ ui, term: t, env: { TERM: "xterm" }, version: "1.2.3", line: "Hi!", sleep: async () => void (firstSleep < 0 && (firstSleep = t.written().length)) });
    const before = stripAnsi(t.written().slice(0, firstSleep));
    expect(before).toContain("╰─────────────╯");
    expect(before).not.toContain("Hi!");
    // Up from under the bottom rows to the eyes row, and down past them at the end.
    expect(t.written()).toContain("\x1b[3A");
    expect(t.written()).toContain("\x1b[2B\n");
  });

  test("a key skips the typing and the whole line still appears; Ctrl-C reports interrupted", async () => {
    for (const [key, expected] of [["x", "skipped"], ["\u0003", "interrupted"]] as const) {
      const t = term();
      const result = await playIntro({
        ui: fakeUi(),
        term: t,
        env: { TERM: "xterm" },
        version: "1.2.3",
        line: "Hello there",
        sleep: async () => {
          t.input.emit("data", key);
        },
      });
      expect(result).toBe(expected);
      expect(stripAnsi(t.written())).toContain("Hello there");
      expect(t.input.modes.at(-1)).toBe(false);
    }
  });
});

test("the paint of a NO_COLOR terminal leaves the art uncolored", () => {
  const paint = terminalStyle({ isTTY: true }, { NO_COLOR: "1" });
  expect(mascotScene({ paint, ascii: false, columns: 100, message: "x" }).top.join("")).not.toContain("\x1b[");
});
