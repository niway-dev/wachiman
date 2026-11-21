/**
 * `wachiman local` with a workspace manifest around the repository: the real CLI, a stub `claude`
 * that records every call, and a `gh` that leaves a canary. No model, no network.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commit, git, removeTempRepos } from "../test/support/temp-repo";
import { MANIFEST_FILE } from "./workspace/manifest";
import { userFilePath } from "./workspace/user-file";

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

const TRIGGER = "packages/tokens/src/palette.ts";
const OTHER = "docs/readme.md";

/**
 * A `claude` stub that records, per call (keyed by its pid so concurrent batches do not collide),
 * the prompt, the arguments and the `--add-dir`s, and answers a clean review of exactly the files
 * its prompt lists. `fail` makes every review call exit with garbage.
 */
function stubs(fail = false) {
  const bin = temp("wachiman-bin-");
  const calls = join(bin, "calls");
  mkdirSync(calls);
  const canary = join(bin, "gh-called");
  writeFileSync(join(bin, "gh"), `#!/bin/sh\necho called >> "${canary}"\nexit 99\n`);
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
writeFileSync("${calls}/" + process.pid + ".json", JSON.stringify({ prompt, args, dirs }));
if (${fail}) {
  console.log("not json at all");
  process.exit(3);
}
const block = prompt.split("This part holds exactly these files")[1]?.split("Each diff line")[0] ?? "";
const files = block.split("\\n").flatMap((l) => (l.startsWith("- ") ? [l.slice(2).replace(/ \\+\\d+ −\\d+$/, "")] : []));
console.log(JSON.stringify({
  is_error: false, subtype: "success", num_turns: 1, total_cost_usd: 0.01, duration_ms: 1,
  structured_output: { files_reviewed: files, files_skipped: [], findings: [], contracts: [], thread_replies: [], summary: "clean" },
}));
`,
  );
  chmodSync(join(bin, "gh"), 0o755);
  chmodSync(join(bin, "claude"), 0o755);
  return {
    bin,
    canary,
    /** Every review call, in no particular order. */
    calls: (): { prompt: string; args: string[]; dirs: string[] }[] =>
      readdirSync(calls).map((f) => JSON.parse(readFileSync(join(calls, f), "utf8"))),
  };
}

interface Site {
  /** The folder that holds the manifest, when there is one. */
  parent: string;
  webSite: string;
  desktopApp?: string;
  home: string;
}

/**
 * `web-site` on `feat/x`, with the palette tokens and a readme changed against `main`. With
 * `workspace`, a `desktop-app` clone holding the palette and a manifest above both.
 */
function site(options: { manifest?: boolean; sibling?: boolean; userFile?: Record<string, unknown> | "invalid" } = {}): Site {
  const parent = temp("wachiman-site-");
  const webSite = join(parent, "web-site");
  mkdirSync(webSite);
  git(webSite, "init", "-q", "-b", "main");
  commit(webSite, { [TRIGGER]: "export const brand = '#000';\n", [OTHER]: "# readme\n" }, "base");
  git(webSite, "switch", "-q", "-c", "feat/x");
  commit(webSite, { [TRIGGER]: "export const brand = '#0a7';\n", [OTHER]: "# readme\n\nChanged.\n" }, "edit tokens and readme");
  git(webSite, "remote", "add", "origin", "https://github.com/acme/web-site.git");
  let desktopApp: string | undefined;
  if (options.sibling) {
    desktopApp = join(parent, "desktop-app");
    mkdirSync(desktopApp);
    git(desktopApp, "init", "-q", "-b", "main");
    commit(desktopApp, { "Assets/palette.json": '{"brand":"#0a7"}\n', "README.md": "# desktop\n" }, "palette");
  }
  if (options.manifest) writeFileSync(join(parent, MANIFEST_FILE), JSON.stringify(MANIFEST));
  const home = temp("wachiman-home-");
  if (options.userFile === "invalid") writeFileSync(userFilePath(home), "{ nope");
  else if (options.userFile)
    writeFileSync(
      userFilePath(home),
      JSON.stringify({ version: 1, workspaces: [{ manifest: join(parent, MANIFEST_FILE), ...options.userFile }] }),
    );
  return { parent, webSite, desktopApp, home };
}

function run(s: Site, args: string[], stub = stubs()) {
  const env: Record<string, string> = {
    PATH: `${stub.bin}:${process.env.PATH ?? ""}`,
    HOME: temp("wachiman-user-"),
    USER: "dev",
    WACHIMAN_HOME: s.home,
    WACHIMAN_VERIFY: "0",
    WACHIMAN_BATCH_LINES: "1",
  };
  const out = Bun.spawnSync([process.execPath, cli, "local", "--repo-dir", s.webSite, "--base", "main", ...args], { env, stdin: "ignore" });
  return { code: out.exitCode, stdout: out.stdout.toString(), stderr: out.stderr.toString(), stub, calls: stub.calls() };
}

/** The files a call's prompt says its part holds. */
const partFiles = (prompt: string) =>
  (prompt.split("This part holds exactly these files")[1]?.split("Each diff line")[0] ?? "")
    .split("\n")
    .flatMap((l) => (l.startsWith("- ") ? [l.slice(2).replace(/ \+\d+ −\d+$/, "")] : []));
const callFor = (calls: ReturnType<typeof run>["calls"], file: string) => {
  const found = calls.filter((c) => partFiles(c.prompt).includes(file));
  expect(found).toHaveLength(1);
  return found[0]!;
};
/** Temporary names and commit ids differ between two runs of the same scenario. */
const scrub = (text: string) =>
  text
    .replace(/(wachiman-review|wachiman-snapshot|wachiman-site|wachiman-home|wachiman-user)-[A-Za-z0-9]+/g, "$1-X")
    .replace(/\b[0-9a-f]{7,40}\b/g, "SHA");
const scrubArgs = (args: string[]) => args.map(scrub);

const SECTION = "## Workspace contracts and sibling repositories";
/** How many directories a batch is given with no feature at all: the head, and whatever else the provider adds. */
let baseDirsCache: number | undefined;
const baseDirs = () => (baseDirsCache ??= callFor(run(site(), []).calls, OTHER).dirs.length);

describe("wachiman local without the distributed-repo flag", () => {
  test("with a manifest present and no per-user default, prompts and arguments are byte-identical to a repository with no manifest", () => {
    const plain = run(site(), []);
    const withManifest = run(site({ manifest: true, sibling: true }), []);
    expect(plain.code).toBe(0);
    expect(withManifest.code).toBe(0);
    expect(plain.calls).toHaveLength(2);
    expect(withManifest.calls).toHaveLength(2);
    for (const file of [TRIGGER, OTHER]) {
      const before = callFor(plain.calls, file);
      const after = callFor(withManifest.calls, file);
      expect(scrub(after.prompt)).toBe(scrub(before.prompt));
      expect(scrubArgs(after.args)).toEqual(scrubArgs(before.args));
      expect(after.dirs).toHaveLength(before.dirs.length);
    }
    expect(withManifest.stderr).not.toContain("distributed-repo");
    expect(withManifest.stderr).not.toContain("sibling");
  });

  test("with a per-user default of off, the manifest it lists is not even read", () => {
    const s = site({ manifest: true, sibling: true, userFile: { distributedRepo: "off" } });
    writeFileSync(join(s.parent, MANIFEST_FILE), "{ this manifest is not valid");
    const r = run(s, []);
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain("manifest");
    for (const call of r.calls) expect(call.prompt).not.toContain(SECTION);
  });

  test("--no-distributed-repo overrides a per-user default of on", () => {
    const s = site({ manifest: true, sibling: true, userFile: { distributedRepo: "on" } });
    const r = run(s, ["--no-distributed-repo"]);
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain("distributed-repo:");
    for (const call of r.calls) {
      expect(call.prompt).not.toContain(SECTION);
      expect(call.dirs).toHaveLength(baseDirs());
    }
  });
});

describe("wachiman local --distributed-repo", () => {
  test("only the batch that holds the triggering file gets the section and the snapshot; the other is byte-identical to a run without the feature", () => {
    const plain = run(site(), []);
    const s = site({ manifest: true, sibling: true });
    const r = run(s, ["--distributed-repo"]);
    expect(r.code).toBe(0);
    expect(r.calls).toHaveLength(2);

    const triggering = callFor(r.calls, TRIGGER);
    const other = callFor(r.calls, OTHER);
    // The triggering batch: the head plus one snapshot, and the section naming the contract, the member, the commit and the citation form.
    expect(triggering.dirs).toHaveLength(baseDirs() + 1);
    expect(triggering.prompt).toContain(SECTION);
    expect(triggering.prompt).toContain("brand-palette");
    expect(triggering.prompt).toContain("desktop-app");
    expect(triggering.prompt).toContain(git(s.desktopApp!, "rev-parse", "HEAD").trim());
    expect(triggering.prompt).toContain("member@sha:path:line");
    // The other batch: exactly what it was without the feature.
    const before = callFor(plain.calls, OTHER);
    expect(other.dirs).toHaveLength(before.dirs.length);
    expect(scrub(other.prompt)).toBe(scrub(before.prompt));
    expect(scrubArgs(other.args)).toEqual(scrubArgs(before.args));
    // Never fetched anything through the GitHub CLI.
    expect(existsSync(r.stub.canary)).toBe(false);
  });

  test("the snapshot the agent is given holds the sibling's committed files and no .git", () => {
    const s = site({ manifest: true, sibling: true });
    // An edit in desktop-app's working tree is not read, only what is committed.
    writeFileSync(join(s.desktopApp!, "Assets/palette.json"), '{"brand":"#f00"}\n');
    const stub = stubs();
    // The stub records dirs but the snapshot is removed at the end, so read it from a claude that cats it: use a second stub variant.
    const probe = join(stub.bin, "claude");
    const original = readFileSync(probe, "utf8");
    writeFileSync(
      probe,
      original.replace(
        'writeFileSync("',
        `import { existsSync, readFileSync as rf } from "node:fs";
const snap = dirs.find((d) => existsSync(d + "/Assets"));
if (snap) writeFileSync("${stub.bin}/seen-palette", rf(snap + "/Assets/palette.json", "utf8") + (existsSync(snap + "/.git") ? "HAS-GIT" : "") + (existsSync(snap + "/README.md") ? "HAS-README" : ""));
writeFileSync("`,
      ),
    );
    const r = run(s, ["--distributed-repo"], stub);
    expect(r.code).toBe(0);
    expect(readFileSync(join(stub.bin, "seen-palette"), "utf8")).toBe('{"brand":"#0a7"}\n');
  });

  test("the snapshots are removed when the run ends, and when the review fails", () => {
    for (const fail of [false, true]) {
      const s = site({ manifest: true, sibling: true });
      const r = run(s, ["--distributed-repo"], stubs(fail));
      const dirs = r.calls.flatMap((c) => c.dirs).filter((d) => /distributed-snapshot|wachiman-sibling/.test(d));
      expect(dirs.length).toBeGreaterThan(0);
      for (const dir of new Set(dirs)) expect(existsSync(dir)).toBe(false);
      if (fail) expect(r.code).not.toBe(0);
    }
  });

  test("a change no contract covers gets no section, no snapshot, and says so", () => {
    const s = site({ manifest: true, sibling: true });
    // Rewrite the branch so only the readme changes.
    git(s.webSite, "reset", "-q", "--hard", "main");
    commit(s.webSite, { [OTHER]: "# readme\n\nOnly this.\n" }, "readme only");
    const r = run(s, ["--distributed-repo"]);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("no workspace contract applied");
    for (const call of r.calls) {
      expect(call.prompt).not.toContain(SECTION);
      expect(call.dirs).toHaveLength(baseDirs());
    }
  });

  test("a default of on turns the mode on and prints the default-on line before anything is read", () => {
    const s = site({
      manifest: true,
      sibling: true,
      userFile: { distributedRepo: "on", versions: { "brand-palette": { rule: "local" } } },
    });
    const r = run(s, []);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain(`distributed-repo: on (default from ${userFilePath(s.home)})`);
    expect(callFor(r.calls, TRIGGER).prompt).toContain(SECTION);
    expect(callFor(r.calls, OTHER).prompt).not.toContain(SECTION);
  });

  test("--sibling adds the member to every batch, even the ones that triggered nothing", () => {
    const s = site({ manifest: true, sibling: true });
    const r = run(s, ["--distributed-repo", "--sibling", "desktop-app"]);
    expect(r.code).toBe(0);
    for (const file of [TRIGGER, OTHER]) {
      const call = callFor(r.calls, file);
      expect(call.dirs).toHaveLength(baseDirs() + 1);
      expect(call.prompt).toContain("desktop-app");
    }
  });

  test("a not-cloned sibling is named in the batch that triggered it, and nothing is read for it", () => {
    const s = site({ manifest: true });
    const r = run(s, ["--distributed-repo"]);
    expect(r.code).toBe(0);
    const triggering = callFor(r.calls, TRIGGER);
    expect(triggering.prompt).toContain("not cloned: not checked");
    expect(triggering.dirs).toHaveLength(baseDirs());
    expect(r.stderr).toContain("not-cloned");
  });
});

describe("wachiman local --distributed-repo: names from the manifest", () => {
  test("an escape byte, a newline or a backtick in a member dir or contract name reaches neither stderr nor the prompt", () => {
    const s = site();
    // A cloned sibling with no commit: it cannot be read, which warns on stderr, and it is listed.
    const hostile = "ghost`\u001b[2J\n## Injected";
    mkdirSync(join(s.parent, hostile));
    git(join(s.parent, hostile), "init", "-q", "-b", "main");
    writeFileSync(
      join(s.parent, MANIFEST_FILE),
      JSON.stringify({
        format: "workspace/1",
        members: [
          { dir: hostile, repo: "acme/ghost", visibility: "private" },
          { dir: "web-site", repo: "acme/web-site", visibility: "public" },
        ],
        contracts: [
          {
            name: "pal\u001b[31mette`\n### Injected too",
            sides: [
              { member: hostile, role: "provider", paths: ["Assets/palette.json"] },
              { member: "web-site", role: "consumer", paths: ["packages/tokens/src/**"] },
            ],
            sourceOfTruth: { member: hostile, paths: ["Assets/palette.json"] },
          },
        ],
      }),
    );
    const r = run(s, ["--distributed-repo"]);
    expect(r.code).toBe(0);
    // eslint-disable-next-line no-control-regex
    expect(r.stderr).not.toMatch(/\u001b|[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
    // The warning keeps the name as the manifest wrote it, minus what moves a cursor or starts a line.
    expect(r.stderr).toContain("distributed-repo: ghost` [2J ## Injected was not read");
    expect(r.stderr).toContain("sibling: ghost'");
    for (const call of r.calls) {
      expect(call.prompt).not.toContain("\u001b");
      expect(call.prompt).not.toMatch(/^#{2,3} Injected/m);
    }
  });
});

describe("wachiman local: distributed-repo usage errors exit 2 before any call", () => {
  const refused = (r: ReturnType<typeof run>, text: RegExp) => {
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(text);
    expect(r.calls).toHaveLength(0);
    expect(existsSync(r.stub.canary)).toBe(false);
  };

  test("--sibling without the mode", () => {
    refused(run(site({ manifest: true, sibling: true }), ["--sibling", "desktop-app"]), /--sibling needs distributed-repo mode/);
  });

  test("--distributed-repo with --no-distributed-repo", () => {
    refused(run(site({ manifest: true, sibling: true }), ["--distributed-repo", "--no-distributed-repo"]), /cannot be used together/);
  });

  test("--sibling with --no-distributed-repo", () => {
    refused(run(site({ manifest: true, sibling: true }), ["--no-distributed-repo", "--sibling", "desktop-app"]), /--no-distributed-repo/);
  });

  test("a --sibling that is not a member of the manifest", () => {
    refused(run(site({ manifest: true, sibling: true }), ["--distributed-repo", "--sibling", "palette"]), /"palette" is not a member/);
  });

  test("--distributed-repo with no workspace around the repository", () => {
    refused(run(site({ sibling: true }), ["--distributed-repo"]), /found no workspace/);
  });
});

describe("wachiman local --distributed-repo: the result", () => {
  const json = (r: ReturnType<typeof run>) => JSON.parse(r.stdout);
  const NEW_KEYS = ["siblings", "workspaceContractsApplied", "noWorkspaceContractApplied", "privateContext", "removedSiblingReferences"];

  test("--format json writes result /2 without being asked, with the siblings, the contract and the private-context label", () => {
    const s = site({ manifest: true, sibling: true });
    const r = run(s, ["--distributed-repo", "--format", "json"]);
    expect(r.code).toBe(0);
    const result = json(r);
    expect(result.format).toBe("wachiman.review-result/2");
    expect(result.workspaceContractsApplied).toEqual(["brand-palette"]);
    expect(result).not.toHaveProperty("noWorkspaceContractApplied");
    expect(result.siblings).toHaveLength(1);
    const [row] = result.siblings;
    expect(row).toMatchObject({
      member: "desktop-app",
      repo: "acme/desktop-app",
      visibility: "private",
      status: "read",
      contracts: ["brand-palette"],
      ruleSource: "default",
    });
    expect(row.sha).toBe(git(s.desktopApp!, "rev-parse", "HEAD").trim());
    expect(row).not.toHaveProperty("dir");
    expect(r.stdout).not.toMatch(/wachiman-sibling|distributed-snapshot/);
    expect(result.privateContext).toEqual({ members: ["desktop-app"] });
    expect(result.removedSiblingReferences).toBe(0);
  });

  test("a sibling that is not cloned is a row with its status, and labels nothing", () => {
    const result = json(run(site({ manifest: true }), ["--distributed-repo", "--format", "json"]));
    expect(result.siblings.map((x: { member: string; status: string }) => [x.member, x.status])).toEqual([["desktop-app", "not-cloned"]]);
    expect(result).not.toHaveProperty("privateContext");
  });

  test("a change no contract covers says so in the result", () => {
    const s = site({ manifest: true, sibling: true });
    git(s.webSite, "reset", "-q", "--hard", "main");
    commit(s.webSite, { [OTHER]: "# readme\n\nOnly this.\n" }, "readme only");
    const result = json(run(s, ["--distributed-repo", "--format", "json", "--result-version", "2"]));
    expect(result.siblings).toEqual([]);
    expect(result.workspaceContractsApplied).toEqual([]);
    expect(result.noWorkspaceContractApplied).toBe(true);
  });

  test("a run that read no sibling and applied no contract writes /1 by default, with none of the new fields", () => {
    const s = site({ manifest: true, sibling: true });
    git(s.webSite, "reset", "-q", "--hard", "main");
    commit(s.webSite, { [OTHER]: "# readme\n\nOnly this.\n" }, "readme only");
    const result = json(run(s, ["--distributed-repo", "--format", "json"]));
    expect(result.format).toBe("wachiman.review-result/1");
    for (const key of NEW_KEYS) expect(result, key).not.toHaveProperty(key);
    expect(json(run(s, ["--distributed-repo", "--format", "json", "--result-version", "1"])).format).toBe("wachiman.review-result/1");
  });

  test("--result-version 1 when a sibling is read is exit 2 before any call, and names the way out", () => {
    const r = run(site({ manifest: true, sibling: true }), ["--distributed-repo", "--format", "json", "--result-version", "1"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/distributed-repo.*result \/1|result \/1.*distributed-repo/s);
    expect(r.stderr).toContain("--no-distributed-repo");
    expect(r.calls).toHaveLength(0);
    expect(r.stdout).toBe("");
  });

  test("the terminal and the Markdown report print the sibling line, the contract and the private-context line", () => {
    const s = site({ manifest: true, sibling: true });
    const sha = git(s.desktopApp!, "rev-parse", "HEAD").trim().slice(0, 7);
    for (const format of ["terminal", "markdown"]) {
      const r = run(s, ["--distributed-repo", "--format", format]);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain("Workspace contracts applied: brand-palette");
      expect(r.stdout).toContain(`desktop-app: rule `);
      expect(r.stdout).toContain(`commit ${sha}`);
      expect(r.stdout).toContain("Built with private context from: desktop-app. Do not paste its text into a public place.");
    }
    const missing = run(site({ manifest: true }), ["--distributed-repo"]);
    expect(missing.stdout).toContain("desktop-app: source of truth not cloned: not checked");
    expect(missing.stdout).not.toContain("private context");
  });

  test("without the mode the JSON is what it was: /1 by default, and /2 with none of the new fields", () => {
    const s = site({ manifest: true, sibling: true });
    const v1 = json(run(s, ["--format", "json"]));
    expect(v1.format).toBe("wachiman.review-result/1");
    const v2 = json(run(s, ["--format", "json", "--result-version", "2"]));
    expect(v2.format).toBe("wachiman.review-result/2");
    for (const key of NEW_KEYS) {
      expect(v1, key).not.toHaveProperty(key);
      expect(v2, key).not.toHaveProperty(key);
    }
  });

  test.each(["terminal", "markdown"])("without the mode the %s report prints none of it", (format) => {
    const text = run(site({ manifest: true, sibling: true }), ["--format", format]).stdout;
    expect(text.length).toBeGreaterThan(0);
    for (const word of ["ibling", "private context", "orkspace contract"]) expect(text, word).not.toContain(word);
  });
});
