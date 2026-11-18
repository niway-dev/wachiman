import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// AC12: the wachiman-loop skill carries the agent instructions for memory and for questions to the owner.
const skill = readFileSync(join(import.meta.dir, "..", "..", "skills", "wachiman-loop", "SKILL.md"), "utf8");

describe("the wachiman-loop skill carries the agent instructions (AC12)", () => {
  test("it names the memory commands the instructions run, with their documented flags", () => {
    expect(skill).toContain("wachiman memory add");
    expect(skill).toContain("--kind");
    expect(skill).toContain("wachiman memory show <id>");
    expect(skill).toContain("wachiman memory propose <id>");
  });

  test("it says never to propose without the owner's yes", () => {
    expect(skill).toMatch(/never propose without the owner's yes/i);
  });

  test("it says to ask about findings whose fix depends on intent, rather than guess", () => {
    expect(skill).toMatch(/fix depends on what the owner wants/);
    expect(skill).toMatch(/do not guess/i);
  });

  test("it lists what belongs in memory and what does not", () => {
    expect(skill).toContain("Belongs:");
    expect(skill).toContain("Does not belong:");
  });
});
