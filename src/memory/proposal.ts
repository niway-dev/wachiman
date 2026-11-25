/**
 * The memory proposal a thread reply carries (layer 5, spec decisions 9 and 10).
 *
 * A reply that proposes an entry shows its exact text and its id inside two markers the engine writes
 * (model text is neutralised, so no model can write them). The operator approves that text with
 * `/wachiman remember <id>`; the write job reads the text back from the reply, checks that its digest
 * is the id it was asked for, and commits that text with the layer 3 write path. This file is pure:
 * it formats and parses, and it never reads or writes anything.
 */
import { candidateProblem, parseEvidenceLine, renderEntry, type Candidate, type Evidence } from "./candidates";
import { parseMemoryFile } from "./entries";

/** Written on the reply that confirms or refuses a `/wachiman remember`. Not the thread-reply signature, so it does not count toward the two-reply cap (spec decision 10). */
export const REMEMBER_SIGNATURE = "<!-- wachi:remember -->";

const OPEN = (id: string) => `<!-- wachi:memory id=${id} -->`;
const CLOSE = "<!-- /wachi:memory -->";

/** A fence longer than any run of backticks in `text`, so the text cannot end its own block. */
const fenceFor = (text: string) => "`".repeat(Math.max(3, ...(text.match(/`+/g) ?? []).map((run) => run.length + 1)));

/** The part of a reply that proposes `c`: the entry as it will be written, its id and how to approve it. */
export function renderProposal(c: Candidate, mention: string): string {
  const text = renderEntry(c).trimEnd();
  const fence = fenceFor(text);
  return [
    `**Proposed memory entry** \`${c.id}\`. Nothing is recorded yet. This is the exact text that would be written:`,
    "",
    OPEN(c.id),
    `${fence}markdown`,
    text,
    fence,
    CLOSE,
    "",
    `To record exactly this text, the operator replies \`${mention} remember ${c.id}\` in this thread. It becomes one commit on the branch \`wachiman/memory\` in a draft pull request, and it is not active until a person merges that pull request.`,
  ].join("\n");
}

export interface ShownProposal {
  id: string;
  text: string;
}

const BLOCK = /<!-- wachi:memory id=([0-9a-f]{7}) -->\n(`{3,})markdown\n([\s\S]*?)\n\2\n<!-- \/wachi:memory -->/g;

/** The proposals between the engine's markers in a comment body, in order. */
export function proposalsIn(body: string): ShownProposal[] {
  return [...body.matchAll(BLOCK)].map((m) => ({ id: m[1], text: m[3].trimEnd() }));
}

export interface FromShown {
  candidate?: Candidate;
  /** Why nothing may be written, when there is no candidate. */
  problem?: string;
}

/**
 * The candidate whose text is `text`, for the id the operator approved. Nothing is trusted: the text
 * must be exactly one entry, its heading id must be the digest of its fields (which `memory check`
 * also requires), that id must be the one asked for, its evidence must be lines the engine writes,
 * and rendering the rebuilt candidate must give `text` back, byte for byte. A candidate that passes is
 * the text that was shown, so the commit carries the digest the operator approved.
 */
export function candidateFromShown(text: string, id: string): FromShown {
  const parsed = parseMemoryFile("index.md", text);
  if (parsed.problems.length > 0)
    return { problem: `the shown text is not a valid entry (${parsed.problems[0].message}); its digest does not match ${id}.` };
  if (parsed.entries.length !== 1) return { problem: `the shown text holds ${parsed.entries.length} entries, not one.` };
  const entry = parsed.entries[0];
  if (entry.id !== id) return { problem: `the shown text has the digest ${entry.id}, not ${id}.` };
  const evidence: Evidence[] = [];
  for (const line of entry.evidence) {
    const e = parseEvidenceLine(line);
    if (!e) return { problem: `its evidence line "${line}" is not one this tool writes.` };
    evidence.push(e);
  }
  const candidate: Candidate = {
    format: "wachiman.memory-candidate/1",
    id: entry.id,
    title: entry.title,
    kind: entry.kind,
    scope: entry.scope,
    rule: entry.rule,
    why: entry.why,
    ...(entry.holdsWhile ? { holdsWhile: entry.holdsWhile } : {}),
    added: entry.added,
    evidence,
  };
  const problem = candidateProblem(candidate);
  if (problem) return { problem };
  if (renderEntry(candidate).trimEnd() !== text.trimEnd()) return { problem: "the shown text would not be written as shown." };
  return { candidate };
}
