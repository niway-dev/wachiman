#!/usr/bin/env bun
/**
 * The smoke rows of the Windows executable (docs/specs/2026-11-09-cli-and-verified-reviews-design.md,
 * "Windows executable"), run against a built executable with a fake `claude` and no model:
 *
 *   bun scripts/smoke-exe.ts --exe ./wachiman.exe --version 1.10.0 [--rows W1,W2,W3,W5,W6]
 *
 * W1 version, and no dotenv file or `bunfig.toml` `preload` read from the directory it starts in
 * W2 `local --input` gives the same ReviewResult as `bun src/cli.ts`, with forward-slash paths
 * W3 the embedded settings reach `claude` as a temp file with the shipped bytes, removed afterwards
 * W5 Ctrl-C during a run exits 130 and leaves no snapshot or temp file behind
 * W6 a profile with `--binary <abs>/claude(.exe)` runs; a `claude.cmd` is refused
 *
 * The same rows run from `bun test` against a native build (test/exe-smoke.test.ts) and from CI
 * against the cross-built `wachiman.exe` on `windows-latest`. Exit 0 only when every requested row
 * passed. Nothing leaves the machine.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { localFiles } from "../src/connectors/local-git";
import { buildFakeClaude, type FakeClaude } from "../test/support/fake-claude";
import { branchRepo, removeTempRepos, type BranchRepo } from "../test/support/temp-repo";

export type Row = "W1" | "W2" | "W3" | "W5" | "W6";
export const ALL_ROWS: Row[] = ["W1", "W2", "W3", "W5", "W6"];
export interface RowResult {
  row: Row;
  ok: boolean;
  detail: string;
}

class Failed extends Error {}
const check = (condition: unknown, message: string) => {
  if (!condition) throw new Failed(message);
};
const root = resolve(import.meta.dir, "..");
const windows = process.platform === "win32";

interface Scenario {
  work: string;
  fake: FakeClaude;
  repo: BranchRepo;
  input: string;
}

/** A small environment: the fake first on PATH, git (not in System32), and a temporary home on both families of variables. */
function envFor(s: Scenario, extra: Record<string, string> = {}) {
  const git = Bun.which("git");
  const path = [s.fake.binDir, ...(git ? [dirname(git)] : []), ...(windows ? [join(process.env.SystemRoot ?? "C:\\Windows", "System32")] : ["/usr/bin", "/bin"])].join(delimiter);
  const keep = ["SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "PATHEXT", "ComSpec", "APPDATA", "LOCALAPPDATA"];
  const home = join(s.work, "home");
  mkdirSync(home, { recursive: true });
  return {
    ...Object.fromEntries(keep.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k] as string])),
    PATH: path,
    Path: path,
    HOME: home,
    USERPROFILE: home,
    USER: "dev",
    ...extra,
  } as Record<string, string>;
}

function run(command: string[], s: Scenario, opts: { cwd?: string; env?: Record<string, string> } = {}) {
  const out = Bun.spawnSync(command, { cwd: opts.cwd ?? s.work, env: opts.env ?? envFor(s), stdin: "ignore" });
  return { code: out.exitCode, stdout: out.stdout.toString(), stderr: out.stderr.toString() };
}

const cli = (args: string[]) => [process.execPath, join(root, "src", "cli.ts"), ...args];
const localInput = (s: Scenario) => ["local", "--input", s.input, "--repo-dir", s.repo.dir, "--format", "json"];

/** Everything that varies between two runs of the same review: the clock. */
function normalized(json: string) {
  const result = JSON.parse(json);
  result.execution.durationMs = 0;
  return result;
}

const strings = (value: unknown): string[] =>
  typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];

function w1(exe: string, version: string, s: Scenario) {
  const printed = run([exe, "--version"], s);
  check(printed.code === 0 && printed.stdout.trim() === version, `--version printed ${JSON.stringify(printed.stdout.trim())} (exit ${printed.code}), expected ${version}`);
  // Two directories that look like the reviewed repository. One holds a `preload` that would run
  // code; the other a dotenv file whose key would make `local` refuse (exit 2) if it reached the
  // environment. Either taking effect is a failure. Two directories, so a failure names its cause.
  const preloadDir = join(s.work, "trap-preload");
  const dotenvDir = join(s.work, "trap-dotenv");
  mkdirSync(preloadDir, { recursive: true });
  mkdirSync(dotenvDir, { recursive: true });
  const marker = join(preloadDir, "preload-ran.txt");
  writeFileSync(join(preloadDir, "preload.ts"), `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "ran");\n`);
  writeFileSync(join(preloadDir, "bunfig.toml"), 'preload = ["./preload.ts"]\n');
  writeFileSync(join(dotenvDir, `.${"env"}`), "ANTHROPIC_API_KEY=sk-ant-sentinel-not-real\n");
  for (const cwd of [preloadDir, dotenvDir]) {
    // Today `local --help` is a usage error (exit 2) that prints the usage text; a future real help would exit 0.
    const help = run([exe, "local", "--help"], s, { cwd });
    check((help.code === 0 || help.code === 2) && /Usage:[\s\S]*wachiman local/.test(help.stdout + help.stderr), `local --help from ${cwd}: exit ${help.code}, ${(help.stdout + help.stderr).slice(0, 80)}`);
    check(!existsSync(marker), "the bunfig.toml preload of the working directory ran");
    const review = run([exe, ...localInput(s)], s, { cwd });
    check(review.code === 0, `a review started in ${cwd} exited ${review.code}: ${review.stderr.slice(-300)}${cwd === dotenvDir ? " (the dotenv file of the working directory reached the environment)" : ""}`);
    check(!existsSync(marker), "the bunfig.toml preload of the working directory ran during a review");
  }
  return `--version ${version}; local --help and a review from a directory with a sentinel preload, and from one with a dotenv file: no effect`;
}

function w2(exe: string, version: string, s: Scenario) {
  const reference = run(cli(localInput(s)), s);
  check(reference.code === 0, `bun src/cli.ts local --input: exit ${reference.code}: ${reference.stderr.slice(-300)}`);
  s.fake.reset();
  const built = run([exe, ...localInput(s)], s);
  check(built.code === 0, `the executable's local --input: exit ${built.code}: ${built.stderr.slice(-300)}`);
  const a = normalized(reference.stdout);
  const b = normalized(built.stdout);
  check(b.engine.version === version, `the result names engine ${b.engine.version}, expected ${version}`);
  // Same result except what the build changes by design: the version it carries.
  a.engine.version = b.engine.version;
  check(JSON.stringify(a) === JSON.stringify(b), "the executable's ReviewResult differs from bun src/cli.ts");
  check(b.findings.length > 0 && b.findings[0].path === "src/a.ts", `finding path ${b.findings[0]?.path}`);
  for (const text of strings(b)) check(!text.includes("\\"), `a backslash in the result: ${JSON.stringify(text.slice(0, 80))}`);
  return `ReviewResult equals bun src/cli.ts; ${b.findings.length} finding(s), no backslash in any string`;
}

function w3(s: Scenario) {
  // Runs right after `w2`, whose last call to `claude` was the executable's.
  // The committed bytes, not the working tree: a checkout that converted line endings must not pass.
  const committed = spawnSync("git", ["show", "HEAD:src/providers/claude-code.settings.json"], { cwd: root });
  check(committed.status === 0 && committed.stdout, "could not read the committed settings with git show HEAD:src/providers/claude-code.settings.json");
  const shipped = Buffer.from(committed.stdout);
  const seen = s.fake.read("settings-seen.json");
  const where = s.fake.read("settings-path.txt")?.toString();
  check(seen !== undefined && where !== undefined, "the executable never passed --settings to claude");
  check(Buffer.compare(seen!, shipped) === 0, "the settings claude saw differ from src/providers/claude-code.settings.json");
  check(!existsSync(where!), `the settings temp file ${where} was not removed`);
  check(!where!.startsWith(s.repo.dir), "the settings temp file was written inside the reviewed repository");
  return `claude read ${seen!.length} bytes equal to claude-code.settings.json from a temp file, removed afterwards`;
}

const leftovers = (dir: string) => readdirSync(dir).filter((n) => /^(wachiman-snapshot-|agent-review-)/.test(n));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(path: string, ms: number) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (existsSync(path)) return true;
  return false;
}

/** Sends Ctrl-C to the run's whole process group (POSIX), or to its console (Windows, below). */
async function w5(exe: string, s: Scenario) {
  s.fake.reset();
  s.fake.hang();
  const temp = join(s.work, "ctrl-c-tmp");
  mkdirSync(temp, { recursive: true });
  const env = envFor(s, { TMPDIR: temp, TEMP: temp, TMP: temp });
  const args = ["local", "--repo-dir", s.repo.dir, "--base", "main", "--format", "json"];
  const ready = join(s.fake.stateDir, "ready");
  let code: number | null;
  let during: string[];
  if (!windows) {
    const child = spawn(exe, args, { env, cwd: s.work, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const exited = new Promise<number | null>((done) => child.on("exit", (c) => done(c)));
    check(await waitFor(ready, 60_000), "the fake claude never reached its review call");
    during = leftovers(temp);
    process.kill(-child.pid!, "SIGINT");
    const outcome = await Promise.race([exited, sleep(60_000).then(() => "timeout" as const)]);
    if (outcome === "timeout") {
      process.kill(-child.pid!, "SIGKILL");
      throw new Failed("the run did not stop within 60 s of Ctrl-C");
    }
    code = outcome;
  } else {
    ({ code, during } = await interruptOnWindows(exe, args, env, s, temp, ready));
  }
  check(during.some((n) => n.startsWith("wachiman-snapshot-")), `no snapshot directory existed while the review ran (${during.join(", ") || "nothing in the temp directory"}), so the cleanup proves nothing`);
  check(code === 130, `exit code after Ctrl-C was ${code}, expected 130`);
  check(leftovers(temp).length === 0, `left behind after Ctrl-C: ${leftovers(temp).join(", ")}`);
  return "Ctrl-C during the fake review exits 130; the snapshot and the temp files are gone";
}

/**
 * Windows has no signals; Ctrl-C is a console event. The run starts in a console of its own (a new
 * window, through Start-Process), so the event reaches it and the fake `claude` it started but not
 * this script or the CI shell. A helper process attaches to that console, ignores the event
 * itself, and generates it. Unproven until it has run on `windows-latest`.
 */
async function interruptOnWindows(exe: string, args: string[], env: Record<string, string>, s: Scenario, temp: string, ready: string) {
  const q = (text: string) => `'${text.replace(/'/g, "''")}'`;
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$p = Start-Process -FilePath ${q(exe)} -ArgumentList @(${args.map((a) => q(a.includes(" ") ? `"${a}"` : a)).join(",")}) -WorkingDirectory ${q(s.work)} -RedirectStandardOutput ${q(join(s.work, "ctrl-c.out"))} -RedirectStandardError ${q(join(s.work, "ctrl-c.err"))} -PassThru`,
    "$null = $p.Handle",
    "$end = (Get-Date).AddSeconds(90)",
    `while (-not (Test-Path ${q(ready)}) -and -not $p.HasExited -and (Get-Date) -lt $end) { Start-Sleep -Milliseconds 200 }`,
    `if (-not (Test-Path ${q(ready)})) { Write-Output 'NOT_READY'; try { $p.Kill() } catch {}; exit 3 }`,
    `Write-Output ('DURING ' + ((Get-ChildItem -Name ${q(temp)}) -join ','))`,
    `& ${q(process.execPath)} ${q(join(root, "scripts", "smoke-exe.ts"))} --ctrl-c-helper $p.Id`,
    "if (-not $p.WaitForExit(60000)) { try { $p.Kill() } catch {}; Write-Output 'TIMEOUT'; exit 4 }",
    "Write-Output ('EXIT ' + $p.ExitCode)",
  ].join("\n");
  const launcher = spawnSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", script], { env, encoding: "utf8", timeout: 240_000 });
  const out = `${launcher.stdout ?? ""}${launcher.stderr ?? ""}`;
  check(!/NOT_READY|TIMEOUT/.test(out) && /EXIT -?\d+/.test(out), `the Ctrl-C launcher failed: ${out.slice(-600)}`);
  return {
    code: Number(out.match(/EXIT (-?\d+)/)![1]),
    during: (out.match(/DURING (.*)/)?.[1] ?? "").trim().split(",").filter(Boolean),
  };
}

/** The helper side of `interruptOnWindows`. */
async function sendCtrlC(pid: number) {
  const { dlopen } = await import("bun:ffi");
  const k = dlopen("kernel32.dll", {
    FreeConsole: { args: [], returns: "i32" },
    AttachConsole: { args: ["u32"], returns: "i32" },
    SetConsoleCtrlHandler: { args: ["ptr", "i32"], returns: "i32" },
    GenerateConsoleCtrlEvent: { args: ["u32", "u32"], returns: "i32" },
  });
  k.symbols.FreeConsole();
  if (!k.symbols.AttachConsole(pid)) throw new Error(`AttachConsole(${pid}) failed: the process has no console to send Ctrl-C to`);
  k.symbols.SetConsoleCtrlHandler(null, 1);
  if (!k.symbols.GenerateConsoleCtrlEvent(0, 0)) throw new Error("GenerateConsoleCtrlEvent failed");
  await sleep(1000);
  k.symbols.FreeConsole();
}

function w6(exe: string, s: Scenario) {
  s.fake.reset();
  const configDir = join(s.work, "claude-config");
  mkdirSync(configDir, { recursive: true });
  const added = run([exe, "profile", "add", "work", "--config-dir", configDir, "--binary", s.fake.exe], s);
  check(added.code === 0, `profile add --binary ${s.fake.exe}: exit ${added.code}: ${added.stderr.slice(-300)}`);
  const review = run([exe, "local", "--profile", "work", "--repo-dir", s.repo.dir, "--base", "main", "--format", "json"], s);
  check(review.code === 0 && review.stdout.includes("Fake finding"), `local --profile work: exit ${review.code}: ${review.stderr.slice(-300)}`);
  check(s.fake.calls().length >= 2, "the profile's binary was not the one that ran");
  const shim = join(s.work, "claude.cmd");
  writeFileSync(shim, "@echo off\r\n");
  const refused = run([exe, "profile", "add", "shim", "--config-dir", configDir, "--binary", shim], s);
  check(refused.code === 2 && /claude\.exe/.test(refused.stderr), `claude.cmd: exit ${refused.code}, ${refused.stderr.slice(-200)}`);
  return `profile with --binary ${s.fake.exe} ran the review; claude.cmd was refused (exit 2)`;
}

export async function runSmoke(opts: { exe: string; version: string; rows?: Row[]; bun?: string; log?: (line: string) => void }): Promise<RowResult[]> {
  const rows = opts.rows ?? ALL_ROWS;
  const log = opts.log ?? (() => {});
  const exe = resolve(opts.exe);
  const work = mkdtempSync(join(tmpdir(), "wachiman-exe-smoke-"));
  try {
    const repo = branchRepo();
    const fixture = JSON.parse(readFileSync(join(root, "test", "fixtures", "formats", "review-input.branch.json"), "utf8"));
    fixture.change.head.sha = repo.head;
    fixture.files = localFiles(repo.dir, repo.mergeBase, repo.head);
    const input = join(work, "input.json");
    writeFileSync(input, JSON.stringify(fixture));
    const fake = buildFakeClaude(join(work, "fake"), opts.bun ?? process.execPath);
    const s: Scenario = { work, fake, repo, input };
    const results: RowResult[] = [];
    // W3 reads what the executable's run in W2 left in the fake's state, so it needs W2 right before it.
    const steps: Record<Row, () => string | Promise<string>> = {
      W1: () => w1(exe, opts.version, s),
      W2: () => w2(exe, opts.version, s),
      W3: () => {
        if (!rows.includes("W2")) w2(exe, opts.version, s);
        return w3(s);
      },
      W5: () => w5(exe, s),
      W6: () => w6(exe, s),
    };
    for (const row of ALL_ROWS.filter((r) => rows.includes(r))) {
      try {
        results.push({ row, ok: true, detail: await steps[row]() });
      } catch (error) {
        results.push({ row, ok: false, detail: error instanceof Error ? error.message : String(error) });
      }
      const last = results[results.length - 1];
      log(`${last.ok ? "PASS" : "FAIL"} ${last.row}: ${last.detail}`);
    }
    return results;
  } finally {
    removeTempRepos();
    rmSync(work, { recursive: true, force: true });
  }
}

async function main(argv: string[]) {
  const value = (flag: string) => {
    const at = argv.indexOf(flag);
    return at === -1 ? undefined : argv[at + 1];
  };
  const pid = value("--ctrl-c-helper");
  if (pid !== undefined) {
    await sendCtrlC(Number(pid));
    return 0;
  }
  const exe = value("--exe");
  const version = value("--version");
  if (!exe || !version) {
    console.error("usage: bun scripts/smoke-exe.ts --exe <path> --version <x.y.z> [--rows W1,W2,W3,W5,W6]");
    return 2;
  }
  const rows = (value("--rows")?.split(",") ?? ALL_ROWS) as Row[];
  const bad = rows.filter((r) => !ALL_ROWS.includes(r));
  if (bad.length > 0) {
    console.error(`unknown rows: ${bad.join(", ")}`);
    return 2;
  }
  const results = await runSmoke({ exe, version, rows, log: (line) => console.log(line) });
  return results.every((r) => r.ok) ? 0 : 1;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
