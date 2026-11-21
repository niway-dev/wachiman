/**
 * The review body as data (ADR 0055 decision 1, spec "How the format is protected"). `buildView`
 * gathers what the engine already has when it builds a review, with no new model output, and sorts
 * it into the slots of the body. A renderer turns the view into Markdown; behaviour tests assert
 * on the view ("this Blocker is in To fix"), which does not move when wording does.
 *
 * Text that Wachiman did not write (titles, bodies, reasons, paths) is kept raw here. Escaping is
 * the renderer's job, with `escapeCell` for a table cell.
 */
import type { Contract } from "../contracts";
import type { BatchReport, Confidence, Finding, ReviewFile, ReviewOutput, Severity, Topic, Unreviewable } from "../engine";
import type { Fidelity } from "../fidelity/types";
import type { Origin, ResultFinding, ResultVerificationV2, Tier, VerifierStop } from "../formats";
import { MEMORY_OVER_BUDGET } from "../memory/load";
import { MEMORY_ENTRY_NOTICE, MEMORY_EXCEPTIONS_NOT_APPLIED, MUTED_HEADING } from "../memory/mute";
import { priorityOf, type Arm, type Priority } from "../priority";
import type { JudgementKind, JudgementItem, RiskFact, RiskKind, RiskLevel, RiskMap } from "../risk";
import { sectionOf, tierWord } from "../verify";
import { displayLocation, displayPaths } from "./paths";

/** The slots that hold findings, in the order of the body (spec slots 4, 5, 6, 9, 10). */
export type FindingSlot = "toFix" | "investigate" | "consider" | "preExisting" | "info";

/** One finding as a table row. */
export interface FindingRow {
  severity: Severity;
  /** The stored priority, or the one `priorityOf` gives a result written before it existed. */
  priority: Priority;
  /** The word of the trial's word arm (ADR 0059): `Pre-existing`, else `Important` for a Blocker or Fix, else `Nit`. */
  tier: Tier;
  topic: Topic;
  confidence?: Confidence;
  origin: Origin;
  /** The full repository path: the link target. */
  path: string;
  /** 0 for a finding about the whole file. */
  line: number;
  /** What the table shows for the path (`paths.ts`): the file name, or a suffix that tells it from another. */
  displayPath: string;
  /** `displayPath` and the line, `run.ts:12`. */
  location: string;
  title: string;
  /** The model's text, raw. */
  body: string;
  /** The finding has an inline thread on its line (the 422 fallback creates none: it clears this). */
  inlineThread: boolean;
  /** The finding is anchored outside the diff, so it can have no thread. False for rows in slots that never have one. */
  outsideDiff: boolean;
}

export interface NeedsPersonItem {
  kind: JudgementKind;
  path: string;
  line: number;
  displayPath: string;
  location: string;
  /** The model's reason, raw. */
  why: string;
}

export interface RiskFactRow {
  kind: RiskKind;
  path: string;
  line: number;
  displayPath: string;
  location: string;
  why: string;
}

export interface RiskView {
  level: RiskLevel;
  /** Some files were not reviewed: the level is "at least" `level`. */
  floor: boolean;
  /** A review of one push: the map covers that push. */
  pushOnly: boolean;
  facts: RiskFactRow[];
  /** Files a heuristic or a path rule marked; `rule` is set for a maintainer's rule. */
  pathReasons: { path: string; displayPath: string; why: string; rule?: true }[];
  readFirst: { path: string; displayPath: string }[];
  unreadFiles: number;
  droppedFacts: number;
}

export type ScopeKind = "whole" | "since" | "rebase";

export interface ScopeView {
  kind: ScopeKind;
  /** The commit the review started from; null for the whole pull request. */
  since: string | null;
  /** The head commit, full. */
  head: string;
  /** Files the previous partial review did not reach, reviewed now whole. */
  carried: number;
  /** The commits since `since`, full shas, oldest first; empty when the connector gave none. */
  commits: string[];
}

export interface NotReviewedGroup {
  /** The reason the engine or the reviewer gave; empty when none was reported. */
  reason: string;
  paths: string[];
}

export interface VerifierView {
  /** `none`: the review ran without a verifier. */
  status: ResultVerificationV2["status"] | "none";
  stop?: VerifierStop["kind"];
  /** Findings the verifier never reached. */
  notChecked: number;
}

/** The earlier threads still open on the pull request: a number, or `unknown` when a page could not be read. */
export type EarlierThreads = number | "unknown";

export interface FindingCounts {
  blockers: number;
  fixes: number;
  considers: number;
  info: number;
  /** This pull request's findings, Info included: blockers + fixes + considers + info. */
  total: number;
  /** Counted after the total, in their own slots. */
  preExisting: number;
  /** Pre-existing findings that are a Blocker or a Fix. */
  preExistingDemanding: number;
  investigate: number;
  /** Of this pull request's findings, by priority. */
  byPriority: Record<Priority, number>;
}

/** The rows of the "At a glance" table, in order. A row is absent when it would say nothing. */
export type GlanceRow =
  | ({ key: "findings" } & FindingCounts)
  | { key: "risk"; level: RiskLevel; floor: boolean; pushOnly: boolean; topReason: string | null }
  | { key: "needsPerson"; count: number; kinds: JudgementKind[]; first: { displayPath: string; line: number; location: string } }
  | { key: "coverage"; reviewed: number; total: number; scope: ScopeKind }
  | { key: "earlierThreads"; count: EarlierThreads }
  | { key: "confidence"; grade: Fidelity["grade"]; trial: boolean; reasons: string[] }
  | { key: "readFirst"; paths: { path: string; displayPath: string }[] };

/** Strings the renderer writes at the end of the body exactly as given (slots 15 and 16, and the receipt before them). */
export interface FooterView {
  /** The signed spend-ledger receipt, immediately before the cost line. Never cut. */
  receipt?: string;
  /** The `<sub>` cost line: `readAutoCost` reads its last `$`. */
  costLine: string;
  /** The hidden markers, in order (automatic flag, review signature, head or partial marker, ...). */
  markers: string[];
}

export interface ReviewView {
  /**
   * GitHub refused the inline comments, so this is the 422 body: no finding has a thread, the model's
   * text for each one goes into a numbered "Details of each finding" (spec "The review body").
   * Set by `refusedView`.
   */
  inlineRefused?: true;
  /** `owner/name`, for the links of a location; absent when the caller does not know it. */
  repo?: string;
  /** The command keyword that asks for the rest of a partial review. */
  mention: string;
  /** The trial arm (ADR 0059): which word a finding row and the priority counts show. */
  arm: Arm;
  scope: ScopeView;
  files: {
    total: number;
    reviewed: number;
    /** Not reviewed, grouped by reason, in the order of the pull request's files. */
    notReviewed: NotReviewedGroup[];
    /** Not reviewed after two tries: the next push will not carry them. */
    notReviewedTwice: string[];
    /** Files no model can review (binaries). */
    notReviewable: Unreviewable[];
  };
  notices: {
    instructionChanges?: { files: string[]; baseSha: string };
    pathPolicyChange?: { baseSha: string };
  };
  verifier: VerifierView;
  earlierThreads: EarlierThreads;
  glance: GlanceRow[];
  findings: Record<FindingSlot, FindingRow[]>;
  needsPerson: NeedsPersonItem[];
  risk: RiskView | null;
  contracts: { open: Contract[]; closed: Contract[] };
  /** The batches' prose, as the engine merged it (memory notices left out), raw. */
  batchProse: string;
  /** What memory exceptions did and the "Muted by memory" list: visible, never collapsed (ADR 0057), raw. Empty when none. */
  memoryNotices: string;
  coverage: { rows: BatchReport[]; estimate: boolean };
  footer: FooterView;
}

/** The findings of every slot counted: what the glance row and the status read. */
export function countFindingRows(findings: ReviewView["findings"]): FindingCounts {
  const count = (rows: FindingRow[], s: Severity) => rows.filter((r) => r.severity === s).length;
  const mine = [...findings.toFix, ...findings.consider, ...findings.info];
  const byPriority: Record<Priority, number> = { must: 0, should: 0, could: 0, fyi: 0 };
  for (const r of mine) byPriority[r.priority]++;
  const blockers = count(findings.toFix, "blocker");
  const fixes = count(findings.toFix, "fix");
  const considers = findings.consider.length;
  const info = findings.info.length;
  return {
    blockers,
    fixes,
    considers,
    info,
    total: blockers + fixes + considers + info,
    preExisting: findings.preExisting.length,
    preExistingDemanding: findings.preExisting.filter((r) => r.severity === "blocker" || r.severity === "fix").length,
    investigate: findings.investigate.length,
    byPriority,
  };
}

/** The same review as the 422 fallback posts it: every finding is listed in the body, none on its line. */
export function refusedView(view: ReviewView): ReviewView {
  const none = (rows: FindingRow[]) => rows.map((r) => ({ ...r, inlineThread: false }));
  const f = view.findings;
  return {
    ...view,
    inlineRefused: true,
    findings: { toFix: none(f.toFix), investigate: none(f.investigate), consider: none(f.consider), preExisting: none(f.preExisting), info: none(f.info) },
  };
}

/** What the engine has when it builds a review: the same data `buildReview` reads today. */
export interface ViewInput {
  /** A finding's `anchor`, when given (a `ReviewResult`'s), decides whether it has a thread; else `commentable` does. */
  output: Omit<ReviewOutput, "findings"> & {
    findings: (Finding & Partial<Pick<ResultFinding, "anchor" | "origin" | "verification" | "priority" | "rank">>)[];
  };
  files: ReviewFile[];
  /** `owner/name`: with `headSha` it makes a location a link to its file and line. */
  repo?: string;
  mention?: string;
  arm?: Arm;
  headSha: string;
  since: string | null;
  rebased?: boolean;
  /** The commits since `since` (full shas, oldest first). */
  commits?: string[];
  /** Limited to `<mention> review <paths>`: nothing is carried to the next push, so nothing is "tried twice". */
  scoped: boolean;
  /** The new-side lines of each file a review comment can target (`commentableLines`). */
  commentable?: ReadonlyMap<string, ReadonlySet<number>>;
  carried?: string[];
  tried?: string[];
  unreviewable?: Unreviewable[];
  instructionChanges?: { files: string[]; baseSha: string };
  pathPolicyChange?: { baseSha: string };
  verification?: ResultVerificationV2;
  riskMap?: RiskMap;
  fidelity?: Fidelity;
  batches?: BatchReport[];
  estimate?: boolean;
  pushOnly?: boolean;
  /** Open bot threads from earlier reviews; `unknown` when a page of threads could not be read. Default 0. */
  earlierThreads?: EarlierThreads;
  footer: FooterView;
}

const notReached = (reason: string) => reason.startsWith("not reached");

/** The paragraphs the memory step appends to the summary: the engine's own notices, which start with one of these. */
const MEMORY_NOTICE_START = new RegExp(
  `^(?:${[MEMORY_OVER_BUDGET, MEMORY_ENTRY_NOTICE, MEMORY_EXCEPTIONS_NOT_APPLIED, MUTED_HEADING].map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
);

/** The summary split at the first memory notice: the model's prose, then what the engine appended (ADR 0057 keeps that visible). */
export function splitMemoryNotices(summary: string): { prose: string; notices: string } {
  const paragraphs = summary.split("\n\n");
  const at = paragraphs.findIndex((p) => MEMORY_NOTICE_START.test(p));
  if (at === -1) return { prose: summary, notices: "" };
  return { prose: paragraphs.slice(0, at).join("\n\n"), notices: paragraphs.slice(at).join("\n\n") };
}

export function buildView(input: ViewInput): ReviewView {
  const { output, files, headSha, since } = input;
  const commentable = input.commentable ?? new Map<string, ReadonlySet<number>>();
  const risk = input.riskMap;

  // Every path the body shows, so two files with one name are told apart across all of its slots.
  const shown = displayPaths([
    ...output.findings.map((f) => f.path),
    ...(risk?.judgement ?? []).map((j) => j.path),
    ...(risk?.facts ?? []).map((f) => f.path),
    ...(risk?.pathReasons ?? []).map((r) => r.path),
    ...(risk?.readFirst ?? []),
  ]);
  const name = (path: string) => shown.get(path) as string;
  const where = (path: string, line: number) => ({ displayPath: name(path), location: displayLocation(name(path), line) });

  const findings: ReviewView["findings"] = { toFix: [], investigate: [], consider: [], preExisting: [], info: [] };
  for (const f of output.findings) {
    const section = sectionOf(f);
    const slot: FindingSlot =
      f.severity === "info"
        ? "info"
        : section === "pre-existing"
          ? "preExisting"
          : section === "inconclusive"
            ? "investigate"
            : f.severity === "consider"
              ? "consider"
              : "toFix";
    // As the engine decides today: a finding of this change has a thread when its line is in the diff.
    const mine = slot === "toFix" || slot === "consider";
    const inDiff = mine && (f.anchor ? f.anchor === "diff" : commentable.get(f.path)?.has(f.line) === true);
    findings[slot].push({
      severity: f.severity,
      priority: f.priority ?? priorityOf(f).priority,
      tier: tierWord(f),
      topic: f.topic,
      ...(f.confidence ? { confidence: f.confidence } : {}),
      origin: f.origin ?? "unknown",
      path: f.path,
      line: f.line,
      ...where(f.path, f.line),
      title: f.title,
      body: f.body,
      // An Info finding never opens a thread, even on a diff line.
      inlineThread: inDiff,
      outsideDiff: mine && !inDiff,
    });
  }
  // Blockers first: the size fitting keeps the first rows, and a Blocker is the last thing to cut.
  for (const slot of ["toFix", "investigate", "preExisting"] as const) {
    findings[slot].sort((a, b) => Number(b.severity === "blocker") - Number(a.severity === "blocker"));
  }

  const expected = files.map((f) => f.filename);
  const reviewed = new Set(output.files_reviewed);
  const notReviewed = expected.filter((f) => !reviewed.has(f));
  const reasons = new Map(output.files_skipped.map((s) => [s.path, s.reason]));
  const groups = new Map<string, string[]>();
  for (const path of notReviewed) {
    const reason = reasons.get(path) ?? "";
    groups.set(reason, [...(groups.get(reason) ?? []), path]);
  }
  const priorTried = new Set(input.tried ?? []);
  const carried = (input.carried ?? []).filter((f) => expected.includes(f));

  const open = (output.contracts ?? []).filter((c) => c.status === "open");
  const closed = (output.contracts ?? []).filter((c) => c.status === "closed");
  const needsPerson: NeedsPersonItem[] = (risk?.judgement ?? []).map((j: JudgementItem) => ({
    kind: j.kind,
    path: j.path,
    line: j.line,
    ...where(j.path, j.line),
    why: j.why,
  }));
  const riskView: RiskView | null = risk
    ? {
        level: risk.level,
        floor: risk.floor,
        pushOnly: input.pushOnly === true,
        facts: risk.facts.map((f: RiskFact) => ({ kind: f.kind, path: f.path, line: f.line, ...where(f.path, f.line), why: f.why })),
        pathReasons: risk.pathReasons.map((r) => ({ path: r.path, displayPath: name(r.path), why: r.why, ...(r.rule ? { rule: true as const } : {}) })),
        readFirst: risk.readFirst.map((path) => ({ path, displayPath: name(path) })),
        unreadFiles: risk.unreadFiles,
        droppedFacts: risk.droppedFacts,
      }
    : null;

  const earlierThreads = input.earlierThreads ?? 0;
  const scope: ScopeView = {
    kind: since ? (input.rebased ? "rebase" : "since") : "whole",
    since,
    head: headSha,
    carried: carried.length,
    commits: input.commits ?? [],
  };
  const counts = countFindingRows(findings);
  const topReason = riskView?.facts[0]?.why ?? riskView?.pathReasons[0]?.why ?? null;
  const glance: GlanceRow[] = [{ key: "findings", ...counts }];
  if (riskView) glance.push({ key: "risk", level: riskView.level, floor: riskView.floor, pushOnly: riskView.pushOnly, topReason });
  if (needsPerson.length > 0) {
    const kinds = [...new Set(needsPerson.map((n) => n.kind))];
    glance.push({ key: "needsPerson", count: needsPerson.length, kinds, first: { displayPath: needsPerson[0].displayPath, line: needsPerson[0].line, location: needsPerson[0].location } });
  }
  glance.push({ key: "coverage", reviewed: expected.length - notReviewed.length, total: expected.length, scope: scope.kind });
  // A row that reads the same on every review is not one: threads show on a re-review, or when there are some, or when they could not be counted.
  if (earlierThreads !== 0 || scope.kind !== "whole") glance.push({ key: "earlierThreads", count: earlierThreads });
  if (input.fidelity) glance.push({ key: "confidence", grade: input.fidelity.grade, trial: input.fidelity.trial, reasons: input.fidelity.reasons });
  if (riskView && riskView.readFirst.length > 0) glance.push({ key: "readFirst", paths: riskView.readFirst });

  const v = input.verification;
  const unreached = v?.entries.filter((e) => e.unreached).length ?? 0;
  const verifier: VerifierView = v
    ? {
        status: v.status,
        ...(v.stop ? { stop: v.stop.kind } : {}),
        // A failed verifier that left no per-finding record still checked none of the findings it was asked about.
        notChecked: v.status === "failed" && unreached === 0 ? v.entries.length || output.findings.filter((f) => f.severity !== "info").length : unreached,
      }
    : { status: "none", notChecked: 0 };

  const memory = splitMemoryNotices(output.summary);
  return {
    ...(input.repo ? { repo: input.repo } : {}),
    mention: input.mention ?? "/wachiman",
    arm: input.arm ?? "priority",
    scope,
    files: {
      total: expected.length,
      reviewed: expected.length - notReviewed.length,
      notReviewed: [...groups].map(([reason, paths]) => ({ reason, paths })),
      notReviewedTwice: input.scoped ? [] : notReviewed.filter((f) => priorTried.has(f) && !notReached(reasons.get(f) ?? "")),
      notReviewable: input.unreviewable ?? [],
    },
    notices: {
      ...(input.instructionChanges && input.instructionChanges.files.length > 0 ? { instructionChanges: input.instructionChanges } : {}),
      ...(input.pathPolicyChange ? { pathPolicyChange: input.pathPolicyChange } : {}),
    },
    verifier,
    earlierThreads,
    glance,
    findings,
    needsPerson,
    risk: riskView,
    contracts: { open, closed },
    batchProse: memory.prose,
    memoryNotices: memory.notices,
    coverage: { rows: input.batches ?? [], estimate: input.estimate === true },
    footer: input.footer,
  };
}
