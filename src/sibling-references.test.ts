import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedSibling } from "./distributed";
import { checkSiblingReferences, REMOVED_REFERENCE } from "./sibling-references";

// ADR 0043 decision 3: a reference into a sibling survives only if the member is one the run read,
// the sha is that snapshot's commit, and the line exists in that snapshot. The names are invented.

const SHA = "3f2a9c1".padEnd(40, "0");
const OTHER = "9d8e7f6".padEnd(40, "0");

function snapshot(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "sibling-refs-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path.split("/").slice(0, -1).join("/") || "."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const sibling = (over: Partial<ResolvedSibling> = {}): ResolvedSibling => ({
  member: "desktop-app",
  repo: "acme/desktop-app",
  visibility: "private",
  contracts: ["brand-palette"],
  byHand: false,
  rule: "tip",
  ruleSource: "default",
  readAs: "tip",
  sha: SHA,
  paths: ["Assets/palette.json"],
  status: "read",
  dir: snapshot({ "Assets/palette.json": '{\n  "accent": "#112233",\n  "ink": "#000000"\n}\n' }),
  droppedSymlinks: [],
  droppedSubmodules: [],
  ...over,
});

const finding = (body: string, title = "Accent drifts") => ({ title, body });
const check = (body: string, siblings: ResolvedSibling[] = [sibling()], title?: string) => {
  const { findings, removed } = checkSiblingReferences(siblings, [finding(body, title)]);
  return { finding: findings[0]!, removed };
};

describe("checkSiblingReferences", () => {
  test("keeps a reference whose member, commit and line exist, and records it with the full commit", () => {
    const { finding: f, removed } = check("The source says `desktop-app@3f2a9c1:Assets/palette.json:2`, the copy differs.");
    expect(removed).toBe(0);
    expect(f.references).toEqual([{ member: "desktop-app", sha: SHA, path: "Assets/palette.json", line: 2 }]);
    expect(f.body).toBe("The source says `desktop-app@3f2a9c1:Assets/palette.json:2`, the copy differs.");
  });

  test("accepts the full commit in the text, and the last line of the file", () => {
    const { finding: f, removed } = check(`See desktop-app@${SHA}:Assets/palette.json:4.`);
    expect(removed).toBe(0);
    expect(f.references).toEqual([{ member: "desktop-app", sha: SHA, path: "Assets/palette.json", line: 4 }]);
  });

  test("a range is kept only when both ends exist, and records its first line", () => {
    expect(check("desktop-app@3f2a9c1:Assets/palette.json:2-3 differs").finding.references).toEqual([{ member: "desktop-app", sha: SHA, path: "Assets/palette.json", line: 2 }]);
    const bad = check("desktop-app@3f2a9c1:Assets/palette.json:2-9 differs");
    expect(bad.removed).toBe(1);
    expect(bad.finding.references).toBeUndefined();
  });

  test("a finding with no sibling reference is returned as it was, with no references field", () => {
    const input = [{ title: "t", body: "plain text with src/a.ts:12 and mail me@example.org" }];
    const { findings, removed } = checkSiblingReferences([sibling()], input);
    expect(removed).toBe(0);
    expect(findings[0]).toEqual(input[0]!);
    expect("references" in findings[0]!).toBe(false);
  });

  test.each([
    ["a member the run did not read", "billing-service@3f2a9c1:Assets/palette.json:2"],
    ["the right member at another commit", `desktop-app@${OTHER.slice(0, 7)}:Assets/palette.json:2`],
    ["a line past the end of the file", "desktop-app@3f2a9c1:Assets/palette.json:5"],
    ["line 0", "desktop-app@3f2a9c1:Assets/palette.json:0"],
    ["a file the snapshot does not hold", "desktop-app@3f2a9c1:Assets/missing.json:1"],
    ["a path that leaves the snapshot", "desktop-app@3f2a9c1:../outside.json:1"],
    ["an absolute path", "desktop-app@3f2a9c1:/etc/hosts:1"],
  ])("removes a reference to %s, counts it and says so in the text", (_, token) => {
    const { finding: f, removed } = check(`Look at ${token} for the source.`);
    expect(removed).toBe(1);
    expect(f.references).toBeUndefined();
    expect(f.body).toBe(`Look at ${REMOVED_REFERENCE} for the source.`);
  });

  test("a commit shorter than 7 characters never matches, whatever it is a prefix of", () => {
    const { removed } = check("desktop-app@3f2a:Assets/palette.json:2");
    // Not a reference shape at all: nothing to remove or keep.
    expect(removed).toBe(0);
  });

  test("a sibling that was not read has nothing to check a reference against", () => {
    const missing = sibling({ status: "not-cloned", sha: undefined, dir: undefined, paths: [] });
    const { removed, finding: f } = check("desktop-app@3f2a9c1:Assets/palette.json:2", [missing]);
    expect(removed).toBe(1);
    expect(f.references).toBeUndefined();
  });

  test("a symlink in the snapshot is not followed out of it", () => {
    const outside = snapshot({ "secret.txt": "one\ntwo\n" });
    const dir = snapshot({ "Assets/palette.json": "{}\n" });
    symlinkSync(join(outside, "secret.txt"), join(dir, "Assets/link.json"));
    const { removed } = check("desktop-app@3f2a9c1:Assets/link.json:1", [sibling({ dir, paths: ["Assets/palette.json", "Assets/link.json"] })]);
    expect(removed).toBe(1);
  });

  test("keeps the good references and removes the bad ones of the same finding; the title counts too", () => {
    const { finding: f, removed } = check(
      "Source: desktop-app@3f2a9c1:Assets/palette.json:2. Also desktop-app@3f2a9c1:Assets/palette.json:40 and desktop-app@3f2a9c1:Assets/palette.json:2 again.",
      [sibling()],
      "Drift against desktop-app@3f2a9c1:Assets/palette.json:99",
    );
    expect(removed).toBe(2);
    expect(f.references).toEqual([{ member: "desktop-app", sha: SHA, path: "Assets/palette.json", line: 2 }]);
    expect(f.title).toBe(`Drift against ${REMOVED_REFERENCE}`);
    expect(f.body).toContain(`Also ${REMOVED_REFERENCE} and desktop-app@3f2a9c1:Assets/palette.json:2 again.`);
  });

  test("two snapshots of one member at different commits are told apart by the commit", () => {
    const a = sibling({ dir: snapshot({ "x.json": "1\n" }), paths: ["x.json"] });
    const b = sibling({ sha: OTHER, dir: snapshot({ "x.json": "1\n2\n3\n" }), paths: ["x.json"] });
    const { finding: f, removed } = check(`desktop-app@3f2a9c1:x.json:3 and desktop-app@9d8e7f6:x.json:3`, [a, b]);
    expect(removed).toBe(1);
    expect(f.references).toEqual([{ member: "desktop-app", sha: OTHER, path: "x.json", line: 3 }]);
  });
});
