/**
 * Memory candidates kept on the laptop (spec decisions 6 and 7). A candidate is an entry somebody
 * drafted, with the evidence for it. It lives under the Wachiman home, per repository, keyed like the
 * local history, and becomes repository memory only through `wachiman memory propose`.
 *
 * The id is the entry digest (`entryId`), so a candidate is the exact text the developer is shown:
 * `renderEntry` produces that text, `show` prints it and `propose` writes it. Evidence and the added
 * date are not part of the id, so evidence can grow without changing what was approved.
 *
 * Reactions and silence are never evidence; there is no source for them.
 */
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";
import { UsageError } from "../config";
import { loopFiles, readVerdicts } from "../history/store";
import { entryId, parseMemoryFile, type MemoryKind } from "./entries";
import { matchesGlob } from "./load";

export const CANDIDATE_FORMAT = "wachiman.memory-candidate/1";

export type EvidenceSource = "instruction" | "judged" | "fixed";
export const EVIDENCE_SOURCES: readonly EvidenceSource[] = ["instruction", "judged", "fixed"];

const SOURCE_LABEL: Record<EvidenceSource, string> = {
  instruction: "operator instruction",
  judged: "finding judged wrong or intentional",
  fixed: "finding fixed",
};

export interface Evidence {
  /** `YYYY-MM-DD`. */
  date: string;
  source: EvidenceSource;
  /** The pull request it came from, or else the branch (a laptop review has no pull request number). */
  pr?: number;
  branch?: string;
  /** An agent wrote the reply or the instruction on the owner's behalf (spec open question 1). */
  agent: boolean;
  /** The local history id of the finding, for `judged` and `fixed`. Never written into the repository. */
  finding?: string;
}

export interface Candidate {
  format: typeof CANDIDATE_FORMAT;
  id: string;
  title: string;
  kind: MemoryKind;
  scope: string;
  rule: string;
  why: string;
  holdsWhile?: string;
  /** `YYYY-MM-DD` of the first sighting; it is the entry's `added` line. */
  added: string;
  evidence: Evidence[];
  proposed?: { at: string };
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();
export const today = (now: Date = new Date()) => now.toISOString().slice(0, 10);

const refKey = (e: Evidence) => (e.pr !== undefined ? `pr:${e.pr}` : `branch:${e.branch ?? ""}`);
const evidenceKey = (e: Evidence) => `${e.source}|${refKey(e)}|${e.finding ?? ""}`;

/** The evidence line as it is written in the entry. */
export function evidenceLine(e: Evidence): string {
  const ref = e.pr !== undefined ? `pull request ${e.pr}` : `branch ${squash(e.branch ?? "")}`;
  return `${e.date} ${SOURCE_LABEL[e.source]}, ${ref}${e.agent ? ", written by an agent" : ""}`;
}

export interface EntryFields {
  kind: string;
  scope: string;
  rule: string;
  why: string;
  holdsWhile?: string;
  title?: string;
}

const MAX_TITLE = 80;
const defaultTitle = (rule: string) => {
  const t = squash(rule);
  return t.length <= MAX_TITLE ? t : `${t.slice(0, MAX_TITLE - 1).trimEnd()}…`;
};

/** The exact text of the entry: what `show` prints and `propose` writes. Ends with one newline. */
export function renderEntry(c: Candidate): string {
  const lines = [
    `### ${c.id} ${squash(c.title)}`,
    "",
    `- kind: ${c.kind}`,
    `- scope: ${squash(c.scope)}`,
    `- rule: ${squash(c.rule)}`,
    `- why: ${squash(c.why)}`,
    ...(c.holdsWhile ? [`- holds while: ${squash(c.holdsWhile)}`] : []),
    "- evidence:",
    ...c.evidence.map((e) => `  - ${evidenceLine(e)}`),
    `- added: ${c.added}`,
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * Characters a terminal acts on or a reader cannot see: control characters (an escape sequence can
 * rewrite what `show` appears to print), zero-width, direction-changing and other format characters (category Cf, line and paragraph separators, variation selectors, filler characters). Whitespace is
 * already folded away by `squash`, so none of these is legitimate in an entry.
 */
const UNSAFE_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u034F\u115F\u1160\u3164\uFFA0\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/u;

/**
 * Why `c` cannot be shown and committed as the same bytes, or undefined when it can: a character the
 * terminal would interpret, an id that is not the digest of the fields, or text that does not read
 * back as exactly this one entry (the text `propose` writes is what `memory check` must accept).
 */
export function candidateProblem(c: Candidate): string | undefined {
  const texts: [string, string | undefined][] = [
    ["title", c.title],
    ["kind", c.kind],
    ["scope", c.scope],
    ["rule", c.rule],
    ["why", c.why],
    ["holds while", c.holdsWhile],
    ["added", c.added],
    ...c.evidence.flatMap((e, i): [string, string | undefined][] => [[`evidence ${i + 1} date`, e.date], [`evidence ${i + 1} branch`, e.branch]]),
  ];
  for (const [name, value] of texts) {
    const bad = value === undefined ? undefined : UNSAFE_CHARACTER.exec(value);
    if (bad) {
      const code = (bad[0].codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0");
      return `The ${name} holds the control or invisible character U+${code}, which a terminal would not show as written; remove it.`;
    }
  }
  const digest = entryId({ kind: c.kind, scope: c.scope, rule: c.rule, why: c.why, ...(c.holdsWhile ? { holdsWhile: c.holdsWhile } : {}) });
  if (digest !== c.id) return `The id ${c.id} is not the digest ${digest} of the entry's fields, so the text shown would not be the text recorded.`;
  const parsed = parseMemoryFile("index.md", renderEntry(c));
  if (parsed.problems.length > 0 || parsed.entries.length !== 1 || parsed.entries[0].id !== c.id) {
    return `The entry does not read back as one valid memory entry (${parsed.problems[0]?.message ?? "unreadable"}).`;
  }
  return undefined;
}

/** A new candidate from entry fields and its first evidence. Throws a `UsageError` for a field the format cannot carry. */
export function newCandidate(fields: EntryFields, first: Evidence, date: string): Candidate {
  const need = (name: string, value: string | undefined) => {
    if (value === undefined || squash(value) === "") throw new UsageError(`The entry needs a ${name}.`);
    return squash(value);
  };
  const kind = need("kind", fields.kind);
  if (kind !== "convention" && kind !== "exception") throw new UsageError(`kind must be "convention" or "exception", got "${kind}".`);
  const scope = need("scope", fields.scope);
  const rule = need("rule", fields.rule);
  const why = need("why (the reason an owner gave)", fields.why);
  const holdsWhile = fields.holdsWhile !== undefined && squash(fields.holdsWhile) !== "" ? squash(fields.holdsWhile) : undefined;
  const id = entryId({ kind, scope, rule, why, ...(holdsWhile ? { holdsWhile } : {}) });
  const title = squash(fields.title ?? "") || defaultTitle(rule);
  const candidate: Candidate = {
    format: CANDIDATE_FORMAT,
    id,
    title,
    kind,
    scope,
    rule,
    why,
    ...(holdsWhile ? { holdsWhile } : {}),
    added: date,
    evidence: [first],
  };
  const problem = candidateProblem(candidate);
  if (problem) throw new UsageError(problem);
  return candidate;
}

/** `candidate` with `more` evidence added once: the same source, reference and finding is not counted twice. */
export function withEvidence(candidate: Candidate, more: Evidence[]): Candidate {
  const seen = new Set(candidate.evidence.map(evidenceKey));
  const added: Evidence[] = [];
  for (const e of more) {
    if (seen.has(evidenceKey(e))) continue;
    seen.add(evidenceKey(e));
    added.push(e);
  }
  return { ...candidate, evidence: [...candidate.evidence, ...added] };
}

export interface Proposability {
  proposable: boolean;
  /** Evidence that counts for this kind of entry. */
  counted: number;
  /** Distinct pull requests or branches among it. */
  distinct: number;
  needed: number;
  /** Why not, when it is not proposable. */
  why?: string;
}

/**
 * Spec decision 6: an explicit instruction is enough alone; a finding judged wrong or intentional, or
 * fixed, needs `minEvidence` pieces from different pull requests or branches; a fix supports only a
 * convention.
 */
export function proposability(c: Candidate, minEvidence: number): Proposability {
  const eligible = c.evidence.filter((e) => e.source !== "fixed" || c.kind === "convention");
  const distinct = new Set(eligible.map(refKey)).size;
  const base = { counted: eligible.length, distinct, needed: minEvidence };
  if (eligible.some((e) => e.source === "instruction")) return { ...base, proposable: true };
  if (distinct >= minEvidence) return { ...base, proposable: true };
  const ignored = c.evidence.length - eligible.length;
  const why = `needs evidence from ${minEvidence} different pull requests or branches, has ${distinct}${ignored > 0 ? "; a fix supports only a convention, so it does not count for an exception" : ""}`;
  return { ...base, proposable: false, why };
}

const ID = /^[0-9a-f]{7}$/;

/** `<home>/memory-candidates/<repo key>`; the key is `repositoryKey(repoDir).key`. */
export const candidatesDir = (home: string, key: string) => join(home, "memory-candidates", key);

function privateDirs(...dirs: string[]) {
  for (const dir of dirs) {
    if (existsSync(dir)) continue;
    mkdirSync(dir, { mode: 0o700 });
    chmodSync(dir, 0o700);
  }
}

const LOCK_WAIT_MS = 5_000;
const LOCK_STALE_MS = 30_000;

/**
 * Runs `fn` while holding a lock on one candidate, so two runs that read, change and write the same
 * candidate (`add` with new evidence, the `proposed` mark of `propose`) cannot drop each other's
 * change. The lock is a directory made with `mkdir`, which is atomic; one left by a run that died is
 * taken over after 30 seconds. Waiting longer than 5 seconds is a usage error, never a silent write.
 */
export function withCandidateLock<T>(home: string, key: string, id: string, fn: () => T): T {
  const dir = candidatesDir(home, key);
  privateDirs(home, join(home, "memory-candidates"), dir);
  const lock = join(dir, `${id}.lock`);
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      mkdirSync(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) rmSync(lock, { recursive: true, force: true });
      } catch {
        // Released between the two calls: try again.
      }
      if (Date.now() > deadline) throw new UsageError(`Another wachiman memory command is changing candidate ${id}; try again in a moment.`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

export function writeCandidate(home: string, key: string, c: Candidate): void {
  const dir = candidatesDir(home, key);
  privateDirs(home, join(home, "memory-candidates"), dir);
  const path = join(dir, `${c.id}.json`);
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, "w", 0o600);
  try {
    writeSync(fd, `${JSON.stringify(c, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

function validCandidate(v: any): v is Candidate {
  return (
    v &&
    typeof v === "object" &&
    v.format === CANDIDATE_FORMAT &&
    typeof v.id === "string" &&
    ID.test(v.id) &&
    typeof v.title === "string" &&
    (v.kind === "convention" || v.kind === "exception") &&
    typeof v.scope === "string" &&
    typeof v.rule === "string" &&
    typeof v.why === "string" &&
    (v.holdsWhile === undefined || typeof v.holdsWhile === "string") &&
    typeof v.added === "string" &&
    Array.isArray(v.evidence) &&
    v.evidence.every((e: any) => e && EVIDENCE_SOURCES.includes(e.source) && typeof e.date === "string" && typeof e.agent === "boolean" && (typeof e.pr === "number" || typeof e.branch === "string"))
  );
}

/** The candidate with this id, or undefined. A malformed id is a usage error: it never reaches a path. */
export function readCandidate(home: string, key: string, id: string): Candidate | undefined {
  if (!ID.test(id)) throw new UsageError(`"${id}" is not a memory entry id (seven hex characters).`);
  const path = join(candidatesDir(home, key), `${id}.json`);
  if (!existsSync(path)) return undefined;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new UsageError(`cannot read ${path} (${error instanceof Error ? error.message : error}); check its permissions.`);
  }
  try {
    const parsed = JSON.parse(text);
    if (validCandidate(parsed) && parsed.id === id) {
      const problem = candidateProblem(parsed);
      if (problem) throw new UsageError(`${path}: ${problem}`);
      return parsed;
    }
  } catch (error) {
    if (error instanceof UsageError) throw error;
    // fall through
  }
  throw new UsageError(`${path} is not a memory candidate; remove it to start that candidate again.`);
}

/** Every readable candidate of the repository, by id. A file that is not a candidate is skipped. */
export function readCandidates(home: string, key: string): Candidate[] {
  const dir = candidatesDir(home, key);
  if (!existsSync(dir)) return [];
  const out: Candidate[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!/^[0-9a-f]{7}\.json$/.test(name)) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(dir, name), "utf8"));
      if (validCandidate(parsed)) out.push(parsed);
    } catch {
      // not a candidate
    }
  }
  return out;
}

/**
 * The evidence a finding in the local loop history supports, checked against the history rather than
 * taken on trust: `judged` needs a `wrong` verdict with a reason; `fixed` needs the loop to have marked
 * the finding probably fixed. The reference is `pr` when given, else the branch of the loop that saw it.
 */
export function evidenceFromFinding(key: string, historyRoot: string, finding: string, source: "judged" | "fixed", opts: { pr?: number; agent: boolean; date: string }): Evidence {
  let found: { branch: string; status: string } | undefined;
  for (const path of loopFiles(historyRoot, key)) {
    try {
      const state = JSON.parse(readFileSync(path, "utf8"));
      const entry = Array.isArray(state?.ledger) ? state.ledger.find((e: any) => e?.id === finding) : undefined;
      if (entry && typeof state.branch === "string") {
        found = { branch: state.branch, status: String(entry.status) };
        if (source === "fixed" ? entry.status === "probably-fixed" : true) break;
      }
    } catch {
      // an unreadable loop file is not evidence
    }
  }
  if (!found) throw new UsageError(`No finding ${finding} in the loop history of this repository; run \`wachiman history\` to list the ids.`);
  if (source === "judged") {
    const verdict = readVerdicts(historyRoot, key).get(finding);
    if (verdict?.verdict !== "wrong" || !verdict.reason?.trim()) {
      throw new UsageError(`Finding ${finding} has no verdict "wrong" with a reason; record one first: wachiman history --verdict ${finding} wrong --reason "<why>".`);
    }
  } else if (found.status !== "probably-fixed") {
    throw new UsageError(`The loop did not mark finding ${finding} as fixed (its status is ${found.status}), so it is not evidence.`);
  }
  return { date: opts.date, source, ...(opts.pr !== undefined ? { pr: opts.pr } : { branch: found.branch }), agent: opts.agent, finding };
}

/**
 * Proposable candidates relevant to a loop round: one cites a finding of the round's ledger, or its
 * scope matches the path of one. Never throws: the round's report does not depend on memory.
 */
export function candidatesForRound(home: string, key: string, minEvidence: number, ledger: { id: string; path: string }[]): { id: string; title: string }[] {
  try {
    const ids = new Set(ledger.map((e) => e.id));
    return readCandidates(home, key)
      .filter((c) => !c.proposed && proposability(c, minEvidence).proposable)
      .filter((c) => c.evidence.some((e) => e.finding !== undefined && ids.has(e.finding)) || ledger.some((e) => matchesGlob(c.scope, e.path)))
      .map((c) => ({ id: c.id, title: c.title }));
  } catch {
    return [];
  }
}
