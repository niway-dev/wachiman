import { expect, test } from "bun:test";
import { colorLevel, stripAnsi, symbols, terminalStyle, wizardIo } from "./style";
import { createPrompter } from "./prompt";
import { scripted } from "../../test/support/scripted-prompt";

test("color requires a capable output terminal and honors a non-empty NO_COLOR and ignores an empty one", () => {
  expect(terminalStyle({ isTTY: true }, { TERM: "xterm" })("Pick", "accent")).toContain("\x1b[36m");
  expect(terminalStyle({ isTTY: true }, { TERM: "xterm", NO_COLOR: "" })("Pick", "accent")).toContain("\x1b[36m");
  for (const [output, env] of [
    [{ isTTY: false }, { TERM: "xterm" }],
    [{ isTTY: true }, { TERM: "dumb" }],
    [{ isTTY: true }, { TERM: "xterm", NO_COLOR: "1" }],
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

test("on a terminal session the closing next: hints go to the Next steps box and status lines go inside the frame", () => {
  const lines: string[] = [];
  const reported: [string, string | undefined][] = [];
  const steps: [string, string | undefined][] = [];
  const session = {
    fancy: true,
    nextStep: (command: string, note?: string) => void steps.push([command, note]),
    report: (line: string, kind?: string) => void reported.push([line, kind]),
  };
  const io = wizardIo({ stderr: (s: string) => void lines.push(s) }, { isTTY: true }, { TERM: "xterm" }, session);
  io.stderr("next: wachiman local");
  io.stderr("Next, on this machine: wachiman setup   (binds this repository to a Claude account)");
  io.stderr("bound: example");
  io.stderr("warning: careful");
  io.stderr("something else");
  expect(steps).toEqual([
    ["wachiman local", undefined],
    ["wachiman setup", "binds this repository to a Claude account"],
  ]);
  expect(reported.map(([line, kind]) => [line, kind])).toEqual([
    ["bound: example", "success"],
    ["warning: careful", "warning"],
    ["something else", "info"],
  ]);
  expect(lines).toEqual([]);
});

test("colorLevel: a terminal gets color, NO_COLOR (non-empty), a pipe and TERM=dumb do not", () => {
  expect(colorLevel({ isTTY: true }, { TERM: "xterm" })).toBeGreaterThan(0);
  expect(colorLevel({ isTTY: true }, { TERM: "xterm", NO_COLOR: "" })).toBeGreaterThan(0);
  expect(colorLevel({ isTTY: true }, { TERM: "xterm", NO_COLOR: "1" })).toBe(0);
  expect(colorLevel({ isTTY: false }, { TERM: "xterm" })).toBe(0);
  expect(colorLevel({ isTTY: true }, { TERM: "dumb" })).toBe(0);
});

test("symbols are ASCII on a dumb terminal and stripAnsi removes colors", () => {
  expect(symbols({ TERM: "dumb" }).done).toBe("+");
  expect(symbols({ TERM: "xterm" }).done).toBe("\u2714");
  expect(stripAnsi(terminalStyle({ isTTY: true }, { TERM: "xterm" })("hello", "brand"))).toBe("hello");
});

test("without a terminal session the hints are printed as they always were", () => {
  const lines: string[] = [];
  const session = { fancy: false, nextStep: () => { throw new Error("not used"); } };
  const io = wizardIo({ stderr: (s: string) => void lines.push(s) }, { isTTY: false }, {}, session);
  io.stderr("next: wachiman local");
  io.stderr("bound: example");
  expect(lines).toEqual(["next: wachiman local", "bound: example"]);
});
