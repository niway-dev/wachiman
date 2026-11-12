/**
 * Author or model text as one inert line of markdown: one line, no HTML tag, no link, no code span,
 * no mention, no autolink. The backslash is escaped first, so a backslash in the text cannot cancel
 * the escape placed before a bracket or a backtick (`\[x\](u)` would otherwise become `\\[x\\](u)`,
 * a live link). Other markdown, emphasis for one, stays as written: it is one line, not a block.
 */
export function inertText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replaceAll("\\", "\\\\")
    .replaceAll("<", "&lt;")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replaceAll("`", "\\`")
    .replaceAll("@", "@​")
    .replaceAll("://", ":​//")
    .replace(/www\./gi, (m) => `${m.slice(0, 3)}​.`);
}
