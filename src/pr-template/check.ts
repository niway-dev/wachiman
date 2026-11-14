/**
 * Checks a PR description against a resolved template (ADR 0050, 0051). The rules are those of the
 * earlier Python checker, and its finding codes are kept. What changed is where the lists come
 * from: headings, status rows, collapsed blocks and their order come from the template, and the
 * locked entries (the Risk row, `## Needs you`, the Wachiman block and the footer) come from the
 * catalog, so a repository's `.github/pr-template.json` can never remove them.
 *
 * `breaking-change` and `adr-bare-number` are not template rules: they run on every description.
 * This checks structure, not truth.
 *
 * The inside of the Wachiman block is Wachiman's own text (a grade, a table, `<details>` with
 * plain summaries), so the structural rules do not read it; `breaking-change` does, because a
 * squash merge copies the whole body.
 */
import { loadCatalog, type Catalog, type CatalogEntry, type DetailsEntry, type FooterEntry, type SectionEntry, type StatusRowEntry } from "./catalog";
import { parseDescription, type ParsedDescription } from "./describe";
import { computeRisk, LEVELS, type ChangedFile, type Risk, type RiskExtension, type RiskLevel } from "./pr-risk";
import type { ResolvedTemplate } from "./resolve";

export const FINDING_CODES = [
  "heading-missing",
  "heading-order",
  "heading-unknown",
  "section-missing",
  "status-row-missing",
  "needs-you-empty",
  "adr-bare-number",
  "breaking-change",
  "risk-unstated",
  "risk-unverified",
  "risk-below-floor",
  "footer-missing",
  "footer-head-mismatch",
  "block-missing",
  "details-unknown",
  "details-order",
  "changes-too-many-rows",
] as const;
export type FindingCode = (typeof FINDING_CODES)[number];

export interface Finding {
  code: FindingCode;
  message: string;
  /** 1-based line in the description, when the finding points at one. */
  line?: number;
}

export interface CheckResult {
  ok: boolean;
  findings: Finding[];
}

export interface CheckInput {
  /** The description. Null or empty is a description with nothing in it. */
  body: string | null | undefined;
  /** The PR title; used only for the `!` breaking marker. */
  title?: string | null;
  /** The head commit. Missing skips the footer comparison (the footer must still exist). */
  head?: string | null;
  /** The effective template of the repository. */
  template: ResolvedTemplate;
  /** Where the locked entries come from. Default: the shipped catalog. */
  catalog?: Catalog;
  /** The changed files. With them the risk floor is computed here. */
  files?: readonly ChangedFile[];
  /** Parsed `.github/pr-risk.toml`, used with `files`. */
  riskExtension?: RiskExtension | null;
  /** A floor computed elsewhere (a level or a Risk); wins over `files`. Null skips the comparison. */
  risk?: Risk | RiskLevel | null;
  /** Why the floor could not be computed. It fails the check unless Risk is stated High. */
  riskError?: string | null;
  /** Commit messages of the PR, scanned for the breaking-change marker. */
  commitMessages?: readonly string[];
  /** Pass only when the owner asked for a breaking change. */
  allowBreaking?: boolean;
}

// --------------------------------------------------------------------------- patterns

const ADR_REF = /\bADRs?[ -]?#?\d+\b/i;
const LINK = /\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/g;
const FENCE_BLOCK = /^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?^[ \t]*\1[^\n]*$/gm;
const BREAKING = /BREAKING[ -]CHANGE/;
const BANG_TITLE = /^[a-z]+(\([^)]*\))?!:/i;

/** The letters left once ADR numbers and everything that is not a letter are gone. */
const letters = (text: string) => text.replace(new RegExp(ADR_REF.source, "gi"), "").replace(/[^\p{L}]+/gu, "");

/** Mentions of an ADR by number alone: a link whose only text is the number still counts. */
export function bareAdrMentions(input: string): string[] {
  let text = input.replace(FENCE_BLOCK, "");
  text = text.replace(LINK, (_whole, label: string) => (ADR_REF.test(label) && letters(label) === "" ? label : " "));
  text = text.replace(/https?:\/\/\S+/g, " ");
  return [...text.matchAll(new RegExp(ADR_REF.source, "gi"))].map((m) => m[0]);
}

/** Data rows of the first Markdown table in `text`: the rows after its separator line. */
export function tableRows(text: string): string[] {
  const rows = text.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("|"));
  const sep = rows.findIndex((l) => /^\|[\s:|-]+\|?$/.test(l) && l.includes("-"));
  return sep === -1 ? rows.slice(1) : rows.slice(sep + 1);
}

function splitCells(row: string): string[] {
  let cells = row.trim().split(/(?<!\\)\|/);
  if (cells.length > 0 && cells[0]!.trim() === "") cells = cells.slice(1);
  if (cells.length > 0 && cells[cells.length - 1]!.trim() === "") cells = cells.slice(0, -1);
  return cells.map((c) => c.trim());
}

const quote = (text: string) => JSON.stringify(text.slice(0, 40));

function decisionRecordProblems(decisions: string): string[] {
  const lines = decisions.split("<details")[0]!.split("\n").filter((l) => l.trim().startsWith("|"));
  if (lines.length === 0) return [];
  const header = splitCells(lines[0]!).map((c) => c.toLowerCase());
  const col = header.includes("record") ? header.indexOf("record") : 2;
  const problems: string[] = [];
  for (const row of tableRows(lines.join("\n"))) {
    const cells = splitCells(row);
    const cell = cells[col] ?? "";
    if (/^(none|n\/a|-|—|)$/i.test(cell.trim())) continue;
    const links = [...cell.matchAll(LINK)];
    if (links.length === 0) problems.push(`the Record cell ${quote(cell)} has no link`);
    else if (!links.some((l) => letters(l[1]!) !== "")) problems.push(`the Record cell ${quote(cell)} links with only a number as text`);
  }
  return problems;
}

function statedLevel(text: string): number | null {
  const m = /🟢|🟡|🔴|\b(low|medium|high)\b/i.exec(text);
  if (!m) return null;
  const token = m[0];
  const i = LEVELS.findIndex(([emoji, name]) => token === emoji || token.toLowerCase() === name.toLowerCase());
  return i === -1 ? null : i;
}

const levelOf = (risk: Risk | RiskLevel): number => (typeof risk === "number" ? risk : risk.level);

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The words before `{sha}` in the footer text, then a 7 to 40 character hex sha, backticks optional. */
function footerPattern(entry: FooterEntry): RegExp {
  const prefix = entry.text.slice(0, entry.text.indexOf("{sha}")).trim() || "Describes commit";
  const words = prefix.split(/\s+/).map(escapeRegex).join("\\s+");
  return new RegExp(`${words}\\s+\`?([0-9a-fA-F]{7,40})\`?`);
}

// --------------------------------------------------------------------------- the template

/**
 * The template with its locked entries taken from the catalog: one the template lacks is put back
 * where the catalog has it, and one it carries is replaced by the catalog's version.
 */
export function withLockedFromCatalog(template: ResolvedTemplate, catalog: Catalog): ResolvedTemplate {
  const locked = new Map(catalog.sections.filter((e) => e.locked).map((e) => [e.id, e]));
  const sections: CatalogEntry[] = template.sections.map((e) => locked.get(e.id) ?? e);
  const have = new Set(sections.map((e) => e.id));
  for (const entry of locked.values()) {
    if (have.has(entry.id)) continue;
    const later = new Set(catalog.sections.slice(catalog.sections.indexOf(entry) + 1).map((e) => e.id));
    const at = sections.findIndex((e) => later.has(e.id));
    sections.splice(at === -1 ? sections.length : at, 0, entry);
  }
  return { ...template, sections };
}

const isRequired = (e: CatalogEntry) => e.required || e.locked;

// --------------------------------------------------------------------------- the check

export function checkDescription(input: CheckInput): CheckResult {
  const catalog = input.catalog ?? loadCatalog();
  const template = withLockedFromCatalog(input.template, catalog);
  const findings: Finding[] = [];
  const add = (code: FindingCode, message: string, line?: number) => findings.push(line === undefined ? { code, message } : { code, message, line: line + 1 });

  const raw = input.body ?? "";
  const parsed: ParsedDescription = parseDescription(raw);

  const statusEntries = template.sections.filter((e): e is StatusRowEntry => e.kind === "status-row");
  const sectionEntries = template.sections.filter((e): e is SectionEntry => e.kind === "section");
  const detailsEntries = template.sections.filter((e): e is DetailsEntry => e.kind === "details");
  const footerEntry = template.sections.find((e): e is FooterEntry => e.kind === "footer")!;
  const hasNotes = detailsEntries.some((e) => e.id === "notes");
  const moveHint = hasNotes ? "move its content into Notes or one of the template's sections" : "move its content into one of the template's sections";

  // headings
  const allowedHeadings = sectionEntries.map((e) => e.heading);
  const names = parsed.headings.map((h) => h.name);
  for (const e of sectionEntries) {
    if (!isRequired(e) || names.includes(e.heading)) continue;
    if (e.custom) add("section-missing", `the description has no \`## ${e.heading}\` section; the repository's template requires it`);
    else add("heading-missing", `the description has no \`## ${e.heading}\` heading; it is required in every description`);
  }
  const known = names.filter((n) => allowedHeadings.includes(n));
  const idx = known.map((n) => allowedHeadings.indexOf(n));
  if (idx.some((b, i) => i > 0 && b <= idx[i - 1]!)) {
    add("heading-order", `the \`##\` headings are ${known.join(", ")}; each must appear once, in the order ${allowedHeadings.join(", ")}`);
  }
  for (const h of parsed.headings) {
    if (!allowedHeadings.includes(h.name)) add("heading-unknown", `\`## ${h.name}\` is not a heading of this template; ${moveHint}`, h.line);
  }

  // status table
  const rows = new Map<string, string>();
  for (const r of parsed.statusRows) if (!rows.has(r.label)) rows.set(r.label, r.value);
  for (const e of statusEntries) {
    if (isRequired(e) && !rows.has(e.label)) {
      add("status-row-missing", `the status table has no ${e.label} row; add \`| **${e.label}** | ... |\` (None if empty)`);
    }
  }

  // sections that must not be empty (Needs you)
  for (const e of sectionEntries) {
    if (e.rule !== "not-empty") continue;
    const section = parsed.sections.find((s) => s.name === e.heading);
    if (!section) continue;
    let text = section.clean.split("<details")[0]!;
    text = text.replace(/^\s*[-*]\s*\[[ xX]?\]\s*$/gm, "");
    text = text.replace(/\*\*(Before|After) merge:?\*\*:?/g, "");
    if (text.trim() === "") {
      add("needs-you-empty", `\`## ${e.heading}\` is empty; list the owner's actions as checkboxes, or write "Nothing. Merge when checks are green."`);
    }
  }

  // an ADR cited by number
  for (const mention of bareAdrMentions(parsed.structural)) {
    add("adr-bare-number", `"${mention}" cites an ADR by number; say what it decides and link it, for example [One PR description template](../adr/0033-....md)`);
  }
  const decisions = sectionEntries.find((e) => e.id === "decisions");
  const decisionsSection = decisions && parsed.sections.find((s) => s.name === decisions.heading);
  if (decisionsSection) {
    for (const problem of decisionRecordProblems(decisionsSection.clean)) {
      add("adr-bare-number", `in \`## ${decisions!.heading}\`, ${problem}; write the ADR title as the link text`);
    }
  }

  // the breaking-change marker, comments included
  if (!input.allowBreaking) {
    const fix = "remove it, or pass --allow-breaking only if the owner asked for a breaking change";
    const title = input.title ?? "";
    if (BANG_TITLE.test(title)) add("breaking-change", `the title ${JSON.stringify(title)} has a \`!\` (the conventional-commit breaking marker); ${fix}`);
    if (BREAKING.test(raw)) {
      add("breaking-change", `the body contains the breaking-change footer text (comments count: a squash merge copies them into the commit); ${fix}`);
    }
    (input.commitMessages ?? []).forEach((msg, i) => {
      if (BREAKING.test(msg ?? "")) {
        add("breaking-change", `commit message ${i + 1} contains the breaking-change footer text; reword the commit, or pass --allow-breaking only if the owner asked`);
      }
    });
  }

  // the risk row against the computed floor
  const riskEntry = statusEntries.find((e) => e.rule === "risk-floor");
  let computed: Risk | RiskLevel | null = input.risk === undefined ? null : input.risk;
  if (input.risk === undefined && input.files !== undefined) computed = computeRisk(input.files, input.riskExtension);
  if (riskEntry && rows.has(riskEntry.label)) {
    const stated = statedLevel(rows.get(riskEntry.label)!);
    if (stated === null) {
      add("risk-unstated", `the ${riskEntry.label} row has no level; start it with 🟢 Low, 🟡 Medium or 🔴 High`);
    } else if (computed === null && input.riskError && stated < LEVELS.length - 1) {
      add("risk-unverified", `the risk floor could not be computed (${input.riskError}); fix the cause (a reachable --base for a file, a working gh for --pr)`);
    } else if (computed !== null && stated < levelOf(computed)) {
      const why = typeof computed !== "number" && computed.rule ? ` (${computed.rule})` : "";
      add("risk-below-floor", `the ${riskEntry.label} row says ${LEVELS[stated]![1]} but \`wachiman pr-template risk\` computes ${LEVELS[levelOf(computed)]![1]}${why}; raise it, an author may only raise the level`);
    }
  }

  // footer
  let sha: string | null = null;
  const footerRe = footerPattern(footerEntry);
  for (const sub of parsed.subs) {
    const m = footerRe.exec(sub.text);
    if (m) {
      sha = m[1]!;
      break;
    }
  }
  if (sha === null) {
    add("footer-missing", `the footer has no commit sha; keep the footer line of the template and replace the {sha} placeholder with the real commit (7 or more hex characters)`);
  } else if (input.head) {
    const head = input.head.toLowerCase();
    const found = sha.toLowerCase();
    const matches = head.startsWith(found) || (head.length < 40 && found.startsWith(head));
    if (!matches) add("footer-head-mismatch", `the footer describes commit ${sha.slice(0, 12)} but the head is ${input.head.slice(0, 12)}; rewrite the description against the head and update the sha`);
  }

  // the Wachiman block
  if (template.sections.some((e) => e.kind === "block") && parsed.blocks.length === 0) {
    const block = template.sections.find((e) => e.kind === "block") as Extract<CatalogEntry, { kind: "block" }>;
    add("block-missing", `the description has no Wachiman block; keep both markers, ${block.start} and ${block.end}, from the template`);
  }

  // collapsed blocks
  const allowedDetails = detailsEntries.map((e) => e.summary);
  const present: string[] = [];
  for (const d of parsed.details) {
    if (d.name === null) {
      add("details-unknown", `a collapsed block has no bold title in its summary; use one of ${allowedDetails.join(", ")}, or put the text in ${hasNotes ? "Notes" : "a section"}`, d.startLine);
    } else if (!allowedDetails.includes(d.name)) {
      add("details-unknown", `the collapsed block "${d.name}" is not allowed; use one of ${allowedDetails.join(", ")}, or put the text in ${hasNotes ? "Notes" : "a section"}`, d.startLine);
    } else {
      present.push(d.name);
    }
  }
  const didx = present.map((n) => allowedDetails.indexOf(n));
  if (didx.some((b, i) => i > 0 && b <= didx[i - 1]!)) {
    add("details-order", `the collapsed blocks are ${present.join(", ")}; each must appear once, in the order ${allowedDetails.join(", ")}`);
  }
  for (const e of detailsEntries) {
    if (isRequired(e) && !parsed.details.some((d) => d.name === e.summary)) {
      add("section-missing", `the description has no "${e.summary}" collapsed block; the template requires it`);
    }
    const max = /^max-rows:(\d+)$/.exec(e.rule ?? "");
    if (!max) continue;
    const block = parsed.details.find((d) => d.name === e.summary);
    if (!block) continue;
    const n = tableRows(block.clean).length;
    if (n > Number(max[1])) add("changes-too-many-rows", `the ${e.summary} table has ${n} rows; group them down to at most ${max[1]}`);
  }

  return { ok: findings.length === 0, findings };
}
