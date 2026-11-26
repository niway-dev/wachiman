import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ENDPOINT } from "./send";
import {
  ERRORS,
  LANGUAGES,
  LAYOUTS,
  MAX_LANGUAGES,
  MAX_SUMMARY_BYTES,
  MODEL_FAMILIES,
  MODES,
  OUTCOMES,
  SEVERITY_KEYS,
  SUMMARY_KEYS,
  TELEMETRY_FORMAT,
} from "./summary";
import { SEVERITY } from "../engine";

const PAGE = readFileSync(join(import.meta.dir, "..", "..", "docs", "telemetry-api.md"), "utf8");

/** The rows of the first table under "The body": the backticked first cell and the second cell. */
function fieldRows(): [string, string][] {
  const section = PAGE.slice(PAGE.indexOf("\n## The body\n"), PAGE.indexOf("\n## The answers\n"));
  return section
    .split("\n")
    .filter((l) => /^\| `/.test(l))
    .map((l) => {
      const cells = l.split("|").map((c) => c.trim());
      return [cells[1].replace(/`/g, ""), cells[2]] as [string, string];
    });
}

describe("docs/telemetry-api.md and the client agree", () => {
  test("the field table lists exactly the keys buildSummary produces, in the same order", () => {
    expect(fieldRows().map(([name]) => name)).toEqual([...SUMMARY_KEYS]);
  });

  test("every enumerated value of the builder is in its row, and the engine's severity keys are the ones listed", () => {
    const row = (name: string) => fieldRows().find(([n]) => n === name)![1];
    for (const value of MODES) expect(row("mode")).toContain(`"${value}"`);
    for (const value of MODEL_FAMILIES) expect(row("model")).toContain(`"${value}"`);
    for (const value of OUTCOMES) expect(row("outcome")).toContain(`"${value}"`);
    for (const value of ERRORS) expect(row("error")).toContain(`"${value}"`);
    for (const value of LAYOUTS) expect(row("layout")).toContain(`"${value}"`);
    for (const value of SEVERITY_KEYS) expect(row("findings")).toContain(value);
    expect([...SEVERITY_KEYS] as string[]).toEqual(Object.keys(SEVERITY));
    expect(row("languages")).toContain(`up to ${["zero", "one", "two", "three", "four", "five"][MAX_LANGUAGES]}`);
    expect(row("format")).toContain(TELEMETRY_FORMAT);
  });

  test("the language list, the route, the size cap and the answers are the client's", () => {
    const listed = PAGE.slice(PAGE.indexOf("The languages the table can produce:"), PAGE.indexOf("It never carries code")).replace(
      /[\s]+/g,
      " ",
    );
    for (const language of LANGUAGES) expect(listed).toContain(language);
    expect(listed.match(/[a-z]+(?=[,.])/g)!.length).toBe(LANGUAGES.length);
    expect(PAGE).toContain(`POST ${ENDPOINT}`);
    expect(PAGE).toContain(`${MAX_SUMMARY_BYTES} bytes`);
    for (const status of ["204", "400", "413"]) expect(PAGE).toContain(`| \`${status}\``);
    expect(PAGE).toContain("90 days");
  });
});
