/**
 * The palette workspace end to end: the real `wachiman local` CLI over two real git repositories
 * (`desktop-app` holds the palette, `web-site` holds a copy) under a workspace manifest, with a stub
 * `claude` that records every call and answers from a canned findings file. No model, no network.
 * The names are invented. Spec: docs/specs/2026-11-13-distributed-repo-review-design.md, "Acceptance criteria".
 */
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commit, git, removeTempRepos } from "../test/support/temp-repo";
import { REMOVED_REFERENCE } from "./sibling-references";
import { MANIFEST_FILE } from "./workspace/manifest";

const temps: string[] = [];
const temp = (prefix: string) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  removeTempRepos();
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const cli = join(import.meta.dir, "cli.ts");

const PALETTE = "src/theme/palette.ts";
const CSS = "styles/colors.css";
// No `visibility` on either member: the default must be private.
const MANIFEST = {
  format: "workspace/1",
  members: [
    { dir: "desktop-app", repo: "acme/desktop-app" },
    { dir: "web-site", repo: "acme/web-site" },
  ],
  contracts: [
    {
      name: "palette",
      sides: [
        { member: "desktop-app", role: "provider", paths: [PALETTE] },
        { member: "web-site", role: "consumer", paths: [CSS] },
      ],
      sourceOfTruth: { member: "desktop-app", paths: [PALETTE] },
    },
  ],
};

/** The palette before and after a colour edit, and the copy: line 2 of the CSS is `--brand`. */
const palette = (brand: string) => `export const palette = {\n  brand: "${brand}",\n  ink: "#111111",\n};\n`;
const css = (brand: string) => `:root {\n  --brand: ${brand};\n  --ink: #111111;\n}\n`;

interface Workspace {
  parent: string;
  desktopApp?: string;
  webSite: string;
}

/**
 * Both members are git repos on `main` with the old colour; `changed` gets a `feat/x` branch that
 * edits its own palette file. With `cloneDesktop` false, `desktop-app` is not on disk.
 */
function workspace(changed: "desktop-app" | "web-site", cloneDesktop = true): Workspace {
  const parent = temp("wachiman-palette-");
  const make = (dir: string, files: Record<string, string>, edited: Record<string, string> | undefined) => {
    const path = join(parent, dir);
    mkdirSync(path);
    git(path, "init", "-q", "-b", "main");
    commit(path, files, "base");
    if (edited) {
      git(path, "switch", "-q", "-c", "feat/x");
      commit(path, edited, "edit the brand colour");
    }
    return path;
  };
  const desktopApp = cloneDesktop
    ? make("desktop-app", { [PALETTE]: palette("#000000") }, changed === "desktop-app" ? { [PALETTE]: palette("#0a7a5c") } : undefined)
    : undefined;
  const webSite = make("web-site", { [CSS]: css("#000000") }, changed === "web-site" ? { [CSS]: css("#0a7a5c") } : undefined);
  writeFileSync(join(parent, MANIFEST_FILE), JSON.stringify(MANIFEST));
  return { parent, desktopApp, webSite };
}

/** `claude` stub: records each call's prompt and add-dirs, answers one finding per reviewed file from `findings.json`. */
function stub(findings: unknown[]) {
  const bin = temp("wachiman-bin-");
  const calls = join(bin, "calls");
  mkdirSync(calls);
  writeFileSync(join(bin, "findings.json"), JSON.stringify(findings));
  writeFileSync(join(bin, "gh"), `#!/bin/sh\necho called >> "${join(bin, "gh-called")}"\nexit 99\n`);
  writeFileSync(
    join(bin, "claude"),
    `#!${process.execPath}
import { readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "auth") {
  console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", configDirectory: process.env.CLAUDE_CONFIG_DIR }));
  process.exit(0);
}
if (args[0] === "--version") {
  console.log("9.9.9 (Claude Code)");
  process.exit(0);
}
const prompt = readFileSync(0, "utf8");
const dirs = args.flatMap((a, i) => (args[i - 1] === "--add-dir" ? [a] : []));
const snapshots = dirs.filter((d) => /distributed-snapshot|wachiman-sibling/.test(d));
writeFileSync("${calls}/" + process.pid + ".json", JSON.stringify({ prompt, dirs, snapshots }));
const block = prompt.split("This part holds exactly these files")[1]?.split("Each diff line")[0] ?? "";
const files = block.split("\\n").flatMap((l) => (l.startsWith("- ") ? [l.slice(2).replace(/ \\+\\d+ −\\d+$/, "")] : []));
console.log(JSON.stringify({
  is_error: false, subtype: "success", num_turns: 1, total_cost_usd: 0.01, duration_ms: 1,
  structured_output: { files_reviewed: files, files_skipped: [], findings: JSON.parse(readFileSync("${join(bin, "findings.json")}", "utf8")), contracts: [], thread_replies: [], summary: "done" },
}));
`,
  );
  chmodSync(join(bin, "gh"), 0o755);
  chmodSync(join(bin, "claude"), 0o755);
  return {
    gh: join(bin, "gh-called"),
    bin,
    calls: (): { prompt: string; dirs: string[] }[] => readdirSync(calls).map((f) => JSON.parse(readFileSync(join(calls, f), "utf8"))),
  };
}

function review(repoDir: string, findings: unknown[], format: "json" | "terminal" | "markdown" = "json") {
  const s = stub(findings);
  const env = {
    PATH: `${s.bin}:${process.env.PATH ?? ""}`,
    HOME: temp("wachiman-user-"),
    USER: "dev",
    WACHIMAN_HOME: temp("wachiman-home-"),
    WACHIMAN_VERIFY: "0",
    WACHIMAN_BATCH_LINES: "1",
  };
  const out = Bun.spawnSync(
    [process.execPath, cli, "local", "--repo-dir", repoDir, "--base", "main", "--distributed-repo", "--format", format],
    { env, stdin: "ignore" },
  );
  const stdout = out.stdout.toString();
  return {
    code: out.exitCode,
    stdout,
    stderr: out.stderr.toString(),
    calls: s.calls(),
    ghCalled: existsSync(s.gh),
    result: format === "json" ? JSON.parse(stdout) : undefined,
  };
}

const finding = (path: string, body: string) => ({
  path,
  line: 2,
  severity: "fix",
  topic: "bug",
  confidence: "high",
  title: "The copy of the palette drifts",
  body,
});

describe("palette workspace: a change in desktop-app, the source of truth", () => {
  const w = workspace("desktop-app");
  const webSha = git(w.webSite, "rev-parse", "HEAD").trim();
  const short = webSha.slice(0, 7);
  const r = review(w.desktopApp!, [
    finding(PALETTE, `The copy still says \`web-site@${short}:${CSS}:2\`, and \`web-site@${short}:${CSS}:99\` is not it.`),
  ]);

  test("the run reads web-site as a snapshot and the batch prompt holds the palette contract section", () => {
    expect(r.code).toBe(0);
    expect(r.calls).toHaveLength(1);
    const [call] = r.calls;
    expect(call!.snapshots).toHaveLength(1);
    expect(call!.prompt).toContain("## Workspace contracts and sibling repositories");
    expect(call!.prompt).toContain("### Contract `palette`");
    expect(call!.prompt).toContain(`- web-site: consumer (${CSS}). Read at commit ${webSha}`);
    expect(r.ghCalled).toBe(false);
  });

  test("the cited reference to a line that exists is kept with member, full sha, path and line; the one to a missing line is removed and counted", () => {
    const [f] = r.result.findings;
    expect(f.references).toEqual([{ member: "web-site", sha: webSha, path: CSS, line: 2 }]);
    expect(f.body).toContain(`web-site@${short}:${CSS}:2`);
    expect(f.body).not.toContain(`${CSS}:99`);
    expect(f.body).toContain(REMOVED_REFERENCE);
    expect(r.result.removedSiblingReferences).toBe(1);
  });

  test("the JSON is result /2 with the sibling, the applied contract and the private-context label (members default to private)", () => {
    expect(r.result.format).toBe("wachiman.review-result/2");
    expect(r.result.workspaceContractsApplied).toContain("palette");
    expect(r.result.siblings).toHaveLength(1);
    expect(r.result.siblings[0]).toMatchObject({
      member: "web-site",
      visibility: "private",
      status: "read",
      sha: webSha,
      contracts: ["palette"],
    });
    expect(r.result.privateContext).toEqual({ members: ["web-site"] });
  });
});

describe("palette workspace: a change in web-site, the copy", () => {
  test("the run reads desktop-app and the prompt names it as the source of truth", () => {
    const w = workspace("web-site");
    const desktopSha = git(w.desktopApp!, "rev-parse", "HEAD").trim();
    const r = review(w.webSite, []);
    expect(r.code).toBe(0);
    expect(r.calls).toHaveLength(1);
    const [call] = r.calls;
    expect(call!.snapshots).toHaveLength(1);
    expect(call!.prompt).toContain("### Contract `palette`");
    expect(call!.prompt).toContain(`- desktop-app: provider (${PALETTE}); source of truth (${PALETTE}). Read at commit ${desktopSha}`);
    expect(call!.prompt).toContain("- web-site, the repository under review: consumer");
    expect(r.result.siblings[0]).toMatchObject({ member: "desktop-app", status: "read", sha: desktopSha });
  });

  describe("with desktop-app not cloned", () => {
    const w = workspace("web-site", false);
    const json = review(w.webSite, []);

    test("the run completes, the sibling row says not cloned, and nothing is snapshotted", () => {
      expect(json.code).toBe(0);
      expect(json.result.siblings.map((s: { member: string; status: string }) => [s.member, s.status])).toEqual([
        ["desktop-app", "not-cloned"],
      ]);
      expect(json.calls[0]!.snapshots).toHaveLength(0);
      expect(json.calls[0]!.prompt).toContain(
        `- desktop-app: provider (${PALETTE}); source of truth (${PALETTE}). not cloned: not checked.`,
      );
      expect(json.result.workspaceContractsApplied).toContain("palette");
      expect(json.result).not.toHaveProperty("privateContext");
    });

    test.each(["terminal", "markdown"] as const)("the %s output says desktop-app was not cloned and not checked", (format) => {
      const r = review(w.webSite, [], format);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain("desktop-app: source of truth not cloned: not checked");
    });
  });
});
