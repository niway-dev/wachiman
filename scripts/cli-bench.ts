/**
 * Benchmark of the engine, without model time and without network.
 *
 *   bun run bench:cli                 table on stdout
 *   bun run bench:cli --json          JSON on stdout (the table is not printed)
 *   bun run bench:cli --runs 25       CLI and review runs (default 15); the test case runs 5
 *
 * Every launcher case runs `bin/wachiman.js`, so each run includes the launcher's `bun --version` probe
 * and the child Bun on `src/cli.ts`; the "under node" case only changes which runtime hosts the launcher.
 * Every other case spawns the repo's own pinned Bun by path (never PATH), with a temporary
 * `WACHIMAN_HOME`, and must exit 0: one nonzero exit fails the whole bench (exit 1).
 * The `local review` case drives the real `wachiman local` pipeline with the same fake `claude`
 * the launcher test uses (test/local-fake-provider.test.ts), on a fixed fixture repo and diff.
 * The fake is a shell script written once, outside the timings. The host name is never recorded.
 * POSIX only (macOS, Linux): the child PATH holds no Git for Windows. Each run has a 120 s timeout.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { branchRepo, removeTempRepos } from "../test/support/temp-repo";

const root = join(import.meta.dir, "..");
if (process.platform === "win32") {
  console.error("bun run bench:cli is POSIX only (macOS, Linux).");
  process.exit(2);
}
const argv = process.argv.slice(2);
let asJson = false;
let runs = 15;
for (let i = 0; i < argv.length; i++) {
  const eq = argv[i].indexOf("=");
  const flag = eq === -1 ? argv[i] : argv[i].slice(0, eq);
  const inline = eq === -1 ? undefined : argv[i].slice(eq + 1);
  if (flag === "--json" && inline === undefined) asJson = true;
  else if (flag === "--runs") {
    const value = inline ?? argv[++i];
    if (value === undefined) {
      console.error("--runs needs a value, for example --runs 25");
      process.exit(2);
    }
    runs = Number(value);
  } else {
    console.error(`Unknown argument ${argv[i]}. Usage: bun run bench:cli [--json] [--runs N]`);
    process.exit(2);
  }
}
if (!Number.isInteger(runs) || runs < 3) {
  console.error("--runs needs an integer of at least 3");
  process.exit(2);
}

const pinned = join(root, "node_modules", ".bin", "bun");
if (!existsSync(pinned)) {
  console.error(`The pinned Bun is missing at ${pinned}. Run \`bun install --frozen-lockfile\` first.`);
  process.exit(2);
}
// A version-manager shim (mise, asdf) needs the real HOME, so the real binary is resolved here.
const nodeShim = Bun.which("node");
const node = nodeShim ? spawnSync(nodeShim, ["-p", "process.execPath"], { encoding: "utf8" }).stdout.trim() || nodeShim : null;

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

// The fake claude: a POSIX shell script on PATH, spawned by name as the real binary is. The launcher
// test compiles one with Bun instead, but a Bun 1.3.4 compiled executable is killed on some macOS
// versions, and a script also keeps a 60 MB process start out of the timings. It answers the version
// probe and the sign-in check, drains the prompt and prints one fixed review. REVIEW is a copy of
// test/local-fake-provider.test.ts: keep it in step if that fixture changes.
const REVIEW = {
  is_error: false,
  subtype: "success",
  num_turns: 1,
  total_cost_usd: 0.01,
  duration_ms: 5,
  structured_output: {
    files_reviewed: ["CLAUDE.md", "img.png", "src/a.ts", "src/b.ts", "src/new.ts"],
    files_skipped: [],
    findings: [
      {
        path: "src/a.ts",
        line: 2,
        severity: "fix",
        topic: "bug",
        confidence: "high",
        title: "Fake finding",
        body: "Body of the fake finding.",
      },
    ],
    contracts: [],
    thread_replies: [],
    summary: "Reviewed by the fake provider.",
  },
};
const fakeScript = (reviewFile: string) => `#!/bin/sh
case "$1" in
  --version) echo "9.9.9 (Claude Code)" ;;
  auth) echo '{"loggedIn":true,"authMethod":"claude.ai"}' ;;
  *) cat > /dev/null; cat '${reviewFile}' ;;
esac
`;

type Case = { name: string; cmd: string[]; cwd: string; runs: number; warmup: number; env: Record<string, string>; expect?: string };

function build(): Case[] {
  const home = temp("wachiman-cli-bench-home-");
  // The pinned Bun is called by path, so node_modules/.bin is not on PATH; node is, for the launcher case.
  const base: Record<string, string> = {
    PATH: [...(node ? [dirname(node)] : []), "/usr/bin", "/bin"].join(delimiter),
    HOME: home,
    USERPROFILE: home,
    WACHIMAN_HOME: join(home, ".wachiman"),
    NO_COLOR: "1",
  };
  if (process.env.TMPDIR !== undefined) base.TMPDIR = process.env.TMPDIR;

  const fakeBin = temp("wachiman-cli-bench-fake-");
  const reviewFile = join(fakeBin, "review.json");
  writeFileSync(reviewFile, JSON.stringify(REVIEW));
  writeFileSync(join(fakeBin, "claude"), fakeScript(reviewFile), { mode: 0o755 });

  // The fixed fixture: test/support/temp-repo.ts `branchRepo()`, five files changed between main and feat/x.
  const repo = branchRepo();
  const reviewEnv = { ...base, PATH: [fakeBin, base.PATH].join(delimiter) };

  const cli = (name: string, args: string[], launcher?: string): Case => ({
    name,
    cmd: [launcher ?? pinned, "bin/wachiman.js", ...args],
    cwd: root,
    runs,
    warmup: 2,
    env: base,
  });
  return [
    cli("launcher --version (under bun)", ["--version"]),
    ...(node ? [cli("launcher --version (under node)", ["--version"], node)] : []),
    cli("launcher --help (under bun)", ["--help"]),
    cli("launcher local --help (under bun)", ["local", "--help"]),
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
  if (p === 0.5 && s.length % 2 === 0) return (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
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
      const p = Bun.spawnSync(c.cmd, { cwd: c.cwd, env: c.env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 120_000 });
      const ms = performance.now() - t0;
      if (p.exitCode !== 0 || (c.expect && !p.stdout.toString().includes(c.expect))) {
        failure = `${c.name}: ${p.exitedDueToTimeout ? "timed out, exit" : "exit"} ${p.exitCode}${c.expect && p.exitCode === 0 ? ` and stdout lacks "${c.expect}"` : ""}\n${p.stderr.toString().slice(-600)}`;
        break;
      }
      if (i >= c.warmup) times.push(ms);
    }
    if (failure) break;
    rows.push({
      case: c.name,
      runs: c.runs,
      median_ms: round(quantile(times, 0.5)),
      min_ms: round(Math.min(...times)),
      p90_ms: round(quantile(times, 0.9)),
    });
  }
} finally {
  cleanup();
}
if (failure) {
  console.error(`cli-bench failed: ${failure}`);
  process.exit(1);
}

const meta = {
  date: new Date().toISOString().slice(0, 10),
  commit:
    (spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim() || "unknown") +
    (spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).stdout.trim() ? "-dirty" : ""),
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
  for (const r of rows)
    console.log(`${r.case.padEnd(w)} ${fmt(r.median_ms)} ${fmt(r.min_ms)} ${fmt(r.p90_ms)} ${String(r.runs).padStart(5)}`);
}
