import { describe, expect, test } from "bun:test";
import { UsageError } from "../config";
import { parseInitFlags } from "./args";
import { DEFAULT_WORKFLOW_REF, resolveInitOptions, type RawInitFlags } from "./options";

const REF = "v1.5.0";
const resolve = (flags: RawInitFlags, ctx: { interactive?: boolean; defaultWorkflowRef?: string } = {}) =>
  resolveInitOptions(flags, { interactive: false, defaultWorkflowRef: REF, ...ctx });
const ok = (flags: RawInitFlags, ctx?: { interactive?: boolean; defaultWorkflowRef?: string }) => {
  const r = resolve(flags, ctx);
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.options;
};
const error = (flags: RawInitFlags, ctx?: { interactive?: boolean; defaultWorkflowRef?: string }) => {
  const r = resolve(flags, ctx);
  if (r.ok) throw new Error("expected an error");
  return r.error;
};

describe("resolveInitOptions: modes", () => {
  test("--mode is mandatory, and one of github, local, both", () => {
    expect(error({})).toMatch(/--mode/);
    expect(error({ mode: "everywhere" })).toMatch(/github, local or both/);
  });

  test("github needs an operator; the path, tag and flags get their defaults", () => {
    expect(error({ mode: "github" })).toMatch(/--operator/);
    expect(ok({ mode: "github", operator: "me" })).toEqual({
      mode: "github",
      github: { operator: "me", tag: REF, path: ".github/workflows/wachiman-review.yml", force: false, dryRun: false },
      repoDir: ".",
      interactive: false,
    });
  });

  test("both is a github mode: it needs an operator too", () => {
    expect(error({ mode: "both" })).toMatch(/--operator/);
    const o = ok({ mode: "both", operator: "me", force: true, dryRun: true, repoDir: "/r" });
    expect(o.mode).toBe("both");
    expect(o.github).toMatchObject({ operator: "me", force: true, dryRun: true });
    expect(o.repoDir).toBe("/r");
  });

  test("local has no github block", () => {
    const o = ok({ mode: "local" });
    expect(o.github).toBeUndefined();
  });

  test.each([
    [{ operator: "me" }, "--operator"],
    [{ version: "v1.5.0" }, "--version"],
    [{ path: ".github/workflows/x.yml" }, "--path"],
    [{ force: true }, "--force"],
    [{ dryRun: true }, "--dry-run"],
  ] as [RawInitFlags, string][])("local mode refuses the github-only flag %#", (extra, flag) => {
    expect(error({ mode: "local", ...extra })).toContain(flag);
  });

  test("--yes does not change what is resolved; interactive is carried through", () => {
    expect(ok({ mode: "local", yes: true }, { interactive: true }).interactive).toBe(true);
    expect(ok({ mode: "local", yes: true }).interactive).toBe(false);
  });
});

describe("resolveInitOptions: the operator", () => {
  test.each(["me", "a", "Cristian-S", "a1-b2", "x".repeat(39)])("%s is a login", (login) => {
    expect(ok({ mode: "github", operator: login }).github?.operator).toBe(login);
  });
  test.each(["", "-me", "me-", "a--b", "x".repeat(40), "a b", "a_b", "me\nname", "EDIT-THIS-github-login ", "a/b"])(
    "%j is refused",
    (login) => {
      expect(error({ mode: "github", operator: login })).toMatch(/operator/);
    },
  );
});

describe("resolveInitOptions: the pinned tag", () => {
  test("--version wins over the bundled ref", () => {
    expect(ok({ mode: "github", operator: "me", version: "v2.0.1" }).github?.tag).toBe("v2.0.1");
  });

  test("a 40-hex commit SHA is accepted", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    expect(ok({ mode: "github", operator: "me", version: sha }).github?.tag).toBe(sha);
  });

  test("without a bundled ref --version is mandatory, and says why", () => {
    const e = error({ mode: "github", operator: "me" }, { defaultWorkflowRef: undefined });
    expect(e).toMatch(/--version/);
    expect(e).toMatch(/no known-published/);
    expect(ok({ mode: "github", operator: "me", version: "v1.5.0" }, { defaultWorkflowRef: undefined }).github?.tag).toBe("v1.5.0");
  });

  test("the bundled default has the vX.Y.Z shape", () => {
    expect(DEFAULT_WORKFLOW_REF).toMatch(/^v\d+\.\d+\.\d+$/);
  });

  test.each(["1.5.0", "v1.5", "v1.5.0-rc.1", "v1", "main", "latest", "v1.5.0 ", "unknown", "0123456789abcdef", "0123456789ABCDEF0123456789abcdef01234567", "v1.5.0\nuses: x"])(
    "%j is not an Actions tag",
    (tag) => {
      expect(error({ mode: "github", operator: "me", version: tag })).toMatch(/vX\.Y\.Z|40/);
    },
  );

  test("the CLI's own version never becomes the tag: the resolver is not given it, and a bad bundled ref is refused", () => {
    // `wachiman --version` may print 1.9.0, an unreleased build or `unknown`; none of them reaches `uses: …@`.
    expect(error({ mode: "github", operator: "me" }, { defaultWorkflowRef: "unknown" })).toMatch(/bundled/);
    expect(error({ mode: "github", operator: "me" }, { defaultWorkflowRef: "1.9.0" })).toMatch(/bundled/);
    expect(error({ mode: "github", operator: "me" }, { defaultWorkflowRef: undefined })).toMatch(/--version/);
  });
});

describe("resolveInitOptions: the workflow path", () => {
  const path = (p: string) => ok({ mode: "github", operator: "me", path: p }).github?.path;

  test("a .yml or .yaml file directly under .github/workflows is accepted and normalised", () => {
    expect(path(".github/workflows/review.yaml")).toBe(".github/workflows/review.yaml");
    expect(path("./.github/workflows/a.yml")).toBe(".github/workflows/a.yml");
    expect(path(".github//workflows/a.yml")).toBe(".github/workflows/a.yml");
  });

  test.each([
    "wachiman-review.yml",
    ".github/wachiman-review.yml",
    ".github/workflows/review.txt",
    ".github/workflows/review",
    ".github/workflows/",
    ".github/workflows/.yml/..",
    ".github/workflows/../../evil.yml",
    "../.github/workflows/a.yml",
    "/etc/.github/workflows/a.yml",
    "/tmp/x/.github/workflows/a.yml",
    ".github/workflows/sub/a.yml",
    ".github\\workflows\\a.yml",
    ".github/workflows/a.yml\u0000.txt",
    ".github/workflows/../workflows2/a.yml",
  ])("%j is refused", (p) => {
    expect(error({ mode: "github", operator: "me", path: p })).toMatch(/--path/);
  });
});

describe("parseInitFlags: the argument parser", () => {
  const parse = (argv: string[]) => parseInitFlags(argv, "/repo");

  test("every flag, in both spellings", () => {
    expect(parse(["--mode", "both", "--operator=me", "--version", "v1.5.0", "--path=.github/workflows/a.yml", "--force", "--dry-run", "--yes"])).toEqual({
      mode: "both",
      operator: "me",
      version: "v1.5.0",
      path: ".github/workflows/a.yml",
      force: true,
      dryRun: true,
      yes: true,
      repoDir: "/repo",
    });
  });

  test("no flags: only the repository directory", () => {
    expect(parse([])).toEqual({ repoDir: "/repo" });
  });

  test("--help and -h", () => {
    expect(parse(["--help"]).help).toBe(true);
    expect(parse(["-h"]).help).toBe(true);
  });

  test("an unknown flag, a stray argument or a value on a boolean is a usage error", () => {
    expect(() => parse(["--bogus"])).toThrow(UsageError);
    expect(() => parse(["stray"])).toThrow(UsageError);
    expect(() => parse(["--force=yes"])).toThrow(UsageError);
    expect(() => parse(["--mode"])).toThrow(UsageError);
  });
});
