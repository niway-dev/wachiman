import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { privateContextLine } from "../distributed";
import type { ReviewResult } from "../engine";
import { agentPrompt } from "./agent-prompt";
import { renderMarkdown } from "./markdown";
import { renderTerminal } from "./terminal";

// What the terminal and the Markdown report print for a distributed-repo review (spec "Acceptance
// criteria": per sibling the member, the rule and why, the commit, the age of the last fetch or
// "not cloned: not checked"; "no contract applied"; the private-context line; references as
// member@sha:path:line). Without the mode the output is what it was. The names are invented.

const fixture = (name: string): ReviewResult =>
  JSON.parse(readFileSync(join(import.meta.dir, `../../test/fixtures/formats/${name}`), "utf8"));
const distributed = () => fixture("review-result.v2.distributed.example.json");
const plain = () => fixture("review-result.v2.example.json");

const outputs = (r: ReviewResult) =>
  [
    ["terminal", renderTerminal(r, { agentPrompt: false })],
    ["markdown", renderMarkdown(r, {})],
  ] as const;

describe("the sibling lines of a distributed-repo review", () => {
  test.each(["terminal", "markdown"] as const)(
    "%s: one line per sibling with its rule, why, commit and fetch age, or that it was not cloned",
    (kind) => {
      const text = outputs(distributed()).find(([k]) => k === kind)![1];
      // Read: member, rule and its source (the per-user override), commit, last fetch, files, which contract asked.
      expect(text).toContain(
        "desktop-app: rule tip (per-user file), commit 3f2a9c1, last fetched 2026-11-18T09:30:00.000Z, 1 file, for brand-palette",
      );
      // Not read: nothing was checked, and it says so.
      expect(text).toContain("brand-assets: not cloned: not checked (rule pinned (manifest), for brand-palette)");
      expect(text).toContain("Workspace contracts applied: brand-palette");
      expect(text).not.toContain("No workspace contract applied");
    },
  );

  test.each(["terminal", "markdown"] as const)(
    "%s: a fallback is named with its reason, and so is a sibling that was not watched, unreadable or dirty",
    (kind) => {
      const r = distributed();
      r.siblings = [
        { ...r.siblings![0]!, rule: "pinned", ruleSource: "manifest", readAs: "tip", fallback: "no pin is declared in the manifest" },
        { ...r.siblings![1]!, member: "billing-service", status: "not-watched" },
        { ...r.siblings![1]!, member: "api-client", status: "unreadable", unreadable: "no commit at HEAD" },
        { ...r.siblings![0]!, member: "mobile-app", rule: "local", readAs: "local", status: "uncommitted-not-read", ruleSource: "default" },
      ];
      delete r.siblings[0]!.fetchedAt;
      const text = outputs(r).find(([k]) => k === kind)![1];
      expect(text).toContain(
        "desktop-app: rule pinned (manifest), read as tip, commit 3f2a9c1, 1 file, no pin is declared in the manifest, for brand-palette",
      );
      expect(text).toContain("billing-service: not watched: not checked");
      expect(text).toContain("api-client: unreadable (no commit at HEAD): not checked");
      expect(text).toContain(
        "mobile-app: rule local (default), commit 3f2a9c1, last fetched 2026-11-18T09:30:00.000Z, 1 file, uncommitted changes not read",
      );
    },
  );

  test.each(["terminal", "markdown"] as const)("%s: a run that applied no contract says so in one line", (kind) => {
    const r = distributed();
    r.siblings = [];
    r.workspaceContractsApplied = [];
    r.noWorkspaceContractApplied = true;
    delete r.privateContext;
    const text = outputs(r).find(([k]) => k === kind)![1];
    expect(text).toContain("No workspace contract applied to this change.");
    expect(text).not.toContain("Workspace contracts applied:");
  });

  test.each(["terminal", "markdown"] as const)("%s: the removed references are counted", (kind) => {
    const text = outputs(distributed()).find(([k]) => k === kind)![1];
    expect(text).toContain("1 sibling reference was removed: it could not be checked.");
    const r = distributed();
    r.removedSiblingReferences = 3;
    expect(outputs(r).find(([k]) => k === kind)![1]).toContain("3 sibling references were removed: they could not be checked.");
    r.removedSiblingReferences = 0;
    expect(outputs(r).find(([k]) => k === kind)![1]).not.toContain("removed");
  });
});

describe("a sibling that is not cloned", () => {
  const notCloned = (sourceOfTruthOf?: string[]) => {
    const r = distributed();
    const row = {
      ...r.siblings![0]!,
      sourceOfTruthOf: undefined,
      member: "billing-service",
      status: "not-cloned" as const,
      contracts: ["brand-palette"],
      rule: "pinned" as const,
      ruleSource: "manifest" as const,
      readAs: "pinned" as const,
      sha: undefined,
      fetchedAt: undefined,
      fallback: undefined,
      paths: [],
    };
    r.siblings = [sourceOfTruthOf === undefined ? row : { ...row, sourceOfTruthOf }];
    return r;
  };

  test.each(["terminal", "markdown"] as const)("%s: a member that is not the source of truth keeps 'not cloned: not checked'", (kind) => {
    const text = outputs(notCloned()).find(([k]) => k === kind)![1];
    expect(text).toContain("billing-service: not cloned: not checked (rule pinned (manifest), for brand-palette)");
    expect(text).not.toContain("source of truth not cloned");
  });

  test.each(["terminal", "markdown"] as const)("%s: a member that holds the source of truth says so", (kind) => {
    const text = outputs(notCloned(["brand-palette"])).find(([k]) => k === kind)![1];
    expect(text).toContain("billing-service: source of truth not cloned: not checked (rule pinned (manifest), for brand-palette)");
  });
});

describe("the private-context line", () => {
  test("the wording of ADR 0042", () => {
    expect(privateContextLine(["desktop-app", "billing-service"])).toBe(
      "Built with private context from: desktop-app, billing-service. Do not paste its text into a public place.",
    );
  });

  test.each(["terminal", "markdown"] as const)(
    "%s: printed above the findings when the result carries the label, and not otherwise",
    (kind) => {
      const text = outputs(distributed()).find(([k]) => k === kind)![1];
      const line = privateContextLine(["desktop-app"]);
      expect(text).toContain(line);
      expect(text.indexOf(line)).toBeLessThan(text.indexOf("The store drops the last session"));
      const r = distributed();
      delete r.privateContext;
      expect(outputs(r).find(([k]) => k === kind)![1]).not.toContain("private context");
    },
  );
});

describe("references into a sibling", () => {
  test("each finding lists the checked ones as member@sha:path:line, with the short commit", () => {
    const [terminal, markdown] = outputs(distributed()).map(([, text]) => text);
    expect(terminal).toContain("Sibling references: desktop-app@3f2a9c1:Assets/palette.json:2");
    expect(markdown).toContain("Sibling references: `desktop-app@3f2a9c1:Assets/palette.json:2`");
  });
});

describe("a citation into a sibling", () => {
  test.each(["terminal", "markdown"] as const)(
    "%s: is printed as member@sha7:path:line, not as a path of the reviewed repository",
    (kind) => {
      const r = distributed();
      const f = r.findings.find((x) => x.verification?.status === "supported")!;
      f.verification!.checked = [
        { snapshot: "head", path: "apps/api/src/main/session/store.ts", line: 2 },
        { snapshot: "head", path: "Assets/palette.json", line: 2, member: "desktop-app", sha: "3f2a9c1".padEnd(40, "0") },
      ];
      const text = outputs(r).find(([k]) => k === kind)![1];
      expect(text).toContain("desktop-app@3f2a9c1:Assets/palette.json:2");
      expect(text).toContain("apps/api/src/main/session/store.ts:2");
      expect(text).not.toMatch(/(^|[^@:\w])Assets\/palette\.json:2/);
    },
  );
});

describe("a review without the mode", () => {
  test.each(["terminal", "markdown"] as const)("%s: prints none of it", (kind) => {
    const text = outputs(plain()).find(([k]) => k === kind)![1];
    for (const word of ["Sibling", "sibling", "private context", "workspace contract", "Workspace contract", "Workspace:"])
      expect(text, word).not.toContain(word);
  });

  test("an empty distributed result block changes nothing but its own lines", () => {
    const withMode = distributed();
    const without = { ...withMode } as Partial<ReviewResult>;
    for (const key of [
      "siblings",
      "workspaceContractsApplied",
      "noWorkspaceContractApplied",
      "privateContext",
      "removedSiblingReferences",
    ] as const)
      delete without[key];
    const stripped = outputs(without as ReviewResult)[0]![1];
    const full = outputs(withMode)[0]![1];
    // Every line of the plain rendering is still in the distributed one, in order.
    let from = 0;
    for (const line of stripped.split("\n").filter((l) => l !== "")) {
      const at = full.indexOf(line, from);
      expect(at, line).toBeGreaterThanOrEqual(0);
      from = at;
    }
  });

  test("the agent prompt block, which is pasted into a coding agent, opens with the private-context line", () => {
    const r = distributed();
    expect(agentPrompt(r).startsWith(privateContextLine(r.privateContext!.members))).toBe(true);
    delete r.privateContext;
    expect(agentPrompt(r)).not.toContain("private context");
  });
});

describe("names from the manifest in the terminal, the Markdown report and the agent prompt", () => {
  // A manifest name is text of the reviewed repository: an escape byte must not reach the terminal, a
  // newline must not start a line of its own, and a backtick must not end an inline code span.
  const BAD = "web`\u001b[2J\n## Injected";
  const hostile = () => {
    const r = distributed();
    r.siblings = [
      { ...r.siblings![0]!, member: BAD, contracts: [BAD], fallback: `pin\u001b[0m\nmissing`, fetchedAt: "now\u0007" },
      { ...r.siblings![1]!, member: `${BAD}-2`, status: "unreadable", unreadable: `bad\u001b[31m\nfile`, contracts: [BAD] },
    ];
    r.workspaceContractsApplied = [BAD];
    r.privateContext = { members: [BAD] };
    r.findings[0]!.references = [{ member: BAD, sha: "3f2a9c1".padEnd(40, "0"), path: `a\`b\n.ts`, line: 2 }];
    return r;
  };
  // eslint-disable-next-line no-control-regex
  const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/;

  test.each(["terminal", "markdown", "agent prompt"] as const)("%s: no control character, and no line that a name started", (kind) => {
    const r = hostile();
    const text = { terminal: renderTerminal(r, { agentPrompt: false }), markdown: renderMarkdown(r, {}), "agent prompt": agentPrompt(r) }[
      kind
    ];
    // The agent prompt and the report keep their own newlines; ESC and the other control characters are never there.
    expect(CONTROL.test(text)).toBe(false);
    expect(text).not.toMatch(/^## Injected/m);
  });

  test("the references of a finding stay inside their code span in Markdown", () => {
    const text = renderMarkdown(hostile(), {});
    const line = text.split("\n").find((l) => l.startsWith("Sibling references:"))!;
    expect(line.match(/`/g)).toHaveLength(2);
    expect(line).toContain("a'b .ts:2");
  });

  test("the private-context line names the member on one line", () => {
    const line = agentPrompt(hostile()).split("\n")[0]!;
    expect(line).toBe("Built with private context from: web' [2J ## Injected. Do not paste its text into a public place.");
  });
});
