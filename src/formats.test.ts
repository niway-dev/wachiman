import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UsageError } from "./config";
import {
  REVIEW_INPUT_FORMAT,
  REVIEW_RESULT_V1,
  REVIEW_RESULT_V2,
  assertReviewInputFormat,
  readReviewResultFormat,
  toResultV1,
  type ReviewInput,
  type ReviewResultV1,
  type ReviewResultV2,
} from "./formats";
import { checkKeywords, validate } from "../test/support/json-schema";

// Spec D15, ADR 0019 decision 9: the review input and result are public, versioned JSON formats.

const ROOT = join(import.meta.dir, "..");
const json = (path: string) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));
const inputSchema = json("docs/formats/review-input.v1.schema.json");
const resultSchema = json("docs/formats/review-result.v1.schema.json");
const resultSchemaV2 = json("docs/formats/review-result.v2.schema.json");
const fixtures = {
  pullRequest: json("test/fixtures/formats/review-input.pull-request.json") as Omit<ReviewInput, "headDir">,
  branch: json("test/fixtures/formats/review-input.branch.json") as Omit<ReviewInput, "headDir">,
  result: json("test/fixtures/formats/review-result.example.json") as ReviewResultV1,
  resultV2: json("test/fixtures/formats/review-result.v2.example.json") as ReviewResultV2,
  resultV2AsV1: json("test/fixtures/formats/review-result.v2-as-v1.example.json") as ReviewResultV1,
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
    expect(() => assertReviewInputFormat({ format: "wachiman.review-input/3" })).toThrow(UsageError);
    expect(() => assertReviewInputFormat({ format: "wachiman.review-input/3" })).toThrow(REVIEW_INPUT_FORMAT);
    expect(() => assertReviewInputFormat({})).toThrow(UsageError);
    expect(() => assertReviewInputFormat(inMemory(fixtures.branch))).not.toThrow();
  });

  test("the schemas use only keywords the validator checks", () => {
    expect(() => checkKeywords(inputSchema)).not.toThrow();
    expect(() => checkKeywords(resultSchema)).not.toThrow();
    expect(() => checkKeywords(resultSchemaV2)).not.toThrow();
    expect(() => checkKeywords({ type: "object", properties: { a: { pattern: "x" } } })).toThrow('"pattern"');
  });
});

describe("review result /2", () => {
  const clone = () => structuredClone(fixtures.resultV2);

  test("the /2 fixture validates against the /2 schema, and the schema is closed where the types spec says", () => {
    expect(validate(resultSchemaV2, fixtures.resultV2)).toEqual([]);
    expect(JSON.parse(JSON.stringify(fixtures.resultV2))).toEqual(fixtures.resultV2);
    // Negative controls: a root key nobody declared, a finding without origin, a citation at line 0,
    // a citation in no snapshot, a verification status that is not a status, an account path.
    expect(validate(resultSchemaV2, { ...clone(), configDir: "/home/me/.claude" })).toEqual(['$: unexpected property "configDir"']);
    const noOrigin = clone();
    delete (noOrigin.findings[0] as Partial<(typeof noOrigin.findings)[0]>).origin;
    expect(validate(resultSchemaV2, noOrigin)).toEqual(['$.findings[0]: missing required "origin"']);
    const lineZero = clone();
    lineZero.findings[0].verification.checked[0].line = 0;
    expect(validate(resultSchemaV2, lineZero)).toEqual(["$.findings[0].verification.checked[0].line: 0 is below 1"]);
    const noSnapshot = clone();
    (noSnapshot.findings[0].verification.checked[0] as { snapshot: string }).snapshot = "tree";
    expect(validate(resultSchemaV2, noSnapshot)).toEqual(['$.findings[0].verification.checked[0].snapshot: "tree" is not one of ["base","head"]']);
    const unreached = clone();
    (unreached.findings[0].verification as { unreached: unknown }).unreached = "yes";
    expect(validate(resultSchemaV2, unreached)).toHaveLength(1);
    const badStatus = clone();
    (badStatus.findings[0].verification as { status: string }).status = "confirmed";
    expect(validate(resultSchemaV2, badStatus)).toHaveLength(1);
    const path = clone();
    (path.provider.account as Record<string, unknown>).configDir = "/home/me/.claude-work";
    expect(validate(resultSchemaV2, path)).toEqual(['$.provider.account: unexpected property "configDir"']);
    // A /1 document is not a /2 document and the other way round.
    expect(validate(resultSchemaV2, fixtures.result).length).toBeGreaterThan(0);
    expect(validate(resultSchema, fixtures.resultV2).length).toBeGreaterThan(0);
  });

  test("toResultV1 gives the hand-written /1 fixture, validates against the /1 schema and leaves no /2 key behind", () => {
    const before = JSON.stringify(fixtures.resultV2);
    const v1 = toResultV1(fixtures.resultV2);
    expect(v1).toEqual(fixtures.resultV2AsV1);
    expect(v1.format).toBe(REVIEW_RESULT_V1);
    expect(validate(resultSchema, JSON.parse(JSON.stringify(v1)))).toEqual([]);
    const text = JSON.stringify(v1);
    for (const key of ["verification", "origin", "originReason", "originEvidence", "tier", "account", "candidateId", "fidelity"]) {
      expect(text, key).not.toContain(`"${key}"`);
    }
    // Pure: the input is untouched, and the surviving findings are all still there.
    expect(JSON.stringify(fixtures.resultV2)).toBe(before);
    expect(v1.findings.map((f) => f.title)).toEqual(fixtures.resultV2.findings.map((f) => f.title));
  });

  test("a /2 result carries fidelity for a pull request review, validated by the schema, and /1 never does", () => {
    const withFidelity = clone();
    expect(withFidelity.fidelity?.grade).toBe("B");
    expect(validate(resultSchemaV2, JSON.parse(JSON.stringify(withFidelity)))).toEqual([]);
    // The field is optional: a local review has none.
    const local = clone();
    delete local.fidelity;
    expect(validate(resultSchemaV2, JSON.parse(JSON.stringify(local)))).toEqual([]);
    // Negative controls: a grade that is not a grade, and a claim status the engine does not know.
    const badGrade = clone();
    (badGrade.fidelity as { grade: string }).grade = "A+";
    expect(validate(resultSchemaV2, badGrade).length).toBeGreaterThan(0);
    const badStatus = clone();
    (badStatus.fidelity!.claims[0] as { status: string }).status = "proven";
    expect(validate(resultSchemaV2, badStatus).length).toBeGreaterThan(0);
    // ADR 0030: /1 has no place for it, and the downgrade drops it.
    const v1 = toResultV1(withFidelity);
    expect(v1).not.toHaveProperty("fidelity");
    expect(validate(resultSchema, JSON.parse(JSON.stringify(v1)))).toEqual([]);
  });

  test("a /2 result without verification downgrades with no added notice", () => {
    const off = clone();
    delete off.verification;
    off.findings = off.findings.map((f) => ({ ...f, origin: "unknown" as const, tier: f.severity === "fix" ? "Important" : "Nit", verification: { status: "unverified" as const, reason: "", checked: [] } }));
    const v1 = toResultV1(off);
    expect(v1.execution.notices).toEqual([]);
    expect(validate(resultSchema, JSON.parse(JSON.stringify(v1)))).toEqual([]);
  });

  test("a working-tree result cannot be downgraded: a tree id must not pass for a commit", () => {
    const tree = clone();
    (tree.change as { kind: string }).kind = "working-tree";
    expect(() => toResultV1(tree)).toThrow(UsageError);
    expect(() => toResultV1(tree)).toThrow("working-tree");
  });

  test("the reader accepts /1 and /2 and refuses any other version with a usage error", () => {
    expect(readReviewResultFormat(fixtures.result)).toBe(REVIEW_RESULT_V1);
    expect(readReviewResultFormat(fixtures.resultV2)).toBe(REVIEW_RESULT_V2);
    expect(() => readReviewResultFormat({ ...fixtures.result, format: "wachiman.review-result/3" })).toThrow(UsageError);
    expect(() => readReviewResultFormat({})).toThrow(REVIEW_RESULT_V2);
  });
});

test("working-tree /2 schemas require explicit metadata and /1 stays committed-only", () => {
  const schema = json("docs/formats/review-input.v2.schema.json");
  checkKeywords(schema);
  const change = {
    ...fixtures.branch.change,
    kind: "working-tree",
    workingTree: {
      mode: "all",
      baseCommit: "a".repeat(40),
      tree: "b".repeat(40),
    },
  };
  const input = {
    ...fixtures.branch,
    format: "wachiman.review-input/2",
    change,
  };
  expect(() => assertReviewInputFormat(input)).not.toThrow();
  expect(validate(schema, input)).toEqual([]);
  expect(validate(inputSchema, input).length).toBeGreaterThan(0);
  expect(
    validate(schema, {
      ...input,
      change: { ...change, workingTree: undefined },
    }).length,
  ).toBeGreaterThan(0);
  expect(validate(resultSchemaV2, { ...fixtures.resultV2, change })).toEqual([]);
  expect(validate(resultSchema, { ...fixtures.result, change }).length).toBeGreaterThan(0);
});
