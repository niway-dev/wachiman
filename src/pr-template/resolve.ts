/**
 * The effective template: the catalog's entries in catalog order, minus what a repository drops,
 * plus what it adds and its custom entries (ADR 0050). Pure; reads no file.
 */
import { PrTemplateConfigError, type Catalog, type CatalogEntry, type CustomEntry, type RepoChoice } from "./catalog";

export interface ResolvedTemplate {
  /** The catalog's intro comment. */
  intro: string;
  /** The effective entries in the order they appear in the file. */
  sections: CatalogEntry[];
  /** The repository's own lines, rendered above the status table. */
  preamble: string[];
}

function toEntry(c: CustomEntry): CatalogEntry {
  const base = { id: c.id, locked: false, required: c.required, default: true, custom: true as const };
  const extra = { ...(c.guide !== undefined ? { guide: c.guide } : {}), ...(c.after !== undefined ? { after: c.after } : {}) };
  if (c.kind === "status-row") return { ...base, ...extra, kind: "status-row", label: c.name };
  if (c.kind === "section") return { ...base, ...extra, kind: "section", heading: c.name, body: [] };
  return { ...base, ...extra, kind: "details", summary: c.name, summarySuffix: "", body: [] };
}

/**
 * `choice` null means the default template. A custom entry goes right after the entry it names
 * (after earlier custom entries placed there); with no `after`, a status row goes at the end of the
 * table and anything else goes just before the Wachiman block. An `after` naming a catalog entry
 * the repository dropped, or never added, still places the entry where that entry would have been.
 */
export function resolveTemplate(catalog: Catalog, choice: RepoChoice | null): ResolvedTemplate {
  if (choice === null) {
    return { intro: catalog.intro, sections: catalog.sections.filter((e) => e.default), preamble: [] };
  }
  const ids = new Set(catalog.sections.map((e) => e.id));
  for (const id of [...choice.add, ...choice.drop]) {
    if (!ids.has(id)) throw new PrTemplateConfigError(`.github/pr-template.json: unknown section "${id}".`);
  }

  const all: CatalogEntry[] = [...catalog.sections];
  for (const custom of choice.custom) {
    const entry = toEntry(custom);
    let at: number;
    if (custom.after !== undefined) {
      const anchor = all.findIndex((e) => e.id === custom.after);
      if (anchor === -1) throw new PrTemplateConfigError(`.github/pr-template.json: custom entry "${custom.id}" names the unknown id "${custom.after}".`);
      at = anchor + 1;
      while (all[at]?.custom && all[at]?.after === custom.after) at += 1;
    } else if (custom.kind === "status-row") {
      at = all.map((e) => e.kind).lastIndexOf("status-row") + 1;
    } else {
      at = all.findIndex((e) => e.kind === "block");
    }
    all.splice(at, 0, entry);
  }

  const sections = all.filter(
    (e) => e.custom || e.locked || choice.add.includes(e.id) || (e.default && !choice.drop.includes(e.id)),
  );
  return { intro: catalog.intro, sections, preamble: [...choice.preamble] };
}
