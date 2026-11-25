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
 * `engine.ts` re-exports it. This file imports nothing from the engine, so it is safe to load first.
 */
export const neutralise = (text: string) => text.replaceAll("<!--", "&lt;!--").replaceAll("-->", "--&gt;");

/** `<details` and `</details>` become `&lt;details` and `&lt;/details>`: model text cannot open or close a collapsed block. */
export const defuseDetails = (text: string) => text.replace(/<(\/?)details/gi, "&lt;$1details");

/** A line break of any kind: LF, CR, the Unicode line and paragraph separators, NEL, vertical tab, form feed. */
const BREAKS = new RegExp(`[${String.raw`\r\n`}${String.fromCharCode(0x2028, 0x2029, 0x85)}${String.raw`\v\f`}]+`);

/**
 * Joins the lines of `text` with one space each, dropping the whitespace around every break. It
 * splits on the breaks and trims each piece; a regex with `\s*` padding around the breaks would
 * backtrack quadratically on a long run of spaces that holds no break.
 */
const oneLineOf = (text: string) =>
  text
    .split(BREAKS)
    .map((piece) => piece.trim())
    .filter((piece) => piece !== "")
    .join(" ");

/**
 * One cell of a Markdown table, from text Wachiman did not write: one line, no leading or trailing
 * space, no comment that could pass for a marker, and no pipe or backtick that a renderer would
 * read as syntax. The backslash is doubled first, so a backslash in the text cannot cancel the
 * escape placed before a pipe or a backtick. Every table cell with such text goes through here.
 */
export const escapeCell = (text: string) =>
  defuseDetails(neutralise(oneLineOf(text)))
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("`", "\\`");
