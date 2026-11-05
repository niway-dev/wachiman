/** `--format json`: the `ReviewResult` itself (`docs/formats/review-result.v1.schema.json`). */
import type { ReviewResult } from "../engine";

export const renderJson = (result: ReviewResult) => `${JSON.stringify(result, null, 2)}\n`;
