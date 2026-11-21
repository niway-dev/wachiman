/**
 * `wachiman loop` with a workspace manifest around the repository: the real CLI and a stub `claude`
 * that records every prompt. A per-user default or a flag decides whether a round reads the sibling.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commit, git, removeTempRepos } from "../../test/support/temp-repo";
import { MANIFEST_FILE } from "../workspace/manifest";
import { userFilePath } from "../workspace/user-file";

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

const cli = join(import.meta.dir, "..", "cli.ts");
const SECTION = "## Workspace contracts and sibling repositories";
const PRIVATE_LINE = "Built with private context from: desktop-app. Do not paste its text into a public place.";
const TRIGGER = "packages/tokens/src/palette.ts";

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
        { member: "desktop-app", role: "provider", paths: ["Assets/palette.json"] },
        { member: "web-site", role: "consumer", paths: ["packages/tokens/src/**"] },
      ],
      sourceOfTruth: { member: "desktop-app", paths: ["Assets/palette.json"] },
    },
  ],
};

/** A `claude` stub that keeps each prompt and answers a clean review of the files the prompt lists. */
function stub() {
  const bin = temp("wachiman-bin-");
  const calls = join(bin, "calls");
  mkdirSync(calls);
  writeFileSync(
    join(bin, "claude"),
    `#!${process.execPath}
import { readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "auth") { console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", configDirectory: process.env.CLAUDE_CONFIG_DIR })); process.exit(0); }
if (args[0] === "--version") { console.log("9.9.9 (Claude Code)"); process.exit(0); }
const prompt = readFileSync(0, "utf8");
writeFileSync("${calls}/" + process.pid + ".txt", prompt);
const block = prompt.split("This part holds exactly these files")[1]?.split("Each diff line")[0] ?? "";
const files = block.split("\\n").flatMap((l) => (l.startsWith("- ") ? [l.slice(2).replace(/ \\+\\d+ −\\d+$/, "")] : []));
console.log(JSON.stringify({ is_error: false, subtype: "success", num_turns: 1, total_cost_usd: 0.01, duration_ms: 1,
  structured_output: { files_reviewed: files, files_skipped: [], findings: [], contracts: [], thread_replies: [], summary: "clean" } }));
`,
  );
  chmodSync(join(bin, "claude"), 0o755);
  return { bin, prompts: () => readdirSync(calls).map((f) => readFileSync(join(calls, f), "utf8")) };
}

function site(userFile?: Record<string, unknown>) {
  const parent = temp("wachiman-site-");
  const webSite = join(parent, "web-site");
  mkdirSync(webSite);
  git(webSite, "init", "-q", "-b", "main");
  commit(webSite, { [TRIGGER]: "export const brand = '#000';\n" }, "base");
  git(webSite, "switch", "-q", "-c", "feat/x");
  commit(webSite, { [TRIGGER]: "export const brand = '#0a7';\n" }, "edit tokens");
  git(webSite, "remote", "add", "origin", "https://github.com/acme/web-site.git");
  const desktopApp = join(parent, "desktop-app");
  mkdirSync(desktopApp);
  git(desktopApp, "init", "-q", "-b", "main");
  commit(desktopApp, { "Assets/palette.json": '{"brand":"#0a7"}\n' }, "palette");
  writeFileSync(join(parent, MANIFEST_FILE), JSON.stringify(MANIFEST));
  const home = temp("wachiman-home-");
  if (userFile) writeFileSync(userFilePath(home), JSON.stringify({ version: 1, workspaces: [{ manifest: join(parent, MANIFEST_FILE), ...userFile }] }));
  return { webSite, home };
}

function loop(userFile: Record<string, unknown> | undefined, args: string[]) {
  const s = site(userFile);
  const claude = stub();
  const env = { PATH: `${claude.bin}:${process.env.PATH ?? ""}`, HOME: temp("wachiman-user-"), USER: "dev", WACHIMAN_HOME: s.home, WACHIMAN_VERIFY: "0" };
  const out = Bun.spawnSync([process.execPath, cli, "loop", "--repo-dir", s.webSite, "--base", "main", ...args], { env, stdin: "ignore" });
  return { code: out.exitCode, stdout: out.stdout.toString(), stderr: out.stderr.toString(), prompts: claude.prompts() };
}

const ON = { distributedRepo: "on", versions: { "brand-palette": { rule: "local" } } };

describe("wachiman loop and the distributed-repo mode", () => {
  test("with a per-user default of on, a round reads the sibling and the loop prints the private-context line once", () => {
    const r = loop(ON, []);
    expect(r.code).toBe(0);
    expect(r.prompts.some((p) => p.includes(SECTION))).toBe(true);
    expect(r.stdout.split(PRIVATE_LINE)).toHaveLength(2);
  }, 60_000);

  test("--no-distributed-repo turns a default of on off: nothing is read and no line is printed", () => {
    const r = loop(ON, ["--no-distributed-repo"]);
    expect(r.code).toBe(0);
    for (const p of r.prompts) expect(p).not.toContain(SECTION);
    expect(r.stdout).not.toContain("private context");
  }, 60_000);

  test("without a default or a flag nothing is read, and the prompts are those of a repository with no manifest", () => {
    const r = loop(undefined, []);
    expect(r.code).toBe(0);
    expect(r.prompts.length).toBeGreaterThan(0);
    for (const p of r.prompts) expect(p).not.toContain(SECTION);
    expect(r.stdout).not.toContain("private context");
    expect(r.stderr).not.toContain("distributed-repo");
  }, 60_000);

  test("exit-2 combinations of local are refused: both flags, --sibling with --no-distributed-repo, --sibling that is no member", () => {
    for (const args of [["--distributed-repo", "--no-distributed-repo"], ["--no-distributed-repo", "--sibling", "desktop-app"], ["--distributed-repo", "--sibling", "nowhere"]]) {
      const r = loop(undefined, args);
      expect(r.code, args.join(" ")).toBe(2);
      expect(r.prompts).toHaveLength(0);
    }
  }, 60_000);
});
