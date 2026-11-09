import { describe, expect, test } from "bun:test";
import { isInteractive } from "./interactive";

const tty = { stdin: { isTTY: true }, stdout: { isTTY: true } };

describe("isInteractive", () => {
  test("a terminal on both ends, no --yes and no CI is interactive", () => {
    expect(isInteractive({}, {}, tty)).toBe(true);
  });
  test("--yes turns the prompts off", () => {
    expect(isInteractive({ yes: true }, {}, tty)).toBe(false);
  });
  test("CI=true turns the prompts off", () => {
    expect(isInteractive({}, { CI: "true" }, tty)).toBe(false);
  });
  test("CI=1 turns the prompts off, while CI=false or an empty CI does not", () => {
    expect(isInteractive({}, { CI: "1" }, tty)).toBe(false);
    expect(isInteractive({}, { CI: "false" }, tty)).toBe(true);
    expect(isInteractive({}, { CI: "" }, tty)).toBe(true);
  });
  test("a piped stdin or a piped stdout turns the prompts off", () => {
    expect(isInteractive({}, {}, { stdin: { isTTY: false }, stdout: { isTTY: true } })).toBe(false);
    expect(isInteractive({}, {}, { stdin: { isTTY: true }, stdout: {} })).toBe(false);
  });
});
