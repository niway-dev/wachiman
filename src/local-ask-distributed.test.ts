/**
 * `wachiman ask` on a stored distributed-repo review (ADR 0043 decision 5): the real CLI, a stub
 * `claude` that records every call, and a `gh` that leaves a canary. No model, no network. The review
 * is stored by a real `local --distributed-repo --history` run, so ask reads what that run wrote.
 */
import { afterAll, describe, expect, test as bunTest } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commit, git, removeTempRepos } from "../test/support/temp-repo";
import { MANIFEST_FILE } from "./workspace/manifest";
import { userFilePath } from "./workspace/user-file";

// Each test runs the CLI several times; under load that passes the default 5 s.
const test = (name: string, fn: () => void) => bunTest(name, fn, 60_000);

const temps: string[] = [];
const temp = (prefix: string) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  removeTempRepos();
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const cli = join(import.meta.dir, "cli.ts");
const TRIGGER = "packages/tokens/src/palette.ts";
const OTHER = "docs/readme.md";
const PRIVATE_LINE = "Built with private context from: desktop-app. Do not paste its text into a public place.";

const manifest = (visibility: "public" | "private") => ({
  format: "workspace/1",
  members: [
    { dir: "desktop-app", repo: "acme/desktop-app", visibility },
    { dir: "web-site", repo: "acme/web-site", visibility: "public" },
  ],
  contracts: [
    {
      name: "brand-palette",
      sides: [
        { member: "desktop-app", role: "provider", paths: ["Assets/palette.json"] },
        { member: "web-site", role: "consumer", paths: ["packages/tokens/src/**"] },
      ],
      sourceOfTruth: { member: "desktop-app", paths: ["Assets/palette.json"] },
    },
  ],
});

/**
 * A `claude` stub. A review prompt gets a clean review of the files its prompt lists. An ask prompt
 * (it holds "Rules for every answer") is recorded in `asks/<pid>.json`, with the content of the sibling
 * snapshot it was given at the time of the call (the directory is gone afterwards), and answered with
 * the contents of `answer.json` in the bin directory.
 */
function stubs() {
  const bin = temp("wachiman-ask-bin-");
  mkdirSync(join(bin, "asks"));
  const canary = join(bin, "gh-called");
  writeFileSync(join(bin, "gh"), `#!/bin/sh\necho called >> "${canary}"\nexit 99\n`);
  writeFileSync(
    join(bin, "claude"),
    `#!${process.execPath}
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "auth") {
  console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", configDirectory: process.env.CLAUDE_CONFIG_DIR }));
  process.exit(0);
}
if (args[0] === "--version") {
  console.log("9.9.9 (Claude Code)");
  process.exit(0);
}
const prompt = readFileSync(0, "utf8");
const dirs = args.flatMap((a, i) => (args[i - 1] === "--add-dir" ? [a] : []));
const envelope = (structured) => JSON.stringify({ is_error: false, subtype: "success", num_turns: 1, total_cost_usd: 0.01, duration_ms: 1, structured_output: structured });
if (prompt.includes("Rules for every answer")) {
  const snapshot = dirs.find((d) => existsSync(d + "/Assets/palette.json"));
  writeFileSync("${bin}/asks/" + process.pid + ".json", JSON.stringify({
    prompt, dirs, snapshot: snapshot ?? null,
    palette: snapshot ? readFileSync(snapshot + "/Assets/palette.json", "utf8") : null,
    hasGit: snapshot ? existsSync(snapshot + "/.git") : null,
    schema: args[args.indexOf("--json-schema") + 1] ?? null,
  }));
  console.log(envelope(JSON.parse(readFileSync("${bin}/answer.json", "utf8"))));
  process.exit(0);
}
const block = prompt.split("This part holds exactly these files")[1]?.split("Each diff line")[0] ?? "";
const files = block.split("\\n").flatMap((l) => (l.startsWith("- ") ? [l.slice(2).replace(/ \\+\\d+ −\\d+$/, "")] : []));
console.log(envelope({ files_reviewed: files, files_skipped: [], findings: [], contracts: [], thread_replies: [], summary: "clean" }));
`,
  );
  chmodSync(join(bin, "gh"), 0o755);
  chmodSync(join(bin, "claude"), 0o755);
  const answer = (value: object) => writeFileSync(join(bin, "answer.json"), JSON.stringify(value));
  answer({ sections: [{ title: "What the change does", body: "It changes the brand colour.", refs: [{ path: TRIGGER, line: 1 }] }], not_answered: "" });
  return {
    bin,
    canary,
    answer,
    asks: (): { prompt: string; dirs: string[]; snapshot: string | null; palette: string | null; hasGit: boolean | null; schema: string | null }[] =>
      readdirSync(join(bin, "asks")).map((f) => JSON.parse(readFileSync(join(bin, "asks", f), "utf8"))),
  };
}

interface Site {
  parent: string;
  webSite: string;
  desktopApp: string;
  home: string;
  /** desktop-app's commits: the one the review reads (HEAD when it ran), and the one before it. */
  before: string;
  reviewed: string;
}

function site(options: { visibility?: "public" | "private"; userFile?: Record<string, unknown> } = {}): Site {
  const parent = temp("wachiman-site-");
  const webSite = join(parent, "web-site");
  mkdirSync(webSite);
  git(webSite, "init", "-q", "-b", "main");
  commit(webSite, { [TRIGGER]: "export const brand = '#000';\n", [OTHER]: "# readme\n" }, "base");
  git(webSite, "switch", "-q", "-c", "feat/x");
  commit(webSite, { [TRIGGER]: "export const brand = '#0a7';\n", [OTHER]: "# readme\n\nChanged.\n" }, "edit tokens and readme");
  git(webSite, "remote", "add", "origin", "https://github.com/acme/web-site.git");
  const desktopApp = join(parent, "desktop-app");
  mkdirSync(desktopApp);
  git(desktopApp, "init", "-q", "-b", "main");
  const before = commit(desktopApp, { "Assets/palette.json": '{"brand":"#000"}\n' }, "first palette");
  const reviewed = commit(desktopApp, { "Assets/palette.json": '{"brand":"#0a7"}\n' }, "second palette");
  writeFileSync(join(parent, MANIFEST_FILE), JSON.stringify(manifest(options.visibility ?? "private")));
  const home = temp("wachiman-home-");
  if (options.userFile) writeFileSync(userFilePath(home), JSON.stringify({ version: 1, workspaces: [{ manifest: join(parent, MANIFEST_FILE), ...options.userFile }] }));
  return { parent, webSite, desktopApp, home, before, reviewed };
}

function cliRun(s: Site, stub: ReturnType<typeof stubs>, args: string[]) {
  const env: Record<string, string> = {
    PATH: `${stub.bin}:${process.env.PATH ?? ""}`,
    HOME: temp("wachiman-user-"),
    USER: "dev",
    WACHIMAN_HOME: s.home,
    WACHIMAN_VERIFY: "0",
    WACHIMAN_BATCH_LINES: "1",
  };
  const out = Bun.spawnSync([process.execPath, cli, ...args, "--repo-dir", s.webSite], { env, stdin: "ignore" });
  return { code: out.exitCode, stdout: out.stdout.toString(), stderr: out.stderr.toString() };
}

/** Stores a review of the branch under `s.home`. */
function review(s: Site, stub: ReturnType<typeof stubs>, ...flags: string[]) {
  const r = cliRun(s, stub, ["local", "--base", "main", "--history", ...flags]);
  expect(r.code).toBe(0);
  return r;
}
const ask = (s: Site, stub: ReturnType<typeof stubs>, ...args: string[]) => cliRun(s, stub, ["ask", ...args, "--base", "main"]);

const short = (sha: string) => sha.slice(0, 7);

describe("ask on a stored review that read a sibling", () => {
  test("without the flag it re-creates the snapshot at the stored commit, not the clone's HEAD, and removes it afterwards", () => {
    const s = site();
    const stub = stubs();
    review(s, stub, "--distributed-repo");
    // The sibling moves on after the review: ask must still read what the review read.
    commit(s.desktopApp, { "Assets/palette.json": '{"brand":"#fff"}\n' }, "moved on");

    const r = ask(s, stub, "what changed?");
    expect(r.code).toBe(0);
    const [call] = stub.asks();
    expect(call.snapshot).not.toBeNull();
    expect(call.dirs).toContain(call.snapshot!);
    expect(call.palette).toBe('{"brand":"#0a7"}\n');
    expect(call.hasGit).toBe(false);
    expect(call.prompt).toContain(`desktop-app@${short(s.reviewed)}`);
    expect(call.prompt).toContain("Sibling repositories of the review");
    expect(JSON.parse(call.schema!).properties.sections.items.properties.refs.items.properties.member).toBeDefined();
    expect(existsSync(call.snapshot!)).toBe(false);
    expect(existsSync(stub.canary)).toBe(false);
  });

  test("--distributed-repo does the same", () => {
    const s = site();
    const stub = stubs();
    review(s, stub, "--distributed-repo");
    const r = ask(s, stub, "--distributed-repo", "what changed?");
    expect(r.code).toBe(0);
    expect(stub.asks()[0].palette).toBe('{"brand":"#0a7"}\n');
  });

  test("a reference into the sibling is checked in the snapshot: a good one is kept in full, a bad one in refs and one written in the text are removed and counted", () => {
    const s = site();
    const stub = stubs();
    review(s, stub, "--distributed-repo");
    const sha7 = short(s.reviewed);
    stub.answer({
      sections: [
        {
          title: "Palette",
          body: `The source is desktop-app@${sha7}:Assets/palette.json:1 and not desktop-app@${sha7}:Assets/palette.json:99.`,
          refs: [
            { path: TRIGGER, line: 1 },
            { path: "Assets/palette.json", line: 1, member: "desktop-app", sha: sha7 },
            { path: "Assets/palette.json", line: 99, member: "desktop-app", sha: sha7 },
            { path: "Assets/palette.json", line: 1, member: "billing-service", sha: sha7 },
          ],
        },
      ],
      not_answered: "",
    });
    const plain = ask(s, stub, "what is the palette?");
    expect(plain.code).toBe(0);
    expect(plain.stdout).toContain(`Refs: ${TRIGGER}:1, desktop-app@${sha7}:Assets/palette.json:1`);
    expect(plain.stdout).toContain("desktop-app@" + sha7 + ":Assets/palette.json:1 and not [sibling reference removed: it could not be checked].");
    expect(plain.stdout).toContain("3 references could not be checked and were removed.");
    expect(plain.stdout).not.toContain("wachiman-sibling");

    const json = JSON.parse(ask(s, stub, "what is the palette?", "--format", "json").stdout);
    expect(json.removedRefs).toBe(3);
    expect(json.sections[0].refs).toEqual([
      { path: TRIGGER, line: 1 },
      { path: "Assets/palette.json", line: 1, member: "desktop-app", sha: s.reviewed },
    ]);
    expect(json.siblings).toEqual([{ member: "desktop-app", sha: s.reviewed, read: true }]);
  });

  test("a commit that is gone is named, nothing is fetched, the answer still comes, and a reference into it is removed and counted", () => {
    const s = site();
    const stub = stubs();
    review(s, stub, "--distributed-repo");
    git(s.desktopApp, "reset", "-q", "--hard", s.before);
    git(s.desktopApp, "reflog", "expire", "--expire=now", "--all");
    git(s.desktopApp, "gc", "-q", "--prune=now");
    const sha7 = short(s.reviewed);
    stub.answer({
      sections: [{ title: "Palette", body: "See it.", refs: [{ path: "Assets/palette.json", line: 1, member: "desktop-app", sha: sha7 }] }],
      not_answered: "",
    });
    const r = ask(s, stub, "what is the palette?");
    expect(r.code).toBe(0);
    const [call] = stub.asks();
    expect(call.snapshot).toBeNull();
    expect(call.prompt).toContain(`desktop-app@${sha7}: could not be read`);
    expect(r.stdout).toContain(`Could not read sibling desktop-app@${sha7}: the commit ${sha7} is gone from its clone; Wachiman never fetches.`);
    expect(r.stdout).toContain("1 reference could not be checked and was removed.");
    expect(r.stdout).not.toContain(`desktop-app@${sha7}:Assets/palette.json:1`);
    expect(existsSync(stub.canary)).toBe(false);
  });

  test("a member that is not cloned any more is named and the answer still comes", () => {
    const s = site();
    const stub = stubs();
    review(s, stub, "--distributed-repo");
    rmSync(s.desktopApp, { recursive: true, force: true });
    const r = ask(s, stub, "what is the palette?");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Could not read sibling desktop-app@");
    expect(r.stdout).toContain("not cloned");
    expect(stub.asks()[0].snapshot).toBeNull();
  });
});

describe("the label", () => {
  test("an answer grounded in a review with a private sibling says so, in text and in JSON", () => {
    const s = site({ visibility: "private" });
    const stub = stubs();
    review(s, stub, "--distributed-repo");
    const text = ask(s, stub, "what changed?");
    expect(text.stdout).toContain(PRIVATE_LINE);
    const json = JSON.parse(ask(s, stub, "what changed?", "--format", "json").stdout);
    expect(json.privateContext).toEqual({ members: ["desktop-app"] });
  });

  test("with only public siblings, or no sibling at all, there is no label", () => {
    const pub = site({ visibility: "public" });
    const stub = stubs();
    review(pub, stub, "--distributed-repo");
    const text = ask(pub, stub, "what changed?");
    expect(text.stdout).not.toContain("private context");
    expect(stub.asks()[0].snapshot).not.toBeNull();

    const none = site();
    const stub2 = stubs();
    review(none, stub2);
    const plain = ask(none, stub2, "what changed?");
    expect(plain.code).toBe(0);
    expect(plain.stdout).not.toContain("private context");
    expect(JSON.parse(ask(none, stub2, "what changed?", "--format", "json").stdout)).not.toHaveProperty("privateContext");
    expect(JSON.parse(ask(none, stub2, "what changed?", "--format", "json").stdout)).not.toHaveProperty("siblings");
    expect(stub2.asks()[0].prompt).not.toContain("Sibling repositories of the review");
  });
});

describe("--distributed-repo with nothing stored to read", () => {
  const MESSAGE = 'Run "wachiman local --distributed-repo --history" first.';

  test("a stored review that read no sibling: exit 2 and the way forward", () => {
    const s = site();
    const stub = stubs();
    review(s, stub);
    const r = ask(s, stub, "--distributed-repo", "what changed?");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("the stored review of this change read no sibling");
    expect(r.stderr).toContain(MESSAGE);
    expect(stub.asks()).toHaveLength(0);
  });

  test("no stored review: exit 2 and the way forward", () => {
    const s = site();
    const stub = stubs();
    const r = ask(s, stub, "--distributed-repo", "what changed?");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("there is no stored review of this change");
    expect(r.stderr).toContain(MESSAGE);
    expect(stub.asks()).toHaveLength(0);
  });

  test("--no-distributed-repo and --sibling are still usage errors", () => {
    const s = site();
    const stub = stubs();
    for (const flag of [["--no-distributed-repo"], ["--sibling", "desktop-app"]]) {
      const r = ask(s, stub, ...flag, "what changed?");
      expect(r.code).toBe(2);
      expect(r.stderr).toContain(`Unknown option ${flag[0]} for ask.`);
    }
  });

  test("a per-user default of on does nothing there, and one line says so", () => {
    const s = site({ userFile: { distributedRepo: "on" } });
    const stub = stubs();
    review(s, stub, "--no-distributed-repo");
    const r = ask(s, stub, "what changed?");
    expect(r.code).toBe(0);
    const lines = r.stderr.split("\n").filter((l) => l.includes("distributed-repo"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("does nothing for ask");
    expect(lines[0]).toContain("the stored review of this change read no sibling");
    const [call] = stub.asks();
    expect(call.snapshot).toBeNull();
    expect(call.prompt).not.toContain("Sibling repositories of the review");

    // With no stored review at all it says that instead, and still answers from the diff.
    const bare = site({ userFile: { distributedRepo: "on" } });
    const stub2 = stubs();
    const again = ask(bare, stub2, "what changed?");
    expect(again.code).toBe(0);
    expect(again.stderr.split("\n").filter((l) => l.includes("distributed-repo"))).toHaveLength(1);
    expect(again.stderr).toContain("there is no stored review of this change");
  });

  test("without any default there is no such line", () => {
    const s = site();
    const stub = stubs();
    review(s, stub);
    expect(ask(s, stub, "what changed?").stderr).not.toContain("distributed-repo");
  });
});
