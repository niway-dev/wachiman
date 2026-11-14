/**
 * The description without its guide comments and without the stamp line: what an agent posts
 * after filling the installed template. The Wachiman block markers, and anything inside the
 * block (the digest comment among it), stay, and so does every comment that is the repository's
 * own (a CLA reminder at the top, a note in a custom section).
 *
 * A comment is a guide comment when its text is one of the catalog's guides or intro, when it sits
 * in a status row's value cell, or when it directly follows a `##` heading or a `<summary>` line,
 * which is where every guide is written. Any other comment is the repository's. `all: true` is
 * the earlier checker's behaviour: every comment goes except the two block markers.
 */
import { loadCatalog, type Catalog } from "./catalog";
import { parseDescription, type DescriptionComment, type ParsedDescription } from "./describe";

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

  let out = "";
  let at = 0;
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
    at = to;
  }
  out += parsed.source.slice(at);

  out = out.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n");
  return `${out.replace(/^\n+|\n+$/g, "")}\n`;
}
