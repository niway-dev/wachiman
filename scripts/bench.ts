/**
 * Benchmark of the engine, without model time and without network.
 *
 *   bun run bench                 table on stdout
 *   bun run bench --json          JSON on stdout (the table is not printed)
 *   bun run bench --runs 25       CLI and review runs (default 15); the test case runs 5
 *
 * Every case spawns the repo's own pinned Bun by path (never PATH), with a temporary
 * `WACHIMAN_HOME`, and must exit 0: one nonzero exit fails the whole bench (exit 1).
 * The `local review` case drives the real `wachiman local` pipeline with the same fake `claude`
 * the launcher test uses (test/local-fake-provider.test.ts), on a fixed fixture repo and diff.
 * The fake is compiled once, outside the timings. The host name is never recorded.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { branchRepo, removeTempRepos } from "../test/support/temp-repo";

const root = join(import.meta.dir, "..");
const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const runsFlag = argv.indexOf("--runs");
const runs = runsFlag >= 0 ? Number(argv[runsFlag + 1]) : 15;
if (!Number.isInteger(runs) || runs < 3) {
  console.error("--runs needs an integer of at least 3");
  process.exit(2);
}

const pinned = join(root, "node_modules", ".bin", process.platform === "win32" ? "bun.exe" : "bun");
if (!existsSync(pinned)) {
  console.error(`The pinned Bun is missing at ${pinned}. Run \`bun install --frozen-lockfile\` first.`);
  process.exit(2);
}
const node = Bun.which("node");

const scratch: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
};
const cleanup = () => {
  removeTempRepos();
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
};

// The fake claude: a compiled executable, as in the launcher test. It answers the version probe
// and the sign-in check, reads the prompt and prints one fixed review.
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
const fakeSource = `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("9.9.9 (Claude Code)"); process.exit(0); }
if (args[0] === "auth" && args[1] === "status") { console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai" })); process.exit(0); }
await Bun.stdin.text();
console.log(${JSON.stringify(JSON.stringify(REVIEW))});
`;

type Case = { name: string; cmd: string[]; cwd: string; runs: number; warmup: number; env: Record<string, string>; expect?: string };

function build(): Case[] {
  const home = temp("wachiman-bench-home-");
  const bunDir = dirname(pinned);
  // The pinned Bun is called by path, so node_modules/.bin is not on PATH; node is, for the launcher case.
  const base: Record<string, string> = {
    PATH: [...(node ? [dirname(node)] : []), "/usr/bin", "/bin"].join(delimiter),
    HOME: home,
    USERPROFILE: home,
    WACHIMAN_HOME: join(home, ".wachiman"),
    NO_COLOR: "1",
  };
  for (const k of ["SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "PATHEXT", "ComSpec"]) if (process.env[k] !== undefined) base[k] = process.env[k] as string;

  const fakeBin = temp("wachiman-bench-fake-");
  const source = join(temp("wachiman-bench-fake-src-"), "fake-claude.ts");
  writeFileSync(source, fakeSource);
  const exe = join(fakeBin, process.platform === "win32" ? "claude.exe" : "claude");
  const built = spawnSync(pinned, ["build", "--compile", "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig", source, "--outfile", exe], { encoding: "utf8" });
  if (built.status !== 0) throw new Error(`could not compile the fake claude: ${built.stderr}`);

  // The fixed fixture: test/support/temp-repo.ts `branchRepo()`, five files changed between main and feat/x.
  const repo = branchRepo();
  const reviewEnv = { ...base, PATH: [fakeBin, bunDir, base.PATH].join(delimiter) };

  const cli = (name: string, args: string[], launcher?: string): Case => ({
    name,
    cmd: [launcher ?? pinned, "bin/wachiman.js", ...args],
    cwd: root,
    runs,
    warmup: 2,
    env: base,
  });
  return [
    cli("cli --version (bun)", ["--version"]),
    ...(node ? [cli("cli --version (node launcher)", ["--version"], node)] : []),
    cli("cli --help (bun)", ["--help"]),
    cli("cli local --help (bun)", ["local", "--help"]),
    {
      name: "tests: engine fakes",
      cmd: [pinned, "test", "src/engine.fake.test.ts", "src/full-review.fake.test.ts"],
      cwd: root,
      runs: 5,
      warmup: 1,
      env: base,
    },
    {
      name: "local review (fake claude, e2e)",
      cmd: [pinned, "bin/wachiman.js", "local", "--repo-dir", repo.dir, "--base", "main"],
      cwd: root,
      runs,
      warmup: 2,
      env: reviewEnv,
      expect: "Fake finding",
    },
  ];
}

const quantile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const round = (n: number) => Math.round(n * 10) / 10;

type Row = { case: string; runs: number; median_ms: number; min_ms: number; p90_ms: number };
const rows: Row[] = [];
let failure = "";
try {
  for (const c of build()) {
    const times: number[] = [];
    for (let i = 0; i < c.warmup + c.runs; i++) {
      const t0 = performance.now();
      const p = Bun.spawnSync(c.cmd, { cwd: c.cwd, env: c.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      const ms = performance.now() - t0;
      if (p.exitCode !== 0 || (c.expect && !p.stdout.toString().includes(c.expect))) {
        failure = `${c.name}: exit ${p.exitCode}${c.expect && p.exitCode === 0 ? ` and stdout lacks "${c.expect}"` : ""}\n${p.stderr.toString().slice(-600)}`;
        break;
      }
      if (i >= c.warmup) times.push(ms);
    }
    if (failure) break;
    rows.push({ case: c.name, runs: c.runs, median_ms: round(quantile(times, 0.5)), min_ms: round(Math.min(...times)), p90_ms: round(quantile(times, 0.9)) });
  }
} finally {
  cleanup();
}
if (failure) {
  console.error(`bench failed: ${failure}`);
  process.exit(1);
}

const meta = {
  date: new Date().toISOString().slice(0, 10),
  commit: spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(),
  bun: spawnSync(pinned, ["--version"], { encoding: "utf8" }).stdout.trim(),
  node: node ? spawnSync(node, ["--version"], { encoding: "utf8" }).stdout.trim() : null,
  cpu: cpus()[0]?.model ?? "unknown",
  platform: `${process.platform}-${process.arch}`,
};

if (asJson) {
  console.log(JSON.stringify({ ...meta, results: rows }, null, 2));
} else {
  const w = Math.max(...rows.map((r) => r.case.length));
  const fmt = (n: number) => `${n.toFixed(1)} ms`.padStart(11);
  console.log(`${meta.commit}  bun ${meta.bun}  node ${meta.node ?? "none"}  ${meta.cpu}  ${meta.platform}`);
  console.log(`${"case".padEnd(w)} ${"median".padStart(11)} ${"min".padStart(11)} ${"p90".padStart(11)} ${"runs".padStart(5)}`);
  for (const r of rows) console.log(`${r.case.padEnd(w)} ${fmt(r.median_ms)} ${fmt(r.min_ms)} ${fmt(r.p90_ms)} ${String(r.runs).padStart(5)}`);
}
