/**
 * A distributed-repo review never touches the network (ADR 0043): `git` on PATH is a wrapper that
 * refuses fetch, pull, clone and ls-remote and writes down every call, and `gh` always fails. Each
 * version rule runs through the real CLI, and so does `ask` on a stored review. The wrapper must never
 * have refused anything. Names are invented; no model, no network.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commit, git, removeTempRepos } from "../test/support/temp-repo";
import { MANIFEST_FILE } from "./workspace/manifest";
import { userFilePath } from "./workspace/user-file";

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
const PALETTE = "Assets/palette.json";

const MANIFEST = {
  format: "workspace/1",
  members: [
    { dir: "desktop-app", repo: "acme/desktop-app", visibility: "private" },
    { dir: "web-site", repo: "acme/web-site", visibility: "public" },
  ],
  contracts: [
    {
      name: "brand-palette",
      sides: [
        { member: "desktop-app", role: "provider", paths: [PALETTE] },
        { member: "web-site", role: "consumer", paths: ["packages/tokens/src/**"] },
      ],
      sourceOfTruth: { member: "desktop-app", paths: [PALETTE] },
    },
  ],
};

const REAL_GIT = Bun.spawnSync(["which", "git"]).stdout.toString().trim();

/** `git` and `gh` wrappers first on PATH, and a `claude` stub that answers reviews and `ask`. */
function tools() {
  const bin = temp("wachiman-nofetch-bin-");
  const refused = join(bin, "refused.log");
  const seen = join(bin, "git-calls.log");
  writeFileSync(
    join(bin, "git"),
    `#!/bin/sh
echo "$*" >> "${seen}"
sub=""
skip=0
for a in "$@"; do
  if [ "$skip" = 1 ]; then skip=0; continue; fi
  case "$a" in
    -C|-c|--git-dir|--work-tree|--namespace|--exec-path) skip=1 ;;
    -*) ;;
    *) sub="$a"; break ;;
  esac
done
case "$sub" in
  fetch|pull|clone|ls-remote)
    echo "git $sub refused: a distributed-repo run must not use the network" >&2
    echo "$sub" >> "${refused}"
    exit 97 ;;
esac
exec "${REAL_GIT}" "$@"
`,
  );
  writeFileSync(join(bin, "gh"), `#!/bin/sh\necho "gh $*" >> "${refused}"\necho "gh refused" >&2\nexit 97\n`);
  writeFileSync(
    join(bin, "claude"),
    `#!${process.execPath}
import { readFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "auth") { console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", configDirectory: process.env.CLAUDE_CONFIG_DIR })); process.exit(0); }
if (args[0] === "--version") { console.log("9.9.9 (Claude Code)"); process.exit(0); }
const prompt = readFileSync(0, "utf8");
const envelope = (structured) => JSON.stringify({ is_error: false, subtype: "success", num_turns: 1, total_cost_usd: 0.01, duration_ms: 1, structured_output: structured });
if (prompt.includes("Rules for every answer")) {
  console.log(envelope({ sections: [{ title: "What the change does", body: "It changes the brand colour.", refs: [{ path: "${TRIGGER}", line: 1 }] }], not_answered: "" }));
  process.exit(0);
}
const block = prompt.split("This part holds exactly these files")[1]?.split("Each diff line")[0] ?? "";
const files = block.split("\\n").flatMap((l) => (l.startsWith("- ") ? [l.slice(2).replace(/ \\+\\d+ −\\d+$/, "")] : []));
console.log(envelope({ files_reviewed: files, files_skipped: [], findings: [], contracts: [], thread_replies: [], summary: "clean" }));
`,
  );
  for (const f of ["git", "gh", "claude"]) chmodSync(join(bin, f), 0o755);
  return {
    bin,
    /** The subcommands the wrapper refused, or "" when it refused nothing. */
    refused: () => (existsSync(refused) ? readFileSync(refused, "utf8") : ""),
    /** Whether the wrapper ran at all, so an empty refusal log means something. */
    seen: () => (existsSync(seen) ? readFileSync(seen, "utf8") : ""),
  };
}

/** `desktop-app` with a `v1` tag and a `v1.2.3` tag; `web-site` pins `1.2.3` in its package.json. */
function workspace(userVersion: Record<string, unknown>, options: { remoteDefault?: boolean } = {}) {
  const parent = temp("wachiman-nofetch-site-");
  const webSite = join(parent, "web-site");
  mkdirSync(webSite);
  git(webSite, "init", "-q", "-b", "main");
  const pin = (v: string) => JSON.stringify({ dependencies: { "@acme/desktop.app": v } });
  commit(webSite, { [TRIGGER]: "export const brand = '#000';\n", "package.json": pin("1.2.3") }, "base");
  git(webSite, "switch", "-q", "-c", "feat/x");
  commit(webSite, { [TRIGGER]: "export const brand = '#0a7';\n" }, "edit tokens");
  git(webSite, "remote", "add", "origin", "https://github.com/acme/web-site.git");
  const desktopApp = join(parent, "desktop-app");
  mkdirSync(desktopApp);
  git(desktopApp, "init", "-q", "-b", "main");
  commit(desktopApp, { [PALETTE]: '{"brand":"#000"}\n' }, "first palette");
  git(desktopApp, "tag", "v1");
  git(desktopApp, "tag", "v1.2.3");
  commit(desktopApp, { [PALETTE]: '{"brand":"#0a7"}\n' }, "second palette");
  if (options.remoteDefault) {
    git(desktopApp, "update-ref", "refs/remotes/origin/main", "HEAD");
    git(desktopApp, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  }
  writeFileSync(join(parent, MANIFEST_FILE), JSON.stringify(MANIFEST));
  const home = temp("wachiman-nofetch-home-");
  writeFileSync(
    userFilePath(home),
    JSON.stringify({
      version: 1,
      workspaces: [{ manifest: join(parent, MANIFEST_FILE), distributedRepo: "on", versions: { "brand-palette": userVersion } }],
    }),
  );
  return { webSite, home };
}

function cliRun(s: { webSite: string; home: string }, t: ReturnType<typeof tools>, args: string[]) {
  const env: Record<string, string> = {
    PATH: `${t.bin}:${process.env.PATH ?? ""}`,
    HOME: temp("wachiman-nofetch-user-"),
    USER: "dev",
    WACHIMAN_HOME: s.home,
    WACHIMAN_VERIFY: "0",
  };
  const out = Bun.spawnSync([process.execPath, cli, ...args, "--repo-dir", s.webSite], { env, stdin: "ignore" });
  return { code: out.exitCode, stdout: out.stdout.toString(), stderr: out.stderr.toString() };
}

const noFetch = (t: ReturnType<typeof tools>) => {
  expect(t.seen()).not.toBe("");
  expect(t.refused()).toBe("");
};

const RULES: [string, Record<string, unknown>, { remoteDefault?: boolean }, RegExp][] = [
  ["pinned, a literal ref", { rule: "pinned", ref: "v1" }, {}, /sibling: desktop-app, commit/],
  [
    "pinned, a JSON key path",
    { rule: "pinned", pin: { file: "package.json", key: ["dependencies", "@acme/desktop.app"], tag: "v{version}" } },
    {},
    /sibling: desktop-app, commit/,
  ],
  ["local", { rule: "local" }, {}, /sibling: desktop-app, commit/],
  ["tip", { rule: "tip" }, { remoteDefault: true }, /sibling: desktop-app, commit/],
  ["pinned that falls back to tip", { rule: "pinned", ref: "no-such-ref" }, { remoteDefault: true }, /read tip instead/],
];

describe("a distributed-repo run never fetches, pulls, clones or calls gh", () => {
  for (const [name, spec, options, expected] of RULES) {
    test(`wachiman local, ${name}`, () => {
      const t = tools();
      const r = cliRun(workspace(spec, options), t, ["local", "--distributed-repo", "--base", "main"]);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stderr).toMatch(expected);
      noFetch(t);
    }, 60_000);
  }

  test("wachiman ask on a stored distributed review", () => {
    const t = tools();
    const s = workspace({ rule: "local" });
    expect(cliRun(s, t, ["local", "--distributed-repo", "--base", "main", "--history"]).code).toBe(0);
    const before = t.seen();
    const r = cliRun(s, t, ["ask", "what changed?", "--base", "main"]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain("It changes the brand colour.");
    // The calls only `ask` made: it checked the stored commit in the sibling and re-created its snapshot, so the empty refusal log is not vacuous.
    const calls = t.seen().slice(before.length).split("\n");
    const stored = calls.map((c) => c.match(/cat-file -e ([0-9a-f]{40})\^\{commit\}/)?.[1]).find((sha) => sha !== undefined);
    expect(stored).toBeDefined();
    expect(calls.some((c) => c.includes(`ls-tree -r -z --full-tree ${stored}`))).toBe(true);
    expect(calls.some((c) => c.endsWith("cat-file --batch"))).toBe(true);
    noFetch(t);
  }, 60_000);

  test("the wrapper does refuse a fetch, so an empty log is evidence", () => {
    const t = tools();
    const dir = temp("wachiman-nofetch-probe-");
    git(dir, "init", "-q", "-b", "main");
    const env = { PATH: `${t.bin}:${process.env.PATH ?? ""}` };
    for (const args of [["fetch"], ["-C", dir, "pull"], ["-c", "a=b", "clone", "x"], ["ls-remote"]]) {
      expect(Bun.spawnSync(["git", ...args], { cwd: dir, env }).exitCode, args.join(" ")).toBe(97);
    }
    expect(Bun.spawnSync(["git", "-C", dir, "status"], { env }).exitCode).toBe(0);
    expect(t.refused().trim().split("\n")).toEqual(["fetch", "pull", "clone", "ls-remote"]);
  });
});
