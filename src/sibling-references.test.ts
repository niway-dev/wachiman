import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedSibling } from "./distributed";
import { checkSiblingReferences, REMOVED_REFERENCE, settleModelText } from "./sibling-references";

// ADR 0043 decision 3: a reference into a sibling survives only if the member is one the run read,
// the sha is that snapshot's commit, and the line exists in that snapshot. The names are invented.

const SHA = "3f2a9c1".padEnd(40, "0");
const OTHER = "9d8e7f6".padEnd(40, "0");

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function snapshot(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "sibling-refs-"));
  made.push(dir);
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

  test("the verifier's reasons and the summary are checked too, and their removals count", () => {
    const bad = "desktop-app@3f2a9c1:Assets/palette.json:40";
    const good = "desktop-app@3f2a9c1:Assets/palette.json:2";
    const input = [{ title: "t", body: "b", verification: { reason: `Confirmed at ${bad}` }, originReason: `Introduced near ${bad}` }];
    const { findings, removed, texts } = checkSiblingReferences([sibling()], input, [`Summary: ${bad} and ${good}`]);
    expect(removed).toBe(3);
    expect(findings[0]!.verification!.reason).toBe(`Confirmed at ${REMOVED_REFERENCE}`);
    expect(findings[0]!.originReason).toBe(`Introduced near ${REMOVED_REFERENCE}`);
    expect(findings[0]!.references).toBeUndefined();
    expect(texts).toEqual([`Summary: ${REMOVED_REFERENCE} and ${good}`]);
  });

  describe("a member whose dir has several components", () => {
    const nested = () => sibling({ member: "apps/desktop" });

    test("is checked like any other: a good reference stays, a missing line is removed and counted", () => {
      const good = check("See apps/desktop@3f2a9c1:Assets/palette.json:2 for the source.", [nested()]);
      expect(good.removed).toBe(0);
      expect(good.finding.references).toEqual([{ member: "apps/desktop", sha: SHA, path: "Assets/palette.json", line: 2 }]);
      const bad = check("See apps/desktop@3f2a9c1:Assets/palette.json:999 for the source.", [nested()]);
      expect(bad.removed).toBe(1);
      expect(bad.finding.references).toBeUndefined();
      expect(bad.finding.body).toBe(`See ${REMOVED_REFERENCE} for the source.`);
    });

    test("does not let a shorter member name match the end of a longer one", () => {
      const short = sibling({ member: "desktop", dir: snapshot({ "x.json": "1\n" }), paths: ["x.json"] });
      const { finding: f, removed } = check("apps/desktop@3f2a9c1:Assets/palette.json:2 and desktop@3f2a9c1:x.json:1", [nested(), short]);
      expect(removed).toBe(0);
      expect(f.references?.map((r) => r.member)).toEqual(["apps/desktop", "desktop"]);
    });

    test("one that names no member of the run is removed and counted, however many components it has", () => {
      for (const token of ["apps/mobile@3f2a9c1:Assets/palette.json:2", "a/b/c@3f2a9c1:Assets/palette.json:2", "apps/desktop/extra@3f2a9c1:Assets/palette.json:2"]) {
        const { finding: f, removed } = check(`Look at ${token}.`, [nested()]);
        expect(removed).toBe(1);
        expect(f.body).toBe(`Look at ${REMOVED_REFERENCE}.`);
      }
    });

    test("a member name with regular-expression characters matches only itself", () => {
      const odd = sibling({ member: "c++.app" });
      expect(check("c++.app@3f2a9c1:Assets/palette.json:2", [odd]).removed).toBe(0);
      expect(check("cxx.app@3f2a9c1:Assets/palette.json:2", [odd]).removed).toBe(1);
    });
  });

  test("a file too big to count lines in cannot be checked: its reference is removed and counted, whatever the line", () => {
    const dir = snapshot({ "small.json": "1\n2\n" });
    writeFileSync(join(dir, "big.log"), Buffer.alloc(8 * 1024 * 1024 + 1, "a\n"));
    const siblings = [sibling({ dir, paths: ["small.json", "big.log"] })];
    const big = check("See desktop-app@3f2a9c1:big.log:999999999", siblings);
    expect(big.removed).toBe(1);
    expect(big.finding.references).toBeUndefined();
    expect(big.finding.body).toBe(`See ${REMOVED_REFERENCE}`);
    expect(check("See desktop-app@3f2a9c1:small.json:2", siblings).removed).toBe(0);
  });
});

describe("settleModelText", () => {
  const bad = "desktop-app@3f2a9c1:Assets/palette.json:40";
  const good = "desktop-app@3f2a9c1:Assets/palette.json:2";

  test("checks every model-written field of the result, leaves the engine's fields alone and counts once", () => {
    const out = settleModelText([sibling()], {
      findings: [{ title: `t ${bad}`, body: `b ${good}` }],
      summary: `s ${bad}`,
      contracts: [{ action: "a", before_after: `x ${bad}`, open_question: `y ${bad}`, location: `src/a.ts:1 ${bad}` } as Record<string, string>],
      riskFacts: [{ why: `r ${bad}`, path: `${bad}` }],
      judgement: [{ why: `j ${bad}` }],
      verification: { status: "verified", entries: [{ title: `e ${bad}`, reason: `er ${bad}`, originReason: `eo ${bad}`, path: "src/a.ts" }] },
      muted: [{ title: `m ${bad}`, reason: `mr ${bad}`, entry: "id" }],
      threadReplies: [{ reply: `p ${bad}`, comment_id: 1 }],
      skipped: [{ path: "x", reason: `k ${bad}` }],
      texts: [`n ${bad}`],
    });
    const gone = REMOVED_REFERENCE;
    expect(out.findings[0]).toMatchObject({ title: `t ${gone}`, body: `b ${good}`, references: [{ member: "desktop-app", sha: SHA, path: "Assets/palette.json", line: 2 }] });
    expect(out.summary).toBe(`s ${gone}`);
    expect(out.contracts[0]).toEqual({ action: "a", before_after: `x ${gone}`, open_question: `y ${gone}`, location: `src/a.ts:1 ${bad}` });
    expect(out.riskFacts[0]).toEqual({ why: `r ${gone}`, path: bad });
    expect(out.judgement[0]).toEqual({ why: `j ${gone}` });
    expect(out.verification).toEqual({ status: "verified", entries: [{ title: `e ${gone}`, reason: `er ${gone}`, originReason: `eo ${gone}`, path: "src/a.ts" }] });
    expect(out.muted[0]).toEqual({ title: `m ${gone}`, reason: `mr ${gone}`, entry: "id" });
    expect(out.threadReplies[0]).toEqual({ reply: `p ${gone}`, comment_id: 1 });
    expect(out.skipped[0]).toEqual({ path: "x", reason: `k ${gone}` });
    expect(out.texts).toEqual([`n ${gone}`]);
    // title, summary, 2 contract fields, fact, judgement, 3 entry fields, 2 muted, reply, skipped, text
    expect(out.removed).toBe(14);
  });

  test("a result with nothing to settle comes back with no verification invented", () => {
    const out = settleModelText([sibling()], { findings: [], summary: "", contracts: [], riskFacts: [], judgement: [], muted: [], threadReplies: [], skipped: [] });
    expect(out.verification).toBeUndefined();
    expect(out.removed).toBe(0);
  });
});
