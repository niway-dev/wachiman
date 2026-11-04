import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UsageError } from "./config";
import { REVIEW_INPUT_FORMAT, assertReviewInputFormat, type ReviewInput, type ReviewResult } from "./formats";
import { checkKeywords, validate } from "../test/support/json-schema";

// Spec D15, ADR 0019 decision 9: the review input and result are public, versioned JSON formats.

const ROOT = join(import.meta.dir, "..");
const json = (path: string) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));
const inputSchema = json("docs/formats/review-input.v1.schema.json");
const resultSchema = json("docs/formats/review-result.v1.schema.json");
const fixtures = {
  pullRequest: json("test/fixtures/formats/review-input.pull-request.json") as Omit<ReviewInput, "headDir">,
  branch: json("test/fixtures/formats/review-input.branch.json") as Omit<ReviewInput, "headDir">,
  result: json("test/fixtures/formats/review-result.example.json") as ReviewResult,
};

/** What a connector holds in memory: the file's content plus the head directory. */
const inMemory = (input: Omit<ReviewInput, "headDir">): ReviewInput => ({ ...input, headDir: "/tmp/head" });
const withoutHeadDir = ({ headDir: _, ...rest }: ReviewInput) => rest;

describe("review formats", () => {
  test("each fixture validates against its schema", () => {
    expect(validate(inputSchema, fixtures.pullRequest)).toEqual([]);
    expect(validate(inputSchema, fixtures.branch)).toEqual([]);
    expect(validate(resultSchema, fixtures.result)).toEqual([]);
    // Negative controls: a later version, and the in-memory headDir written to a file.
    expect(validate(inputSchema, { ...fixtures.pullRequest, format: "wachiman.review-input/2" })).toEqual([
      '$.format: expected "wachiman.review-input/1"',
    ]);
    expect(validate(inputSchema, inMemory(fixtures.branch))).toEqual(['$: unexpected property "headDir"']);
  });

  test("the formats survive a JSON round trip, headDir excepted", () => {
    for (const input of [inMemory(fixtures.pullRequest), inMemory(fixtures.branch)]) {
      const file = withoutHeadDir(input);
      expect(JSON.parse(JSON.stringify(file))).toEqual(file);
      expect(validate(inputSchema, JSON.parse(JSON.stringify(file)))).toEqual([]);
    }
    expect(JSON.parse(JSON.stringify(fixtures.result))).toEqual(fixtures.result);
  });

  test("the core refuses an unknown format with a usage error", () => {
    expect(() => assertReviewInputFormat({ format: "wachiman.review-input/2" })).toThrow(UsageError);
    expect(() => assertReviewInputFormat({ format: "wachiman.review-input/2" })).toThrow(REVIEW_INPUT_FORMAT);
    expect(() => assertReviewInputFormat({})).toThrow(UsageError);
    expect(() => assertReviewInputFormat(inMemory(fixtures.branch))).not.toThrow();
  });

  test("the schemas use only keywords the validator checks", () => {
    expect(() => checkKeywords(inputSchema)).not.toThrow();
    expect(() => checkKeywords(resultSchema)).not.toThrow();
    expect(() => checkKeywords({ type: "object", properties: { a: { pattern: "x" } } })).toThrow('"pattern"');
  });
});
