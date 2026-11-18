import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commit, emptyRepo, removeTempRepos } from "../../test/support/temp-repo";
import { snapshotTree } from "../../test/support/tree-snapshot";
import { UsageError } from "../config";
import { parseInitFlags } from "./args";
import { runInitCommand, type InitDeps } from "./run";

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

  test("other github-only flags with local mode are still a usage error", async () => {
    const w = world();
    const error = await init(w, ["--mode", "local", "--dry-run", "--operator", "me"]).then(() => undefined, (e) => e);
    expect(error).toBeInstanceOf(UsageError);
  });
});
