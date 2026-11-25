import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../../test/support/temp-repo";
import { addSibling, findWorkspace, matchContracts, planReads, repoSlug, WorkspaceError, type Change } from "./discover";
import { MANIFEST_FILE, parseManifest } from "./manifest";
import type { UserFile, UserWorkspace } from "./user-file";

const temps: string[] = [];
const tmp = (prefix = "wachiman-discover-") => {
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
    { dir: "billing-service", repo: "acme/billing-service", visibility: "private" },
    { dir: "desktop-app", repo: "acme/desktop-app", visibility: "private" },
    { dir: "web-site", repo: "acme/web-site", visibility: "private" },
  ],
  contracts: [
    {
      name: "billing-api",
      sides: [
        { member: "billing-service", role: "provider", paths: ["src/routes/**"] },
        { member: "api-client", role: "consumer", paths: ["src/billing/**"] },
      ],
      sourceOfTruth: { member: "api-client", paths: ["docs/billing-api.md"] },
    },
    {
      name: "brand-palette",
      sides: [
        { member: "desktop-app", role: "provider", paths: ["Assets/palette.json"] },
        { member: "web-site", role: "consumer", paths: ["packages/tokens/src/**"] },
      ],
      sourceOfTruth: { member: "desktop-app", paths: ["Assets/palette.json"] },
    },
    {
      name: "invoice-format",
      sides: [
        { member: "billing-service", role: "provider", paths: ["src/invoice/**"] },
        { member: "web-site", role: "consumer", paths: ["src/invoice/**"] },
      ],
      sourceOfTruth: { member: "api-client", paths: ["docs/invoice.md", "docs/money.md"] },
    },
  ],
};

/** A coordinator with the manifest; each name in `cloned` is a git repository inside it. */
function workspace(cloned: string[] = ["api-client", "billing-service", "desktop-app", "web-site"]) {
  const coordinator = tmp();
  writeFileSync(join(coordinator, MANIFEST_FILE), JSON.stringify(MANIFEST));
  for (const name of cloned) {
    mkdirSync(join(coordinator, name));
    git(join(coordinator, name), "init", "-q");
  }
  return coordinator;
}
const manifestAt = (coordinator: string) => parseManifest(JSON.stringify(MANIFEST), coordinator);
const noUserFile: UserFile = { version: 1, workspaces: [] };
const userWorkspace = (coordinator: string, extra: Partial<UserWorkspace> = {}): UserWorkspace => ({
  manifest: join(coordinator, MANIFEST_FILE),
  distributedRepo: "off",
  members: {},
  versions: {},
  ...extra,
});
const change = (path: string, extra: Partial<Change> = {}): Change => ({ path, status: "modified", ...extra });

describe("repoSlug", () => {
  test("is owner/name, lower case, for https, ssh and scp-style remotes", () => {
    for (const url of [
      "https://github.com/Acme/Web-Site.git",
      "git@github.com:acme/web-site.git",
      "ssh://git@github.com/acme/web-site",
      "https://u:t@github.com/acme/web-site/",
      "acme/web-site",
    ]) {
      expect(repoSlug(url)).toBe("acme/web-site");
    }
    expect(repoSlug("")).toBeUndefined();
    expect(repoSlug("https://github.com/acme")).toBeUndefined();
  });
});

describe("findWorkspace", () => {
  test("by the per-user file, matching repo to origin, for a checkout outside the coordinator", () => {
    const coordinator = workspace();
    const elsewhere = tmp();
    const user = userWorkspace(coordinator);
    const found = findWorkspace(elsewhere, "git@github.com:acme/web-site.git", { version: 1, workspaces: [user] }, []);
    expect(found?.reviewed.dir).toBe("web-site");
    expect(found?.coordinator).toBe(coordinator);
    expect(found?.user).toBe(user);
    expect(found?.manifestPath).toBe(join(coordinator, MANIFEST_FILE));
  });

  test("by the per-user file, matching dir when origin does not match", () => {
    const coordinator = workspace();
    const found = findWorkspace(
      join(coordinator, "web-site"),
      "https://github.com/fork/web-site.git",
      { version: 1, workspaces: [userWorkspace(coordinator)] },
      [],
    );
    expect(found?.reviewed.dir).toBe("web-site");
  });

  test("the dir of a member can be overridden in the per-user file", () => {
    const coordinator = workspace([]);
    const clone = tmp();
    git(clone, "init", "-q");
    const user = userWorkspace(coordinator, { members: { "web-site": { dir: clone } } });
    expect(findWorkspace(clone, undefined, { version: 1, workspaces: [user] }, [])?.reviewed.dir).toBe("web-site");
  });

  test("without a per-user entry, walks up from the parent of the top level", () => {
    const coordinator = workspace();
    const found = findWorkspace(join(coordinator, "billing-service"), "https://github.com/acme/billing-service.git", noUserFile, []);
    expect(found?.coordinator).toBe(coordinator);
    expect(found?.reviewed.dir).toBe("billing-service");
    expect(found?.user).toBeUndefined();
  });

  test("matches by dir without an origin", () => {
    const coordinator = workspace();
    expect(findWorkspace(join(coordinator, "desktop-app"), undefined, noUserFile, [])?.reviewed.dir).toBe("desktop-app");
  });

  test("walks up more than one level to the manifest, for a member nested in a group folder", () => {
    const coordinator = tmp();
    writeFileSync(join(coordinator, MANIFEST_FILE), JSON.stringify(MANIFEST).replaceAll('"web-site"', '"group/web-site"'));
    mkdirSync(join(coordinator, "group/web-site"), { recursive: true });
    const found = findWorkspace(join(coordinator, "group/web-site"), undefined, noUserFile, []);
    expect(found?.coordinator).toBe(coordinator);
    expect(found?.reviewed.dir).toBe("group/web-site");
  });

  test("a manifest above a repository that is not one of its members is none", () => {
    const coordinator = workspace();
    const stranger = join(coordinator, "stranger");
    mkdirSync(stranger);
    git(stranger, "init", "-q");
    expect(findWorkspace(stranger, "https://github.com/other/stranger.git", noUserFile, [])).toBeUndefined();
  });

  test("with walkUp off, a manifest above the repository is not read", () => {
    const coordinator = workspace();
    expect(findWorkspace(join(coordinator, "web-site"), undefined, noUserFile, [], { walkUp: false })).toBeUndefined();
    // The per-user entries still count.
    const user = userWorkspace(coordinator);
    expect(
      findWorkspace(join(coordinator, "web-site"), undefined, { version: 1, workspaces: [user] }, [], { walkUp: false })?.reviewed.dir,
    ).toBe("web-site");
  });

  test("no manifest anywhere is none", () => {
    // The walk stops at a folder this test owns, so a manifest in /tmp or / of the machine cannot matter.
    const root = tmp();
    const repo = join(root, "deep/er/web-site");
    mkdirSync(repo, { recursive: true });
    expect(findWorkspace(repo, "https://github.com/acme/web-site.git", noUserFile, [], { ceiling: root })).toBeUndefined();
  });

  test("the walk up stops at the ceiling, so a manifest above it that lists the repository is none", () => {
    const root = tmp();
    writeFileSync(join(root, MANIFEST_FILE), JSON.stringify(MANIFEST));
    const ceiling = join(root, "ceiling");
    const repo = join(ceiling, "web-site");
    mkdirSync(repo, { recursive: true });
    const origin = "https://github.com/acme/web-site.git";
    // Control: without a ceiling the same manifest is found, so the ceiling is what makes the result none.
    expect(findWorkspace(repo, origin, noUserFile, [])?.coordinator).toBe(root);
    expect(findWorkspace(repo, origin, noUserFile, [], { ceiling })).toBeUndefined();
  });

  test("a per-user entry whose manifest file is gone is skipped with a warning naming its path", () => {
    const coordinator = workspace();
    const gone = userWorkspace(join(tmp(), "nowhere"));
    const warnings: string[] = [];
    const found = findWorkspace(
      join(coordinator, "web-site"),
      undefined,
      { version: 1, workspaces: [gone, userWorkspace(coordinator)] },
      warnings,
    );
    expect(found?.reviewed.dir).toBe("web-site");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(gone.manifest);
  });

  test("an invalid per-user manifest is a warning and is skipped, so an unrelated repository still reviews", () => {
    const coordinator = workspace();
    const broken = tmp();
    writeFileSync(join(broken, MANIFEST_FILE), "{}");
    const warnings: string[] = [];
    const found = findWorkspace(
      join(coordinator, "web-site"),
      undefined,
      { version: 1, workspaces: [userWorkspace(broken), userWorkspace(coordinator)] },
      warnings,
    );
    expect(found?.coordinator).toBe(coordinator);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(join(broken, MANIFEST_FILE));
    expect(warnings[0]).toMatch(/format/);
  });

  test("an invalid manifest found by walking up is still refused", () => {
    const coordinator = tmp();
    writeFileSync(join(coordinator, MANIFEST_FILE), "{}");
    mkdirSync(join(coordinator, "web-site"));
    expect(() => findWorkspace(join(coordinator, "web-site"), undefined, noUserFile, [])).toThrow(/format/);
  });

  test("the per-user entry wins over a manifest found by walking up", () => {
    const coordinator = workspace();
    const other = workspace();
    const found = findWorkspace(
      join(coordinator, "web-site"),
      "https://github.com/acme/web-site.git",
      { version: 1, workspaces: [userWorkspace(other)] },
      [],
    );
    expect(found?.coordinator).toBe(other);
  });
});

describe("matchContracts", () => {
  const manifest = manifestAt("/c");
  const applied = (reviewed: string, changes: Change[]) => matchContracts(manifest, reviewed, changes).map((a) => a.contract.name);

  test("a new or changed path on the reviewed member's side applies the contract", () => {
    expect(applied("billing-service", [change("src/routes/invoices.ts", { status: "added" })])).toEqual(["billing-api"]);
    expect(applied("api-client", [change("src/billing/client.ts")])).toEqual(["billing-api"]);
  });

  test("the old path of a rename applies it, even when the new path matches nothing", () => {
    const rename = change("src/handlers/invoices.ts", { status: "renamed", oldPath: "src/routes/invoices.ts" });
    expect(applied("billing-service", [rename])).toEqual(["billing-api"]);
    const result = matchContracts(manifest, "billing-service", [rename]);
    expect(result[0].triggers).toEqual([{ path: "src/routes/invoices.ts", via: "side" }]);
  });

  test("a deleted path applies it", () => {
    expect(applied("billing-service", [change("src/routes/old.ts", { status: "deleted" })])).toEqual(["billing-api"]);
  });

  test("the source of truth applies the contract when the reviewed member holds it", () => {
    const result = matchContracts(manifest, "api-client", [change("docs/billing-api.md")]);
    expect(result.map((a) => a.contract.name)).toEqual(["billing-api"]);
    expect(result[0].triggers).toEqual([{ path: "docs/billing-api.md", via: "source" }]);
    expect(applied("desktop-app", [change("Assets/palette.json")])).toEqual(["brand-palette"]);
  });

  test("a path on another member's globs, or outside every glob, applies nothing", () => {
    expect(applied("billing-service", [change("docs/billing-api.md")])).toEqual([]);
    expect(applied("billing-service", [change("src/helpers/shared.ts")])).toEqual([]);
    expect(applied("web-site", [])).toEqual([]);
  });

  test("lists every contract a change touches, with each triggering path once", () => {
    const result = matchContracts(manifest, "billing-service", [
      change("src/routes/a.ts"),
      change("src/routes/b.ts"),
      change("src/invoice/x.ts"),
    ]);
    expect(result.map((a) => a.contract.name)).toEqual(["billing-api", "invoice-format"]);
    expect(result[0].triggers.map((t) => t.path)).toEqual(["src/routes/a.ts", "src/routes/b.ts"]);
  });

  test("a member that holds a side and the source reports both kinds of trigger", () => {
    const result = matchContracts(manifest, "api-client", [change("src/billing/a.ts"), change("docs/billing-api.md")]);
    expect(result[0].triggers.map((t) => t.via)).toEqual(["side", "source"]);
  });
});

describe("planReads", () => {
  const plan = (coordinator: string, reviewed: string, changes: Change[], user?: UserWorkspace) => {
    const manifest = manifestAt(coordinator);
    const found = {
      coordinator,
      manifestPath: join(coordinator, MANIFEST_FILE),
      manifest,
      reviewed: manifest.members.find((m) => m.dir === reviewed)!,
      user,
    };
    return { found, reads: planReads(found, matchContracts(manifest, reviewed, changes)) };
  };

  test("reads the other sides, and the source of truth when another member holds it", () => {
    const coordinator = workspace();
    const { reads } = plan(coordinator, "billing-service", [change("src/invoice/x.ts")]);
    expect(reads.map((r) => r.member.dir)).toEqual(["web-site", "api-client"]);
    expect(reads[0]).toMatchObject({ dir: join(coordinator, "web-site"), globs: ["src/invoice/**"], status: "ready" });
    expect(reads[1].globs).toEqual(["docs/invoice.md", "docs/money.md"]);
  });

  test("never lists the reviewed member, even when it holds the source of truth", () => {
    const { reads } = plan(workspace(), "desktop-app", [change("Assets/palette.json")]);
    expect(reads.map((r) => r.member.dir)).toEqual(["web-site"]);
  });

  test("merges per member across contracts, keeping which contract asked for what", () => {
    const { reads } = plan(workspace(), "billing-service", [change("src/routes/a.ts"), change("src/invoice/x.ts")]);
    const apiClient = reads.find((r) => r.member.dir === "api-client")!;
    expect(apiClient.globs).toEqual(["src/billing/**", "docs/billing-api.md", "docs/invoice.md", "docs/money.md"]);
    expect(apiClient.contracts).toEqual([
      { name: "billing-api", globs: ["src/billing/**", "docs/billing-api.md"] },
      { name: "invoice-format", globs: ["docs/invoice.md", "docs/money.md"] },
    ]);
  });

  test("a member whose folder is missing, or is not a git repository, is not-cloned", () => {
    const coordinator = workspace(["billing-service"]);
    mkdirSync(join(coordinator, "web-site"));
    const { reads } = plan(coordinator, "billing-service", [change("src/invoice/x.ts")]);
    expect(Object.fromEntries(reads.map((r) => [r.member.dir, r.status]))).toEqual({
      "web-site": "not-cloned",
      "api-client": "not-cloned",
    });
  });

  test("watch: false is not-watched, and the per-user dir override is where it looks", () => {
    const coordinator = workspace(["billing-service"]);
    const clone = tmp();
    git(clone, "init", "-q");
    const user = userWorkspace(coordinator, { members: { "web-site": { dir: clone }, "api-client": { watch: false } } });
    const { reads } = plan(coordinator, "billing-service", [change("src/invoice/x.ts")], user);
    expect(reads.find((r) => r.member.dir === "web-site")).toMatchObject({ dir: clone, status: "ready" });
    expect(reads.find((r) => r.member.dir === "api-client")?.status).toBe("not-watched");
  });

  test("a cloned member with watch: false is not-watched, not ready", () => {
    const coordinator = workspace();
    const user = userWorkspace(coordinator, { members: { "web-site": { watch: false } } });
    expect(plan(coordinator, "billing-service", [change("src/invoice/x.ts")], user).reads[0].status).toBe("not-watched");
  });

  test("no applied contract, no reads", () => {
    expect(plan(workspace(), "billing-service", [change("README.md")]).reads).toEqual([]);
  });

  describe("addSibling", () => {
    test("adds a member by dir with its whole tracked tree", () => {
      const { found, reads } = plan(workspace(), "billing-service", [change("README.md")]);
      const next = addSibling(found, reads, "desktop-app");
      expect(next).toHaveLength(1);
      expect(next[0]).toMatchObject({ globs: ["**"], contracts: [], status: "ready" });
      expect(next[0].member.dir).toBe("desktop-app");
    });

    test("widens a member already planned to the whole tree and keeps the others", () => {
      const { found, reads } = plan(workspace(), "billing-service", [change("src/invoice/x.ts")]);
      const next = addSibling(found, reads, "web-site");
      expect(next.map((r) => r.member.dir)).toEqual(["web-site", "api-client"]);
      expect(next[0].globs).toEqual(["**"]);
      expect(next[0].contracts).toEqual(reads[0].contracts);
    });

    test("a directory that is not a member is an error; so is the reviewed member", () => {
      const { found, reads } = plan(workspace(), "billing-service", []);
      expect(() => addSibling(found, reads, "stranger")).toThrow(WorkspaceError);
      expect(() => addSibling(found, reads, "stranger")).toThrow(/stranger/);
      expect(() => addSibling(found, reads, "billing-service")).toThrow(/reviewed/);
      expect(() => addSibling(found, reads, "../web-site")).toThrow(WorkspaceError);
    });

    test("reports not-cloned for a member that is not there", () => {
      const { found, reads } = plan(workspace(["billing-service"]), "billing-service", []);
      expect(addSibling(found, reads, "web-site")[0].status).toBe("not-cloned");
    });
  });
});
