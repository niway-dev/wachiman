import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { UsageError } from "../config";
import type { ProjectBinding, WachimanConfigV1 } from "./config";
import { failureText, parseProfileRef, profileLine, resolveProfile, type Rung } from "./resolve";

const home = "/wh";
const config: WachimanConfigV1 = {
  version: 1,
  profiles: {
    personal: { kind: "managed", configDir: join(home, "claude-personal"), createdAt: "t" },
    "work-a": { kind: "external", configDir: "/Users/me/.claude-work-a", binary: "/opt/claude/claude", createdAt: "t" },
    "work-b": { kind: "external", configDir: "/Users/me/.claude-work-b", createdAt: "t" },
  },
  projects: {},
};
const binding = (profile: string): ProjectBinding => ({ profile, keyedBy: "path", name: "r", boundAt: "t", boundFrom: "/x" });
const MANAGED_DIRS = ["legacy", "isolated"];

interface Values {
  flag?: string;
  binding?: string;
  env?: string;
  configDefault?: string;
}
function run(values: Values, ...rest: [WachimanConfigV1 | undefined] | []) {
  const cfg = rest.length > 0 ? rest[0] : config;
  return resolveProfile({
    flag: values.flag,
    binding: values.binding === undefined ? undefined : binding(values.binding),
    env: { WACHIMAN_PROFILE: values.env },
    config: cfg && values.configDefault !== undefined ? { ...cfg, defaultProfile: values.configDefault } : cfg,
    managedDirExists: (name) => MANAGED_DIRS.includes(name),
    home,
  });
}

const RUNGS: Rung[] = ["flag", "binding", "env", "configDefault"];
const GOOD: Record<string, string> = { flag: "work-a", binding: "work-b", env: "personal", configDefault: "legacy" };
const BAD = "ghost";

describe("resolveProfile precedence table", () => {
  test("no value on any rung is the built-in default", () => {
    expect(run({})).toEqual({ ok: true, resolved: { profile: { kind: "default" }, rung: "builtIn", overridden: [] } });
    expect(run({}, undefined)).toMatchObject({ ok: true, resolved: { rung: "builtIn" } });
  });

  test("an empty flag or variable counts as no value", () => {
    expect(run({ flag: "", env: "" })).toMatchObject({ ok: true, resolved: { rung: "builtIn" } });
  });

  test.each(RUNGS)("a resolving value on %s alone is chosen, nothing overridden", (rung) => {
    const result = run({ [rung]: GOOD[rung] });
    expect(result).toMatchObject({ ok: true, resolved: { rung, overridden: [] } });
  });

  test.each(RUNGS)("a non-resolving value on %s alone fails on that rung", (rung) => {
    expect(run({ [rung]: BAD })).toEqual({
      ok: false,
      failure: { rung, value: BAD, problem: expect.stringContaining(`"${BAD}"`) },
    });
  });

  test.each(RUNGS)("a non-resolving value on %s fails even when every lower rung would resolve", (rung) => {
    const lower = RUNGS.slice(RUNGS.indexOf(rung) + 1);
    const values: Values = { [rung]: BAD };
    for (const r of lower) values[r] = GOOD[r];
    const result = run(values);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.rung).toBe(rung);
  });

  test.each(RUNGS)("a resolving value on %s wins over non-resolving lower rungs and lists them as overridden", (rung) => {
    const lower = RUNGS.slice(RUNGS.indexOf(rung) + 1);
    const values: Values = { [rung]: GOOD[rung] };
    for (const r of lower) values[r] = BAD;
    const result = run(values);
    expect(result).toMatchObject({ ok: true, resolved: { rung } });
    if (result.ok) expect(result.resolved.overridden).toEqual(lower.map((r) => ({ rung: r, value: BAD })));
  });

  test("a value on a higher rung than the failing one never hides the failure of the chosen one", () => {
    // flag is empty, binding fails, env would resolve: the binding is the chosen rung.
    const result = run({ binding: BAD, env: "personal" });
    expect(result).toMatchObject({ ok: false, failure: { rung: "binding", value: BAD } });
  });

  test("the ordering is flag, binding, env, config default, built-in", () => {
    const all = run({ flag: "work-a", binding: "work-b", env: "personal", configDefault: "legacy" });
    expect(all).toMatchObject({ ok: true, resolved: { rung: "flag" } });
    if (all.ok) expect(all.resolved.overridden.map((o) => o.rung)).toEqual(["binding", "env", "configDefault"]);
    expect(run({ binding: "work-b", env: "personal", configDefault: "legacy" })).toMatchObject({ resolved: { rung: "binding" } });
    expect(run({ env: "personal", configDefault: "legacy" })).toMatchObject({ resolved: { rung: "env" } });
  });
});

describe("what a name resolves to", () => {
  const profileOf = (value: string, cfg = config) => {
    const result = run({ flag: value }, cfg);
    return result.ok ? result.resolved.profile : result;
  };

  test("default is the built-in", () => {
    expect(profileOf("default")).toEqual({ kind: "default" });
  });

  test("a registered managed name", () => {
    expect(profileOf("personal")).toEqual({ kind: "managed", name: "personal", configDir: join(home, "claude-personal"), registered: true });
  });

  test("a registered external name, with and without its binary", () => {
    expect(profileOf("work-a")).toEqual({ kind: "external", name: "work-a", configDir: "/Users/me/.claude-work-a", binary: "/opt/claude/claude" });
    expect(profileOf("work-b")).toEqual({ kind: "external", name: "work-b", configDir: "/Users/me/.claude-work-b" });
  });

  test("an unregistered name whose managed directory exists is managed and unregistered", () => {
    expect(profileOf("legacy")).toEqual({ kind: "managed", name: "legacy", configDir: join(home, "claude-legacy"), registered: false });
    expect(profileOf("legacy", { ...config, profiles: {} })).toMatchObject({ kind: "managed", registered: false });
  });

  test("isolated is the managed profile named isolated; isolated:<n> is the managed profile n", () => {
    expect(profileOf("isolated")).toEqual({ kind: "managed", name: "isolated", configDir: join(home, "claude-isolated"), registered: false });
    expect(profileOf("isolated:legacy")).toEqual({ kind: "managed", name: "legacy", configDir: join(home, "claude-legacy"), registered: false });
    expect(profileOf("isolated:personal")).toMatchObject({ kind: "managed", name: "personal", registered: true });
  });

  test("isolated:<n> never reaches an external profile of that name", () => {
    expect(profileOf("isolated:work-a")).toMatchObject({ ok: false, failure: { rung: "flag", value: "isolated:work-a" } });
  });

  test("a name that resolves to nothing names the rung, the missing directory and the fix", () => {
    const result = run({ binding: "ghost" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.rung).toBe("binding");
      expect(result.failure.problem).toContain(join(home, "claude-ghost"));
      expect(result.failure.problem).toContain("wachiman profile list");
    }
  });

  test("a malformed name fails on its rung instead of throwing", () => {
    expect(run({ env: "Work" })).toMatchObject({ ok: false, failure: { rung: "env", value: "Work" } });
    expect(run({ flag: "isolated:../x" })).toMatchObject({ ok: false, failure: { rung: "flag" } });
  });

  test("no config behaves as no registered profiles", () => {
    expect(run({ flag: "work-a" }, undefined)).toMatchObject({ ok: false });
    expect(run({ flag: "legacy" }, undefined)).toMatchObject({ ok: true, resolved: { profile: { kind: "managed", registered: false } } });
  });
});

describe("parseProfileRef", () => {
  test.each(["Work", "isolated:", "isolated:../x", "isolated:Work", "isolated:-x", ""])("%p is a usage error", (value) => {
    expect(() => parseProfileRef(value)).toThrow(UsageError);
  });

  test("the accepted spellings", () => {
    expect(parseProfileRef("default")).toEqual({ kind: "default" });
    expect(parseProfileRef("isolated")).toEqual({ kind: "name", name: "isolated", managedOnly: true });
    expect(parseProfileRef("isolated:work")).toEqual({ kind: "name", name: "work", managedOnly: true });
    expect(parseProfileRef("work-a")).toEqual({ kind: "name", name: "work-a", managedOnly: false });
  });
});

describe("profileLine", () => {
  const line = (values: Values) => {
    const r = run(values);
    if (!r.ok) throw new Error("did not resolve");
    return profileLine(r.resolved);
  };

  test("the built-in default", () => {
    expect(line({})).toBe("profile: default (your shell's claude; chosen by built-in default)");
  });

  test("an external profile with a binary, chosen by a binding that overrode the environment", () => {
    expect(line({ binding: "work-a", env: "personal" })).toBe(
      "profile: work-a (external, /Users/me/.claude-work-a, binary /opt/claude/claude; chosen by project binding; WACHIMAN_PROFILE=personal ignored)",
    );
  });

  test("an external profile without a binary, chosen by the flag", () => {
    expect(line({ flag: "work-b" })).toBe("profile: work-b (external, /Users/me/.claude-work-b; chosen by --profile)");
  });

  test("a managed profile, chosen by the environment over the configured default", () => {
    expect(line({ env: "personal", configDefault: "legacy" })).toBe(
      `profile: personal (managed, ${join(home, "claude-personal")}; chosen by WACHIMAN_PROFILE; config default=legacy ignored)`,
    );
  });

  test("the configured default and every overridden rung in order", () => {
    expect(line({ configDefault: "legacy" })).toBe(`profile: legacy (managed, ${join(home, "claude-legacy")}; chosen by config default)`);
    expect(line({ flag: "work-b", binding: "work-a", env: "personal", configDefault: "legacy" })).toBe(
      "profile: work-b (external, /Users/me/.claude-work-b; chosen by --profile; project binding=work-a ignored; WACHIMAN_PROFILE=personal ignored; config default=legacy ignored)",
    );
  });
});

describe("failureText", () => {
  test("names the rung, the value and the problem", () => {
    const result = run({ env: "ghost" });
    if (result.ok) throw new Error("should fail");
    const text = failureText(result.failure);
    expect(text).toStartWith('WACHIMAN_PROFILE "ghost": ');
    expect(text).toContain("is not registered");
    expect(failureText({ rung: "binding", value: "x", problem: "p" })).toBe('project binding "x": p');
  });
});
