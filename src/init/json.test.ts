import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commit, emptyRepo, removeTempRepos } from "../../test/support/temp-repo";
import { snapshotTree } from "../../test/support/tree-snapshot";
import { UsageError } from "../config";
import { parseInitFlags } from "./args";
import { runInitCommand, runInitFromArgv, type InitDeps } from "./run";

const scratch: string[] = [];
afterAll(() => {
  scratch.forEach((d) => rmSync(d, { recursive: true, force: true }));
  removeTempRepos();
});

const NOW = "2026-11-09T12:00:00.000Z";

function world() {
  const repo = emptyRepo();
  commit(repo, { "README.md": "hello\n" }, "init");
  const home = mkdtempSync(join(tmpdir(), "wachiman-init-home-"));
  scratch.push(home);
  const out: string[] = [];
  const err: string[] = [];
  return {
    repo,
    home,
    out,
    err,
    env: { WACHIMAN_HOME: home },
    io: { stdout: (t: string) => void out.push(t), stderr: (l: string) => void err.push(l) },
    deps: (extra: InitDeps = {}): InitDeps => ({ now: () => NOW, version: "1.9.0", defaultWorkflowRef: "v1.5.0", interactive: false, cwd: "/elsewhere", ...extra }),
  };
}
type World = ReturnType<typeof world>;
const init = (w: World, argv: string[], extra: InitDeps = {}) => runInitCommand(parseInitFlags(argv, w.repo), w.env, w.io, w.deps(extra));
const doc = (w: World) => JSON.parse(w.out.join("")) as Record<string, any>;

describe("init --mode local --dry-run", () => {
  test("exits 0, reports what it would write, and writes nothing in the repository or the home", async () => {
    const w = world();
    const repoBefore = snapshotTree(w.repo);
    const homeBefore = snapshotTree(w.home);
    const code = await init(w, ["--mode", "local", "--dry-run", "--project-kind", "single", "--pr-template"]);
    expect(code).toBe(0);
    expect(w.err.join("\n")).toContain("would write .wachiman.yml (kind: single)");
    expect(w.out.join("")).toBe("");
    expect(snapshotTree(w.repo)).toEqual(repoBefore);
    expect(snapshotTree(w.home)).toEqual(homeBefore);
    expect(existsSync(join(w.repo, ".wachiman.yml"))).toBe(false);
  });

  test("without --json and with nothing to preview, it says so on stderr and prints nothing on stdout", async () => {
    const w = world();
    expect(await init(w, ["--mode", "local", "--dry-run", "--no-agent-pointer"])).toBe(0);
    expect(w.out.join("")).toBe("");
    expect(w.err.join("\n")).toContain("dry run: nothing would be written");
    expect(w.err.join("\n")).toContain("wachiman setup");
  });

  test("other github-only flags with local mode are still a usage error", async () => {
    const w = world();
    const error = await init(w, ["--mode", "local", "--dry-run", "--operator", "me"]).then(() => undefined, (e) => e);
    expect(error).toBeInstanceOf(UsageError);
  });
});

const TEMPLATE_PATH = ".github/pull_request_template.md";
const put = (w: World, path: string, text: string) => {
  mkdirSync(join(w.repo, path, ".."), { recursive: true });
  writeFileSync(join(w.repo, path), text);
};
const actions = (w: World) => doc(w).files.map((f: any) => [f.path, f.action]);

const KEYS = ["format", "ok", "mode", "dryRun", "repoDir", "files", "local", "github", "error"];

describe("init --json", () => {
  test("a real run prints exactly one wachiman.init/1 document and every status line goes to stderr", async () => {
    const w = world();
    const code = await init(w, ["--mode", "both", "--operator", "me", "--project-kind", "single", "--pr-template", "--json"]);
    expect(code).toBe(0);
    const d = doc(w);
    expect(Object.keys(d)).toEqual(KEYS);
    expect(d.format).toBe("wachiman.init/1");
    expect(d).toMatchObject({ ok: true, mode: "both", dryRun: false, error: null });
    expect(d.repoDir).toBe(realpathSync(w.repo));
    expect(d.files).toEqual([
      { path: ".github/workflows/wachiman-review.yml", action: "created" },
      { path: ".wachiman.yml", action: "created" },
      { path: ".github/pull_request_template.md", action: "created" },
      { path: "AGENTS.md", action: "created" },
    ]);
    expect(d.local.status).toBe("pending");
    expect(d.local.pending).toEqual([`wachiman setup --profile <name> --yes --repo-dir ${realpathSync(w.repo)}`]);
    expect(d.github.status).toBe("pending");
    expect(d.github.pending).toEqual(["add ANTHROPIC_API_KEY secret", "commit and open a PR"]);
    expect(w.out).toHaveLength(1);
    expect(w.err.join("\n")).toContain("wrote .github/workflows/wachiman-review.yml");
    expect(existsSync(join(w.repo, ".github", "workflows", "wachiman-review.yml"))).toBe(true);
  });

  test("local mode has no GitHub work and github mode has no local work", async () => {
    const local = world();
    expect(await init(local, ["--mode", "local", "--json"])).toBe(0);
    expect(doc(local)).toMatchObject({ files: [{ path: "AGENTS.md", action: "created" }], github: { status: "not-used", pending: [] }, local: { status: "pending" } });
    const gh = world();
    expect(await init(gh, ["--mode", "github", "--operator", "me", "--json"])).toBe(0);
    expect(doc(gh)).toMatchObject({ local: { status: "not-used", pending: [] }, github: { status: "pending" } });
  });

  test("a dry run puts the rendered workflow in the file entry and writes nothing", async () => {
    const w = world();
    const before = snapshotTree(w.repo);
    expect(await init(w, ["--mode", "github", "--operator", "me", "--project-kind", "single", "--pr-template", "--dry-run", "--json"])).toBe(0);
    const d = doc(w);
    expect(d.dryRun).toBe(true);
    expect(d.files.map((f: any) => [f.path, f.action])).toEqual([
      [".github/workflows/wachiman-review.yml", "would-create"],
      [".wachiman.yml", "would-create"],
      [".github/pull_request_template.md", "would-create"],
      ["AGENTS.md", "would-create"],
    ]);
    expect(d.files[0].content).toContain("/wachiman");
    expect(snapshotTree(w.repo)).toEqual(before);
  });

  test("a local dry run reports would-create for the settings file and the template", async () => {
    const w = world();
    const before = snapshotTree(w.repo);
    expect(await init(w, ["--mode", "local", "--dry-run", "--project-kind", "single", "--pr-template", "--json"])).toBe(0);
    expect(doc(w).files).toEqual([
      { path: ".wachiman.yml", action: "would-create" },
      { path: ".github/pull_request_template.md", action: "would-create" },
      { path: "AGENTS.md", action: "would-create" },
    ]);
    expect(snapshotTree(w.repo)).toEqual(before);
    expect(snapshotTree(w.home)).toEqual({});
  });

  test("a second identical run leaves the repository byte for byte and reports every file unchanged", async () => {
    const w = world();
    const argv = ["--mode", "both", "--operator", "me", "--project-kind", "single", "--pr-template", "--json"];
    expect(await init(w, argv)).toBe(0);
    const after = snapshotTree(w.repo);
    w.out.length = 0;
    expect(await init(w, argv, { now: () => "2027-01-01T00:00:00.000Z" })).toBe(0);
    const d = doc(w);
    expect(d.files.map((f: any) => f.action)).toEqual(["unchanged", "unchanged", "unchanged", "unchanged"]);
    expect(snapshotTree(w.repo)).toEqual(after);
  });

  test("replacing a different workflow with --force reports replaced and the backup path", async () => {
    const w = world();
    expect(await init(w, ["--mode", "github", "--operator", "me", "--json"])).toBe(0);
    w.out.length = 0;
    expect(await init(w, ["--mode", "github", "--operator", "you", "--force", "--json"])).toBe(0);
    const [file] = doc(w).files;
    expect(file.action).toBe("replaced");
    expect(file.backup).toMatch(/^\.github\/workflows\/wachiman-review\.yml\.bak-/);
    expect(existsSync(join(w.repo, file.backup))).toBe(true);
  });

  test("an existing different workflow without --force is a usage error that lists the refused file", async () => {
    const w = world();
    expect(await init(w, ["--mode", "github", "--operator", "me", "--json"])).toBe(0);
    w.out.length = 0;
    expect(await init(w, ["--mode", "github", "--operator", "you", "--json"])).toBe(2);
    const d = doc(w);
    expect(d.ok).toBe(false);
    expect(d.error.code).toBe("usage");
    expect(d.files).toEqual([{ path: ".github/workflows/wachiman-review.yml", action: "refused" }]);
  });

  test.each([
    [["--json"], "--mode"],
    [["--mode", "github", "--json"], "--operator"],
    [["--mode", "both", "--json"], "--operator"],
    [["--mode", "local", "--operator", "me", "--json"], "--operator"],
    [["--mode", "github", "--operator", "me", "--pr-template", "--no-pr-template", "--json"], "contradict"],
    [["--mode", "local", "--bogus", "--json"], "--bogus"],
  ])("usage error %#: one JSON document, exit 2", async (argv, mention) => {
    const w = world();
    const code = await runJson(w, argv);
    expect(code).toBe(2);
    const d = doc(w);
    expect(Object.keys(d)).toEqual(KEYS);
    expect(d).toMatchObject({ format: "wachiman.init/1", ok: false, files: [], error: { code: "usage" } });
    expect(d.error.message).toContain(mention);
    expect(w.out).toHaveLength(1);
  });

  test("with stdin not a terminal and --mode missing it exits 2 naming --mode and never calls a prompter", async () => {
    const w = world();
    const refuse = new Proxy({}, { get: () => () => { throw new Error("a prompter must not be used"); } });
    const code = await runJson(w, ["--json"], { interactive: true, streams: { stdin: { isTTY: false }, stdout: { isTTY: false } }, prompter: refuse as never });
    expect(code).toBe(2);
    expect(doc(w).error.message).toContain("--mode");
  });

  test("--json never prompts even on a terminal", async () => {
    const w = world();
    const refuse = new Proxy({}, { get: () => () => { throw new Error("a prompter must not be used"); } });
    const code = await runJson(w, ["--json"], { interactive: true, streams: { stdin: { isTTY: true }, stdout: { isTTY: true } }, prompter: refuse as never });
    expect(code).toBe(2);
    expect(doc(w).error.message).toContain("--mode");
  });
});

describe("init --json: PR template outcomes", () => {
  const base = ["--mode", "local", "--project-kind", "single", "--pr-template", "--json"];

  test("an unmanaged template is adopted: replaced, with the backup path, and a dry run says would-replace", async () => {
    const dry = world();
    put(dry, TEMPLATE_PATH, "My own template\n");
    expect(await init(dry, [...base, "--dry-run"])).toBe(0);
    expect(actions(dry)).toContainEqual([TEMPLATE_PATH, "would-replace"]);
    const w = world();
    put(w, TEMPLATE_PATH, "My own template\n");
    expect(await init(w, base)).toBe(0);
    const entry = doc(w).files.find((f: any) => f.path === TEMPLATE_PATH);
    expect(entry.action).toBe("replaced");
    expect(typeof entry.backup).toBe("string");
    expect(readFileSync(entry.backup.startsWith("/") ? entry.backup : join(w.repo, entry.backup), "utf8")).toBe("My own template\n");
  });

  test("a template edited by hand is refused in a real run and a dry run, and init still succeeds", async () => {
    const w = world();
    expect(await init(w, base)).toBe(0);
    writeFileSync(join(w.repo, TEMPLATE_PATH), `${readFileSync(join(w.repo, TEMPLATE_PATH), "utf8")}\nhand edit\n`);
    for (const extra of [[], ["--dry-run"]]) {
      w.out.length = 0;
      expect(await init(w, [...base, ...extra])).toBe(0);
      expect(doc(w)).toMatchObject({ ok: true });
      expect(actions(w)).toContainEqual([TEMPLATE_PATH, "refused"]);
    }
  });

  test("a current template is unchanged in a dry run", async () => {
    const w = world();
    expect(await init(w, base)).toBe(0);
    w.out.length = 0;
    expect(await init(w, [...base, "--dry-run"])).toBe(0);
    expect(actions(w)).toContainEqual([TEMPLATE_PATH, "unchanged"]);
  });

  test("an install that stops after the choice file lists that file and refuses the template", async () => {
    const w = world();
    put(w, TEMPLATE_PATH, "## Rollout plan\n\nSteps\n");
    let calls = 0;
    const hooks = { writeTemp: (path: string, content: string) => { if (++calls === 2) throw new Error("disk full"); writeFileSync(path, content, { flag: "wx" }); } };
    expect(await init(w, base, { prTemplate: { hooks } })).toBe(0);
    expect(w.err.join("\n")).toContain("only part of the install was done");
    const files = doc(w).files;
    expect(files.map((f: any) => f.path)).toContain(".github/pr-template.json");
    expect(files.find((f: any) => f.path === TEMPLATE_PATH).action).toBe("refused");
  });
});

describe("init --json: the agent pointer", () => {
  test("a skipped pointer is listed as refused, a turned-off one is not listed", async () => {
    const w = world();
    writeFileSync(join(w.repo, "AGENTS.md"), "<!-- wachiman:begin -->\nno end marker\n");
    expect(await init(w, ["--mode", "local", "--json"])).toBe(0);
    expect(doc(w).files).toEqual([{ path: "AGENTS.md", action: "refused" }]);
    const off = world();
    expect(await init(off, ["--mode", "local", "--no-agent-pointer", "--json"])).toBe(0);
    expect(doc(off).files).toEqual([]);
  });

  test("a block added to an existing file is reported as replaced, and a link is reported by its target", async () => {
    const w = world();
    mkdirSync(join(w.repo, "docs"));
    writeFileSync(join(w.repo, "docs", "rules.md"), "# Rules\n");
    symlinkSync("docs/rules.md", join(w.repo, "CLAUDE.md"));
    expect(await init(w, ["--mode", "local", "--json"])).toBe(0);
    expect(doc(w).files).toEqual([{ path: "docs/rules.md", action: "replaced" }]);
  });
});

describe("init --json: workflow and settings outcomes", () => {
  test("a dry run with a different workflow or a different kind reports refused and would-replace, and still says ok with exit 0", async () => {
    const w = world();
    expect(await init(w, ["--mode", "both", "--operator", "me", "--project-kind", "single", "--json"])).toBe(0);
    w.out.length = 0;
    expect(await init(w, ["--mode", "both", "--operator", "you", "--project-kind", "monorepo", "--dry-run", "--json"])).toBe(0);
    expect(doc(w)).toMatchObject({ ok: true });
    expect(actions(w)).toEqual([[".github/workflows/wachiman-review.yml", "refused"], [".wachiman.yml", "refused"], ["AGENTS.md", "unchanged"]]);
    w.out.length = 0;
    expect(await init(w, ["--mode", "both", "--operator", "you", "--project-kind", "monorepo", "--force", "--dry-run", "--json"])).toBe(0);
    expect(actions(w)).toEqual([[".github/workflows/wachiman-review.yml", "would-replace"], [".wachiman.yml", "would-replace"], ["AGENTS.md", "unchanged"]]);
  });

  test("a different kind in .wachiman.yml without --force is refused in a real run: exit 2 and the file is listed", async () => {
    const w = world();
    expect(await init(w, ["--mode", "local", "--project-kind", "single", "--json"])).toBe(0);
    w.out.length = 0;
    expect(await init(w, ["--mode", "local", "--project-kind", "monorepo", "--json"])).toBe(2);
    expect(doc(w)).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(actions(w)).toEqual([[".wachiman.yml", "refused"]]);
  });

  test("a failure that is not a usage error is code failed with exit 1", async () => {
    const w = world();
    const hooks = { writeTemp: () => { throw new Error("disk full"); } };
    expect(await init(w, ["--mode", "github", "--operator", "me", "--json"], { hooks })).toBe(1);
    expect(doc(w)).toMatchObject({ ok: false, error: { code: "failed" } });
  });
});

/** What `cli.ts` does for `init`: parse (a failure there is still a document under --json), then run. */
const runJson = (w: World, argv: string[], extra: InitDeps = {}) => runInitFromArgv(argv, w.repo, w.env, w.io, w.deps(extra));
