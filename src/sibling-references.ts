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
 * `findings` with each sibling reference checked against `siblings`. A finding with no reference is
 * returned unchanged; one with a kept reference gets `references`; a removed one is replaced in the
 * `title` and the `body`. A removed one is also replaced in the verifier's reason and the origin reason
 * of a finding, and in `texts` (the run summary); those never add to `references`. `removed` counts every
 * removed occurrence.
 */
export function checkSiblingReferences<T extends { title: string; body: string; verification?: { reason: string }; originReason?: string }>(
  siblings: readonly ResolvedSibling[],
  findings: readonly T[],
  texts: readonly string[] = [],
): { findings: CheckedText<T>[]; removed: number; texts: string[] } {
  const readable = siblings.filter((s) => s.dir !== undefined && s.sha !== undefined && (s.status === "read" || s.status === "uncommitted-not-read"));
  const counters = new Map<string, LineCounter>();
  const lines = (dir: string, path: string) => {
    let count = counters.get(dir);
    if (!count) counters.set(dir, (count = repoLineCounter(dir)));
    return countable(count(path));
  };

  const pattern = referencePattern(siblings.map((s) => s.member));
  let removed = 0;
  const kept: SiblingReference[] = [];
  const settle = (text: string) =>
    text.replace(pattern, (token, member: string, sha: string, path: string, line: string, end?: string) => {
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

  const out = findings.map((finding): CheckedText<T> => {
    kept.length = 0;
    const title = settle(finding.title);
    const body = settle(finding.body);
    const references = kept.filter((r, i) => kept.findIndex((o) => o.member === r.member && o.sha === r.sha && o.path === r.path && o.line === r.line) === i);
    const before = removed;
    const reason = finding.verification ? settle(finding.verification.reason) : undefined;
    const originReason = finding.originReason !== undefined ? settle(finding.originReason) : undefined;
    if (title === finding.title && body === finding.body && references.length === 0 && removed === before) return finding;
    return {
      ...finding,
      title,
      body,
      ...(finding.verification ? { verification: { ...finding.verification, reason: reason! } } : {}),
      ...(originReason !== undefined ? { originReason } : {}),
      ...(references.length > 0 ? { references } : {}),
    };
  });
  const settled = texts.map(settle);
  return { findings: out, removed, texts: settled };
}
