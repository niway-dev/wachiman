/**
 * The GitHub mode never reads a workspace (spec "Acceptance criteria", ADR 0042): not the manifest,
 * not the per-user file, not a sibling. These are the canaries. Each one is written so that wiring
 * the mode into the GitHub path makes it fail:
 *
 * - the import graph of the GitHub path holds no `src/workspace/` module, and the check is shown to
 *   see such an import when one exists;
 * - a real `review()` of a pull request, with a manifest above the repository, the sibling cloned
 *   and a per-user default of `on`, gets exactly the prompt and the directories it would get
 *   without any of it.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { commit, git } from "../test/support/temp-repo";
import { loadConfig } from "./config";
import { GhError, githubReview as buildGithubReview, review, type Deps, type ReviewOutput, type ReviewResult } from "./engine";
import type { ProviderAdapter, ProviderRequest, ProviderResult } from "./providers/types";
import { MANIFEST_FILE } from "./workspace/manifest";
import { userFilePath } from "./workspace/user-file";

const temps: string[] = [];
const temp = (prefix: string) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const SRC = join(import.meta.dir);

/** The relative imports, dynamic imports and re-exports a TypeScript source names. */
export function importsOf(source: string): string[] {
  const found = new Set<string>();
  for (const m of source.matchAll(/(?:from|import|require)\s*\(?\s*["'](\.{1,2}\/[^"']*)["']/g)) found.add(m[1]!);
  return [...found];
}

/** Every file reachable from `roots` through relative imports. `read` returns a file's source, or undefined for a path that is not a file. */
export function closure(roots: string[], read: (path: string) => string | undefined): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const path = queue.pop()!;
    if (seen.has(path)) continue;
    const source = read(path);
    if (source === undefined) continue;
    seen.add(path);
    for (const spec of importsOf(source)) {
      const base = resolve(dirname(path), spec);
      for (const candidate of [base, `${base}.ts`, join(base, "index.ts")]) {
        if (read(candidate) !== undefined) {
          queue.push(candidate);
          break;
        }
      }
    }
  }
  return seen;
}

const readFile = (path: string) => {
  try {
    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? readFileSync(path, "utf8") : undefined;
  } catch {
    return undefined;
  }
};

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));

describe("the GitHub mode does not import the workspace code", () => {
  const roots = [join(SRC, "engine.ts"), ...files(join(SRC, "sinks")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))];
  const inWorkspace = (reached: Set<string>) => [...reached].filter((p) => relative(SRC, p).startsWith("workspace/") || relative(SRC, p) === "local.ts").map((p) => relative(SRC, p));

  test("nothing reachable from the review engine or the sinks is in src/workspace or is the local command", () => {
    expect(roots.length).toBeGreaterThan(1);
    const reached = closure(roots, readFile);
    // The check reads real files: the engine and its distributed-repo data are in the closure.
    expect(reached.has(join(SRC, "engine.ts"))).toBe(true);
    expect(reached.has(join(SRC, "distributed.ts"))).toBe(true);
    expect(inWorkspace(reached)).toEqual([]);
  });

  test("the check sees an import of src/workspace, directly or through another module", () => {
    const fake: Record<string, string> = {
      [join(SRC, "engine.ts")]: 'import { x } from "./helper";',
      [join(SRC, "helper.ts")]: 'export { findWorkspace } from "./workspace/discover";',
      [join(SRC, "workspace/discover.ts")]: "export const findWorkspace = 1;",
    };
    const reached = closure([join(SRC, "engine.ts")], (p) => fake[p]);
    expect(inWorkspace(reached)).toEqual(["workspace/discover.ts"]);
  });

  test("only the local command imports the workspace code outside src/workspace", () => {
    const importers = files(SRC)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !relative(SRC, f).startsWith("workspace/"))
      .filter((f) => importsOf(readFileSync(f, "utf8")).some((s) => /(^|\/)workspace(\/|$)/.test(s)))
      .map((f) => relative(SRC, f));
    expect(importers).toEqual(["local.ts"]);
  });
});

class FakeProvider implements ProviderAdapter {
  readonly name = "fake";
  readonly requests: ProviderRequest[] = [];
  preflight() {}
  modelLabel() {
    return "Fake Model 1 via Fake CLI 0.1";
  }
  leaksSecret() {
    return false;
  }
  async run(request: ProviderRequest): Promise<ProviderResult> {
    this.requests.push(request);
    const output: ReviewOutput = { files_reviewed: [TRIGGER], files_skipped: [], findings: [], thread_replies: [], summary: "ok" };
    return { costUsd: 0, turns: 1, durationMs: 1, terminalReason: "success", isError: false, raw: {}, structuredOutput: output };
  }
}

const TRIGGER = "packages/tokens/src/palette.ts";

const MANIFEST = {
  format: "workspace/1",
  members: [
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

/** A pull request on `acme/web-site` that changes the palette tokens, checked out at `repoDir`. */
function gh(): Deps["gh"] {
  const files = [{ filename: TRIGGER, additions: 1, deletions: 0, patch: "@@ -0,0 +1,1 @@\n+export const brand = '#0a7';" }];
  return (args) => {
    const line = args.join(" ");
    if (line.startsWith("api repos/acme/web-site/pulls/7 ")) return "b".repeat(40);
    if (line.startsWith("pr view")) return JSON.stringify({ headRefOid: "head1234567", baseRefName: "main", title: "t", body: "b", author: { login: "u" } });
    if (line.includes("/pulls/7/files")) return files.map((f) => JSON.stringify(f)).join("\n");
    if (line.includes("/pulls/7/reviews") && !args.includes("POST")) return "";
    if (line.includes("-X POST repos/acme/web-site/pulls/7/reviews")) return "{}";
    if (line.includes("contents/")) throw new GhError("gh: Not Found (HTTP 404)", 404, "Not Found");
    throw new Error(`unexpected gh call: ${line}`);
  };
}

async function githubReview(repoDir: string) {
  const provider = new FakeProvider();
  const deps: Deps = { gh: gh(), provider, config: loadConfig({ WACHIMAN_VERIFY: "0", WACHIMAN_BATCH_LINES: "10" }), log: () => {}, warn: () => {}, repoDir };
  await review(deps, "acme/web-site", 7, []);
  return provider.requests;
}

describe("review() of a pull request with a workspace around it", () => {
  test("gets the prompt and directories it gets without the workspace, with the manifest, the sibling and a per-user default of on all in place", async () => {
    // The plain run: a head checkout with no workspace anywhere.
    const plainHead = temp("wachiman-head-");
    mkdirSync(join(plainHead, "packages/tokens/src"), { recursive: true });
    writeFileSync(join(plainHead, TRIGGER), "export const brand = '#0a7';\n");
    const plainHome = temp("wachiman-home-");
    const before = await withHome(plainHome, () => githubReview(plainHead));

    // The same checkout inside a coordinator, the sibling cloned, and the per-user file turning the mode on.
    const coordinator = temp("wachiman-coordinator-");
    writeFileSync(join(coordinator, MANIFEST_FILE), JSON.stringify(MANIFEST));
    const desktop = join(coordinator, "desktop-app");
    mkdirSync(desktop);
    git(desktop, "init", "-q", "-b", "main");
    commit(desktop, { "Assets/palette.json": '{"brand":"#0a7"}\n' }, "palette");
    const head = join(coordinator, "web-site");
    mkdirSync(join(head, "packages/tokens/src"), { recursive: true });
    writeFileSync(join(head, TRIGGER), "export const brand = '#0a7';\n");
    const home = temp("wachiman-home-");
    writeFileSync(userFilePath(home), JSON.stringify({ version: 1, workspaces: [{ manifest: join(coordinator, MANIFEST_FILE), distributedRepo: "on" }] }));
    const after = await withHome(home, () => githubReview(head));

    // A harness that never reached the provider would compare two empty lists.
    expect(before.length).toBeGreaterThan(0);
    expect(after).toHaveLength(before.length);
    for (const [i, request] of after.entries()) {
      expect(request.prompt).not.toContain("sibling");
      expect(request.prompt).not.toContain("brand-palette");
      expect(request.addDirs).toHaveLength(before[i]!.addDirs.length);
      expect(request.addDirs.some((d) => d.startsWith(desktop))).toBe(false);
    }
    // A GitHub review does not even look at the per-user file: a broken one must not matter.
    writeFileSync(userFilePath(home), "{ not json");
    const broken = await withHome(home, () => githubReview(head));
    expect(broken).toHaveLength(before.length);
    for (const [i, request] of broken.entries()) expect(request.addDirs).toHaveLength(before[i]!.addDirs.length);
  });
});

/** Runs `body` with `WACHIMAN_HOME` set, restoring it after. */
async function withHome<T>(home: string, body: () => Promise<T>): Promise<T> {
  const was = process.env.WACHIMAN_HOME;
  process.env.WACHIMAN_HOME = home;
  try {
    return await body();
  } finally {
    if (was === undefined) delete process.env.WACHIMAN_HOME;
    else process.env.WACHIMAN_HOME = was;
  }
}

describe("the GitHub sink and a distributed-repo result (ADR 0042 decision 6)", () => {
  const distributed = (): ReviewResult => JSON.parse(readFileSync(join(SRC, "../test/fixtures/formats/review-result.v2.distributed.example.json"), "utf8"));
  const plain = (): ReviewResult => JSON.parse(readFileSync(join(SRC, "../test/fixtures/formats/review-result.v2.example.json"), "utf8"));
  const github = {
    since: null,
    rebased: false,
    scoped: false,
    mention: "@wachiman",
    automatic: false,
    instructionChanges: { files: [], baseSha: "b".repeat(40) },
  };

  test("refuses a result that carries privateContext, and says why, before it builds anything", () => {
    const result = distributed();
    expect(result.privateContext).toBeDefined();
    expect(() => buildGithubReview(result, github)).toThrow(/private context/);
    expect(() => buildGithubReview(result, github)).toThrow(/desktop-app/);
  });

  test("refuses any result of the mode, also one that read only public siblings or none: the destination is the laptop", () => {
    const publicOnly = distributed();
    delete publicOnly.privateContext;
    publicOnly.siblings = publicOnly.siblings!.map((s) => ({ ...s, visibility: "public" as const }));
    expect(() => buildGithubReview(publicOnly, github)).toThrow(/distributed-repo/);
    const none = distributed();
    delete none.privateContext;
    none.siblings = [];
    expect(() => buildGithubReview(none, github)).toThrow(/distributed-repo/);
    // The label alone, however it got there, is enough.
    const labelOnly = plain();
    labelOnly.privateContext = { members: ["desktop-app"] };
    expect(() => buildGithubReview(labelOnly, github)).toThrow(/private context/);
  });

  test("a result without the mode builds the review it always did", () => {
    const built = buildGithubReview(plain(), github);
    expect(built.body).toContain("Wachiman");
    expect(JSON.stringify(built)).not.toContain("private context");
  });
});
