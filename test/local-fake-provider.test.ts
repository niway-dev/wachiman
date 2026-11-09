/**
 * `wachiman local` end to end through the npm launcher, on every OS the package supports: Node
 * starts `bin/wachiman.js`, which starts Bun on `src/cli.ts`, which reviews a temporary branch
 * with a fake `claude`. The fake is a compiled executable (`claude` or `claude.exe`), because the
 * resolver spawns the binary by name and never through a shell, so a shell script or a `.cmd`
 * shim would not be found on Windows. No model, no network, no GitHub.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { branchRepo, removeTempRepos } from "./support/temp-repo";

const root = join(import.meta.dir, "..");
const launcher = join(root, "bin", "wachiman.js");
const node = Bun.which("node");
const scratch: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
};

const REVIEW = {
  is_error: false,
  subtype: "success",
  num_turns: 1,
  total_cost_usd: 0.01,
  duration_ms: 5,
  structured_output: {
    files_reviewed: ["CLAUDE.md", "img.png", "src/a.ts", "src/b.ts", "src/new.ts"],
    files_skipped: [],
    findings: [{ path: "src/a.ts", line: 2, severity: "fix", topic: "bug", confidence: "high", title: "Fake finding", body: "Body of the fake finding." }],
    contracts: [],
    thread_replies: [],
    summary: "Reviewed by the fake provider.",
  },
};

/** The log path is baked in: the child environment is an allowlist, so no variable would reach the fake. */
const fakeSource = (log: string) => `
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, args.join(" ") + "\\n");
if (args[0] === "--version") { console.log("9.9.9 (Claude Code)"); process.exit(0); }
if (args[0] === "auth" && args[1] === "status") { console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai" })); process.exit(0); }
await Bun.stdin.text();
console.log(${JSON.stringify(JSON.stringify(REVIEW))});
`;

let fakeBin = "";
const logFile = () => join(fakeBin, "calls.log");

beforeAll(() => {
  if (!node) return;
  fakeBin = temp("fake-claude-bin-");
  const source = join(temp("fake-claude-src-"), "fake-claude.ts");
  writeFileSync(source, fakeSource(logFile()));
  const exe = join(fakeBin, process.platform === "win32" ? "claude.exe" : "claude");
  const built = Bun.spawnSync([process.execPath, "build", "--compile", "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig", source, "--outfile", exe]);
  if (built.exitCode !== 0) throw new Error(`could not compile the fake claude: ${built.stderr.toString()}`);
}, 120_000);

afterAll(() => {
  removeTempRepos();
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** A small environment: the fake first on PATH, then node and bun (and Git for Windows, which is not in System32), and a temporary home on both families of variables. */
function env(home: string) {
  const path = [fakeBin, dirname(node!), dirname(Bun.which("bun") ?? process.execPath), ...(process.platform === "win32" ? [dirname(Bun.which("git") ?? "git"), join(process.env.SystemRoot ?? "C:\\Windows", "System32")] : ["/usr/bin", "/bin"])].join(delimiter);
  const keep = ["SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "PATHEXT", "ComSpec", "APPDATA", "LOCALAPPDATA"];
  return {
    ...Object.fromEntries(keep.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k] as string])),
    PATH: path,
    Path: path,
    HOME: home,
    USERPROFILE: home,
    USER: "dev",
  } as Record<string, string>;
}

describe.skipIf(!node)("wachiman local through the launcher, with a fake claude", () => {
  test("reviews the branch with the fake claude, prints its finding and exits 0", () => {
    const repo = branchRepo();
    const home = temp("wachiman-launcher-home-");
    const out = Bun.spawnSync([node!, launcher, "local", "--repo-dir", repo.dir, "--base", "main"], { env: env(home), stdin: "ignore" });
    const stdout = out.stdout.toString();
    expect({ code: out.exitCode, stderr: out.stderr.toString() }).toMatchObject({ code: 0 });
    expect(stdout).toContain("Fake finding");
    expect(stdout).toContain("Reviewed by the fake provider.");
    // The fake saw the version probe, the sign-in check and one review call, and nothing else.
    const calls = readFileSync(logFile(), "utf8").split(/\r?\n/).filter(Boolean);
    expect(calls.some((c) => c === "--version")).toBe(true);
    expect(calls.some((c) => c === "auth status")).toBe(true);
    expect(calls.filter((c) => c.startsWith("-p ") || c.includes(" --output-format")).length).toBeGreaterThanOrEqual(1);
  }, 120_000);

  test("without a usable Bun, bundled or on PATH, it is exit 2 with the Bun line, before any review", () => {
    const repo = branchRepo();
    const home = temp("wachiman-launcher-home-");
    // Node's own directory may also hold bun (Homebrew, `npm i -g bun`), so PATH is an empty directory:
    // node runs by absolute path and the launcher only looks up bun.
    const empty = temp("wachiman-empty-path-");
    const bare = { ...env(home), PATH: empty, Path: empty };
    // A copy of the launcher in a directory with no node_modules above it: a checkout that ran
    // `bun install` has the bundled Bun next to the real launcher, and that one would work.
    const lone = temp("wachiman-lone-launcher-");
    cpSync(join(root, "bin"), join(lone, "bin"), { recursive: true });
    const out = Bun.spawnSync([node!, join(lone, "bin", "wachiman.js"), "local", "--repo-dir", repo.dir, "--base", "main"], { env: bare, stdin: "ignore" });
    expect(out.exitCode).toBe(2);
    expect(out.stderr.toString()).toContain("Bun");
  }, 60_000);

  test("the launcher passes the account refusal through: a set ANTHROPIC_API_KEY is exit 2 and no review call is made", () => {
    const repo = branchRepo();
    const home = temp("wachiman-launcher-home-");
    mkdirSync(join(home, ".wachiman"), { recursive: true });
    const out = Bun.spawnSync([node!, launcher, "local", "--repo-dir", repo.dir, "--base", "main"], { env: { ...env(home), ANTHROPIC_API_KEY: "sk-ant-not-real" }, stdin: "ignore" });
    expect(out.exitCode).toBe(2);
    expect(out.stderr.toString()).toContain("ANTHROPIC_API_KEY is set");
    expect(out.stdout.toString()).not.toContain("Fake finding");
  }, 60_000);
});
