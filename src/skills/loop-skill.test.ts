import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CAPTURE_OPTIONS, CAPTURE_SUBCOMMANDS } from "../memory/capture";

// AC12: the wachiman-loop skill carries the agent instructions for memory and for questions to the owner.
const skill = readFileSync(join(import.meta.dir, "..", "..", "skills", "wachiman-loop", "SKILL.md"), "utf8");

describe("the wachiman-loop skill carries the agent instructions (AC12)", () => {
  // `--repo-dir` is taken out by the CLI before any subcommand sees the arguments.
  const GLOBAL = ["--repo-dir"];
  const commands = [...skill.matchAll(/wachiman memory (\S+)([^`\n]*)/g)].map((m) => ({ sub: m[1], rest: m[2] }));

  test("every `wachiman memory` command in the skill is a real subcommand with real flags", () => {
    expect(commands.map((c) => c.sub)).toEqual(expect.arrayContaining(["add", "candidates", "show", "propose"]));
    for (const { sub, rest } of commands) {
      expect(CAPTURE_SUBCOMMANDS as readonly string[]).toContain(sub);
      const known = [
        ...CAPTURE_OPTIONS[sub as keyof typeof CAPTURE_OPTIONS].values,
        ...CAPTURE_OPTIONS[sub as keyof typeof CAPTURE_OPTIONS].flags,
        ...GLOBAL,
      ];
      for (const flag of rest.match(/--[a-z-]+/g) ?? []) expect(known).toContain(flag);
    }
  });

  test("every flag the memory section names exists on a memory command", () => {
    const section = skill.slice(skill.indexOf("**Repository memory.**"), skill.indexOf("**What belongs in memory.**"));
    const known = new Set([...Object.values(CAPTURE_OPTIONS).flatMap((o) => [...o.values, ...o.flags]), ...GLOBAL, "--format"]);
    const named = section.match(/--[a-z-]+/g) ?? [];
    expect(named.length).toBeGreaterThan(0);
    for (const flag of named) expect(known.has(flag)).toBe(true);
  });

  test("it says never to propose without the owner's yes", () => {
    expect(skill).toMatch(/never propose without the owner's yes/i);
  });

  test("it asks for approval only of proposable candidates and just mentions the others", () => {
    expect(skill).toContain("wachiman memory candidates");
    expect(skill).toMatch(/not proposable[^]*do not ask/i);
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
