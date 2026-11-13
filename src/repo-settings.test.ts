import { describe, expect, test } from "bun:test";
import { loadConfig, UsageError } from "./config";
import { GhError, readBaseSettings, withBaseSettings, type GhFn } from "./engine";
import { applyRepoSettings, effectiveSettings, fileSettingsNote, parseRepoSettings, wantsRepoSettings } from "./repo-settings";
import { settingsContent } from "./init/settings";

const BASE = "b".repeat(40);
const HEAD = "a".repeat(40);

describe("parseRepoSettings", () => {
  test("reads kind, model and effort; unknown keys are ignored", () => {
    expect(parseRepoSettings("kind: monorepo\nmodel: claude-opus-5-5\neffort: xhigh\nfuture: 1\n")).toEqual({ kind: "monorepo", model: "claude-opus-5-5", effort: "xhigh" });
  });

  test("an empty file, comments only and keys with no value hold nothing", () => {
    expect(parseRepoSettings("")).toEqual({});
    expect(parseRepoSettings("# model: x\n# effort: high\n")).toEqual({});
    expect(parseRepoSettings("model:\neffort:\n")).toEqual({});
  });

  test("the file `init` writes parses to its kind only: model and effort are commented out", () => {
    expect(parseRepoSettings(settingsContent("single"))).toEqual({ kind: "single" });
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

describe("precedence: an explicit value beats the file, the file beats the default", () => {
  const file = { model: "claude-opus-5-5", effort: "low" as const };

  test("nothing explicit: the file's values apply and are marked as from the file", () => {
    const config = applyRepoSettings(loadConfig({}), file);
    expect(config).toMatchObject({ model: "claude-opus-5-5", modelSource: "file", effort: "low", effortSource: "file" });
    expect(fileSettingsNote(config, "the base commit bbbbbbb")).toBe("model claude-opus-5-5, effort low from .wachiman.yml at the base commit bbbbbbb");
  });

  test("an explicit WACHIMAN_MODEL and WACHIMAN_EFFORT win over the file", () => {
    const config = applyRepoSettings(loadConfig({ WACHIMAN_MODEL: "claude-haiku-5-5", WACHIMAN_EFFORT: "max" }), file);
    expect(config).toMatchObject({ model: "claude-haiku-5-5", modelSource: "env", effort: "max", effortSource: "env" });
    expect(fileSettingsNote(config, "x")).toBeUndefined();
    expect(wantsRepoSettings(config)).toBe(false);
  });

  test("each setting is decided on its own", () => {
    const config = applyRepoSettings(loadConfig({ WACHIMAN_EFFORT: "medium" }), file);
    expect(config).toMatchObject({ model: "claude-opus-5-5", modelSource: "file", effort: "medium", effortSource: "env" });
  });

  test("an empty workflow input counts as not set, so the file applies", () => {
    const loaded = loadConfig({ WACHIMAN_MODEL: "", WACHIMAN_EFFORT: "" });
    expect(loaded).toMatchObject({ modelSource: "default", effortSource: "default", model: "claude-sonnet-5-5", effort: "high" });
    expect(applyRepoSettings(loaded, file)).toMatchObject({ model: "claude-opus-5-5", effort: "low" });
  });

  test("a file with no model or effort leaves the defaults, marked as defaults", () => {
    expect(applyRepoSettings(loadConfig({}), { kind: "single" })).toMatchObject({ model: "claude-sonnet-5-5", modelSource: "default", effort: "high", effortSource: "default" });
  });

  test("doctor's view of the same rule", () => {
    expect(effectiveSettings({}, file)).toEqual({ model: { value: "claude-opus-5-5", source: "file" }, effort: { value: "low", source: "file" } });
    expect(effectiveSettings({ WACHIMAN_MODEL: "m", WACHIMAN_EFFORT: "max" }, file)).toEqual({ model: { value: "m", source: "env" }, effort: { value: "max", source: "env" } });
    expect(effectiveSettings({ WACHIMAN_MODEL: "" }, undefined)).toEqual({ model: { value: "claude-sonnet-5-5", source: "default" }, effort: { value: "high", source: "default" } });
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
    expect(withBaseSettings(loadConfig({ WACHIMAN_EFFORT: "max" }), gh, "o/r", 5, () => {})).toMatchObject({ model: "claude-opus-5-5", effort: "max", effortSource: "env" });
  });

  test("an invalid effort at the base is ignored with a warning naming the file and the value; the run continues on the defaults", () => {
    const { gh } = fakeGh({ base: "effort: turbo\n" });
    const warnings: string[] = [];
    const config = withBaseSettings(loadConfig({}), gh, "o/r", 5, () => {}, (line) => warnings.push(line));
    expect(config).toMatchObject({ effort: "high", effortSource: "default", modelSource: "default" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^ignored \.wachiman\.yml at the base commit [0-9a-f]{7}: .*effort must be one of .*got "turbo"; using defaults$/);
  });

  test("unparseable YAML at the base is ignored with a warning, and an explicit value still applies", () => {
    const { gh } = fakeGh({ base: "model: [unclosed\n" });
    const warnings: string[] = [];
    const config = withBaseSettings(loadConfig({ WACHIMAN_EFFORT: "max" }), gh, "o/r", 5, () => {}, (line) => warnings.push(line));
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
