import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config";
import {
  GhError,
  readSignedStateBlock,
  review,
  reviewChange,
  reviewOptionsOf,
  type CoreDeps,
  type Deps,
  type GhFn,
  type ReviewInput,
} from "./engine";
import { LOCKFILE_MESSAGES } from "./lockfile-check";
import type { ProviderAdapter, ProviderRequest, ProviderResult } from "./providers/types";

// The lockfile check (`review.lockfile_check`, ADR 0064): a diff that changes only a lockfile is
// not "Nothing to review" any more when the setting is on. It posts the check's findings, at no
// cost and with no model call. Scenario s-032 of the demo shop is the shape: `bun.lock` gains
// `telemetry-helper@2.3.1`, which nothing declares, and trusts it.

/** A provider that must never be called: the check is deterministic. */
class NoModel implements ProviderAdapter {
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
    throw new Error("the lockfile check must not call a model");
  }
}

/** Answers every call with no findings, and lists the files its part holds as reviewed. */
class QuietModel extends NoModel {
  override async run(request: ProviderRequest): Promise<ProviderResult> {
    this.requests.push(request);
    const held = [
      ...(request.prompt.split("This part holds exactly these files")[1] ?? "").split("\n\n")[0]!.matchAll(/^- (\S+) \+/gm),
    ].map((m) => m[1]);
    return {
      structuredOutput: { files_reviewed: held, files_skipped: [], findings: [], thread_replies: [], summary: "nothing" },
      costUsd: 0.01,
      turns: 1,
      durationMs: 1,
      terminalReason: "success",
      isError: false,
      raw: {},
    };
  }
}

const BUN_LOCK = [
  "{",
  '  "lockfileVersion": 1,',
  '  "workspaces": {',
  '    "": {',
  '      "name": "shop",',
  '      "dependencies": {',
  '        "left-pad": "1.3.0",',
  "      },",
  "    },",
  "  },",
  '  "trustedDependencies": [',
  '    "telemetry-helper",',
  "  ],",
  "",
  '  "packages": {',
  '    "left-pad": ["left-pad@1.3.0", "", {}, "sha512-a"],',
  "",
  '    "telemetry-helper": ["telemetry-helper@2.3.1", "", { "bin": { "telemetry-helper": "bin/run.js" } }, "sha512-b"],',
  "  }",
  "}",
  "",
].join("\n");

const NPM_LOCK = [
  "{",
  '  "name": "shop",',
  '  "lockfileVersion": 3,',
  '  "packages": {',
  '    "": {',
  '      "name": "shop",',
  '      "dependencies": {',
  '        "left-pad": "1.3.0"',
  "      }",
  "    },",
  '    "node_modules/left-pad": {',
  '      "version": "1.3.0"',
  "    },",
  '    "node_modules/telemetry-helper": {',
  '      "version": "2.3.1",',
  '      "integrity": "sha512-b",',
  '      "resolved": "https://registry.npmjs.org/telemetry-helper/-/telemetry-helper-2.3.1.tgz",',
  '      "hasInstallScript": true',
  "    }",
  "  }",
  "}",
  "",
].join("\n");

const lineOf = (text: string, needle: string) => text.split("\n").findIndex((l) => l.includes(needle)) + 1;
const TRUSTED_LINE = lineOf(BUN_LOCK, '    "telemetry-helper",');
const ENTRY_LINE = lineOf(BUN_LOCK, '"telemetry-helper": ["telemetry-helper@2.3.1"');

/** The diff s-032 plants: a new `trustedDependencies` block and a new package line. */
const PLANT_PATCH = [
  `@@ -10,0 +${TRUSTED_LINE - 1},3 @@`,
  '+  "trustedDependencies": [',
  '+    "telemetry-helper",',
  "+  ],",
  `@@ -16,0 +${ENTRY_LINE},1 @@`,
  '+    "telemetry-helper": ["telemetry-helper@2.3.1", "", { "bin": { "telemetry-helper": "bin/run.js" } }, "sha512-b"],',
].join("\n");

/** A clean refresh: only a declared package moves to a new version. */
const REFRESH_LINE = lineOf(BUN_LOCK, '"left-pad": ["left-pad@1.3.0"');
const REFRESH_PATCH = [
  `@@ -${REFRESH_LINE},1 +${REFRESH_LINE},1 @@`,
  '-    "left-pad": ["left-pad@1.2.0", "", {}, "sha512-old"],',
  '+    "left-pad": ["left-pad@1.3.0", "", {}, "sha512-a"],',
].join("\n");

const lockOnly = (patch: string) => [{ filename: "bun.lock", additions: 2, deletions: 1, patch }];

function headWith(files: Record<string, string | Buffer>) {
  const dir = mkdtempSync(join(tmpdir(), "lockfile-check-head-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path.split("/").slice(0, -1).join("/") || "."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

describe("the core", () => {
  const coreDeps = (provider: NoModel): CoreDeps => ({ provider, log: () => {}, warn: () => {}, sleep: () => {} }) as CoreDeps;
  const input = (over: Partial<ReviewInput>): ReviewInput => ({
    format: "wachiman.review-input/1",
    change: {
      kind: "branch",
      describe: "branch `feat/x` of repo against main (merge-base 1234567)",
      repository: { name: "repo" },
      base: { sha: "1234567000000000000000000000000000000000" },
      head: { sha: "9999999999999999999999999999999999999999" },
    },
    files: lockOnly(PLANT_PATCH),
    instructions: { baseSha: "1234567000000000000000000000000000000000", files: [] },
    scope: [],
    headDir: headWith({ "bun.lock": BUN_LOCK, "package.json": JSON.stringify({ name: "shop", dependencies: { "left-pad": "1.3.0" } }) }),
    ...over,
  });
  const options = () => reviewOptionsOf(loadConfig({ WACHIMAN_VERIFY: "0" }), 5);

  test("a diff of only bun.lock that adds an undeclared package and trusts it yields both findings, with no model call", async () => {
    const provider = new NoModel();
    const result = await reviewChange(input({ lockfileCheck: true }), options(), coreDeps(provider));
    expect(provider.requests).toHaveLength(0);
    expect(result.execution.calls).toBe(0);
    expect(result.coverage).toMatchObject({ expected: [], excluded: 1 });
    expect(result.findings.map((f) => [f.path, f.line, f.severity, f.topic, f.title, f.anchor])).toEqual([
      ["bun.lock", ENTRY_LINE, "fix", "security", LOCKFILE_MESSAGES.undeclared.title, "diff"],
      ["bun.lock", TRUSTED_LINE, "fix", "security", LOCKFILE_MESSAGES.trusted.title, "diff"],
    ]);
  });

  test("findings join a review a model ran on other files, and are not sent to it", async () => {
    const provider = new QuietModel();
    const headDir = headWith({
      "bun.lock": BUN_LOCK,
      "package.json": JSON.stringify({ name: "shop", dependencies: { "left-pad": "1.3.0" } }),
      "src/a.ts": "export const a = 1;\n",
    });
    const files = [
      { filename: "src/a.ts", additions: 1, deletions: 0, patch: "@@ -0,0 +1 @@\n+export const a = 1;" },
      ...lockOnly(PLANT_PATCH),
    ];
    const result = await reviewChange(input({ lockfileCheck: true, files, headDir }), options(), coreDeps(provider));
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.prompt).not.toContain("telemetry-helper");
    expect(result.findings.map((f) => [f.path, f.line, f.title])).toEqual([
      ["bun.lock", ENTRY_LINE, LOCKFILE_MESSAGES.undeclared.title],
      ["bun.lock", TRUSTED_LINE, LOCKFILE_MESSAGES.trusted.title],
    ]);
  });

  test("a package-lock.json diff that adds an undeclared package with an install script yields both findings", async () => {
    const lock = NPM_LOCK;
    const start = lineOf(lock, '"node_modules/telemetry-helper"');
    const patch = [
      `@@ -0,0 +${start},6 @@`,
      ...lock
        .split("\n")
        .slice(start - 1, start + 5)
        .map((l) => `+${l}`),
    ].join("\n");
    const headDir = headWith({
      "package-lock.json": lock,
      "package.json": JSON.stringify({ name: "shop", dependencies: { "left-pad": "1.3.0" } }),
    });
    const files = [{ filename: "package-lock.json", additions: 6, deletions: 0, patch }];
    const result = await reviewChange(input({ lockfileCheck: true, files, headDir }), options(), coreDeps(new NoModel()));
    expect(result.findings.map((f) => [f.line, f.title])).toEqual([
      [start, LOCKFILE_MESSAGES.undeclared.title],
      [lineOf(lock, '"hasInstallScript": true'), LOCKFILE_MESSAGES.installScript.title],
    ]);
  });

  test("a clean refresh (a version bump of a declared dependency) yields nothing", async () => {
    const result = await reviewChange(input({ lockfileCheck: true, files: lockOnly(REFRESH_PATCH) }), options(), coreDeps(new NoModel()));
    expect(result.findings).toEqual([]);
  });

  test("with the setting off, the same diff yields nothing: the review is as it was before the check", async () => {
    const result = await reviewChange(input({}), options(), coreDeps(new NoModel()));
    expect(result.findings).toEqual([]);
    expect(result.coverage.excluded).toBe(1);
  });
});

// The GitHub path: the setting is read from the pull request's base commit, never its head.
const HEAD = "head1234567";
const BASE = "b".repeat(40);

interface Posted {
  review?: { body: string; comments: { path: string; line: number; body: string }[] };
}

function fakeGh(posted: Posted, patch: string, settings: { base?: string; head?: string }, extra: object[] = [], failRead = false): GhFn {
  return (args, input) => {
    const line = args.join(" ");
    if (line.startsWith("api repos/o/r/pulls/7 ")) return BASE;
    if (line.startsWith("pr view"))
      return JSON.stringify({ headRefOid: HEAD, baseRefName: "main", title: "t", body: "b", author: { login: "u" } });
    if (line.includes("/pulls/7/files")) return [...extra, ...lockOnly(patch)].map((f) => JSON.stringify(f)).join("\n");
    if (line.includes("/pulls/7/reviews") && !args.includes("POST")) return "";
    if (line.includes("-X POST repos/o/r/pulls/7/reviews")) {
      posted.review = JSON.parse(input ?? "{}");
      return "{}";
    }
    if (args.includes("graphql")) return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } });
    const m = /\/contents\/(.+)\?ref=(\S+)$/.exec(line);
    if (m) {
      if (failRead && m[1] === ".wachiman.yml") throw new GhError("gh: Server Error (HTTP 500)", 500, "Server Error");
      const content = m[1] === ".wachiman.yml" ? (m[2] === BASE ? settings.base : m[2] === HEAD ? settings.head : undefined) : undefined;
      if (content === undefined) throw new GhError("gh: Not Found (HTTP 404)", 404, "Not Found");
      return JSON.stringify({ type: "file", encoding: "base64", content: Buffer.from(content).toString("base64") });
    }
    throw new Error(`unexpected gh call: ${line}`);
  };
}

async function githubRun(
  patch: string,
  settings: { base?: string; head?: string },
  extra: { files?: object[]; head?: Record<string, string | Buffer>; readFails?: boolean } = {},
) {
  const posted: Posted = {};
  const provider = new NoModel();
  const logs: string[] = [];
  const deps: Deps = {
    gh: fakeGh(posted, patch, settings, extra.files, extra.readFails),
    provider,
    config: loadConfig({ WACHIMAN_VERIFY: "0" }, () => {}),
    repoDir: headWith({
      "bun.lock": BUN_LOCK,
      "package.json": JSON.stringify({ name: "shop", dependencies: { "left-pad": "1.3.0" } }),
      ...extra.head,
    }),
    log: (l) => logs.push(l),
    warn: (l) => logs.push(l),
    sleep: () => {},
  };
  await review(deps, "o/r", 7, []);
  return { posted, provider, logs };
}

const ON = "review:\n  lockfile_check: true\n";

describe("a pull request in Actions that changes only bun.lock", () => {
  test("with the setting on at the base, the findings are posted as a review with inline comments, at no cost", async () => {
    const { posted, provider } = await githubRun(PLANT_PATCH, { base: ON });
    expect(provider.requests).toHaveLength(0);
    const body = posted.review?.body ?? "";
    expect(body).not.toContain("Nothing to review");
    expect(posted.review?.comments.map((c) => [c.path, c.line])).toEqual([
      ["bun.lock", ENTRY_LINE],
      ["bun.lock", TRUSTED_LINE],
    ]);
    expect(posted.review?.comments[0]?.body).toContain(LOCKFILE_MESSAGES.undeclared.title);
    expect(posted.review?.comments[1]?.body).toContain(LOCKFILE_MESSAGES.trusted.title);
    expect(body).toContain(`<!-- wachiman sha=${HEAD} -->`);
    expect(readSignedStateBlock(body)).toMatchObject({ status: "complete" });
  });

  test("when every other changed file is a binary, the findings are still posted", async () => {
    const png = { filename: "assets/icon.png", additions: 0, deletions: 0, status: "added" };
    const { posted, provider } = await githubRun(
      PLANT_PATCH,
      { base: ON },
      {
        files: [png],
        head: { "assets/icon.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0x0d]) },
      },
    );
    expect(provider.requests).toHaveLength(0);
    expect(posted.review?.body).not.toContain("Nothing to review");
    expect(posted.review?.comments.map((c) => [c.path, c.line])).toEqual([
      ["bun.lock", ENTRY_LINE],
      ["bun.lock", TRUSTED_LINE],
    ]);
  });

  test("a base setting that cannot be read keeps the notice, as before the check", async () => {
    const { posted, logs } = await githubRun(PLANT_PATCH, { base: ON }, { readFails: true });
    expect(posted.review?.body.split("\n")[0]).toContain("Nothing to review at `head123`");
    expect(logs.join("\n")).toContain("lockfile check skipped");
  });

  test("a clean refresh still posts the signed 'Nothing to review' notice", async () => {
    const { posted, provider } = await githubRun(REFRESH_PATCH, { base: ON });
    expect(provider.requests).toHaveLength(0);
    expect(posted.review?.body.split("\n")[0]).toContain("Nothing to review at `head123`");
    expect(posted.review?.comments).toEqual([]);
  });

  test("no .wachiman.yml: the notice, as before the check", async () => {
    const { posted } = await githubRun(PLANT_PATCH, {});
    expect(posted.review?.body.split("\n")[0]).toContain("Nothing to review at `head123`");
    expect(posted.review?.comments).toEqual([]);
  });

  test("the setting false at the base is the same as absent", async () => {
    const { posted } = await githubRun(PLANT_PATCH, { base: "review:\n  lockfile_check: false\n" });
    expect(posted.review?.body.split("\n")[0]).toContain("Nothing to review at `head123`");
  });

  test("only the head turns it on: this review does not apply it", async () => {
    const { posted } = await githubRun(PLANT_PATCH, { head: ON });
    expect(posted.review?.body.split("\n")[0]).toContain("Nothing to review at `head123`");
  });
});
