/**
 * Matching and replay (spec D5, D6), pure: no filesystem, no git, no model. `reconcile` decides,
 * for one run, which of its findings are new and which earlier ones it settles; `replay` applies
 * the same transitions from the stored run files, so the report and the listing agree.
 */
import type { ReviewFile, ReviewResult, Severity, Topic } from "../engine";
import type { ResultFinding } from "../formats";
import { findingId } from "./fingerprint";
import type { HistoryRun, Settled, Tracking, VerdictLine } from "./types";

export type Status = "new" | "open" | "probably-fixed" | "not-repeated" | "unknown";
/** A finding's state between runs: `new` is only a label a run gives its own sightings. */
export type TrackedStatus = Exclude<Status, "new">;

export interface TrackedFinding {
  firstId: string;
  firstHead: string;
  path: string;
  line: number;
  topic: Topic;
  severity: Severity;
  title: string;
  titleKey: string;
  lineHash?: string;
  lineText?: string;
  blobSha?: string;
  status: TrackedStatus;
  lastHead: string;
  lastSeenAt: string;
  runs: number;
  reopened: number;
}

export interface Fingerprint {
  titleKey: string;
  lineHash?: string;
  lineText?: string;
  blobSha?: string;
}

export interface ReconcileInput {
  /** Every tracked finding of the repository, settled ones included so they can reopen. */
  open: TrackedFinding[];
  result: ReviewResult;
  files: ReviewFile[];
  key: string;
  fingerprint: (f: ResultFinding) => Fingerprint;
  /** Whether the cited region of `t` changed in the file at `path` (the rename-mapped path). */
  regionChanged: (path: string, t: TrackedFinding) => boolean;
}

const SETTLED_STATUSES: readonly TrackedStatus[] = ["probably-fixed", "not-repeated"];

export function reconcile(p: ReconcileInput): { tracking: Tracking[]; settled: Settled[]; unknown: number; unknownIds: string[] } {
  const head = p.result.change.head.sha;
  const renames = new Map(p.files.filter((f) => f.previous_filename).map((f) => [f.previous_filename!, f.filename]));
  const pathOf = (t: TrackedFinding) => renames.get(t.path) ?? t.path;
  const pool = [...p.open];

  const take = (match: (t: TrackedFinding) => boolean) => {
    const index = pool.findIndex(match);
    return index === -1 ? undefined : pool.splice(index, 1)[0];
  };

  const tracking: Tracking[] = p.result.findings.map((f) => {
    const fp = p.fingerprint(f);
    const here = (t: TrackedFinding) => pathOf(t) === f.path && t.topic === f.topic;
    const byLine = fp.lineHash !== undefined ? take((t) => here(t) && t.lineHash === fp.lineHash) : undefined;
    const found = byLine ?? take((t) => here(t) && t.titleKey === fp.titleKey);
    const id = findingId(p.key, head, f.path, f.line, f.topic, fp.titleKey);
    const parts = { titleKey: fp.titleKey, lineHash: fp.lineHash, lineText: fp.lineText, blobSha: fp.blobSha };
    if (!found) return { id, status: "new", firstId: id, firstHead: head, runs: 1, reopened: 0, ...parts };
    return {
      id,
      status: "open",
      firstId: found.firstId,
      firstHead: found.firstHead,
      runs: found.runs + 1,
      reopened: found.reopened + (SETTLED_STATUSES.includes(found.status) ? 1 : 0),
      ...parts,
      matchedBy: byLine ? "line" : "title",
    };
  });

  // A file counts as reviewed only when the run expected it: a model that names a file outside
  // its batch or the scope has not covered it.
  const expected = new Set(p.result.coverage.expected);
  const reviewed = new Set(p.result.coverage.reviewed.filter((f) => expected.has(f)));
  const settled: Settled[] = [];
  const unknownIds: string[] = [];
  for (const t of pool) {
    if (SETTLED_STATUSES.includes(t.status)) continue; // settled earlier, and not seen again: stays settled
    const path = pathOf(t);
    if (!reviewed.has(path)) {
      unknownIds.push(t.firstId);
      continue;
    }
    settled.push({
      firstId: t.firstId,
      status: p.regionChanged(path, t) ? "probably-fixed" : "not-repeated",
      path,
      line: t.line,
      title: t.title,
      lastHead: t.lastHead,
    });
  }
  return { tracking, settled, unknown: unknownIds.length, unknownIds };
}

export interface ReplayedFinding extends TrackedFinding {
  verdict?: VerdictLine;
}

export interface Replayed {
  findings: ReplayedFinding[];
  counts: { correct: number; partial: number; wrong: number; unjudged: number };
}

/** The state after `runs` (in `savedAt` order) and the developer's verdicts. */
export function replay(runs: HistoryRun[], verdicts: Map<string, VerdictLine>): Replayed {
  const state = new Map<string, TrackedFinding>();
  for (const run of runs) {
    const head = run.result.change.head.sha;
    run.result.findings.forEach((f, i) => {
      const t = run.tracking[i];
      if (!t) return;
      state.set(t.firstId, {
        firstId: t.firstId,
        firstHead: t.firstHead,
        path: f.path,
        line: f.line,
        topic: f.topic,
        severity: f.severity,
        title: f.title,
        titleKey: t.titleKey,
        lineHash: t.lineHash,
        lineText: t.lineText,
        blobSha: t.blobSha,
        status: "open",
        lastHead: head,
        lastSeenAt: run.savedAt,
        runs: t.runs,
        reopened: t.reopened,
      });
    });
    for (const s of run.settled) {
      const t = state.get(s.firstId);
      if (t) t.status = s.status;
    }
    for (const id of run.unknownIds ?? []) {
      const t = state.get(id);
      if (t) t.status = "unknown";
    }
  }
  const findings = [...state.values()].map((t): ReplayedFinding => ({ ...t, verdict: verdicts.get(t.firstId) }));
  const counts = { correct: 0, partial: 0, wrong: 0, unjudged: 0 };
  for (const f of findings) counts[f.verdict?.verdict ?? "unjudged"]++;
  return { findings, counts };
}
