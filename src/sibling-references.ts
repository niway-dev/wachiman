/**
 * The check on references into a sibling (ADR 0043 decision 3). A finding on the reviewed head names
 * the sibling location that is its evidence as `member@sha:path:line`. The reference survives only if
 * `member` is a sibling this run read, `sha` is a prefix (7 characters or more) of that snapshot's
 * commit, and the line exists in that snapshot. One that fails is replaced in the text by
 * `REMOVED_REFERENCE` and counted: a reader must never take it for evidence that was checked.
 *
 * The finding itself stays: its own location is in the reviewed diff, and the sibling reference is
 * evidence for it (ADR 0043 decision 3). Pure over the snapshot directories, so it runs before the
 * local command removes them, and it imports nothing from `src/workspace/`.
 */
import { realpathSync } from "node:fs";
import { repoLineCounter, type LineCounter } from "./contracts";
import type { ResolvedSibling, SiblingReference } from "./distributed";

/** What the text says in place of a reference that could not be checked. */
export const REMOVED_REFERENCE = "[sibling reference removed: it could not be checked]";

/** Any name that could be a member, of one component or several: what a reference to a member this run does not have looks like. */
const ANY_MEMBER = "[A-Za-z0-9][A-Za-z0-9._\\/-]*";
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&");

/**
 * `member@sha:path:line`, with an optional `-line` range end. The member is a manifest `dir`, which
 * may have several components (`apps/desktop`), so the names of this run's members come first, longest
 * first and escaped; any other name of that shape is matched too, to be removed. The path has no
 * whitespace, quote or bracket, which is how the prompt asks for it to be written.
 */
function referencePattern(members: readonly string[]): RegExp {
  const names = [...new Set(members)].sort((a, b) => b.length - a.length).map(escapeRegExp);
  return new RegExp(
    `(?<![\\w@.\\/-])(${[...names, ANY_MEMBER].join("|")})@([0-9a-f]{7,40}):([^\\s\`'"()<>\\[\\],;]+?):(\\d+)(?:-(\\d+))?(?![\\w-])`,
    "g",
  );
}

/** `repoLineCounter` says a file over 8 MiB has every line (it does not read it): for a sibling, that is a file whose lines cannot be checked. */
export const countable = (count: number | null) => (count === Number.MAX_SAFE_INTEGER ? null : count);

export type CheckedText<T> = T & { references?: SiblingReference[] };

/**
 * The directories the prompts name for the snapshots (this run's only, and the same one spelled through its
 * symlinks), each with what the text says in its place: `member@sha7`. A model may repeat one; it must not
 * reach the result, which is stored and printed after the directories are gone.
 */
function snapshotDirectories(siblings: readonly ResolvedSibling[]) {
  const spellings = new Map<string, string>();
  for (const s of siblings) {
    if (s.dir === undefined) continue;
    const name = s.sha === undefined ? s.member : `${s.member}@${s.sha.slice(0, 7)}`;
    for (const dir of [s.dir, safeRealpath(s.dir)]) if (dir !== undefined && dir !== "" && dir !== "/") spellings.set(dir.replace(/\/+$/, ""), name);
  }
  const ordered = [...spellings].sort((a, b) => b[0].length - a[0].length);
  if (ordered.length === 0) return (text: string) => text;
  const pattern = new RegExp(`(${ordered.map(([dir]) => escapeRegExp(dir)).join("|")})(\\/|(?![\\w-]))`, "g");
  return (text: string) => text.replace(pattern, (_, dir: string, slash: string) => `${spellings.get(dir)}${slash === "/" ? ":" : ""}`);
}

function safeRealpath(dir: string) {
  try {
    return realpathSync(dir);
  } catch {
    return undefined;
  }
}

type FindingText = { title: string; body: string; verification?: { reason: string }; originReason?: string };

/** The checker over one run's siblings: `settle` for any text, `finding` for a finding, and the running count of removals. */
function referenceChecker(siblings: readonly ResolvedSibling[]) {
  const readable = siblings.filter((s) => s.dir !== undefined && s.sha !== undefined && (s.status === "read" || s.status === "uncommitted-not-read"));
  const counters = new Map<string, LineCounter>();
  const lines = (dir: string, path: string) => {
    let count = counters.get(dir);
    if (!count) counters.set(dir, (count = repoLineCounter(dir)));
    return countable(count(path));
  };

  const pattern = referencePattern(siblings.map((s) => s.member));
  const withoutDirectories = snapshotDirectories(siblings);
  let removed = 0;
  const kept: SiblingReference[] = [];
  const settle = (text: string) =>
    withoutDirectories(text).replace(pattern, (token, member: string, sha: string, path: string, line: string, end?: string) => {
      const found = readable.find((s) => s.member === member && s.sha!.startsWith(sha));
      const first = Number(line);
      const last = end === undefined ? first : Number(end);
      const count = found ? lines(found.dir!, path) : null;
      if (!found || count === null || first < 1 || last < first || last > count) {
        removed++;
        return REMOVED_REFERENCE;
      }
      kept.push({ member, sha: found.sha!, path, line: first });
      return token;
    });

  const finding = <T extends FindingText>(f: T): CheckedText<T> => {
    kept.length = 0;
    const title = settle(f.title);
    const body = settle(f.body);
    const references = kept.filter((r, i) => kept.findIndex((o) => o.member === r.member && o.sha === r.sha && o.path === r.path && o.line === r.line) === i);
    const before = removed;
    const reason = f.verification ? settle(f.verification.reason) : undefined;
    const originReason = f.originReason !== undefined ? settle(f.originReason) : undefined;
    if (title === f.title && body === f.body && references.length === 0 && removed === before) return f;
    return {
      ...f,
      title,
      body,
      ...(f.verification ? { verification: { ...f.verification, reason: reason! } } : {}),
      ...(originReason !== undefined ? { originReason } : {}),
      ...(references.length > 0 ? { references } : {}),
    };
  };
  return { settle, finding, removed: () => removed };
}

/**
 * `findings` with each sibling reference checked against `siblings`. A finding with no reference is
 * returned unchanged; one with a kept reference gets `references`; a removed one is replaced in the
 * `title` and the `body`. A removed one is also replaced in the verifier's reason and the origin reason
 * of a finding, and in `texts` (the run summary); those never add to `references`. `removed` counts every
 * removed occurrence.
 */
export function checkSiblingReferences<T extends FindingText>(
  siblings: readonly ResolvedSibling[],
  findings: readonly T[],
  texts: readonly string[] = [],
): { findings: CheckedText<T>[]; removed: number; texts: string[] } {
  const check = referenceChecker(siblings);
  const out = findings.map(check.finding);
  const settled = texts.map(check.settle);
  return { findings: out, removed: check.removed(), texts: settled };
}

/** Every field of a contract entry that the model wrote as prose (the rest are paths and a status; `evidence_checked` is the engine's). */
const CONTRACT_TEXT = ["action", "equivalent_path", "before_after", "visible_effect", "failure_mode", "open_question"] as const;

/**
 * The model-written text of a whole result, each field checked as a finding's is: the findings, the
 * summary, the contracts' prose, the risk facts and judgement items, the verifier's entries (the
 * dropped ones too), what the memory step said, the replies to threads the reasons a file was
 * skipped, and any other text (`texts`). A reference that fails is replaced and counted in `removed`, the one total of the run. Only
 * a finding keeps the references that pass, in `references`: nothing else has a field for them.
 */
export function settleModelText<
  F extends FindingText,
  C extends Partial<Record<(typeof CONTRACT_TEXT)[number], string>>,
  W extends { why: string },
  V extends { entries: { title: string; reason: string; originReason?: string }[] },
  M extends { title: string; reason: string },
  R extends { reply: string },
  S extends { reason: string },
>(
  siblings: readonly ResolvedSibling[],
  input: { findings: readonly F[]; summary: string; contracts: readonly C[]; riskFacts: readonly W[]; judgement: readonly W[]; verification?: V; muted: readonly M[]; threadReplies: readonly R[]; skipped: readonly S[]; texts?: readonly string[] },
) {
  const check = referenceChecker(siblings);
  const some = <T extends object, K extends keyof T>(item: T, keys: readonly K[]): T => {
    const next = { ...item };
    for (const key of keys) if (typeof item[key] === "string") next[key] = check.settle(item[key] as string) as T[K];
    return next;
  };
  const findings = input.findings.map(check.finding);
  const summary = check.settle(input.summary);
  const contracts = input.contracts.map((c) => some(c, CONTRACT_TEXT));
  const riskFacts = input.riskFacts.map((f) => some(f, ["why"] as const));
  const judgement = input.judgement.map((f) => some(f, ["why"] as const));
  const verification = input.verification && { ...input.verification, entries: input.verification.entries.map((e) => some(e, ["title", "reason", "originReason"] as const)) };
  const muted = input.muted.map((m) => some(m, ["title", "reason"] as const));
  const threadReplies = input.threadReplies.map((r) => some(r, ["reply"] as const));
  const skipped = input.skipped.map((s) => some(s, ["reason"] as const));
  const texts = (input.texts ?? []).map(check.settle);
  return { findings, summary, contracts, riskFacts, judgement, verification, muted, threadReplies, skipped, texts, removed: check.removed() };
}
