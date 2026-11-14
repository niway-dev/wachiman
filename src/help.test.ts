import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CI_COMMANDS, COMMANDS, commandHelp, helpFor, rootHelp } from "./help";

const cli = join(import.meta.dir, "cli.ts");
const run = (args: string[], env: Record<string, string> = {}) => {
  const out = Bun.spawnSync([process.execPath, cli, ...args], { env: { PATH: process.env.PATH ?? "", ...env } });
  return { code: out.exitCode, stdout: out.stdout.toString(), stderr: out.stderr.toString() };
};

describe("root help", () => {
  test("is short, names every public command and hides the CI commands and --setup-profile", () => {
    const text = rootHelp();
    expect(text.trimEnd().split("\n").length).toBeLessThanOrEqual(26);
    for (const name of ["local", "loop", "ask", "history", "status", "dashboard", "ledger", "setup", "init", "doctor", "profile", "project", "skills", "upgrade"]) {
      expect(text).toContain(`  ${name} `);
    }
    for (const name of CI_COMMANDS) expect(text).not.toMatch(new RegExp(`^  ${name} `, "m"));
    expect(text).not.toContain("--setup-profile");
    expect(text).not.toContain("Guide: docs/");
  });

  test("a bold header appears only when the output is a terminal", () => {
    expect(rootHelp()).not.toContain("\x1b[");
    expect(rootHelp((text) => `<${text}>`)).toContain("<Review>");
  });
});

describe("a page per command", () => {
  test("every command has usage, exit codes, examples and a docs link", () => {
    for (const name of COMMANDS) {
      const text = commandHelp([name])!;
      expect(text).toContain("Usage\n  wachiman ");
      expect(text).toContain("\nExit codes\n");
      expect(text).toContain("\nExamples\n  ");
      expect(text).toContain("\nDocs: https://github.com/niway-dev/wachiman/blob/main/docs/");
    }
  });

  test("--help, -h and help <command> give the same page for every command", () => {
    for (const name of COMMANDS) {
      const page = commandHelp([name])!;
      expect(page).toContain(`wachiman ${name}`);
      expect(helpFor([name, "--help"])).toEqual({ text: page });
      expect(helpFor([name, "-h"])).toEqual({ text: page });
      expect(helpFor(["help", name])).toEqual({ text: page });
    }
  });

  test("--help exits 0 on stdout alone, with an empty environment and a Wachiman home that does not exist", () => {
    const home = join(mkdtempSync(join(tmpdir(), "help-home-")), "missing");
    for (const name of ["local", "ask", "loop", "review", "doctor", "setup", "init", "skills", "profile"]) {
      const out = run([name, "-h"], { WACHIMAN_HOME: home });
      expect(out.code).toBe(0);
      expect(out.stdout).toBe(commandHelp([name]));
      expect(out.stderr).toBe("");
    }
    expect(existsSync(home)).toBe(false);
  }, 30_000);

  test("help returns before the arguments are checked: a missing directory does not matter", () => {
    expect(run(["local", "--repo-dir", "/does/not/exist", "--help"]).code).toBe(0);
    expect(run(["review", "--help"]).code).toBe(0);
  }, 30_000);

  test("nested commands have their own page", () => {
    for (const words of [["profile", "create"], ["profile", "add"], ["project", "show"], ["skills", "install"], ["skills", "uninstall"], ["ledger", "pull"]]) {
      const page = commandHelp(words)!;
      expect(page).toContain(`Usage\n  wachiman ${words.join(" ")}`);
      expect(helpFor([...words, "--help"])).toEqual({ text: page });
      expect(helpFor(["help", ...words])).toEqual({ text: page });
    }
    expect(helpFor(["--setup-profile", "--help"])).toEqual({ text: commandHelp(["profile", "create"]) });
    const out = run(["profile", "create", "--help"]);
    expect(out.code).toBe(0);
    expect(out.stdout).toBe(commandHelp(["profile", "create"]));
  }, 30_000);

  test("local, ask and loop describe their flags with defaults and the variables they read", () => {
    const local = commandHelp(["local"])!;
    expect(local).toContain("--max-depth <n>");
    expect(local).toContain("Default: 250");
    expect(local).toContain("WACHIMAN_HOME");
    expect(local).toContain("ANTHROPIC_API_KEY");
    expect(local).toMatch(/\n\s+130\s+Interrupted/);
    expect(commandHelp(["loop"])).toMatch(/\n\s+10\s+Findings are still open/);
    expect(commandHelp(["ask"])).toContain("[question…]");
  });
});

describe("help ci", () => {
  test("lists the four CI commands, the GitHub variables and the exit codes", () => {
    const out = run(["help", "ci"]);
    expect(out.code).toBe(0);
    for (const name of CI_COMMANDS) expect(out.stdout).toContain(`wachiman ${name} `);
    for (const variable of ["GH_TOKEN", "GITHUB_REPOSITORY", "REQUEST", "WACHIMAN_COMMENT_AUTHOR"]) expect(out.stdout).toContain(variable);
    expect(out.stdout).toContain("\nExit codes\n");
  });
});

describe("usage errors", () => {
  test("print one error line and where to look, and exit 2", () => {
    const flag = run(["local", "--bogus"]);
    expect(flag.code).toBe(2);
    expect(flag.stderr.trimEnd().split("\n")).toEqual(["wachiman: Unknown option --bogus for local.", "Run 'wachiman local --help'."]);
    const unknown = run(["frobnicate"]);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain("Run 'wachiman --help'.");
    expect(run(["help", "frobnicate"]).code).toBe(2);
    expect(run(["frobnicate", "--help"]).code).toBe(2);
  }, 30_000);

  test("-h and --help are not a help request where they are text or a value", () => {
    expect(helpFor(["ask", "what", "does", "--help", "do"])).toBeUndefined();
    expect(helpFor(["history", "--verdict", "3f9a1c", "wrong", "--reason", "-h"])).toBeUndefined();
    expect(helpFor(["local", "--", "--help"])).toBeUndefined();
    expect(helpFor(["ask", "--help"])).toBeDefined();
    expect(helpFor(["ask", "-h", "anything"])).toBeDefined();
  });

  test("helpFor ignores arguments that are not a help request", () => {
    expect(helpFor(["local", "--base", "main"])).toBeUndefined();
    expect(helpFor(["--version"])).toBeUndefined();
  });
});
