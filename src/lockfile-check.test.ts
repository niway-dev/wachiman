import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addedLines,
  isCheckedLockfile,
  lockfileCheckOf,
  lockfileFindings,
  LOCKFILE_MESSAGES,
  parseBunLock,
  parseNpmLock,
  stripJsonc,
} from "./lockfile-check";

/** A bun.lock the way `bun install` writes it: JSONC with trailing commas, one package a line. */
const BUN_LOCK = `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "shop",
      "dependencies": {
        "left-pad": "1.3.0",
      },
      "devDependencies": {
        "@types/node": "^22.0.0",
      },
    },
    "apps/web": {
      "name": "@shop/web",
      "dependencies": {
        "chalk": "5.6.2",
      },
    },
  },
  "trustedDependencies": [
    "telemetry-helper",
  ],

  "packages": {
    "@shop/web": ["@shop/web@workspace:apps/web"],

    "@types/node": ["@types/node@22.1.0", "", { "dependencies": { "undici-types": "~6.0.0" } }, "sha512-a"],

    "chalk": ["chalk@5.6.2", "", {}, "sha512-b"],

    "left-pad": ["left-pad@1.3.0", "", {}, "sha512-c"],

    "telemetry-helper": ["telemetry-helper@2.3.1", "", { "bin": { "telemetry-helper": "bin/run.js" } }, "sha512-d"],

    "undici-types": ["undici-types@6.0.1", "", {}, "sha512-e"],
  }
}
`;

const lineOf = (text: string, needle: string, from = 1) => {
  const at = text
    .split("\n")
    .slice(from - 1)
    .findIndex((l) => l.includes(needle));
  return at === -1 ? 0 : at + from;
};

describe("stripJsonc", () => {
  test("drops comments and trailing commas but leaves strings alone", () => {
    const text = '{\n  "a": ["x, ]", "y//z",], // note\n  /* block */ "b": 1,\n}';
    expect(JSON.parse(stripJsonc(text))).toEqual({ a: ["x, ]", "y//z"], b: 1 });
  });
});

describe("addedLines", () => {
  test("lists the new-side line numbers of added lines, and the text of removed ones", () => {
    const patch = ["@@ -3,4 +3,5 @@", " ctx", "-old", "+new1", "+new2", " ctx2"].join("\n");
    const got = addedLines(patch);
    expect([...got.added]).toEqual([4, 5]);
    expect(got.removed).toEqual(["old"]);
  });

  test("follows several hunks", () => {
    const patch = ["@@ -1,1 +1,2 @@", " a", "+b", "@@ -10,1 +11,2 @@", " c", "+d"].join("\n");
    expect([...addedLines(patch).added]).toEqual([2, 12]);
  });
});

describe("isCheckedLockfile", () => {
  test("knows bun.lock and package-lock.json at any depth, and nothing else", () => {
    expect(isCheckedLockfile("bun.lock")).toBe("bun");
    expect(isCheckedLockfile("apps/web/package-lock.json")).toBe("npm");
    for (const other of ["yarn.lock", "pnpm-lock.yaml", "bun.lockb", "Cargo.lock", "package.json", "docs/bun.lock.md"]) {
      expect(isCheckedLockfile(other)).toBeNull();
    }
  });
});

describe("parseBunLock", () => {
  test("reads packages with their lines, the declared names and the trusted list", () => {
    const parsed = parseBunLock(BUN_LOCK);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(parsed.packages.map((p) => p.name)).toEqual([
      "@shop/web",
      "@types/node",
      "chalk",
      "left-pad",
      "telemetry-helper",
      "undici-types",
    ]);
    const telemetry = parsed.packages.find((p) => p.name === "telemetry-helper");
    expect(telemetry?.line).toBe(lineOf(BUN_LOCK, '"telemetry-helper": ["telemetry-helper@2.3.1"'));
    expect(parsed.packages.find((p) => p.name === "@types/node")?.dependencies).toEqual(["undici-types"]);
    expect([...parsed.declared].sort()).toEqual(["@shop/web", "@types/node", "chalk", "left-pad", "shop"]);
    expect(parsed.trusted).toEqual([{ name: "telemetry-helper", line: lineOf(BUN_LOCK, '    "telemetry-helper",') }]);
  });

  test("a workspace member is declared by being a member", () => {
    const parsed = parseBunLock(BUN_LOCK);
    expect(parsed?.packages.find((p) => p.name === "@shop/web")?.workspace).toBe(true);
  });

  test("returns null for text that is not a bun.lock", () => {
    expect(parseBunLock("not json")).toBeNull();
    expect(parseBunLock("[]")).toBeNull();
    expect(parseBunLock('{"workspaces": {}}')).toBeNull();
  });
});

/** The patch of s-032 of the demo shop, trimmed to the lines that matter. */
const s032Patch = (text: string) => {
  const trusted = lineOf(text, '"trustedDependencies"');
  const entry = lineOf(text, '"telemetry-helper": ["telemetry-helper@2.3.1"');
  return [
    `@@ -1,0 +${trusted},3 @@`,
    '+  "trustedDependencies": [',
    '+    "telemetry-helper",',
    "+  ],",
    `@@ -1,0 +${entry},1 @@`,
    `+    "telemetry-helper": ["telemetry-helper@2.3.1", "", { "bin": { "telemetry-helper": "bin/run.js" } }, "sha512-d"],`,
  ].join("\n");
};

describe("lockfileFindings on bun.lock", () => {
  const read = (files: Record<string, string>) => (path: string) => files[path] ?? null;

  test("flags a package nothing declares or depends on, and the new trusted entry", () => {
    const { findings } = lockfileFindings([{ filename: "bun.lock", patch: s032Patch(BUN_LOCK) }], read({ "bun.lock": BUN_LOCK }));
    expect(findings.map((f) => [f.path, f.line, f.severity, f.topic, f.title])).toEqual([
      [
        "bun.lock",
        lineOf(BUN_LOCK, '"telemetry-helper": ["telemetry-helper@2.3.1"'),
        "fix",
        "security",
        LOCKFILE_MESSAGES.undeclared.title,
      ],
      ["bun.lock", lineOf(BUN_LOCK, '    "telemetry-helper",'), "fix", "security", LOCKFILE_MESSAGES.trusted.title],
    ]);
    expect(findings[0]?.body).toBe(LOCKFILE_MESSAGES.undeclared.body);
  });

  test("a package a declared one depends on is not flagged, even when it is new", () => {
    const line = lineOf(BUN_LOCK, '"undici-types": ["undici-types@6.0.1"');
    const patch = `@@ -1,0 +${line},1 @@\n+    "undici-types": ["undici-types@6.0.1", "", {}, "sha512-e"],`;
    expect(lockfileFindings([{ filename: "bun.lock", patch }], read({ "bun.lock": BUN_LOCK })).findings).toEqual([]);
  });

  test("a version bump of a declared dependency is a clean refresh", () => {
    const line = lineOf(BUN_LOCK, '"chalk": ["chalk@5.6.2"');
    const patch = [
      `@@ -${line},1 +${line},1 @@`,
      '-    "chalk": ["chalk@5.6.1", "", {}, "sha512-old"],',
      '+    "chalk": ["chalk@5.6.2", "", {}, "sha512-b"],',
    ].join("\n");
    expect(lockfileFindings([{ filename: "bun.lock", patch }], read({ "bun.lock": BUN_LOCK })).findings).toEqual([]);
  });

  test("a bump of an undeclared package is not a new package: only the removed line says so", () => {
    const line = lineOf(BUN_LOCK, '"telemetry-helper": ["telemetry-helper@2.3.1"');
    const bump = [
      `@@ -${line},1 +${line},1 @@`,
      '-    "telemetry-helper": ["telemetry-helper@2.3.0", "", {}, "sha512-old"],',
      '+    "telemetry-helper": ["telemetry-helper@2.3.1", "", {}, "sha512-d"],',
    ].join("\n");
    expect(lockfileFindings([{ filename: "bun.lock", patch: bump }], read({ "bun.lock": BUN_LOCK })).findings).toEqual([]);
    // The same line with nothing removed is a new package, and is flagged.
    const added = `@@ -1,0 +${line},1 @@\n+    "telemetry-helper": ["telemetry-helper@2.3.1", "", {}, "sha512-d"],`;
    expect(lockfileFindings([{ filename: "bun.lock", patch: added }], read({ "bun.lock": BUN_LOCK })).findings.map((f) => f.title)).toEqual(
      [LOCKFILE_MESSAGES.undeclared.title],
    );
  });

  test("a package that is only reachable through an undeclared one is still flagged", () => {
    const text = BUN_LOCK.replace(
      '"telemetry-helper": ["telemetry-helper@2.3.1", "", { "bin"',
      '"telemetry-helper": ["telemetry-helper@2.3.1", "", { "dependencies": { "evil-dep": "1.0.0" }, "bin"',
    ).replace('"packages": {', '"packages": {\n    "evil-dep": ["evil-dep@1.0.0", "", {}, "sha512-f"],\n');
    const evil = lineOf(text, '"evil-dep": ["evil-dep@1.0.0"');
    const tel = lineOf(text, '"telemetry-helper": ["telemetry-helper@2.3.1"');
    const patch = `@@ -1,0 +${evil},1 @@\n+    "evil-dep": ["evil-dep@1.0.0", "", {}, "sha512-f"],\n@@ -1,0 +${tel},1 @@\n+    "telemetry-helper": [],`;
    const { findings } = lockfileFindings([{ filename: "bun.lock", patch }], read({ "bun.lock": text }));
    expect(findings.map((f) => f.line)).toEqual([evil, tel]);
  });

  test("a trusted entry that is removed and added back (a reorder) is not new", () => {
    const line = lineOf(BUN_LOCK, '    "telemetry-helper",');
    const patch = [`@@ -${line},1 +${line},1 @@`, '-    "telemetry-helper",', '+    "telemetry-helper",'].join("\n");
    expect(lockfileFindings([{ filename: "bun.lock", patch }], read({ "bun.lock": BUN_LOCK })).findings).toEqual([]);
  });

  test("a package declared in a package.json at the head is declared, whatever the lockfile says", () => {
    const files = {
      "bun.lock": BUN_LOCK,
      "package.json": JSON.stringify({ dependencies: { "telemetry-helper": "2.3.1" } }),
      "apps/web/package.json": "{}",
    };
    const { findings } = lockfileFindings([{ filename: "bun.lock", patch: s032Patch(BUN_LOCK) }], read(files));
    expect(findings.map((f) => f.title)).toEqual([LOCKFILE_MESSAGES.trusted.title]);
  });

  test("a package.json that dropped a dependency makes it undeclared even if the lockfile still lists it", () => {
    const files = { "bun.lock": BUN_LOCK, "package.json": JSON.stringify({ dependencies: {} }), "apps/web/package.json": "{}" };
    const line = lineOf(BUN_LOCK, '"left-pad": ["left-pad@1.3.0"');
    const patch = `@@ -1,0 +${line},1 @@\n+    "left-pad": ["left-pad@1.3.0", "", {}, "sha512-c"],`;
    const { findings } = lockfileFindings([{ filename: "bun.lock", patch }], read(files));
    expect(findings.map((f) => f.title)).toEqual([LOCKFILE_MESSAGES.undeclared.title]);
  });

  test("a lockfile with no patch cannot be checked and is reported as unchecked", () => {
    const got = lockfileFindings([{ filename: "bun.lock" }], read({ "bun.lock": BUN_LOCK }));
    expect(got.findings).toEqual([]);
    expect(got.unchecked).toEqual([{ path: "bun.lock", reason: "GitHub sent no diff for it" }]);
  });

  test("an unreadable or unparseable lockfile is unchecked, never a finding", () => {
    expect(lockfileFindings([{ filename: "bun.lock", patch: "@@ -1 +1 @@\n+a" }], read({})).unchecked).toHaveLength(1);
    expect(lockfileFindings([{ filename: "bun.lock", patch: "@@ -1 +1 @@\n+a" }], read({ "bun.lock": "garbage" })).unchecked).toHaveLength(
      1,
    );
  });

  test("other lockfiles are out of scope and not mentioned", () => {
    const got = lockfileFindings([{ filename: "yarn.lock", patch: "@@ -1 +1 @@\n+a" }], read({ "yarn.lock": "x" }));
    expect(got).toEqual({ findings: [], unchecked: [] });
  });
});

const NPM_LOCK = `{
  "name": "shop",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "shop",
      "dependencies": {
        "left-pad": "1.3.0"
      }
    },
    "node_modules/left-pad": {
      "version": "1.3.0",
      "resolved": "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz",
      "integrity": "sha512-a"
    },
    "node_modules/telemetry-helper": {
      "version": "2.3.1",
      "resolved": "https://registry.npmjs.org/telemetry-helper/-/telemetry-helper-2.3.1.tgz",
      "integrity": "sha512-b",
      "hasInstallScript": true
    },
    "node_modules/quiet-dep": {
      "version": "1.0.0",
      "integrity": "sha512-c",
      "hasInstallScript": true
    }
  }
}
`;

describe("parseNpmLock", () => {
  test("reads packages, the root's declared names and install scripts, with lines", () => {
    const parsed = parseNpmLock(NPM_LOCK);
    expect(parsed?.packages.map((p) => [p.name, p.installScriptLine !== undefined])).toEqual([
      ["left-pad", false],
      ["telemetry-helper", true],
      ["quiet-dep", true],
    ]);
    expect(parsed?.packages[1]?.line).toBe(lineOf(NPM_LOCK, '"node_modules/telemetry-helper"'));
    expect(parsed?.packages[1]?.installScriptLine).toBe(lineOf(NPM_LOCK, '"hasInstallScript": true'));
    expect([...(parsed?.declared ?? [])]).toEqual(["shop", "left-pad"]);
  });

  test("a nested node_modules path names the innermost package", () => {
    const text = NPM_LOCK.replace('"node_modules/quiet-dep"', '"node_modules/a/node_modules/@s/quiet-dep"');
    expect(parseNpmLock(text)?.packages.map((p) => p.name)).toContain("@s/quiet-dep");
  });

  test("returns null for text that is not a package-lock.json", () => {
    expect(parseNpmLock("nope")).toBeNull();
    expect(parseNpmLock("{}")).toBeNull();
  });
});

describe("lockfileFindings on package-lock.json", () => {
  const patchFor = (text: string, names: string[]) =>
    names
      .map((n) => {
        const start = lineOf(text, `"node_modules/${n}"`);
        return (
          `@@ -1,0 +${start},6 @@\n` +
          text
            .split("\n")
            .slice(start - 1, start + 5)
            .map((l) => `+${l}`)
            .join("\n")
        );
      })
      .join("\n");

  test("flags an undeclared new package and its install script, each on its own line", () => {
    const patch = patchFor(NPM_LOCK, ["telemetry-helper"]);
    const { findings } = lockfileFindings([{ filename: "package-lock.json", patch }], (p) => (p === "package-lock.json" ? NPM_LOCK : null));
    expect(findings.map((f) => [f.line, f.title])).toEqual([
      [lineOf(NPM_LOCK, '"node_modules/telemetry-helper"'), LOCKFILE_MESSAGES.undeclared.title],
      [lineOf(NPM_LOCK, '"hasInstallScript": true'), LOCKFILE_MESSAGES.installScript.title],
    ]);
  });

  test("a declared package with an install script is still flagged for the script", () => {
    const text = NPM_LOCK.replace('"left-pad": "1.3.0"', '"left-pad": "1.3.0", "quiet-dep": "1.0.0"');
    const patch = patchFor(text, ["quiet-dep"]);
    const { findings } = lockfileFindings([{ filename: "package-lock.json", patch }], (p) => (p === "package-lock.json" ? text : null));
    expect(findings.map((f) => f.title)).toEqual([LOCKFILE_MESSAGES.installScript.title]);
  });

  test("a version bump of a declared dependency is a clean refresh", () => {
    const start = lineOf(NPM_LOCK, '"node_modules/left-pad"');
    const patch = [
      `@@ -${start},4 +${start},4 @@`,
      ` "node_modules/left-pad": {`,
      '-      "version": "1.2.0",',
      '+      "version": "1.3.0",',
    ].join("\n");
    const got = lockfileFindings([{ filename: "package-lock.json", patch }], (p) => (p === "package-lock.json" ? NPM_LOCK : null));
    expect(got.findings).toEqual([]);
  });

  test("a bump that newly gains an install script is flagged on that line, though the entry is not new", () => {
    const text = NPM_LOCK.replace('"left-pad": "1.3.0"', '"left-pad": "1.3.0", "quiet-dep": "1.0.0"');
    const start = lineOf(text, '"node_modules/quiet-dep"');
    const script = lineOf(text, '"hasInstallScript": true', start);
    const patch = [
      `@@ -${start + 1},2 +${start + 1},2 @@`,
      '-      "version": "0.9.0",',
      '+      "version": "1.0.0",',
      `@@ -${script - 1},0 +${script},1 @@`,
      '+      "hasInstallScript": true',
    ].join("\n");
    const { findings } = lockfileFindings([{ filename: "package-lock.json", patch }], (p) => (p === "package-lock.json" ? text : null));
    expect(findings.map((f) => [f.line, f.title])).toEqual([[script, LOCKFILE_MESSAGES.installScript.title]]);
  });
});

describe("lockfile moves, folders and limits", () => {
  const readNpm = (text: string) => (p: string) => (p === "package-lock.json" ? text : null);

  test("an entry npm moved (its block removed and added back under a new key) is not reported", () => {
    const text = NPM_LOCK.replace('"left-pad": "1.3.0"', '"left-pad": "1.3.0", "quiet-dep": "1.0.0"');
    const start = lineOf(text, '"node_modules/quiet-dep"');
    const patch = [
      `@@ -1,5 +${start},5 @@`,
      '-    "node_modules/a/node_modules/quiet-dep": {',
      '-      "hasInstallScript": true',
      '+    "node_modules/quiet-dep": {',
      ...text
        .split("\n")
        .slice(start, start + 3)
        .map((l) => `+${l}`),
    ].join("\n");
    expect(lockfileFindings([{ filename: "package-lock.json", patch }], readNpm(text)).findings).toEqual([]);
  });

  test("an entry npm moved that also gained an install script is reported", () => {
    const text = NPM_LOCK.replace('"left-pad": "1.3.0"', '"left-pad": "1.3.0", "quiet-dep": "1.0.0"');
    const start = lineOf(text, '"node_modules/quiet-dep"');
    const patch = [
      `@@ -1,3 +${start},5 @@`,
      '-    "node_modules/a/node_modules/quiet-dep": {',
      '+    "node_modules/quiet-dep": {',
      ...text
        .split("\n")
        .slice(start, start + 3)
        .map((l) => `+${l}`),
    ].join("\n");
    const { findings } = lockfileFindings([{ filename: "package-lock.json", patch }], readNpm(text));
    expect(findings.map((f) => f.title)).toEqual([LOCKFILE_MESSAGES.installScript.title]);
  });

  test("a removed workspace row does not make a new package of the same name a bump", () => {
    const line = lineOf(BUN_LOCK, '"telemetry-helper": ["telemetry-helper@2.3.1"');
    const patch = [
      `@@ -1,1 +${line},1 @@`,
      '-    "apps/telemetry-helper": {',
      '+    "telemetry-helper": ["telemetry-helper@2.3.1", "", {}, "sha512-d"],',
    ].join("\n");
    const { findings } = lockfileFindings([{ filename: "bun.lock", patch }], (p) => (p === "bun.lock" ? BUN_LOCK : null));
    expect(findings.map((f) => f.title)).toEqual([LOCKFILE_MESSAGES.undeclared.title]);
  });

  test("a lockfile in a folder reads that folder's package.json", () => {
    const patch = `@@ -1,0 +${lineOf(BUN_LOCK, '"telemetry-helper": ["telemetry-helper@2.3.1"')},1 @@\n+    "telemetry-helper": ["telemetry-helper@2.3.1", "", {}, "sha512-d"],`;
    const files: Record<string, string> = {
      "tools/bun.lock": BUN_LOCK,
      "tools/package.json": JSON.stringify({ dependencies: { "telemetry-helper": "2.3.1" } }),
      "tools/apps/web/package.json": "{}",
    };
    const got = lockfileFindings([{ filename: "tools/bun.lock", patch }], (path) => files[path] ?? null);
    expect(got.findings).toEqual([]);
  });

  test("lockfileCheckOf reads the head, treats an oversized file and a symlink out of the head as unreadable", () => {
    const head = mkdtempSync(join(tmpdir(), "lockfile-head-"));
    const outside = mkdtempSync(join(tmpdir(), "lockfile-outside-"));
    writeFileSync(join(outside, "bun.lock"), BUN_LOCK);
    mkdirSync(join(head, "escape"));
    symlinkSync(join(outside, "bun.lock"), join(head, "escape/bun.lock"));
    writeFileSync(join(head, "bun.lock"), "");
    truncateSync(join(head, "bun.lock"), 21 * 1024 * 1024);
    const patch = "@@ -1 +1 @@\n+a";
    const got = lockfileCheckOf(
      [
        { filename: "bun.lock", patch },
        { filename: "escape/bun.lock", patch },
      ],
      head,
    );
    expect(got.findings).toEqual([]);
    expect(got.unchecked.map((u) => u.path)).toEqual(["bun.lock", "escape/bun.lock"]);
  });
});
