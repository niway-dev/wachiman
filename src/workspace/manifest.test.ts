import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageError } from "../config";
import { ManifestError, parseManifest, readManifest, MANIFEST_FILE } from "./manifest";

const temps: string[] = [];
const coordinator = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "wachiman-manifest-")));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const base = () => ({
  format: "workspace/1",
  members: [
    { dir: "api-client", repo: "acme/api-client", visibility: "public" },
    { dir: "billing-service", repo: "acme/billing-service", visibility: "private" },
    { dir: "desktop-app", repo: "acme/desktop-app", visibility: "private" },
  ],
  contracts: [
    {
      name: "billing-api",
      sides: [
        { member: "billing-service", role: "provider", paths: ["src/routes/**"] },
        { member: "api-client", role: "consumer", paths: ["src/billing/**"] },
      ],
      sourceOfTruth: { member: "api-client", paths: ["docs/billing-api.md"] },
      version: { rule: "tip" },
    },
  ],
});

const parse = (change: (m: ReturnType<typeof base>) => void = () => {}, dir = coordinator()) => {
  const m = base();
  change(m);
  return parseManifest(JSON.stringify(m), dir);
};
const refusal = (change: (m: ReturnType<typeof base>) => void, dir?: string) => {
  try {
    parse(change, dir);
  } catch (error) {
    expect(error).toBeInstanceOf(ManifestError);
    expect(error).toBeInstanceOf(UsageError);
    return error as ManifestError;
  }
  throw new Error("expected the manifest to be refused");
};

describe("parseManifest", () => {
  test("reads members and contracts of the documented example", () => {
    const manifest = parse();
    expect(manifest.format).toBe("workspace/1");
    expect(manifest.members.map((m) => m.dir)).toEqual(["api-client", "billing-service", "desktop-app"]);
    expect(manifest.members[0]).toMatchObject({ repo: "acme/api-client", visibility: "public" });
    expect(manifest.contracts[0]).toMatchObject({ name: "billing-api", version: { rule: "tip" } });
    expect(manifest.contracts[0].sourceOfTruth).toEqual({ member: "api-client", paths: ["docs/billing-api.md"] });
  });

  test("ignores keys it does not read", () => {
    const manifest = parse((m) => Object.assign(m, { instructions: "x", members: m.members.map((x) => ({ ...x, owner: "someone" })) }));
    expect(manifest.members).toHaveLength(3);
  });

  test("only workspace/1 is accepted; any other format is refused naming it", () => {
    for (const format of ["workspace/2", "workspace", "kit/1", 1, undefined]) {
      const error = refusal((m) => Object.assign(m, { format }));
      expect(error.code).toBe("format");
      expect(error.message).toContain(String(format === undefined ? "format" : format));
      expect(error.message).toContain("workspace/1");
    }
  });

  test("a visibility that is not exactly public is private", () => {
    const manifest = parse((m) => {
      const loose = m.members as Array<Record<string, unknown>>;
      loose[0].visibility = "Public";
      loose[1].visibility = "publik";
      delete loose[2].visibility;
    });
    expect(manifest.members.map((m) => m.visibility)).toEqual(["private", "private", "private"]);
    expect(parse().members[0].visibility).toBe("public");
  });

  test("refuses invalid JSON and a non-object", () => {
    expect(() => parseManifest("{", coordinator())).toThrow(ManifestError);
    expect(() => parseManifest("[]", coordinator())).toThrow(/JSON object/);
  });

  test("duplicate member dirs and contract names are refused", () => {
    expect(refusal((m) => m.members.push({ ...m.members[0], repo: "acme/other" })).message).toContain('"api-client"');
    expect(refusal((m) => m.contracts.push({ ...m.contracts[0] })).message).toContain('"billing-api"');
  });

  test("a contract needs a provider and a consumer", () => {
    expect(refusal((m) => (m.contracts[0].sides[1].role = "provider")).message).toMatch(/consumer/);
    expect(refusal((m) => (m.contracts[0].sides[0].role = "consumer")).message).toMatch(/provider/);
    expect(refusal((m) => (m.contracts[0].sides[0].role = "owner")).message).toMatch(/provider or consumer/);
  });

  test("members named by a contract must exist", () => {
    expect(refusal((m) => (m.contracts[0].sides[0].member = "ghost")).message).toContain('"ghost"');
    expect(refusal((m) => (m.contracts[0].sourceOfTruth.member = "ghost")).message).toContain('"ghost"');
  });

  test("a contract without a source of truth or with empty paths is refused", () => {
    expect(() => parse((m) => delete (m.contracts[0] as Record<string, unknown>).sourceOfTruth)).toThrow(/sourceOfTruth/);
    expect(() => parse((m) => (m.contracts[0].sides[0].paths = []))).toThrow(/paths/);
    expect(() => parse((m) => (m.contracts[0].sides[0].paths = [""]))).toThrow(/paths/);
  });

  test("a version object needs a known rule; pin must be complete", () => {
    expect(() => parse((m) => (m.contracts[0].version = { rule: "latest" }))).toThrow(/rule/);
    expect(() => parse((m) => (m.contracts[0].version = { rule: "pinned", pin: { file: "package.json", key: "a.b", tag: "v{version}" } } as never))).toThrow(/key/);
    expect(() => parse((m) => (m.contracts[0].version = { rule: "pinned", pin: { file: "../package.json", key: ["a"], tag: "v{version}" } } as never))).toThrow(/\.\./);
    const ok = parse((m) => (m.contracts[0].version = { rule: "pinned", pin: { file: "package.json", key: ["dependencies", "chart.js"], tag: "v{version}" } } as never));
    expect(ok.contracts[0].version).toEqual({ rule: "pinned", pin: { file: "package.json", key: ["dependencies", "chart.js"], tag: "v{version}" } });
    expect(parse((m) => ((m.members[0] as Record<string, unknown>).version = { rule: "local" })).members[0].version).toEqual({ rule: "local" });
    expect(parse((m) => (m.contracts[0].version = { rule: "pinned", ref: "v1.2.0" } as never)).contracts[0].version).toEqual({ rule: "pinned", ref: "v1.2.0" });
  });

  describe("path safety", () => {
    test("a member dir with a .. segment or an absolute path is refused", () => {
      for (const dir of ["../outside", "a/../../b", "..", "/etc", "C:\\x", "a\\..\\b", "."]) {
        const error = refusal((m) => (m.members[0].dir = dir));
        expect(error.code).toBe("path-escape");
      }
    });

    test("a glob with a .. segment or an absolute path is refused, in a side and in the source of truth", () => {
      for (const glob of ["../x/**", "src/../../x", "/etc/passwd", "{..,src}/a", "C:/x", "src/..", "src\\..\\x"]) {
        expect(refusal((m) => (m.contracts[0].sides[0].paths = [glob])).code).toBe("path-escape");
        expect(refusal((m) => (m.contracts[0].sourceOfTruth.paths = [glob])).code).toBe("path-escape");
      }
    });

    test("names that merely contain dots are fine", () => {
      const manifest = parse((m) => (m.contracts[0].sides[0].paths = ["src/..hidden/**", "a..b/*.ts", "...", ".github/**"]));
      expect(manifest.contracts[0].sides[0].paths).toHaveLength(4);
    });

    test("a member dir that is a symlink to outside the coordinator is refused", () => {
      const dir = coordinator();
      const outside = coordinator();
      symlinkSync(outside, join(dir, "api-client"));
      const error = refusal(() => {}, dir);
      expect(error.code).toBe("path-escape");
      expect(error.message).toContain("api-client");
    });

    test("a member dir that is a symlink to another place inside the coordinator is fine", () => {
      const dir = coordinator();
      mkdirSync(join(dir, "real"));
      symlinkSync(join(dir, "real"), join(dir, "api-client"));
      expect(parse(() => {}, dir).members).toHaveLength(3);
    });

    test("a coordinator reached through a symlink accepts a member that is not cloned", () => {
      const real = coordinator();
      const holder = coordinator();
      const link = join(holder, "link");
      symlinkSync(real, link);
      expect(parse(() => {}, link).members).toHaveLength(3);
    });

    test("a member folder whose name starts with two dots is not a climb", () => {
      const manifest = parse((m) => {
        m.members[2].dir = "..cache";
      });
      expect(manifest.members[2].dir).toBe("..cache");
    });

    test("a member dir is normalised, so app, app/ and ./app are the same member", () => {
      expect(parse((m) => (m.members[0].dir = "./api-client/")).members[0].dir).toBe("api-client");
      for (const dup of ["api-client/", "./api-client"]) {
        const error = refusal((m) => m.members.push({ ...m.members[0], dir: dup, repo: "acme/other" }));
        expect(error.message).toContain("appears twice");
      }
    });

    test("a missing member dir is fine (not cloned is reported later)", () => {
      expect(parse().members).toHaveLength(3);
    });
  });
});

describe("readManifest", () => {
  test("reads the file and takes its folder as the coordinator", () => {
    const dir = coordinator();
    writeFileSync(join(dir, MANIFEST_FILE), JSON.stringify(base()));
    const manifest = readManifest(join(dir, MANIFEST_FILE));
    expect(manifest.members).toHaveLength(3);
  });

  test("a missing file is a ManifestError naming the path", () => {
    const dir = coordinator();
    expect(() => readManifest(join(dir, MANIFEST_FILE))).toThrow(ManifestError);
    try {
      readManifest(join(dir, MANIFEST_FILE));
    } catch (error) {
      expect((error as ManifestError).code).toBe("unreadable");
      expect((error as Error).message).toContain(MANIFEST_FILE);
    }
  });
});
