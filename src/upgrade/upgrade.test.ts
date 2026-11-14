import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageError } from "../config";
import type { GitRunner } from "../evidence";
import type { InstallKind } from "../install-kind";
import { parseUpgradeArgs, planCliUpgrade, runUpgrade, type UpgradeDeps, type UpgradeOptions } from "./command";
import { classifyRef, rewritePins } from "./pin";

const scratch: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "wachiman-upgrade-"));
  scratch.push(dir);
  return dir;
};
afterAll(() => scratch.forEach((d) => rmSync(d, { recursive: true, force: true })));

const caller = (ref: string, extra = "") => `# header\r\nname: Wachiman\r\njobs:\r\n  review:\r\n    uses: niway-dev/wachiman/.github/workflows/review.yml@${ref} # keep\r\n${extra}    secrets: inherit\r\n`;

describe("rewritePins", () => {
  test("moves an older tag and keeps every other byte", () => {
    const text = caller("v1.2.0");
    const out = rewritePins(text, "v1.3.0");
    expect(out.text).toBe(text.replace("@v1.2.0", "@v1.3.0"));
    expect(out.outcomes).toEqual([{ kind: "rewritten", from: "v1.2.0" }]);
  });

  test("leaves a commit SHA, a branch, a floating tag and a newer tag alone", () => {
    for (const [ref, kind] of [["a".repeat(40), "sha"], ["main", "other"], ["v1", "other"], ["v1.2.0-rc.1", "other"], ["v2.0.0", "newer"]] as const) {
      const text = caller(ref);
      const out = rewritePins(text, "v1.3.0");
      expect(out.text).toBe(text);
      expect(out.outcomes[0].kind).toBe(kind);
    }
    expect(classifyRef("v1.3.0")).toBe("tag");
  });

  test("an equal pin is current, and a different action is never touched", () => {
    const text = "    uses: actions/checkout@v4\n    uses: niway-dev/wachiman/.github/workflows/review.yml@v1.3.0\n";
    expect(rewritePins(text, "v1.3.0")).toEqual({ text, outcomes: [{ kind: "current" }] });
  });

  test("handles several pins in one file, including list items and quotes", () => {
    const text = '- uses: "niway-dev/wachiman/.github/workflows/review.yml@v1.0.0"\n  uses: niway-dev/wachiman/.github/workflows/review-platform.yml@v1.1.0\n';
    const out = rewritePins(text, "v1.4.0");
    expect(out.text).toBe(text.replace("@v1.0.0", "@v1.4.0").replace("@v1.1.0", "@v1.4.0"));
    expect(out.outcomes).toHaveLength(2);
  });
});

describe("parseUpgradeArgs", () => {
  test("normalizes --to and refuses a bad version or --check with the others", () => {
    expect(parseUpgradeArgs(["--to", "1.2.3"], "/r")).toMatchObject({ to: "v1.2.3", check: false, repoOnly: false });
    expect(() => parseUpgradeArgs(["--to", "latest"], "/r")).toThrow(UsageError);
    expect(() => parseUpgradeArgs(["--check", "--repo-only"], "/r")).toThrow(UsageError);
    expect(() => parseUpgradeArgs(["now"], "/r")).toThrow(UsageError);
    expect(parseUpgradeArgs(["--help"], "/r")).toEqual({ help: true });
  });
});

describe("planCliUpgrade", () => {
  test("picks bun or npm from the package root, and refuses a clone and an executable", () => {
    const at = (root: string): InstallKind => ({ kind: "npm", root });
    expect(planCliUpgrade(at("/Users/me/.bun/install/global/node_modules/wachiman"))).toMatchObject({ command: "bun", args: ["add", "-g", "wachiman@latest"] });
    expect(planCliUpgrade(at("/usr/local/lib/node_modules/wachiman"))).toMatchObject({ command: "npm", args: ["install", "-g", "wachiman@latest"] });
    expect(planCliUpgrade({ kind: "source", root: "/code/wachiman" }).kind).toBe("refused");
    expect(planCliUpgrade({ kind: "exe", version: "1.0.0" }).kind).toBe("refused");
  });
});

interface Rig {
  repo: string;
  out: string[];
  err: string[];
  runs: string[];
  latestCalls: number;
  go: (opts: Partial<UpgradeOptions>, deps?: Partial<UpgradeDeps>) => number;
  read: (file: string) => string;
}

function rig(files: Record<string, string>, { inRepo = true }: { inRepo?: boolean } = {}): Rig {
  const repo = temp();
  mkdirSync(join(repo, ".github/workflows"), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(repo, ".github/workflows", name), text);
  const git: GitRunner = () => ({ status: inRepo ? 0 : 128, stdout: inRepo ? `${repo}\n` : "", stderr: "" }) as ReturnType<GitRunner>;
  const r: Rig = {
    repo, out: [], err: [], runs: [], latestCalls: 0,
    read: (file) => readFileSync(join(repo, ".github/workflows", file), "utf8"),
    go: (opts, deps = {}) =>
      runUpgrade(
        { repoDir: repo, check: false, repoOnly: false, ...opts },
        { stdout: (t) => r.out.push(t), stderr: (l) => r.err.push(l) },
        {
          version: "1.2.0",
          install: { kind: "npm", root: "/usr/lib/node_modules/wachiman" },
          git,
          run: (c, a) => (r.runs.push([c, ...a].join(" ")), 0),
          latest: () => (r.latestCalls++, "1.3.0"),
          ...deps,
        },
      ),
  };
  return r;
}

describe("runUpgrade", () => {
  test("upgrades the CLI with npm, rewrites the pins in several files, and prints the commit commands", () => {
    const a = caller("v1.2.0");
    const r = rig({ "a.yml": a, "b.yaml": caller("v1.1.0"), "ci.yml": "name: ci\non: push\n", "c.yml": caller("v1.2.0").replace("review.yml", "review-platform.yml") });
    expect(r.go({})).toBe(0);
    expect(r.runs).toEqual(["npm install -g wachiman@latest"]);
    expect(r.read("a.yml")).toBe(a.replace("@v1.2.0", "@v1.3.0"));
    expect(r.read("b.yaml")).toContain("review.yml@v1.3.0");
    expect(r.read("c.yml")).toContain("review-platform.yml@v1.3.0");
    expect(r.read("ci.yml")).toBe("name: ci\non: push\n");
    const text = r.out.join("");
    expect(text).toContain("git add .github/workflows/a.yml .github/workflows/b.yaml .github/workflows/c.yml");
    expect(text).toContain('git commit -m "chore: pin Wachiman to v1.3.0"');
  });

  test("a bun global install runs bun", () => {
    const r = rig({ "a.yml": caller("v1.2.0") });
    r.go({}, { install: { kind: "npm", root: "/Users/me/.bun/install/global/node_modules/wachiman" } });
    expect(r.runs).toEqual(["bun add -g wachiman@latest"]);
  });

  test("--check reports both versions, installs nothing and writes nothing", () => {
    const a = caller("v1.2.0");
    const r = rig({ "a.yml": a });
    expect(r.go({ check: true })).toBe(0);
    expect(r.runs).toEqual([]);
    expect(r.read("a.yml")).toBe(a);
    expect(r.out.join("")).toContain("Installed: v1.2.0");
    expect(r.out.join("")).toContain("Latest:    v1.3.0");
    expect(rig({}).go({ check: true }, { latest: () => undefined })).toBe(1);
  });

  test("--repo-only pins the installed version and never runs a package manager or asks the registry", () => {
    const r = rig({ "a.yml": caller("v1.0.0") });
    expect(r.go({ repoOnly: true })).toBe(0);
    expect(r.runs).toEqual([]);
    expect(r.latestCalls).toBe(0);
    expect(r.read("a.yml")).toContain("review.yml@v1.2.0");
  });

  test("a clone is not upgraded and its pins stay unless --to is given", () => {
    const a = caller("v1.0.0");
    const r = rig({ "a.yml": a });
    const source = { install: { kind: "source", root: "/code/wachiman" } as InstallKind };
    expect(r.go({}, source)).toBe(0);
    expect(r.runs).toEqual([]);
    expect(r.read("a.yml")).toBe(a);
    expect(r.out.join("")).toContain("git pull");
    expect(r.out.join("")).toContain("--repo-only");
    expect(r.go({ to: "v1.1.0" }, source)).toBe(0);
    expect(r.read("a.yml")).toContain("@v1.1.0");
  });

  test("a failed install exits 1 and skips the pins, or uses --to", () => {
    const a = caller("v1.0.0");
    const r = rig({ "a.yml": a });
    expect(r.go({}, { run: () => 1 })).toBe(1);
    expect(r.read("a.yml")).toBe(a);
    expect(r.out.join("")).toContain("not touched");
    expect(r.go({ to: "v1.3.0" }, { run: () => 1 })).toBe(1);
    expect(r.read("a.yml")).toContain("@v1.3.0");
  });

  test("no registry answer and no --to changes nothing", () => {
    const r = rig({ "a.yml": caller("v1.0.0") });
    expect(r.go({}, { latest: () => undefined })).toBe(1);
    expect(r.runs).toEqual([]);
  });

  test("an up-to-date CLI installs nothing and still moves the pins", () => {
    const r = rig({ "a.yml": caller("v1.0.0") });
    expect(r.go({}, { latest: () => "1.2.0" })).toBe(0);
    expect(r.runs).toEqual([]);
    expect(r.read("a.yml")).toContain("@v1.2.0");
  });

  test("a SHA, a branch and a newer pin are reported and left alone", () => {
    const files = { "a.yml": caller("a".repeat(40)), "b.yml": caller("main"), "c.yml": caller("v9.0.0") };
    const r = rig(files);
    expect(r.go({})).toBe(0);
    for (const [name, text] of Object.entries(files)) expect(r.read(name)).toBe(text);
    const text = r.out.join("");
    expect(text).toContain("No pin needed a change");
    expect(text).toContain("never downgraded");
    expect(text).toContain("not a release tag");
    expect(text).toContain("the commit aaaaaaaaaaaa");
    expect(text).not.toContain("git commit");
  });

  test("outside a git repository the pins are skipped with the reason", () => {
    const r = rig({ "a.yml": caller("v1.0.0") }, { inRepo: false });
    expect(r.go({})).toBe(0);
    expect(r.out.join("")).toContain("is not a git repository");
    expect(r.read("a.yml")).toContain("@v1.0.0");
  });
});
