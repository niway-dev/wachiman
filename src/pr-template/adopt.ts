/**
 * Adopting an unmanaged `.github/pull_request_template.md` (ADR 0052). The file is read in blocks
 * (a table row, a heading, a `<details>` element, an HTML comment, or a run of lines up to a blank
 * line) and split into the template's own structure, which the catalog replaces, and everything
 * else, which moves into `.github/pr-template.json`:
 *
 * - what the catalog knows (guide comments, the status table, its `##` sections, its `<details>`
 *   blocks, the Wachiman block, the footer) is dropped, because the catalog generates it again;
 * - an unknown status row, `##` section or `<details>` block becomes a `custom` entry;
 * - any other block goes to `preamble`, in order.
 *
 * What the loader (`loadRepoChoice`) would reject never reaches the output: a name it refuses stays
 * in the preamble as ordinary lines, a Wachiman marker (any `<!-- wachiman:` comment) is dropped
 * (the catalog writes its own), and a comment that is opened and never closed (or closed and never
 * opened) or a fenced code block that is never closed refuses the adoption with a `UsageError`,
 * before anything is written.
 *
 * The report lists every block that moved and every comment taken for a guide, so a repository
 * comment misread as guidance is visible (and still in the backup).
 */
import { UsageError } from "../config";
import { checkCustomName, commentProblem, CUSTOM_NAME_KEY, entryName, fenceProblem, type Catalog, type CatalogEntry, type CustomEntry, type CustomKind } from "./catalog";
import { LEGACY_HEADER_PREFIX, collapseSpace, isLegacyGuide } from "./legacy-guides";
import { STATUS_GUIDE_LEAD, normalizeForStamp } from "./render";

export interface Adoption {
  custom: CustomEntry[];
  /** Blocks and lines for `preamble`; an empty string is the blank line between two blocks that were apart. */
  preamble: string[];
  /** Catalog entries that are not in the default template but were in the old file. */
  add: string[];
  report: string[];
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const clip = (text: string, n = 90) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);
const LIST_ITEM = /^\s{0,3}([-*+]|\d+[.)])\s/;
const HEADING = /^(#{1,6})\s+(.*?)\s*$/;
const DETAILS_OPEN = /^\s*<details\b[^>]*>\s*<summary>(.*?)<\/summary>\s*$/i;
const STATUS_ROW = /^\|\s*\*\*(.+?)\*\*\s*\|(.*)\|\s*$/;
const TABLE_HEADER = /^\|\s*\|\s*\|\s*$/;
const TABLE_SEPARATOR = /^\|(\s*:?-+:?\s*\|)+\s*$/;
const WACHIMAN_MARKER = /<!--\s*wachiman:|wachiman:confidence:|wachiman:pr-template/i;
const FOOTER = /^<sub>(.*)<\/sub>\s*$/;

/** Whether `line` starts a block of its own, so a text run ends before it. */
const startsBlock = (line: string) => /^\s*<!--/.test(line) || /^#{1,6}\s/.test(line) || /^\s*<\/?details\b/i.test(line) || /^\s*\|/.test(line) || /^<sub>/.test(line);

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "custom";

export interface AdoptContext {
  catalog: Catalog;
  /** Custom ids and names the repository's JSON already has (to avoid a duplicate when merging). */
  existingCustom?: CustomEntry[];
  /** The `drop` list of the repository's JSON: a section it dropped is not added back. */
  existingDrop?: string[];
}

export function analyzeUnmanaged(fileText: string, { catalog, existingCustom = [], existingDrop = [] }: AdoptContext): Adoption {
  const lines = fileText.replace(/\r\n?/g, "\n").split("\n");
  const result: Adoption = { custom: [], preamble: [], add: [], report: [] };
  const report = (line: string) => result.report.push(line);

  const lockedNames = catalog.sections.filter((e) => e.locked).map((e) => entryName(e)).filter((n): n is string => n !== undefined);
  const catalogGuides = new Set(catalog.sections.flatMap((e) => (e.guide === undefined ? [] : [collapseSpace(e.guide)])).concat(collapseSpace(catalog.intro)));
  const usedIds = new Set([...catalog.sections.map((e) => e.id), ...existingCustom.map((c) => c.id)]);
  const knownCount = { rows: 0, sections: 0, details: 0 };

  const findKnown = (kind: CatalogEntry["kind"], name: string) => catalog.sections.find((e) => e.kind === kind && entryName(e) !== undefined && same(entryName(e)!, name));
  // A table line is compared as a formatter leaves it equal: the padding of a cell and the width of a separator do not count.
  const canon = (line: string) => normalizeForStamp(line).trim();
  const bodyOf = (e: CatalogEntry): Set<string> => new Set(("body" in e ? e.body : []).map(canon).filter((l) => l !== ""));

  type Ctx = { known: CatalogEntry } | { custom: CustomEntry } | null;
  let ctx: Ctx = null;
  let afterKnown = false;
  let prevRowId: string | undefined;
  let prevOtherId: string | undefined;
  let sawHeader = false;
  let lastPreambleEnd = -1;
  // One entry per `<details>` that is open: "moved" when its lines go to the preamble (so its closing tag goes too), "structure" when the catalog regenerates it.
  const openDetails: ("moved" | "structure")[] = [];

  const noteKnown = (e: CatalogEntry) => {
    if (e.kind === "status-row") prevRowId = e.id;
    else if (e.kind !== "block" && e.kind !== "footer") prevOtherId = e.id;
    if (!e.default && !result.add.includes(e.id)) {
      if (existingDrop.includes(e.id)) report(`"${entryName(e)}" is in the old file, but .github/pr-template.json drops it; it stays dropped.`);
      else result.add.push(e.id);
    }
  };

  const toPreamble = (blockLines: string[], start: number, end: number) => {
    const items: string[] = [];
    for (const raw of blockLines) {
      let line = raw.replace(/<(model|sha)>/gi, (_m, tag: string) => `{${tag.toLowerCase()}}`);
      if (line !== raw) report("rewrote a <model> or <sha> tag as a {model} or {sha} placeholder; GitHub hides HTML tags.");
      // The catalog writes the Wachiman markers itself, and the loader refuses them in the preamble.
      if (WACHIMAN_MARKER.test(line)) {
        const cleaned = line.replace(/<!--\s*wachiman:[^]*?-->/gi, "");
        report(`dropped a Wachiman marker from a line that was kept: ${clip(line.trim())}`);
        if (WACHIMAN_MARKER.test(cleaned) || cleaned.trim() === "") continue;
        line = cleaned.trimEnd();
      }
      if (items.length === 0 || LIST_ITEM.test(line)) items.push(line);
      else items[items.length - 1] += `\n${line}`;
    }
    for (const item of items) {
      const problem = commentProblem(item);
      if (problem !== undefined) {
        throw new UsageError(
          `The old template ${problem} near "${clip(item.trim(), 60)}", which would hide or break the generated template. Close the comment with "-->" (or remove it) in the old file and run install again; nothing was written.`,
        );
      }
    }
    if (items.length === 0) return;
    if (result.preamble.length > 0 && lastPreambleEnd !== start) result.preamble.push("");
    result.preamble.push(...items);
    lastPreambleEnd = end;
    report(`moved to preamble: ${blockLines.map((l, i) => (i === 0 ? l.trim() : `\n    ${l.trim()}`)).join("")}`);
  };

  const newCustom = (kind: CustomKind, name: string): CustomEntry | null => {
    if (lockedNames.some((n) => same(n, name))) return null;
    // The loader checks the name as it is stored; an entry it would refuse stays as ordinary lines in the preamble.
    try {
      checkCustomName(name.trim(), CUSTOM_NAME_KEY[kind], kind, "");
    } catch (err) {
      const kindName = kind === "status-row" ? "status row" : kind === "section" ? "section" : "collapsed block";
      report(`"${clip(name.trim(), 40)}" cannot be a custom ${kindName} (${(err as Error).message.replace(/^:\s*/, "")}); its lines stay in the preamble as they are.`);
      return null;
    }
    if (result.custom.some((c) => c.kind === kind && same(c.name, name))) return null;
    const existing = existingCustom.find((c) => c.kind === kind && same(c.name, name));
    if (existing) {
      // Already a custom entry of the repository: it stays as it is; its place in the old file only moves the anchor.
      if (kind === "status-row") prevRowId = existing.id;
      else prevOtherId = existing.id;
      report(`"${existing.name}" is already a custom entry in .github/pr-template.json; kept as it is.`);
      return { ...existing };
    }
    let id = slug(name);
    for (let n = 2; usedIds.has(id); n++) id = `${slug(name)}-${n}`;
    usedIds.add(id);
    const after = kind === "status-row" ? prevRowId : prevOtherId;
    const entry: CustomEntry = { id, kind, name: name.trim(), required: false, ...(after !== undefined ? { after } : {}) };
    result.custom.push(entry);
    if (kind === "status-row") prevRowId = id;
    else prevOtherId = id;
    report(`kept the ${kind === "status-row" ? "status row" : kind === "section" ? "section" : "collapsed block"} "${entry.name}" as a custom entry${after ? ` after "${after}"` : ""} in .github/pr-template.json.`);
    return entry;
  };

  const bodyCovered = (run: string[]) => {
    if (ctx === null || !("known" in ctx)) return false;
    const body = bodyOf(ctx.known);
    return run.every((l) => l.trim() === "" || body.has(canon(l)));
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
      continue;
    }

    // An HTML comment of its own.
    if (/^\s*<!--/.test(line)) {
      let j = i;
      while (j < lines.length && !lines[j]!.includes("-->", j === i ? line.indexOf("<!--") + 4 : 0)) j++;
      const last = lines[Math.min(j, lines.length - 1)]!;
      if (j < lines.length && last.trim().endsWith("-->")) {
        const raw = lines.slice(i, j + 1);
        const inner = collapseSpace(raw.join("\n").trim().replace(/^<!--/, "").replace(/-->$/, ""));
        if (inner === "wachiman:confidence:start") {
          let k = j + 1;
          while (k < lines.length && collapseSpace(lines[k]!.replace(/^\s*<!--/, "").replace(/-->\s*$/, "")) !== "wachiman:confidence:end") k++;
          if (k < lines.length) {
            report("replaced the Wachiman block by the catalog's.");
            ctx = null;
            afterKnown = false;
            i = k + 1;
            continue;
          }
          // No end marker: nothing says where the block stops, so only the marker line goes (the catalog writes its own) and everything after it is kept.
          report("a Wachiman start marker has no end marker; the marker line was dropped (the catalog writes its own) and everything after it was kept.");
          ctx = null;
          afterKnown = false;
          i = j + 1;
          continue;
        }
        if (inner === "wachiman:confidence:end" || inner.startsWith("wachiman:pr-template")) {
          ctx = null;
          afterKnown = false;
          i = j + 1;
          continue;
        }
        const isHeader = raw[0]!.trimStart().startsWith(LEGACY_HEADER_PREFIX);
        const matches = isHeader || isLegacyGuide(inner) || catalogGuides.has(inner) || inner.startsWith(collapseSpace(STATUS_GUIDE_LEAD));
        if (isHeader || matches || afterKnown) {
          if (!isHeader && ctx !== null && "custom" in ctx && !matches && ctx.custom.guide === undefined && !/<!--|-->/.test(inner)) {
            if (result.custom.includes(ctx.custom)) {
              ctx.custom.guide = inner;
              report(`kept the comment under "${ctx.custom.name}" as its guide: ${clip(inner)}`);
            } else {
              report(`the comment under "${ctx.custom.name}" was not kept as a guide: the entry is already in .github/pr-template.json and stays as it is (the comment is in the backup): ${clip(inner)}`);
            }
          } else {
            report(`treated as a guide comment and replaced: ${clip(inner)}`);
          }
          afterKnown = false;
          i = j + 1;
          continue;
        }
        toPreamble(raw, i, j + 1);
        afterKnown = false;
        i = j + 1;
        continue;
      }
      // An opening `<!--` with no clean end: it is ordinary text; fall through.
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const name = heading[2]!.replace(/(?:^|\s+)#+\s*$/, "");
      if (level === 2) {
        const known = findKnown("section", name);
        if (known) {
          ctx = { known };
          knownCount.sections++;
          noteKnown(known);
          afterKnown = true;
          i++;
          continue;
        }
        const entry = newCustom("section", name);
        if (entry) {
          ctx = { custom: entry };
          afterKnown = true;
          i++;
          continue;
        }
      }
      toPreamble([line], i, i + 1);
      ctx = null;
      afterKnown = false;
      i++;
      continue;
    }

    const details = DETAILS_OPEN.exec(line);
    if (details) {
      const summary = details[1]!;
      const bold = /^\s*<b>(.*?)<\/b>/i.exec(summary);
      const name = (bold ? bold[1]! : summary.replace(/<[^>]+>/g, "")).trim();
      const known = findKnown("details", name);
      if (known) {
        openDetails.push("structure");
        ctx = { known };
        knownCount.details++;
        noteKnown(known);
        afterKnown = true;
        i++;
        continue;
      }
      const entry = newCustom("details", name);
      if (entry) {
        ctx = { custom: entry };
        openDetails.push("structure");
        afterKnown = true;
        i++;
        continue;
      }
      // A locked or duplicate name: the block is the repository's, so it moves whole, with its closing tag.
      openDetails.push("moved");
      toPreamble([line], i, i + 1);
      ctx = null;
      afterKnown = false;
      i++;
      continue;
    }
    if (/^\s*<details\b/i.test(line)) {
      // Any other opening tag is ordinary text, but its closing tag has to travel with it.
      openDetails.push("moved");
      toPreamble([line], i, i + 1);
      ctx = null;
      afterKnown = false;
      i++;
      continue;
    }
    if (/^\s*<\/details>\s*$/i.test(line)) {
      const closed = openDetails.pop();
      if (closed === "moved") {
        toPreamble([line], i, i + 1);
        afterKnown = false;
        i++;
        continue;
      }
      ctx = null;
      afterKnown = false;
      i++;
      continue;
    }

    if (/^\s*\|/.test(line)) {
      const trimmed = line.trim();
      if (TABLE_HEADER.test(trimmed)) {
        sawHeader = true;
        i++;
        continue;
      }
      if (TABLE_SEPARATOR.test(trimmed) && sawHeader) {
        sawHeader = false;
        i++;
        continue;
      }
      sawHeader = false;
      const row = STATUS_ROW.exec(trimmed);
      if (row) {
        const label = row[1]!;
        const known = findKnown("status-row", label);
        if (known) {
          knownCount.rows++;
          noteKnown(known);
          ctx = null;
          afterKnown = true;
          i++;
          continue;
        }
        const entry = newCustom("status-row", label);
        if (entry) {
          const cell = row[2]!.trim();
          const text = collapseSpace(/^<!--(.*)-->$/.exec(cell)?.[1] ?? cell);
          if (/<!--|-->|\|/.test(text) && result.custom.includes(entry)) {
            // More than one value, or markup a guide cannot carry: dropping it would lose the repository's text.
            throw new UsageError(
              `The old template has a row of "${entry.name}" on line ${i + 1} with more than one value or markup in its cell: "${clip(trimmed, 60)}". A row keeps one plain value as its guide. Reduce the row to one value (or move the rest out of the table) in the old file and run install again; nothing was written.`,
            );
          } else if (text !== "" && !result.custom.includes(entry)) {
            report(`the cell of "${entry.name}" was not kept as a guide: the entry is already in .github/pr-template.json and stays as it is (the cell is in the backup).`);
          } else if (text !== "") {
            entry.guide = text;
            report(`kept the cell of "${entry.name}" as its guide: ${clip(text)}`);
          }
          ctx = null;
          afterKnown = false;
          i++;
          continue;
        }
      }
      if (bodyCovered([trimmed])) {
        i++;
        continue;
      }
      toPreamble([line], i, i + 1);
      afterKnown = false;
      i++;
      continue;
    }

    const footer = FOOTER.exec(line.trim());
    if (footer && /Describes commit|<sha>|\{sha\}/i.test(footer[1]!)) {
      report("replaced the footer by the catalog's.");
      ctx = null;
      afterKnown = false;
      i++;
      continue;
    }

    // A run of lines up to a blank line or the start of another kind of block.
    let j = i + 1;
    while (j < lines.length && lines[j]!.trim() !== "" && !startsBlock(lines[j]!)) j++;
    const run = lines.slice(i, j);
    // Inside a known section the lines the catalog itself generates are structure; the others are the repository's.
    const rest = run.filter((l) => !bodyCovered([l]));
    if (rest.length > 0) toPreamble(rest, i, j);
    afterKnown = false;
    i = j;
  }

  // The loader reads the whole preamble, so a fence is judged across blocks (one may hold a blank line).
  const openFence = fenceProblem(result.preamble);
  if (openFence !== undefined) {
    const at = result.preamble.findLastIndex((entry) => /^ {0,3}(`{3,}|~{3,})/m.test(entry));
    const where = result.preamble.slice(Math.max(at, 0)).join("\n").trim();
    throw new UsageError(
      `The old template ${openFence} near "${clip(where, 60)}", which would render the rest of the generated template as code. Close the fence in the old file and run install again; nothing was written.`,
    );
  }

  const parts = [
    knownCount.rows > 0 ? `${knownCount.rows} status rows` : "",
    knownCount.sections > 0 ? `${knownCount.sections} sections` : "",
    knownCount.details > 0 ? `${knownCount.details} collapsed blocks` : "",
  ].filter((p) => p !== "");
  if (parts.length > 0) report(`replaced by the catalog's version: ${parts.join(", ")}.`);
  return result;
}

/** What `.github/pr-template.json` becomes: the existing definition (or an empty one) plus what the old file contributed. */
export function mergeAdoption(base: Record<string, unknown> | null, adoption: Adoption): Record<string, unknown> {
  const out: Record<string, unknown> = { base: "default", ...(base ?? {}) };
  const list = (key: string) => ((out[key] as unknown[] | undefined) ?? []) as string[];

  const add = [...list("add")];
  for (const id of adoption.add) if (!add.includes(id)) add.push(id);
  if (add.length > 0) out.add = add;

  const custom = [...((out.custom as CustomEntry[] | undefined) ?? [])];
  const nameKey = { "status-row": "label", section: "heading", details: "summary" } as const;
  const serial = (c: CustomEntry) => {
    const { name, kind, ...rest } = c;
    return { id: rest.id, kind, [nameKey[kind]]: name, required: rest.required, ...(rest.guide !== undefined ? { guide: rest.guide } : {}), ...(rest.after !== undefined ? { after: rest.after } : {}) };
  };
  for (const c of adoption.custom) custom.push(serial(c) as unknown as CustomEntry);
  if (custom.length > 0) out.custom = custom;

  const preamble = [...list("preamble")];
  const fresh = adoption.preamble.filter((p, i, all) => (p === "" ? all[i - 1] !== "" : !preamble.includes(p)));
  while (fresh.length > 0 && fresh[0] === "") fresh.shift();
  while (fresh.length > 0 && fresh[fresh.length - 1] === "") fresh.pop();
  if (fresh.length > 0) {
    if (preamble.length > 0 && preamble[preamble.length - 1] !== "") preamble.push("");
    preamble.push(...fresh);
  }
  if (preamble.length > 0) out.preamble = preamble;
  return out;
}
