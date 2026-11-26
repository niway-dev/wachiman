import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commit, emptyRepo, removeTempRepos } from "../../test/support/temp-repo";
import { scripted } from "../../test/support/scripted-prompt";
import { consentPath, readConsent, recordChoice } from "../telemetry/consent";
import { parseInitFlags } from "./args";
import { runInitCommand, type InitDeps } from "./run";
import { telemetryState } from "./telemetry";

const scratch: string[] = [];
afterAll(() => {
  scratch.forEach((d) => rmSync(d, { recursive: true, force: true }));
  removeTempRepos();
});

function world(extraEnv: Record<string, string> = {}) {
  const repo = emptyRepo();
  commit(repo, { "README.md": "hello\n" }, "init");
  const home = mkdtempSync(join(tmpdir(), "wachiman-init-telemetry-"));
  scratch.push(home);
  const out: string[] = [];
  const err: string[] = [];
  return {
    repo,
    home,
    out,
    err,
    env: { WACHIMAN_HOME: home, ...extraEnv },
    io: { stdout: (t: string) => void out.push(t), stderr: (l: string) => void err.push(l) },
  };
}
type World = ReturnType<typeof world>;
const ARGS = [
  "--mode",
  "github",
  "--operator",
  "me",
  "--version",
  "v1.5.0",
  "--project-kind",
  "single",
  "--no-pr-template",
  "--no-agent-pointer",
];
const deps = (extra: InitDeps = {}): InitDeps => ({
  now: () => "2026-11-26T00:00:00.000Z",
  version: "1.21.0",
  defaultWorkflowRef: "v1.5.0",
  cwd: "/elsewhere",
  ...extra,
});
const init = (w: World, argv: string[], extra: InitDeps = {}) =>
  runInitCommand(parseInitFlags(argv, w.repo), w.env, w.io, deps({ interactive: false, ...extra }));
/** An interactive run: the one earlier question (Write it?) takes its default (Enter); the last line answers the telemetry question. */
const terminal = (answer: string, extra: string[] = []) => scripted([...extra, "", answer]);

describe("telemetryState", () => {
  test("blocked by DO_NOT_TRACK over a stored yes, else the stored choice, else pending", () => {
    const w = world();
    expect(telemetryState(w.env)).toBe("pending");
    recordChoice(w.home, "yes");
    expect(telemetryState(w.env)).toBe("yes");
    expect(telemetryState({ ...w.env, DO_NOT_TRACK: "1" })).toBe("blocked");
    recordChoice(w.home, "no");
    expect(telemetryState(w.env)).toBe("no");
    expect(telemetryState({ WACHIMAN_HOME: "relative/path" })).toBe("pending");
  });

  test("blocked by anything that blocks sending, with a stored yes", () => {
    const w = world();
    recordChoice(w.home, "yes");
    for (const extra of [{ WACHIMAN_TELEMETRY: "0" }, { CI: "true" }, { GITHUB_ACTIONS: "true" }])
      expect(telemetryState({ ...w.env, ...extra })).toBe("blocked");
  });
});

describe("init without a terminal stores nothing", () => {
  test("no terminal: no choice, no UUID, and --json says pending", async () => {
    const w = world();
    expect(await init(w, [...ARGS, "--json"])).toBe(0);
    expect(JSON.parse(w.out.join("")).telemetry).toBe("pending");
    expect(existsSync(consentPath(w.home))).toBe(false);
  });

  test("--json reports the stored choice, and blocked under DO_NOT_TRACK", async () => {
    const w = world();
    recordChoice(w.home, "no");
    await init(w, [...ARGS, "--json", "--dry-run"]);
    expect(JSON.parse(w.out.join("")).telemetry).toBe("no");
    const b = world({ DO_NOT_TRACK: "1" });
    await init(b, [...ARGS, "--json", "--dry-run"]);
    expect(JSON.parse(b.out.join("")).telemetry).toBe("blocked");
    expect(existsSync(consentPath(b.home))).toBe(false);
  });

  test("a plain run without a terminal, and --yes in a terminal, ask nothing and store nothing", async () => {
    const w = world();
    expect(await init(w, ARGS)).toBe(0);
    const io = scripted([]);
    const y = world();
    expect(
      await init(y, [...ARGS, "--yes"], {
        interactive: undefined,
        streams: { stdin: { isTTY: true }, stdout: { isTTY: true } },
        promptIO: io,
      }),
    ).toBe(0);
    expect(io.printed()).toBe("");
    expect(existsSync(consentPath(w.home))).toBe(false);
    expect(existsSync(consentPath(y.home))).toBe(false);
  });
});

describe("a telemetry error never fails an init that succeeded", () => {
  test("a relative WACHIMAN_HOME and an unwritable home: exit 0, the workflow is written, one stderr line", async () => {
    const written: string[] = [];
    {
      const relative = world({ WACHIMAN_HOME: "relative/path" });
      expect(await init(relative, ARGS, { interactive: true, promptIO: terminal("y") })).toBe(0);
      written.push(...relative.err);
      expect(existsSync(join(relative.repo, ".github", "workflows", "wachiman-review.yml"))).toBe(true);
      const blocked = world();
      const file = join(blocked.home, "not-a-directory");
      writeFileSync(file, "");
      const unwritable = { ...blocked, env: { WACHIMAN_HOME: file } };
      expect(await init(unwritable, ARGS, { interactive: true, promptIO: terminal("y") })).toBe(0);
      written.push(...unwritable.err);
    }
    expect(written.filter((l) => l.includes("telemetry: choice not stored")).length).toBe(2);
  });
});

describe("init in a terminal asks once", () => {
  test("Enter is No: the default is stored and the consent text is shown", async () => {
    const w = world();
    const io = terminal("");
    expect(await init(w, ARGS, { interactive: true, promptIO: io })).toBe(0);
    expect(io.printed()).toContain("Would you like to share usage metrics to help improve Wachiman?");
    expect(io.printed()).toContain("on-your-machine.md#telemetry");
    expect(readConsent(w.home)).toEqual({ choice: "no" });
  });

  test("y stores a yes with a new installation ID; a second init does not ask again", async () => {
    const w = world();
    expect(await init(w, ARGS, { interactive: true, promptIO: terminal("y") })).toBe(0);
    const stored = readConsent(w.home)!;
    expect(stored.choice).toBe("yes");
    expect(stored.installation).toBeDefined();
    const again = terminal("n");
    expect(await init(w, [...ARGS, "--force"], { interactive: true, promptIO: again })).toBe(0);
    expect(again.printed()).not.toContain("share usage metrics");
    expect(readConsent(w.home)).toEqual(stored);
  });

  test("DO_NOT_TRACK: not asked and nothing stored", async () => {
    const w = world({ DO_NOT_TRACK: "1" });
    const io = terminal("y");
    expect(await init(w, ARGS, { interactive: true, promptIO: io })).toBe(0);
    expect(io.printed()).not.toContain("share usage metrics");
    expect(existsSync(consentPath(w.home))).toBe(false);
  });

  test("--dry-run in a terminal: not asked and nothing stored", async () => {
    const w = world();
    const io = terminal("y");
    await init(w, [...ARGS, "--dry-run"], { interactive: true, promptIO: io });
    expect(io.printed()).not.toContain("share usage metrics");
    expect(existsSync(consentPath(w.home))).toBe(false);
  });
});
