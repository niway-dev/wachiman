/**
 * `wachiman local` and `.wachiman.yml` (ADR 0049): the model and the effort come from the file at
 * the merge-base, never from the branch's own copy, and never over an explicit environment value.
 * A fake `claude` records its arguments; no model, no network, no GitHub.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commit, emptyRepo, git, removeTempRepos } from "../test/support/temp-repo";

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

const FILES = ["src/a.ts"];
const RESULT = JSON.stringify({
  is_error: false,
  subtype: "success",
  num_turns: 1,
  total_cost_usd: 0.01,
  duration_ms: 5,
  structured_output: { files_reviewed: FILES, files_skipped: [], findings: [], contracts: [], thread_replies: [], summary: "clean" },
});

/** A `claude` that answers the version and auth probes, records the arguments of a review call, and returns a clean review. */
function fakeClaude() {
  const bin = temp("wachiman-settings-bin-");
  const args = join(bin, "args");
  writeFileSync(
    join(bin, "claude"),
    `#!/bin/sh
if [ "$1" = "auth" ]; then echo '{"loggedIn":true,"authMethod":"claude.ai"}'; exit 0; fi
if [ "$1" = "--version" ]; then echo "9.9.9 (Claude Code)"; exit 0; fi
printf '%s\\n' "$@" > "${args}"
cat > /dev/null
cat <<'JSON'
${RESULT}
JSON
`,
  );
  chmodSync(join(bin, "claude"), 0o755);
  return { bin, flag: (name: string) => (existsSync(args) ? readFileSync(args, "utf8").split("\n")[readFileSync(args, "utf8").split("\n").indexOf(name) + 1] : undefined), called: () => existsSync(args) };
}

/** A branch whose base holds `base` as `.wachiman.yml` (when given) and whose head holds `head` instead. */
function repoWith(files: { base?: string; head?: string }) {
  const dir = emptyRepo();
  commit(dir, { "src/a.ts": "export const a = 1;\n", ...(files.base !== undefined ? { ".wachiman.yml": files.base } : {}) }, "base");
  git(dir, "switch", "-q", "-c", "feat/x");
  commit(dir, { "src/a.ts": "export const a = 2;\n", ...(files.head !== undefined ? { ".wachiman.yml": files.head } : {}) }, "change");
  git(dir, "switch", "-q", "main");
  git(dir, "switch", "-q", "feat/x");
  return dir;
}

const cli = join(import.meta.dir, "cli.ts");
function local(repo: string, env: Record<string, string> = {}, args: string[] = []) {
  const claude = fakeClaude();
  const out = Bun.spawnSync([process.execPath, cli, "local", "--repo-dir", repo, ...args], {
    env: { PATH: `${claude.bin}:${process.env.PATH ?? ""}`, HOME: temp("wachiman-settings-home-"), USER: "dev", WACHIMAN_VERIFY: "0", ...env },
    stdin: "ignore",
  });
  return { code: out.exitCode, stdout: out.stdout.toString(), stderr: out.stderr.toString(), claude };
}

describe("wachiman local reads .wachiman.yml at the merge-base", () => {
  test("the file's model and effort reach the provider, and the run says they came from the file", () => {
    const r = local(repoWith({ base: "model: claude-opus-5-5\neffort: low\n" }));
    expect(r.code).toBe(0);
    expect(r.claude.flag("--model")).toBe("claude-opus-5-5");
    expect(r.claude.flag("--effort")).toBe("low");
    expect(r.stderr).toContain("settings: model claude-opus-5-5, effort low from .wachiman.yml at the merge-base");
    expect(r.stdout).toMatch(/Claude Opus 5\.5 via Claude Code 9\.9\.9 \(from \.wachiman\.yml\) · effort low \(from \.wachiman\.yml\)/);
  });

  test("the branch's own edit of the file is ignored: the merge-base's values are used", () => {
    const r = local(repoWith({ base: "effort: low\n", head: "effort: max\nmodel: claude-opus-5-5\n" }));
    expect(r.code).toBe(0);
    expect(r.claude.flag("--effort")).toBe("low");
    expect(r.claude.flag("--model")).toBe("claude-sonnet-5-5");
  });

  test("a file that exists only on the branch changes nothing", () => {
    const r = local(repoWith({ head: "effort: max\n" }));
    expect(r.code).toBe(0);
    expect(r.claude.flag("--effort")).toBe("high");
    expect(r.stderr).not.toContain("settings:");
    expect(r.stdout).not.toContain("from .wachiman.yml");
  });

  test("an explicit WACHIMAN_EFFORT wins over the file, and the output does not claim the file chose it", () => {
    const r = local(repoWith({ base: "effort: low\nmodel: claude-opus-5-5\n" }), { WACHIMAN_EFFORT: "medium" });
    expect(r.code).toBe(0);
    expect(r.claude.flag("--effort")).toBe("medium");
    expect(r.claude.flag("--model")).toBe("claude-opus-5-5");
    expect(r.stdout).toContain("effort medium ·");
    expect(r.stdout).not.toContain("effort medium (from");
    expect(r.stderr).toContain("settings: model claude-opus-5-5 from .wachiman.yml");
    expect(r.stderr).not.toContain("effort low");
  });

  test("an invalid effort at the merge-base is ignored with a warning naming the file and the value; the review runs on the defaults", () => {
    const r = local(repoWith({ base: "effort: turbo\n" }));
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/ignored \.wachiman\.yml at the merge-base [0-9a-f]+: .*"turbo"; using defaults/);
    expect(r.claude.flag("--effort")).toBe("high");
    expect(r.stdout).not.toContain("from .wachiman.yml");
  });

  test("unparseable YAML at the merge-base is ignored with a warning, and the review runs", () => {
    const r = local(repoWith({ base: "model: [unclosed\n" }));
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("ignored .wachiman.yml at the merge-base");
    expect(r.stderr).toContain(".wachiman.yml is not valid YAML");
    expect(r.claude.called()).toBe(true);
  });

  test("an invalid file only on the branch is never read", () => {
    const r = local(repoWith({ head: "effort: turbo\n" }));
    expect(r.code).toBe(0);
  });

  test("--working-tree reads the file at HEAD, not the working copy", () => {
    const repo = repoWith({ base: "effort: low\n" });
    commit(repo, { ".wachiman.yml": "effort: xhigh\n" }, "settings at HEAD");
    writeFileSync(join(repo, ".wachiman.yml"), "effort: max\n");
    writeFileSync(join(repo, "src/a.ts"), "export const a = 3;\n");
    const r = local(repo, {}, ["--working-tree", "all", "--format", "json", "--result-version", "2"]);
    expect(r.code).toBe(0);
    expect(r.claude.flag("--effort")).toBe("xhigh");
    expect(r.stderr).toContain("effort xhigh from .wachiman.yml at HEAD");
  });
});
