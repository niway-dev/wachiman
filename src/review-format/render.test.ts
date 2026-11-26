/**
 * The review body, rendered from data: goldens compared byte for byte, the acceptance criteria of
 * the layout spec (S2 to S7), and a round trip through every reader that parses a body's footer.
 *
 * `WACHI_UPDATE_GOLDEN=1 bun test src/review-format/render.test.ts` rewrites the goldens; read each
 * one by eye before committing the change.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isPartialFooter, readAutoCost, readLegacyMarker, readSignedMarker, readSignedState, readSignedStateBlock } from "../engine";
import { readReceipt } from "../ledger";
import { parseLabel, parseModel } from "../precision";
import { readReviews } from "../pr-state";
import { REVIEW_STATE_FORMAT, encodeStateBlock } from "../review-state";
import { realReviews } from "./fixtures/real";
import { fitted, scenarios } from "./fixtures/scenarios";
import { blankBeforeLists, firstParagraph, renderReviewBody } from "./render";
import { buildView, refusedView, type ViewInput } from "./view";

const DIR = join(import.meta.dir, "fixtures");

const MAX = 60_000;
const inputs: Record<string, ViewInput> = {
  ...scenarios,
  ...realReviews,
  ...Object.fromEntries(Object.entries(fitted).map(([name, f]) => [name, f.input])),
};
const renderFitted = (f: (typeof fitted)[string]) => {
  const view = buildView(f.input);
  return renderReviewBody(f.refused ? refusedView(view) : view, f.limit);
};
const bodies: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries({ ...scenarios, ...realReviews }).map(([name, input]) => [name, renderReviewBody(buildView(input), MAX)]),
  ),
  ...Object.fromEntries(Object.entries(fitted).map(([name, f]) => [name, renderFitted(f)])),
};
/** The 422 bodies have no thread to answer in, so no answer line. */
const refused = new Set(
  Object.entries(fitted)
    .filter(([, f]) => f.refused)
    .map(([name]) => name),
);

/** The goldens this file owns, so a stray file in the folder is noticed. */
const goldenPath = (name: string) => join(DIR, `${name}.md`);

describe("goldens", () => {
  for (const [name, body] of Object.entries(bodies)) {
    test(`${name} equals its golden, byte for byte`, () => {
      const path = goldenPath(name);
      if (process.env.WACHI_UPDATE_GOLDEN === "1") {
        writeFileSync(path, body);
        return;
      }
      if (!existsSync(path)) throw new Error(`${path} is missing: run WACHI_UPDATE_GOLDEN=1 bun test src/review-format/render.test.ts`);
      expect(body).toBe(readFileSync(path, "utf8"));
    });
  }

  test("every golden file belongs to a scenario, and every legacy file to a real review", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".md"));
    const known = new Set([
      ...Object.keys(inputs).map((n) => `${n}.md`),
      ...Object.keys(realReviews).map((n) => `legacy-${n}.md`),
      "legacy-strange-offline-283.md",
    ]);
    expect(files.filter((f) => !known.has(f))).toEqual([]);
  });

  test("a body never has trailing spaces or three blank lines in a row", () => {
    for (const body of Object.values(bodies)) {
      expect(body).not.toMatch(/[ \t]+\n/);
      expect(body).not.toMatch(/\n\n\n/);
    }
  });
});

describe("size-trimmed and 422 goldens: what must survive", () => {
  const MARKERS = ["wachi:auto", "wachi:review", "wachiman sha=", "wachi:attempt", "wachi:partial", "wachi:receipt"];
  /** Every Blocker and Fix of this change or inconclusive, pre-existing or not: a row in some table of the body. */
  const demandingTitles = (name: string) =>
    inputs[name]!.output.findings.filter((f) => f.severity === "blocker" || f.severity === "fix").map((f) => f.title);
  const ATTEMPT = "<!-- wachi:attempt id=0b1c2d3e-0000-4000-8000-000000000001 -->";

  for (const [name, f] of Object.entries(fitted)) {
    test(`${name}: fits, keeps the cost line and every marker, and readAutoCost reads it`, () => {
      const body = bodies[name]!;
      expect(body.length).toBeLessThanOrEqual(f.limit);
      expect(body).toContain(f.input.footer.costLine);
      for (const marker of f.input.footer.markers) expect(body).toContain(marker);
      if (f.input.footer.receipt) expect(body).toContain(f.input.footer.receipt);
      const cost = Number([...f.input.footer.costLine.matchAll(/\$(\d+(?:\.\d+)?)/g)].pop()![1]);
      expect(readAutoCost(body)).toBe(cost);
      // The poster adds the attempt line after the body: the markers it lists are the ones the readers need.
      const posted = `${body}\n\n${ATTEMPT}`;
      expect(readAutoCost(posted)).toBe(cost);
      for (const marker of MARKERS)
        if (f.input.footer.markers.join(" ").includes(marker) || marker === "wachi:attempt") expect(posted).toContain(marker);
    });
  }

  for (const name of ["size-trimmed", "refused-422", "refused-422-trimmed"]) {
    test(`${name}: every Blocker and Fix keeps its row`, () => {
      for (const title of demandingTitles(name)) expect(bodies[name]!, title).toContain(title);
    });
  }

  test("size-trimmed: slots 12, 11 and 13 are gone, the Blocker and Fix rows are there", () => {
    const body = bodies["size-trimmed"]!;
    expect(body).not.toContain("<summary>What the reviewer checked");
    expect(body).not.toContain("<summary>What the change connects to");
    expect(body).not.toContain("<summary>Coverage by batch");
    expect(body).toContain("### To fix (4)");
    // The whole body was longer than the limit.
    expect(renderReviewBody(buildView(fitted["size-trimmed"]!.input)).length).toBeGreaterThan(fitted["size-trimmed"]!.limit);
  });

  test("never-dropped-over-limit: the To fix table ends with how many rows it leaves out, Blockers first, and the body fits", () => {
    const body = bodies["never-dropped-over-limit"]!;
    expect(body).toMatch(/\n- … and \d+ more not shown because of GitHub's size limit, they are on their lines\.\n/);
    expect(body).toContain("The token is written to the log");
    const whole = renderReviewBody(buildView(fitted["never-dropped-over-limit"]!.input));
    // Dropping every slot on the list still leaves it over the limit, so the tables were cut.
    expect(whole.length).toBeGreaterThan(fitted["never-dropped-over-limit"]!.limit);
  });

  test("422 bodies: no row is on its line, each finding is listed once and numbered, the details follow the tables", () => {
    for (const name of refused) {
      const body = bodies[name]!;
      expect(body).not.toContain("(see Files changed)");
      expect(body).not.toContain(", they are on their lines");
      expect(body).toContain("| # | | Where | Finding |");
      const numbers = [...body.matchAll(/^\| (\d+) \| /gm)].map((m) => Number(m[1]));
      expect(new Set(numbers).size).toBe(numbers.length);
    }
    expect(bodies["refused-422"]!).toContain("<summary>Details of each finding (3)");
  });
});

const EMOJIS = ["⛔", "⚠️", "🔴", "🟠", "🔍", "🟣", "⏳", "🟡", "⚪"];
const lead = (body: string) => body.split("\n")[0]!;

describe("S2: one colour emoji in the bold lead", () => {
  const expected: Record<string, string> = {
    clean: "⚪",
    "first-review": "🟠",
    "many-findings": "🔴",
    partial: "⚠️",
    "verifier-failed": "🟠",
    "inconclusive-blocker": "🔍",
    "pre-existing": "⏳",
    "blocker-outside-diff": "🔴",
    "re-review-open-threads": "⏳",
    "re-review-threads-unknown": "⏳",
    "small-281": "🟣",
    "strange-partial-242": "⚠️",
  };

  for (const [name, body] of Object.entries(bodies)) {
    test(`${name}: exactly one mode emoji in the lead, and it opens the bold phrase`, () => {
      const parts = lead(body).split(" · ");
      expect(parts[0]).toBe("👮 **Wachiman**");
      const mode = parts[1]!;
      expect(mode).toMatch(/^\S+ \*\*[^*]+\*\*$/);
      const all = EMOJIS.map((e) => lead(body).split(e).length - 1).reduce((a, b) => a + b, 0);
      expect(all).toBe(1);
      expect(EMOJIS.some((e) => mode.startsWith(e))).toBe(true);
    });
  }

  for (const [name, emoji] of Object.entries(expected)) {
    test(`${name} is in the ${emoji} mode`, () => {
      expect(lead(bodies[name]!).split(" · ")[1]!.startsWith(`${emoji} `)).toBe(true);
    });
  }
});

describe("S3: never says the pull request is good", () => {
  test("no body says good to merge, LGTM, or shows a check mark", () => {
    for (const body of Object.values(bodies)) {
      expect(body).not.toMatch(/good to merge/i);
      expect(body).not.toMatch(/\bLGTM\b/);
      expect(body).not.toContain("✅");
    }
  });

  test("the clean golden opens with the nothing-to-fix lead", () => {
    expect(bodies.clean!.startsWith("👮 **Wachiman** · ⚪ **Wachiman found nothing to fix** · whole PR at")).toBe(true);
  });

  test('"before merge" appears only in a body with a Blocker', () => {
    for (const [name, body] of Object.entries(bodies)) {
      const hasBlocker = inputs[name]!.output.findings.some((f) => f.severity === "blocker" && f.verification?.status !== "inconclusive");
      if (/before merge/i.test(body)) expect(hasBlocker, name).toBe(true);
    }
  });
});

describe("S4: the question comes first", () => {
  test("the #281 golden leads with one question for you", () => {
    expect(lead(bodies["small-281"]!).startsWith("👮 **Wachiman** · 🟣 **1 question for you**")).toBe(true);
  });
});

describe("S5: the partial review is readable", () => {
  const body = bodies["strange-partial-242"]!;
  test("the first line is short", () => {
    expect(lead(body).length).toBeLessThan(300);
  });

  test("every path not reviewed is listed, grouped by reason", () => {
    const input = realReviews["strange-partial-242"];
    const reviewed = new Set(input.output.files_reviewed);
    const missing = input.files.map((f) => f.filename).filter((f) => !reviewed.has(f));
    expect(missing.length).toBeGreaterThan(0);
    for (const path of missing) expect(body, path).toContain(path.split("/").pop()!);
    expect(body).toContain("Files not reviewed");
  });

  test("the callout's per-reason counts add up to the files not reviewed, and each path is under its reason", () => {
    const input = realReviews["strange-partial-242"];
    const reviewed = new Set(input.output.files_reviewed);
    const missing = input.files.map((f) => f.filename).filter((f) => !reviewed.has(f));
    const callout = body.split("\n").find((l) => l.startsWith("> "))!;
    const reasons = callout.match(/Not reviewed: \d+ \((.*)\)\./)![1]!.split("; ");
    const counted = reasons.map((r) => Number(r.match(/^(\d+) /)![1]));
    expect(counted.length).toBeGreaterThan(0);
    expect(counted.reduce((a, b) => a + b, 0)).toBe(missing.length);
    const section = body.slice(body.indexOf("<summary>Files not reviewed"));
    const groups = [...section.matchAll(/\*\*(Because [^\n]*?) \((\d+)\)\*\*\n\n((?:- [^\n]*\n?)+)/g)];
    expect(groups.length).toBe(counted.length);
    const listed: string[] = [];
    // Same groups, same order, same counts as the callout's reasons.
    expect(groups.map((g) => Number(g[2]))).toEqual(counted);
    for (const [, , n, items] of groups) {
      const paths = items!
        .trim()
        .split("\n")
        .map((l) => l.slice(3, -1));
      expect(paths.length).toBe(Number(n));
      listed.push(...paths);
    }
    expect([...listed].sort()).toEqual([...missing].sort());
  });

  test("the first line of the callout reads: Reviewed X of Y files. Not reviewed: Z (n files — reason; n files — reason).", () => {
    const callout = body.split("\n").find((l) => l.startsWith("> "))!;
    expect(callout).toBe(
      "> ⚠️ **Partial review.** Reviewed 30 of 82 files. Not reviewed: 52 (42 files — not reached: the pull request's budget was spent; 10 files — not reached: the call ran out of its budget).",
    );
    expect(body).toContain("<details><summary>Files not reviewed");
  });

  test("the hidden partial marker is written verbatim from the footer, whatever the visible text says", () => {
    for (const name of ["strange-partial-242", "partial"]) {
      const input = inputs[name]!;
      const written = input.footer.markers.filter((m) => m.startsWith("<!-- wachi:partial "));
      expect(written).toHaveLength(1);
      expect(bodies[name]!.match(/<!-- wachi:partial [^>]*-->/g)).toEqual(written);
      expect(isPartialFooter(bodies[name]!)).toBe(true);
    }
  });

  test("the callout counts add up to the files of the pull request", () => {
    const input = realReviews["strange-partial-242"];
    const total = input.files.length;
    const reviewed = input.output.files_reviewed.length;
    expect(body).toContain(`${reviewed} of ${total}`);
  });
});

describe("S6: the answer line and the cost line", () => {
  test("no body has an Answer row, and every one has the answer sub line", () => {
    for (const [name, body] of Object.entries(bodies)) {
      expect(body).not.toMatch(/^\| Answer /m);
      const line = "<sub>Answer a finding in its thread: `Verdict: correct` or `Verdict: wrong`, and why.</sub>";
      if (refused.has(name)) expect(body).not.toContain(line);
      else expect(body).toContain(line);
    }
  });

  test("readAutoCost returns the cost of the run on every body", () => {
    for (const [name, input] of Object.entries(inputs)) {
      const cost = Number([...input.footer.costLine.matchAll(/\$(\d+(?:\.\d+)?)/g)].pop()![1]);
      // medium-236 has an old marker name no reader accepts, and rerebase-276 never had the automatic flag: no cost to read, before and after.
      const readable = readSignedMarker(bodies[name]!) !== null && input.footer.markers.includes("<!-- wachi:auto -->");
      expect(readAutoCost(bodies[name]!), name).toBe(readable ? cost : null);
    }
  });
});

describe("S7: files with one name are told apart", () => {
  test("init/run.ts and setup/run.ts keep their folder, a lone file keeps its bare name", () => {
    const body = bodies["same-name-files"]!;
    expect(body).toContain("init/run.ts");
    expect(body).toContain("setup/run.ts");
    expect(body).toMatch(/`store\.ts:2`|\[`store\.ts:2`\]/);
    expect(body).not.toContain("`run.ts:");
  });
});

describe("the Findings row", () => {
  test("its total equals the sum of its parts", () => {
    for (const [name, body] of Object.entries(bodies)) {
      const hasFindings = inputs[name]!.output.findings.length > 0;
      const row = body.split("\n").find((l) => l.startsWith("| **Findings** |") || l.startsWith("| Findings |"));
      if (!row) {
        // A body that keeps no glance table (a cut one) may lose the row; a whole body with findings may not.
        expect(hasFindings && !fitted[name] && !refused.has(name), `${name} has findings but no Findings row`).toBe(false);
        continue;
      }
      const total = Number(row.match(/\((\d+)\)/)?.[1]);
      const parts = [...row.matchAll(/(\d+) (blockers?|to fix|to consider|for your information)/g)].map((m) => Number(m[1]));
      expect(parts.length, name).toBe(4);
      expect(Number.isFinite(total), name).toBe(true);
      expect(
        parts.reduce((a, b) => a + b, 0),
        name,
      ).toBe(total);
    }
  });
});

describe("the lead never says nothing to fix when something is open", () => {
  test("open or unknown earlier threads and a pre-existing Fix keep the lead out of modes 8 and 9", () => {
    for (const [name, input] of Object.entries(inputs)) {
      const f = buildView(input).findings;
      const open =
        input.earlierThreads === "unknown" ||
        (input.earlierThreads ?? 0) > 0 ||
        f.preExisting.some((r) => r.severity === "blocker" || r.severity === "fix");
      if (!open) continue;
      const first = lead(bodies[name]!);
      expect(first, name).not.toMatch(/nothing to fix/i);
      expect(first.includes("🟡") || first.includes("⚪"), name).toBe(false);
    }
  });
});

describe("a verifier that did not finish", () => {
  test("the verifier-failed golden says so on its first line", () => {
    expect(lead(bodies["verifier-failed"]!)).toContain("verifier did not finish");
  });
});

describe("a re-review whose thread read failed", () => {
  const body = bodies["re-review-threads-unknown"]!;
  test("leads with the waiting mode and says the earlier threads were not counted", () => {
    expect(lead(body).split(" · ")[1]!.startsWith("⏳ ")).toBe(true);
    expect(lead(body)).toContain("earlier threads not counted");
  });
});

describe("a title with a pipe and a newline", () => {
  test("stays in one table cell", () => {
    const row = bodies["title-pipe-newline"]!.split("\n").find((l) => l.includes("Handles"))!;
    expect(row).toContain("a \\| b");
    expect(row).not.toContain("\n");
    expect(row.endsWith("|")).toBe(true);
  });
});

describe("details tags in model text", () => {
  const input = scenarios["first-review"]!;
  const evil: ViewInput = {
    ...input,
    output: { ...input.output, findings: input.output.findings.map((f, i) => (i === 0 ? { ...f, title: "Closes </details> early" } : f)) },
  };
  test("a finding title cannot close the collapsed details block", () => {
    const body = renderReviewBody(buildView(evil), MAX);
    expect(body).toContain("Closes &lt;/details> early");
    expect(body.split("</details>").length).toBe(body.split("<details>").length);
  });
});

describe("binary files in a complete review", () => {
  test("every one is listed in the not-reviewed slot, not only the first three in the Coverage cell", () => {
    const binaries = ["a.png", "b.png", "c.png", "d.png"].map((path) => ({ path, reason: "binary" }));
    const body = renderReviewBody(buildView({ ...scenarios.clean!, unreviewable: binaries }), MAX);
    expect(body).toContain("Files not reviewed (4)");
    expect(body).toContain("`d.png`");
  });
});

describe("the not-reviewed heading counts what it lists", () => {
  test("a partial review with binary files counts both", () => {
    const input = realReviews["strange-partial-242"];
    const binaries = ["a.png", "b.png"].map((path) => ({ path, reason: "binary" }));
    const view = buildView({ ...input, unreviewable: binaries });
    const partial = view.files.total - view.files.reviewed;
    expect(partial).toBeGreaterThan(0);
    expect(renderReviewBody(view, MAX)).toContain(`Files not reviewed (${partial + 2})`);
  });
});

describe("round trip: the readers still read the footer", () => {
  const ATTEMPT = "<!-- wachi:attempt id=0b1c2d3e-0000-4000-8000-000000000001 -->";
  /** The commit a marker the readers accept names; null for the old `agent-review` marker, which none of them reads. */
  const shaOf = (name: string) =>
    inputs[name]!.footer.markers.at(-1)!.match(/<!-- (?:wachiman|claude-review|wachi:partial) sha=([A-Za-z0-9]+)/)?.[1] ?? null;
  const block = (head: string) =>
    encodeStateBlock({
      format: REVIEW_STATE_FORMAT,
      engine: "9.9.9",
      head,
      attempt: "0b1c2d3e-0000-4000-8000-000000000001",
      status: "complete",
      reason: null,
      findings: {
        total: 0,
        by_severity: { blocker: 0, fix: 0, consider: 0, info: 0 },
        by_placement: { inline: 0, body: 0, outside_diff: 0 },
        unthreaded_blocking: 0,
      },
    });

  for (const [name, input] of Object.entries(inputs)) {
    test(`${name}: cost, model, markers, receipt`, () => {
      const body = bodies[name]!;
      expect(parseModel(body)).toBe(input.footer.costLine.match(/<sub>(.+?) via /)![1]);
      const marker = input.footer.markers.at(-1)!;
      const sha = shaOf(name);
      expect(readSignedMarker(body)).toBe(sha);
      expect(readSignedState(body)?.sha ?? null).toBe(sha);
      expect(isPartialFooter(body)).toBe(sha !== null && marker.includes("wachi:partial"));
      expect(readReceipt(body)).toEqual(input.footer.receipt ? readReceipt(input.footer.receipt) : null);
    });

    test(`${name}: with the state block and the attempt line the poster adds`, () => {
      const sha = shaOf(name) ?? inputs[name]!.headSha;
      const posted = `${bodies[name]}\n\n${block(sha)}\n\n${ATTEMPT}`;
      // After an old-named marker no block is read, as before this change.
      expect(readSignedStateBlock(posted)?.head ?? null).toBe(shaOf(name) === null ? null : sha);
      expect(readSignedMarker(posted)).toBe(shaOf(name));
      expect(readAutoCost(posted)).toBe(readAutoCost(bodies[name]!));
      const reviews = readReviews([{ body: posted, createdAt: "2026-11-14T00:00:00Z" }]);
      expect(reviews.length).toBe(shaOf(name) === null ? 0 : 1);
      if (reviews.length > 0) {
        expect(reviews[0]!.head).toBe(sha);
        expect(reviews[0]!.source).toBe("block");
      }
    });

    test(`${name}: with no state block, pr-state reads the markers`, () => {
      const reviews = readReviews([{ body: bodies[name]!, createdAt: "2026-11-14T00:00:00Z" }]);
      expect(reviews.length).toBe(shaOf(name) === null ? 0 : 1);
      if (reviews.length > 0) expect(reviews[0]!.source).toBe("legacy-markers");
    });
  }

  test("parseLabel still reads the label of an inline finding", () => {
    expect(parseLabel("🟠🐛 **Fix · bug: The store drops the last session (confidence high)**\n\nBody.")?.severity).toBe("fix");
  });

  describe("the old real bodies", () => {
    const legacy = readdirSync(DIR).filter((f) => f.startsWith("legacy-") && f.endsWith(".md"));
    test("there are six legacy bodies", () => {
      expect(legacy.length).toBe(6);
    });
    for (const file of legacy) {
      test(`${file} is still read`, () => {
        const body = readFileSync(join(DIR, file), "utf8");
        expect(parseModel(body)).not.toBe("unknown");
        // Every real body ends with the attempt line the poster adds; the readers accept it.
        const marker = body.match(/<!-- (wachiman|claude-review|wachi:partial|agent-review) sha=([A-Za-z0-9]+)/)!;
        expect(marker).not.toBeNull();
        // `agent-review` is a marker from before the rename: no reader accepts it, and it was never read.
        const sha = marker[1] === "agent-review" ? null : marker[2]!;
        expect(readSignedMarker(body)).toBe(sha);
        expect(readLegacyMarker(body)).toBeNull();
        if (sha !== null && body.includes("<!-- wachi:auto -->")) expect(readAutoCost(body)).toBeGreaterThan(0);
        const reviews = readReviews([{ body, createdAt: "2026-11-14T00:00:00Z" }]);
        expect(reviews.length).toBe(sha === null ? 0 : 1);
      });
    }
  });
});

describe("blankBeforeLists", () => {
  test("a bullet after an indented continuation line of a list item stays tight", () => {
    const text = "- a\n  more text\n- b";
    expect(blankBeforeLists(text)).toBe(text);
  });
  test("a bullet after prose gets a blank line", () => {
    expect(blankBeforeLists("Steps:\n- one\n- two")).toBe("Steps:\n\n- one\n- two");
  });

  test("an ordered list that starts at 1 after prose gets a blank line", () => {
    expect(blankBeforeLists("Steps:\n1. one\n2. two")).toBe("Steps:\n\n1. one\n2. two");
    expect(blankBeforeLists("Steps:\n1) one")).toBe("Steps:\n\n1) one");
  });

  test("a line that only looks numbered is not a list start", () => {
    expect(blankBeforeLists("It was\n2024. was a good year")).toBe("It was\n2024. was a good year");
    expect(blankBeforeLists("See\n3) note")).toBe("See\n3) note");
  });

  test("a line indented 4 spaces is not a list start", () => {
    expect(blankBeforeLists("Steps:\n    - code")).toBe("Steps:\n    - code");
  });

  test("a list item after a list item is unchanged", () => {
    expect(blankBeforeLists("- a\n1. b")).toBe("- a\n1. b");
  });

  test("inside a ``` fence, a nested ~~~ does not close it", () => {
    const text = "```\n~~~\nprose\n- item\n```";
    expect(blankBeforeLists(text)).toBe(text);
  });
});

describe("firstParagraph", () => {
  const fences = (text: string) => text.split("\n").filter((l) => /^\s*(```|~~~)/.test(l)).length;

  test("a blank line inside a fence does not leave the fence open", () => {
    const out = firstParagraph("```ts\nfoo\n\nbar\n```");
    expect(out).toBe("```ts\nfoo\n```");
    expect(fences(out) % 2).toBe(0);
  });

  test("a fence crossing the character limit is closed after the cut", () => {
    const out = firstParagraph(`Intro.\n~~~\n${"x".repeat(700)}\n~~~`);
    expect(out.endsWith("\n~~~")).toBe(true);
    expect(fences(out) % 2).toBe(0);
  });

  test("text without a fence is only cut", () => {
    expect(firstParagraph("One.\n\nTwo.")).toBe("One.");
  });
});
