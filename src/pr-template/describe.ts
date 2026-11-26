/**
 * Reads a PR description into its parts: the status table rows, the `##` sections, the `<details>`
 * blocks, the Wachiman block, the `<sub>` footer and every HTML comment. Pure string work, no
 * template knowledge: `check` judges these parts against a template and `format` moves them.
 *
 * Positions are kept so nothing is lost on the way back out. Lines are 0-based and every range is
 * `[startLine, endLine)` unless a field says it is inclusive. `lines` is the text split on `\n`
 * (so a trailing newline leaves an empty last element) and `lines.join(eol)` is the input again.
 * `clean` and `structural` are the same length as the source: a comment becomes spaces and a
 * newline stays a newline, so an offset or line number in one is valid in the others.
 */
import { BLOCK_END, BLOCK_START } from "../fidelity/digest";

export interface DescriptionComment {
  /** The comment as written, `<!-- ... -->`. */
  raw: string;
  /** What is inside, trimmed. */
  text: string;
  /** Offsets in `source`: `start` is the `<`, `end` is just past the `>`. */
  start: number;
  end: number;
  /** First and last line the comment touches (both inclusive). */
  startLine: number;
  endLine: number;
  /** Nothing but blanks shares its first or last line with it. */
  wholeLine: boolean;
  /** Set for the two Wachiman block markers. */
  marker: "start" | "end" | null;
  /** Between the markers of a whole Wachiman block, markers excluded. */
  inBlock: boolean;
}

export interface DescriptionHeading {
  /** The heading text, without the `##` and any closing hashes. */
  name: string;
  line: number;
  raw: string;
}

export interface DescriptionStatusRow {
  label: string;
  /** The cell after the label, comments removed, trimmed. */
  value: string;
  line: number;
  raw: string;
}

export interface DescriptionSection {
  name: string;
  /** The line of its `##` heading. */
  startLine: number;
  /** Where the next `##` heading starts (or the end of the text): the span the earlier checker read. */
  endLine: number;
  /** Where the section's own text stops: the first `<details>`, Wachiman block or footer inside the span. */
  bodyEndLine: number;
  /** The span under the heading, comments removed and the Wachiman block blanked. */
  clean: string;
  /** The span under the heading as written. */
  raw: string;
}

export interface DescriptionDetails {
  /** The text of the bold title in the summary, or null when the summary has none. */
  name: string | null;
  /** Everything between `<summary>` and `</summary>`, comments removed. */
  summary: string;
  /** The line of `<details>` and the line of `</details>` (inclusive). */
  startLine: number;
  endLine: number;
  /** What follows `</summary>`, comments removed. */
  clean: string;
  raw: string;
}

export interface DescriptionSub {
  /** The text between `<sub>` and `</sub>`. */
  text: string;
  startLine: number;
  endLine: number;
}

export interface DescriptionBlock {
  /** Offsets of the start marker's `<` and just past the end marker's `>`. */
  start: number;
  end: number;
  startLine: number;
  /** The line of the end marker (inclusive). */
  endLine: number;
  raw: string;
}

export type SegmentKind = "preface" | "section" | "details" | "wachiman" | "footer" | "text";
export interface DescriptionSegment {
  kind: SegmentKind;
  startLine: number;
  /** Exclusive. */
  endLine: number;
}

export interface ParsedDescription {
  /** The input with `\r\n` and `\r` turned into `\n`; every offset refers to it. */
  source: string;
  /** The line ending to put back when the text is written out again. */
  eol: "\n" | "\r\n";
  lines: string[];
  /** The offset in `source` where each line starts. */
  lineStarts: number[];
  /** `source` with comments blanked. */
  clean: string;
  /** `clean` with the inside of every Wachiman block blanked too: what the template rules read. */
  structural: string;
  comments: DescriptionComment[];
  /** Whole blocks only; a marker with no partner is just a comment. */
  blocks: DescriptionBlock[];
  /** Every `##` heading outside fenced code and outside the Wachiman block. */
  headings: DescriptionHeading[];
  /** The lines before the first `##` heading: where the status table lives. */
  headerEndLine: number;
  /** Every table row of the form `| **Label** | value |` before the first heading, in order. */
  statusRows: DescriptionStatusRow[];
  sections: DescriptionSection[];
  details: DescriptionDetails[];
  subs: DescriptionSub[];
  /** The lines split into runs, in order, each line in exactly one: the preface, sections, details blocks, the Wachiman block, footers and loose text. */
  segments: DescriptionSegment[];
}

const COMMENT = /<!--[\s\S]*?-->/g;
const HEADING = /^ {0,3}##(?!#)\s+(.*?)\s*$/;
const STATUS_ROW = /^\s*\|\s*\*\*([^*|]+?)\*\*\s*\|(.*?)\|?\s*$/;
/** The opening tag may carry attributes (`<details open>`); the summary rules are unchanged. */
const DETAILS = /<details(?:\s[^>]*)?>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/dg;
const SUB = /<sub>([\s\S]*?)<\/sub>/g;
const FENCE_OPEN = /^(```+|~~~+)/;

const markerName = (marker: string) => /^<!--\s*(.*?)\s*-->$/.exec(marker)![1]!;
const START_TEXT = markerName(BLOCK_START);
const END_TEXT = markerName(BLOCK_END);

/** Blank a set of spans: every character but a newline becomes a space. */
function blank(text: string, spans: { start: number; end: number }[]): string {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let out = "";
  let at = 0;
  for (const s of sorted) {
    if (s.end <= at) continue;
    const from = Math.max(s.start, at);
    out += text.slice(at, from) + text.slice(from, s.end).replace(/[^\n]/g, " ");
    at = s.end;
  }
  return out + text.slice(at);
}

export function parseDescription(input: string): ParsedDescription {
  const eol = input.includes("\r\n") ? "\r\n" : "\n";
  const source = input.replace(/\r\n?/g, "\n");
  const lines = source.split("\n");
  const lineStarts: number[] = [];
  {
    let at = 0;
    for (const line of lines) {
      lineStarts.push(at);
      at += line.length + 1;
    }
  }
  const lineOf = (offset: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  /** Lines of a span that ends just past `end`. */
  const lastLineOf = (end: number) => lineOf(Math.max(end - 1, 0));

  // comments
  const comments: DescriptionComment[] = [];
  for (const m of source.matchAll(COMMENT)) {
    const start = m.index!;
    const end = start + m[0].length;
    const startLine = lineOf(start);
    const endLine = lastLineOf(end);
    const before = source.slice(lineStarts[startLine], start);
    const after = source.slice(end, lineStarts[endLine]! + lines[endLine]!.length);
    const text = m[0].slice(4, -3).trim();
    comments.push({
      raw: m[0],
      text,
      start,
      end,
      startLine,
      endLine,
      wholeLine: before.trim() === "" && after.trim() === "",
      marker: text === START_TEXT ? "start" : text === END_TEXT ? "end" : null,
      inBlock: false,
    });
  }

  // Wachiman blocks: an end marker and the nearest start marker before it
  const blocks: DescriptionBlock[] = [];
  {
    let open: DescriptionComment | null = null;
    for (const c of comments) {
      if (c.marker === "start") open = c;
      else if (c.marker === "end" && open) {
        blocks.push({
          start: open.start,
          end: c.end,
          startLine: open.startLine,
          endLine: c.endLine,
          raw: source.slice(open.start, c.end),
        });
        open = null;
      }
    }
  }
  for (const c of comments) {
    if (c.marker === null && blocks.some((b) => c.start > b.start && c.end < b.end)) c.inBlock = true;
  }

  const clean = blank(source, comments);
  const structural = blank(source, [...comments, ...blocks]);
  const structuralLines = structural.split("\n");

  // Fenced code is never structure: a heading, `<details>` or `<sub>` written inside a fence is text.
  const fenced: boolean[] = [];
  {
    let fence: { ch: string; len: number } | null = null;
    structuralLines.forEach((line, i) => {
      const s = line.trim();
      if (fence !== null) {
        fenced[i] = true;
        // CommonMark: a fence closes on the same character, at least as many times as the opener, nothing else on the line.
        if (s[0] === fence.ch && s.length >= fence.len && s === fence.ch.repeat(s.length)) fence = null;
        return;
      }
      const open = FENCE_OPEN.exec(s);
      if (open) {
        fence = { ch: open[1]![0]!, len: open[1]!.length };
        fenced[i] = true;
        return;
      }
      fenced[i] = false;
    });
  }
  /** `structural` with the fenced lines blanked: what `<details>` and `<sub>` are looked for in. Same length, same offsets. */
  const outsideFences = structuralLines.map((line, i) => (fenced[i] ? line.replace(/[^\n]/g, " ") : line)).join("\n");

  const details: DescriptionDetails[] = [];
  for (const m of outsideFences.matchAll(DETAILS)) {
    const start = m.index!;
    const end = start + m[0].length;
    const [sumFrom, sumTo] = m.indices![1]!;
    const [bodyFrom, bodyTo] = m.indices![2]!;
    const summary = structural.slice(sumFrom, sumTo);
    const bold = /^\s*<b>([\s\S]*?)<\/b>/.exec(summary);
    details.push({
      name: bold ? bold[1]!.trim() : null,
      summary,
      startLine: lineOf(start),
      endLine: lastLineOf(end),
      clean: structural.slice(bodyFrom, bodyTo),
      raw: source.slice(start, end),
    });
  }

  // headings outside fenced code and outside every details block: a heading inside a block is the block's text
  const headings: DescriptionHeading[] = [];
  structuralLines.forEach((line, i) => {
    if (fenced[i] || details.some((d) => i > d.startLine && i <= d.endLine)) return;
    const h = HEADING.exec(line);
    if (h) headings.push({ name: h[1]!.replace(/(?:^|\s+)#+$/, "").trim(), line: i, raw: lines[i]! });
  });
  const headerEndLine = headings[0]?.line ?? lines.length;

  const statusRows: DescriptionStatusRow[] = [];
  for (let i = 0; i < headerEndLine; i++) {
    if (fenced[i]) continue; // a row inside fenced code is text, not a row
    const m = STATUS_ROW.exec(structuralLines[i]!);
    if (m) statusRows.push({ label: m[1]!.trim(), value: m[2]!.trim(), line: i, raw: lines[i]! });
  }

  const subs: DescriptionSub[] = [];
  for (const m of outsideFences.matchAll(SUB)) {
    const start = m.index!;
    subs.push({ text: m[1]!, startLine: lineOf(start), endLine: lastLineOf(start + m[0].length) });
  }

  // Sections: the span to the next heading, plus where their own text stops
  const sections: DescriptionSection[] = headings.map((h, n) => {
    const endLine = headings[n + 1]?.line ?? lines.length;
    const inner = [
      ...details.filter((d) => d.startLine > h.line && d.startLine < endLine).map((d) => d.startLine),
      ...blocks.filter((b) => b.startLine > h.line && b.startLine < endLine).map((b) => b.startLine),
      ...subs.filter((s) => s.startLine > h.line && s.startLine < endLine).map((s) => s.startLine),
    ];
    return {
      name: h.name,
      startLine: h.line,
      endLine,
      bodyEndLine: Math.min(endLine, ...inner),
      clean: structuralLines.slice(h.line + 1, endLine).join("\n"),
      raw: lines.slice(h.line + 1, endLine).join("\n"),
    };
  });

  const segments = buildSegments(lines.length, headings, details, blocks, subs);

  return {
    source,
    eol,
    lines,
    lineStarts,
    clean,
    structural,
    comments,
    blocks,
    headings,
    headerEndLine,
    statusRows,
    sections,
    details,
    subs,
    segments,
  };
}

/** Walk the lines once: details, blocks and footers are whole runs; a heading starts a section; the rest is text. */
function buildSegments(
  total: number,
  headings: DescriptionHeading[],
  details: DescriptionDetails[],
  blocks: DescriptionBlock[],
  subs: DescriptionSub[],
): DescriptionSegment[] {
  interface Event {
    line: number;
    endLine: number;
    kind: SegmentKind;
  }
  const atoms: Event[] = [
    ...details.map((d) => ({ line: d.startLine, endLine: d.endLine + 1, kind: "details" as const })),
    ...blocks.map((b) => ({ line: b.startLine, endLine: b.endLine + 1, kind: "wachiman" as const })),
    ...subs.map((s) => ({ line: s.startLine, endLine: s.endLine + 1, kind: "footer" as const })),
  ].sort((a, b) => a.line - b.line || b.endLine - a.endLine);
  const events: Event[] = [...atoms, ...headings.map((h) => ({ line: h.line, endLine: h.line, kind: "section" as const }))].sort(
    (a, b) => a.line - b.line || (a.kind === "section" ? 1 : 0) - (b.kind === "section" ? 1 : 0),
  );

  const out: DescriptionSegment[] = [];
  let current: { kind: SegmentKind; start: number } = { kind: "preface", start: 0 };
  let cursor = 0;
  const close = (at: number) => {
    if (at > current.start) out.push({ kind: current.kind, startLine: current.start, endLine: at });
  };
  for (const ev of events) {
    if (ev.line < cursor) continue;
    close(ev.line);
    if (ev.kind === "section") {
      current = { kind: "section", start: ev.line };
      cursor = ev.line + 1;
    } else {
      out.push({ kind: ev.kind, startLine: ev.line, endLine: Math.min(ev.endLine, total) });
      cursor = ev.endLine;
      current = { kind: "text", start: Math.min(ev.endLine, total) };
    }
  }
  close(total);
  return out;
}

/** The first row of the status table with this label, or undefined. */
export function statusRow(parsed: ParsedDescription, label: string): DescriptionStatusRow | undefined {
  return parsed.statusRows.find((r) => r.label === label);
}

/** The first section with this heading, or undefined. */
export function sectionNamed(parsed: ParsedDescription, name: string): DescriptionSection | undefined {
  return parsed.sections.find((s) => s.name === name);
}

/** The lines `[from, to)` as written, joined with the description's own line ending. */
export function linesText(parsed: ParsedDescription, from: number, to: number): string {
  return parsed.lines.slice(from, to).join(parsed.eol);
}
