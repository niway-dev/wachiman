/**
 * Render the effective template as the Markdown that is installed, stamp it, and tell the state of
 * a file on disk (ADR 0052). Rendering is deterministic: the same catalog and choice give the same
 * bytes, so the stamp hash can tell a file someone edited from one that is merely out of date. The
 * output is what Prettier and oxfmt print with their default options (padded tables, a blank line
 * after every heading), so a repository's formatter accepts it unchanged; and the hash covers a
 * normalized body, so a formatter that does rewrite the file is not taken for a hand edit.
 */
import { createHash } from "node:crypto";
import { PrTemplateConfigError, loadRepoChoice, type Catalog, type CatalogEntry, type StatusRowEntry } from "./catalog";
import { resolveTemplate, type ResolvedTemplate } from "./resolve";

const STAMP_PREFIX = "wachiman:pr-template";
const STAMP = /^<!-- wachiman:pr-template version=(\d+) sha256=([0-9a-f]{64}) -->(?:\n|$)/;
const WRAP = 92;

export const sha256Hex = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * The body as a Markdown formatter leaves it equal: what the stamp hash covers. Formatters (Prettier,
 * oxfmt) rewrite the padding of table cells, the width of separator rows, blank lines and trailing
 * spaces, and an editor may change the line endings; none of that is an edit. Everything else, a word
 * in a comment or a value in a cell included, still changes the result.
 *
 * - CRLF and CR become LF, trailing spaces and tabs go from every line;
 * - a table row (a line starting with `|`, outside a fenced code block and outside a comment) has its
 *   runs of spaces collapsed to one, except inside an HTML comment on the row, and a separator row
 *   (`| :--- | ---: |`) becomes `|---|---|`, so dash counts and alignment colons are ignored;
 * - runs of blank lines become one, and leading and trailing blank lines go.
 *
 * Leading whitespace is kept on every line: a formatter never changes it in the generated template,
 * and indenting a table by four spaces turns it into a code block.
 *
 * Spaces in any other text, and inside comments that start on their own line, are kept.
 */
export function normalizeForStamp(body: string): string {
  const out: string[] = [];
  let inComment = false;
  let fence: string | null = null;
  for (const raw of body.replace(/\r\n?/g, "\n").split("\n")) {
    let line = raw.replace(/[ \t]+$/, "");
    const startsInComment = inComment;
    inComment = openCommentAfter(line, inComment);
    if (!startsInComment) {
      const trimmed = line.trimStart();
      const mark = /^(`{3,}|~{3,})/.exec(trimmed);
      if (fence !== null) {
        if (mark !== null && mark[1]!.startsWith(fence[0]!) && mark[1]!.length >= fence.length) fence = null;
      } else if (mark !== null) {
        fence = mark[1]!;
      } else if (trimmed.startsWith("|")) {
        // The indentation stays: four spaces make Markdown render the row as code, not a table.
        const indent = line.slice(0, line.length - trimmed.length);
        line = indent + (TABLE_SEPARATOR.test(trimmed) ? separatorRow(trimmed) : collapseOutsideComments(trimmed));
      }
    }
    if (line === "" && (out.length === 0 || out[out.length - 1] === "")) continue;
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.length === 0 ? "" : `${out.join("\n")}\n`;
}

const TABLE_SEPARATOR = /^\|(\s*:?-+:?\s*\|)+$/;
const separatorRow = (row: string) => `|${"---|".repeat(row.split("|").length - 2)}`;

/** Whether a comment is still open after `line`, given that one was open before it. */
function openCommentAfter(line: string, open: boolean): boolean {
  let at = 0;
  for (;;) {
    if (open) {
      const end = line.indexOf("-->", at);
      if (end === -1) return true;
      at = end + 3;
      open = false;
    } else {
      const start = line.indexOf("<!--", at);
      if (start === -1) return false;
      at = start + 4;
      open = true;
    }
  }
}

/** Runs of spaces become one, except inside a complete `<!-- ... -->` on the row. */
function collapseOutsideComments(row: string): string {
  return row
    .split(/(<!--[\s\S]*?(?:-->|$))/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/ {2,}/g, " ")))
    .join("");
}

/** The hash the stamp records: the normalized form of everything below the stamp line. */
export const stampHashOf = (body: string) => sha256Hex(normalizeForStamp(body));

export interface Stamp {
  version: number;
  sha256: string;
  /** Everything below the stamp line. */
  body: string;
}

/** The stamp on the first line of `fileText`, or null when the file has none. */
export function parseStamp(fileText: string): Stamp | null {
  const m = STAMP.exec(fileText);
  if (!m) return null;
  return { version: Number(m[1]), sha256: m[2]!, body: fileText.slice(m[0].length) };
}

const BREAKING = /BREAKING[ -]CHANGE/i;
const BANG_TITLE = /\b[a-z]+(\([^)\n]*\))?!:/i;

/** A squash merge copies the description into the commit body, and the release tool reads these as a major. */
function refuseBreakingMarker(text: string) {
  const hit = BREAKING.exec(text) ?? BANG_TITLE.exec(text);
  if (hit) {
    throw new PrTemplateConfigError(
      `the template would contain the breaking-change marker ("${hit[0]}"); a squash merge copies it into the commit and cuts a major release. Reword the guide comment, custom entry or preamble line.`,
    );
  }
}

/**
 * Lines of `text` wrapped at `WRAP` columns: the first line starts with `first`, the others with `rest`.
 * Words are never split, so a long word makes a long line.
 */
function wrapped(text: string, first: string, rest: string): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/)) {
    if (line !== "" && line.length + 1 + word.length > WRAP) {
      lines.push(line);
      line = word;
    } else {
      line = line === "" ? word : `${line} ${word}`;
    }
  }
  lines.push(line);
  return lines.map((l, i) => `${i === 0 ? first : rest}${l}`);
}

/** A guide comment as `<!-- text -->`, wrapped over several lines when it is long. */
function comment(text: string): string[] {
  const lines = wrapped(text, "<!-- ", "     ");
  lines[lines.length - 1] += " -->";
  return lines;
}

/** The comment that starts with this text, above the status table, is the guidance of its rows; `strip` removes it. */
export const STATUS_GUIDE_LEAD = "Status table guide, one line per row.";

/** One comment above the status table with the guidance of every row that has any, by label. */
function statusGuide(rows: StatusRowEntry[]): string[] {
  const guided = rows.filter((r) => r.guide !== undefined && r.guide.trim() !== "");
  if (guided.length === 0) return [];
  const lines = [`<!-- ${STATUS_GUIDE_LEAD}`, ...guided.flatMap((r) => wrapped(`${r.label}: ${r.guide!.trim()}`, "     ", "       "))];
  lines[lines.length - 1] += " -->";
  return lines;
}

/**
 * How many columns `text` takes where it is printed: what Prettier and oxfmt use to pad a table cell.
 * An emoji and a wide (East Asian) character count 2; combining marks, joiners and variation
 * selectors count 0; control characters are ignored.
 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text.replace(/\p{RGI_Emoji}/gv, "  ")) {
    const c = ch.codePointAt(0)!;
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0x200b || c === 0x200d || (c >= 0xfe00 && c <= 0xfe0f) || /^\p{M}$/u.test(ch)) continue;
    width += WIDE.some(([from, to]) => c >= from && c <= to) ? 2 : 1;
  }
  return width;
}

const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x23e9, 0x23ec], [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f],
  [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26d4, 0x26d4], [0x26ea, 0x26ea],
  [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728],
  [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797], [0x27b0, 0x27b0], [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff],
  [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f], [0x1f680, 0x1f6ff], [0x1f900, 0x1f9ff], [0x20000, 0x3fffd],
];

/**
 * A table as Prettier prints it with its default options: every column as wide as its widest cell
 * (at least three, the width of the shortest separator), cells padded on the right, and the
 * separator row made of dashes the width of the column. The header may be all empty cells.
 */
export function formatTable(header: string[], rows: string[][]): string[] {
  const widths = header.map((h, c) => Math.max(3, displayWidth(h), ...rows.map((r) => displayWidth(r[c] ?? ""))));
  const pad = (cell: string, c: number) => cell + " ".repeat(widths[c]! - displayWidth(cell));
  const line = (cells: string[]) => `| ${cells.map((cell, c) => pad(cell, c)).join(" | ")} |`;
  return [line(header), `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`, ...rows.map((r) => line(header.map((_, c) => r[c] ?? "")))];
}

const SEPARATOR_ROW = /^\|(\s*:?-+:?\s*\|)+\s*$/;
const cellsOf = (row: string) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

/** A body from the catalog: a run of lines starting with `|` is a table, which is printed padded; any other line is kept. */
function bodyLines(body: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < body.length; i++) {
    if (!body[i]!.trimStart().startsWith("|")) {
      out.push(body[i]!);
      continue;
    }
    let j = i;
    while (j < body.length && body[j]!.trimStart().startsWith("|")) j++;
    const [header, ...rest] = body.slice(i, j);
    out.push(...formatTable(cellsOf(header!), rest.filter((r) => !SEPARATOR_ROW.test(r.trim())).map(cellsOf)));
    i = j - 1;
  }
  return out;
}

/** A block's parts, joined by one blank line: Markdown formatters require one after a heading, a comment and a table. */
const joinParts = (...parts: string[][]) => parts.filter((p) => p.length > 0).flatMap((p, i) => (i === 0 ? p : ["", ...p]));

/** The status table: the guidance comment, then a table with an empty header, a label column and an empty value column. */
const statusTable = (rows: StatusRowEntry[]) => joinParts(statusGuide(rows), formatTable(["", ""], rows.map((r) => [`**${r.label}**`, ""])));

function entryLines(e: CatalogEntry): string[] {
  const guide = e.guide === undefined ? [] : comment(e.guide);
  switch (e.kind) {
    case "section":
      return joinParts([`## ${e.heading}`], guide, bodyLines(e.body));
    case "details":
      return joinParts([`<details><summary><b>${e.summary}</b>${e.summarySuffix}</summary>`], guide, bodyLines(e.body), ["</details>"]);
    case "block":
      return [e.start, e.end];
    case "footer":
      return [`<sub>${e.text}</sub>`];
    case "status-row":
      return [];
  }
}

/** The file body: everything below the stamp line. Refuses a marker that would cut a major release. */
function renderBody(resolved: ResolvedTemplate): string {
  const blocks: string[][] = [];
  if (resolved.intro.trim() !== "") blocks.push(comment(resolved.intro));
  if (resolved.preamble.length > 0) blocks.push(resolved.preamble.flatMap((l) => l.split("\n")));
  const rows = resolved.sections.filter((e): e is StatusRowEntry => e.kind === "status-row");
  if (rows.length > 0) blocks.push(statusTable(rows));
  for (const e of resolved.sections) if (e.kind !== "status-row") blocks.push(entryLines(e));
  const body = `${blocks.map((b) => b.join("\n")).join("\n\n")}\n`;
  refuseBreakingMarker(body);
  return body;
}

/** The exact Markdown of the installed file, stamp included. */
export function renderTemplate(resolved: ResolvedTemplate, catalogVersion: number): string {
  const body = renderBody(resolved);
  return `<!-- ${STAMP_PREFIX} version=${catalogVersion} sha256=${stampHashOf(body)} -->\n${body}`;
}

export type TemplateStateName = "missing" | "unmanaged" | "current" | "outdated" | "edited-by-hand" | "invalid";
export interface TemplateState {
  state: TemplateStateName;
  /** The catalog version this Wachiman generates. */
  version: number;
  /** The version in the file's stamp, or null when there is none. */
  installedVersion: number | null;
  /** For `invalid`: what is wrong with the definition. */
  problem?: string;
}

export interface TemplateStateInput {
  catalog: Catalog;
  /** The installed `.github/pull_request_template.md`, or null when there is none. */
  fileText: string | null;
  /** The text of `.github/pr-template.json`, or null when the repository has none. */
  choiceText: string | null;
}

/**
 * Where the installed file stands. "Outdated" compares with what the repository's own JSON asks
 * for, never with the default, so a custom template is not outdated for being custom.
 */
export function templateState({ catalog, fileText, choiceText }: TemplateStateInput): TemplateState {
  const version = catalog.version;
  const file = fileText === null ? null : fileText.replace(/\r\n/g, "\n");
  const stamp = file === null ? null : parseStamp(file);
  const installedVersion = stamp?.version ?? null;
  let expected: string;
  try {
    const choice = choiceText === null ? null : loadRepoChoice(choiceText, catalog);
    expected = renderTemplate(resolveTemplate(catalog, choice), catalog.version);
  } catch (err) {
    if (err instanceof PrTemplateConfigError) return { state: "invalid", version, installedVersion, problem: err.message };
    throw err;
  }
  if (file === null) return { state: "missing", version, installedVersion };
  if (stamp === null) return { state: "unmanaged", version, installedVersion };
  if (stampHashOf(stamp.body) !== stamp.sha256) return { state: "edited-by-hand", version, installedVersion };
  // Both sides are compared as a formatter leaves them equal, so a file a repository formatter rewrote is still current.
  const want = parseStamp(expected)!;
  const same = stamp.version === want.version && normalizeForStamp(stamp.body) === normalizeForStamp(want.body);
  return { state: same ? "current" : "outdated", version, installedVersion };
}
