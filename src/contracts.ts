/**
 * Contracts: the answers a batch gives to the flow questions (spec 2026-10-31, decisions 1 and 2;
 * ADR 0009). One entry per question: what a new action or call does, which existing path does the
 * same, how the result reaches the user, what happens when it fails, with `file:line` citations.
 *
 * The engine owns two checks and nothing else: the entry has the right shape, and every citation
 * names a file that exists in the checked-out head with a line inside it. It never judges whether
 * the answer is true; a citation that does not resolve is a logged warning and
 * `evidence_checked: false` on the entry, which the review shows.
 *
 * This module does not import the engine (the engine imports it); rendering lives in the engine,
 * next to `neutralise`.
 */
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const CONTRACT_STATUSES = ["closed", "open"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export interface Contract {
  /** The new user action, screen state or call into unchanged code the entry is about. */
  action: string;
  /** `path:line` where the action lives. */
  location: string;
  /** The existing path that does the same thing. */
  equivalent_path?: string;
  /** What that path does before and after, and whether the new path does the same. */
  before_after?: string;
  /** How the result reaches what the user sees. */
  visible_effect?: string;
  /** What happens when it rejects, times out, never delivers or the sender is not who is expected. */
  failure_mode?: string;
  status: ContractStatus;
  /** `path:line` or `path:from-to`, repository-relative, for every claim in the entry. */
  evidence: string[];
  /** What could not be answered from the files read; for `open` entries. */
  open_question?: string;
  /** Files that would answer `open_question`. */
  candidates?: string[];
  /**
   * Set by the engine, never by the model: whether every citation in `evidence` resolved in the
   * head. `false` also for a `closed` entry that cites nothing. Absent means "not checked".
   */
  evidence_checked?: boolean;
}

/**
 * Part of the batch output schema. Every property is required, as the existing schema does for
 * findings, because a provider's strict structured-output mode (Codex) rejects optional ones: the
 * fields that do not apply are an empty string or an empty array, and `parseContracts` turns them
 * back into absent.
 */
export const CONTRACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "action",
    "location",
    "equivalent_path",
    "before_after",
    "visible_effect",
    "failure_mode",
    "status",
    "evidence",
    "open_question",
    "candidates",
  ],
  properties: {
    action: { type: "string" },
    location: { type: "string" },
    equivalent_path: { type: "string" },
    before_after: { type: "string" },
    visible_effect: { type: "string" },
    failure_mode: { type: "string" },
    status: { enum: [...CONTRACT_STATUSES] },
    evidence: { type: "array", items: { type: "string" } },
    open_question: { type: "string" },
    candidates: { type: "array", items: { type: "string" } },
  },
} as const;

const OPTIONAL_TEXT = ["equivalent_path", "before_after", "visible_effect", "failure_mode", "open_question"] as const;

/**
 * The entries of a batch's `contracts` that have the right shape. A malformed entry is dropped
 * with a warning: one bad entry must not cost the batch's findings. A missing `contracts` (a
 * provider that ignored the schema, or a review from before it existed) is an empty list.
 */
export function parseContracts(raw: unknown, warn: (line: string) => void): Contract[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    warn("The batch's contracts is not a list; ignored.");
    return [];
  }
  const out: Contract[] = [];
  for (const [i, item] of raw.entries()) {
    const problem = shapeProblem(item);
    if (problem) {
      warn(`Dropped contract #${i + 1}: ${problem}.`);
      continue;
    }
    const entry = item as Record<string, unknown>;
    const contract: Contract = {
      action: (entry.action as string).trim(),
      location: (entry.location as string).trim(),
      status: entry.status as ContractStatus,
      evidence: (entry.evidence as string[]).map((e) => e.trim()).filter(Boolean),
    };
    for (const key of OPTIONAL_TEXT) {
      const value = entry[key];
      if (typeof value === "string" && value.trim() !== "") contract[key] = value.trim();
    }
    if (Array.isArray(entry.candidates)) {
      const candidates = (entry.candidates as unknown[])
        .filter((c): c is string => typeof c === "string")
        .map((c) => c.trim())
        .filter(Boolean);
      if (candidates.length > 0) contract.candidates = candidates;
    }
    out.push(contract);
  }
  return out;
}

function shapeProblem(item: unknown): string | null {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return "not an object";
  const entry = item as Record<string, unknown>;
  for (const key of ["action", "location"] as const)
    if (typeof entry[key] !== "string" || (entry[key] as string).trim() === "") return `${key} is missing`;
  if (!(CONTRACT_STATUSES as readonly unknown[]).includes(entry.status))
    return `status is ${JSON.stringify(entry.status)}, not closed or open`;
  if (!Array.isArray(entry.evidence) || entry.evidence.some((e) => typeof e !== "string"))
    return "evidence is not a list of strings";
  for (const key of OPTIONAL_TEXT)
    if (entry[key] !== undefined && typeof entry[key] !== "string") return `${key} is not text`;
  if (entry.candidates !== undefined && !Array.isArray(entry.candidates)) return "candidates is not a list";
  return null;
}

/** How many lines the file at a repository-relative path has in the head, or null when it does not exist. */
export type LineCounter = (path: string) => number | null;

/** Files bigger than this are not read to count lines: a citation into one is not checked. */
const MAX_CITED_BYTES = 8 * 1024 * 1024;

/**
 * A `LineCounter` over the checked-out head at `repoDir`. A path that leaves the directory
 * (`..`, an absolute path elsewhere, a symlink pointing out) does not exist for it: the model
 * chooses these paths, and the engine must not read outside the head on its behalf.
 */
export function repoLineCounter(repoDir: string): LineCounter {
  let root: string;
  try {
    root = realpathSync(repoDir);
  } catch {
    return () => null;
  }
  return (path) => {
    if (path === "" || isAbsolute(path)) return null;
    try {
      const real = realpathSync(resolve(root, path));
      const rel = relative(root, real);
      if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
      const stat = statSync(real);
      if (!stat.isFile()) return null;
      if (stat.size > MAX_CITED_BYTES) return Number.MAX_SAFE_INTEGER;
      return countLines(readFileSync(real, "utf8"));
    } catch {
      return null;
    }
  };
}

/** `a\nb\n` has 2 lines, `a\nb` has 2, an empty file has 0. */
export function countLines(text: string) {
  if (text === "") return 0;
  const n = text.split("\n").length;
  return text.endsWith("\n") ? n - 1 : n;
}

/** `src/a.ts:12` or `src/a.ts:12-30`; a path may itself hold colons only before the last one. */
const CITATION = /^(.+):(\d+)(?:-(\d+))?$/;

/** The problem with one citation, or null when it names an existing file and a line inside it. */
export function citationProblem(citation: string, lines: LineCounter): string | null {
  const match = citation.match(CITATION);
  if (!match) return `${citation} is not path:line`;
  const [, path, fromText, toText] = match;
  const from = Number(fromText);
  const to = toText === undefined ? from : Number(toText);
  if (from < 1 || to < from) return `${citation} is not a valid line range`;
  const count = lines(path);
  if (count === null) return `${path} does not exist in the head`;
  if (to > count) return `${citation} is past the end of ${path} (${count} lines)`;
  return null;
}

/**
 * Checks every citation of every entry and sets `evidence_checked`. Each failing entry is one
 * warning naming the problems; nothing else changes: the entry keeps its status and text.
 */
export function checkContracts(
  contracts: Contract[],
  lines: LineCounter,
  warn: (line: string) => void,
): Contract[] {
  return contracts.map((c) => {
    const problems = c.evidence.map((e) => citationProblem(e, lines)).filter((p): p is string => p !== null);
    if (c.status === "closed" && c.evidence.length === 0) problems.push("closed without a citation");
    if (problems.length > 0) warn(`Contract "${c.action}": evidence not verified: ${problems.join("; ")}.`);
    return { ...c, evidence_checked: problems.length === 0 };
  });
}

const rank = (c: Contract) => (c.status === "open" ? 2 : c.evidence_checked === false ? 1 : 0);

/**
 * One entry per action and location across batches. Two batches may reach the same place from
 * different parts: the better answer is kept, a closed entry whose citations resolved over a
 * closed one whose did not, over an open one; on a tie, the first.
 */
export function mergeContracts(contracts: Contract[]): Contract[] {
  const kept = new Map<string, Contract>();
  for (const c of contracts) {
    const key = `${c.action.toLowerCase().replace(/\s+/g, " ")}\u0000${c.location.toLowerCase()}`;
    const old = kept.get(key);
    if (!old || rank(c) < rank(old)) kept.set(key, c);
  }
  return [...kept.values()];
}
