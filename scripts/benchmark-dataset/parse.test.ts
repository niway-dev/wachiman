import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractRunLog, hasWachimanSignature, isWachimanComment, parseLegacyNote, parseBodyFindings, parseCodeRabbit, parseCodeRabbitBody, parseContractLine, parseContracts, parseCsv,
  parsePullfrog, parseWachimanHeader, parseWachimanReview, splitLogLine, toCsv,
} from "./parse.ts";

// Every fixture below is a real string from the snapshots in docs/benchmark/dataset/raw.

describe("parseWachimanHeader", () => {
  test("kaipu-bench-wachi PR #20, export-page.tsx:363", () => {
    const body =
      "👮 **Wachiman** · 🟡📝 **Consider · docs: The stage's 1440p / 4K and Fill / Fit groups do not handle their own arrow keys (confidence high)**\n\n`destinationStep` skips ←/→";
    expect(parseWachimanHeader(body)).toEqual({
      severity: "consider",
      topic: "docs",
      confidence: "high",
      title: "The stage's 1440p / 4K and Fill / Fit groups do not handle their own arrow keys",
    });
  });

  test("a Fix with medium confidence", () => {
    const h = parseWachimanHeader(
      "👮 **Wachiman** · 🟠🐛 **Fix · bug: A file dropped on the Library now hits Electron's default and navigates the window away from the app (confidence medium)**\n\nThis change",
    );
    expect(h?.severity).toBe("fix");
    expect(h?.topic).toBe("bug");
    expect(h?.confidence).toBe("medium");
    expect(h?.title).toBe("A file dropped on the Library now hits Electron's default and navigates the window away from the app");
  });

  test("a label with no confidence (before v1.4.0) keeps the title whole", () => {
    const h = parseWachimanHeader("👮 **Wachiman** · 🟠📝 **Fix · docs: `releaseAll`'s doc comment is now attached to `releaseWebcam`**\n\nbody");
    expect(h).toEqual({ severity: "fix", topic: "docs", confidence: "", title: "`releaseAll`'s doc comment is now attached to `releaseWebcam`" });
  });

  test("question topic and low confidence", () => {
    const h = parseWachimanHeader(
      "👮 **Wachiman** · 🟡❓ **Consider · question: Hand-off does not check the recording still exists, unlike the toast's `openSavedScreenshot` (confidence low)**",
    );
    expect(h?.topic).toBe("question");
    expect(h?.confidence).toBe("low");
  });

  test("a title that itself contains parentheses", () => {
    const h = parseWachimanHeader("👮 **Wachiman** · 🟡🧪 **Consider · tests: The \"late frame is dropped (and closed)\" path is never tested (confidence high)**");
    expect(h?.title).toBe('The "late frame is dropped (and closed)" path is never tested');
    expect(h?.confidence).toBe("high");
  });

  test("blocker and info words", () => {
    expect(parseWachimanHeader("👮 **Wachiman** · 🔴🔐 **Blocker · security: Token in logs (confidence high)**")?.severity).toBe("blocker");
    expect(parseWachimanHeader("👮 **Wachiman** · ⚪📝 **Info · docs: Seven destinations, code has six**")?.severity).toBe("info");
  });

  test("the older engine (v1.2.x) posted the bare label with no brand", () => {
    const body = "🟡🧪 **Consider · tests: New `metadataIssue` branch of isCloudUploadEligible is untested**\n\n`library-item.ts:114-118` adds";
    expect(parseWachimanHeader(body)).toEqual({ severity: "consider", topic: "tests", confidence: "", title: "New `metadataIssue` branch of isCloudUploadEligible is untested" });
    expect(isWachimanComment(body, "github-actions[bot]")).toBe(true);
    expect(isWachimanComment(body, "csdev19")).toBe(false);
  });

  test("the first engine labels (v1.0.x) were a Note with a category and no severity", () => {
    expect(parseLegacyNote("**Note (correctness): Any `info` token is treated as a failure**\n\nbody")).toEqual({ category: "correctness", title: "Any `info` token is treated as a failure" });
    expect(isWachimanComment("**Note (security): Installer is unpinned**\n\nbody", "github-actions[bot]")).toBe(true);
    expect(parseLegacyNote("Note: something")).toBeNull();
  });

  test("not a Wachiman finding", () => {
    expect(parseWachimanHeader("Looks good to me")).toBeNull();
    expect(parseWachimanHeader("👮 **Wachiman** · review of the whole pull request")).toBeNull();
  });
});

describe("signature", () => {
  test("recognises the brand, the marker and the old marker", () => {
    expect(hasWachimanSignature("👮 **Wachiman** · review")).toBe(true);
    expect(hasWachimanSignature("<!-- agent-review sha=b12d760bd90b1e9619bab115f500f9c1a30cccf3 -->")).toBe(true);
    expect(hasWachimanSignature("<!-- claude-review sha=abc123 -->")).toBe(true);
    expect(hasWachimanSignature("> ℹ️ No critical issues.")).toBe(false);
  });
});

const BODY = `👮 **Wachiman** · review of the whole pull request, at \`3ec7a13\`: all 23 files reviewed.

6 finding(s): 6 to consider; 5 on their lines. Reply in a comment's thread to answer it.

### Outside the diff

- 🟡📝 **Consider · docs: Sections 2 and 3.2 still say a camera turned off ends the webcam file (confidence high)** (\`apps/documentation/src/content/docs/specs/2026-10-30-webcam-track-design.md:329\`): The PR rewrote decision 7 so that the file keeps running.

### For your information

- ⚪📝 **Info · docs: Seven destinations, code has six** (\`prepare-screen.md:114\`): The design has seven; the code has six.
  A second line of the same finding.
- ⚪🧹 **Info · cleanup: Leftover** (\`a.ts\`): Whole-file finding.

### Summary

**Batch 1 of 2.** Fine.

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 2 | 13 | 777 | 4 | reviewed | 13 | $0.57 |
| Batch 2 of 2 | 5 | 987 | 4 | reviewed | 16 | $0.65 |

</details>

<sub>Claude Opus 5.5 via Claude Code 2.1.304 · effort high · 2 batches · $1.22</sub>

<!-- wachi:review -->

<!-- agent-review sha=3ec7a13aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -->

<!-- wachi:attempt id=174cef5b-c62e-4e63-ae90-e066f9681b3d -->`;

describe("parseBodyFindings", () => {
  test("outside the diff and for your information, with a path and a line", () => {
    const f = parseBodyFindings(BODY);
    expect(f).toHaveLength(3);
    expect(f[0]).toMatchObject({
      section: "outside-diff", severity: "consider", topic: "docs", confidence: "high", line: 329,
      path: "apps/documentation/src/content/docs/specs/2026-10-30-webcam-track-design.md",
      text: "The PR rewrote decision 7 so that the file keeps running.",
    });
    expect(f[1]).toMatchObject({ section: "for-your-information", severity: "info", path: "prepare-screen.md", line: 114, confidence: "" });
    expect(f[1]?.text).toContain("A second line of the same finding.");
    expect(f[2]).toMatchObject({ path: "a.ts", line: 0 });
  });

  test("findings GitHub refused inline are read from the moved form", () => {
    const body = [
      "### On their lines (GitHub refused them inline)",
      "",
      "- `src/a.ts:12`: 👮 **Wachiman** · 🟠🐛 **Fix · bug: Off by one (confidence medium)** The loop stops one early.",
      "- … and 3 more not shown (GitHub refused them inline).",
      "",
      "### Summary",
    ].join("\n");
    const f = parseBodyFindings(body);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ section: "moved-from-lines", path: "src/a.ts", line: 12, severity: "fix", title: "Off by one", text: "The loop stops one early." });
  });
});

describe("parseWachimanReview", () => {
  test("the v1.2.x review header says Agent review, with no brand and no effort in the footer", () => {
    const body = "**Agent review** of the whole pull request, at `c59e58f`: all 16 files reviewed.\n\n2 finding(s): 2 to consider; 2 on their lines. Reply in a comment's thread to answer it.\n\n### Summary\n\nFine.\n\n<sub>Claude Opus 5.5 via Claude Code 2.1.304 · $0.21</sub>\n\n<!-- agent-review sha=c59e58fb89d3c5bc3ce2b0e122f8fb93e59c1074 -->";
    expect(parseWachimanReview(body)).toMatchObject({ head_sha_short: "c59e58f", findings_total: 2, inline_count: 2, model_label: "Claude Opus 5.5", effort: "", cost_usd: 0.21 });
  });

  test("header, counts, footer, coverage and markers", () => {
    const r = parseWachimanReview(BODY);
    expect(r).toMatchObject({
      head_sha_short: "3ec7a13", scope: "the whole pull request", partial: false, findings_total: 6, inline_count: 5,
      model_label: "Claude Opus 5.5", claude_code_version: "2.1.304", effort: "high", batch_count: 2, cost_usd: 1.22,
      review_sha: "3ec7a13aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", attempt_id: "174cef5b-c62e-4e63-ae90-e066f9681b3d",
    });
    expect(r?.batches).toHaveLength(2);
    expect(r?.batches[1]).toMatchObject({ batch: "Batch 2 of 2", files: 5, lines: 987, turns: 16, cost_usd: 0.65 });
    expect(r?.contracts).toEqual([]);
  });

  test("a body that is not Wachiman's", () => {
    expect(parseWachimanReview("> ℹ️ No critical issues. One rough edge inline.")).toBeNull();
  });
});

describe("contracts", () => {
  const CLOSED =
    "- Library no longer mounts the window-wide file drop handler (useFileDrop removed) (`apps/kaipu-record/src/renderer/src/pages/library/library-page.tsx:53`) — A dropped file falls back to Electron's default handling, which navigates the window to the file instead of doing nothing. If it fails: The renderer navigates away from the app with no error, and renderer state (including a running export) is lost. Evidence: `apps/kaipu-record/src/renderer/src/features/library/hooks/use-file-drop.ts:8-11`, `apps/kaipu-record/src/main/index.ts:400`.";
  const OPEN =
    "- The no-video Export screen hosts the Library picker inside a non-scrolling drop zone wrap (`apps/kaipu-record/src/renderer/src/pages/export/export-drop-zone.module.css:2-11`) — Does the panel actually overflow .screen at the default 900×670 window, given the real header and Recent exports heights? Files that would answer it: `apps/kaipu-record/src/renderer/src/pages/export/recent-exports.tsx`, `apps/kaipu-record/src/renderer/src/pages/export/export-header.tsx`.";

  test("a closed contract keeps its parenthesised action, effect, failure and evidence", () => {
    const c = parseContractLine(CLOSED, "closed");
    expect(c).toMatchObject({
      action: "Library no longer mounts the window-wide file drop handler (useFileDrop removed)",
      location: "apps/kaipu-record/src/renderer/src/pages/library/library-page.tsx:53",
      status: "closed",
      evidence_checked: true,
    });
    expect(c?.effect).toStartWith("A dropped file falls back to Electron's default handling");
    expect(c?.failure_mode).toStartWith("The renderer navigates away from the app with no error");
    expect(c?.evidence).toEqual(["apps/kaipu-record/src/renderer/src/features/library/hooks/use-file-drop.ts:8-11", "apps/kaipu-record/src/main/index.ts:400"]);
  });

  test("an open contract keeps its question and candidate files", () => {
    const c = parseContractLine(OPEN, "open");
    expect(c?.status).toBe("open");
    expect(c?.location).toBe("apps/kaipu-record/src/renderer/src/pages/export/export-drop-zone.module.css:2-11");
    expect(c?.open_question).toStartWith("Does the panel actually overflow .screen");
    expect(c?.candidates).toHaveLength(2);
  });

  test("an unresolved citation is flagged", () => {
    const c = parseContractLine("- Thing (`a.ts:1`) — Does it. Evidence: `a.ts:1`. ⚠️ A citation did not resolve in the head.", "closed");
    expect(c?.evidence_checked).toBe(false);
    expect(c?.evidence).toEqual(["a.ts:1"]);
  });

  test("the whole block, with the header counts and the size-limit note", () => {
    const body = `intro\n\n<details><summary>What the change connects to (1 closed, 1 open)</summary>\n\nQuestions.\n\n**Open: the reviewer could not close these**\n${OPEN}\n\n**Closed, with the lines they rest on**\n${CLOSED}\n- … and 4 more not shown (size limit).\n\n</details>\n\ntail`;
    const r = parseContracts(body);
    expect(r.header).toBe("1 closed, 1 open");
    expect(r.contracts.map((c) => c.status)).toEqual(["open", "closed"]);
    expect(r.hidden).toBe(4);
  });

  test("no block", () => {
    expect(parseContracts(BODY)).toEqual({ header: "", contracts: [], hidden: 0 });
  });
});

describe("Pullfrog and CodeRabbit", () => {
  test("CodeRabbit keeps its own severity, category and tag, and takes the bold title", () => {
    const body =
      '<!-- coderabbit-ai-generated:v1 -->\n\n**<picture><img src="https://storage.googleapis.com/coderabbit_public_assets/review-comment-icons-v1/amber-16.svg" width="16" height="16" align="absmiddle" alt=""></picture> Minor** · **Stability & Availability** · **Quick win**\n\n**Destroy the window when its renderer fails to load. Otherwise the card never appears again in that session.**\n\n`load` calls `void browserWindow.loadURL(...)`.';
    expect(parseCodeRabbit(body)).toEqual({
      native_severity: "Minor",
      native_category: "Stability & Availability",
      native_tags: "Quick win",
      title: "Destroy the window when its renderer fails to load. Otherwise the card never appears again in that session.",
    });
  });

  test("CodeRabbit with a nested icon inside the tag list", () => {
    const body =
      '**<picture><img src="x/major-16.svg" alt=""></picture> Major** · **Security & Privacy** · **<picture><source srcset="y"><img src="z" alt=""></picture> Detected with Advanced Tier** · **Heavy lift**\n\n**Validate the id.**';
    const r = parseCodeRabbit(body);
    expect(r.native_severity).toBe("Major");
    expect(r.native_tags).toBe("Detected with Advanced Tier · Heavy lift");
    expect(r.title).toBe("Validate the id.");
  });

  test("CodeRabbit findings listed only in the review body, from kaipu-record #483", () => {
    const body = [
      "**Actionable comments posted: 1**",
      "",
      "> **⚠️ Outside diff range comments (1)**",
      "> ",
      "> <details>",
      "> <dl>",
      "> <dd>",
      "> ",
      "> `apps/kaipu-record/src/renderer/src/pages/library/library-page.tsx:480-483`",
      '> **<picture><img src="https://storage.googleapis.com/coderabbit_public_assets/review-comment-icons-v1/amber-16.svg" width="16" height="16" align="absmiddle" alt=""></picture> Minor** · **Functional Correctness** · **Quick win**',
      "> ",
      "> **Disable Edit and Prepare for evicted media.**",
      "> ",
      "> If an evicted screenshot has a local ID, `canOpenInEditor()` still enables Edit.",
    ].join("\n");
    expect(parseCodeRabbitBody(body)).toEqual([
      {
        native_severity: "Minor", native_category: "Functional Correctness", native_tags: "Quick win", title: "Disable Edit and Prepare for evicted media.",
        path: "apps/kaipu-record/src/renderer/src/pages/library/library-page.tsx", line: 480, section: "Outside diff range comments",
      },
    ]);
    expect(parseCodeRabbitBody("**Actionable comments posted: 0**")).toEqual([]);
  });

  test("Pullfrog has no labels: severity stays empty, the title is the first sentence", () => {
    const r = parsePullfrog("This closes the gap too early when the camera goes on, off and on again while the first re-open is still pending. The off is not queued.");
    expect(r.native_severity).toBe("");
    expect(r.title).toBe("This closes the gap too early when the camera goes on, off and on again while the first re-open is still pending.");
    expect(parsePullfrog("Nit: this doc comment still says the card stays.").native_severity).toBe("nit");
  });
});

describe("run logs", () => {
  const P = "review / Agent on demand\tUNKNOWN STEP\t";
  const LOG = [
    `${P}﻿2026-11-02T03:13:10.5344468Z Current runner version: '2.338.2'`,
    `${P}2026-11-02T03:13:11.3538749Z Uses: niway-dev/wachiman/.github/workflows/review.yml@refs/tags/v1.4.0 (e09fc2d6039d7617f727508754c0274cd042c959)`,
    `${P}2026-11-02T03:13:16.8232222Z   CLAUDE_CODE_VERSION: 2.1.304`,
    `${P}2026-11-02T03:13:20.9742987Z   AGENT_REVIEW_MODEL: claude-opus-5-5`,
    `${P}2026-11-02T03:13:20.9743279Z   AGENT_REVIEW_EFFORT: high`,
    `${P}2026-11-02T03:13:20.9744193Z   AGENT_REVIEW_PROVIDER: claude-code`,
    `${P}2026-11-02T03:13:20.9744938Z ##[endgroup]`,
    `${P}2026-11-02T03:13:23.9268247Z evidence: 35 symbol(s) found, 24 call site(s), 15690 bytes, 180 ms, truncated`,
    `${P}2026-11-02T03:15:01.9754391Z {"is_error":false,"terminal_reason":"success","turns":13,"cost_usd":0.5707182,"duration_ms":96873}`,
    `${P}2026-11-02T03:16:26.0331064Z {"is_error":false,"terminal_reason":"success","turns":16,"cost_usd":0.6502948000000001,"duration_ms":83093}`,
    `${P}2026-11-02T03:16:27.0000000Z Confidence rule: 2 finding(s) with low confidence at severity fix or above posted as questions.`,
    `${P}2026-11-02T03:19:57.3430873Z Post job cleanup.`,
    `${P}2026-11-02T03:19:58.4111834Z Temporarily overriding HOME='/home/runner/work/_temp/x'`,
  ].join("\n");

  test("splits the job, step and timestamp prefix, including a byte-order mark", () => {
    expect(splitLogLine(`${P}﻿2026-11-02T03:13:10.5344468Z Current runner version`)).toEqual({ ts: "2026-11-02T03:13:10.5344468Z", text: "Current runner version" });
  });

  test("model, version, cost, duration and the engine lines", () => {
    const r = extractRunLog(LOG);
    expect(r).toMatchObject({
      version: "v1.4.0", model: "claude-opus-5-5", effort: "high", provider: "claude-code", claude_code_version: "2.1.304",
      workflow_ref: "niway-dev/wachiman/.github/workflows/review.yml@refs/tags/v1.4.0",
    });
    expect(r.calls).toHaveLength(2);
    expect(r.cost_usd).toBe(1.2210);
    expect(r.duration_ms).toBe(179966);
    expect(r.confidence_rule).toEqual(["Confidence rule: 2 finding(s) with low confidence at severity fix or above posted as questions."]);
    expect(r.engine_lines[0]).toStartWith("evidence: 35 symbol(s)");
    expect(r.engine_lines).toHaveLength(4);
  });
});

describe("csv", () => {
  test("round-trips quotes, commas and newlines", () => {
    const rows = [{ a: "x", b: 'say "hi", ok', c: "two\nlines" }, { a: "", b: "plain", c: 3 }];
    const text = toCsv(["a", "b", "c"], rows);
    expect(parseCsv(text)).toEqual([{ a: "x", b: 'say "hi", ok', c: "two\nlines" }, { a: "", b: "plain", c: "3" }]);
  });
});

// The committed snapshots are the real test of the parsers: every Wachiman comment must parse.
describe("snapshots", () => {
  const raw = join(import.meta.dir, "../../docs/benchmark/dataset/raw");
  const repos = existsSync(raw) ? readdirSync(raw).filter((d) => !d.startsWith("_")) : [];
  test.skipIf(repos.length === 0)("every Wachiman inline comment header parses (label, or the v1.0.x Note)", () => {
    let seen = 0;
    for (const repo of repos) {
      for (const dir of readdirSync(join(raw, repo)).filter((d) => d.startsWith("pr-"))) {
        const comments = JSON.parse(readFileSync(join(raw, repo, dir, "review-comments.json"), "utf8")) as { id: number; body: string; in_reply_to_id: number | null }[];
        for (const c of comments) {
          if (c.in_reply_to_id || !isWachimanComment(c.body, "github-actions[bot]")) continue;
          seen++;
          expect(parseWachimanHeader(c.body) ?? parseLegacyNote(c.body), `${repo}/${dir} comment ${c.id}`).not.toBeNull();
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});
