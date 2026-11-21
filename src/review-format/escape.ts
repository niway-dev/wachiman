/**
 * Making text Wachiman did not write safe where the review body puts it (spec "Failures this must
 * protect against", 5). A model's finding title, a file path, a provider's error text and a
 * needs-a-person line all reach the body, some of them in a table cell, where a pipe ends the cell,
 * a newline ends the row, a backtick opens a code span across cells and an HTML comment can forge
 * one of the engine's hidden markers.
 */

/**
 * Defuses HTML comments in text a model wrote, so it cannot forge the incremental marker or a
 * signature: `<!--` becomes `&lt;!--` and `-->` becomes `--&gt;`. Markdown shows both as before.
 * `engine.ts` re-exports it; it lives here so the review format needs nothing from the engine.
 */
export const neutralise = (text: string) =>
  text.replaceAll("<!--", "&lt;!--").replaceAll("-->", "--&gt;");

/** A line break of any kind: LF, CR, the Unicode line and paragraph separators, NEL, vertical tab, form feed. */
const BREAKS = new RegExp(String.raw`\s*[\r\n${String.fromCharCode(0x2028, 0x2029, 0x85)}\v\f]+\s*`, "g");

/**
 * One cell of a Markdown table, from text Wachiman did not write: one line, no leading or trailing
 * space, no comment that could pass for a marker, and no pipe or backtick that a renderer would
 * read as syntax. The backslash is doubled first, so a backslash in the text cannot cancel the
 * escape placed before a pipe or a backtick. Every table cell with such text goes through here.
 */
export const escapeCell = (text: string) =>
  neutralise(text.replace(BREAKS, " ").trim())
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("`", "\\`");
