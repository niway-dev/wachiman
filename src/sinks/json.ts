/**
 * `--format json`: the result as a file. Committed changes write `docs/formats/review-result.v1.schema.json`
 * by default (`toResultV1`); `version` 2 writes the full result (`review-result.v2.schema.json`).
 */
import type { ReviewResult } from "../engine";
import { toResultV1 } from "../formats";

/**
 * `ids[i]` is the history id of `result.findings[i]` (ADR 0034). Only `/2` carries it, as an
 * optional `id` on a finding; `/1` is never changed.
 */
export const renderJson = (result: ReviewResult, version: 1 | 2 = 1, ids?: (string | undefined)[]) => {
  const out =
    version === 1
      ? toResultV1(result)
      : ids
        ? { ...result, findings: result.findings.map((f, i) => (ids[i] === undefined ? f : { ...f, id: ids[i] })) }
        : result;
  return `${JSON.stringify(out, null, 2)}\n`;
};
