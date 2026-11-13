import { describe, expect, test } from "bun:test";
import { isMissingPackage, loadTerminalUi } from "./load";

describe("isMissingPackage", () => {
  test("recognizes the error of a package that is not installed, in both runtimes' wording", () => {
    expect(isMissingPackage(Object.assign(new Error("x"), { code: "ERR_MODULE_NOT_FOUND" }))).toBe(true);
    expect(isMissingPackage(new Error("Cannot find package 'chalk' from '/x/src/wizard/style.ts'"))).toBe(true);
    expect(isMissingPackage(new Error("Cannot find module '@clack/prompts' from '/x'"))).toBe(true);
    expect(isMissingPackage(new Error("Cannot find package 'sisteransi' from '/x'"))).toBe(true);
  });

  test("does not hide a real bug as a missing package", () => {
    expect(isMissingPackage(new Error("Cannot find package 'left-pad' from '/x'"))).toBe(false);
    expect(isMissingPackage(new SyntaxError("Unexpected token"))).toBe(false);
    expect(isMissingPackage(undefined)).toBe(false);
  });
});

describe("loadTerminalUi", () => {
  test("loads the prompt session and the stderr styling when the packages are installed", async () => {
    const ui = await loadTerminalUi();
    expect(typeof ui.openPrompter).toBe("function");
    expect(typeof ui.wizardIo).toBe("function");
  });
});
