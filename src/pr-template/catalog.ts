/**
 * The PR description template's section catalog (`templates/pr/sections.json`) and a
 * repository's choice on top of it (`.github/pr-template.json`). Both are data: this file reads
 * them, checks them and returns typed entries. Resolving, rendering and checking live elsewhere
 * (ADR 0050).
 *
 * Every error is a `PrTemplateConfigError`, a `UsageError` (exit 2), and there is never a
 * fallback to another version or to the default: a broken definition stops the command.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UsageError } from "../config";

export class PrTemplateConfigError extends UsageError {}

export type SectionKind = "status-row" | "section" | "details" | "block" | "footer";

interface EntryBase {
  /** Lower-case words joined by hyphens. Unique across the catalog and a repository's custom entries. */
  id: string;
  /** Locked entries are in every template and a repository can neither drop them nor reuse their name. */
  locked: boolean;
  /** Required entries cannot be dropped; the checker reports one that is missing. */
  required: boolean;
  /** Part of the default template. Catalog entries with `false` are offered for a repository to add. */
  default: boolean;
  /** A rule the checker applies: `risk-floor`, `not-empty`, `commit-is-head` or `max-rows:N`. */
  rule?: string;
  /** The comment that tells the author what goes here. */
  guide?: string;
  /** True for an entry that came from a repository's `custom` list. */
  custom?: boolean;
  /** For a custom entry: the id it was placed after. */
  after?: string;
}
export interface StatusRowEntry extends EntryBase {
  kind: "status-row";
  label: string;
}
export interface SectionEntry extends EntryBase {
  kind: "section";
  heading: string;
  body: string[];
}
export interface DetailsEntry extends EntryBase {
  kind: "details";
  summary: string;
  summarySuffix: string;
  body: string[];
}
export interface BlockEntry extends EntryBase {
  kind: "block";
  start: string;
  end: string;
}
export interface FooterEntry extends EntryBase {
  kind: "footer";
  text: string;
}
export type CatalogEntry = StatusRowEntry | SectionEntry | DetailsEntry | BlockEntry | FooterEntry;

export interface Catalog {
  version: number;
  /** The comment at the top of the generated file, under the stamp. */
  intro: string;
  sections: CatalogEntry[];
}

export type CustomKind = "status-row" | "section" | "details";
export interface CustomEntry {
  id: string;
  kind: CustomKind;
  /** The label of a status row, the heading of a section or the summary of a details block. */
  name: string;
  required: boolean;
  guide?: string;
  after?: string;
}

export interface RepoChoice {
  base: "default";
  add: string[];
  drop: string[];
  custom: CustomEntry[];
  preamble: string[];
}

export const CATALOG_FILE = "templates/pr/sections.json";
export const CHOICE_FILE = ".github/pr-template.json";

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const RULE = /^(risk-floor|not-empty|commit-is-head|max-rows:[1-9][0-9]*)$/;

/** Where the catalog is read from: the package or clone root. */
export function catalogPath() {
  return join(import.meta.dir, "..", "..", "templates", "pr", "sections.json");
}

export function loadCatalog(path: string = catalogPath()): Catalog {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new PrTemplateConfigError(`${CATALOG_FILE} cannot be read: ${(err as Error).message}`);
  }
  return parseCatalog(text);
}

// ------------------------------------------------------------------ shared checks

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function parseJson(text: string, file: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new PrTemplateConfigError(`${file} is not valid JSON: ${(err as Error).message}`);
  }
}

function onlyKeys(obj: Obj, allowed: readonly string[], where: string) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) throw new PrTemplateConfigError(`${where} has an unknown key "${key}" (allowed: ${allowed.join(", ")}).`);
  }
}

function str(obj: Obj, key: string, where: string, { optional = false, nonEmpty = true } = {}): string | undefined {
  const v = obj[key];
  if (v === undefined) {
    if (optional) return undefined;
    throw new PrTemplateConfigError(`${where} needs "${key}" (a string).`);
  }
  if (typeof v !== "string") throw new PrTemplateConfigError(`${where}: "${key}" must be a string.`);
  if (nonEmpty && v.trim() === "") throw new PrTemplateConfigError(`${where}: "${key}" must not be empty.`);
  return v;
}

function bool(obj: Obj, key: string, where: string, fallback: boolean): boolean {
  const v = obj[key];
  if (v === undefined) return fallback;
  if (typeof v !== "boolean") throw new PrTemplateConfigError(`${where}: "${key}" must be true or false.`);
  return v;
}

function strings(obj: Obj, key: string, where: string): string[] {
  const v = obj[key];
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((s) => typeof s !== "string")) {
    throw new PrTemplateConfigError(`${where}: "${key}" must be a list of strings.`);
  }
  return v as string[];
}

/** A guide comment sits inside `<!-- -->`, and a status row's sits inside a table cell. */
function checkGuide(guide: string | undefined, kind: SectionKind, where: string) {
  if (guide === undefined) return;
  if (/<!--|-->/.test(guide)) throw new PrTemplateConfigError(`${where}: the guide comment must not contain "<!--" or "-->".`);
  if (kind === "status-row" && /[|\r\n]/.test(guide)) {
    throw new PrTemplateConfigError(`${where}: the guide comment of a status row must be one line without "|".`);
  }
}

/** The label, heading or summary an entry shows. */
export function entryName(entry: CatalogEntry): string | undefined {
  if (entry.kind === "status-row") return entry.label;
  if (entry.kind === "section") return entry.heading;
  if (entry.kind === "details") return entry.summary;
  return undefined;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// ------------------------------------------------------------------ the catalog

const ENTRY_KEYS: Record<SectionKind, readonly string[]> = {
  "status-row": ["id", "kind", "label", "locked", "required", "default", "rule", "guide"],
  section: ["id", "kind", "heading", "locked", "required", "default", "rule", "guide", "body"],
  details: ["id", "kind", "summary", "summarySuffix", "locked", "required", "default", "rule", "guide", "body"],
  block: ["id", "kind", "start", "end", "locked", "required", "default", "rule", "guide"],
  footer: ["id", "kind", "text", "locked", "required", "default", "rule", "guide"],
};

export function parseCatalog(text: string): Catalog {
  const raw = parseJson(text, CATALOG_FILE);
  const here = CATALOG_FILE;
  if (!isObj(raw)) throw new PrTemplateConfigError(`${here} must be a JSON object.`);
  onlyKeys(raw, ["version", "intro", "sections"], here);
  const version = raw.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new PrTemplateConfigError(`${here}: "version" must be a positive integer.`);
  }
  const intro = str(raw, "intro", here, { optional: true }) ?? "";
  checkGuide(intro, "section", `${here} intro`);
  if (!Array.isArray(raw.sections) || raw.sections.length === 0) {
    throw new PrTemplateConfigError(`${here}: "sections" must be a non-empty list.`);
  }

  const entries: CatalogEntry[] = [];
  const ids = new Set<string>();
  raw.sections.forEach((item, i) => {
    let where = `${here} sections[${i}]`;
    if (!isObj(item)) throw new PrTemplateConfigError(`${where} must be an object.`);
    const kind = item.kind;
    if (kind !== "status-row" && kind !== "section" && kind !== "details" && kind !== "block" && kind !== "footer") {
      throw new PrTemplateConfigError(`${where}: "kind" must be status-row, section, details, block or footer.`);
    }
    onlyKeys(item, ENTRY_KEYS[kind], where);
    const id = str(item, "id", where) as string;
    where = `${here} section "${id}"`;
    if (!ID.test(id)) throw new PrTemplateConfigError(`${where}: the id must be lower-case words joined by hyphens.`);
    if (ids.has(id)) throw new PrTemplateConfigError(`${here}: the id "${id}" is used twice.`);
    ids.add(id);

    const locked = bool(item, "locked", where, false);
    const base = {
      id,
      locked,
      required: bool(item, "required", where, locked),
      default: bool(item, "default", where, true),
      rule: str(item, "rule", where, { optional: true }),
      guide: str(item, "guide", where, { optional: true }),
    };
    if (locked && !base.required) throw new PrTemplateConfigError(`${where} is locked, so it must be required.`);
    if (locked && !base.default) throw new PrTemplateConfigError(`${where} is locked, so it must be in the default template.`);
    if (base.rule !== undefined && !RULE.test(base.rule)) {
      throw new PrTemplateConfigError(`${where}: unknown rule "${base.rule}" (known: risk-floor, not-empty, commit-is-head, max-rows:N).`);
    }
    checkGuide(base.guide, kind, where);
    const clean = <T extends EntryBase>(e: T): T => {
      if (e.rule === undefined) delete e.rule;
      if (e.guide === undefined) delete e.guide;
      return e;
    };

    if (kind === "status-row") {
      entries.push(clean({ ...base, kind, label: str(item, "label", where) as string }));
    } else if (kind === "section") {
      entries.push(clean({ ...base, kind, heading: str(item, "heading", where) as string, body: strings(item, "body", where) }));
    } else if (kind === "details") {
      entries.push(
        clean({
          ...base,
          kind,
          summary: str(item, "summary", where) as string,
          summarySuffix: str(item, "summarySuffix", where, { optional: true, nonEmpty: false }) ?? "",
          body: strings(item, "body", where),
        }),
      );
    } else if (kind === "block") {
      const start = str(item, "start", where) as string;
      const end = str(item, "end", where) as string;
      if (!locked) throw new PrTemplateConfigError(`${where}: a marked block must be locked.`);
      entries.push(clean({ ...base, kind, start, end }));
    } else {
      const footer = str(item, "text", where) as string;
      if (!locked) throw new PrTemplateConfigError(`${where}: the footer must be locked.`);
      if (!footer.includes("{sha}")) throw new PrTemplateConfigError(`${where}: the footer text must contain the {sha} placeholder.`);
      if (/<(sha|model)>/i.test(footer)) {
        throw new PrTemplateConfigError(`${where}: write placeholders as {sha}; GitHub hides <sha> as an HTML tag.`);
      }
      entries.push(clean({ ...base, kind, text: footer }));
    }
  });

  validateLayout(entries);
  validateNames(entries);
  return { version, intro, sections: entries };
}

/** Status rows first, one wachiman block, the footer last. */
function validateLayout(entries: CatalogEntry[]) {
  const here = CATALOG_FILE;
  const kinds = entries.map((e) => e.kind);
  const firstOther = kinds.findIndex((k) => k !== "status-row");
  if (firstOther === -1 || kinds.slice(firstOther).includes("status-row")) {
    throw new PrTemplateConfigError(`${here}: the status rows must come first, together, and be followed by other entries.`);
  }
  if (kinds.filter((k) => k === "block").length !== 1) throw new PrTemplateConfigError(`${here} must have exactly one marked block.`);
  if (kinds.filter((k) => k === "footer").length !== 1) throw new PrTemplateConfigError(`${here} must have exactly one footer.`);
  if (kinds[kinds.length - 1] !== "footer") throw new PrTemplateConfigError(`${here}: the footer must be the last entry.`);
  if (kinds[kinds.length - 2] !== "block") throw new PrTemplateConfigError(`${here}: the marked block must come right before the footer.`);
  const hasRisk = entries.some((e) => e.kind === "status-row" && e.locked && e.rule === "risk-floor");
  if (!hasRisk) throw new PrTemplateConfigError(`${here} must have a locked status row with the risk-floor rule.`);
}

/** No two entries of one kind show the same name. */
function validateNames(entries: CatalogEntry[]) {
  const seen = new Map<string, string>();
  for (const e of entries) {
    const name = entryName(e);
    if (name === undefined) continue;
    const key = `${e.kind}:${name.trim().toLowerCase()}`;
    const prev = seen.get(key);
    if (prev !== undefined) throw new PrTemplateConfigError(`${CATALOG_FILE}: "${prev}" and "${e.id}" show the same name "${name}".`);
    seen.set(key, e.id);
  }
}

// ------------------------------------------------------------------ the repository's choice

export const CUSTOM_NAME_KEY: Record<CustomKind, string> = { "status-row": "label", section: "heading", details: "summary" };

export const MAX_NAME_LENGTH = 80;
const LINE_BREAKING_OR_CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/**
 * A custom name is written into the template as a heading, a table label or a bold summary, so it
 * must not be able to add structure: no line break or control character (a second heading), no `|`
 * in a status row (a second cell), no `<` or `>` (an HTML tag) and no `-->` (it would close the
 * comment around a guide). The check applies to the name as written; nothing is repaired.
 */
export function checkCustomName(name: string, nameKey: string, kind: CustomKind, where: string) {
  if (name.trim() === "") throw new PrTemplateConfigError(`${where}: the ${nameKey} must not be empty.`);
  if (LINE_BREAKING_OR_CONTROL.test(name))
    throw new PrTemplateConfigError(`${where}: the ${nameKey} must be one line without control characters.`);
  if (name !== name.trim() || / {2,}/.test(name)) {
    throw new PrTemplateConfigError(
      `${where}: the ${nameKey} must not start or end with whitespace or contain a run of spaces; the checker reads headings and cells trimmed and collapsed.`,
    );
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new PrTemplateConfigError(`${where}: the ${nameKey} is ${name.length} characters; the limit is ${MAX_NAME_LENGTH}.`);
  }
  if (kind === "status-row" && name.includes("|"))
    throw new PrTemplateConfigError(`${where}: the ${nameKey} must not contain "|"; it is a table cell.`);
  if (name.includes("-->")) throw new PrTemplateConfigError(`${where}: the ${nameKey} must not contain "-->".`);
  if (/[<>]/.test(name)) throw new PrTemplateConfigError(`${where}: the ${nameKey} must not contain "<" or ">".`);
}

/**
 * What is wrong with the HTML comments of one preamble entry: it opens a comment it does not close
 * (GitHub would hide everything after it) or closes one it did not open. Undefined when balanced.
 */
export function commentProblem(text: string): string | undefined {
  let at = 0;
  for (;;) {
    const open = text.indexOf("<!--", at);
    const close = text.indexOf("-->", at);
    if (open === -1) return close === -1 ? undefined : 'contains a stray "-->"';
    if (close !== -1 && close < open) return 'contains a stray "-->"';
    const end = text.indexOf("-->", open + 4);
    if (end === -1) return 'opens a comment ("<!--") it does not close';
    at = end + 3;
  }
}

/**
 * Whether the preamble, taken as one block of lines, leaves a fenced code block open (GitHub would
 * render everything below it as code). A fence opens on a line that starts, after up to three
 * spaces, with three or more backticks or tildes, and closes on a later line of the same character,
 * at least as long and with nothing after it.
 */
export function fenceProblem(lines: readonly string[]): string | undefined {
  let fence: string | null = null;
  for (const line of lines.flatMap((l) => l.split("\n"))) {
    const mark = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (mark === null) continue;
    if (fence === null) fence = mark[1]!;
    else if (mark[1]![0] === fence[0] && mark[1]!.length >= fence.length && mark[2]!.trim() === "") fence = null;
  }
  return fence === null ? undefined : 'opens a fenced code block ("```" or "~~~") it does not close';
}

/**
 * Parse and validate `.github/pr-template.json`. `catalog` is the one the choice is read against
 * (default: the shipped one). The text that is not valid is named in the error; nothing is
 * repaired and nothing falls back.
 */
export function loadRepoChoice(text: string, catalog: Catalog = loadCatalog()): RepoChoice {
  const here = CHOICE_FILE;
  const raw = parseJson(text, here);
  if (!isObj(raw)) throw new PrTemplateConfigError(`${here} must be a JSON object.`);
  onlyKeys(raw, ["base", "add", "drop", "custom", "preamble"], here);

  const base = raw.base ?? "default";
  if (base !== "default") {
    throw new PrTemplateConfigError(`${here}: unsupported base ${JSON.stringify(base)}; the only base is "default".`);
  }
  const add = strings(raw, "add", here);
  const drop = strings(raw, "drop", here);
  const preamble = strings(raw, "preamble", here);
  const byId = new Map(catalog.sections.map((e) => [e.id, e]));

  for (const id of add) {
    if (!byId.has(id)) throw new PrTemplateConfigError(`${here}: "add" names the unknown section "${id}".`);
  }
  for (const id of drop) {
    const entry = byId.get(id);
    if (!entry) throw new PrTemplateConfigError(`${here}: "drop" names the unknown section "${id}".`);
    if (entry.locked) throw new PrTemplateConfigError(`${here}: "${id}" is locked and cannot be dropped.`);
    if (entry.required) throw new PrTemplateConfigError(`${here}: "${id}" is required and cannot be dropped.`);
    if (add.includes(id)) throw new PrTemplateConfigError(`${here}: "${id}" is both added and dropped.`);
  }

  if (raw.custom !== undefined && !Array.isArray(raw.custom)) throw new PrTemplateConfigError(`${here}: "custom" must be a list.`);
  const customRaw = (raw.custom ?? []) as unknown[];
  const custom: CustomEntry[] = [];
  const customIds = new Set<string>();
  const lockedNames = catalog.sections
    .filter((e) => e.locked)
    .map((e) => entryName(e))
    .filter((n): n is string => n !== undefined);
  const included = catalog.sections.filter((e) => e.locked || add.includes(e.id) || (e.default && !drop.includes(e.id)));

  customRaw.forEach((item, i) => {
    let where = `${here} custom[${i}]`;
    if (!isObj(item)) throw new PrTemplateConfigError(`${where} must be an object.`);
    const kind = item.kind;
    if (kind !== "status-row" && kind !== "section" && kind !== "details") {
      throw new PrTemplateConfigError(`${where}: "kind" must be status-row, section or details.`);
    }
    const nameKey = CUSTOM_NAME_KEY[kind];
    onlyKeys(item, ["id", "kind", nameKey, "required", "guide", "after"], where);
    const id = str(item, "id", where) as string;
    where = `${here} custom entry "${id}"`;
    if (!ID.test(id)) throw new PrTemplateConfigError(`${where}: the id must be lower-case words joined by hyphens.`);
    if (byId.has(id) || customIds.has(id)) throw new PrTemplateConfigError(`${where}: the id is already used by another section.`);
    const name = str(item, nameKey, where) as string;
    checkCustomName(name, nameKey, kind, where);
    const locked = lockedNames.find((n) => sameName(n, name));
    if (locked !== undefined) throw new PrTemplateConfigError(`${where}: "${name}" reuses the locked name "${locked}".`);
    const twin = included.find((e) => e.kind === kind && sameName(entryName(e) ?? "", name));
    if (twin) throw new PrTemplateConfigError(`${where}: "${name}" is already the name of the section "${twin.id}".`);
    const twinCustom = custom.find((c) => c.kind === kind && sameName(c.name, name));
    if (twinCustom) throw new PrTemplateConfigError(`${where}: "${name}" is already the name of the custom entry "${twinCustom.id}".`);
    const guide = str(item, "guide", where, { optional: true });
    checkGuide(guide, kind, where);
    const after = str(item, "after", where, { optional: true });
    if (after !== undefined) {
      const targetKind: SectionKind | undefined = byId.get(after)?.kind ?? custom.find((c) => c.id === after)?.kind;
      if (!targetKind)
        throw new PrTemplateConfigError(
          `${where}: "after" names the unknown id "${after}" (it must be a catalog id or a custom entry listed before this one).`,
        );
      if (targetKind === "block" || targetKind === "footer") {
        throw new PrTemplateConfigError(
          `${where}: nothing can be placed after "${after}"; the marked block and the footer close the template.`,
        );
      }
      if ((kind === "status-row") !== (targetKind === "status-row")) {
        throw new PrTemplateConfigError(
          `${where}: a ${kind} cannot be placed after "${after}", which is ${kind === "status-row" ? "not a status row" : "a status row"}.`,
        );
      }
    }
    customIds.add(id);
    const entry: CustomEntry = { id, kind, name, required: bool(item, "required", where, false) };
    if (guide !== undefined) entry.guide = guide;
    if (after !== undefined) entry.after = after;
    custom.push(entry);
  });

  preamble.forEach((line, i) => {
    if (/wachiman:confidence:|wachiman:pr-template|<!--\s*wachiman:/.test(line)) {
      throw new PrTemplateConfigError(`${here}: a preamble line must not contain a Wachiman marker.`);
    }
    const problem = commentProblem(line);
    if (problem !== undefined)
      throw new PrTemplateConfigError(`${here}: preamble[${i}] ${problem}; the rest of the template would be hidden or broken.`);
  });
  const open = fenceProblem(preamble);
  if (open !== undefined)
    throw new PrTemplateConfigError(`${here}: the preamble ${open}; the rest of the template would be rendered as code.`);
  return { base: "default", add, drop, custom, preamble };
}
