/**
 * Author or model text as one inert line of markdown: one line, no HTML tag, no link, no code span,
 * no mention, no autolink, no issue or pull request reference (`#12`, `owner/repo#12`, `GH-12`: a
 * reference in a description would cross-link, and with a closing keyword could close, that issue).
 * An ampersand is escaped so an entity such as `&#35;12` cannot spell a reference or a mention. A bare
 * commit SHA is left alone: GitHub links it but does not write to the commit. The backslash is
 * escaped first, so a backslash in the text cannot cancel the escape placed before a bracket or
 * a backtick (`\[x\](u)` would otherwise become `\\[x\\](u)`, a live link). Other markdown,
 * emphasis for one, stays as written: it is one line, not a block.
 */
export function inertText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replaceAll("\\", "\\\\")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replaceAll("`", "\\`")
    .replaceAll("@", "@​")
    .replaceAll("://", ":​//")
    .replace(/(#|GH-)(?=\d)/gi, "$1\u200b")
    .replace(/www\./gi, (m) => `${m.slice(0, 3)}​.`);
}
