import { describe, expect, test } from "bun:test";
import { UsageError } from "./config";
import { parseFlags } from "./flags";

const spec = { values: ["--config-dir", "--note"], booleans: ["--json", "--yes"] };

describe("parseFlags", () => {
  test("takes positionals, `--flag value`, `--flag=value` and booleans in any order", () => {
    const parsed = parseFlags(["work-a", "--config-dir", "/x", "--json", "--note=two words"], spec, "profile add");
    expect(parsed.positionals).toEqual(["work-a"]);
    expect(parsed.values).toEqual({ "--config-dir": "/x", "--note": "two words" });
    expect(parsed.booleans).toEqual({ "--json": true });
  });

  test("an unknown flag, a value flag without a value and a boolean with a value are usage errors", () => {
    expect(() => parseFlags(["--nope"], spec, "profile add")).toThrow(UsageError);
    expect(() => parseFlags(["--note"], spec, "profile add")).toThrow(/--note needs a value/);
    expect(() => parseFlags(["--note", "--json"], spec, "profile add")).toThrow(/--note needs a value/);
    expect(() => parseFlags(["--note="], spec, "profile add")).toThrow(/--note needs a value/);
    expect(() => parseFlags(["--json=1"], spec, "profile add")).toThrow(/--json takes no value/);
  });

  test("a repeated value flag is a usage error rather than a silent last-wins", () => {
    expect(() => parseFlags(["--note", "a", "--note", "b"], spec, "profile add")).toThrow(/--note given twice/);
  });
});
