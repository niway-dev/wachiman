import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageError } from "../config";
import { parseUserFile, readUserFile, userFilePath, UserFileError } from "./user-file";

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});
const home = () => {
  const dir = mkdtempSync(join(tmpdir(), "wachiman-userfile-"));
  temps.push(dir);
  return dir;
};

const file = (workspace: Record<string, unknown> = {}) => ({
  version: 1,
  workspaces: [{ manifest: "/work/acme/workspace.manifest.json", ...workspace }],
});
const parse = (value: unknown) => parseUserFile(JSON.stringify(value));

describe("parseUserFile", () => {
  test("reads the documented example", () => {
    const parsed = parse(
      file({
        distributedRepo: "off",
        members: { "web-site": { dir: "/work/other-clones/web-site" }, "api-client": { watch: false } },
        versions: { "brand-palette": { rule: "local" }, "billing-service": { rule: "pinned", ref: "v1.0.0" } },
      }),
    );
    expect(parsed.version).toBe(1);
    expect(parsed.workspaces[0]).toEqual({
      manifest: "/work/acme/workspace.manifest.json",
      distributedRepo: "off",
      members: { "web-site": { dir: "/work/other-clones/web-site" }, "api-client": { watch: false } },
      versions: { "brand-palette": { rule: "local" }, "billing-service": { rule: "pinned", ref: "v1.0.0" } },
    });
  });

  test("distributedRepo, members and versions are optional; the default is off", () => {
    expect(parse(file()).workspaces[0]).toEqual({
      manifest: "/work/acme/workspace.manifest.json",
      distributedRepo: "off",
      members: {},
      versions: {},
    });
    expect(parse(file({ distributedRepo: "on" })).workspaces[0].distributedRepo).toBe("on");
  });

  test("a member or version key written as in the manifest (./app/) is found under the normalised dir", () => {
    const [workspace] = parse(
      file({ members: { "./app/": { watch: false } }, versions: { "./web-site": { rule: "local" }, "ui-kit-api": { rule: "tip" } } }),
    ).workspaces;
    expect(workspace.members.app).toEqual({ watch: false });
    expect(workspace.versions["web-site"]).toEqual({ rule: "local" });
    expect(workspace.versions["ui-kit-api"]).toEqual({ rule: "tip" });
  });

  test("members and versions have no inherited keys; a declared constructor key is still an own entry", () => {
    const [workspace] = parse(file({ members: {}, versions: {} })).workspaces;
    expect(Object.getPrototypeOf(workspace.members)).toBeNull();
    expect(Object.getPrototypeOf(workspace.versions)).toBeNull();
    expect("constructor" in workspace.members).toBe(false);
    expect("toString" in workspace.versions).toBe(false);

    const declared = parse(file({ members: { constructor: { watch: false } }, versions: { constructor: { rule: "tip" } } })).workspaces[0];
    expect(Object.hasOwn(declared.members, "constructor")).toBe(true);
    expect(declared.members.constructor).toEqual({ watch: false });
    expect(declared.versions.constructor).toEqual({ rule: "tip" });
  });

  test("an empty workspaces list is valid", () => {
    expect(parse({ version: 1, workspaces: [] }).workspaces).toEqual([]);
  });

  test("unknown keys are ignored at every level", () => {
    const parsed = parse({
      version: 1,
      theme: "x",
      workspaces: [{ manifest: "/m/workspace.manifest.json", note: 1, members: { a: { dir: "/x/a", colour: "red" } } }],
    });
    expect(parsed.workspaces[0].members).toEqual({ a: { dir: "/x/a" } });
  });

  test("malformed known keys are refused, naming the key", () => {
    const refused = (value: unknown, pattern: RegExp) => {
      try {
        parse(value);
      } catch (error) {
        expect(error).toBeInstanceOf(UserFileError);
        expect(error).toBeInstanceOf(UsageError);
        expect((error as Error).message).toMatch(pattern);
        return;
      }
      throw new Error("expected a refusal");
    };
    refused({ version: 2, workspaces: [] }, /version/);
    refused({ workspaces: [] }, /version/);
    refused({ version: 1, workspaces: {} }, /workspaces/);
    refused({ version: 1 }, /workspaces/);
    refused(file({ manifest: "relative/workspace.manifest.json" }), /absolute/);
    refused(file({ manifest: 3 }), /manifest/);
    refused(file({ distributedRepo: "yes" }), /distributedRepo/);
    refused(file({ members: [] }), /members/);
    refused(file({ members: { a: { dir: "relative" } } }), /members\.a\.dir/);
    refused(file({ members: { a: { watch: "no" } } }), /members\.a\.watch/);
    refused(file({ members: { a: "x" } }), /members\.a/);
    refused(file({ versions: { c: { rule: "newest" } } }), /versions\.c\.rule/);
    refused(file({ versions: { c: "tip" } }), /versions\.c/);
    refused([], /JSON object/);
  });

  test("invalid JSON is refused", () => {
    expect(() => parseUserFile("{")).toThrow(UserFileError);
  });
});

describe("readUserFile", () => {
  test("a missing file is an empty list", () => {
    expect(readUserFile(home())).toEqual({ version: 1, workspaces: [] });
  });

  test("reads <home>/workspaces.json", () => {
    const dir = home();
    expect(userFilePath(dir)).toBe(join(dir, "workspaces.json"));
    writeFileSync(userFilePath(dir), JSON.stringify(file({ distributedRepo: "on" })));
    expect(readUserFile(dir).workspaces[0].distributedRepo).toBe("on");
  });

  test("a malformed file names its path", () => {
    const dir = home();
    writeFileSync(userFilePath(dir), "{");
    expect(() => readUserFile(dir)).toThrow(userFilePath(dir));
  });
});
