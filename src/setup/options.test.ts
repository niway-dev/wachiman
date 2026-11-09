import { describe, expect, test } from "bun:test";
import { UsageError } from "../config";
import { parseSetupFlags } from "./args";
import { resolveSetupOptions, type RawSetupFlags } from "./options";

const resolve = (flags: RawSetupFlags, interactive = false) => resolveSetupOptions(flags, { interactive });

describe("parseSetupFlags", () => {
  test("every flag, in both spellings, with the repository directory", () => {
    expect(parseSetupFlags(["--profile", "work-a", "--yes", "--json"], "/repo")).toEqual({ profile: "work-a", yes: true, json: true, repoDir: "/repo" });
    expect(parseSetupFlags(["--profile=work-a"], "/repo")).toEqual({ profile: "work-a", repoDir: "/repo" });
    expect(parseSetupFlags([], "/repo")).toEqual({ repoDir: "/repo" });
  });
  test("--help and -h", () => {
    expect(parseSetupFlags(["--help"], "/r").help).toBe(true);
    expect(parseSetupFlags(["-h"], "/r").help).toBe(true);
  });
  test("an unknown flag or a stray argument is a usage error", () => {
    expect(() => parseSetupFlags(["--bogus"], "/r")).toThrow(UsageError);
    expect(() => parseSetupFlags(["work-a"], "/r")).toThrow(UsageError);
  });
});

describe("resolveSetupOptions", () => {
  test("without a terminal --profile is mandatory", () => {
    const r = resolve({ repoDir: "/r" });
    expect(r).toEqual({ ok: false, error: "setup needs --profile <name> when it cannot ask; run wachiman profile list" });
  });

  test("with --profile it resolves, and carries the json flag and the directory", () => {
    expect(resolve({ profile: "work-a", repoDir: "/r", json: true })).toEqual({
      ok: true,
      options: { profile: "work-a", repoDir: "/r", interactive: false, json: true },
    });
    expect(resolve({ profile: "default", repoDir: "/r" }).ok).toBe(true);
    expect(resolve({ profile: "isolated:work", repoDir: "/r" }).ok).toBe(true);
  });

  test("a profile spelling that cannot be a name is refused", () => {
    const r = resolve({ profile: "Not A Name", repoDir: "/r" });
    expect(r.ok).toBe(false);
  });

  test("the directory defaults to the current one", () => {
    const r = resolve({ profile: "work-a" });
    expect(r.ok && r.options.repoDir).toBe(".");
  });

  test("on a terminal the profile is still needed once the prompts have filled it in", () => {
    expect(resolve({ repoDir: "/r" }, true).ok).toBe(false);
    expect(resolve({ profile: "work-a", repoDir: "/r" }, true)).toMatchObject({ ok: true, options: { interactive: true } });
  });
});
