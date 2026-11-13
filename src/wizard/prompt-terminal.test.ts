import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { scripted } from "../../test/support/scripted-prompt";
import { createPrompter } from "./prompt";
import { renderBox, stripAnsi, terminalStyle } from "./style";

const choices = [
  { label: "alpha", value: "a" },
  { label: "beta", value: "b" },
  { label: "gamma", value: "c" },
];

/** A terminal: TTY input with raw mode, TTY output that records. */
function terminalIo(columns = 80) {
  const input = Object.assign(new PassThrough(), { isTTY: true, isRaw: false });
  Object.assign(input, { setRawMode: (mode: boolean) => ((input.isRaw = mode), input) });
  const output = Object.assign(new PassThrough(), { isTTY: true, columns });
  let written = "";
  output.on("data", (d) => (written += d.toString()));
  return { input, output, written: () => written };
}
const tick = () => new Promise((r) => setTimeout(r, 15));
const DOWN = "\x1b[B";
const UP = "\x1b[A";
const env = { TERM: "xterm-256color" };

describe("the arrow-key menu", () => {
  test("Down then Enter picks the next row; the menu collapses to one line with a check mark", async () => {
    const t = terminalIo();
    const p = createPrompter(t, env);
    const pending = p.select("Pick one", choices, 0);
    await tick();
    t.input.write(DOWN);
    await tick();
    t.input.write("\r");
    expect(await pending).toBe("b");
    const plain = stripAnsi(t.written());
    expect(plain).toContain("❯ 1. alpha");
    expect(plain).toContain("❯ 2. beta");
    expect(plain.trimEnd().split("\n").at(-1)).toMatch(/✔ Pick one {2}beta$/);
    expect(t.written()).toContain("\x1b[?25h"); // the cursor is back
    expect(t.input.isRaw).toBe(false);
    p.close();
  });

  test("Enter alone takes the default row, and Up wraps to the last one", async () => {
    const a = terminalIo();
    const pa = createPrompter(a, env);
    const first = pa.select("Pick one", choices, 1);
    await tick();
    a.input.write("\r");
    expect(await first).toBe("b");
    pa.close();
    const b = terminalIo();
    const pb = createPrompter(b, env);
    const second = pb.select("Pick one", choices, 0);
    await tick();
    b.input.write(UP);
    await tick();
    b.input.write("\r");
    expect(await second).toBe("c");
    pb.close();
  });

  test("a number moves the highlight and Enter confirms it", async () => {
    const t = terminalIo();
    const p = createPrompter(t, env);
    const pending = p.select("Pick one", choices, 0);
    await tick();
    t.input.write("3");
    await tick();
    t.input.write("\r");
    expect(await pending).toBe("c");
    p.close();
  });

  test("Ctrl-C cancels with null, restores the terminal, and cancels what comes after", async () => {
    const t = terminalIo();
    const p = createPrompter(t, env);
    const pending = p.select("Pick one", choices, 0);
    await tick();
    t.input.write("\u0003");
    expect(await pending).toBeNull();
    expect(t.input.isRaw).toBe(false);
    expect(t.written()).toContain("\x1b[?25h");
    expect(await p.select("Again", choices, 0)).toBeNull();
    p.close();
  });

  test("descriptions are shown under their row and a long label is cut to the terminal width", async () => {
    const t = terminalIo(30);
    const p = createPrompter(t, env);
    const pending = p.select("A very long question that does not fit in thirty columns", [{ label: "x".repeat(60), value: 1, description: "help text" }], 0);
    await tick();
    t.input.write("\r");
    await pending;
    const lines = stripAnsi(t.written()).split("\n");
    expect(lines.some((l) => l.trim() === "help text")).toBe(true);
    for (const line of lines) expect([...line].length).toBeLessThanOrEqual(30);
    p.close();
  });

  test("typed-ahead lines still go through the numbered list", async () => {
    const t = terminalIo();
    const p = createPrompter(t, env);
    const text = p.text("Name", undefined);
    t.input.write("mine\n2\n");
    expect(await text).toBe("mine");
    expect(await p.select("Pick one", choices, 0)).toBe("b");
    expect(stripAnsi(t.written())).toContain("Choice [1]:");
    p.close();
  });

  test("a typed answer and a confirmation collapse to a check-marked line that moves up over the rows they used", async () => {
    const t = terminalIo(40);
    const p = createPrompter(t, env);
    const name = p.text("A question long enough to take two rows", "dflt");
    await tick();
    t.input.write("mine\r");
    expect(await name).toBe("mine");
    const go = p.confirm("Go?", true);
    await tick();
    t.input.write("n\r");
    expect(await go).toBe(false);
    const out = t.written();
    // Question (41 chars, with its marker and default) plus "mine" is 2 rows at 40 columns; "? Go? [Y/n] n" is 1.
    expect(out).toContain("\x1b[2A\x1b[J");
    expect(out).toContain("\x1b[1A\x1b[J");
    const plain = stripAnsi(out);
    expect(plain).toContain("✔ A question long enough to take…  mine");
    expect(plain).toContain("✔ Go?  no");
    p.close();
  });

  test("an invalid answer is not collapsed", async () => {
    const t = terminalIo();
    const p = createPrompter(t, env);
    const pending = p.text("Name", undefined, (v) => (v === "ok" ? undefined : "not allowed"));
    await tick();
    t.input.write("bad\r");
    await tick();
    expect(stripAnsi(t.written())).toContain("not allowed");
    expect(stripAnsi(t.written())).not.toContain("✔");
    t.input.write("ok\r");
    expect(await pending).toBe("ok");
    p.close();
  });

  test("a terminal without raw mode keeps the numbered list", async () => {
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = Object.assign(new PassThrough(), { isTTY: true, columns: 80 });
    const p = createPrompter({ input, output }, env);
    const pending = p.select("Pick one", choices, 0);
    input.write("2\n");
    expect(await pending).toBe("b");
    p.close();
  });

  test("without a terminal the output is the numbered list, byte for byte", async () => {
    const io = scripted(["2"]);
    const p = createPrompter(io, env);
    expect(await p.select("Pick one", choices, 0)).toBe("b");
    expect(io.printed()).toBe("Pick one\n  1. alpha (default)\n  2. beta\n  3. gamma\nChoice [1]: ");
  });
});

describe("a session on a terminal", () => {
  test("steps get a marker and the progress in words; without a terminal they stay plain", () => {
    const t = terminalIo();
    const p = createPrompter(t, env);
    p.step("Project", 1, 4);
    expect(stripAnsi(t.written())).toBe("\n◆ Project  step 1 of 4\n");
    p.close();
    expect(p.fancy).toBe(true);
    expect(createPrompter(scripted([])).fancy).toBe(false);
  });

  test("the closing steps become one box with the commands, printed once by close", () => {
    const t = terminalIo(60);
    const p = createPrompter(t, env);
    p.nextStep("wachiman local", "review your branch");
    p.nextAction("Open a pull request", ["git add file", "git push"]);
    expect(t.written()).toBe("");
    p.close();
    const box = stripAnsi(t.written()).trim().split("\n");
    expect(box[0]).toMatch(/^╭─ Next steps ─+╮$/);
    expect(box.at(-1)).toMatch(/^╰─+╯$/);
    const text = box.join("\n");
    expect(text).toContain("1. Review your branch");
    expect(text).toContain("     wachiman local");
    expect(text).toContain("2. Open a pull request");
    expect(text).toContain("     git push");
    expect(new Set(box.map((l) => [...l].length)).size).toBe(1); // every row is as wide as the top edge
    p.close();
    expect(stripAnsi(t.written()).split("Next steps").length).toBe(2);
  });

  test("without a terminal intro, task and the box print nothing, and task still runs the work", async () => {
    const io = scripted([]);
    const p = createPrompter(io, env);
    await p.intro("1.0.0");
    expect(await p.task("Checking", () => 42)).toBe(42);
    await expect(p.task("Failing", () => Promise.reject(new Error("no")))).rejects.toThrow("no");
    p.nextStep("wachiman local");
    p.close();
    expect(io.printed()).toBe("");
  });

  test("task shows a line that ends in a check mark, or a warning when the result is bad", async () => {
    const t = terminalIo();
    const p = createPrompter(t, env);
    expect(await p.task("Checking the account", () => ({ ok: true }), (r) => r.ok)).toEqual({ ok: true });
    expect(await p.task("Checking again", () => ({ ok: false }), (r) => r.ok)).toEqual({ ok: false });
    const lines = stripAnsi(t.written()).split("\n").map((l) => l.split("\r").at(-1)!);
    expect(lines).toContain("✔ Checking the account");
    expect(lines).toContain("▲ Checking again");
    expect(t.written().lastIndexOf("\x1b[?25h")).toBeGreaterThan(t.written().lastIndexOf("\x1b[?25l"));
    p.close();
  });

  test("a failing task still ends its line and shows the cursor", async () => {
    const t = terminalIo();
    const p = createPrompter(t, env);
    await expect(p.task("Checking", () => Promise.reject(new Error("no")))).rejects.toThrow("no");
    expect(t.written().lastIndexOf("\x1b[?25h")).toBeGreaterThan(t.written().lastIndexOf("\x1b[?25l"));
    p.close();
  });

  test("Ctrl-C during the intro cancels the first question", async () => {
    const t = terminalIo();
    const p = createPrompter(t, env);
    const intro = p.intro("1.0.0");
    await tick();
    t.input.write("\u0003");
    await intro;
    expect(await p.confirm("Go?", true)).toBeNull();
    expect(t.written().lastIndexOf("\x1b[?25h")).toBeGreaterThan(t.written().lastIndexOf("\x1b[?25l"));
    p.close();
  });

  test("with NO_COLOR the intro is the plain header and nothing is colored", async () => {
    const t = terminalIo();
    const p = createPrompter(t, { NO_COLOR: "1" });
    await p.intro("1.0.0");
    p.step("Project", 1);
    expect(t.written()).toBe("👮 wachiman v1.0.0 · on watch\n\n◆ Project  step 1\n");
    p.close();
  });
});

describe("renderBox", () => {
  const plain = terminalStyle({ isTTY: false }, {});

  test("rows wrap to the width and every line is as wide as the top edge", () => {
    const lines = renderBox("Next steps", ["1. A long sentence that has to wrap because the box is narrow", "     wachiman local"], 30, {}, plain);
    expect(new Set(lines.map((l) => [...l].length)).size).toBe(1);
    expect(lines.length).toBeGreaterThan(4);
    for (const l of lines) expect([...l].length).toBeLessThanOrEqual(30);
  });

  test("a dumb terminal gets an ASCII box", () => {
    const lines = renderBox("Next steps", ["1. Go"], 60, { TERM: "dumb" }, plain);
    expect(lines[0]).toMatch(/^\+- Next steps -+\+$/);
    expect(lines[1]).toMatch(/^\| 1\. Go +\|$/);
  });
});
