/**
 * The description without its guide comments and without the stamp line: what an agent posts
 * after filling the installed template. The Wachiman block markers, and anything inside the
 * block (the digest comment among it), stay, and so does every comment that is the repository's
 * own (a CLA reminder at the top, a note in a custom section).
 *
 * Strip changes only what it removes: the comment, the spaces a removal leaves at the end of its line
 * and the run of blank lines around it. Trailing spaces, tabs and blank lines anywhere else, fenced
 * code included, come back byte for byte.
 *
 * A comment is a guide comment when its text is one of the catalog's guides or intro, when it starts
 * with the lead of the status table's guidance (the one comment above the table that lists every
 * row's guide), when it sits in a status row's value cell (the older layout), or when it directly follows a `##` heading or a `<summary>` line,
 * which is where every guide is written. Any other comment is the repository's. `all: true` is
 * the earlier checker's behaviour: every comment goes except the two block markers.
 */
import { loadCatalog, type Catalog } from "./catalog";
import { parseDescription, type DescriptionComment, type ParsedDescription } from "./describe";
import { STATUS_GUIDE_LEAD } from "./render";

export interface StripOptions {
  /** The catalog whose guide texts are recognised. Default: the shipped one. */
  catalog?: Catalog;
  /** Remove every comment except the block markers. */
  all?: boolean;
}

const STAMP = /^wachiman:pr-template version=\d+ sha256=[0-9a-f]{64}$/;
const normalise = (text: string) => text.replace(/\s+/g, " ").trim();

function guideTexts(catalog: Catalog): Set<string> {
  const texts = new Set<string>();
  if (catalog.intro.trim() !== "") texts.add(normalise(catalog.intro));
  for (const e of catalog.sections) if (e.guide !== undefined) texts.add(normalise(e.guide));
  return texts;
}

/** The last line before `line` with something on it once comments are blanked, or -1. */
function previousContentLine(cleanLines: string[], line: number): number {
  for (let i = line - 1; i >= 0; i--) if (cleanLines[i]!.trim() !== "") return i;
  return -1;
}

function isGuide(c: DescriptionComment, parsed: ParsedDescription, cleanLines: string[], texts: Set<string>): boolean {
  if (texts.has(normalise(c.text))) return true;
  if (normalise(c.text).startsWith(normalise(STATUS_GUIDE_LEAD))) return true;
  if (parsed.statusRows.some((r) => r.line === c.startLine)) return true;
  if (parsed.source.slice(parsed.lineStarts[c.startLine], c.start).trim() !== "") return false;
  const prev = previousContentLine(cleanLines, c.startLine);
  if (prev === -1) return false;
  return parsed.headings.some((h) => h.line === prev) || /<\/summary>\s*$/.test(cleanLines[prev]!);
}

export function stripDescription(text: string, opts: StripOptions = {}): string {
  const parsed = parseDescription(text);
  const cleanLines = parsed.clean.split("\n");
  const texts = opts.all ? new Set<string>() : guideTexts(opts.catalog ?? loadCatalog());

  const lineStart = (line: number) => parsed.lineStarts[line] ?? parsed.source.length;

  const drop = (c: DescriptionComment): boolean => {
    if (c.marker !== null) return false;
    if (opts.all) return true;
    if (STAMP.test(c.text)) return true;
    if (c.inBlock) return false;
    return isGuide(c, parsed, cleanLines, texts);
  };

  // Only what a removal touches changes: the comment itself, the spaces it leaves at the end of its
  // line, and the blank lines around it. Everything else is the author's text, byte for byte.
  let out = "";
  let at = 0;
  const marks: number[] = [];
  for (const c of parsed.comments) {
    if (!drop(c)) continue;
    let from = c.start;
    let to = c.end;
    if (c.wholeLine) {
      from = lineStart(c.startLine);
      to = c.endLine + 1 >= parsed.lines.length ? parsed.source.length : lineStart(c.endLine + 1);
    }
    if (from < at) continue;
    out += parsed.source.slice(at, from);
    if (!c.wholeLine && (to >= parsed.source.length || parsed.source[to] === "\n")) out = out.replace(/[ \t]+$/, "");
    marks.push(out.length);
    at = to;
  }
  out += parsed.source.slice(at);
  return collapseAround(out, marks);
}

const isBlank = (line: string) => line.trim() === "";

/**
 * Collapses each run of blank lines that touches a removal point (`marks` are offsets in `text`) to
 * one blank line, or to none at the start of the text; at the end it leaves just the final newline.
 */
function collapseAround(text: string, marks: number[]): string {
  if (marks.length === 0) return text;
  const lines = text.split("\n");
  const starts: number[] = [];
  {
    let offset = 0;
    for (const line of lines) {
      starts.push(offset);
      offset += line.length + 1;
    }
  }
  const touched = new Set<number>();
  for (const mark of marks) {
    let lo = 0;
    let hi = lines.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= mark) lo = mid;
      else hi = mid - 1;
    }
    touched.add(lo);
    touched.add(lo - 1);
  }
  const out: string[] = [];
  for (let i = 0; i < lines.length; ) {
    if (!isBlank(lines[i]!)) {
      out.push(lines[i]!);
      i += 1;
      continue;
    }
    let end = i;
    while (end + 1 < lines.length && isBlank(lines[end + 1]!)) end += 1;
    let hit = false;
    for (let k = i; k <= end; k++) if (touched.has(k)) hit = true;
    if (!hit) out.push(...lines.slice(i, end + 1));
    else if (end === lines.length - 1) out.push("");
    else if (i > 0) out.push("");
    i = end + 1;
  }
  return out.join("\n");
}
