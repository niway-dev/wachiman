import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commit, git, write } from "../../test/support/temp-repo";
import type { ResultSibling } from "../distributed";
import { spawnGit, type GitRunner } from "../evidence";
import { rematerialiseSiblings } from "./ask";
import { MANIFEST_FILE } from "./manifest";
import { userFilePath } from "./user-file";

const temps: string[] = [];
const tmp = (prefix = "wachiman-ask-ws-") => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const MANIFEST = {
  format: "workspace/1",
  members: [
    { dir: "desktop-app", repo: "acme/desktop-app", visibility: "private" },
    { dir: "web-site", repo: "acme/web-site", visibility: "public" },
  ],
  contracts: [],
};

interface Fixture {
  parent: string;
  webSite: string;
  desktopApp: string;
  home: string;
  /** The commit the stored review read, and the one after it (the clone's HEAD now). */
  first: string;
  second: string;
}

/** `web-site` and `desktop-app` under a manifest; `desktop-app` has two commits, the review read the first. */
function fixture(options: { cloneSibling?: boolean } = {}): Fixture {
  const parent = tmp();
  const webSite = join(parent, "web-site");
  mkdirSync(webSite);
  git(webSite, "init", "-q", "-b", "main");
  commit(webSite, { "src/a.ts": "a\n" }, "base");
  git(webSite, "remote", "add", "origin", "https://github.com/acme/web-site.git");
  const desktopApp = join(parent, "desktop-app");
  let first = "0".repeat(40);
  let second = "0".repeat(40);
  if (options.cloneSibling !== false) {
    mkdirSync(desktopApp);
    git(desktopApp, "init", "-q", "-b", "main");
    first = commit(desktopApp, { "Assets/palette.json": '{"brand":"#0a7"}\n', "Assets/other.json": "{}\n" }, "palette");
    second = commit(desktopApp, { "Assets/palette.json": '{"brand":"#fff"}\n' }, "moved on");
    write(desktopApp, { "Assets/untracked.json": "secret\n" });
  }
  writeFileSync(join(parent, MANIFEST_FILE), JSON.stringify(MANIFEST));
  return { parent, webSite, desktopApp, home: tmp("wachiman-ask-home-"), first, second };
}

const row = (over: Partial<ResultSibling> = {}): ResultSibling => ({
  member: "desktop-app",
  repo: "acme/desktop-app",
  visibility: "private",
  contracts: ["brand-palette"],
  byHand: false,
  rule: "pinned",
  ruleSource: "default",
  readAs: "pinned",
  paths: ["Assets/palette.json"],
  status: "read",
  droppedSymlinks: [],
  droppedSubmodules: [],
  ...over,
});

const ask = (f: Fixture, rows: ResultSibling[], git?: GitRunner) => {
  const warnings: string[] = [];
  const out = rematerialiseSiblings(rows, { repoDir: f.webSite, home: f.home, warn: (l) => warnings.push(l), ...(git ? { git } : {}) });
  return { ...out, warnings };
};

describe("rematerialiseSiblings", () => {
  test("snapshots the stored commit, not the clone's HEAD, with only the stored paths, and removes it on release", () => {
    const f = fixture();
    const out = ask(f, [row({ sha: f.first })]);
    expect(out.siblings).toHaveLength(1);
    const [s] = out.siblings;
    expect(s.status).toBe("read");
    expect(s.sha).toBe(f.first);
    expect(s.paths).toEqual(["Assets/palette.json"]);
    expect(readFileSync(join(s.dir!, "Assets/palette.json"), "utf8")).toBe('{"brand":"#0a7"}\n');
    expect(existsSync(join(s.dir!, "Assets/other.json"))).toBe(false);
    expect(existsSync(join(s.dir!, "Assets/untracked.json"))).toBe(false);
    const dir = s.dir!;
    out.release();
    expect(existsSync(dir)).toBe(false);
    out.release();
  });

  test("rows that read one commit under two contracts share one snapshot with the union of their paths", () => {
    const f = fixture();
    const out = ask(f, [row({ sha: f.first }), row({ sha: f.first, contracts: ["other"], paths: ["Assets/other.json"] })]);
    expect(out.siblings).toHaveLength(1);
    expect(out.siblings[0].paths.sort()).toEqual(["Assets/other.json", "Assets/palette.json"]);
    out.release();
  });

  test("a path with glob characters is read as that path", () => {
    const f = fixture();
    const odd = "Assets/a[1] {x}*.json";
    const sha = commit(f.desktopApp, { [odd]: "{}\n", "Assets/a1 x.json": "no\n" }, "odd name");
    const out = ask(f, [row({ sha, paths: [odd] })]);
    expect(out.siblings[0].paths).toEqual([odd]);
    out.release();
  });

  test("a commit that is gone is named with its reason and has no snapshot; the others are still read", () => {
    const f = fixture();
    const gone = "b".repeat(40);
    const out = ask(f, [row({ sha: gone }), row({ sha: f.first })]);
    const [missing, fine] = out.siblings;
    expect(missing.status).toBe("unreadable");
    expect(missing.sha).toBe(gone);
    expect(missing.dir).toBeUndefined();
    expect(missing.unreadable).toContain("bbbbbbb is gone");
    expect(fine.status).toBe("read");
    out.release();
    expect(existsSync(fine.dir!)).toBe(false);
  });

  test("a member that is not cloned is named", () => {
    const f = fixture({ cloneSibling: false });
    const out = ask(f, [row({ sha: "c".repeat(40) })]);
    expect(out.siblings[0]).toMatchObject({ member: "desktop-app", status: "unreadable" });
    expect(out.siblings[0].unreadable).toContain("not cloned");
    expect(out.siblings[0].dir).toBeUndefined();
  });

  test("a member the manifest no longer lists, and a repository in no workspace, are named, not fatal", () => {
    const f = fixture();
    const out = ask(f, [row({ member: "billing-service", sha: f.first })]);
    expect(out.siblings[0].unreadable).toContain("not in the workspace manifest");
    rmSync(join(f.parent, MANIFEST_FILE));
    const none = ask(f, [row({ sha: f.first })]);
    expect(none.siblings[0].unreadable).toContain("no workspace manifest lists this repository");
  });

  test("a member the per-user file does not watch is not read", () => {
    const f = fixture();
    writeFileSync(
      userFilePath(f.home),
      JSON.stringify({
        version: 1,
        workspaces: [{ manifest: join(f.parent, MANIFEST_FILE), members: { "desktop-app": { watch: false } } }],
      }),
    );
    const out = ask(f, [row({ sha: f.first })]);
    expect(out.siblings[0].status).toBe("unreadable");
    expect(out.siblings[0].unreadable).toContain("not watched");
  });

  test("a broken per-user file does not fail the answer", () => {
    const f = fixture();
    writeFileSync(userFilePath(f.home), "{ nope");
    const out = ask(f, [row({ sha: f.first })]);
    expect(out.siblings[0].status).toBe("unreadable");
  });

  test("a sibling the review itself did not read is listed as not read, once, and never snapshotted", () => {
    const f = fixture();
    const out = ask(f, [row({ status: "not-cloned", paths: [] }), row({ status: "not-cloned", paths: [] })]);
    expect(out.siblings).toHaveLength(1);
    expect(out.siblings[0].unreadable).toBe("it was not cloned when the review ran");
    expect(out.siblings[0].dir).toBeUndefined();
  });

  test("it never fetches, pulls or clones, and never touches the sibling's working tree", () => {
    const f = fixture();
    const seen: string[] = [];
    const recording: GitRunner = (args, opts) => {
      seen.push(args.join(" "));
      return spawnGit(args, opts);
    };
    const gone = ask(f, [row({ sha: "d".repeat(40) }), row({ sha: f.first })], recording);
    gone.release();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((c) => /(^| )(fetch|pull|clone|checkout|reset)( |$)/.test(c))).toEqual([]);
  });
});
