import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commit, git } from "../../test/support/temp-repo";
import { UsageError } from "../config";
import type { ReviewFile } from "../engine";
import { spawnGit, type GitRunner } from "../evidence";
import { workspaceGit } from "./git";
import { WorkspaceError } from "./discover";
import { MANIFEST_FILE } from "./manifest";
import { decideDistributed, prepareDistributed } from "./run";
import { userFilePath } from "./user-file";

const temps: string[] = [];
const tmp = (prefix = "wachiman-run-") => {
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
    { dir: "api-client", repo: "acme/api-client", visibility: "public" },
    { dir: "desktop-app", repo: "acme/desktop-app", visibility: "private" },
    { dir: "web-site", repo: "acme/web-site", visibility: "public" },
  ],
  contracts: [
    {
      name: "brand-palette",
      sides: [
        { member: "desktop-app", role: "provider", paths: ["Assets/palette.json"] },
        { member: "web-site", role: "consumer", paths: ["packages/tokens/src/**"] },
      ],
      sourceOfTruth: { member: "desktop-app", paths: ["Assets/palette.json"] },
    },
  ],
};

const PALETTE = '{"brand":"#0a7"}\n';
const TOKENS = "export const brand = '#0a7';\n";

interface Fixture {
  coordinator: string;
  home: string;
  /** Top level of the reviewed repository, `web-site`. */
  webSite: string;
  desktopApp: string;
  desktopSha: string;
  webHead: string;
}

/** A coordinator with `web-site` (the reviewed one, with an origin) and `desktop-app` cloned; `api-client` is listed but not cloned. */
function fixture(userWorkspace: Record<string, unknown> | undefined = undefined): Fixture {
  const coordinator = tmp();
  writeFileSync(join(coordinator, MANIFEST_FILE), JSON.stringify(MANIFEST));
  const desktopApp = join(coordinator, "desktop-app");
  const webSite = join(coordinator, "web-site");
  for (const dir of [desktopApp, webSite]) {
    mkdirSync(dir);
    git(dir, "init", "-q");
  }
  const desktopSha = commit(desktopApp, { "Assets/palette.json": PALETTE, "README.md": "# desktop\n" }, "palette");
  const webHead = commit(webSite, { "packages/tokens/src/palette.ts": TOKENS }, "tokens");
  git(webSite, "remote", "add", "origin", "https://github.com/acme/web-site.git");
  const home = tmp("wachiman-home-");
  if (userWorkspace) {
    writeFileSync(userFilePath(home), JSON.stringify({ version: 1, workspaces: [{ manifest: join(coordinator, MANIFEST_FILE), ...userWorkspace }] }));
  }
  return { coordinator, home, webSite, desktopApp, desktopSha, webHead };
}

const file = (filename: string, extra: Partial<ReviewFile> = {}): ReviewFile => ({ filename, additions: 1, deletions: 0, ...extra });
const request = (f: Fixture, extra: Partial<Parameters<typeof decideDistributed>[0]> = {}) => ({
  flag: undefined as boolean | undefined,
  siblings: [] as string[],
  repoDir: f.webSite,
  home: f.home,
  git: spawnGit,
  warn: (_: string) => {},
  ...extra,
});
function decideOn(f: Fixture, extra: Partial<Parameters<typeof decideDistributed>[0]> = {}) {
  const decision = decideDistributed(request(f, { flag: true, ...extra }));
  if (!decision.on) throw new Error("expected the mode to be on");
  return decision;
}

describe("decideDistributed", () => {
  test("--no-distributed-repo reads nothing and is off, whatever the per-user file says", () => {
    const f = fixture({ distributedRepo: "on" });
    const warnings: string[] = [];
    writeFileSync(userFilePath(f.home), "not json");
    expect(decideDistributed(request(f, { flag: false, warn: (w) => warnings.push(w) }))).toEqual({ on: false });
    expect(warnings).toEqual([]);
  });

  test("without a flag and with the default off, no manifest is read, not even the one the per-user file lists", () => {
    const f = fixture({ distributedRepo: "off" });
    writeFileSync(join(f.coordinator, MANIFEST_FILE), "{ this manifest is not valid");
    const warnings: string[] = [];
    expect(decideDistributed(request(f, { warn: (w) => warnings.push(w) }))).toEqual({ on: false });
    // A read of the invalid manifest would have been reported.
    expect(warnings).toEqual([]);
  });

  test("without a flag, no per-user file and a manifest above the repository: off, and the manifest is not read", () => {
    const f = fixture();
    writeFileSync(join(f.coordinator, MANIFEST_FILE), "{ this manifest is not valid");
    // Walking up would throw on the invalid manifest.
    expect(decideDistributed(request(f))).toEqual({ on: false });
  });

  test("a default of on turns it on for a repository in that workspace and says where the default came from", () => {
    const f = fixture({ distributedRepo: "on" });
    const decision = decideDistributed(request(f));
    expect(decision.on).toBe(true);
    if (!decision.on) return;
    expect(decision.reason).toBe("default");
    expect(decision.defaultFile).toBe(userFilePath(f.home));
    expect(decision.found.reviewed.dir).toBe("web-site");
  });

  test("a default of on does nothing for a repository outside the workspace", () => {
    const f = fixture({ distributedRepo: "on" });
    const stranger = tmp();
    git(stranger, "init", "-q");
    expect(decideDistributed(request(f, { repoDir: stranger }))).toEqual({ on: false });
  });

  test("--distributed-repo walks up to the manifest without a per-user file", () => {
    const f = fixture();
    const decision = decideOn(f);
    expect(decision.reason).toBe("flag");
    expect(decision.found.coordinator).toBe(f.coordinator);
  });

  test("--distributed-repo with no workspace found is a usage error that says why", () => {
    const f = fixture();
    const stranger = tmp();
    git(stranger, "init", "-q");
    expect(() => decideOn(f, { repoDir: stranger })).toThrow(UsageError);
    expect(() => decideOn(f, { repoDir: stranger })).toThrow(/no workspace/i);
  });

  test("--sibling without the mode is a usage error that names the way to turn it on", () => {
    const f = fixture();
    expect(() => decideDistributed(request(f, { siblings: ["api-client"] }))).toThrow(UsageError);
    expect(() => decideDistributed(request(f, { siblings: ["api-client"] }))).toThrow(/--distributed-repo/);
  });

  test("--sibling is accepted when the per-user default turns the mode on", () => {
    const f = fixture({ distributedRepo: "on" });
    expect(decideDistributed(request(f, { siblings: ["api-client"] })).on).toBe(true);
  });

  test("a --sibling that is not a member of the manifest is a usage error", () => {
    const f = fixture();
    expect(() => decideOn(f, { siblings: ["palette"] })).toThrow(WorkspaceError);
    expect(() => decideOn(f, { siblings: ["web-site"] })).toThrow(/reviewed repository itself/);
  });

  test("a malformed per-user file is ignored with a warning when no flag asks for the mode, and refused when one does", () => {
    const f = fixture();
    writeFileSync(userFilePath(f.home), "{ nope");
    const warnings: string[] = [];
    expect(decideDistributed(request(f, { warn: (w) => warnings.push(w) }))).toEqual({ on: false });
    expect(warnings.join("\n")).toContain("workspaces.json");
    expect(() => decideOn(f)).toThrow(UsageError);
  });
});

describe("prepareDistributed", () => {
  const local = { distributedRepo: "off", versions: { "brand-palette": { rule: "local" } } };

  test("a change to the consumer side reads the provider at its commit, as a snapshot with only the contract's paths", () => {
    const f = fixture(local);
    const prepared = prepareDistributed(decideOn(f), { files: [file("packages/tokens/src/palette.ts")], headSha: f.webHead, siblings: [], warn: () => {} });
    try {
      const [contract] = prepared.context.contracts;
      expect(contract).toMatchObject({
        name: "brand-palette",
        triggerPaths: ["packages/tokens/src/palette.ts"],
        reviewedMember: "web-site",
        reviewedRoles: ["consumer"],
        holdsSource: false,
        sourceOfTruth: { member: "desktop-app", paths: ["Assets/palette.json"] },
      });
      expect(prepared.context.reviewed).toBe("web-site");
      expect(prepared.context.manifestPath).toBe(join(f.coordinator, MANIFEST_FILE));
      const [sibling] = prepared.context.siblings;
      expect(sibling).toMatchObject({
        member: "desktop-app",
        repo: "acme/desktop-app",
        visibility: "private",
        contracts: ["brand-palette"],
        byHand: false,
        rule: "local",
        ruleSource: "user-file",
        readAs: "local",
        sha: f.desktopSha,
        status: "read",
        paths: ["Assets/palette.json"],
      });
      expect(readFileSync(join(sibling!.dir!, "Assets/palette.json"), "utf8")).toBe(PALETTE);
      // Only the contract's paths: the README is not there.
      expect(existsSync(join(sibling!.dir!, "README.md"))).toBe(false);
      // api-client is a member too, but this contract does not name it.
      expect(prepared.context.siblings.map((s) => s.member)).toEqual(["desktop-app"]);
    } finally {
      prepared.release();
    }
  });

  test("release removes every snapshot, and is safe to call twice", () => {
    const f = fixture(local);
    const prepared = prepareDistributed(decideOn(f), { files: [file("packages/tokens/src/palette.ts")], headSha: f.webHead, siblings: [], warn: () => {} });
    const dir = prepared.context.siblings[0]!.dir!;
    expect(existsSync(dir)).toBe(true);
    prepared.release();
    expect(existsSync(dir)).toBe(false);
    prepared.release();
  });

  test("with the default rule the pin cannot be resolved, so it falls back, and the context says why", () => {
    const f = fixture({ distributedRepo: "off" });
    const prepared = prepareDistributed(decideOn(f), { files: [file("packages/tokens/src/palette.ts")], headSha: f.webHead, siblings: [], warn: () => {} });
    try {
      const [sibling] = prepared.context.siblings;
      expect(sibling).toMatchObject({ rule: "pinned", ruleSource: "default", readAs: "local", status: "read", sha: f.desktopSha });
      expect(sibling!.fallback).toContain("no pin declared");
    } finally {
      prepared.release();
    }
  });

  test("the old path of a rename triggers the contract of the reviewed member that holds the source", () => {
    const f = fixture(local);
    // Reviewing desktop-app: the palette moved. The consumer, web-site, is read.
    const decision = decideDistributed(request(f, { flag: true, repoDir: f.desktopApp }));
    if (!decision.on) throw new Error("on");
    const prepared = prepareDistributed(decision, { files: [file("Assets/colors.json", { previous_filename: "Assets/palette.json" })], headSha: f.desktopSha, siblings: [], warn: () => {} });
    try {
      expect(prepared.context.contracts[0]).toMatchObject({ name: "brand-palette", triggerPaths: ["Assets/palette.json"], holdsSource: true, reviewedRoles: ["provider"] });
      expect(prepared.context.siblings.map((s) => [s.member, s.status])).toEqual([["web-site", "read"]]);
    } finally {
      prepared.release();
    }
  });

  test("a deleted file triggers the contract like any other changed path", () => {
    const f = fixture(local);
    const decision = decideDistributed(request(f, { flag: true, repoDir: f.desktopApp }));
    if (!decision.on) throw new Error("on");
    const prepared = prepareDistributed(decision, { files: [file("Assets/palette.json", { additions: 0, deletions: 1 })], headSha: f.desktopSha, siblings: [], warn: () => {} });
    try {
      expect(prepared.context.contracts.map((c) => c.name)).toEqual(["brand-palette"]);
    } finally {
      prepared.release();
    }
  });

  test("a change no contract covers reads nothing and says so", () => {
    const f = fixture(local);
    const warnings: string[] = [];
    const prepared = prepareDistributed(decideOn(f), { files: [file("docs/readme.md")], headSha: f.webHead, siblings: [], warn: (w) => warnings.push(w) });
    expect(prepared.context.contracts).toEqual([]);
    expect(prepared.context.siblings).toEqual([]);
    expect(warnings).toEqual([]);
    prepared.release();
  });

  test("a sibling that is not cloned is listed as not cloned, with no snapshot", () => {
    const f = fixture(local);
    rmSync(join(f.desktopApp, ".git"), { recursive: true, force: true });
    const prepared = prepareDistributed(decideOn(f), { files: [file("packages/tokens/src/palette.ts")], headSha: f.webHead, siblings: [], warn: () => {} });
    try {
      expect(prepared.context.siblings).toHaveLength(1);
      expect(prepared.context.siblings[0]).toMatchObject({ member: "desktop-app", status: "not-cloned", contracts: ["brand-palette"], paths: [] });
      expect(prepared.context.siblings[0]!.dir).toBeUndefined();
      expect(prepared.context.siblings[0]!.sha).toBeUndefined();
    } finally {
      prepared.release();
    }
  });

  test("a member the per-user file does not watch is listed as not watched, with no snapshot", () => {
    const f = fixture({ ...local, members: { "desktop-app": { watch: false } } });
    const prepared = prepareDistributed(decideOn(f), { files: [file("packages/tokens/src/palette.ts")], headSha: f.webHead, siblings: [], warn: () => {} });
    try {
      expect(prepared.context.siblings[0]).toMatchObject({ member: "desktop-app", status: "not-watched" });
      expect(prepared.context.siblings[0]!.dir).toBeUndefined();
    } finally {
      prepared.release();
    }
  });

  test("uncommitted changes of a local sibling are not read, and the context says so", () => {
    const f = fixture(local);
    writeFileSync(join(f.desktopApp, "Assets/palette.json"), '{"brand":"#f00"}\n');
    const prepared = prepareDistributed(decideOn(f), { files: [file("packages/tokens/src/palette.ts")], headSha: f.webHead, siblings: [], warn: () => {} });
    try {
      const [sibling] = prepared.context.siblings;
      expect(sibling).toMatchObject({ status: "uncommitted-not-read", sha: f.desktopSha });
      expect(readFileSync(join(sibling!.dir!, "Assets/palette.json"), "utf8")).toBe(PALETTE);
    } finally {
      prepared.release();
    }
  });

  test("a sibling whose snapshot cannot be taken is unreadable, the review goes on, and the others are kept", () => {
    const f = fixture(local);
    const failing: typeof spawnGit = (args, opts) => (args.includes("ls-tree") ? { status: 128, stdout: "", error: "boom" } : spawnGit(args, opts));
    const warnings: string[] = [];
    const prepared = prepareDistributed(decideOn(f), { files: [file("packages/tokens/src/palette.ts")], headSha: f.webHead, siblings: [], warn: (w) => warnings.push(w), git: failing });
    try {
      expect(prepared.context.siblings[0]).toMatchObject({ member: "desktop-app", status: "unreadable" });
      expect(prepared.context.siblings[0]!.unreadable).toBeTruthy();
      expect(prepared.context.siblings[0]!.dir).toBeUndefined();
      expect(warnings.join("\n")).toContain("desktop-app");
    } finally {
      prepared.release();
    }
  });

  test("a sibling whose git status fails is read as committed, with a warning that names the member", () => {
    const f = fixture(local);
    const failing: GitRunner = (args, opts) => (args[0] === "status" ? { status: null, stdout: "", error: "timed out", timedOut: true } : workspaceGit(args, opts));
    const warnings: string[] = [];
    const prepared = prepareDistributed(decideOn(f), { files: [file("packages/tokens/src/palette.ts")], headSha: f.webHead, siblings: [], warn: (w) => warnings.push(w), git: failing });
    try {
      expect(prepared.context.siblings[0]).toMatchObject({ member: "desktop-app", status: "read", sha: f.desktopSha });
      expect(warnings.join("\n")).toContain(`could not check desktop-app for uncommitted changes; read ${f.desktopSha.slice(0, 7)} as committed`);
    } finally {
      prepared.release();
    }
  });

  test("a member split into two rows by version lists, on each row, only that row's source-of-truth contracts", () => {
    const f = fixture({ distributedRepo: "off", versions: { "brand-palette": { rule: "local" } } });
    const manifest = JSON.parse(readFileSync(join(f.coordinator, MANIFEST_FILE), "utf8"));
    manifest.contracts.push({
      name: "icon-set",
      sides: [
        { member: "desktop-app", role: "provider", paths: ["Assets/palette.json"] },
        { member: "web-site", role: "consumer", paths: ["packages/icons/**"] },
      ],
      sourceOfTruth: { member: "desktop-app", paths: ["Assets/palette.json"] },
    });
    writeFileSync(join(f.coordinator, MANIFEST_FILE), JSON.stringify(manifest));
    const files = [file("packages/tokens/src/palette.ts"), file("packages/icons/a.svg")];
    const prepared = prepareDistributed(decideOn(f), { files, headSha: f.webHead, siblings: [], warn: () => {} });
    try {
      const rows = prepared.context.siblings.filter((s) => s.member === "desktop-app");
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row.sourceOfTruthOf).toEqual(row.contracts);
      expect(rows.map((r) => r.contracts).sort()).toEqual([["brand-palette"], ["icon-set"]]);
    } finally {
      prepared.release();
    }
  });

  test("--sibling reads that member's whole tracked tree, marked as added by hand, even when no contract applied", () => {
    const f = fixture(local);
    const prepared = prepareDistributed(decideOn(f, { siblings: ["desktop-app"] }), { files: [file("docs/readme.md")], headSha: f.webHead, siblings: ["desktop-app"], warn: () => {} });
    try {
      expect(prepared.context.contracts).toEqual([]);
      const [sibling] = prepared.context.siblings;
      expect(sibling).toMatchObject({ member: "desktop-app", byHand: true, contracts: [], status: "read", sha: f.desktopSha });
      expect(sibling!.paths.sort()).toEqual(["Assets/palette.json", "README.md"]);
    } finally {
      prepared.release();
    }
  });

  test("--sibling on a member a contract already reads widens it to the whole tree and keeps the contract's name", () => {
    const f = fixture(local);
    const prepared = prepareDistributed(decideOn(f, { siblings: ["desktop-app"] }), { files: [file("packages/tokens/src/palette.ts")], headSha: f.webHead, siblings: ["desktop-app"], warn: () => {} });
    try {
      expect(prepared.context.siblings).toHaveLength(1);
      expect(prepared.context.siblings[0]).toMatchObject({ member: "desktop-app", byHand: true, contracts: ["brand-palette"] });
      expect(prepared.context.siblings[0]!.paths).toContain("README.md");
    } finally {
      prepared.release();
    }
  });

  test("never fetches: the git commands it runs include no fetch, pull, clone or ls-remote", () => {
    const f = fixture(local);
    const seen: string[][] = [];
    const spy: typeof spawnGit = (args, opts) => {
      seen.push(args);
      return spawnGit(args, opts);
    };
    const prepared = prepareDistributed(decideOn(f, { git: spy }), { files: [file("packages/tokens/src/palette.ts")], headSha: f.webHead, siblings: [], warn: () => {}, git: spy });
    prepared.release();
    expect(seen.length).toBeGreaterThan(0);
    for (const args of seen) expect(args.some((a) => ["fetch", "pull", "clone", "ls-remote"].includes(a))).toBe(false);
  });
});
