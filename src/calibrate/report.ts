/** The outcome table of `wachiman calibrate`: per severity x confidence cell, split by who opened the pull request. */
import type { AuthorKind, Confidence, OutcomeFinding, Severity } from "./outcomes";

export interface Counts {
  n: number;
  fixed: number;
  declined: number;
  wrong: number;
  unanswered: number;
}

export interface OutcomeCell {
  severity: Severity;
  confidence: Confidence | undefined;
  prs: number;
  all: Counts;
  owner: Counts;
  agent: Counts;
}

const SEVERITIES: readonly Severity[] = ["blocker", "fix", "consider", "info"];
const CONFIDENCES: readonly (Confidence | undefined)[] = ["high", "medium", "low", undefined];
const empty = (): Counts => ({ n: 0, fixed: 0, declined: 0, wrong: 0, unanswered: 0 });

function add(c: Counts, f: OutcomeFinding) {
  c.n++;
  if (f.outcome === "fixed") c.fixed++;
  else if (f.outcome === "declined") c.declined++;
  else if (f.outcome === "wrong") c.wrong++;
  else c.unanswered++;
}

/** A finding without confidence is its own "not measured" cell and is never merged with medium. */
export function aggregateOutcomes(findings: OutcomeFinding[]): OutcomeCell[] {
  const cells = new Map<string, { cell: OutcomeCell; prs: Set<number> }>();
  for (const f of findings) {
    const key = `${f.severity}|${f.confidence ?? "unmeasured"}`;
    let entry = cells.get(key);
    if (!entry) {
      entry = {
        cell: { severity: f.severity, confidence: f.confidence, prs: 0, all: empty(), owner: empty(), agent: empty() },
        prs: new Set(),
      };
      cells.set(key, entry);
    }
    add(entry.cell.all, f);
    add(entry.cell[f.kind], f);
    entry.prs.add(f.pr);
  }
  return [...cells.values()]
    .map(({ cell, prs }) => ({ ...cell, prs: prs.size }))
    .sort(
      (a, b) =>
        SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) ||
        CONFIDENCES.indexOf(a.confidence) - CONFIDENCES.indexOf(b.confidence),
    );
}

const pct = (part: number, whole: number) => (whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`);

/** Fixed and declined as a share of the findings with a decisive reply (fixed + declined); wrong and unanswered as a share of n. */
export const answeredOf = (c: Counts) => c.fixed + c.declined;

export function formatOutcomeTable(cells: OutcomeCell[], pick: "all" | AuthorKind): string {
  const header = ["Severity · confidence", "n", "Fixed", "Declined", "Wrong", "Unanswered"];
  const body = cells
    .filter((c) => c[pick].n > 0)
    .map((c) => {
      const k = c[pick];
      const name = `${c.severity.charAt(0).toUpperCase()}${c.severity.slice(1)} · ${c.confidence ?? "not measured"}`;
      return [name, String(k.n), pct(k.fixed, answeredOf(k)), pct(k.declined, answeredOf(k)), pct(k.wrong, k.n), pct(k.unanswered, k.n)];
    });
  if (body.length === 0) return "  (no findings)";
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (cols: string[]) =>
    cols
      .map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i])))
      .join("  ")
      .trimEnd();
  return [line(header), ...body.map(line)].join("\n");
}

export const RATES_NOTE =
  "These rates are reported, never fitted: a fix rate measures compliance, not whether the finding warranted action. Fixed and declined are shares of fixed + declined; wrong and unanswered are shares of n.";

export function formatReport(repo: string, prs: number, findings: OutcomeFinding[], cells: OutcomeCell[]): string {
  const seen = new Set(findings.map((f) => f.pr)).size;
  return [
    `${findings.length} finding(s) on ${seen} of the last ${prs} pull requests of ${repo}.`,
    "",
    formatOutcomeTable(cells, "all"),
    "",
    "Owner: the deciding reply has no agent callout; with no reply, the pull request is not agent-made",
    formatOutcomeTable(cells, "owner"),
    "",
    'Agent: the deciding reply carries a "responding on behalf of" callout; with no reply, the pull request description says Claude Code or Codex made it, or a bot opened it',
    formatOutcomeTable(cells, "agent"),
    "",
    RATES_NOTE,
    "",
  ].join("\n");
}
