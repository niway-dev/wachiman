/**
 * `wachiman pr-template format`: print a description in the template's order. Status rows, `##`
 * sections and `<details>` blocks follow the template, missing required ones are added empty, the
 * Wachiman block and the footer go last. It never deletes or rewrites text it does not
 * recognise: every non-empty line of the input is in the output, and a description that is already
 * in order comes back byte for byte.
 *
 * The description is cut into units with `parseDescription`'s segments: the preface (everything
 * before the first structural element, which holds the status table), then one unit per `##`
 * section, `<details>` block, Wachiman block and footer. Loose text that follows a unit stays with
 * it. Units are only reordered, never opened, with these exceptions:
 *
 * - Status rows are reordered inside the table, and a missing required row is added with an empty
 *   value.
 * - An unknown `##` section goes into the Notes block, under what Notes already says. Its heading
 *   keeps its line but is indented four spaces, because a `##` inside Notes would still be an
 *   unknown heading for `check`. When the template has no Notes block, or the Notes block cannot
 *   take text without rewriting its closing line, the section stays as it is, after the known ones.
 * - An unknown `<details>` block stays whole, after the known ones: `<details>` does not nest in
 *   what `describe.ts` reads, and moving it in would mean rewriting its summary line.
 */
import { randomBytes } from "node:crypto";
import { chmodSync, lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { UsageError } from "../config";
import { parseFlags } from "../flags";
import { CHOICE_FILE, loadCatalog, loadRepoChoice, type Catalog, type CatalogEntry, type DetailsEntry, type FooterEntry, type SectionEntry, type StatusRowEntry } from "./catalog";
import { withLockedFromCatalog } from "./check";
import type { PrTemplateDeps, PrTemplateIo } from "./check-run";
import { parseDescription, type ParsedDescription } from "./describe";
import { ToolError } from "./gh";
import { resolveTemplate, type ResolvedTemplate } from "./resolve";

export const formatUsage = "wachiman pr-template format [<file>] [--write]";

export interface FormatOptions {
  /** A description on disk. Without one, the description is read from standard input. */
  file?: string;
  /** Rewrite the file instead of printing (needs a file). */
  write: boolean;
}

export interface FormatDeps extends PrTemplateDeps {
  /** Standard input as text. Default: reads file descriptor 0 synchronously. */
  stdin?: () => string;
}

/** `argv` is what follows `format`. */
export function parseFormatArgs(argv: string[]): FormatOptions | { help: true } {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  const { positionals, booleans } = parseFlags(argv, { values: [], booleans: ["--write"] }, "pr-template format");
  if (positionals.length > 1) throw new UsageError(`format takes one file, got "${positionals.join('", "')}".`);
  const file = positionals[0];
  const write = booleans["--write"] === true;
  if (write && file === undefined) throw new UsageError("--write needs a file to rewrite.");
  return { ...(file !== undefined ? { file } : {}), write };
}

// --------------------------------------------------------------------------- the pure part

type UnitKind = "preface" | "section" | "details" | "wachiman" | "footer";

interface Unit {
  kind: UnitKind;
  /** `[start, end)`, in lines of the description. */
  start: number;
  end: number;
  /** The heading of a section, the bold title of a details block, otherwise null. */
  name: string | null;
  /** For a details block: the line of its `</details>`. */
  closeLine?: number;
}

/** A piece of the output: the lines, and which unit it came from (none for a piece formatting adds). */
interface Item {
  lines: string[];
  original?: number;
  modified?: boolean;
}

const isRequired = (e: CatalogEntry) => e.required || e.locked;
const trimEnd = (lines: string[]) => {
  let n = lines.length;
  while (n > 0 && lines[n - 1]!.trim() === "") n -= 1;
  return lines.slice(0, n);
};

function footerMatcher(template: ResolvedTemplate): (text: string) => boolean {
  const entry = template.sections.find((e): e is FooterEntry => e.kind === "footer");
  const at = entry === undefined ? -1 : entry.text.indexOf("{sha}");
  const prefix = (entry === undefined ? "" : at === -1 ? entry.text : entry.text.slice(0, at)).trim() || "Describes commit";
  const words = prefix.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  const re = new RegExp(`^\\s*${words}`);
  return (text) => re.test(text);
}

/** Cut the lines into units. A `<sub>` that is not the template's footer, and loose text, stay with the unit before them. */
function unitsOf(parsed: ParsedDescription, isFooter: (text: string) => boolean): Unit[] {
  const units: Unit[] = [];
  const glue = (start: number, end: number) => {
    const last = units[units.length - 1];
    if (last) last.end = end;
    else units.push({ kind: "preface", start, end, name: null });
  };
  for (const seg of parsed.segments) {
    switch (seg.kind) {
      case "preface":
        units.push({ kind: "preface", start: seg.startLine, end: seg.endLine, name: null });
        break;
      case "section": {
        const h = parsed.headings.find((x) => x.line === seg.startLine);
        units.push({ kind: "section", start: seg.startLine, end: seg.endLine, name: h?.name ?? null });
        break;
      }
      case "details": {
        const d = parsed.details.find((x) => x.startLine === seg.startLine);
        units.push({ kind: "details", start: seg.startLine, end: seg.endLine, name: d?.name ?? null, ...(d ? { closeLine: d.endLine } : {}) });
        break;
      }
      case "wachiman":
        units.push({ kind: "wachiman", start: seg.startLine, end: seg.endLine, name: null });
        break;
      case "footer": {
        const sub = parsed.subs.find((x) => x.startLine === seg.startLine);
        if (sub !== undefined && isFooter(sub.text)) units.push({ kind: "footer", start: seg.startLine, end: seg.endLine, name: null });
        else glue(seg.startLine, seg.endLine);
        break;
      }
      case "text":
        glue(seg.startLine, seg.endLine);
        break;
    }
  }
  return units;
}

const SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*\|\s*:?-{3,}:?\s*\|?\s*$/;

/**
 * The preface with its status rows in template order and the missing required rows added. A row the
 * template does not know stays right after the row that came before it. Rows only trade places in
 * the lines they already occupy; added rows go right after the last of them (or the table's
 * separator line, or in a new table at the end of the preface).
 */
function arrangeRows(lines: string[], first: number, rows: ParsedDescription["statusRows"], entries: StatusRowEntry[], parsed: ParsedDescription): string[] {
  const order = new Map<string, number>();
  entries.forEach((e, i) => {
    if (!order.has(e.label)) order.set(e.label, i);
  });
  const present = new Set(parsed.statusRows.map((r) => r.label));
  const missing = entries.filter((e) => isRequired(e) && !present.has(e.label));
  if (rows.length === 0 && missing.length === 0) return lines;

  let previous = -1;
  const items = rows.map((r, seq) => {
    const known = order.get(r.label);
    if (known !== undefined) previous = known;
    return { text: lines[r.line - first]!, key: known ?? previous + 0.5, seq };
  });
  missing.forEach((e, n) => items.push({ text: `| **${e.label}** | |`, key: order.get(e.label)!, seq: rows.length + n }));
  items.sort((a, b) => a.key - b.key || a.seq - b.seq);

  const slots = rows.map((r) => r.line - first);
  const out = [...lines];
  if (slots.length > 0) {
    slots.forEach((slot, i) => {
      out[slot] = items[i]!.text;
    });
    out.splice(slots[slots.length - 1]! + 1, 0, ...items.slice(slots.length).map((i) => i.text));
    return out;
  }
  const sep = lines.findIndex((l, i) => i > 0 && SEPARATOR.test(l) && lines[i - 1]!.includes("|"));
  if (sep !== -1) {
    out.splice(sep + 1, 0, ...items.map((i) => i.text));
    return out;
  }
  const base = trimEnd(lines);
  return [...base, ...(base.length > 0 ? [""] : []), "| | |", "|---|---|", ...items.map((i) => i.text)];
}

function lineCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (line !== "") counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return counts;
}

/** The description in the template's order; see the top of the file for what moves and what never does. */
export function formatDescription(text: string, template: ResolvedTemplate): string {
  const parsed = parseDescription(text);
  const units = unitsOf(parsed, footerMatcher(template));
  const slice = (u: Unit) => parsed.lines.slice(u.start, u.end);
  const unitItem = (u: Unit): Item => ({ lines: slice(u), original: units.indexOf(u) });

  const statusEntries = template.sections.filter((e): e is StatusRowEntry => e.kind === "status-row");
  const bodyEntries = template.sections.filter((e): e is SectionEntry | DetailsEntry => e.kind === "section" || e.kind === "details");
  const keyOf = (kind: "section" | "details", name: string) => `${kind}:${name}`;
  const slot = new Map<string, number>();
  bodyEntries.forEach((e, i) => {
    const key = e.kind === "section" ? keyOf("section", e.heading) : keyOf("details", e.summary);
    if (!slot.has(key)) slot.set(key, i);
  });

  const perEntry: Unit[][] = bodyEntries.map(() => []);
  const unknown: Unit[] = [];
  for (const u of units) {
    if (u.kind !== "section" && u.kind !== "details") continue;
    const at = u.name === null ? undefined : slot.get(keyOf(u.kind, u.name));
    if (at === undefined) unknown.push(u);
    else perEntry[at]!.push(u);
  }

  // unknown sections go into Notes when it can take them
  const notesAt = bodyEntries.findIndex((e) => e.kind === "details" && e.id === "notes");
  let moved: Unit[] = [];
  if (notesAt !== -1) {
    const existing = perEntry[notesAt]![0];
    const closes = existing === undefined || parsed.lines[existing.closeLine ?? -1]?.trim() === "</details>";
    if (closes) moved = unknown.filter((u) => u.kind === "section");
  }
  const floaters = unknown.filter((u) => !moved.includes(u));
  const movedLines: string[] = [];
  for (const u of moved) {
    const ls = trimEnd(slice(u));
    if (movedLines.length > 0) movedLines.push("");
    movedLines.push(`    ${ls[0]!.trimStart()}`);
    if (ls.length > 1 && ls[1]!.trim() !== "") movedLines.push("");
    movedLines.push(...ls.slice(1));
  }

  const seq: Item[] = [];

  // the preface and the status table
  const preface = units[0]?.kind === "preface" ? units[0] : undefined;
  if (preface) {
    const rows = parsed.statusRows.filter((r) => r.line >= preface.start && r.line < preface.end);
    const before = slice(preface);
    const after = arrangeRows(before, preface.start, rows, statusEntries, parsed);
    const changed = after.length !== before.length || after.some((l, i) => l !== before[i]);
    seq.push({ lines: after, original: 0, modified: changed });
  } else {
    const made = arrangeRows([], 0, [], statusEntries, parsed);
    if (made.length > 0) seq.push({ lines: made });
  }

  // the template's sections and details blocks, in its order
  bodyEntries.forEach((entry, i) => {
    const mine = perEntry[i]!;
    if (mine.length === 0) {
      if (i === notesAt && moved.length > 0) {
        seq.push({ lines: [`<details><summary><b>${(entry as DetailsEntry).summary}</b></summary>`, "", ...movedLines, "", "</details>"] });
      } else if (isRequired(entry)) {
        seq.push({
          lines: entry.kind === "section" ? [`## ${entry.heading}`] : [`<details><summary><b>${entry.summary}</b></summary>`, "", "</details>"],
        });
      }
      return;
    }
    mine.forEach((u, n) => {
      const item = unitItem(u);
      if (i === notesAt && n === 0 && moved.length > 0) {
        const close = u.closeLine! - u.start;
        const head = item.lines.slice(0, close);
        const tail = item.lines.slice(close);
        const gap = head.length > 0 && head[head.length - 1]!.trim() !== "" ? [""] : [];
        item.lines = [...head, ...gap, ...movedLines, "", ...tail];
        item.modified = true;
      }
      seq.push(item);
    });
  });

  // what the template does not know, then the Wachiman block and the footer
  for (const u of floaters) seq.push(unitItem(u));
  for (const u of units) if (u.kind === "wachiman") seq.push(unitItem(u));
  for (const u of units) if (u.kind === "footer") seq.push(unitItem(u));

  if (seq.filter((i) => i.original !== undefined).length + moved.length !== units.length) {
    throw new ToolError("format could not place every part of the description; nothing was changed. This is a bug in wachiman.");
  }
  if (seq.length === units.length && seq.every((item, i) => item.original === i && item.modified !== true)) return text;

  const out: string[] = [];
  for (const item of seq) {
    const lines = trimEnd(item.lines);
    if (lines.length === 0) continue;
    if (out.length > 0) out.push("");
    out.push(...lines);
  }
  if (parsed.lines[parsed.lines.length - 1] === "") out.push("");
  const result = out.join(parsed.eol);

  const have = lineCounts(result);
  for (const [line, n] of lineCounts(text)) {
    if ((have.get(line) ?? 0) < n) {
      throw new ToolError(`format would have lost the line ${JSON.stringify(line)}; nothing was changed. This is a bug in wachiman.`);
    }
  }
  return result;
}

// --------------------------------------------------------------------------- the command

const PREFIX = "wachiman pr-template";

function readIfPresent(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new ToolError(`cannot read ${path}: ${(err as Error).message}`);
  }
}

function templateFor(catalog: Catalog, choiceText: string | null): ResolvedTemplate {
  return withLockedFromCatalog(resolveTemplate(catalog, choiceText === null ? null : loadRepoChoice(choiceText, catalog)), catalog);
}

/** Replaces the file through a temporary file in the same directory, if it is still the file that was read. */
function rewrite(target: string, shown: string, content: string, before: ReturnType<typeof lstatSync>) {
  const tmp = join(dirname(target), `.${basename(target)}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`);
  writeFileSync(tmp, content, { flag: "wx" });
  try {
    chmodSync(tmp, before.mode & 0o777);
    const now = lstatSync(target);
    if (now.isSymbolicLink() || now.ino !== before.ino || now.dev !== before.dev || now.mtimeMs !== before.mtimeMs) {
      throw new UsageError(`${shown} changed while format was running; it was not rewritten. Run it again.`);
    }
    renameSync(tmp, target);
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      // Renamed into place, or already gone.
    }
  }
}

/** Prints the description in template order, or rewrites the file. Exit 0 on success, also when nothing moved; 2 on a usage, configuration or tool problem. */
export function runFormat(opts: FormatOptions, repoDir: string, io: PrTemplateIo, deps: FormatDeps = {}): number {
  try {
    const catalog = deps.catalog ?? loadCatalog();
    const template = templateFor(catalog, readIfPresent(join(repoDir, CHOICE_FILE)));

    let text: string;
    let target: string | undefined;
    let before: ReturnType<typeof lstatSync> | undefined;
    if (opts.file !== undefined) {
      target = resolve(repoDir, opts.file);
      if (opts.write) {
        try {
          before = lstatSync(target);
        } catch (err) {
          throw new ToolError(`cannot read ${opts.file}: ${(err as Error).message}`);
        }
        if (before.isSymbolicLink()) throw new UsageError(`${opts.file} is a symbolic link; format does not write through links.`);
        if (!before.isFile()) throw new UsageError(`${opts.file} is not a regular file.`);
      }
      try {
        text = readFileSync(target, "utf8");
      } catch (err) {
        throw new ToolError(`cannot read ${opts.file}: ${(err as Error).message}`);
      }
    } else {
      try {
        text = deps.stdin ? deps.stdin() : readFileSync(0, "utf8");
      } catch (err) {
        throw new ToolError(`cannot read the description from standard input: ${(err as Error).message}`);
      }
    }

    const result = formatDescription(text, template);
    if (!opts.write) {
      io.stdout(result);
      return 0;
    }
    if (result === text) {
      io.stderr(`${PREFIX}: ${opts.file} is already in the template's order; nothing changed.`);
      return 0;
    }
    rewrite(target!, opts.file!, result, before!);
    io.stderr(`${PREFIX}: reordered ${opts.file}.`);
    return 0;
  } catch (err) {
    if (err instanceof UsageError || err instanceof ToolError) {
      io.stderr(`${PREFIX}: error: ${err.message}`);
      return 2;
    }
    throw err;
  }
}
