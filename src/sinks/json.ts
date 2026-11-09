/**
 * `--format json`: the result as a file. Committed changes write `docs/formats/review-result.v1.schema.json`
 * by default (`toResultV1`); `version` 2 writes the full result (`review-result.v2.schema.json`).
 */
import type { ReviewResult } from "../engine";
import { toResultV1 } from "../formats";

export const renderJson = (result: ReviewResult, version: 1 | 2 = 1) =>
  `${JSON.stringify(version === 1 ? toResultV1(result) : result, null, 2)}\n`;
