import { describe, expect, test } from "bun:test";
import { buildSummary, languagesOf, roundTwoFigures, serialiseSummary, SUMMARY_KEYS, type TelemetryRun } from "./summary";

const ID = "7b0f3a52-7f0e-4b0e-9d6a-1f2f3a4b5c6d";
const NOW = new Date("2026-11-26T23:59:59Z");
const base: TelemetryRun = {
  mode: "local",
  model: "claude-opus-4-5",
  files: [
    { filename: "src/a.ts", additions: 120, deletions: 4 },
    { filename: "src/b.ts", additions: 3, deletions: 0 },
    { filename: "README.md", additions: 1, deletions: 1 },
  ],
  chunks: { planned: 3, completed: 2 },
  usage: { input: 1000, output: 250, cacheRead: 9000, cacheWrite: 0 },
  durationMs: 61_400,
  outcome: "partial",
  retries: 1,
  error: null,
  severities: ["blocker", "fix", "fix", "info"],
  distributed: false,
};
const build = (run: Partial<TelemetryRun> = {}) => buildSummary({ ...base, ...run }, { installation: ID, version: "1.21.0", now: NOW });

describe("buildSummary", () => {
  test("is exactly the documented document", () => {
    expect(build()).toEqual({
      format: "wachiman.telemetry/1",
      installation: ID,
      version: "1.21.0",
      mode: "local",
      model: "opus",
      diff: { files: 3, added: 120, removed: 5 },
      chunks: { planned: 3, completed: 2 },
      tokens: { input: 1000, output: 250, cache_read: 9000, cache_write: null },
      duration_s: 61,
      outcome: { state: "partial", retries: 1 },
      error: null,
      findings: { blocker: 1, fix: 2, consider: 0, info: 1 },
      languages: ["typescript", "markdown"],
      layout: "unknown",
      day: "2026-11-26",
    });
  });

  test("its keys are the SUMMARY_KEYS the contract page is checked against", () => {
    expect(Object.keys(build()).sort()).toEqual([...SUMMARY_KEYS].sort());
  });

  test("rounds diff sizes to two significant figures and never goes negative", () => {
    expect([0, 7, 99, 100, 124, 125, 1234, 99_999, 123_456].map(roundTwoFigures)).toEqual([0, 7, 99, 100, 120, 130, 1200, 100_000, 120_000]);
    expect([-5, Number.NaN, Infinity, 2.6].map(roundTwoFigures)).toEqual([0, 0, 0, 3]);
    const s = build({ files: [{ filename: "a.ts", additions: 1234, deletions: 56_789 }] });
    expect(s.diff).toEqual({ files: 1, added: 1200, removed: 57_000 });
  });

  test("tokens the provider did not give are null, never 0", () => {
    expect(build({ usage: undefined }).tokens).toEqual({ input: null, output: null, cache_read: null, cache_write: null });
    expect(build({ usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }).tokens).toEqual({
      input: null,
      output: null,
      cache_read: null,
      cache_write: null,
    });
  });

  test("model keeps the family only", () => {
    for (const [model, family] of [
      ["claude-opus-4-5", "opus"],
      ["Claude-Sonnet-5", "sonnet"],
      ["haiku", "haiku"],
      ["gpt-5-codex", "other"],
      ["my-private-model-for-acme", "other"],
      ["", "other"],
    ] as const)
      expect(build({ model }).model).toBe(family);
  });

  test("duration is whole seconds, findings use the engine's severity keys and ignore any other", () => {
    expect(build({ durationMs: 499 }).duration_s).toBe(0);
    expect(build({ durationMs: -3 }).duration_s).toBe(0);
    expect(build({ severities: ["blocker", "octocat", "fix"] }).findings).toEqual({ blocker: 1, fix: 1, consider: 0, info: 0 });
  });

  test("layout is distributed only when the run read siblings", () => {
    expect(build({ distributed: true }).layout).toBe("distributed");
    expect(build({ distributed: false }).layout).toBe("unknown");
  });

  test("day is the UTC date, with no time", () => {
    const late = buildSummary(base, { installation: ID, version: "1.21.0", now: new Date("2026-11-26T23:30:00-05:00") });
    expect(late.day).toBe("2026-11-27");
  });

  test("a version that is not a version number is sent as unknown", () => {
    expect(buildSummary(base, { installation: ID, version: "octocat@example.com", now: NOW }).version).toBe("unknown");
    expect(buildSummary(base, { installation: ID, version: "1.21.0-rc.1", now: NOW }).version).toBe("1.21.0-rc.1");
  });
});

describe("languagesOf", () => {
  test("names at most five languages from the fixed table, most changed files first, then by name", () => {
    const files = ["a.ts", "b.ts", "c.py", "d.go", "e.rs", "f.java", "g.rb", "h.kt"].map((filename) => ({ filename }));
    expect(languagesOf(files)).toEqual(["typescript", "go", "java", "kotlin", "python"]);
  });

  test("uses the extension only: a path, a dotfile or an unknown extension adds nothing", () => {
    const files = ["/home/octocat/acme-secret/Makefile", ".gitignore", "notes.octocat@example.com", "src/x.TS", "weird.ts/"].map((filename) => ({ filename }));
    expect(languagesOf(files)).toEqual(["typescript"]);
  });
});

describe("what is never in a summary", () => {
  const MARKERS = ["octocat-login", "someone@example.com", "acme-secret-repo", "ghp_abcdefghijklmnopqrstuvwxyz0123456789", "/Users/jane/work", "api.internal.acme"];
  test("markers placed in every place a run could carry them do not appear", () => {
    const hostile = {
      ...base,
      files: [
        { filename: `/Users/jane/work/acme-secret-repo/src/app.ts`, additions: 5, deletions: 1, patch: "+ ghp_abcdefghijklmnopqrstuvwxyz0123456789", sha: "abc" },
        { filename: "docs/octocat-login.someone@example.com", additions: 1, deletions: 0 },
      ],
      model: "claude-opus-4-5 acme-secret-repo",
      repository: { name: "acme-secret-repo", url: "https://api.internal.acme/acme-secret-repo.git" },
      author: "octocat-login",
      email: "someone@example.com",
      env: { GH_TOKEN: "ghp_abcdefghijklmnopqrstuvwxyz0123456789", USER: "octocat-login", HOME: "/Users/jane/work" },
      remote: "git@github.com:octocat-login/acme-secret-repo.git",
      rejection: { kind: "auth", text: "token ghp_abcdefghijklmnopqrstuvwxyz0123456789 rejected for someone@example.com" },
    } as unknown as TelemetryRun;
    const summary = buildSummary(hostile, { installation: ID, version: "1.21.0", now: NOW });
    const text = JSON.stringify(summary);
    for (const marker of MARKERS) expect(text).not.toContain(marker);
    expect(Object.keys(summary).sort()).toEqual([...SUMMARY_KEYS].sort());
    expect(summary.languages).toEqual(["typescript"]);
  });
});

describe("serialiseSummary", () => {
  test("returns the JSON of a normal summary, and nothing for one over 4096 bytes", () => {
    const text = serialiseSummary(build());
    expect(text).not.toBeNull();
    expect(Buffer.byteLength(text!)).toBeLessThan(4096);
    const big = { ...build(), version: "x".repeat(5000) };
    expect(serialiseSummary(big)).toBeNull();
  });
});
