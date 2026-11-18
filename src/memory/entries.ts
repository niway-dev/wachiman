/**
 * The entries of repository memory (ADR 0056): the Markdown format, its parser and the entry id.
 *
 * A memory file is ordinary Markdown. Headings, prose and tables are free text; an entry is a
 * `###` heading followed by `- field: value` lines:
 *
 *     ### 4c1e9a2 ADR wording edits do not need a status or date bump
 *
 *     - kind: exception
 *     - scope: docs/adr/**
 *     - rule: Only a change to the Decision section requires updating the status line.
 *     - why: ADRs version themselves when a decision changes.
 *     - holds while: src/gateway.ts      (optional)
 *     - evidence:
 *       - 2026-11-18 operator instruction, pull request 709
 *     - added: 2026-11-18
 *
 * A value continues on following lines indented by two spaces. The parser never throws: every
 * defect is a `MemoryProblem` with its file and line, which `wachiman memory check` prints. An
 * entry with a defect is still returned when its fields can be read, so a review loads what it can.
 */
import { createHash } from "node:crypto";

export type MemoryKind = "convention" | "exception";

export interface MemoryEntry {
  /** Seven hex characters: the digest of `kind`, `scope`, `rule`, `why` and `holds while` (`entryId`). */
  id: string;
  title: string;
  kind: MemoryKind;
  /** A path glob, or several separated by commas. */
  scope: string;
  rule: string;
  why: string;
  /** The paths a fact the reason depends on lives in; absent for a preference. */
  holdsWhile?: string;
  evidence: string[];
  /** `YYYY-MM-DD`. */
  added: string;
  /** The file name inside `.wachiman/memory/`, and the line of the heading. */
  file: string;
  line: number;
}

export interface MemoryProblem {
  file: string;
  line: number;
  message: string;
}

/** The part of an entry its id is made from. Evidence and the date are not part of it, so adding evidence keeps the id. */
export interface EntryIdentity {
  kind: string;
  scope: string;
  rule: string;
  why: string;
  holdsWhile?: string;
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/** The id of an entry: seven hex characters of a SHA-256 over its normalised identity fields. */
export function entryId(entry: EntryIdentity): string {
  const material = JSON.stringify([entry.kind, entry.scope, entry.rule, entry.why, entry.holdsWhile ?? ""].map(squash));
  return createHash("sha256").update(material).digest("hex").slice(0, 7);
}

const HEADING = /^###\s+([0-9a-f]{7})\s+(\S.*)$/;
const ANY_HEADING = /^#{1,6}\s/;
const FIELD = /^- ([a-z][a-z ]*):\s*(.*)$/;
const FIELDS = ["kind", "scope", "rule", "why", "holds while", "evidence", "added"] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

interface Draft {
  heading: { id: string; title: string; line: number };
  values: Map<string, { text: string; line: number }>;
  evidence: string[];
  current?: string;
}

/** Every entry of one memory file and every defect found in it. */
export function parseMemoryFile(file: string, content: string): { entries: MemoryEntry[]; problems: MemoryProblem[] } {
  const entries: MemoryEntry[] = [];
  const problems: MemoryProblem[] = [];
  const problem = (line: number, message: string) => problems.push({ file, line, message });
  let draft: Draft | undefined;

  const finish = () => {
    if (!draft) return;
    const d = draft;
    draft = undefined;
    const text = (name: string) => d.values.get(name)?.text;
    const need = (name: string) => {
      if (text(name) === undefined || text(name) === "") {
        problem(d.heading.line, `missing ${name}`);
        return undefined;
      }
      return text(name);
    };
    const kind = need("kind");
    const scope = need("scope");
    const rule = need("rule");
    const why = need("why");
    const added = need("added");
    if (d.evidence.length === 0) problem(d.heading.line, "missing evidence");
    if (kind !== undefined && kind !== "convention" && kind !== "exception") {
      problem(d.values.get("kind")!.line, `kind must be "convention" or "exception", got "${kind}"`);
    }
    if (added !== undefined && !DATE.test(added)) {
      problem(d.values.get("added")!.line, `added must be a date like 2026-11-18, got "${added}"`);
    }
    if (kind === undefined || scope === undefined || rule === undefined || why === undefined || added === undefined) return;
    const holdsWhile = text("holds while");
    const id = entryId({ kind, scope, rule, why, ...(holdsWhile ? { holdsWhile } : {}) });
    if (id !== d.heading.id) problem(d.heading.line, `entry id ${d.heading.id} does not match its digest ${id}`);
    if (kind !== "convention" && kind !== "exception") return;
    entries.push({
      id: d.heading.id,
      title: d.heading.title.trim(),
      kind,
      scope,
      rule,
      why,
      ...(holdsWhile ? { holdsWhile } : {}),
      evidence: d.evidence,
      added,
      file,
      line: d.heading.line,
    });
  };

  content.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    if (ANY_HEADING.test(raw)) {
      finish();
      if (raw.startsWith("### ")) {
        const m = HEADING.exec(raw);
        if (m) draft = { heading: { id: m[1], title: m[2], line }, values: new Map(), evidence: [] };
        else problem(line, "entry heading must be `### <id> <title>` with a 7-character hex id");
      }
      return;
    }
    if (!draft || raw.trim() === "") return;
    const field = FIELD.exec(raw);
    if (field) {
      const name = field[1];
      if (!(FIELDS as readonly string[]).includes(name)) {
        problem(line, `unknown field "${name}"`);
        draft.current = undefined;
        return;
      }
      draft.current = name;
      if (draft.values.has(name)) problem(line, `field "${name}" appears twice`);
      draft.values.set(name, { text: field[2].trim(), line });
      return;
    }
    if (/^ {2}\S/.test(raw) && draft.current !== undefined) {
      const body = raw.trim();
      if (draft.current === "evidence") {
        if (body.startsWith("- ")) draft.evidence.push(body.slice(2).trim());
        else if (draft.evidence.length > 0) draft.evidence[draft.evidence.length - 1] += ` ${body}`;
        else problem(line, "evidence items start with `- `");
      } else {
        const prior = draft.values.get(draft.current)!;
        prior.text = `${prior.text} ${body}`.trim();
      }
      return;
    }
    problem(line, "unexpected line inside an entry");
  });
  finish();
  return { entries, problems };
}

export interface IndexRow {
  glob: string;
  file: string;
  line: number;
}

/** The rows of `index.md` that map a glob to an area file: table rows whose second cell names a `.md` file. */
export function parseIndexMap(content: string): IndexRow[] {
  const rows: IndexRow[] = [];
  content.split(/\r?\n/).forEach((raw, i) => {
    const t = raw.trim();
    if (!t.startsWith("|")) return;
    const cells = t.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim().replace(/^`+|`+$/g, "").trim());
    if (cells.length < 2 || !/\.md$/.test(cells[1]) || cells[0] === "") return;
    rows.push({ glob: cells[0], file: cells[1], line: i + 1 });
  });
  return rows;
}
