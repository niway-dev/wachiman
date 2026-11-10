import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { projectCommand, projectCommands } from "./command";

test("copying the POSIX suggestion preserves the entire repository argument", () => {
  for (const path of ["plain", "project space", "owner's project", 'quote"; $(printf injected)', "line\nbreak", "back\\slash"]) {
    const command = projectCommand("local", path, "/fixture");
    // Parse as a real shell, without running the suggested review command.
    const out = spawnSync("/bin/sh", ["-c", `set -- ${command}; printf '%s\\0' "$@"`], { encoding: "utf8" });
    expect(out.status).toBe(0);
    expect(out.stdout.split("\0").slice(0, -1)).toEqual(["wachiman", "local", "--repo-dir", resolve("/fixture", path)]);
  }
});

test("the current directory needs no path and Windows suggestions identify their shells", () => {
  expect(projectCommand("local", ".", "/fixture")).toBe("wachiman local");
  const suggestions = projectCommands("setup", "/fixture/owner's project", "/elsewhere", "win32");
  expect(suggestions).toHaveLength(2);
  expect(suggestions[0]).toStartWith("PowerShell: ");
  expect(suggestions[1]).toStartWith("Git Bash: ");
  expect(suggestions[0]).not.toBe(suggestions[1]);
});
