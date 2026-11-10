import { expect, test } from "bun:test";
import { terminalStyle, wizardIo } from "./style";
import { createPrompter } from "./prompt";
import { scripted } from "../../test/support/scripted-prompt";

test("color requires a capable output terminal and honors NO_COLOR, including an empty value", () => {
  expect(terminalStyle({ isTTY: true }, { TERM: "xterm" })("Pick", "accent")).toContain("\x1b[36m");
  for (const [output, env] of [
    [{ isTTY: false }, { TERM: "xterm" }],
    [{ isTTY: true }, { TERM: "dumb" }],
    [{ isTTY: true }, { TERM: "xterm", NO_COLOR: "" }],
  ] as const) expect(terminalStyle(output, env)("Pick", "accent")).toBe("Pick");
});

test("status colors touch stderr only", () => {
  const stdout: string[] = [], stderr: string[] = [];
  const io = wizardIo({ stdout: (s: string) => void stdout.push(s), stderr: (s: string) => void stderr.push(s) }, { isTTY: true }, { TERM: "xterm" });
  io.stdout('{"ok":true}');
  io.stderr("bound: example");
  io.stderr("cancelled: nothing saved");
  expect(stdout).toEqual(['{"ok":true}']);
  expect(stderr[0]).toContain("\x1b[32m");
  expect(stderr[1]).toContain("\x1b[33m");
});

test("plain steps do not depend on Unicode or ANSI to convey progress", () => {
  const io = scripted([]);
  const p = createPrompter(io, { NO_COLOR: "1" });
  p.step("Project", 1);
  p.step("Claude account", 3, 5);
  p.close();
  expect(io.printed()).toBe("\nStep 1  Project\n\nStep 3/5  Claude account\n");
});
