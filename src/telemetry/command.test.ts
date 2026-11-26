import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { consentText } from "./text";
import { consentPath, readConsent, recordChoice, UUID_V4 } from "./consent";
import { runTelemetry } from "./command";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "wachiman-telemetry-cmd-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function run(argv: string[], env: Record<string, string> = {}, deps: Parameters<typeof runTelemetry>[3] = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const code = runTelemetry(
    argv,
    { WACHIMAN_HOME: home, ...env },
    { stdout: (t) => out.push(t), stderr: (l) => err.push(l) },
    {
      ask: (q) => (asked.push(q), "yes"),
      ...deps,
    },
  );
  return { code, out: out.join(""), err: err.join("\n"), asked };
}

describe("wachiman telemetry on", () => {
  test("refuses without a terminal: exit 2, a clear message, nothing stored and no question", () => {
    const r = run(["on"], {}, { interactive: false });
    expect(r.code).toBe(2);
    expect(r.err).toContain("needs a terminal");
    expect(r.asked).toEqual([]);
    expect(readConsent(home)).toBeUndefined();
  });

  test("refuses when CI or GITHUB_ACTIONS is set, even on a terminal", () => {
    for (const env of [{ CI: "true" }, { GITHUB_ACTIONS: "true" }] as Record<string, string>[]) {
      const r = run(["on"], env, { interactive: true });
      expect(r.code).toBe(2);
      expect(r.err).toMatch(/CI|GITHUB_ACTIONS/);
      expect(readConsent(home)).toBeUndefined();
    }
  });

  test("on a terminal it shows the consent text and asks; a yes stores the choice and an installation ID", () => {
    const r = run(["on"], {}, { interactive: true });
    expect(r.code).toBe(0);
    expect(r.err).toContain(consentText("https://github.com/niway-dev/wachiman/blob/main/docs/on-your-machine.md#telemetry"));
    expect(r.asked).toEqual(["Share usage metrics?"]);
    const consent = readConsent(home)!;
    expect(consent.choice).toBe("yes");
    expect(consent.installation).toMatch(UUID_V4);
  });

  test("a no, or a cancel, stores nothing new as yes", () => {
    expect(run(["on"], {}, { interactive: true, ask: () => "no" }).code).toBe(0);
    expect(readConsent(home)).toEqual({ choice: "no" });
    expect(run(["on"], {}, { interactive: true, ask: () => "cancel" }).code).toBe(130);
    expect(readConsent(home)).toEqual({ choice: "no" });
  });

  test("a new on after an off keeps the same installation ID", () => {
    run(["on"], {}, { interactive: true });
    const first = readConsent(home)!.installation;
    run(["off"]);
    expect(readConsent(home)).toEqual({ choice: "no", installation: first });
    run(["on"], {}, { interactive: true });
    expect(readConsent(home)).toEqual({ choice: "yes", installation: first });
  });
});

describe("wachiman telemetry off, status and reset", () => {
  test("off works anywhere, in CI too, and stores no", () => {
    const r = run(["off"], { CI: "true" }, { interactive: false });
    expect(r.code).toBe(0);
    expect(readConsent(home)).toEqual({ choice: "no" });
  });

  test("status prints the choice, the installation ID and what blocks sending now", () => {
    expect(run(["status"]).out).toContain("Usage telemetry: not asked");
    const { installation } = recordChoice(home, "yes");
    const clear = run(["status"]).out;
    expect(clear).toContain("Usage telemetry: on");
    expect(clear).toContain(installation!);
    expect(clear).toContain("Sending now: yes");
    const blocked = run(["status"], { DO_NOT_TRACK: "1", CI: "true", WACHIMAN_TELEMETRY: "0" }).out;
    expect(blocked).toContain("Sending now: no");
    for (const name of ["DO_NOT_TRACK", "CI", "WACHIMAN_TELEMETRY=0"]) expect(blocked).toContain(name);
  });

  test("status warns once about a rejected WACHIMAN_TELEMETRY_URL, and not about an accepted one", () => {
    const warn = (url: string) => run(["status"], { WACHIMAN_TELEMETRY_URL: url }).out.match(/Warning: WACHIMAN_TELEMETRY_URL/g)?.length ?? 0;
    expect(warn("http://test-box:8080/v1/usage")).toBe(1);
    expect(warn("https://example.com/v1/usage")).toBe(0);
    expect(warn("http://127.0.0.1:9/v1/usage")).toBe(0);
    expect(run(["status"]).out).not.toContain("Warning");
  });

  test("status reports off after an off", () => {
    run(["off"]);
    expect(run(["status"]).out).toContain("Usage telemetry: off");
  });

  test("an unreadable choice file is not rotated or rewritten: status says unreadable, on, off and reset refuse", () => {
    mkdirSync(consentPath(home), { recursive: true }); // a directory where the file should be: EISDIR, not ENOENT
    expect(run(["status"]).out).toContain("Usage telemetry: unreadable");
    for (const argv of [["off"], ["reset"]]) {
      const r = run(argv);
      expect(r.code).toBe(1);
      expect(r.err).toContain("could not be read");
    }
    const on = run(["on"], {}, { interactive: true });
    expect(on.code).toBe(1);
    expect(on.asked).toEqual([]);
    expect(on.err).not.toContain("Share usage metrics");
    expect(on.err).toContain("could not be read");
  });

  test("reset makes a new installation ID; with none it says so", () => {
    expect(run(["reset"]).out).toContain("no installation ID");
    const { installation } = recordChoice(home, "yes");
    const r = run(["reset"]);
    expect(r.code).toBe(0);
    const next = readConsent(home)!.installation!;
    expect(next).not.toBe(installation);
    expect(r.out).toContain(next);
  });

  test("an unknown or missing subcommand is exit 2", () => {
    expect(run([]).code).toBe(2);
    expect(run(["maybe"]).code).toBe(2);
    expect(run(["status", "extra"]).code).toBe(2);
  });
});

describe("through the CLI", () => {
  const cli = join(import.meta.dir, "..", "cli.ts");
  const spawn = (args: string[], env: Record<string, string> = {}) => {
    const out = Bun.spawnSync([process.execPath, cli, ...args], {
      env: { PATH: process.env.PATH ?? "", HOME: home, WACHIMAN_HOME: home, ...env },
      stdin: "ignore",
    });
    return { code: out.exitCode, stdout: out.stdout.toString(), stderr: out.stderr.toString() };
  };

  test("`telemetry on` with no terminal exits 2 and stores nothing; status and off work", () => {
    const on = spawn(["telemetry", "on"]);
    expect(on.code).toBe(2);
    expect(on.stderr).toContain("needs a terminal");
    expect(readConsent(home)).toBeUndefined();
    expect(spawn(["telemetry", "status"]).stdout).toContain("not asked");
    expect(spawn(["telemetry", "off"]).code).toBe(0);
    expect(readConsent(home)).toEqual({ choice: "no" });
  });

  test("has a help page", () => {
    const help = spawn(["telemetry", "--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("wachiman telemetry on|off|status|reset");
  });
});
