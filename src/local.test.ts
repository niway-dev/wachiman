import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageError } from "./config";
import { localFiles } from "./connectors/local-git";
import { parseLocalArgs, readInputFile } from "./local";
import { SUBSCRIPTION_ENV, SUBSCRIPTION_KEY_REFUSAL } from "./providers/claude-code";
import { A_HEAD, branchRepo, commit, removeTempRepos, type BranchRepo } from "../test/support/temp-repo";

const temps: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  removeTempRepos();
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const sha7 = (sha: string) => sha.slice(0, 7);
const BRANCH_FILES = ["CLAUDE.md", "img.png", "src/a.ts", "src/b.ts", "src/new.ts"];

const OK_RESULT = JSON.stringify({
  is_error: false,
  subtype: "success",
  num_turns: 3,
  total_cost_usd: 0.01,
  duration_ms: 10,
  structured_output: {
    files_reviewed: BRANCH_FILES,
    files_skipped: [],
    findings: [{ path: "src/a.ts", line: 2, severity: "fix", topic: "bug", confidence: "high", title: "T", body: "B" }],
    contracts: [],
    thread_replies: [],
    summary: "ok",
  },
});
const NONE_RESULT = JSON.stringify({
  is_error: false,
  subtype: "success",
  num_turns: 3,
  total_cost_usd: 0.01,
  duration_ms: 10,
  structured_output: { files_reviewed: BRANCH_FILES, files_skipped: [], findings: [], contracts: [], thread_replies: [], summary: "clean" },
});
const QUOTA_RESULT = JSON.stringify({
  is_error: true,
  subtype: "error",
  result: "usage limit reached",
  num_turns: 0,
  total_cost_usd: 0,
  duration_ms: 1,
});

type Variant = "ok" | "none" | "quota" | "edit" | "garbage" | "interrupt";

/**
 * A temporary `bin/` with a `gh` that leaves a canary and fails, and a `claude` that records its
 * calls, arguments, environment, prompt and the head it was given, then answers per `variant`.
 * Every path is baked into the script text: the child environment is allowlisted.
 */
function stubs(variant: Variant, repoDir: string) {
  const bin = temp("wachiman-bin-");
  const log = join(bin, "log");
  const canary = join(bin, "gh-called");
  writeFileSync(join(bin, "gh"), `#!/bin/sh\necho called >> "${canary}"\nexit 99\n`);
  const answer =
    variant === "quota"
      ? `cat <<'JSON'\n${QUOTA_RESULT}\nJSON`
      : variant === "none"
        ? `cat <<'JSON'\n${NONE_RESULT}\nJSON`
        : variant === "garbage"
          ? "echo 'not json at all'; exit 3"
          : variant === "interrupt"
            ? "kill -INT $PPID; kill -INT $$"
            : `cat <<'JSON'\n${OK_RESULT}\nJSON`;
  writeFileSync(
    join(bin, "claude"),
    `#!/bin/sh
echo "$*" >> "${log}.calls"
if [ "$1" = "--version" ]; then echo "9.9.9 (Claude Code)"; exit 0; fi
env | sort > "${log}.env"
printf '%s\\n' "$@" > "${log}.args"
cat > "${log}.prompt"
prev=""; first=""
for a in "$@"; do
  if [ "$prev" = "--add-dir" ]; then echo "$a" >> "${log}.dirs"; [ -z "$first" ] && first="$a"; fi
  prev="$a"
done
${variant === "edit" ? `echo "export const edited = true;" >> "${join(repoDir, "src/a.ts")}"` : ""}
cat "$first/src/a.ts" > "${log}.head-a"
${answer}
`,
  );
  chmodSync(join(bin, "gh"), 0o755);
  chmodSync(join(bin, "claude"), 0o755);
  const read = (suffix: string) => (existsSync(`${log}.${suffix}`) ? readFileSync(`${log}.${suffix}`, "utf8") : undefined);
  return {
    bin,
    canary,
    read,
    /** Review calls only, not the `--version` probe. */
    calls: () => (read("calls") ?? "").split("\n").filter((l) => l !== "" && l !== "--version"),
    env: () =>
      Object.fromEntries(
        (read("env") ?? "")
          .split("\n")
          .filter(Boolean)
          .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
      ),
  };
}

const cli = join(import.meta.dir, "cli.ts");

function runCli(args: string[], env: Record<string, string>) {
  const out = Bun.spawnSync([process.execPath, cli, ...args], { env, stdin: "ignore" });
  return { code: out.exitCode, stdout: out.stdout.toString(), stderr: out.stderr.toString() };
}

/** `agent-review local` on a fresh branch repository, with the stubs first on PATH and a temporary HOME. */
function local(variant: Variant, args: string[] = [], extraEnv: Record<string, string> = {}, repo: BranchRepo = branchRepo()) {
  const s = stubs(variant, repo.dir);
  const home = extraEnv.HOME ?? temp("wachiman-home-");
  const out = runCli(["local", "--repo-dir", repo.dir, ...args], {
    PATH: `${s.bin}:${process.env.PATH ?? ""}`,
    HOME: home,
    USER: "dev",
    ...extraEnv,
  });
  return { ...out, ...s, repo, home };
}

describe("parseLocalArgs", () => {
  test("every option, and the defaults", () => {
    expect(
      parseLocalArgs(["--base", "main", "src", "docs", "--format", "markdown", "--output", "r.md", "--profile", "isolated:work", "--agent-prompt"]),
    ).toEqual({
      base: "main",
      paths: ["src", "docs"],
      format: "markdown",
      output: "r.md",
      profile: { kind: "isolated", name: "work" },
      agentPrompt: true,
      history: false,
      input: undefined,
    });
    expect(parseLocalArgs([])).toEqual({ paths: [], format: "terminal", profile: { kind: "default" }, agentPrompt: false, history: false, input: undefined });
    expect(parseLocalArgs(["--format=json", "--base=origin/main"])).toMatchObject({ format: "json", base: "origin/main" });
  });

  test.each([
    [["--format", "x"]],
    [["--input", "/nonexistent/input.json"]],
    [["--output"]],
    [["--base"]],
    [["--base", "--format"]],
    [["--profile", "Work"]],
    [["--frobnicate"]],
  ])("%p is a usage error", (argv) => {
    expect(() => parseLocalArgs(argv)).toThrow(UsageError);
  });

  test("--input takes no base and no paths", () => {
    const file = join(temp("wachiman-input-"), "in.json");
    writeFileSync(file, "{}");
    expect(parseLocalArgs(["--input", file]).input).toBe(file);
    expect(() => parseLocalArgs(["--input", file, "src"])).toThrow("takes no --base and no paths");
    expect(() => parseLocalArgs(["--input", file, "--base", "main"])).toThrow(UsageError);
  });
});

describe("readInputFile", () => {
  const fixture = () => JSON.parse(readFileSync(join(import.meta.dir, "../test/fixtures/formats/review-input.branch.json"), "utf8"));
  const file = (value: unknown) => {
    const path = join(temp("wachiman-input-"), "in.json");
    writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
    return path;
  };

  test("reads a valid file, and refuses one that is not JSON, of another format, mistyped, or with headDir", () => {
    expect(readInputFile(file(fixture())).change.kind).toBe("branch");
    expect(() => readInputFile(file("{"))).toThrow("is not JSON");
    expect(() => readInputFile(file({ ...fixture(), format: "wachiman.review-input/2" }))).toThrow(UsageError);
    expect(() => readInputFile(file({ ...fixture(), files: [{ filename: "a" }] }))).toThrow("files");
    expect(() => readInputFile(file({ ...fixture(), change: { ...fixture().change, head: { sha: "nope" } } }))).toThrow("change.head.sha");
    expect(() => readInputFile(file({ ...fixture(), scope: [1] }))).toThrow("scope");
    expect(() => readInputFile(file({ ...fixture(), headDir: "/tmp/x" }))).toThrow("headDir");
  });
});

describe("agent-review local", () => {
  test("reviews the branch, prints progress on stderr and the report on stdout, and never calls gh", () => {
    const r = local("ok");
    expect(r.stderr).not.toContain("agent-review:");
    expect(r.code).toBe(0);
    const { repo } = r;
    const progress = [
      `base: main (${sha7(repo.mainTip)})`,
      `merge-base: ${sha7(repo.mergeBase)}`,
      `head: feat/x (${sha7(repo.head)})`,
      "files: 5 (0 excluded)",
      "batches: 1",
    ];
    for (const line of progress) expect(r.stderr.split("\n")).toContain(line);
    // All of it before the call's first log line.
    const firstCall = r.stderr.indexOf('"is_error"');
    expect(firstCall).toBeGreaterThan(-1);
    for (const line of progress) expect(r.stderr.indexOf(line)).toBeLessThan(firstCall);
    expect(r.stdout).toStartWith("Wachiman · review of branch `feat/x`");
    expect(r.stdout).toContain("src/a.ts:2  🟠🐛 Fix · bug: T (confidence high)");
    expect(r.stdout).toContain("API-equivalent estimate");
    expect(existsSync(r.canary)).toBe(false);
    const env = r.env();
    expect(env.USER).toBe("dev");
    for (const [name, value] of Object.entries(SUBSCRIPTION_ENV)) expect(env[name]).toBe(value);
    for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "GH_TOKEN", "GITHUB_TOKEN"]) expect(env).not.toHaveProperty(name);
    const args = (r.read("args") ?? "").split("\n");
    for (const flag of ["--no-session-persistence", "--restricted", "--strict-mcp-config"]) expect(args).toContain(flag);
    expect(args[args.indexOf("--tools") + 1]).toBe("Read,Glob,Grep");
    const dirs = (r.read("dirs") ?? "").split("\n").filter(Boolean);
    expect(dirs.length).toBe(2);
    for (const dir of dirs) {
      expect(dir.startsWith(repo.dir)).toBe(false);
      expect(repo.dir.startsWith(dir)).toBe(false);
    }
  });

  test("the review runs against the snapshot, not the working tree", () => {
    const repo = branchRepo();
    writeFileSync(join(repo.dir, "src/a.ts"), `${A_HEAD}export const uncommitted = 1;\n`);
    const r = local("edit", [], {}, repo);
    expect(r.code).toBe(0);
    const prompt = r.read("prompt") ?? "";
    expect(prompt).toContain("export const d = 4;");
    expect(prompt).not.toContain("uncommitted");
    expect(prompt).not.toContain("edited");
    expect(r.read("head-a")).toBe(A_HEAD);
    // The stub's edit landed in the working tree, not in what the agent read.
    expect(readFileSync(join(repo.dir, "src/a.ts"), "utf8")).toContain("export const edited = true;");
  });

  test("--format json writes only the result on stdout", () => {
    const r = local("ok", ["--format", "json"]);
    expect(r.code).toBe(0);
    const result = JSON.parse(r.stdout);
    expect(result.format).toBe("wachiman.review-result/1");
    expect(result.provider.profile).toBe("default");
    expect(result.change.kind).toBe("branch");
    expect(result.execution.costUsdEstimate).toBe(0.01);
    expect(r.stderr).toContain(`merge-base: ${sha7(r.repo.mergeBase)}`);
  });

  test("--output writes the Markdown file and prints the path", () => {
    const out = join(temp("wachiman-out-"), "review.md");
    const r = local("ok", ["--format", "markdown", "--output", out]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain(`report: ${out}`);
    const md = readFileSync(out, "utf8");
    expect(md).toStartWith("# Wachiman review of branch `feat/x`");
    expect(md).toContain("## Prompt for your agent");
  });

  test("ANTHROPIC_API_KEY set: exit 2 before any call", () => {
    const r = local("ok", [], { ANTHROPIC_API_KEY: "sk-ant-test" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(SUBSCRIPTION_KEY_REFUSAL);
    expect(r.read("calls")).toBeUndefined();
  });

  test("the snapshot and the run directory are removed on success and on a thrown error", () => {
    const ok = local("ok");
    expect(ok.code).toBe(0);
    const okDirs = (ok.read("dirs") ?? "").split("\n").filter(Boolean);
    expect(okDirs.length).toBe(2);
    for (const dir of okDirs) expect(existsSync(dir)).toBe(false);

    const bad = local("garbage");
    expect(bad.code).toBe(1);
    expect(bad.stdout).toContain("stop: error");
    const badDirs = (bad.read("dirs") ?? "").split("\n").filter(Boolean);
    expect(badDirs.length).toBeGreaterThan(0);
    for (const dir of badDirs) expect(existsSync(dir)).toBe(false);
  });

  test("a usage-limit rejection ends with stop: quota, exit 0, and lists what was not reviewed", () => {
    const r = local("quota", [], { AGENT_REVIEW_BATCH_LINES: "1" });
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain("batches: 1\n");
    expect(r.stdout).toContain("stop: quota — the account's usage limit ended the run; 5 file(s) not reviewed:");
    expect(r.stdout).toContain("not reached: the provider rejected the call");
    expect(r.calls()).toHaveLength(1);
  });

  test("Ctrl-C stops the review after the call it interrupted, removes the snapshot and exits 130", () => {
    const r = local("interrupt", [], { AGENT_REVIEW_BATCH_LINES: "1" });
    expect(r.code).toBe(130);
    expect(r.stderr).toContain("Interrupted");
    expect(r.calls()).toHaveLength(1);
    for (const dir of (r.read("dirs") ?? "").split("\n").filter(Boolean)) expect(existsSync(dir)).toBe(false);
  });

  test("--input reviews a ReviewInput file and snapshots its head from --repo-dir", () => {
    const repo = branchRepo();
    const fixture = JSON.parse(readFileSync(join(import.meta.dir, "../test/fixtures/formats/review-input.branch.json"), "utf8"));
    fixture.change.head.sha = repo.head;
    fixture.files = localFiles(repo.dir, repo.mergeBase, repo.head);
    const file = join(temp("wachiman-input-"), "input.json");
    writeFileSync(file, JSON.stringify(fixture));
    const r = local("ok", ["--input", file], {}, repo);
    expect(r.code).toBe(0);
    expect(r.stderr.split("\n")).toContain(`head: ${sha7(repo.head)}`);
    expect(r.stderr).not.toContain("merge-base:");
    expect(r.stdout).toContain(fixture.change.describe);

    writeFileSync(file, JSON.stringify({ ...fixture, format: "wachiman.review-input/2" }));
    const wrong = local("ok", ["--input", file], {}, repo);
    expect(wrong.code).toBe(2);
    expect(wrong.stderr).toContain("Unknown review input format");

    writeFileSync(file, JSON.stringify({ ...fixture, change: { ...fixture.change, head: { sha: "f".repeat(40) } } }));
    const absent = local("ok", ["--input", file], {}, repo);
    expect(absent.code).toBe(2);
    expect(absent.stderr).toContain("is not a commit");
    expect(absent.read("calls")?.includes("-p")).toBeFalsy();
  });

  test("--profile isolated refuses a populated profile and uses the directory otherwise", () => {
    const home = temp("wachiman-home-");
    const dir = join(home, ".wachiman", "claude-isolated");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "CLAUDE.md"), "rules");
    const refused = local("ok", ["--profile", "isolated"], { HOME: home, CLAUDE_CONFIG_DIR: "/elsewhere" });
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain("CLAUDE.md");
    expect(refused.read("calls")).toBeUndefined();

    rmSync(join(dir, "CLAUDE.md"));
    const used = local("ok", ["--profile", "isolated"], { HOME: home, CLAUDE_CONFIG_DIR: "/elsewhere" });
    expect(used.code).toBe(0);
    expect(used.env().CLAUDE_CONFIG_DIR).toBe(dir);
    expect(used.stdout.split("\n")[1]).toStartWith(`profile: isolated — ${dir}`);

    const missing = local("ok", ["--profile", "isolated:work"], { HOME: home });
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("agent-review --setup-profile work");
  });

  test("--setup-profile launches claude in an empty directory with the forced config dir", () => {
    const home = temp("wachiman-home-");
    const bin = temp("wachiman-bin-");
    const log = join(bin, "setup");
    writeFileSync(join(bin, "claude"), `#!/bin/sh\npwd -P > "${log}.cwd"\nls -A > "${log}.ls"\nenv | sort > "${log}.env"\necho "$#" > "${log}.argc"\n`);
    chmodSync(join(bin, "claude"), 0o755);
    const repo = branchRepo();
    const out = Bun.spawnSync([process.execPath, cli, "--setup-profile", "work"], {
      cwd: repo.dir,
      env: { PATH: `${bin}:${process.env.PATH ?? ""}`, HOME: home, USER: "dev", CLAUDE_CONFIG_DIR: "/elsewhere", ANTHROPIC_API_KEY: "sk-ant-test" },
      stdin: "ignore",
    });
    expect(out.exitCode).toBe(0);
    const cwd = readFileSync(`${log}.cwd`, "utf8").trim();
    expect(cwd).not.toBe("");
    expect(cwd.startsWith(repo.dir)).toBe(false);
    expect(existsSync(cwd)).toBe(false);
    expect(readFileSync(`${log}.ls`, "utf8")).toBe("");
    expect(readFileSync(`${log}.argc`, "utf8").trim()).toBe("0");
    const env = readFileSync(`${log}.env`, "utf8");
    expect(env).toContain(`CLAUDE_CONFIG_DIR=${join(home, ".wachiman", "claude-work")}\n`);
    expect(env).not.toContain("ANTHROPIC_API_KEY");
    expect(env).toContain("DISABLE_TELEMETRY=1");
    expect(out.stderr.toString()).toContain("agent-review local --profile isolated:work");
  });

  test("codex is refused in local mode", () => {
    const r = local("ok", [], { AGENT_REVIEW_PROVIDER: "codex" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("only on Claude Code");
    expect(r.read("calls")).toBeUndefined();
  });

  test("--help lists local and --setup-profile; GH_TOKEN is not required for them", () => {
    const help = runCli(["--help"], { PATH: process.env.PATH ?? "" });
    expect(help.stdout).toContain("agent-review local [paths…]");
    expect(help.stdout).toContain("agent-review --setup-profile [<name>]");
    // The first test ran without GH_TOKEN and GITHUB_REPOSITORY; a usage error here would name them.
    const r = local("ok");
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain("GH_TOKEN");
  });
});

describe("--history", () => {
  const A_FIXED = A_HEAD.replace("export const b = 20;", "export const b = 21;");
  const runFiles = (home: string) => {
    const root = join(home, ".wachiman", "history");
    if (!existsSync(root)) return [];
    return readdirSync(root).flatMap((key) => {
      const dir = join(root, key, "runs");
      return existsSync(dir) ? readdirSync(dir).map((n) => join(dir, n)) : [];
    });
  };
  const mode = (path: string) => statSync(path).mode & 0o777;

  test("without the flag, nothing under ~/.wachiman is created or read", () => {
    const home = temp("wachiman-home-");
    const r = local("ok", [], { HOME: home });
    expect(r.code).toBe(0);
    expect(existsSync(join(home, ".wachiman"))).toBe(false);

    const runs = join(home, ".wachiman", "history", "x", "runs");
    mkdirSync(runs, { recursive: true });
    const file = join(runs, "2026-11-01T10-00-00-000Z-aaaaaaa.json");
    writeFileSync(file, "{}");
    const old = new Date("2026-11-01T10:00:00Z");
    utimesSync(file, old, old);
    utimesSync(runs, old, old);
    const before = { file: statSync(file).mtimeMs, dir: statSync(runs).mtimeMs, listing: readdirSync(runs) };
    const again = local("ok", [], { HOME: home });
    expect(again.code).toBe(0);
    expect(statSync(file).mtimeMs).toBe(before.file);
    expect(statSync(runs).mtimeMs).toBe(before.dir);
    expect(readdirSync(runs)).toEqual(before.listing);
    expect(again.stdout).not.toContain("· id ");
    expect(again.stdout).not.toContain("Since the last run");
    expect(again.stderr).not.toContain("history:");
  });

  test("--history saves one run file, 0600, whose result is the JSON sink's output", () => {
    const r = local("ok", ["--history", "--format", "json"]);
    expect(r.code).toBe(0);
    const files = runFiles(r.home);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/runs\/.+-[0-9a-f]{7}\.json$/);
    expect(mode(files[0])).toBe(0o600);
    expect(mode(join(r.home, ".wachiman", "history"))).toBe(0o700);
    const saved = JSON.parse(readFileSync(files[0], "utf8"));
    expect(saved.format).toBe("wachiman.history-run/1");
    expect(saved.result).toEqual(JSON.parse(r.stdout));
    expect(saved.tracking).toHaveLength(1);
    expect(saved.tracking[0].status).toBe("new");
  });

  test("AGENT_REVIEW_HISTORY=1 is the same switch", () => {
    const r = local("ok", [], { AGENT_REVIEW_HISTORY: "1" });
    expect(r.code).toBe(0);
    expect(runFiles(r.home)).toHaveLength(1);
    expect(r.stdout).toContain("· id ");
  });

  test("the prompts are byte-identical with and without --history", () => {
    const repo = branchRepo();
    const without = local("ok", [], {}, repo);
    const withHistory = local("ok", ["--history"], {}, repo);
    expect(without.read("prompt")).toBeDefined();
    // Each run's scratch directory has a random name; nothing else may differ.
    const scrub = (text: string) => text.replace(/(agent-review|wachiman-snapshot)-[A-Za-z0-9]+/g, "$1-X");
    expect(scrub(withHistory.read("prompt") as string)).toBe(scrub(without.read("prompt") as string));
    expect(withHistory.read("args")?.split("\n").filter((a) => !a.startsWith("/"))).toEqual(
      without.read("args")?.split("\n").filter((a) => !a.startsWith("/")),
    );
  });

  test("--format json on stdout is unchanged with --history, and the block goes to stderr", () => {
    const repo = branchRepo();
    const without = local("ok", ["--format", "json"], {}, repo);
    const withHistory = local("ok", ["--history", "--format", "json"], {}, repo);
    const strip = (text: string) => {
      const r = JSON.parse(text);
      delete r.change.snapshot;
      delete r.execution.durationMs;
      for (const b of r.batches ?? []) delete b.durationMs;
      return r;
    };
    expect(strip(withHistory.stdout)).toEqual(strip(without.stdout));
    expect(withHistory.stdout).not.toContain("tracking");
    expect(withHistory.stderr).toContain("Since the last run: this is the first saved run of this repository.");
    expect(without.stderr).not.toContain("Since the last run");
  });

  test("a second run labels the finding open since the first head, with its id", () => {
    const home = temp("wachiman-home-");
    const repo = branchRepo();
    const first = local("ok", ["--history"], { HOME: home }, repo);
    expect(first.stdout).toMatch(/src\/a\.ts:2  🟠🐛 Fix · bug: T \(confidence high\)  new · id [0-9a-f]{10}\n/);
    const second = local("ok", ["--history"], { HOME: home }, repo);
    expect(second.code).toBe(0);
    expect(second.stdout).toMatch(new RegExp(`open since ${sha7(repo.head)} · 2 runs · id [0-9a-f]{10}\\n`));
    expect(second.stdout).toContain(`Since the last run (${sha7(repo.head)}, `);
    expect(runFiles(home)).toHaveLength(2);
    const id = (text: string) => text.match(/· id ([0-9a-f]{10})/)?.[1];
    expect(id(second.stdout)).toBe(id(first.stdout));
  });

  test("a finding absent after its line changed is probably-fixed; unchanged, not-repeated", () => {
    const home = temp("wachiman-home-");
    const repo = branchRepo();
    local("ok", ["--history"], { HOME: home }, repo);
    commit(repo.dir, { "src/a.ts": A_FIXED }, "fix");
    const fixed = local("none", ["--history"], { HOME: home }, repo);
    expect(fixed.code).toBe(0);
    expect(fixed.stdout).toMatch(/probably fixed  src\/a\.ts:2  T  \(id [0-9a-f]{10}\)/);
    expect(fixed.stdout).not.toContain("not repeated");

    const home2 = temp("wachiman-home-");
    const repo2 = branchRepo();
    local("ok", ["--history"], { HOME: home2 }, repo2);
    const same = local("none", ["--history"], { HOME: home2 }, repo2);
    expect(same.stdout).toMatch(/not repeated  src\/a\.ts:2  T  \(id [0-9a-f]{10}\)/);
    expect(same.stdout).not.toContain("probably fixed");
  });

  test("a scoped run and a quota stop leave the finding unknown", () => {
    const home = temp("wachiman-home-");
    const repo = branchRepo();
    local("ok", ["--history"], { HOME: home }, repo);
    const scoped = local("none", ["--history", "src/b.ts"], { HOME: home }, repo);
    expect(scoped.code).toBe(0);
    expect(scoped.stdout).toMatch(/unknown +1 finding\(s\) in files this run did not review/);
    expect(scoped.stdout).not.toContain("probably fixed");
    expect(scoped.stdout).not.toContain("not repeated");

    const quota = local("quota", ["--history"], { HOME: home }, repo);
    expect(quota.stdout).toMatch(/unknown +1 finding\(s\) in files this run did not review/);
    expect(quota.stdout).not.toContain("probably fixed");
  });

  test("AGENT_REVIEW_HISTORY_DAYS prunes old runs at save time, and a bad value exits 2 before any call", () => {
    const home = temp("wachiman-home-");
    const repo = branchRepo();
    const first = local("ok", ["--history"], { HOME: home }, repo);
    const [file] = runFiles(home);
    const old = JSON.parse(readFileSync(file, "utf8"));
    old.savedAt = new Date(Date.now() - 40 * 86_400_000).toISOString();
    writeFileSync(file, JSON.stringify(old));
    const second = local("ok", ["--history"], { HOME: home }, repo);
    expect(second.code).toBe(0);
    const files = runFiles(home);
    expect(files).toHaveLength(1);
    expect(files[0]).not.toBe(file);
    expect(first.code).toBe(0);

    const bad = local("ok", ["--history"], { HOME: home, AGENT_REVIEW_HISTORY_DAYS: "x" }, repo);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("AGENT_REVIEW_HISTORY_DAYS");
    expect(bad.calls()).toEqual([]);
    expect(runFiles(home)).toHaveLength(1);
  });

  test("Ctrl-C saves nothing", () => {
    const r = local("interrupt", ["--history"], { AGENT_REVIEW_BATCH_LINES: "1" });
    expect(r.code).toBe(130);
    expect(runFiles(r.home)).toEqual([]);
  });

  test("a failure to save is a warning, and the report is still printed", () => {
    const home = temp("wachiman-home-");
    writeFileSync(join(home, ".wachiman"), "a file where the directory should go");
    const r = local("ok", ["--history"], { HOME: home });
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("history: this run was not saved");
    expect(r.stdout).toContain("src/a.ts:2");
  });
});
