/**
 * Render the effective template as the Markdown that is installed, stamp it, and tell the state of
 * a file on disk (ADR 0052). Rendering is deterministic: the same catalog and choice give the same
 * bytes, so the stamp hash can tell a file someone edited from one that is merely out of date.
 */
import { createHash } from "node:crypto";
import { PrTemplateConfigError, loadRepoChoice, type Catalog, type CatalogEntry, type StatusRowEntry } from "./catalog";
import { resolveTemplate, type ResolvedTemplate } from "./resolve";

const STAMP_PREFIX = "wachiman:pr-template";
const STAMP = /^<!-- wachiman:pr-template version=(\d+) sha256=([0-9a-f]{64}) -->(?:\n|$)/;
const WRAP = 92;

export const sha256Hex = (text: string) => createHash("sha256").update(text).digest("hex");

/** The hash the stamp records: everything below the stamp line. */
export const stampHashOf = (body: string) => sha256Hex(body);

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

/** A guide comment as `<!-- text -->`, wrapped over several lines when it is long. */
function comment(text: string): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line !== "" && line.length + 1 + word.length > WRAP) {
      lines.push(line);
      line = word;
    } else {
      line = line === "" ? word : `${line} ${word}`;
    }
  }
  lines.push(line);
  return lines.map((l, i) => `${i === 0 ? "<!-- " : "     "}${l}${i === lines.length - 1 ? " -->" : ""}`);
}

function statusRows(rows: StatusRowEntry[]): string[] {
  return [
    "| | |",
    "|---|---|",
    ...rows.map((r) => `| **${r.label}** | ${r.guide === undefined ? "" : `<!-- ${r.guide.trim()} -->`} |`),
  ];
}

function entryLines(e: CatalogEntry): string[] {
  const guide = e.guide === undefined ? [] : comment(e.guide);
  switch (e.kind) {
    case "section":
      return [`## ${e.heading}`, ...guide, ...e.body];
    case "details":
      return [`<details><summary><b>${e.summary}</b>${e.summarySuffix}</summary>`, "", ...guide, ...e.body, "", "</details>"];
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
  if (rows.length > 0) blocks.push(statusRows(rows));
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
  return { state: file === expected ? "current" : "outdated", version, installedVersion };
}
