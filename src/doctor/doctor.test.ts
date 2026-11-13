import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageError } from "../config";
import { repositoryKey } from "../history/store";
import { fakeToolchain, signedIn, type RecordedCall, type Tools } from "../../test/support/fake-toolchain";
import { emptyRepo, git, removeTempRepos, write } from "../../test/support/temp-repo";
import { buildDoctorReport, parseDoctorArgs, runDoctor, type DoctorDeps } from "./run";
import { redactReport, renderJson, renderText } from "./render";
import { tierOf, type DoctorReport, type DoctorRow } from "./checks";

const scratch: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
};
afterAll(() => {
  scratch.forEach((d) => rmSync(d, { recursive: true, force: true }));
  removeTempRepos();
});

const ROWS = ["wachiman", "bun", "git", "tar", "config", "profile", "auth", "environment", "project", "settings", "history", "skills", "isolation"];

interface Machine {
  home: string;
  userHome: string;
  env: Record<string, string>;
  deps: DoctorDeps;
  calls: RecordedCall[];
  report: (opts?: Partial<Parameters<typeof buildDoctorReport>[0]>, env?: Record<string, string>) => ReturnType<typeof buildDoctorReport>;
}

/** A machine fixture: temp Wachiman and user homes and a fake toolchain; no real claude, git, bun or tar is started. */
function machine(tools: Tools = {}, extra: Partial<DoctorDeps> = {}): Machine {
  const home = join(temp("wachiman-doctor-"), ".wachiman");
  const userHome = temp("wachiman-doctor-user-");
  const env = { PATH: "/usr/bin", HOME: userHome, USER: "me", WACHIMAN_HOME: home };
  const { spawn, calls } = fakeToolchain(tools);
  const deps: DoctorDeps = {
    spawn,
    install: { kind: "source", root: "/opt/wachiman" },
    version: "1.9.0",
    platform: "darwin",
    arch: "arm64",
    userHome,
    ...extra,
  };
  const m: Machine = {
    home,
    userHome,
    env,
    deps,
    calls,
    report: (opts = {}, e = {}) => buildDoctorReport({ repoDir: temp("wachiman-cwd-"), allProfiles: false, json: true, redactPaths: false, ...opts }, { ...env, ...e }, deps),
  };
  return m;
}

const row = (report: { checks: DoctorRow[] }, id: string) => report.checks.find((r) => r.id === id)!;
const seed = (m: Machine, config: object) => {
  mkdirSync(m.home, { recursive: true });
  writeFileSync(join(m.home, "config.json"), JSON.stringify({ version: 1, profiles: {}, projects: {}, ...config }));
};

describe("doctor on a healthy machine", () => {
  test("every row is present, in order, the auth row says the network is unobserved, and the exit code is 0", () => {
    const m = machine();
    const report = m.report();
    expect(report.format).toBe("wachiman.doctor/1");
    expect(report.checks.map((r) => r.id)).toEqual(ROWS);
    expect(report.version).toBe("1.9.0");
    expect(report.install).toBe("source");
    expect(report.platform).toBe("darwin-arm64");
    expect(report.tier).toBe("supported");
    expect(report.profile).toEqual({ name: "default", kind: "default", rung: "builtIn" });
    expect(row(report, "auth")).toMatchObject({ level: "required", status: "ok", detail: { networkObserved: "unknown", authMethod: "claude.ai" } });
    expect(report.failedRequired).toBe(0);
    expect(report.exitCode).toBe(0);
    for (const r of report.checks) if (r.level === "required") expect(r.status).not.toBe("fail");
  });

  test("the account e-mail and the raw auth JSON never reach the report", () => {
    const m = machine();
    const text = renderJson(m.report());
    expect(text).not.toContain("me@example.com");
    expect(text).not.toContain("loggedIn");
  });

  test("a subprocess runs with the allowlisted environment, never with the API key, and git never runs in the repository", () => {
    const m = machine();
    const repo = emptyRepo();
    const report = m.report({ repoDir: repo }, { ANTHROPIC_API_KEY: "sk-ant-secret", GH_TOKEN: "ghp_secret" });
    expect(row(report, "environment").status).toBe("fail");
    for (const call of m.calls) {
      expect(call.env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(call.env.GH_TOKEN).toBeUndefined();
      expect(call.cwd).not.toBe(repo);
    }
    expect(JSON.stringify(report)).not.toContain("sk-ant-secret");
  });

  test("no Wachiman network request: fetch is stubbed to throw while doctor runs", () => {
    const real = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("network used");
    }) as unknown as typeof fetch;
    try {
      expect(machine().report().exitCode).toBe(0);
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe("required checks that fail turn the exit code to 1", () => {
  test("ANTHROPIC_API_KEY set: the environment row fails with the reason, and only the presence is reported", () => {
    const report = machine().report({}, { ANTHROPIC_API_KEY: "sk-ant-secret" });
    expect(row(report, "environment")).toMatchObject({ status: "fail", level: "required" });
    expect(row(report, "environment").evidence).toContain("ANTHROPIC_API_KEY");
    expect(row(report, "environment").evidence).toContain("refused");
    expect(report.failedRequired).toBe(1);
    expect(report.exitCode).toBe(1);
  });

  test("a missing tar, an old bun and an old git each fail their own row", () => {
    expect(row(machine({ tar: null }).report(), "tar").status).toBe("fail");
    expect(machine({ tar: null }).report().exitCode).toBe(1);
    const old = machine({ bun: "1.2.9", git: "git version 2.20.1" }).report();
    expect(row(old, "bun")).toMatchObject({ status: "fail" });
    expect(row(old, "git")).toMatchObject({ status: "fail" });
    expect(old.failedRequired).toBe(2);
    expect(row(machine({ git: "git version 2.39.5 (Apple Git-154)" }).report(), "git").status).toBe("ok");
  });

  test("a compiled executable skips the bun row and is not counted", () => {
    const report = machine({ bun: null }, { install: { kind: "exe", version: "1.9.0" } }).report();
    expect(row(report, "bun").status).toBe("skip");
    expect(report.install).toBe("exe");
    expect(report.exitCode).toBe(0);
  });

  test("signed out, an API-key sign-in and a binary that cannot report its directory fail the auth row with the fix", () => {
    const dir = temp("claude-work-");
    const run = (auth: (d: string | undefined) => { status: number; stdout: string }) => {
      const m = machine({ auth });
      seed(m, { profiles: { "work-a": { kind: "external", configDir: dir, createdAt: "t" } } });
      return m.report({ profile: "work-a" });
    };
    const signedOut = run(() => ({ status: 1, stdout: JSON.stringify({ loggedIn: false }) }));
    expect(row(signedOut, "auth")).toMatchObject({ status: "fail", fix: expect.stringContaining("wachiman profile login work-a") });
    expect(signedOut.exitCode).toBe(1);
    const apiKey = run((d) => signedIn(d, { authMethod: "api_key" }));
    expect(row(apiKey, "auth")).toMatchObject({ status: "fail", detail: { authMethod: "api_key", networkObserved: "unknown" } });
    const unverified = run(() => signedIn(undefined));
    expect(row(unverified, "auth").status).toBe("fail");
    expect(row(unverified, "auth").evidence).toContain("unverified");
    expect(row(unverified, "profile").status).toBe("ok");
  });

  test("a binary that does not answer --version fails the profile row and skips auth", () => {
    const m = machine({ claudeVersion: null });
    const report = m.report();
    expect(row(report, "profile").status).toBe("fail");
    expect(row(report, "auth")).toMatchObject({ status: "skip", detail: { networkObserved: "unknown" } });
    expect(report.failedRequired).toBe(1);
  });
});

describe("settings row: the repository's .wachiman.yml", () => {
  const settingsRow = (m: Machine, repo: string, env: Record<string, string> = {}) => row(m.report({ repoDir: repo }, env), "settings");

  test("outside a git working tree the row is skipped", () => {
    expect(row(machine().report(), "settings").status).toBe("skip");
  });

  test("no file: ok, with the defaults named as the source of the model and the effort", () => {
    const r = settingsRow(machine(), emptyRepo());
    expect(r).toMatchObject({ level: "optional", status: "ok", detail: { file: null, valid: true, effectiveModel: "claude-sonnet-5-5", modelFrom: "default", effectiveEffort: "high", effortFrom: "default" } });
    expect(r.evidence).toContain("no .wachiman.yml");
    expect(r.evidence).toContain("base commit");
  });

  test("a file with model and effort: they are reported and win over the defaults", () => {
    const repo = emptyRepo();
    write(repo, { ".wachiman.yml": "kind: monorepo\nmodel: claude-opus-5-5\neffort: medium\n" });
    const r = settingsRow(machine(), repo);
    expect(r).toMatchObject({
      status: "ok",
      detail: { kind: "monorepo", model: "claude-opus-5-5", effort: "medium", effectiveModel: "claude-opus-5-5", modelFrom: "file", effectiveEffort: "medium", effortFrom: "file" },
    });
    expect(r.evidence).toContain("from .wachiman.yml");
  });

  test("an explicit WACHIMAN_MODEL / WACHIMAN_EFFORT wins over the file and is reported as the environment", () => {
    const repo = emptyRepo();
    write(repo, { ".wachiman.yml": "model: claude-opus-5-5\neffort: medium\n" });
    const r = settingsRow(machine(), repo, { WACHIMAN_MODEL: "claude-haiku-5-5", WACHIMAN_EFFORT: "max" });
    expect(r.detail).toMatchObject({ effectiveModel: "claude-haiku-5-5", modelFrom: "env", effectiveEffort: "max", effortFrom: "env", model: "claude-opus-5-5" });
  });

  test("an invalid file is a required failure with the fix, and the exit code is 1", () => {
    const repo = emptyRepo();
    write(repo, { ".wachiman.yml": "effort: turbo\n" });
    const m = machine();
    const report = m.report({ repoDir: repo });
    expect(row(report, "settings")).toMatchObject({ level: "required", status: "fail", detail: { valid: false } });
    expect(row(report, "settings").evidence).toContain('got "turbo"');
    expect(row(report, "settings").fix).toContain("remove it");
    expect(row(report, "settings").evidence).toContain("the working copy of .wachiman.yml is invalid");
    expect(row(report, "settings").evidence).toContain("takes effect once committed and merged");
    expect(row(report, "settings").evidence).not.toContain("stops");
    expect(report.failedRequired).toBe(1);
    expect(report.exitCode).toBe(1);
  });

  test("the old .github/wachiman.yml is a warning whose fix is git mv, and nothing is moved", () => {
    const repo = emptyRepo();
    write(repo, { ".github/wachiman.yml": "kind: single\n" });
    const r = settingsRow(machine(), repo);
    expect(r).toMatchObject({ status: "warn", level: "optional", fix: "git mv .github/wachiman.yml .wachiman.yml" });
    expect(r.evidence).toContain("never read");
    expect(existsSync(join(repo, ".github", "wachiman.yml"))).toBe(true);
    expect(existsSync(join(repo, ".wachiman.yml"))).toBe(false);
  });

  test("with both files the fix is to merge, since git mv would overwrite the root file", () => {
    const repo = emptyRepo();
    write(repo, { ".github/wachiman.yml": "kind: single\n", ".wachiman.yml": "kind: monorepo\n" });
    expect(settingsRow(machine(), repo).fix).toContain("merge");
  });

  test("a subfolder of the working tree finds the file at the root", () => {
    const repo = emptyRepo();
    write(repo, { ".wachiman.yml": "effort: low\n", "pkg/a.txt": "x" });
    expect(row(machine().report({ repoDir: join(repo, "pkg") }), "settings").detail).toMatchObject({ effectiveEffort: "low", effortFrom: "file" });
  });
});

describe("configuration, profile and project rows", () => {
  test("no config file is ok; a corrupt one fails naming the field and the profile rows are skipped", () => {
    const m = machine();
    expect(row(m.report(), "config")).toMatchObject({ status: "ok", evidence: expect.stringContaining("no profiles registered") });
    mkdirSync(m.home, { recursive: true });
    writeFileSync(join(m.home, "config.json"), JSON.stringify({ version: 2, profiles: {}, projects: {} }));
    const report = m.report();
    expect(row(report, "config")).toMatchObject({ status: "fail", evidence: expect.stringContaining("version") });
    expect(row(report, "profile").status).toBe("skip");
    expect(row(report, "auth").status).toBe("skip");
    expect(row(report, "isolation").status).toBe("skip");
    expect(report.failedRequired).toBe(1);
  });

  test("the profile row names the rung, a binding beats WACHIMAN_PROFILE, and the ignored value is not printed", () => {
    const m = machine();
    const dir = temp("claude-work-");
    const other = temp("claude-other-");
    const repo = emptyRepo();
    git(repo, "remote", "add", "origin", "https://user:pw@github.com/acme/app.git");
    const key = repositoryKey(repo).key;
    seed(m, {
      profiles: {
        "work-a": { kind: "external", configDir: dir, createdAt: "t" },
        "ignored-profile": { kind: "external", configDir: other, createdAt: "t" },
      },
      projects: { [key]: { profile: "work-a", keyedBy: "remote", remote: "ssh://github.com/acme/app", name: "app", boundAt: "t", boundFrom: repo } },
    });
    const report = m.report({ repoDir: repo }, { WACHIMAN_PROFILE: "ignored-profile" });
    expect(report.profile).toEqual({ name: "work-a", kind: "external", rung: "binding" });
    expect(row(report, "profile").evidence).toContain("project binding");
    expect(row(report, "auth").status).toBe("ok");
    expect(row(report, "project")).toMatchObject({ status: "ok", detail: { key, bound: true, profile: "work-a" } });
    expect(row(report, "environment").evidence).toContain("WACHIMAN_PROFILE");
    expect(row(report, "environment").evidence).toContain("ignored");
    expect(JSON.stringify(report)).not.toContain("ignored-profile");
    expect(JSON.stringify(report)).not.toContain("user:pw");
    expect(row(report, "isolation")).toMatchObject({ status: "warn", level: "optional" });
    expect(report.exitCode).toBe(0);
  });

  test("a repository without a binding is reported as not bound; outside a repository the project row is skipped", () => {
    const m = machine();
    const repo = emptyRepo();
    expect(row(m.report({ repoDir: repo }), "project")).toMatchObject({ status: "ok", detail: { bound: false } });
    expect(row(m.report(), "project").status).toBe("skip");
  });

  test("CLAUDE_CONFIG_DIR exported is a warning for the default profile only, and a warning never fails the run", () => {
    const m = machine();
    const warn = m.report({}, { CLAUDE_CONFIG_DIR: "/somewhere" });
    expect(row(warn, "environment").status).toBe("warn");
    expect(warn.exitCode).toBe(0);
    const dir = temp("claude-work-");
    seed(m, { profiles: { "work-a": { kind: "external", configDir: dir, createdAt: "t" } } });
    expect(row(m.report({ profile: "work-a" }, { CLAUDE_CONFIG_DIR: "/somewhere" }), "environment").status).toBe("ok");
  });

  test("a name that resolves to nothing fails the profile row (exit 1), not a usage error", () => {
    const report = machine().report({ profile: "ghost" });
    expect(row(report, "profile")).toMatchObject({ status: "fail", fix: expect.stringContaining("wachiman profile list") });
    expect(row(report, "auth").status).toBe("skip");
    expect(report.exitCode).toBe(1);
  });

  test("a managed profile is inspected (required): a populated one fails, a clean one passes", () => {
    const m = machine();
    const dir = join(m.home, "claude-scratch");
    mkdirSync(dir, { recursive: true });
    seed(m, { profiles: { scratch: { kind: "managed", configDir: dir, createdAt: "t" } } });
    const clean = m.report({ profile: "isolated:scratch" });
    expect(row(clean, "isolation")).toMatchObject({ status: "ok", level: "required" });
    writeFileSync(join(dir, "CLAUDE.md"), "rules");
    const populated = m.report({ profile: "isolated:scratch" });
    // The remediation appears once, in `fix`, not also inside the evidence (asserted before toMatchObject, which rewrites the received row).
    const { evidence, fix } = row(populated, "isolation");
    expect(evidence).not.toContain("use another profile name");
    expect(fix).toContain("use another profile name");
    expect(row(populated, "isolation")).toMatchObject({ status: "fail", level: "required", evidence: expect.stringContaining("CLAUDE.md") });
    expect(populated.exitCode).toBe(1);
  });

  test("a managed profile whose directory is missing skips the isolation row instead of claiming it holds only a sign-in", () => {
    const m = machine();
    const dir = join(m.home, "claude-gone");
    seed(m, { profiles: { gone: { kind: "managed", configDir: dir, createdAt: "t" } } });
    const report = m.report({ profile: "isolated:gone" });
    expect(row(report, "profile").status).toBe("fail");
    expect(row(report, "isolation").status).toBe("skip");
    expect(row(report, "isolation").evidence).not.toContain("holds only a sign-in");
    expect(report.exitCode).toBe(1);
  });

  test("the history row counts repositories and warns about a directory open to other users", () => {
    const m = machine();
    expect(row(m.report(), "history").status).toBe("skip");
    const history = join(m.home, "history");
    mkdirSync(join(history, "app-aaaaaaaa"), { recursive: true });
    mkdirSync(join(history, "lib-bbbbbbbb"));
    chmodSync(history, 0o700);
    expect(row(m.report(), "history")).toMatchObject({ status: "ok", detail: { repositories: 2 } });
    chmodSync(history, 0o755);
    expect(row(m.report(), "history").status).toBe("warn");
  });

  test("the skills row reports where the skills are installed", () => {
    const m = machine();
    expect(row(m.report(), "skills").status).toBe("skip");
    mkdirSync(join(m.userHome, ".claude", "skills", "wachiman-review"), { recursive: true });
    const report = m.report();
    expect(row(report, "skills")).toMatchObject({ status: "ok", detail: { "wachiman-review": true, "wachiman-loop": false, "wachiman-audit": false } });
  });
});

describe("--all-profiles", () => {
  test("repeats the profile, auth and isolation rows for every registered profile and managed directory", () => {
    const m = machine();
    const dir = temp("claude-work-");
    seed(m, { profiles: { "work-a": { kind: "external", configDir: dir, createdAt: "t" } } });
    mkdirSync(join(m.home, "claude-scratch"), { recursive: true });
    const report = m.report({ allProfiles: true });
    const per = (id: string) => report.checks.filter((r) => r.id === id).map((r) => r.detail?.profile);
    expect(per("profile")).toEqual(["work-a", "scratch"]);
    expect(per("auth")).toEqual(["work-a", "scratch"]);
    expect(per("isolation")).toEqual(["work-a", "scratch"]);
    expect(report.checks.filter((r) => r.id === "git").length).toBe(1);
  });

  test("--profile and --all-profiles together are a usage error", () => {
    expect(() => parseDoctorArgs(["--profile", "x", "--all-profiles"], "/r")).toThrow(UsageError);
    expect(parseDoctorArgs(["--json", "--redact-paths", "--profile=work-a"], "/r")).toEqual({
      repoDir: "/r",
      profile: "work-a",
      allProfiles: false,
      json: true,
      redactPaths: true,
    });
    expect(parseDoctorArgs(["--help"], "/r")).toEqual({ help: true });
    expect(() => parseDoctorArgs(["--nope"], "/r")).toThrow(UsageError);
    expect(() => parseDoctorArgs(["extra"], "/r")).toThrow(UsageError);
    expect(() => parseDoctorArgs(["--profile", "Not A Name"], "/r")).toThrow(UsageError);
  });
});

describe("--redact-paths", () => {
  test("complete paths and origin URLs become stable placeholders in both outputs; a home prefix replaced by ~ would not be redaction", () => {
    const m = machine();
    const dir = temp("claude-work-");
    const repo = emptyRepo();
    git(repo, "remote", "add", "origin", "https://github.com/acme/app.git");
    const key = repositoryKey(repo).key;
    seed(m, {
      profiles: { "work-a": { kind: "external", configDir: dir, createdAt: "t" } },
      projects: { [key]: { profile: "work-a", keyedBy: "remote", remote: "ssh://github.com/acme/app", name: "app", boundAt: "t", boundFrom: repo } },
    });
    mkdirSync(join(m.home, "history", "app-aaaaaaaa"), { recursive: true });
    const plain = m.report({ repoDir: repo });
    const redacted = m.report({ repoDir: repo, redactPaths: true });
    const json = renderJson(redacted);
    const text = renderText(redacted);
    expect(JSON.stringify(plain)).toContain(dir);
    for (const secret of [dir, m.home, m.userHome, repo, "github.com/acme"]) {
      expect(json).not.toContain(secret);
      expect(text).not.toContain(secret);
    }
    expect(json).toMatch(/<home-path-\d+>/);
    // Stable: the placeholder of the profile directory is the same wherever that directory appears.
    const placeholder = row(redacted, "profile").evidence.match(/<external-path-\d+>/)![0];
    expect(row(redacted, "profile").detail?.directory).toBe(placeholder);
    expect(row(redacted, "auth").evidence).not.toContain(dir);
    expect(JSON.stringify(plain).split(dir).length).toBeGreaterThan(2);
  });
});

describe("--redact-paths with a space in the home", () => {
  test("a known root is replaced whole, so the rest of the path is not left behind", () => {
    const userHome = "/Users/Jane Doe";
    const home = `${userHome}/.wachiman`;
    const row = { id: "wachiman", level: "required", status: "ok", evidence: `config ${home}/config.json and ${userHome}/proj, plain /opt/x`, detail: { path: `${home}/config.json` } };
    const report = { format: "wachiman.doctor/1", version: "1", install: "source", platform: "x", tier: 0, checks: [row], failedRequired: 0, exitCode: 0 } as unknown as DoctorReport;
    const out = JSON.stringify(redactReport(report, { home, userHome }));
    expect(out).not.toContain("Doe");
    expect(out).not.toContain("config.json");
    expect(out).toContain("<home-path-1> and <home-path-2>");
    expect(out).toContain("<external-path-1>");
  });
});

describe("tiers and text output", () => {
  test("tiers follow the platform", () => {
    expect(tierOf("darwin", "arm64")).toBe("supported");
    expect(tierOf("darwin", "x64")).toBe("supported");
    expect(tierOf("linux", "x64")).toBe("supported");
    expect(tierOf("win32", "x64")).toBe("built-and-smoke-tested");
    expect(tierOf("linux", "arm64")).toBe("built-untested");
  });

  test("the text output has the header, the promise, Required and Optional sections, marks and the failure count", () => {
    const m = machine({ tar: null });
    const text = renderText(m.report());
    const lines = text.split("\n");
    expect(lines[0]).toBe("Wachiman 1.9.0 (source, /opt/wachiman, darwin-arm64, tier supported)");
    expect(text).toContain("Local mode: no telemetry and no GitHub requests by Wachiman; the code goes to the Claude account of the chosen profile. https://code.claude.com/docs/en/legal-and-compliance");
    expect(text.indexOf("Required")).toBeLessThan(text.indexOf("Optional"));
    expect(text).toMatch(/✗ tar /);
    expect(text).toMatch(/✓ git /);
    expect(text).toMatch(/· skills /);
    expect(text).toContain("1 required check(s) failed.");
    expect(renderText(machine().report())).not.toContain("failed.");
  });

  test("--json prints exactly the report, and runDoctor returns its exit code", () => {
    const m = machine({ tar: null });
    const out: string[] = [];
    const code = runDoctor({ repoDir: temp("wachiman-cwd-"), allProfiles: false, json: true, redactPaths: false }, m.env, { stdout: (t) => out.push(t), stderr: () => {} }, m.deps);
    expect(code).toBe(1);
    const parsed = JSON.parse(out.join(""));
    expect(parsed.exitCode).toBe(1);
    expect(parsed.checks.map((r: DoctorRow) => r.id)).toEqual(ROWS);
  });
});
