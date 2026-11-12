/** The description block (ADR 0033 decisions 7 and 14, spec "The description block"). Pure string work. */
import { describe, expect, test } from "bun:test";
import { BLOCK_END, BLOCK_START, blockDigest, blockRegions, claimsDigest, stripBlock } from "./digest";
import { buildFidelity, type GradeInput } from "./grade";
import { cannotSayBlock, renderBlock, upsertBlock } from "./block";
import type { Claim, Fidelity } from "./types";

const confirmed = (text: string, path: string, line: number, endLine: number): Claim => ({
  text,
  status: "confirmed",
  evidence: [{ path, line, endLine }],
});

const lowMap = { level: "low", facts: [], judgement: [], pathReasons: [], droppedFacts: 0 } as const;
const digest = "ab".repeat(32);

function input(over: Partial<GradeInput> = {}): GradeInput {
  return {
    claims: [
      confirmed("Export button", "src/Toolbar.tsx", 52, 78),
      confirmed("Export function", "src/export.ts", 10, 46),
    ],
    assignments: [
      { path: "src/Toolbar.tsx", claim: 0 },
      { path: "src/export.ts", claim: 1 },
    ],
    changedFiles: [{ path: "src/Toolbar.tsx" }, { path: "src/export.ts" }],
    openFindings: [],
    riskMap: lowMap,
    run: {
      finished: true,
      unreadFiles: 0,
      reviewedCommit: "abc1234",
      headCommit: "abc1234",
      digestAtRead: digest,
      digestAtWrite: digest,
    },
    ...over,
  };
}

const opts = {
  reviewUrl: "https://github.com/o/r/pull/7#pullrequestreview-1",
  reviewedCommit: "abc1234",
  date: "2026-11-11",
  permalinkBase: "https://github.com/o/r",
};

const unexplainedB = (): Fidelity =>
  buildFidelity(input({ changedFiles: [...input().changedFiles, { path: "src/session.ts" }] }));

describe("renderBlock", () => {
  test("a B with one unexplained change is laid out as the spec shows", () => {
    expect(renderBlock(unexplainedB(), opts)).toBe(
      [
        BLOCK_START,
        `<!-- wachiman:digest:${digest} -->`,
        "## 👮 Wachiman · PR Confidence",
        "",
        "> [!WARNING]",
        "> ### B · One unexplained change",
        "> Both claims verified. Look at `src/session.ts`.",
        "",
        "Reviewed at `abc1234` on 2026-11-11 · [full review](<https://github.com/o/r/pull/7#pullrequestreview-1>) · Your check: pending",
        "",
        "| Evidence | Result |",
        "| :--- | :--- |",
        "| Claims verified | ✅ 2 / 2 |",
        "| Unexplained changes | ⚠️ 1 |",
        "| Refutation check | — Not performed |",
        "| Sensitive paths | ✅ None |",
        "",
        "**👀 Your attention**",
        "",
        "- [`src/session.ts`](<https://github.com/o/r/blob/abc1234/src/session.ts>) — no claim in the pull request explains this change.",
        "",
        "<details>",
        "<summary>✅ Verified claims (2/2)</summary>",
        "",
        "- **Export button:** `src/Toolbar.tsx` L52–L78",
        "- **Export function:** `src/export.ts` L10–L46",
        "",
        "</details>",
        "",
        "<sub>👮 Wachiman · measures whether the diff does what the pull request says, not code quality. Edits to the description do not update this block until the next push.</sub>",
        BLOCK_END,
      ].join("\n"),
    );
  });

  test("a line in the attention list links to that line at the reviewed commit", () => {
    const f = buildFidelity(
      input({ openFindings: [{ severity: "fix", path: "src/session.ts", line: 40, title: "Timeout dropped" }] }),
    );
    const out = renderBlock(f, opts);
    expect(out).toContain("- [`src/session.ts` L40](<https://github.com/o/r/blob/abc1234/src/session.ts#L40>) — 🟠 Fix: Timeout dropped");
    expect(out).toContain("> Both claims verified. Look at `src/session.ts` line 40.");
  });

  test("several places in one file are listed under that file", () => {
    const f = buildFidelity(
      input({
        openFindings: [
          { severity: "fix", path: "src/session.ts", line: 40, title: "One" },
          { severity: "consider", path: "src/session.ts", line: 90, title: "Two" },
          { severity: "consider", path: "src/other.ts", line: 3, title: "Three" },
        ],
      }),
    );
    const out = renderBlock(f, opts);
    expect(out).toContain("> Both claims verified. Look at `src/session.ts` line 40.");
    expect(out).toContain("- [`src/other.ts` L3](<https://github.com/o/r/blob/abc1234/src/other.ts#L3>) — 🟡 Consider: Three");
    expect(out).toContain("- [`src/session.ts`](<https://github.com/o/r/blob/abc1234/src/session.ts>)\n  - [L40](<https://github.com/o/r/blob/abc1234/src/session.ts#L40>) — 🟠 Fix: One\n  - [L90](<https://github.com/o/r/blob/abc1234/src/session.ts#L90>) — 🟡 Consider: Two");
  });

  test("every place is listed: nothing is capped", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      severity: "consider" as const,
      path: `src/f${String(i).padStart(2, "0")}.ts`,
      line: 1,
      title: `T${i}`,
    }));
    const out = renderBlock(buildFidelity(input({ openFindings: many })), opts);
    expect(out.match(/🟡 Consider: T/g)).toHaveLength(60);
  });

  test("an A is marked trial, says what A means and how many were judged, and lists no attention", () => {
    const out = renderBlock(buildFidelity(input()), opts);
    expect(out).toContain("> [!TIP]");
    expect(out).toContain("> ### A (trial) · Every claim has cited evidence and no change is unexplained");
    expect(out).toContain("> Trial: no A-graded pull request has been judged yet.");
    expect(out).toContain("not a statement that the pull request is safe to merge unread");
    expect(out).not.toContain("Your attention");
  });

  test("the trial line shows the count and the bound it supports", () => {
    const out = renderBlock(buildFidelity(input({ judgedAGrades: 30 })), opts);
    expect(out).toContain("> Trial: 30 A-graded pull requests judged; with no serious miss that bounds the miss rate below about 9.5%.");
    expect(renderBlock(buildFidelity(input({ judgedAGrades: 1 })), opts)).toContain("Trial: 1 A-graded pull request judged;");
  });

  test("an A- is a trial too and names its question", () => {
    const f = buildFidelity(input({ openFindings: [{ severity: "consider", path: "src/export.ts", line: 12, title: "Naming" }] }));
    const out = renderBlock(f, opts);
    expect(out).toContain("> [!NOTE]");
    expect(out).toContain("> ### A- (trial) · One open Consider finding");
    expect(out).toContain("> Trial:");
  });

  test("the alert type follows the grade", () => {
    const grade = (over: Partial<GradeInput>) => renderBlock(buildFidelity(input(over)), opts);
    expect(grade({ openFindings: [{ severity: "fix", path: "a.ts", line: 1, title: "x" }] })).toContain("> [!WARNING]");
    expect(grade({ openFindings: [{ severity: "blocker", path: "a.ts", line: 1, title: "x" }] })).toContain("> [!CAUTION]");
    expect(grade({ claims: [], assignments: [] })).toContain("> ### C · The pull request does not say what it changes");
    const base = input();
    expect(grade({ run: { ...base.run, unreadFiles: 2 } })).toContain("> [!IMPORTANT]");
  });

  test("unverified and contradicted claims are listed apart from the verified ones", () => {
    const f = buildFidelity(
      input({
        claims: [
          confirmed("Export button", "src/Toolbar.tsx", 52, 78),
          { text: "Is faster", status: "unverified", evidence: [] },
          { text: "Keeps the timeout", status: "contradicted", evidence: [{ path: "src/session.ts", line: 40 }] },
          { text: "Cleans up", status: "vague", evidence: [] },
        ],
      }),
    );
    const out = renderBlock(f, opts);
    expect(out).toContain("| Claims verified | ❌ 1 / 3 · 1 vague, not counted |");
    expect(out).toContain("<summary>✅ Verified claims (1/3)</summary>");
    expect(out).toContain("<summary>⚠️ Claims not verified (3)</summary>");
    expect(out).toContain("- **Is faster:** unverified");
    expect(out).toContain("- **Keeps the timeout:** contradicted");
    expect(out).toContain("- **Cleans up:** vague, counts as no claim");
  });

  test("no checkable claim shows no verified-claims list", () => {
    const out = renderBlock(buildFidelity(input({ claims: [], assignments: [] })), opts);
    expect(out).toContain("| Claims verified | ❌ No checkable claim |");
    expect(out).not.toContain("Verified claims");
  });

  test("sensitive paths are counted", () => {
    const f = buildFidelity(
      input({ riskMap: { ...lowMap, level: "high", facts: [{ kind: "auth", path: "src/login.ts", line: 8, why: "token check" }] } }),
    );
    expect(renderBlock(f, opts)).toContain("| Sensitive paths | ⚠️ 1 |");
  });

  test("a grade of cannot say renders no table, no claims and no letter", () => {
    const f = buildFidelity(input({ run: { ...input().run, finished: false, stoppedBy: "spend-ceiling" } }));
    const out = renderBlock(f, opts);
    expect(out).toContain("> [!IMPORTANT]");
    expect(out).toContain("> ### cannot say · The run stopped at the spend ceiling");
    expect(out).not.toContain("| Evidence |");
    expect(out).not.toContain("Verified claims");
    expect(out).not.toMatch(/### [ABC]/);
  });

  test("a link never points at HEAD or a branch: with no commit hash there is no link", () => {
    const out = renderBlock(unexplainedB(), { ...opts, reviewedCommit: "HEAD" });
    expect(out).not.toContain("/blob/");
    expect(out).toContain("`src/session.ts`");
    const ok = renderBlock(unexplainedB(), opts);
    expect(ok).not.toContain("HEAD");
    expect(ok).toContain("/blob/abc1234/");
  });

  test("a path with parentheses or spaces is kept inside the link", () => {
    const f = buildFidelity(input({ changedFiles: [{ path: "src/a (copy) b.ts" }] , assignments: [] }));
    expect(renderBlock(f, opts)).toContain("](<https://github.com/o/r/blob/abc1234/src/a%20%28copy%29%20b.ts>)");
  });

  test("stamps the block with the digest of the text the claims were read from", () => {
    expect(blockDigest(renderBlock(unexplainedB(), opts))).toBe(digest);
  });

  test("a backslash in model text cannot cancel the escaping of a bracket or a backtick", () => {
    for (const hostile of ["\\[click\\](http://evil.example)", "\\`code\\` \\\\[x\\\\]"]) {
      const claim: Claim = { text: hostile, status: "unverified", evidence: [] };
      const out = renderBlock(buildFidelity(input({ claims: [claim] })), opts);
      // The one line that carries the claim's text has no markup of its own besides the bold marks.
      const line = out.split("\n").find((l) => l.startsWith("- **") && l.endsWith(":** unverified")) ?? "";
      expect(line).not.toBe("");
      const text = line.slice("- **".length, -":** unverified".length);
      // Every bracket and backtick must be preceded by an odd number of backslashes.
      for (const [i, ch] of [...text].entries()) {
        if (!"[]`".includes(ch)) continue;
        let slashes = 0;
        while (slashes < i && text[i - 1 - slashes] === "\\") slashes++;
        expect(slashes % 2).toBe(1);
      }
      expect(text).toMatch(/[\[`]/);
    }
  });

  test("a bare address in model text is broken so GitHub does not autolink it", () => {
    const hostile = "see https://evil.example/x and www.evil.example and ftp://evil.example";
    const f = buildFidelity(
      input({
        claims: [confirmed(hostile, "src/Toolbar.tsx", 52, 78), confirmed("ok", "src/export.ts", 1, 2)],
        openFindings: [{ severity: "fix", path: "src/export.ts", line: 3, title: hostile }],
      }),
    );
    const out = renderBlock(f, opts);
    expect(out).toContain("evil.example");
    expect(out).not.toContain("://evil.example");
    expect(out).not.toContain("www.evil.example");
  });

  test("model text cannot close the block, open a link, mention someone or end the details", () => {
    const hostile = `x ${BLOCK_END} </details> @octocat [click](http://evil.example) <script>\n## heading`;
    const f = buildFidelity(
      input({
        claims: [confirmed(hostile, "src/Toolbar.tsx", 52, 78), confirmed("ok", "src/export.ts", 1, 2)],
        openFindings: [{ severity: "fix", path: "src/export.ts", line: 3, title: hostile }],
      }),
    );
    const out = renderBlock(f, opts);
    expect(blockRegions(out)).toEqual([{ start: 0, end: out.length }]);
    expect(out.split("<details>").length).toBe(out.split("</details>").length);
    expect(out).not.toContain("@octocat");
    expect(out).toContain("\\[click\\]");
    expect(out).not.toMatch(/(?<!\\)\[click/);
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("\n## heading");
  });

  test("a body with the block in it gives the same digest as the author's body without it", () => {
    const body = "Adds an export button.\n\n- one\n";
    const written = upsertBlock(body, renderBlock(unexplainedB(), opts));
    expect(claimsDigest("T", written)).toBe(claimsDigest("T", body));
  });
});

describe("upsertBlock", () => {
  const block = renderBlock(unexplainedB(), opts);

  test("a body with no markers gets the block at the top followed by a blank line", () => {
    expect(upsertBlock("Adds an export button.\n", block)).toBe(`${block}\n\nAdds an export button.\n`);
  });

  test("an empty or missing body is just the block", () => {
    expect(upsertBlock("", block)).toBe(block);
    expect(upsertBlock(null, block)).toBe(block);
    expect(stripBlock(upsertBlock("", block))).toBe("");
    expect(stripBlock(upsertBlock(null, block))).toBe("");
  });

  test("the text outside the markers is byte-identical after the block is rewritten", () => {
    const before = "Intro with  odd   spacing\r\n\r\n";
    const after = "\r\n\r\n- list\r\n\t tabbed\r\nEnd without newline";
    const old = renderBlock(buildFidelity(input()), opts);
    const body = `${before}${old}${after}`;
    const next = upsertBlock(body, block);
    expect(next).toBe(`${before}${block}${after}`);
  });

  test("a second run replaces the block instead of adding one", () => {
    const first = upsertBlock("Body", block);
    const other = renderBlock(buildFidelity(input()), { ...opts, reviewedCommit: "def5678" });
    const second = upsertBlock(first, other);
    expect(second.split(BLOCK_START)).toHaveLength(2);
    expect(second.split(BLOCK_END)).toHaveLength(2);
    expect(second).toBe(`${other}\n\nBody`);
    expect(second).not.toContain("abc1234");
  });

  test("running with the same block twice changes nothing", () => {
    const once = upsertBlock("Body", block);
    expect(upsertBlock(once, block)).toBe(once);
  });

  test("keeps a block an agent moved to the middle where it is", () => {
    const body = `Intro\n\n${renderBlock(buildFidelity(input()), opts)}\n\nOutro`;
    expect(upsertBlock(body, block)).toBe(`Intro\n\n${block}\n\nOutro`);
  });

  test("two blocks in the body collapse to one, in the place of the first", () => {
    const old = renderBlock(buildFidelity(input()), opts);
    const body = `${old}\n\nmiddle\n\n${old}\n\nend`;
    expect(upsertBlock(body, block)).toBe(`${block}\n\nmiddle\n\nend`);
  });

  test("a stray start marker with no end is text, and a new block is added at the top", () => {
    const body = `${BLOCK_START}\nhalf\n\nBody`;
    expect(upsertBlock(body, block)).toBe(`${block}\n\n${body}`);
  });

  test("refuses text that is not one whole block", () => {
    expect(() => upsertBlock("Body", "not a block")).toThrow();
    expect(() => upsertBlock("Body", `${BLOCK_START}\nno end`)).toThrow();
    expect(() => upsertBlock("Body", `${block}\n\ntrailing`)).toThrow();
  });
});

describe("cannotSayBlock", () => {
  test("shows cannot say for the new commit and no letter or commit from the earlier one", () => {
    const previous = renderBlock(buildFidelity(input({ changedFiles: [{ path: "src/session.ts" }] , assignments: []})), {
      ...opts,
      reviewedCommit: "old1111",
    });
    expect(previous).toContain("### B");
    const body = upsertBlock("Adds an export button.", previous);
    const reset = upsertBlock(body, cannotSayBlock("new2222", "The review of the new commit has not finished"));
    expect(reset).toContain("cannot say");
    expect(reset).toContain("new2222");
    expect(reset).not.toContain("old1111");
    expect(reset).not.toMatch(/### [ABC]/);
    expect(reset).not.toContain("[!WARNING]");
    expect(reset).not.toContain("| Evidence |");
    expect(stripBlock(reset)).toBe("Adds an export button.");
  });

  test("is one whole block, stamped with no digest and linking no file", () => {
    const out = cannotSayBlock("new2222", "The run was cancelled", { date: "2026-11-12", reviewUrl: "https://github.com/o/r/pull/7" });
    expect(blockRegions(out)).toEqual([{ start: 0, end: out.length }]);
    expect(blockDigest(out)).toBeUndefined();
    expect(out).toContain("> [!IMPORTANT]");
    expect(out).toContain("> ### cannot say · The run was cancelled");
    expect(out).toContain("A grade from an earlier commit does not apply to it.");
    expect(out).toContain("2026-11-12");
    expect(out).not.toContain("/blob/");
  });

  test("without a date it shows the commit alone", () => {
    expect(cannotSayBlock("new2222", "The run was cancelled")).toContain("\nCommit `new2222`\n");
  });

  test("neutralises its reason", () => {
    const out = cannotSayBlock("new2222", `x ${BLOCK_END} @octocat`);
    expect(blockRegions(out)).toEqual([{ start: 0, end: out.length }]);
    expect(out).not.toContain("@octocat");
  });
});
