import { describe, expect, test } from "bun:test";
import { loadConfig, UsageError } from "./config";
import { GhError, readBaseSettings, withBaseSettings, type GhFn } from "./engine";
import {
  applyRepoSettings,
  effectiveSettings,
  fileSettingsNote,
  matchPathRule,
  parsePathRules,
  parseRepoSettings,
  resolveMemorySettings,
  reviewPolicyOf,
  wantsRepoSettings,
  type PathRule,
} from "./repo-settings";
import { settingsContent } from "./init/settings";

const BASE = "b".repeat(40);
const HEAD = "a".repeat(40);

describe("parseRepoSettings", () => {
  test("reads kind, model and effort; unknown keys are ignored", () => {
    expect(parseRepoSettings("kind: monorepo\nmodel: claude-opus-5-5\neffort: xhigh\nfuture: 1\n")).toEqual({
      kind: "monorepo",
      model: "claude-opus-5-5",
      effort: "xhigh",
    });
  });

  test("an empty file, comments only and keys with no value hold nothing", () => {
    expect(parseRepoSettings("")).toEqual({});
    expect(parseRepoSettings("# model: x\n# effort: high\n")).toEqual({});
    expect(parseRepoSettings("model:\neffort:\n")).toEqual({});
  });

  test("the file `init` writes parses to its kind only: model, effort and paths are commented out", () => {
    expect(parseRepoSettings(settingsContent("single"))).toEqual({ kind: "single" });
  });

  test("the commented-out paths example in the file `init` writes is a valid rule once uncommented", () => {
    const content = settingsContent("single");
    expect(content).toContain("https://claude.dev/blog/solving-code-review-at-anthropic/#the-life-of-a-change");
    const uncommented = content
      .split("\n")
      .map((l) => (/^#\s*(paths:|  - match|    severity|    reason)/.test(l) ? l.replace(/^#\s?/, "") : l))
      .join("\n");
    expect(parseRepoSettings(uncommented).paths).toEqual([
      { match: ".github/workflows/**", severity: "critical", reason: "CI can publish releases and read secrets" },
    ]);
  });

  test.each([
    ["effort: turbo\n", 'effort must be one of low, medium, high, xhigh, max, got "turbo"'],
    ["effort: High\n", 'got "High"'],
    ["effort: 3\n", 'got "3"'],
    ["model: 5\n", "model must be a model name"],
    ["model: [a]\n", "model must be a model name"],
    ["- a\n- b\n", "must be a mapping"],
    ["just text\n", "must be a mapping"],
    ["model: [unclosed\n", "not valid YAML"],
  ])("%p is a usage error that names .wachiman.yml", (content, message) => {
    let error: unknown;
    try {
      parseRepoSettings(content);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).toContain(".wachiman.yml");
    expect((error as Error).message).toContain(message);
  });
});

describe("paths", () => {
  const FILE = [
    "paths:",
    '  - match: ".github/workflows/**"',
    "    severity: critical",
    "    reason: CI can publish releases and read secrets",
    '  - match: "src/billing/**"',
    "    severity: high",
    "    reason: charges customers",
    "    owner: ignored-key",
    "",
  ].join("\n");

  test("reads the entries in file order and ignores unknown keys inside an entry", () => {
    expect(parseRepoSettings(FILE)).toEqual({
      paths: [
        { match: ".github/workflows/**", severity: "critical", reason: "CI can publish releases and read secrets" },
        { match: "src/billing/**", severity: "high", reason: "charges customers" },
      ],
    });
  });

  test("lives next to model and effort", () => {
    expect(parseRepoSettings(`model: claude-opus-5-5\n${FILE}`)).toMatchObject({ model: "claude-opus-5-5", paths: [{}, {}] });
  });

  test("no paths, `paths:` with no value and an empty list hold nothing", () => {
    expect(parseRepoSettings("effort: high\n").paths).toBeUndefined();
    expect(parseRepoSettings("paths:\n").paths).toBeUndefined();
    expect(parseRepoSettings("paths: []\n").paths).toBeUndefined();
  });

  test.each([
    ["paths: x\n", "paths must be a list"],
    ["paths:\n  a: 1\n", "paths must be a list"],
    ["paths:\n  - just text\n", "paths[0] must be a mapping"],
    ["paths:\n  - [a]\n", "paths[0] must be a mapping"],
    ["paths:\n  - severity: high\n    reason: r\n", "paths[0].match must be a glob"],
    ['paths:\n  - match: ""\n    severity: high\n    reason: r\n', "paths[0].match must be a glob"],
    [
      'paths:\n  - match: "a/**"\n    severity: urgent\n    reason: r\n',
      'paths[0].severity must be one of critical, high, medium, got "urgent"',
    ],
    ['paths:\n  - match: "a/**"\n    severity: High\n    reason: r\n', 'got "High"'],
    ['paths:\n  - match: "a/**"\n    severity: high\n', "paths[0].reason must be a non-empty text"],
    ['paths:\n  - match: "a/**"\n    severity: high\n    reason: "  "\n', "paths[0].reason must be a non-empty text"],
    [
      'paths:\n  - match: "a/**"\n    severity: high\n    reason: r\n  - match: "b/**"\n    severity: x\n    reason: r\n',
      'paths[1].severity must be one of critical, high, medium, got "x".',
    ],
  ])("%p is a usage error naming the entry", (content, message) => {
    let error: unknown;
    try {
      parseRepoSettings(content);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).toContain(".wachiman.yml: ");
    expect((error as Error).message).toContain(message);
  });

  test("parsePathRules names the place it was given, for an input file", () => {
    expect(() => parsePathRules([{ match: "a", severity: "x", reason: "r" }], "--input in.json")).toThrow(
      /^--input in\.json: paths\[0\]\.severity/,
    );
  });

  describe("matchPathRule", () => {
    const rules: PathRule[] = [
      { match: "src/**", severity: "medium", reason: "first, medium" },
      { match: "src/billing/**", severity: "critical", reason: "most severe" },
      { match: "src/billing/*.ts", severity: "critical", reason: "later critical" },
      { match: "docs/**", severity: "high", reason: "docs high" },
      { match: "docs/*.md", severity: "high", reason: "tie, later in the file" },
    ];

    test("the most severe match wins, whatever its place in the file", () => {
      expect(matchPathRule("src/billing/charge.ts", rules)?.reason).toBe("most severe");
    });

    test("on a tie the first in the file wins", () => {
      expect(matchPathRule("docs/billing.md", rules)?.reason).toBe("docs high");
    });

    test("a single match is returned as it is; no match, no rules and an empty list are undefined", () => {
      expect(matchPathRule("src/ui/button.ts", rules)?.severity).toBe("medium");
      expect(matchPathRule("README.md", rules)).toBeUndefined();
      expect(matchPathRule("src/a.ts", undefined)).toBeUndefined();
      expect(matchPathRule("src/a.ts", [])).toBeUndefined();
    });

    test("GitHub's null for a file that was not renamed means no old path", () => {
      expect(matchPathRule("src/billing/charge.ts", rules, null)?.reason).toBe("most severe");
      expect(matchPathRule("README.md", rules, null)).toBeUndefined();
    });

    test("a renamed file is matched on both paths; the more severe rule wins, the new name's on a tie", () => {
      const r: PathRule[] = [
        { match: "src/billing/**", severity: "high", reason: "old home" },
        { match: "src/util/**", severity: "medium", reason: "new home" },
        { match: "lib/**", severity: "high", reason: "new tie" },
        { match: "pkg/**", severity: "high", reason: "old tie" },
      ];
      expect(matchPathRule("src/util/charge.ts", r, "src/billing/charge.ts")?.reason).toBe("old home");
      expect(matchPathRule("src/billing/charge.ts", r, "src/util/charge.ts")?.reason).toBe("old home");
      expect(matchPathRule("lib/a.ts", r, "pkg/a.ts")?.reason).toBe("new tie");
      expect(matchPathRule("src/other/a.ts", r, "src/billing/a.ts")?.reason).toBe("old home");
      expect(matchPathRule("src/other/a.ts", r, "src/other/b.ts")).toBeUndefined();
    });

    test("dotted directories match a literal dotted glob", () => {
      expect(
        matchPathRule(".github/workflows/ci.yml", [{ match: ".github/workflows/**", severity: "critical", reason: "r" }])?.severity,
      ).toBe("critical");
    });
  });
});

const warnings: string[] = [];
const opts = () => {
  warnings.length = 0;
  return { where: "the base commit bbbbbbb", warn: (line: string) => void warnings.push(line) };
};

describe("an unknown model on Claude Code", () => {
  test("a known Claude model is applied", () => {
    const config = applyRepoSettings(loadConfig({}), { model: "claude-haiku-5-5" }, opts());
    expect(config).toMatchObject({ model: "claude-haiku-5-5", modelSource: "file" });
    expect(warnings).toEqual([]);
  });

  test.each(["my-sonnet-proxy", "gpt-6.1-sol", "llama-3"])("%p is skipped with a warning and the default stays", (model) => {
    const config = applyRepoSettings(loadConfig({}), { model, effort: "low" }, opts());
    expect(config).toMatchObject({ model: "claude-sonnet-5-5", modelSource: "default", effort: "low", effortSource: "file" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`ignored model "${model}" from .wachiman.yml at the base commit bbbbbbb`);
    expect(warnings[0]).toContain("using claude-sonnet-5-5");
  });

  test("an explicit model is untouched and nothing is warned", () => {
    const config = applyRepoSettings(loadConfig({ WACHIMAN_MODEL: "my-proxy" }), { model: "llama-3" }, opts());
    expect(config).toMatchObject({ model: "my-proxy", modelSource: "env" });
    expect(warnings).toEqual([]);
  });

  test("on Codex the file model is applied; its own preflight checks it", () => {
    const config = applyRepoSettings(loadConfig({ WACHIMAN_PROVIDER: "codex" }), { model: "gpt-6.1-sol" }, opts());
    expect(config).toMatchObject({ model: "gpt-6.1-sol" });
    expect(warnings).toEqual([]);
  });

  test("doctor reports the default, with the reason, for the same skipped model", () => {
    expect(effectiveSettings({}, { model: "my-sonnet-proxy" }).model).toMatchObject({ value: "claude-sonnet-5-5", source: "default" });
    expect(effectiveSettings({}, { model: "my-sonnet-proxy" }).model.skipped).toContain("not a Claude model");
    expect(effectiveSettings({}, { model: "claude-opus-5-5" }).model).toEqual({ value: "claude-opus-5-5", source: "file" });
    expect(effectiveSettings({ WACHIMAN_PROVIDER: "codex" }, { model: "gpt-x" }).model).toEqual({ value: "gpt-x", source: "file" });
  });
});

describe("precedence: an explicit value beats the file, the file beats the default", () => {
  const file = { model: "claude-opus-5-5", effort: "low" as const };

  test("nothing explicit: the file's values apply and are marked as from the file", () => {
    const config = applyRepoSettings(loadConfig({}), file, opts());
    expect(config).toMatchObject({ model: "claude-opus-5-5", modelSource: "file", effort: "low", effortSource: "file" });
    expect(fileSettingsNote(config, "the base commit bbbbbbb")).toBe(
      "model claude-opus-5-5, effort low from .wachiman.yml at the base commit bbbbbbb",
    );
  });

  test("an explicit WACHIMAN_MODEL and WACHIMAN_EFFORT win over the file", () => {
    const config = applyRepoSettings(loadConfig({ WACHIMAN_MODEL: "claude-haiku-5-5", WACHIMAN_EFFORT: "max" }), file, opts());
    expect(config).toMatchObject({ model: "claude-haiku-5-5", modelSource: "env", effort: "max", effortSource: "env" });
    expect(fileSettingsNote(config, "x")).toBeUndefined();
    expect(wantsRepoSettings(config)).toBe(false);
  });

  test("each setting is decided on its own", () => {
    const config = applyRepoSettings(loadConfig({ WACHIMAN_EFFORT: "medium" }), file, opts());
    expect(config).toMatchObject({ model: "claude-opus-5-5", modelSource: "file", effort: "medium", effortSource: "env" });
  });

  test("an empty workflow input counts as not set, so the file applies", () => {
    const loaded = loadConfig({ WACHIMAN_MODEL: "", WACHIMAN_EFFORT: "" });
    expect(loaded).toMatchObject({ modelSource: "default", effortSource: "default", model: "claude-sonnet-5-5", effort: "high" });
    expect(applyRepoSettings(loaded, file, opts())).toMatchObject({ model: "claude-opus-5-5", effort: "low" });
  });

  test("a file with no model or effort leaves the defaults, marked as defaults", () => {
    expect(applyRepoSettings(loadConfig({}), { kind: "single" }, opts())).toMatchObject({
      model: "claude-sonnet-5-5",
      modelSource: "default",
      effort: "high",
      effortSource: "default",
    });
  });

  test("doctor's view of the same rule", () => {
    expect(effectiveSettings({}, file)).toEqual({
      model: { value: "claude-opus-5-5", source: "file" },
      effort: { value: "low", source: "file" },
    });
    expect(effectiveSettings({ WACHIMAN_MODEL: "m", WACHIMAN_EFFORT: "max" }, file)).toEqual({
      model: { value: "m", source: "env" },
      effort: { value: "max", source: "env" },
    });
    expect(effectiveSettings({ WACHIMAN_MODEL: "" }, undefined)).toEqual({
      model: { value: "claude-sonnet-5-5", source: "default" },
      effort: { value: "high", source: "default" },
    });
    expect(effectiveSettings({ WACHIMAN_PROVIDER: "codex" }, undefined).model).toEqual({ value: "gpt-6.1-sol", source: "default" });
  });
});

/** A `gh` that knows the pull request's base and head and each one's `.wachiman.yml`; it records every contents ref asked for. */
function fakeGh(files: { base?: string; head?: string }) {
  const refs: string[] = [];
  let calls = 0;
  const gh: GhFn = (args) => {
    calls++;
    const path = args[1];
    if (path === "repos/o/r/pulls/5") return `${BASE}\n`;
    const m = /^repos\/o\/r\/contents\/\.wachiman\.yml\?ref=([0-9a-f]{40})$/.exec(path);
    if (!m) throw new Error(`unexpected gh call: ${args.join(" ")}`);
    refs.push(m[1]);
    const content = m[1] === BASE ? files.base : m[1] === HEAD ? files.head : undefined;
    if (content === undefined) throw new GhError("gh api failed: HTTP 404", 404, "Not Found");
    return JSON.stringify({ type: "file", encoding: "base64", content: Buffer.from(content).toString("base64") });
  };
  return { gh, refs, calls: () => calls };
}

describe("the Actions read: the base commit, never the head", () => {
  test("a pull request that edits effort is reviewed under the base's value", () => {
    const { gh, refs } = fakeGh({ base: "effort: low\nmodel: claude-opus-5-5\n", head: "effort: max\nmodel: claude-opus-5-5\n" });
    const logs: string[] = [];
    const config = withBaseSettings(loadConfig({}), gh, "o/r", 5, (l) => logs.push(l));
    expect(config).toMatchObject({ effort: "low", effortSource: "file", model: "claude-opus-5-5" });
    expect(refs).toEqual([BASE]);
    expect(logs).toEqual([`settings: model claude-opus-5-5, effort low from .wachiman.yml at the base commit ${BASE.slice(0, 7)}`]);
  });

  test("a file that exists only in the head is ignored: the base has none", () => {
    const { gh, refs } = fakeGh({ head: "effort: max\n" });
    const logs: string[] = [];
    const config = withBaseSettings(loadConfig({}), gh, "o/r", 5, (l) => logs.push(l));
    expect(config).toMatchObject({ effort: "high", effortSource: "default", model: "claude-sonnet-5-5", modelSource: "default" });
    expect(refs).toEqual([BASE]);
    expect(logs).toEqual([]);
  });

  test("an explicit model and effort win, and then nothing is read at all", () => {
    const { gh, calls } = fakeGh({ base: "effort: low\nmodel: claude-opus-5-5\n" });
    const config = withBaseSettings(loadConfig({ WACHIMAN_MODEL: "claude-haiku-5-5", WACHIMAN_EFFORT: "max" }), gh, "o/r", 5, () => {});
    expect(config).toMatchObject({ model: "claude-haiku-5-5", effort: "max" });
    expect(calls()).toBe(0);
  });

  test("an explicit effort with no model: the file still supplies the model", () => {
    const { gh } = fakeGh({ base: "effort: low\nmodel: claude-opus-5-5\n" });
    expect(withBaseSettings(loadConfig({ WACHIMAN_EFFORT: "max" }), gh, "o/r", 5, () => {})).toMatchObject({
      model: "claude-opus-5-5",
      effort: "max",
      effortSource: "env",
    });
  });

  test("an invalid effort at the base is ignored with a warning naming the file and the value; the run continues on the defaults", () => {
    const { gh } = fakeGh({ base: "effort: turbo\n" });
    const warnings: string[] = [];
    const config = withBaseSettings(
      loadConfig({}),
      gh,
      "o/r",
      5,
      () => {},
      (line) => warnings.push(line),
    );
    expect(config).toMatchObject({ effort: "high", effortSource: "default", modelSource: "default" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      /^ignored \.wachiman\.yml at the base commit [0-9a-f]{7}: .*effort must be one of .*got "turbo"; using defaults$/,
    );
  });

  test("unparseable YAML at the base is ignored with a warning, and an explicit value still applies", () => {
    const { gh } = fakeGh({ base: "model: [unclosed\n" });
    const warnings: string[] = [];
    const config = withBaseSettings(
      loadConfig({ WACHIMAN_EFFORT: "max" }),
      gh,
      "o/r",
      5,
      () => {},
      (line) => warnings.push(line),
    );
    expect(config).toMatchObject({ effort: "max", effortSource: "env", modelSource: "default" });
    expect(warnings[0]).toContain("ignored .wachiman.yml at the base commit");
    expect(warnings[0]).toContain("is not valid YAML");
  });

  test("a GitHub error other than 404 stops the run instead of falling back to the defaults", () => {
    const gh: GhFn = (args) => {
      if (args[1] === "repos/o/r/pulls/5") return BASE;
      throw new GhError("gh api failed: HTTP 502", 502, "Bad Gateway");
    };
    expect(() => withBaseSettings(loadConfig({}), gh, "o/r", 5, () => {})).toThrow(GhError);
  });

  test("a file too large for the contents API is a usage error", () => {
    const gh: GhFn = () => JSON.stringify({ type: "file", encoding: "none", content: "" });
    expect(() => readBaseSettings(gh, "o/r", BASE)).toThrow(/too large/);
  });
});

describe("the review key (ADR 0064)", () => {
  const parse = (yaml: string) => parseRepoSettings(yaml);

  test("absent: nothing is set, and the policy has no comment rule", () => {
    expect(parse("effort: low\n").review).toBeUndefined();
    expect(reviewPolicyOf(parse("effort: low\n"), () => {})).toEqual({});
    expect(reviewPolicyOf(undefined, () => {})).toEqual({});
    expect(reviewPolicyOf(parse(""), () => {})).toEqual({});
  });

  test("true turns the comment rule on", () => {
    const settings = parse("review:\n  comments_point_to_docs: true\n");
    expect(settings.review).toEqual({ commentsPointToDocs: true });
    expect(reviewPolicyOf(settings, () => {})).toEqual({ commentsPointToDocs: true });
  });

  test("false is the same as absent for the policy", () => {
    const settings = parse("review:\n  comments_point_to_docs: false\n");
    expect(settings.review).toEqual({ commentsPointToDocs: false });
    expect(reviewPolicyOf(settings, () => {})).toEqual({});
  });

  test("an empty value counts as not set", () => {
    expect(parse("review:\n  comments_point_to_docs:\n").review).toBeUndefined();
    expect(parse("review:\n").review).toBeUndefined();
  });

  test("a value that is not a boolean is ignored with a notice, never an error, and the rule stays off", () => {
    for (const value of ['"true"', "1", "yes please", "[true]"]) {
      const settings = parse(`effort: low\nreview:\n  comments_point_to_docs: ${value}\n`);
      expect(settings.effort).toBe("low");
      expect(settings.review).toBeUndefined();
      expect(settings.reviewNotices).toHaveLength(1);
      expect(settings.reviewNotices![0]).toContain(".wachiman.yml: review.comments_point_to_docs must be true or false, got ");
      const warnings: string[] = [];
      expect(reviewPolicyOf(settings, (l) => warnings.push(l))).toEqual({});
      expect(warnings).toEqual(settings.reviewNotices!);
    }
  });

  test("true turns the lockfile check on, and it is independent of the comment rule", () => {
    const settings = parse("review:\n  lockfile_check: true\n");
    expect(settings.review).toEqual({ lockfileCheck: true });
    expect(reviewPolicyOf(settings, () => {})).toEqual({ lockfileCheck: true });
    const both = parse("review:\n  comments_point_to_docs: true\n  lockfile_check: true\n");
    expect(reviewPolicyOf(both, () => {})).toEqual({ commentsPointToDocs: true, lockfileCheck: true });
  });

  test("the lockfile check is off when false, empty, absent or unreadable", () => {
    expect(reviewPolicyOf(parse("review:\n  lockfile_check: false\n"), () => {})).toEqual({});
    expect(parse("review:\n  lockfile_check:\n").review).toBeUndefined();
    const warnings: string[] = [];
    const settings = parse("review:\n  lockfile_check: yes please\n");
    expect(reviewPolicyOf(settings, (l) => warnings.push(l))).toEqual({});
    expect(warnings[0]).toContain(".wachiman.yml: review.lockfile_check must be true or false, got ");
  });

  test("a review that is not a mapping is ignored with a notice", () => {
    for (const yaml of ["review: true\n", "review: [a]\n"]) {
      const settings = parse(yaml);
      expect(settings.review).toBeUndefined();
      expect(settings.reviewNotices).toEqual([".wachiman.yml: review must be a mapping of settings; ignored"]);
    }
  });

  test("unknown keys inside review are ignored", () => {
    expect(parse("review:\n  something_else: true\n").review).toBeUndefined();
  });

  test("the paths and the comment rule travel together in one policy", () => {
    const settings = parse('paths:\n  - match: "a/**"\n    severity: high\n    reason: r\nreview:\n  comments_point_to_docs: true\n');
    expect(reviewPolicyOf(settings, () => {})).toEqual({
      pathRules: [{ match: "a/**", severity: "high", reason: "r" }],
      commentsPointToDocs: true,
    });
  });
});

describe("the memory key", () => {
  test("defaults are 2, 150, 400 and 90 when nothing is set", () => {
    expect(resolveMemorySettings(undefined)).toEqual({
      settings: { minEvidence: 2, maxIndexLines: 150, maxLoadedLines: 400, archiveAfterDays: 90 },
      notices: [],
    });
    expect(parseRepoSettings("model: x\n")).toEqual({ model: "x" });
  });

  test("valid values override the defaults one by one", () => {
    const parsed = parseRepoSettings("memory:\n  min_evidence: 3\n  max_loaded_lines: 600\n");
    expect(parsed.memory).toEqual({ minEvidence: 3, maxLoadedLines: 600 });
    expect(resolveMemorySettings(parsed).settings).toEqual({
      minEvidence: 3,
      maxIndexLines: 150,
      maxLoadedLines: 600,
      archiveAfterDays: 90,
    });
  });

  test.each([["0"], ["-5"], ["2.5"], ['"many"'], ["true"], ["[1]"]])(
    "a value of %s is ignored with a notice and the default applies",
    (value) => {
      const parsed = parseRepoSettings(`memory:\n  max_index_lines: ${value}\n  archive_after_days: 30\n`);
      expect(parsed.memory).toEqual({ archiveAfterDays: 30 });
      expect(parsed.memoryNotices).toHaveLength(1);
      expect(parsed.memoryNotices![0]).toContain("memory.max_index_lines must be a positive whole number");
      expect(resolveMemorySettings(parsed).settings.maxIndexLines).toBe(150);
    },
  );

  test("a memory key that is not a mapping is ignored with a notice", () => {
    const parsed = parseRepoSettings("memory: 5\n");
    expect(parsed.memory).toBeUndefined();
    expect(parsed.memoryNotices![0]).toContain("memory must be a mapping");
  });

  test("max_loaded_lines is clamped to 1000 with a notice", () => {
    const resolved = resolveMemorySettings(parseRepoSettings("memory:\n  max_loaded_lines: 50000\n"));
    expect(resolved.settings.maxLoadedLines).toBe(1000);
    expect(resolved.notices).toHaveLength(1);
    expect(resolved.notices[0]).toContain("above the limit");
  });
});
