import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageError } from "./config";
import type { WachimanConfigV1 } from "./accounts/config";
import { toResultV1 } from "./formats";
import { DEFAULT_MAX_DEPTH, localFiles } from "./connectors/local-git";
import { parseLocalArgs, readInputFile, runLocal, sizeWarning } from "./local";
import { repositoryKey } from "./history/store";
import { SUBSCRIPTION_ENV, SUBSCRIPTION_KEY_REFUSAL } from "./providers/claude-code";
import { A_HEAD, branchRepo, commit, emptyCommits, git, removeTempRepos, type BranchRepo } from "../test/support/temp-repo";

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
type AuthVariant = "claude.ai" | "api_key" | "signed-out" | "no-directory";

/**
 * A temporary `bin/` with a `gh` that leaves a canary and fails, and a `claude` that records its
 * calls, arguments, environment, prompt and the head it was given, then answers per `variant`.
 * Every path is baked into the script text: the child environment is allowlisted.
 */
function stubs(variant: Variant, repoDir: string, auth: AuthVariant = "claude.ai") {
  /** `claude auth status`: signed in with claude.ai and reporting the directory it was given, unless told otherwise. */
  const authAnswer =
    auth === "signed-out"
      ? `echo '{"loggedIn":false,"authMethod":"none"}'; exit 1`
      : auth === "no-directory"
        ? `echo '{"loggedIn":true,"authMethod":"claude.ai"}'; exit 0`
        : `printf '{"loggedIn":true,"authMethod":"%s","configDirectory":"%s"}\\n' "${auth}" "$CLAUDE_CONFIG_DIR"; exit 0`;
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
if [ "$1" = "auth" ]; then
  echo "auth $CLAUDE_CONFIG_DIR" >> "${log}.probes"
  ${authAnswer}
fi
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
    /** `claude auth status` probes, with the CLAUDE_CONFIG_DIR each ran under. */
    probes: () => (read("probes") ?? "").split("\n").filter(Boolean),
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

/** `wachiman local` on a fresh branch repository, with the stubs first on PATH and a temporary HOME. */
function local(variant: Variant, args: string[] = [], extraEnv: Record<string, string> = {}, repo: BranchRepo = branchRepo(), auth: AuthVariant = "claude.ai") {
  const s = stubs(variant, repo.dir, auth);
  const home = extraEnv.HOME ?? temp("wachiman-home-");
  // `"<unset>"` removes a variable the helper sets, to test the real default.
  const env: Record<string, string> = {
    PATH: `${s.bin}:${process.env.PATH ?? ""}`,
    HOME: home,
    USER: "dev",
    WACHIMAN_VERIFY: "0",
    ...extraEnv,
  };
  for (const [k, v] of Object.entries(env)) if (v === "<unset>") delete env[k];
  const out = runCli(["local", "--repo-dir", repo.dir, ...args], env);
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
      profile: "isolated:work",
      agentPrompt: true,
      history: false,
      verify: undefined,
      input: undefined,
    });
    expect(parseLocalArgs([])).toEqual({ paths: [], format: "terminal", profile: undefined, agentPrompt: false, history: false, verify: undefined, input: undefined });
    expect(parseLocalArgs(["--verify"]).verify).toBe(true);
    expect(parseLocalArgs(["--no-verify"]).verify).toBe(false);
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
    [["--max-depth", "0"]],
    [["--max-depth", "abc"]],
    [["--max-depth", "-3"]],
    [["--max-depth", "1.5"]],
    [["--max-depth"]],
  ])("%p is a usage error", (argv) => {
    expect(() => parseLocalArgs(argv)).toThrow(UsageError);
  });

  test("--max-depth takes a positive integer, in both spellings", () => {
    expect(parseLocalArgs(["--max-depth", "100"]).maxDepth).toBe(100);
    expect(parseLocalArgs(["--max-depth=7"]).maxDepth).toBe(7);
    expect(parseLocalArgs([]).maxDepth).toBeUndefined();
  });

  test("--input takes no base, no --from, no --commit and no paths", () => {
    const file = join(temp("wachiman-input-"), "in.json");
    writeFileSync(file, "{}");
    expect(parseLocalArgs(["--input", file]).input).toBe(file);
    expect(() => parseLocalArgs(["--input", file, "src"])).toThrow("takes no --base, --from or --commit, and no paths");
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
    expect(() => readInputFile(file({ ...fixture(), format: "wachiman.review-input/3" }))).toThrow(UsageError);
    expect(() => readInputFile(file({ ...fixture(), files: [{ filename: "a" }] }))).toThrow("files");
    expect(() => readInputFile(file({ ...fixture(), change: { ...fixture().change, head: { sha: "nope" } } }))).toThrow("change.head.sha");
    expect(() => readInputFile(file({ ...fixture(), scope: [1] }))).toThrow("scope");
    expect(() => readInputFile(file({ ...fixture(), headDir: "/tmp/x" }))).toThrow("headDir");
  });
});

describe("wachiman local with WACHIMAN_LEDGER_URL set (the laptop read side's setting)", () => {
  test("runs normally: exit 0, no ledger request, no ledger or Actions line on stderr", () => {
    const r = local("ok", [], { WACHIMAN_LEDGER_URL: "https://ledger.invalid", WACHIMAN_LEDGER_TOKEN: "t" });
    expect(r.code).toBe(0);
    expect(r.stderr).not.toMatch(/ledger|GitHub Actions run/i);
  });
});

describe("wachiman local", () => {
  test("reviews the branch, prints progress on stderr and the report on stdout, and never calls gh", () => {
    const r = local("ok");
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
    expect(r.stdout).toContain("src/a.ts:2  Important · 🟠🐛 Fix · bug: T (confidence high)");
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
  }, 30_000);

  test("prints the depth after the merge-base, before any call", () => {
    const r = local("ok");
    expect(r.code).toBe(0);
    const lines = r.stderr.split("\n");
    // branchRepo's feat/x has two commits past the merge-base.
    expect(lines).toContain(`depth: 2 commits (max ${DEFAULT_MAX_DEPTH})`);
    expect(lines.indexOf(`depth: 2 commits (max ${DEFAULT_MAX_DEPTH})`)).toBe(lines.indexOf(`merge-base: ${sha7(r.repo.mergeBase)}`) + 1);
  }, 30_000);

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
  }, 30_000);

  test("--format json writes only the result on stdout", () => {
    const r = local("ok", ["--format", "json"]);
    expect(r.code).toBe(0);
    const result = JSON.parse(r.stdout);
    expect(result.format).toBe("wachiman.review-result/1");
    expect(result.provider.profile).toBe("default");
    expect(result.change.kind).toBe("branch");
    expect(result.execution.costUsdEstimate).toBe(0.01);
    expect(r.stderr).toContain(`merge-base: ${sha7(r.repo.mergeBase)}`);
  }, 30_000);

  test("--output writes the Markdown file and prints the path", () => {
    const out = join(temp("wachiman-out-"), "review.md");
    const r = local("ok", ["--format", "markdown", "--output", out]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain(`report: ${out}`);
    const md = readFileSync(out, "utf8");
    expect(md).toStartWith("# Wachiman review of branch `feat/x`");
    expect(md).toContain("## Prompt for your agent");
  }, 30_000);

  test("ANTHROPIC_API_KEY set: exit 2 before any call", () => {
    const r = local("ok", [], { ANTHROPIC_API_KEY: "sk-ant-test" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(SUBSCRIPTION_KEY_REFUSAL);
    expect(r.read("calls")).toBeUndefined();
  }, 30_000);

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
  }, 30_000);

  test("a usage-limit rejection ends with stop: quota, exit 0, and lists what was not reviewed", () => {
    const r = local("quota", [], { WACHIMAN_BATCH_LINES: "1" });
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain("batches: 1\n");
    expect(r.stdout).toContain("stop: quota — the account's usage limit ended the run; 4 file(s) not reviewed:");
    // The binary image is not a file the model could review, so it is not counted among the unreviewed.
    expect(r.stdout).toContain("not reviewable: img.png (binary)");
    expect(r.stdout).toContain("not reached: the provider rejected the call");
    expect(r.calls()).toHaveLength(1);
  }, 30_000);

  test("Ctrl-C stops the review after the call it interrupted, removes the snapshot and exits 130", () => {
    const r = local("interrupt", [], { WACHIMAN_BATCH_LINES: "1" });
    expect(r.code).toBe(130);
    expect(r.stderr).toContain("Interrupted");
    expect(r.calls()).toHaveLength(1);
    for (const dir of (r.read("dirs") ?? "").split("\n").filter(Boolean)) expect(existsSync(dir)).toBe(false);
  }, 30_000);

  describe("the size gate only warns", () => {
    /** An --input file with `count` files of 1,000 changed lines each, every one in its own module: one batch per file. */
    const sizedInput = (repo: BranchRepo, count: number) => {
      const fixture = JSON.parse(readFileSync(join(import.meta.dir, "../test/fixtures/formats/review-input.branch.json"), "utf8"));
      fixture.change.head.sha = repo.head;
      fixture.files = Array.from({ length: count }, (_, i) => ({ filename: `pkg${i}/mod.ts`, additions: 1000, deletions: 0, patch: "@@ -0,0 +1,1 @@\n+x" }));
      const file = join(temp("wachiman-input-"), "input.json");
      writeFileSync(file, JSON.stringify(fixture));
      return file;
    };
    const WARNING = /^warning: reviewing all of this would cost about \$\d+\.\d\d at API prices \(\d+ batches × \$0\.\d\d for [^)]+\), above the \$6\.00 size gate\./m;

    test("a large input prints one warning and still calls the model", () => {
      const repo = branchRepo();
      const r = local("ok", ["--input", sizedInput(repo, 30)], { WACHIMAN_MODEL: "claude-sonnet-5-5" }, repo);
      expect(r.code).toBe(0);
      expect(r.stderr.match(/^warning: reviewing all of this/gm)).toHaveLength(1);
      expect(r.stderr).toMatch(WARNING);
      expect(r.stderr).toContain("stops at its budget, $3.00 (WACHIMAN_BUDGET_USD).");
      expect(r.calls().length).toBeGreaterThan(0);
    }, 30_000);

    test("a small input prints no warning", () => {
      const repo = branchRepo();
      const r = local("ok", ["--input", sizedInput(repo, 2)], {}, repo);
      expect(r.code).toBe(0);
      expect(r.stderr).not.toContain("size gate");
    }, 30_000);

    test("the warning text names the estimate, the batches, the model, the gate and the budget", () => {
      const estimate = { files: 606, lines: 58706, batches: 68, perBatchUsd: 0.32, usd: 21.76 };
      expect(sizeWarning(estimate, 6, 3, "claude-sonnet-5-5")).toBe(
        "warning: reviewing all of this would cost about $21.76 at API prices (68 batches × $0.32 for claude-sonnet-5-5), above the $6.00 size gate. Local runs are never refused; this one continues and stops at its budget, $3.00 (WACHIMAN_BUDGET_USD).",
      );
      expect(sizeWarning({ ...estimate, usd: 6 }, 6, 3, "m")).toBeNull();
    });
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

    writeFileSync(file, JSON.stringify({ ...fixture, format: "wachiman.review-input/3" }));
    const wrong = local("ok", ["--input", file], {}, repo);
    expect(wrong.code).toBe(2);
    expect(wrong.stderr).toContain("Unknown review input format");

    writeFileSync(file, JSON.stringify({ ...fixture, change: { ...fixture.change, head: { sha: "f".repeat(40) } } }));
    const absent = local("ok", ["--input", file], {}, repo);
    expect(absent.code).toBe(2);
    expect(absent.stderr).toContain("is not a commit");
    expect(absent.read("calls")?.includes("-p")).toBeFalsy();
  }, 30_000);

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
    expect(missing.stderr).toContain("wachiman --setup-profile work");
  }, 30_000);

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
    expect(out.stderr.toString()).toContain("wachiman local --profile isolated:work");
    // The alias notice, and the managed entry it registered.
    expect(out.stderr.toString()).toContain("alias of `wachiman profile create work`");
    const config = JSON.parse(readFileSync(join(home, ".wachiman", "config.json"), "utf8"));
    expect(config.profiles.work).toMatchObject({ kind: "managed", configDir: join(home, ".wachiman", "claude-work") });
  }, 30_000);

  test("codex is refused in local mode", () => {
    const r = local("ok", [], { WACHIMAN_PROVIDER: "codex" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("only on Claude Code");
    expect(r.read("calls")).toBeUndefined();
  }, 30_000);

  test("local has its own help and --setup-profile stays out of the root help; GH_TOKEN is not required for them", () => {
    const help = runCli(["local", "--help"], { PATH: process.env.PATH ?? "" });
    expect(help.stdout).toContain("wachiman local [paths…]");
    expect(runCli(["--help"], { PATH: process.env.PATH ?? "" }).stdout).not.toContain("--setup-profile");
    expect(runCli(["--setup-profile", "--help"], { PATH: process.env.PATH ?? "" }).stdout).toContain("wachiman profile create [<name>]");
    // The first test ran without GH_TOKEN and GITHUB_REPOSITORY; a usage error here would name them.
    const r = local("ok");
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain("GH_TOKEN");
  }, 30_000);
});

describe("the start commit and the maximum depth", () => {
  const sha = (dir: string, rev: string) => git(dir, "rev-parse", rev).trim();
  const noReview = (r: { calls: () => string[]; canary: string }) => {
    expect(r.calls()).toEqual([]);
    expect(existsSync(r.canary)).toBe(false);
  };

  test("DEFAULT_MAX_DEPTH + 1 commits past the merge-base: exit 2, the message, zero provider calls", () => {
    const repo = branchRepo();
    emptyCommits(repo.dir, DEFAULT_MAX_DEPTH - 1); // feat/x already has 2
    expect(git(repo.dir, "rev-list", "--count", `${repo.mergeBase}..HEAD`).trim()).toBe(String(DEFAULT_MAX_DEPTH + 1));
    const r = local("ok", [], {}, repo);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(
      `The range from ${sha7(repo.mergeBase)} to ${sha7(sha(repo.dir, "HEAD"))} is ${DEFAULT_MAX_DEPTH + 1} commits, more than the maximum depth of ${DEFAULT_MAX_DEPTH}. Pass a closer --base <commit>, or raise the limit with --max-depth <n>.`,
    );
    noReview(r);
    expect(r.stdout).toBe("");
    // The refusal came before the snapshot: no temporary directory was handed to a call.
    expect(r.read("dirs")).toBeUndefined();
  }, 30_000);

  test("exactly DEFAULT_MAX_DEPTH commits runs", () => {
    const repo = branchRepo();
    emptyCommits(repo.dir, DEFAULT_MAX_DEPTH - 2); // feat/x already has 2
    expect(git(repo.dir, "rev-list", "--count", `${repo.mergeBase}..HEAD`).trim()).toBe(String(DEFAULT_MAX_DEPTH));
    const r = local("ok", [], {}, repo);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain(`depth: ${DEFAULT_MAX_DEPTH} commits (max ${DEFAULT_MAX_DEPTH})`);
  }, 30_000);

  test("--max-depth sets the cap for the run: 100 is shown on 51 commits, 1 refuses a short branch", () => {
    const repo = branchRepo();
    emptyCommits(repo.dir, 49);
    const wide = local("ok", ["--max-depth", "100"], {}, repo);
    expect(wide.code).toBe(0);
    expect(wide.stderr).toContain("depth: 51 commits (max 100)");

    const narrow = local("ok", ["--max-depth=1"], {}, branchRepo());
    expect(narrow.code).toBe(2);
    expect(narrow.stderr).toContain("is 2 commits, more than the maximum depth of 1.");
    noReview(narrow);
  }, 30_000);

  test.each(["0", "abc"])("--max-depth %s is a usage error before any call", (value) => {
    const r = local("ok", ["--max-depth", value]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--max-depth");
    noReview(r);
  });

  test("on the base branch without --base: exit 2, nothing to review", () => {
    const repo = branchRepo();
    git(repo.dir, "switch", "-q", "main");
    const r = local("ok", [], {}, repo);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(
      "HEAD is on main, which is the base: there is no branch to review. Check out your branch, or pass --base <commit> to review from that commit.",
    );
    noReview(r);
  }, 30_000);

  test("on the base branch with --base <older commit> within the depth: runs", () => {
    const repo = branchRepo();
    git(repo.dir, "switch", "-q", "main");
    const r = local("ok", ["--base", repo.mergeBase], {}, repo);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain(`merge-base: ${sha7(repo.mergeBase)}`);
    expect(r.stderr).toContain(`depth: 1 commit (max ${DEFAULT_MAX_DEPTH})`);
    expect(r.calls().length).toBeGreaterThan(0);
  }, 30_000);

  test("on the base branch with --base further back than the depth: exit 2, zero calls", () => {
    const repo = branchRepo();
    git(repo.dir, "switch", "-q", "main");
    emptyCommits(repo.dir, DEFAULT_MAX_DEPTH);
    const r = local("ok", ["--base", repo.mergeBase], {}, repo);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(`is ${DEFAULT_MAX_DEPTH + 1} commits, more than the maximum depth of ${DEFAULT_MAX_DEPTH}.`);
    noReview(r);
  }, 30_000);

  test("a feature branch with no commit of its own is the base too", () => {
    const repo = branchRepo();
    git(repo.dir, "switch", "-q", "-c", "feat/empty", "main");
    const r = local("ok", [], {}, repo);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("which is the base");
    noReview(r);
  }, 30_000);

  test("uncommitted work, staged, unstaged and untracked, is not reviewed", () => {
    const repo = branchRepo();
    writeFileSync(join(repo.dir, "src/a.ts"), `${A_HEAD}export const unstagedEdit = 1;\n`);
    writeFileSync(join(repo.dir, "src/b.ts"), "export const stagedEdit = 1;\n");
    git(repo.dir, "add", "src/b.ts");
    writeFileSync(join(repo.dir, "src/untracked.ts"), "export const untrackedFile = 1;\n");
    const r = local("ok", [], {}, repo);
    expect(r.code).toBe(0);
    const prompt = r.read("prompt") ?? "";
    for (const text of ["unstagedEdit", "stagedEdit", "untrackedFile", "untracked.ts"]) expect(prompt).not.toContain(text);
    expect(r.stderr).toContain("files: 5 (0 excluded)");
  }, 30_000);

  test("--input has no git range, so the depth is not checked", () => {
    const repo = branchRepo();
    const head = emptyCommits(repo.dir, 60);
    const fixture = JSON.parse(readFileSync(join(import.meta.dir, "../test/fixtures/formats/review-input.branch.json"), "utf8"));
    fixture.change.head.sha = head;
    fixture.files = localFiles(repo.dir, repo.mergeBase, head);
    const file = join(temp("wachiman-input-"), "input.json");
    writeFileSync(file, JSON.stringify(fixture));
    const r = local("ok", ["--input", file], {}, repo);
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain("depth:");
  }, 30_000);
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
  }, 30_000);

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
    // The history keeps the full /2 result; the JSON sink writes its /1 form for a committed change.
    expect(saved.result.format).toBe("wachiman.review-result/2");
    expect(toResultV1(saved.result)).toEqual(JSON.parse(r.stdout));
    expect(saved.tracking).toHaveLength(1);
    expect(saved.tracking[0].status).toBe("new");
  }, 30_000);

  test("WACHIMAN_HISTORY=1 is the same switch", () => {
    const r = local("ok", [], { WACHIMAN_HISTORY: "1" });
    expect(r.code).toBe(0);
    expect(runFiles(r.home)).toHaveLength(1);
    expect(r.stdout).toContain("· id ");
  }, 30_000);

  test("the prompts are byte-identical with and without --history", () => {
    const repo = branchRepo();
    const without = local("ok", [], {}, repo);
    const withHistory = local("ok", ["--history"], {}, repo);
    expect(without.read("prompt")).toBeDefined();
    // Each run's scratch directory has a random name; nothing else may differ.
    const scrub = (text: string) => text.replace(/(wachiman-review|wachiman-snapshot)-[A-Za-z0-9]+/g, "$1-X");
    expect(scrub(withHistory.read("prompt") as string)).toBe(scrub(without.read("prompt") as string));
    expect(withHistory.read("args")?.split("\n").filter((a) => !a.startsWith("/"))).toEqual(
      without.read("args")?.split("\n").filter((a) => !a.startsWith("/")),
    );
  }, 30_000);

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
  }, 30_000);

  test("--format json prints this run's labels and ids on stderr, before the settled block", () => {
    const home = temp("wachiman-home-");
    const repo = branchRepo();
    const first = local("ok", ["--history", "--format", "json"], { HOME: home }, repo);
    expect(first.stderr).toMatch(/This run \(history\):\n  new  src\/a\.ts:2  T  \(id [0-9a-f]{10}\)\n/);
    const second = local("ok", ["--history", "--format", "json"], { HOME: home }, repo);
    const id = (text: string) => text.match(/\(id ([0-9a-f]{10})\)/)?.[1];
    expect(second.stderr).toContain(`open since ${sha7(repo.head)}, 2 runs  src/a.ts:2  T  (id `);
    expect(id(second.stderr)).toBe(id(first.stderr));
    expect(second.stderr.indexOf("This run (history):")).toBeLessThan(second.stderr.indexOf("Since the last run"));
    expect(second.stdout).not.toContain("This run");
    expect(JSON.parse(second.stdout).format).toBe("wachiman.review-result/1");
  }, 30_000);

  test("--result-version 2 with --history prints an id on every finding, the one `history --verdict` accepts; /1 and a run without history carry none", async () => {
    const home = temp("wachiman-home-");
    const repo = branchRepo();
    const two = local("ok", ["--history", "--format", "json", "--result-version", "2"], { HOME: home }, repo);
    expect(two.code).toBe(0);
    const findings = JSON.parse(two.stdout).findings as { id?: string }[];
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) expect(f.id).toMatch(/^[0-9a-f]{10}$/);
    const { validate } = await import("../test/support/json-schema");
    const v2 = JSON.parse(readFileSync(join(import.meta.dir, "../docs/formats/review-result.v2.schema.json"), "utf8"));
    expect(validate(v2, JSON.parse(two.stdout))).toEqual([]);
    // The same id the stderr block prints, and the one the verdict command accepts.
    expect(two.stderr).toContain(`(id ${findings[0].id})`);
    const whome = join(home, ".wachiman");
    const verdict = Bun.spawnSync([process.execPath, cli, "history", "--repo-dir", repo.dir, "--verdict", findings[0].id!, "wrong", "--reason", "test"], {
      env: { PATH: process.env.PATH ?? "", HOME: home, WACHIMAN_HOME: whome, USER: "dev" },
      stdin: "ignore",
    });
    expect(verdict.exitCode).toBe(0);
    expect(verdict.stdout.toString()).toContain(`Recorded: ${findings[0].id} is wrong.`);
    // A second run keeps the first id.
    const again = local("ok", ["--history", "--format", "json", "--result-version", "2"], { HOME: home }, repo);
    expect(JSON.parse(again.stdout).findings[0].id).toBe(findings[0].id);
    // /1 is unchanged, and without history there is no id.
    const one = local("ok", ["--history", "--format", "json"], { HOME: home }, repo);
    expect(JSON.parse(one.stdout).findings.every((f: object) => !("id" in f))).toBe(true);
    const bare = local("ok", ["--format", "json", "--result-version", "2"], {}, repo);
    expect(JSON.parse(bare.stdout).findings.every((f: object) => !("id" in f))).toBe(true);
  }, 60_000);

  test("a second run labels the finding open since the first head, with its id", () => {
    const home = temp("wachiman-home-");
    const repo = branchRepo();
    const first = local("ok", ["--history"], { HOME: home }, repo);
    expect(first.stdout).toMatch(/src\/a\.ts:2  Important · 🟠🐛 Fix · bug: T \(confidence high\)  new · id [0-9a-f]{10}\n/);
    const second = local("ok", ["--history"], { HOME: home }, repo);
    expect(second.code).toBe(0);
    expect(second.stdout).toMatch(new RegExp(`open since ${sha7(repo.head)} · 2 runs · id [0-9a-f]{10}\\n`));
    expect(second.stdout).toContain(`Since the last run (${sha7(repo.head)}, `);
    expect(runFiles(home)).toHaveLength(2);
    const id = (text: string) => text.match(/· id ([0-9a-f]{10})/)?.[1];
    expect(id(second.stdout)).toBe(id(first.stdout));
  }, 30_000);

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
  }, 30_000);

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
  }, 30_000);

  test("WACHIMAN_HISTORY_DAYS prunes old runs at save time, and a bad value exits 2 before any call", () => {
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

    const bad = local("ok", ["--history"], { HOME: home, WACHIMAN_HISTORY_DAYS: "x" }, repo);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("WACHIMAN_HISTORY_DAYS");
    expect(bad.calls()).toEqual([]);
    expect(runFiles(home)).toHaveLength(1);
  }, 30_000);

  test("Ctrl-C saves nothing", () => {
    const r = local("interrupt", ["--history"], { WACHIMAN_BATCH_LINES: "1" });
    expect(r.code).toBe(130);
    expect(runFiles(r.home)).toEqual([]);
  }, 30_000);

  test("a failure to save is a warning, and the report is still printed", () => {
    const home = temp("wachiman-home-");
    writeFileSync(join(home, ".wachiman"), "a file where the directory should go");
    const r = local("ok", ["--history"], { HOME: home });
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("history: this run was not saved");
    expect(r.stdout).toContain("src/a.ts:2");
  }, 30_000);
});

describe("--commit and --from", () => {
  const sha = (dir: string, rev: string) => git(dir, "rev-parse", rev).trim();
  const noReview = (r: { calls: () => string[]; canary: string }) => {
    expect(r.calls()).toEqual([]);
    expect(existsSync(r.canary)).toBe(false);
  };
  const filesLine = (stderr: string) => stderr.split("\n").find((l) => l.startsWith("files: "));

  test("--commit on HEAD reviews that commit alone, from its parent", () => {
    const repo = branchRepo();
    const parent = sha(repo.dir, "HEAD~1");
    const r = local("ok", ["--commit", "HEAD"], {}, repo);
    expect(r.code).toBe(0);
    const lines = r.stderr.split("\n");
    expect(lines).toContain(`mode: one commit (${sha7(repo.head)})`);
    expect(lines).toContain(`start: ${sha7(parent)}`);
    expect(lines).toContain("depth: 1 commit");
    expect(lines).toContain(`head: ${sha7(repo.head)}`);
    // The head commit renames old.ts, changes the image and the rules; src/b.ts came one commit earlier.
    expect(lines).toContain("files: 3 (0 excluded)");
    const prompt = r.read("prompt") ?? "";
    expect(prompt).toContain("src/new.ts");
    expect(prompt).not.toContain("src/b.ts");
    expect(r.stdout).toContain(`at ${sha7(repo.head)}`);
  }, 30_000);

  test("--commit on an older commit, with HEAD detached elsewhere: its diff and snapshot, working tree untouched", () => {
    const repo = branchRepo();
    const older = sha(repo.dir, "HEAD~1");
    git(repo.dir, "switch", "-q", "--detach", "main");
    writeFileSync(join(repo.dir, "scratch.txt"), "uncommitted\n");
    const status = git(repo.dir, "status", "--porcelain");
    const r = local("ok", ["--commit", older], {}, repo);
    expect(r.code).toBe(0);
    expect(r.stderr.split("\n")).toContain(`mode: one commit (${sha7(older)})`);
    expect(r.stderr.split("\n")).toContain("files: 2 (0 excluded)");
    const prompt = r.read("prompt") ?? "";
    expect(prompt).toContain("src/b.ts");
    expect(prompt).not.toContain("scratch.txt");
    expect(prompt).not.toContain("src/new.ts");
    expect(r.read("head-a")).toBe(A_HEAD);
    expect(sha(repo.dir, "HEAD")).toBe(repo.mainTip);
    expect(git(repo.dir, "status", "--porcelain")).toBe(status);
    expect(readFileSync(join(repo.dir, "scratch.txt"), "utf8")).toBe("uncommitted\n");
  }, 30_000);

  test("--commit on a merge commit reviews it against its first parent, and says so", () => {
    const repo = branchRepo();
    git(repo.dir, "switch", "-q", "main");
    git(repo.dir, "merge", "-q", "--no-ff", "-m", "merge feat/x", "feat/x");
    const merge = sha(repo.dir, "HEAD");
    const r = local("ok", ["--commit", merge], {}, repo);
    expect(r.code).toBe(0);
    const lines = r.stderr.split("\n");
    expect(lines).toContain(`mode: one commit (${sha7(merge)}), a merge commit: first parent`);
    expect(lines).toContain(`start: ${sha7(repo.mainTip)}`);
    // main's own commit is in the first parent; what the merge brought is the feat/x change.
    expect(lines).toContain("files: 5 (0 excluded)");
    expect(r.read("prompt") ?? "").not.toContain("docs/later.md");
  }, 30_000);

  test("--commit on a root commit is diffed against the empty tree", () => {
    const repo = branchRepo();
    const r = local("ok", ["--commit", repo.mergeBase], {}, repo);
    expect(r.code).toBe(0);
    const lines = r.stderr.split("\n");
    expect(lines).toContain(`mode: one commit (${sha7(repo.mergeBase)})`);
    expect(lines).toContain("start: the empty tree (a root commit)");
    expect(lines).toContain("files: 4 (0 excluded)");
  }, 30_000);

  test("--from reviews from that commit forward, inclusive of its own changes", () => {
    const repo = branchRepo();
    const first = sha(repo.dir, "HEAD~1");
    const parent = repo.mergeBase;
    const r = local("ok", ["--from", first], {}, repo);
    expect(r.code).toBe(0);
    const lines = r.stderr.split("\n");
    expect(lines).toContain(`mode: from ${sha7(first)} to HEAD`);
    expect(lines).toContain(`start: ${sha7(parent)}`);
    expect(lines).toContain(`depth: 2 commits (max ${DEFAULT_MAX_DEPTH})`);
    expect(lines).toContain(`head: feat/x (${sha7(repo.head)})`);
    expect(r.read("prompt") ?? "").toContain("src/b.ts"); // added by the named commit itself

    const last = local("ok", ["--from", repo.head], {}, repo);
    expect(last.stderr.split("\n")).toContain(`depth: 1 commit (max ${DEFAULT_MAX_DEPTH})`);
    expect(filesLine(last.stderr)).toBe("files: 3 (0 excluded)");
  }, 30_000);

  test("--from a root commit starts from the empty tree", () => {
    const repo = branchRepo();
    const r = local("ok", ["--from", repo.mergeBase], {}, repo);
    expect(r.code).toBe(0);
    expect(r.stderr.split("\n")).toContain("start: the empty tree (a root commit)");
    expect(r.stderr.split("\n")).toContain(`depth: 3 commits (max ${DEFAULT_MAX_DEPTH})`);
  }, 30_000);

  test("--from a commit that is not an ancestor of HEAD: exit 2, zero calls", () => {
    const repo = branchRepo();
    const r = local("ok", ["--from", repo.mainTip], {}, repo);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(`--from ${sha7(repo.mainTip)} is not an ancestor of HEAD`);
    noReview(r);
    expect(r.read("dirs")).toBeUndefined();
  }, 30_000);

  test("--from needs a branch HEAD; --commit does not", () => {
    const repo = branchRepo();
    git(repo.dir, "switch", "-q", "--detach", "feat/x");
    const from = local("ok", ["--from", "HEAD~1"], {}, repo);
    expect(from.code).toBe(2);
    expect(from.stderr).toContain("HEAD is detached");
    noReview(from);
  }, 30_000);

  test("--from over the depth: exit 2, zero provider calls; --max-depth lifts it", () => {
    const repo = branchRepo();
    const first = sha(repo.dir, "HEAD~1");
    emptyCommits(repo.dir, DEFAULT_MAX_DEPTH);
    const r = local("ok", ["--from", first], {}, repo);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(`is ${DEFAULT_MAX_DEPTH + 2} commits, more than the maximum depth of ${DEFAULT_MAX_DEPTH}`);
    noReview(r);
    expect(r.read("dirs")).toBeUndefined();
    const raised = local("ok", ["--from", first, "--max-depth", String(DEFAULT_MAX_DEPTH + 2)], {}, repo);
    expect(raised.code).toBe(0);
  }, 30_000);

  test("an unknown revision is a usage error", () => {
    for (const flag of ["--commit", "--from"]) {
      const r = local("ok", [flag, "nope"]);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain(`${flag} nope is not a commit in this clone.`);
      noReview(r);
    }
  }, 30_000);

  test("--commit, --from and --base exclude each other, and --input excludes all three", () => {
    const pairs = [
      ["--commit", "HEAD", "--from", "HEAD"],
      ["--commit", "HEAD", "--base", "main"],
      ["--from", "HEAD", "--base", "main"],
    ];
    for (const args of pairs) {
      const flags = [args[0], args[2]];
      expect(() => parseLocalArgs(args)).toThrow(new UsageError(`${flags[0]} and ${flags[1]} cannot be used together.`));
      const r = local("ok", args);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain(`${flags[0]} and ${flags[1]} cannot be used together.`);
      noReview(r);
    }
    const file = join(temp("wachiman-input-"), "input.json");
    writeFileSync(file, "{}");
    for (const flag of ["--commit", "--from", "--base"]) {
      expect(() => parseLocalArgs(["--input", file, flag, "HEAD"])).toThrow(UsageError);
    }
  }, 30_000);

  test("--history of an older commit leaves findings first seen at a newer head unsettled", () => {
    const home = temp("wachiman-home-");
    const repo = branchRepo();
    const older = sha(repo.dir, "HEAD~1");
    const first = local("ok", ["--history"], { HOME: home }, repo);
    expect(first.stdout).toMatch(/src\/a\.ts:2  .* new · id /);
    // The older commit touches src/a.ts and reports nothing: at the newer head that would settle it.
    const old = local("none", ["--history", "--commit", older], { HOME: home }, repo);
    expect(old.code).toBe(0);
    expect(old.stdout).toMatch(/unknown +1 finding\(s\)/);
    expect(old.stdout).not.toContain("probably fixed");
    expect(old.stdout).not.toContain("not repeated");
  }, 30_000);
});

describe("accounts in local", () => {
  const wrapper = join(import.meta.dir, "..", "bin", "wachiman");

  /** An external profile whose directory exists, a binding for `repo`, and a Wachiman home that holds both. */
  function accounts(repo: BranchRepo, opts: { binding?: string; defaultProfile?: string; binary?: string } = {}) {
    const whome = temp("wachiman-whome-");
    const workDir = temp("wachiman-work-a-");
    const config: WachimanConfigV1 = {
      version: 1,
      ...(opts.defaultProfile ? { defaultProfile: opts.defaultProfile } : {}),
      profiles: {
        "work-a": { kind: "external", configDir: workDir, ...(opts.binary ? { binary: opts.binary } : {}), createdAt: "t" },
        "work-b": { kind: "external", configDir: temp("wachiman-work-b-"), createdAt: "t" },
      },
      projects: opts.binding
        ? { [repositoryKey(repo.dir).key]: { profile: opts.binding, keyedBy: "path", name: "r", boundAt: "t", boundFrom: repo.dir } }
        : {},
    };
    writeFileSync(join(whome, "config.json"), JSON.stringify(config));
    return { whome, workDir };
  }

  test("a binding beats WACHIMAN_PROFILE: the profile line prints the ignored value and the binding's directory is used", () => {
    const repo = branchRepo();
    const { whome, workDir } = accounts(repo, { binding: "work-a" });
    const r = local("ok", [], { WACHIMAN_HOME: whome, WACHIMAN_PROFILE: "work-b" }, repo);
    expect(r.code).toBe(0);
    const line = r.stderr.split("\n").find((l) => l.startsWith("profile: "));
    expect(line).toBe(`profile: work-a (external, ${workDir}; chosen by project binding; WACHIMAN_PROFILE=work-b ignored)`);
    // Before every other pre-call line.
    expect(r.stderr.split("\n").indexOf(line!)).toBeLessThan(r.stderr.split("\n").findIndex((l) => l.startsWith("base: ")));
    expect(r.env().CLAUDE_CONFIG_DIR).toBe(workDir);
    // The confirmation ran under the same directory; the /1 result maps an external profile to `default`.
    expect(r.probes()).toEqual([`auth ${workDir}`]);
    expect(r.stdout).toContain("profile: default");
  }, 30_000);

  test("the configured default and WACHIMAN_PROFILE rungs, and the built-in default line", () => {
    const repo = branchRepo();
    const { whome, workDir } = accounts(repo, { defaultProfile: "work-a" });
    const byDefault = local("ok", [], { WACHIMAN_HOME: whome }, repo);
    expect(byDefault.stderr).toContain(`profile: work-a (external, ${workDir}; chosen by config default)`);
    const byEnv = local("ok", [], { WACHIMAN_HOME: whome, WACHIMAN_PROFILE: "work-b" }, repo);
    expect(byEnv.stderr).toMatch(/profile: work-b \(external, .*; chosen by WACHIMAN_PROFILE; config default=work-a ignored\)/);
    const builtIn = local("ok", [], { WACHIMAN_HOME: temp("wachiman-empty-") });
    expect(builtIn.stderr).toContain("profile: default (your shell's claude; chosen by built-in default)");
  }, 30_000);

  test("a stored binary is the one that runs, with no claude on PATH", () => {
    const repo = branchRepo();
    const s = stubs("ok", repo.dir);
    const { whome, workDir } = accounts(repo, { binding: "work-a", binary: join(s.bin, "claude") });
    const out = runCli(["local", "--repo-dir", repo.dir], { PATH: "/usr/bin:/bin", HOME: temp("wachiman-home-"), USER: "dev", WACHIMAN_HOME: whome });
    expect(out.code).toBe(0);
    expect(out.stderr).toContain(`binary ${join(s.bin, "claude")}`);
    expect(s.env().CLAUDE_CONFIG_DIR).toBe(workDir);
    expect(s.calls().length).toBeGreaterThan(0);
  }, 30_000);

  test("a name that resolves to nothing, on any rung, is exit 2 with no call and no fall-through", () => {
    const repo = branchRepo();
    const { whome } = accounts(repo, { defaultProfile: "work-a" });
    const flag = local("ok", ["--profile", "ghost"], { WACHIMAN_HOME: whome }, repo);
    expect(flag.code).toBe(2);
    expect(flag.stderr).toContain('profile "ghost" is not registered');
    expect(flag.read("calls")).toBeUndefined();
    expect(flag.probes()).toEqual([]);
    expect(flag.stderr).not.toContain("profile: ");
    const env = local("ok", [], { WACHIMAN_HOME: whome, WACHIMAN_PROFILE: "ghost" }, repo);
    expect(env.code).toBe(2);
    expect(env.stderr).toContain("ghost");
    expect(env.read("calls")).toBeUndefined();
  }, 30_000);

  test("a corrupt config is exit 2 with the problem named, and no call", () => {
    const repo = branchRepo();
    const whome = temp("wachiman-whome-");
    writeFileSync(join(whome, "config.json"), JSON.stringify({ version: 2, profiles: {}, projects: {} }));
    const r = local("ok", [], { WACHIMAN_HOME: whome }, repo);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("config.json");
    expect(r.stderr).toContain("version");
    expect(r.read("calls")).toBeUndefined();
  }, 30_000);

  test.each([
    ["signed-out" as const, "wachiman profile login work-a"],
    ["api_key" as const, "billed to a key"],
    ["no-directory" as const, "unverified"],
  ])("an unconfirmed profile (%s) is exit 2 before any review call", (auth, expected) => {
    const repo = branchRepo();
    const { whome } = accounts(repo, { binding: "work-a" });
    const r = local("ok", [], { WACHIMAN_HOME: whome }, repo, auth);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(expected);
    expect(r.stderr).toContain("profile: work-a");
    // The probes ran; the review never did.
    expect(r.probes().length).toBe(1);
    expect(r.read("args")).toBeUndefined();
    expect(r.calls()).toEqual([]);
  });

  test("the built-in default is confirmed too: a key sign-in stops it", () => {
    const r = local("ok", [], { WACHIMAN_HOME: temp("wachiman-empty-") }, branchRepo(), "api_key");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("billed to a key");
    expect(r.calls()).toEqual([]);
  }, 30_000);

  test("an unconfirmed profile makes no provider call: a fake provider is never touched", () => {
    const repo = branchRepo();
    const { whome } = accounts(repo, { binding: "work-a" });
    const touched: string[] = [];
    const provider = new Proxy({} as never, { get: (_t, name) => (touched.push(String(name)), () => undefined) });
    const stderr: string[] = [];
    const run = () =>
      runLocal(
        parseLocalArgs([]),
        repo.dir,
        { WACHIMAN_HOME: whome, PATH: process.env.PATH },
        { stdout: () => {}, stderr: (l) => stderr.push(l), engineVersion: "0" },
        {
          spawn: (_bin, args) => ({ status: args[0] === "--version" ? 0 : 1, stdout: args[0] === "--version" ? "9.9.9" : "{}", stderr: "" }),
          getProvider: () => provider,
        },
      );
    expect(run).toThrow(UsageError);
    expect(run).toThrow("wachiman profile login work-a");
    expect(touched).toEqual([]);
    expect(stderr.some((l) => l.startsWith("profile: work-a"))).toBe(true);
  });

  test("a planted configuration in the reviewed repository changes nothing, and WACHIMAN_CLAUDE_BIN names no binary", () => {
    const repo = branchRepo();
    const { whome } = accounts(repo, { binding: "work-b" });
    const evil = temp("wachiman-evil-");
    writeFileSync(join(evil, "claude"), "#!/bin/sh\ntouch \"$0.ran\"\nexit 0\n");
    chmodSync(join(evil, "claude"), 0o755);
    writeFileSync(join(repo.dir, ".wachiman.json"), JSON.stringify({ profile: "work-a", binary: join(evil, "claude") }));
    mkdirSync(join(repo.dir, ".wachiman"), { recursive: true });
    writeFileSync(join(repo.dir, ".wachiman", "config.json"), JSON.stringify({ profile: "work-a", binary: join(evil, "claude") }));
    writeFileSync(join(repo.dir, "package.json"), JSON.stringify({ name: "x", wachiman: { profile: "work-a", binary: join(evil, "claude") } }));
    const r = local("ok", [], { WACHIMAN_HOME: whome, WACHIMAN_CLAUDE_BIN: join(evil, "claude") }, repo);
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/profile: work-b \(external, .*; chosen by project binding\)/);
    expect(existsSync(join(evil, "claude.ran"))).toBe(false);
    expect(r.calls().length).toBeGreaterThan(0);
  }, 30_000);

  test("bin/wachiman: a binding beats a conflicting WACHIMAN_PROFILE, and the wrapper no longer drops the API key", () => {
    const repo = branchRepo();
    const { whome, workDir } = accounts(repo, { binding: "work-a" });
    const fixture = JSON.parse(readFileSync(join(import.meta.dir, "../test/fixtures/formats/review-input.branch.json"), "utf8"));
    fixture.change.head.sha = repo.head;
    fixture.files = localFiles(repo.dir, repo.mergeBase, repo.head);
    const input = join(temp("wachiman-input-"), "input.json");
    writeFileSync(input, JSON.stringify(fixture));

    const s = stubs("ok", repo.dir);
    const env = { PATH: `${s.bin}:${process.env.PATH ?? ""}`, HOME: temp("wachiman-home-"), USER: "dev", WACHIMAN_HOME: whome, WACHIMAN_PROFILE: "work-b" };
    const out = Bun.spawnSync([wrapper, "local", "--input", input, "--repo-dir", repo.dir], { env, stdin: "ignore" });
    expect(out.exitCode).toBe(0);
    expect(out.stderr.toString()).toContain(`profile: work-a (external, ${workDir}; chosen by project binding; WACHIMAN_PROFILE=work-b ignored)`);
    expect(s.env().CLAUDE_CONFIG_DIR).toBe(workDir);

    // The key now reaches the command, which refuses it itself, identically to `bun src/cli.ts`.
    const keyed = stubs("ok", repo.dir);
    const refused = Bun.spawnSync([wrapper, "local", "--input", input, "--repo-dir", repo.dir], {
      env: { ...env, PATH: `${keyed.bin}:${process.env.PATH ?? ""}`, ANTHROPIC_API_KEY: "sk-ant-test" },
      stdin: "ignore",
    });
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr.toString()).toContain(SUBSCRIPTION_KEY_REFUSAL);
    expect(keyed.read("calls")).toBeUndefined();
  }, 30_000);
});

describe("verification flags", () => {
  const schema = (name: string) => JSON.parse(readFileSync(join(import.meta.dir, `../docs/formats/${name}`), "utf8"));
  const loadedValidate = async () => (await import("../test/support/json-schema")).validate;

  test("--no-verify is parsed; with --verify it is a usage error", () => {
    expect(parseLocalArgs(["--no-verify"])).toMatchObject({ verify: false });
    expect(() => parseLocalArgs(["--verify", "--no-verify"])).toThrow(new UsageError("--verify and --no-verify cannot be used together."));
  });

  test("--result-version takes 1 or 2 and only with --format json", () => {
    expect(parseLocalArgs(["--format", "json", "--result-version", "2"]).resultVersion).toBe(2);
    expect(parseLocalArgs(["--result-version=1", "--format=json"]).resultVersion).toBe(1);
    expect(parseLocalArgs([]).resultVersion).toBeUndefined();
    expect(() => parseLocalArgs(["--format", "json", "--result-version", "3"])).toThrow("--result-version must be 1 or 2");
    expect(() => parseLocalArgs(["--result-version", "1"])).toThrow(new UsageError("--result-version applies only with --format json."));
    expect(() => parseLocalArgs(["--format", "markdown", "--result-version", "2"])).toThrow("--result-version applies only with --format json.");
  });

  test("--result-version 1 without --format json exits 2 before any call", () => {
    const r = local("ok", ["--result-version", "1"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--result-version applies only with --format json.");
    expect(r.calls()).toEqual([]);
  });

  test("a committed change writes result /1 by default, and /2 on request, each valid against its schema", async () => {
    const validate = await loadedValidate();
    const one = local("ok", ["--format", "json"]);
    expect(one.code).toBe(0);
    expect(JSON.parse(one.stdout).format).toBe("wachiman.review-result/1");
    expect(validate(schema("review-result.v1.schema.json"), JSON.parse(one.stdout))).toEqual([]);
    const two = local("ok", ["--format", "json", "--result-version", "2"]);
    expect(JSON.parse(two.stdout).format).toBe("wachiman.review-result/2");
    expect(validate(schema("review-result.v2.schema.json"), JSON.parse(two.stdout))).toEqual([]);
  });

  test("the verify line follows batches: off with WACHIMAN_VERIFY=0 (the helper sets it), on with --verify, the model and the reserve", () => {
    const off = local("ok");
    const lines = off.stderr.split("\n");
    expect(lines[lines.indexOf("batches: 1") + 1]).toBe("verify: off");
    expect(off.calls()).toHaveLength(1);

    const on = local("ok", ["--verify"]);
    const onLines = on.stderr.split("\n");
    expect(onLines[onLines.indexOf("batches: 1") + 1]).toBe("verify: on (claude-opus-5-5, reserve $1.00)");
    // The verifier is a second call, from its own adapter on the same profile.
    expect(on.calls()).toHaveLength(2);
  });

  test("with WACHIMAN_VERIFY unset verification is off, and --verify turns it on", () => {
    const on = local("ok", ["--verify"], { WACHIMAN_VERIFY: "<unset>" });
    expect(on.stderr.split("\n").some((l) => l.startsWith("verify: on ("))).toBe(true);
    expect(on.calls()).toHaveLength(2);
    const off = local("ok", [], { WACHIMAN_VERIFY: "<unset>" });
    expect(off.stderr.split("\n")).toContain("verify: off");
    expect(off.calls()).toHaveLength(1);
  });

  test("--no-verify wins over WACHIMAN_VERIFY=1", () => {
    const r = local("ok", ["--no-verify"], { WACHIMAN_VERIFY: "1" });
    expect(r.stderr.split("\n")).toContain("verify: off");
    expect(r.calls()).toHaveLength(1);
    expect(local("ok", [], { WACHIMAN_VERIFY: "1" }).stderr.split("\n").some((l) => l.startsWith("verify: on ("))).toBe(true);
  });

  test("the verifier can read the base commit, and the base snapshot is gone afterwards", () => {
    const r = local("ok", ["--verify"]);
    const dirs = (r.read("dirs") ?? "").split("\n").filter(Boolean);
    const snapshots = dirs.filter((d) => d.includes("wachiman-snapshot-"));
    // Head for the review call; head and the base for the verifier call.
    expect(snapshots).toHaveLength(3);
    expect(new Set(snapshots).size).toBe(2);
    for (const dir of snapshots) expect(existsSync(dir)).toBe(false);
    expect(r.read("prompt")).toContain("read-only copy of the base commit");
  });
});

describe("working-tree local CLI", () => {
  test("selectors and /1 are refused before provider calls", () => {
    for (const flags of [
      ["--working-tree", "bad"],
      ["--working-tree", "all", "--commit", "HEAD"],
      ["--working-tree", "all", "--base", "main"],
      ["--working-tree", "all", "--format", "json", "--result-version", "1"],
    ])
      expect(() => parseLocalArgs(flags)).toThrow(UsageError);
    const repo = branchRepo();
    const r = local("ok", ["--working-tree", "all", "--format", "json", "--result-version", "1"], {}, repo);
    expect(r.code).toBe(2);
    expect(r.read("calls")).toBeUndefined();
  });
  test("working-tree JSON defaults to /2, keeps metadata in history and cleans its snapshot", () => {
    const repo = branchRepo();
    writeFileSync(join(repo.dir, "src/a.ts"), "export const local = 123;\n");
    const r = local("edit", ["--working-tree", "all", "--format", "json", "--history"], {}, repo);
    expect(r.code).toBe(0);
    const result = JSON.parse(r.stdout);
    expect(result.format).toBe("wachiman.review-result/2");
    expect(result.change.kind).toBe("working-tree");
    expect(result.change.workingTree).toEqual({
      mode: "all",
      baseCommit: repo.head,
      tree: result.change.head.sha,
    });
    expect(r.read("head-a")).toBe("export const local = 123;\n");
    for (const dir of (r.read("dirs") ?? "").trim().split("\n").filter(Boolean)) expect(existsSync(dir)).toBe(false);
  });
});

test("a working-tree /2 input file needs a tree, rejects /1 before probes, and round-trips metadata", () => {
  const repo = branchRepo();
  writeFileSync(join(repo.dir, "src/a.ts"), "export const change = 42;\n");
  git(repo.dir, "add", "src/a.ts");
  const tree = git(repo.dir, "write-tree").trim();
  const fixture = JSON.parse(readFileSync(join(import.meta.dir, "../test/fixtures/formats/review-input.branch.json"), "utf8"));
  fixture.format = "wachiman.review-input/2";
  fixture.change = {
    ...fixture.change,
    kind: "working-tree",
    base: { sha: repo.head },
    head: { sha: tree },
    workingTree: { mode: "staged", baseCommit: repo.head, tree },
  };
  fixture.instructions.baseSha = repo.head;
  fixture.files = localFiles(repo.dir, repo.head, tree);
  const file = join(temp("wachiman-tree-input-"), "input.json");
  writeFileSync(file, JSON.stringify(fixture));
  const refused = local("ok", ["--input", file, "--format", "json", "--result-version", "1"], {}, repo);
  expect(refused.code).toBe(2);
  expect(refused.read("calls")).toBeUndefined();
  expect(refused.probes()).toEqual([]);
  const result = local("ok", ["--input", file, "--format", "json"], {}, repo);
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout).change.workingTree.tree).toBe(tree);
  writeFileSync(file, JSON.stringify({ ...fixture, format: "wachiman.review-input/1" }));
  expect(() => readInputFile(file)).toThrow(/workingTree/);
});
test("working-tree snapshots are removed on provider failure and interrupt", () => {
  for (const variant of ["garbage", "interrupt"] as const) {
    const repo = branchRepo();
    writeFileSync(join(repo.dir, "src/a.ts"), "export const bad = 1;\n");
    const r = local(variant, ["--working-tree", "all"], {}, repo);
    expect(r.code).toBe(variant === "interrupt" ? 130 : 1);
    const dirs = (r.read("dirs") ?? "").trim().split("\n").filter(Boolean);
    expect(dirs.length).toBeGreaterThan(0);
    for (const dir of dirs) expect(existsSync(dir)).toBe(false);
  }
});
test("working-tree verification reads a raw base tree and removes both snapshots", () => {
  const repo = branchRepo();
  writeFileSync(join(repo.dir, "src/a.ts"), "export const local = 1;\n");
  const r = local("ok", ["--working-tree", "all", "--verify"], {}, repo);
  expect(r.code).toBe(0);
  const dirs = (r.read("dirs") ?? "").trim().split("\n").filter(Boolean);
  expect(new Set(dirs).size).toBeGreaterThan(1);
  for (const dir of dirs) expect(existsSync(dir)).toBe(false);
});
