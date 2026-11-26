import { afterAll, describe, expect, test } from "bun:test";
import { rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type GitRunner } from "../evidence";
import { commit, emptyRepo, git, removeTempRepos } from "../../test/support/temp-repo";
import type { Contract, Member, VersionSpec } from "./manifest";
import type { UserWorkspace } from "./user-file";
import { workspaceGit } from "./git";
import { chooseRule, resolveVersion, type VersionContext } from "./versions";

afterAll(removeTempRepos);

const web: Member = { dir: "web-site", repo: "acme/web-site", visibility: "private" };
const ui: Member = { dir: "ui-kit", repo: "acme/ui-kit", visibility: "public" };
const spec: Member = { dir: "spec-only", repo: "acme/spec-only", visibility: "private" };
const contractWith = (version?: VersionSpec): Contract => ({
  name: "ui-kit-api",
  sides: [
    { member: "ui-kit", role: "provider", paths: ["src/**"] },
    { member: "web-site", role: "consumer", paths: ["src/ui/**"] },
  ],
  sourceOfTruth: { member: "spec-only", paths: ["spec.md"] },
  ...(version ? { version } : {}),
});
const PIN = { file: "package.json", key: ["dependencies", "@acme/ui-kit"], tag: "v{version}" };
const pinSpec: VersionSpec = { rule: "pinned", pin: PIN };

/** The consumer, with `@acme/ui-kit` pinned to `dependency` at its head. */
function consumer(dependency: unknown = "1.2.0") {
  const dir = emptyRepo("wachiman-consumer-");
  const head = commit(dir, { "package.json": JSON.stringify({ dependencies: { "@acme/ui-kit": dependency } }) }, "consumer");
  return { dir, head };
}

/** The provider: v1.2.0 tagged on the first commit, a later commit on main; origin/HEAD recorded at the later one unless told otherwise. */
function provider(options: { originHead?: boolean } = {}) {
  const dir = emptyRepo("wachiman-provider-");
  const tagged = commit(dir, { "src/a.ts": "one\n" }, "v1.2.0");
  git(dir, "tag", "v1.2.0");
  const tip = commit(dir, { "src/a.ts": "two\n" }, "later");
  if (options.originHead !== false) {
    git(dir, "update-ref", "refs/remotes/origin/main", tip);
    git(dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  }
  return { dir, tagged, tip };
}

const context = (
  c: ReturnType<typeof consumer>,
  p: ReturnType<typeof provider>,
  version?: VersionSpec,
  extra: Partial<VersionContext> = {},
): VersionContext => ({
  contract: contractWith(version),
  reviewed: web,
  member: ui,
  reviewedDir: c.dir,
  reviewedHead: c.head,
  siblingDir: p.dir,
  ...extra,
});
const user = (versions: UserWorkspace["versions"]): UserWorkspace => ({
  manifest: "/m/workspace.manifest.json",
  distributedRepo: "off",
  members: {},
  versions,
});

describe("chooseRule precedence", () => {
  const contract = contractWith({ rule: "tip" });
  const member: Member = { ...ui, version: { rule: "local" } };
  test("per-user contract, per-user member, manifest contract, manifest member, default pinned", () => {
    const u = user({ "ui-kit-api": { rule: "local" }, "ui-kit": { rule: "tip" } });
    expect(chooseRule(contract, member, u)).toEqual({ spec: { rule: "local" }, source: "user-file" });
    expect(chooseRule(contract, member, user({ "ui-kit": { rule: "pinned" } }))).toEqual({ spec: { rule: "pinned" }, source: "user-file" });
    expect(chooseRule(contract, member, user({}))).toEqual({ spec: { rule: "tip" }, source: "manifest" });
    expect(chooseRule(contractWith(), member)).toEqual({ spec: { rule: "local" }, source: "manifest" });
    expect(chooseRule(contractWith(), ui)).toEqual({ spec: { rule: "pinned" }, source: "default" });
  });
});

describe("pinned", () => {
  test("reads the commit of the tag the reviewed head pins, with no fallback", () => {
    const p = provider();
    const result = resolveVersion(context(consumer("1.2.0"), p, pinSpec));
    expect(result).toEqual({
      contract: "ui-kit-api",
      member: "ui-kit",
      rule: "pinned",
      ruleSource: "manifest",
      readAs: "pinned",
      sha: p.tagged,
    });
  });

  test("reads the pin from the reviewed head commit, not from its working tree", () => {
    const p = provider();
    const c = consumer("1.2.0");
    writeFileSync(join(c.dir, "package.json"), JSON.stringify({ dependencies: { "@acme/ui-kit": "9.9.9" } }));
    expect(resolveVersion(context(c, p, pinSpec)).sha).toBe(p.tagged);
  });

  test("a full SHA that is not in the sibling falls back to tip, saying so", () => {
    const p = provider();
    const result = resolveVersion(context(consumer(), p, { rule: "pinned", ref: "1".repeat(40) }));
    expect(result).toMatchObject({ readAs: "tip", sha: p.tip });
    expect(result.fallback).toMatch(/not in ui-kit's local objects/);
  });

  test("a literal ref in the version object", () => {
    const p = provider();
    expect(resolveVersion(context(consumer(), p, { rule: "pinned", ref: "v1.2.0" })).sha).toBe(p.tagged);
    expect(resolveVersion(context(consumer(), p, { rule: "pinned", ref: p.tip })).sha).toBe(p.tip);
  });

  test("a replacement ref in the sibling does not change which commit a tag names", () => {
    const p = provider();
    git(p.dir, "tag", "-d", "v1.2.0");
    git(p.dir, "tag", "-a", "-m", "real", "v1.2.0", p.tagged);
    git(p.dir, "tag", "-a", "-m", "decoy", "decoy", p.tip);
    const real = git(p.dir, "rev-parse", "refs/tags/v1.2.0").trim();
    const decoy = git(p.dir, "rev-parse", "refs/tags/decoy").trim();
    git(p.dir, "replace", real, decoy);
    // Without the replacement, v1.2.0 peels to the first commit; with it, git would read the decoy tag and report the tip.
    expect(git(p.dir, "rev-parse", "refs/tags/v1.2.0^{commit}").trim()).toBe(p.tip);
    expect(resolveVersion(context(consumer("1.2.0"), p, pinSpec)).sha).toBe(p.tagged);
  });

  test("a pin tag template that makes a revision expression falls back to tip, never the parent", () => {
    const p = provider();
    git(p.dir, "tag", "v1.2.0-next", p.tip);
    for (const tag of [
      "v{version}~1",
      "v{version}^",
      "v{version}^{commit}~0",
      "v{version}@{0}",
      "v{version}..HEAD",
      "v{version}:src",
      "v{version}*",
      "v{version}\\x",
    ]) {
      const result = resolveVersion(context(consumer("1.2.0"), p, { rule: "pinned", pin: { ...PIN, tag } }));
      expect(result.sha).toBe(p.tip);
      expect(result.readAs).toBe("tip");
      expect(result.fallback).toMatch(/pin tag .* (is a revision expression|is not a valid ref name)/);
    }
  }, 30_000);

  test("a literal ref is a full SHA or a tag, branch or remote name, never an expression", () => {
    const p = provider();
    git(p.dir, "branch", "release/2", p.tagged);
    git(p.dir, "update-ref", "refs/remotes/origin/feature", p.tagged);
    expect(resolveVersion(context(consumer(), p, { rule: "pinned", ref: p.tagged })).sha).toBe(p.tagged);
    expect(resolveVersion(context(consumer(), p, { rule: "pinned", ref: "release/2" })).sha).toBe(p.tagged);
    expect(resolveVersion(context(consumer(), p, { rule: "pinned", ref: "origin/feature" })).sha).toBe(p.tagged);
    for (const ref of ["v1.2.0~1", "HEAD", "main~1", "main@{0}", "v1.2.0^{tree}", "main..v1.2.0", "nothing-here"]) {
      const result = resolveVersion(context(consumer(), p, { rule: "pinned", ref }));
      expect(result.sha).toBe(p.tip);
      expect(result.readAs).toBe("tip");
      expect(result.fallback).toContain(`"${ref}"`);
    }
  }, 30_000);

  test("a key with a dot in the package name is read as a literal key", () => {
    const p = provider();
    const c = consumer();
    writeFileSync(join(c.dir, "package.json"), JSON.stringify({ dependencies: { "chart.js": "1.2.0" } }));
    git(c.dir, "commit", "-qam", "dots");
    const head = git(c.dir, "rev-parse", "HEAD").trim();
    const result = resolveVersion(context({ ...c, head }, p, { rule: "pinned", pin: { ...PIN, key: ["dependencies", "chart.js"] } }));
    expect(result.sha).toBe(p.tagged);
  });

  const fallsBack = (result: ReturnType<typeof resolveVersion>, p: ReturnType<typeof provider>, reason: RegExp) => {
    expect(result.rule).toBe("pinned");
    expect(result.readAs).toBe("tip");
    expect(result.sha).toBe(p.tip);
    expect(result.fallback).toMatch(reason);
    expect(result.fallback).toMatch(/tip/);
  };

  test("no pin declared falls back to tip with the reason", () => {
    const p = provider();
    fallsBack(resolveVersion(context(consumer(), p)), p, /no pin declared/);
    fallsBack(resolveVersion(context(consumer(), p, { rule: "pinned" })), p, /no pin declared/);
  });

  test("a member added by hand says so instead of naming a contract that does not exist", () => {
    const p = provider();
    const hand: Contract = { name: "--sibling", sides: [], sourceOfTruth: { member: "web-site", paths: [] } };
    const result = resolveVersion({ ...context(consumer(), p), contract: hand });
    expect(result.sha).toBe(p.tip);
    expect(result.fallback).toBe("pinned needs a contract; added by hand; read tip instead");
  });

  test("a range, a prefix or a non-string value is not an exact version", () => {
    const p = provider();
    for (const value of ["^1.2.0", "~1.2.0", ">=1.2.0", "1.x", "*", "workspace:*", "latest", "v1.2.0", "1.2.0 || 2.0.0", "1.2"]) {
      fallsBack(resolveVersion(context(consumer(value), p, pinSpec)), p, /range or not an exact version/);
    }
    fallsBack(resolveVersion(context(consumer(7), p, pinSpec)), p, /not a string/);
  });

  test("accepts exact versions with a pre-release or build part", () => {
    const p = provider();
    git(p.dir, "tag", "v2.0.0-rc.1", p.tagged);
    expect(resolveVersion(context(consumer("2.0.0-rc.1"), p, pinSpec)).sha).toBe(p.tagged);
  });

  test("a missing file, invalid JSON, or a missing key falls back", () => {
    const p = provider();
    fallsBack(
      resolveVersion(context(consumer(), p, { rule: "pinned", pin: { ...PIN, file: "missing.json" } })),
      p,
      /missing\.json not found/,
    );
    const c = consumer();
    writeFileSync(join(c.dir, "bad.json"), "{");
    git(c.dir, "add", "-A");
    git(c.dir, "commit", "-qm", "bad");
    const head = git(c.dir, "rev-parse", "HEAD").trim();
    fallsBack(resolveVersion(context({ ...c, head }, p, { rule: "pinned", pin: { ...PIN, file: "bad.json" } })), p, /not valid JSON/);
    fallsBack(
      resolveVersion(context(consumer(), p, { rule: "pinned", pin: { ...PIN, key: ["dependencies", "other"] } })),
      p,
      /not found in package\.json/,
    );
    fallsBack(
      resolveVersion(context(consumer(), p, { rule: "pinned", pin: { ...PIN, key: ["constructor"] } })),
      p,
      /not found in package\.json/,
    );
  });

  test("a tag that is not in the sibling's local refs falls back, naming the tag", () => {
    const p = provider();
    fallsBack(resolveVersion(context(consumer("3.0.0"), p, pinSpec)), p, /tag v3\.0\.0 is not in ui-kit's local refs/);
    fallsBack(resolveVersion(context(consumer(), p, { rule: "pinned", ref: "v9" })), p, /"v9" is not in ui-kit's local refs/);
  });

  test("a tag name is looked up as a tag, not as a branch", () => {
    const p = provider();
    git(p.dir, "branch", "v4.0.0", p.tip);
    fallsBack(resolveVersion(context(consumer("4.0.0"), p, pinSpec)), p, /tag v4\.0\.0/);
  });

  test("other directions fall back: the reviewed repository is the provider, or the sibling is only the source of truth", () => {
    const p = provider();
    const c = consumer();
    fallsBack(resolveVersion(context(c, p, pinSpec, { reviewed: ui, member: web })), p, /not a consumer/);
    fallsBack(resolveVersion(context(c, p, pinSpec, { member: spec })), p, /spec-only is not a provider/);
  });

  test("a ref that looks like an option is never passed to git as one", () => {
    const p = provider();
    const result = resolveVersion(context(consumer(), p, { rule: "pinned", ref: "--all" }));
    expect(result.readAs).toBe("tip");
    expect(result.fallback).toMatch(/"--all"/);
  });

  test("falls back through tip to local when the sibling has no origin/HEAD, naming both reasons", () => {
    const p = provider({ originHead: false });
    const result = resolveVersion(context(consumer(), p));
    expect(result.readAs).toBe("local");
    expect(result.sha).toBe(p.tip);
    expect(result.fallback).toMatch(/no pin declared.*origin\/HEAD.*local HEAD/);
  });
});

describe("local", () => {
  test("reads HEAD whatever the branch, with no fallback", () => {
    const p = provider();
    git(p.dir, "switch", "-q", "-c", "scratch", p.tagged);
    const result = resolveVersion(context(consumer(), p, { rule: "local" }));
    expect(result).toMatchObject({ rule: "local", readAs: "local", sha: p.tagged });
    expect(result.fallback).toBeUndefined();
    expect(result.uncommitted).toBeUndefined();
  });

  test("reports uncommitted changes to tracked files and still reads HEAD, not the changes", () => {
    const p = provider();
    writeFileSync(join(p.dir, "src/a.ts"), "edited, not committed\n");
    const result = resolveVersion(context(consumer(), p, { rule: "local" }));
    expect(result).toMatchObject({ sha: p.tip, uncommitted: true });
  });

  test("a git status that fails is reported as unknown, never as clean", () => {
    const p = provider();
    const failing: GitRunner = (args, opts) =>
      args[0] === "status" ? { status: null, stdout: "", error: "timed out", timedOut: true } : workspaceGit(args, opts);
    const result = resolveVersion(context(consumer(), p, { rule: "local" }), failing);
    expect(result).toMatchObject({ sha: p.tip, uncommittedUnknown: true });
    expect(result.uncommitted).toBeUndefined();
    expect(resolveVersion(context(consumer(), p, { rule: "local" })).uncommittedUnknown).toBeUndefined();
  });

  test("a staged change counts; an untracked file does not", () => {
    const p = provider();
    writeFileSync(join(p.dir, "untracked.txt"), "x\n");
    expect(resolveVersion(context(consumer(), p, { rule: "local" })).uncommitted).toBeUndefined();
    writeFileSync(join(p.dir, "src/b.ts"), "new\n");
    git(p.dir, "add", "src/b.ts");
    expect(resolveVersion(context(consumer(), p, { rule: "local" })).uncommitted).toBe(true);
  });

  test("a sibling with no commit is unreadable, with the reason", () => {
    const dir = emptyRepo("wachiman-empty-");
    const result = resolveVersion(context(consumer(), { dir, tagged: "", tip: "" }, { rule: "local" }));
    expect(result.sha).toBeUndefined();
    expect(result.unreadable).toMatch(/no commit/);
  });
});

describe("tip", () => {
  test("reads the commit origin/HEAD points to, not the sibling's own HEAD", () => {
    const p = provider();
    git(p.dir, "switch", "-q", "-c", "scratch", p.tagged);
    const result = resolveVersion(context(consumer(), p, { rule: "tip" }));
    expect(result).toMatchObject({ rule: "tip", readAs: "tip", sha: p.tip });
    expect(result.fallback).toBeUndefined();
  });

  test("fetchedAt is the modification time of FETCH_HEAD, and unknown when there is none", () => {
    const p = provider();
    expect(resolveVersion(context(consumer(), p, { rule: "tip" })).fetchedAt).toBe("unknown");
    const fetchHead = join(p.dir, ".git", "FETCH_HEAD");
    writeFileSync(fetchHead, "");
    const when = new Date("2026-11-01T10:00:00.000Z");
    utimesSync(fetchHead, when, when);
    expect(resolveVersion(context(consumer(), p, { rule: "tip" })).fetchedAt).toBe("2026-11-01T10:00:00.000Z");
  });

  test("fetchedAt takes the newer FETCH_HEAD of the worktree's git dir and the common git dir", () => {
    const p = provider();
    const tree = `${p.dir}-worktree`;
    git(p.dir, "worktree", "add", "-q", "--detach", tree);
    try {
      const stamp = (file: string, iso: string) => {
        writeFileSync(file, "");
        utimesSync(file, new Date(iso), new Date(iso));
      };
      stamp(join(p.dir, ".git", "FETCH_HEAD"), "2026-11-05T10:00:00.000Z");
      const own = git(tree, "rev-parse", "--absolute-git-dir").trim();
      stamp(join(own, "FETCH_HEAD"), "2026-11-01T10:00:00.000Z");
      expect(resolveVersion(context(consumer(), p, { rule: "tip" }, { siblingDir: tree })).fetchedAt).toBe("2026-11-05T10:00:00.000Z");
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  });

  test("without origin/HEAD it reads local and says why", () => {
    const p = provider({ originHead: false });
    const result = resolveVersion(context(consumer(), p, { rule: "tip" }));
    expect(result).toMatchObject({ rule: "tip", readAs: "local", sha: p.tip });
    expect(result.fallback).toMatch(/origin\/HEAD/);
    expect(result.fetchedAt).toBeUndefined();
  });

  test("never fetches: no rule runs fetch, pull or clone, and a remote that does not exist is never contacted", () => {
    const p = provider();
    git(p.dir, "remote", "add", "origin", "https://127.0.0.1:9/never.git");
    const calls: string[][] = [];
    const guarded: GitRunner = (args, opts) => {
      calls.push(args);
      if (args.some((a) => ["fetch", "pull", "clone"].includes(a))) throw new Error(`git ${args.join(" ")} must never run`);
      return workspaceGit(args, opts);
    };
    const c = consumer();
    for (const version of [{ rule: "tip" }, { rule: "local" }, pinSpec] as VersionSpec[]) {
      expect(resolveVersion(context(c, p, version), guarded).sha).toBeDefined();
    }
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter((args) => args.some((a) => ["fetch", "pull", "clone"].includes(a)))).toEqual([]);
  });
});

describe("rule sources", () => {
  test("default, manifest (contract and member) and user-file are recorded", () => {
    const p = provider();
    const c = consumer();
    expect(resolveVersion(context(c, p)).ruleSource).toBe("default");
    expect(resolveVersion(context(c, p, { rule: "tip" })).ruleSource).toBe("manifest");
    expect(resolveVersion(context(c, p, undefined, { member: { ...ui, version: { rule: "tip" } } })).ruleSource).toBe("manifest");
    expect(resolveVersion(context(c, p, { rule: "tip" }, { user: user({ "ui-kit": { rule: "local" } }) }))).toMatchObject({
      ruleSource: "user-file",
      rule: "local",
    });
  });

  test("a contract or member named like an Object.prototype key is not a rule", () => {
    const named = { ...contractWith(), name: "constructor" };
    expect(chooseRule(named, { ...ui, dir: "toString" }, user({}))).toEqual({ spec: { rule: "pinned" }, source: "default" });
    expect(chooseRule(named, ui, user({ constructor: { rule: "tip" } }))).toEqual({ spec: { rule: "tip" }, source: "user-file" });
  });

  test("a user rule keyed by contract overrides the manifest's contract rule", () => {
    const p = provider();
    const result = resolveVersion(context(consumer(), p, { rule: "local" }, { user: user({ "ui-kit-api": { rule: "tip" } }) }));
    expect(result).toMatchObject({ rule: "tip", ruleSource: "user-file", sha: p.tip });
  });
});
