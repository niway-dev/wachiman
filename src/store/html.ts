/**
 * The dashboard as one static HTML file: inline CSS, no script, no font, no image, no link and no
 * request of any kind, so it opens offline from a file. A page security policy (`default-src 'none'`)
 * says the same to the browser. Every string that came from a history file goes through `esc`.
 */
import { GRADES } from "../fidelity/types";
import { SEVERITY_ORDER, type Figures } from "./figures";
import type { Aside, Bucket, Group, Limits, Money, Report, Source, Split } from "../spend/report";

/** The laptop-plus-ledger section (ADR 0039): present only when a ledger is connected or was pulled. */
export interface UsageSection {
  report: Report;
  /** False when credentials exist but nothing was pulled yet. */
  pulled: boolean;
}

export interface DashboardDocument extends Figures {
  format: string;
  generatedAt: string;
  scope: string;
  usage?: UsageSection;
}

/** Text for an element or a quoted attribute. */
export function esc(text: unknown): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const SEVERITY_WORD: Record<string, string> = { blocker: "Blocker", fix: "Fix", consider: "Consider", info: "Info" };

/** A bar as wide as `value` is of `max`, drawn as inline SVG; `max` 0 gives an empty bar. */
function bar(value: number, max: number): string {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return `<svg class="bar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect class="track" width="100" height="8"/><rect class="fill" width="${pct.toFixed(2)}" height="8"/></svg>`;
}

function table(head: string[], rows: string[][], numeric: number[] = []): string {
  const cell = (tag: string, c: string, i: number) => `<${tag}${numeric.includes(i) ? ' class="num"' : ""}>${c}</${tag}>`;
  return `<table><thead><tr>${head.map((h, i) => cell("th", esc(h), i)).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c, i) => cell("td", c, i)).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

const empty = (text: string) => `<p class="muted">${esc(text)}</p>`;


const NO_DATA = "no data";
const SOURCE_WORD: Record<Source, string> = { actions: "GitHub Actions", laptop: "laptop" };

/** A figure of one source, or "no data" when the downloaded or kept data does not cover the period. */
const sourceCell = (split: Split, source: Source, known: boolean) => (known ? usd(split.bySource[source].usd) : NO_DATA);

function bucketLabel(b: Bucket, kind: "day" | "week") {
  return kind === "week" ? `Week of ${b.key}${b.partial ? " (partial)" : ""}` : b.key;
}

/** Consecutive periods with no data in any source are one row, so a long gap does not read as zeros. */
function bucketTable(buckets: Bucket[], kind: "day" | "week", coverage: Report["coverage"]): string {
  const rows: string[][] = [];
  let gap: Bucket[] = [];
  const flush = () => {
    if (gap.length === 0) return;
    const range = gap.length === 1 ? gap[0].key : `${gap[0].key} to ${gap.at(-1)!.key}`;
    rows.push([esc(kind === "week" ? `Weeks of ${range}` : range), esc(NO_DATA), "", "", "", "", ""]);
    gap = [];
  };
  for (const b of [...buckets].reverse()) {
    if (!b.known.laptop && !b.known.actions) {
      gap.push(b);
      continue;
    }
    flush();
    rows.push([
      esc(bucketLabel(b, kind)),
      String(b.spend.total.runs),
      String(b.spend.total.calls),
      usd(b.spend.total.usd),
      sourceCell(b.spend, "actions", b.known.actions),
      sourceCell(b.spend, "laptop", b.known.laptop),
      `${usd(b.spend.byCredential.billed.usd)} / ${usd(b.spend.byCredential.estimated.usd + b.spend.byCredential.unknown.usd)}`,
    ]);
  }
  flush();
  void coverage;
  return table([kind === "day" ? "Day (UTC)" : "Week (Monday, UTC)", "Runs", "Calls", "Total", "GitHub Actions", "Laptop", "Billed / estimated"], rows, [1, 2, 3, 4, 5, 6]);
}

/** Stacked inline-SVG bars: GitHub Actions below, laptop above; a grey dash where there is no data; a line at the limit. */
function chart(buckets: Bucket[], limit: number | null, what: string, limitWord: string): string {
  const W = 640;
  const H = 170;
  const left = 46;
  const top = 18;
  const bottom = 22;
  const plotW = W - left - 8;
  const plotH = H - top - bottom;
  if (buckets.length === 0) return "";
  const totals = buckets.map((b) => b.spend.total.usd);
  const max = Math.max(limit ?? 0, ...totals, 0.01);
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const slot = plotW / buckets.length;
  const barW = Math.max(1, slot * 0.7);
  const parts = buckets.map((b, i) => {
    const x = left + i * slot + (slot - barW) / 2;
    if (!b.known.laptop && !b.known.actions) {
      return `<rect class="nodata" x="${x.toFixed(1)}" y="${(top + plotH - 2).toFixed(1)}" width="${barW.toFixed(1)}" height="2"><title>${esc(b.key)}: ${NO_DATA}</title></rect>`;
    }
    const a = b.known.actions ? b.spend.bySource.actions.usd : 0;
    const l = b.known.laptop ? b.spend.bySource.laptop.usd : 0;
    const label = `${b.key}: ${usd(b.spend.total.usd)} (GitHub Actions ${b.known.actions ? usd(a) : NO_DATA}, laptop ${b.known.laptop ? usd(l) : NO_DATA})`;
    return `<g><title>${esc(label)}</title><rect class="fill" x="${x.toFixed(1)}" y="${y(a).toFixed(1)}" width="${barW.toFixed(1)}" height="${(top + plotH - y(a)).toFixed(1)}"/><rect class="fill2" x="${x.toFixed(1)}" y="${y(a + l).toFixed(1)}" width="${barW.toFixed(1)}" height="${(y(a) - y(a + l)).toFixed(1)}"/></g>`;
  });
  const limitLine =
    limit === null
      ? ""
      : `<line class="limit" x1="${left}" x2="${W - 8}" y1="${y(limit).toFixed(1)}" y2="${y(limit).toFixed(1)}"/><text class="axis" x="${W - 10}" y="${(y(limit) - 3).toFixed(1)}" text-anchor="end">${esc(limitWord)} ${esc(usd(limit))}</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(what)}"><title>${esc(what)}</title><line class="axisline" x1="${left}" x2="${W - 8}" y1="${top + plotH}" y2="${top + plotH}"/><text class="axis" x="${left - 4}" y="${top + plotH}" text-anchor="end">$0</text><text class="axis" x="${left - 4}" y="${top + 8}" text-anchor="end">${esc(usd(max))}</text><text class="axis" x="${left}" y="${H - 6}">${esc(buckets[0].key)}</text><text class="axis" x="${W - 8}" y="${H - 6}" text-anchor="end">${esc(buckets.at(-1)!.key)}</text>${parts.join("")}${limitLine}</svg>`;
}

const cell = (m: Money, known: boolean) => (known ? usd(m.usd) : NO_DATA);

function groupTable(head: string, groups: Group[], coverage: Report["coverage"], empty_: string): string {
  if (groups.length === 0) return empty(empty_);
  const hasLaptop = coverage.laptop !== null;
  const hasActions = coverage.actions !== null;
  return table(
    [head, "Runs", "Calls", "Total", "GitHub Actions", "Laptop", "Billed", "Estimated"],
    groups.map((g) => [
      esc(g.label),
      String(g.split.total.runs),
      String(g.split.total.calls),
      usd(g.split.total.usd),
      cell(g.split.bySource.actions, hasActions),
      cell(g.split.bySource.laptop, hasLaptop),
      usd(g.split.byCredential.billed.usd),
      usd(g.split.byCredential.estimated.usd + g.split.byCredential.unknown.usd),
    ]),
    [1, 2, 3, 4, 5, 6, 7],
  );
}

function asideTable(aside: Report["aside"]): string {
  const row = (label: string, a: Aside, money: string) => [esc(label), String(a.runs), esc(money)];
  return table(
    ["Not counted as spend", "Runs", "Dollars"],
    [
      row("Runs that were not reserved (the ledger was unreachable; recorded afterwards)", aside.unreserved, `${usd(aside.unreserved.usd)} recorded`),
      row("Reservations that never settled (the run was killed; the hold is not spend)", aside.unsettled, `${usd(aside.unsettled.reservedUsd)} held`),
      row("Runs still reserved (under six hours old)", aside.reserved, `${usd(aside.reserved.reservedUsd)} held`),
    ],
    [1],
  );
}

function renderUsage(u: UsageSection): string {
  const r = u.report;
  const t = r.totals;
  const limits: Limits | null = r.limits;
  const lastPull = r.pulledAt ? `The ledger was last pulled ${esc(r.pulledAt)}; GitHub Actions figures cover ${esc(r.coverage.actions?.from ?? "")} to ${esc(r.coverage.actions?.to ?? "")}.` : "The ledger has not been pulled yet: run <code>wachiman ledger pull</code>. GitHub Actions figures show no data until then.";
  const limitText = limits && (limits.dailyUsd !== null || limits.weeklyUsd !== null)
    ? `Ledger limits: ${limits.dailyUsd !== null ? `daily ${usd(limits.dailyUsd)}` : "no daily limit"}, ${limits.weeklyUsd !== null ? `weekly ${usd(limits.weeklyUsd)}` : "no weekly limit"}. The limit is best-effort and counts GitHub Actions runs only, never laptop runs.`
    : "The ledger limit, when one is set, is best-effort and counts GitHub Actions runs only, never laptop runs.";
  const tile = (value: string, label: string) => `<div class="tile"><b>${value}</b>${esc(label)}</div>`;
  return `<h2>Spend, laptop and GitHub Actions</h2>
<p class="muted">${lastPull}</p>
<p class="muted">${esc(limitText)} Weeks start on Monday, UTC. Dollars are shown as billed (API key) and estimated (subscription, API-equivalent, not a bill); the two are never merged into one figure without both being shown.</p>
<div class="tiles">
${tile(String(t.total.runs), "finished runs")}
${tile(usd(t.byCredential.billed.usd), "billed (API key)")}
${tile(usd(t.byCredential.estimated.usd + t.byCredential.unknown.usd), "estimated (subscription)")}
${tile(r.coverage.actions ? usd(t.bySource.actions.usd) : NO_DATA, SOURCE_WORD.actions)}
${tile(r.coverage.laptop ? usd(t.bySource.laptop.usd) : NO_DATA, SOURCE_WORD.laptop)}
</div>
<h2>Dollars per day</h2>
<p class="muted">Each bar is the dollars of finished runs on one UTC day: GitHub Actions in the lower colour, this laptop in the upper colour. A grey dash means no data for that day. ${limits?.dailyUsd != null ? "The dashed line is the daily limit." : ""}</p>
${chart(r.days, limits?.dailyUsd ?? null, "Dollars of finished runs per UTC day, GitHub Actions and laptop", "daily limit")}
${bucketTable(r.days, "day", r.coverage)}
<h2>Dollars per week</h2>
<p class="muted">Each bar is the dollars of finished runs in one week that starts on Monday, UTC. ${limits?.weeklyUsd != null ? "The dashed line is the weekly limit." : ""}</p>
${chart(r.weeks, limits?.weeklyUsd ?? null, "Dollars of finished runs per week starting Monday UTC, GitHub Actions and laptop", "weekly limit")}
${bucketTable(r.weeks, "week", r.coverage)}
<h2>Per repository</h2>
${groupTable("Repository", r.groups.repository, r.coverage, "No finished run yet.")}
<h2>Per pull request</h2>
${groupTable("Pull request", r.groups.pr, r.coverage, "No finished run yet.")}
<h2>Per model</h2>
<p class="muted">A run that used several models counts once in each, with only that model's calls and dollars.</p>
${groupTable("Model", r.groups.model, r.coverage, "No finished run yet.")}
<h2>Not counted as spend</h2>
${asideTable(r.aside)}
${r.unknownCostCalls > 0 ? `<p class="muted">${r.unknownCostCalls} call${r.unknownCostCalls === 1 ? "" : "s"} died without a result: their dollars are unknown and counted as $0.00 above.</p>` : ""}`;
}

export function renderHtml(doc: DashboardDocument): string {
  const { totals, spend, findings, loops, prConfidence } = doc;

  const maxDay = Math.max(0, ...spend.byDay.map((d) => d.costUsdEstimate));
  const maxRepo = Math.max(0, ...spend.byRepository.map((r) => r.costUsdEstimate));
  const maxSeverity = Math.max(0, ...Object.values(findings.bySeverity));
  const maxVerdict = Math.max(0, ...Object.values(findings.byVerdict));

  const spendDay = spend.byDay.length
    ? table(["Day", "Runs", "Estimated spend", ""], spend.byDay.map((d) => [esc(d.day), String(d.runs), usd(d.costUsdEstimate), bar(d.costUsdEstimate, maxDay)]), [1, 2])
    : empty("No local run kept yet.");
  const spendRepo = spend.byRepository.length
    ? table(["Repository", "Runs", "Estimated spend", ""], spend.byRepository.map((r) => [`${esc(r.name)} <span class="muted">${esc(r.key)}</span>`, String(r.runs), usd(r.costUsdEstimate), bar(r.costUsdEstimate, maxRepo)]), [1, 2])
    : empty("No repository in the history.");

  const bySeverity = table(
    ["Severity", "Findings", ""],
    SEVERITY_ORDER.map((s) => [esc(SEVERITY_WORD[s]), String(findings.bySeverity[s]), bar(findings.bySeverity[s], maxSeverity)]),
    [1],
  );
  const byVerdict = table(
    ["Your verdict", "Findings", ""],
    (["correct", "partial", "wrong", "unjudged"] as const).map((v) => [esc(v), String(findings.byVerdict[v]), bar(findings.byVerdict[v], maxVerdict)]),
    [1],
  );

  const loopTable = loops.branches.length
    ? table(
        ["Repository", "Branch", "Rounds", "Outcome", "Exit reason", "Findings seen"],
        loops.branches.map((b) => [esc(b.repository), esc(b.branch), String(b.rounds), esc(b.outcome), esc(b.exitReason), String(b.ledger.total)]),
        [2, 5],
      )
    : empty("No loop kept yet: `wachiman loop --base <ref>` starts one.");

  const confidence =
    prConfidence.status === "recorded"
      ? `${table(["Grade", "Runs"], [...GRADES].reverse().map((g) => [esc(g), String(prConfidence.byGrade[g])]), [1])}<p class="muted">${prConfidence.gradedRuns} graded run${prConfidence.gradedRuns === 1 ? "" : "s"}.</p>`
      : empty(prConfidence.note);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wachiman dashboard</title>
<style>
:root { color-scheme: light dark; --bg: #fbfbf9; --fg: #1d1d1b; --muted: #6b6b66; --line: #dcdcd6; --fill: #2f6f9f; --fill2: #d98c2b; --track: #ecece6; }
@media (prefers-color-scheme: dark) { :root { --bg: #161615; --fg: #ecece8; --muted: #9a9a94; --line: #34342f; --fill: #6fa8d6; --fill2: #e0a458; --track: #262623; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }
main { max-width: 56rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
h2 { font-size: 1.05rem; margin: 2.25rem 0 .5rem; }
p { margin: .25rem 0 .75rem; }
.muted { color: var(--muted); }
.tiles { display: flex; flex-wrap: wrap; gap: 1.5rem; margin: 1.25rem 0 0; }
.tile b { display: block; font-size: 1.6rem; font-weight: 600; font-variant-numeric: tabular-nums; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: .35rem .6rem .35rem 0; border-bottom: 1px solid var(--line); vertical-align: middle; }
th { font-weight: 500; color: var(--muted); font-size: .85rem; }
.num { text-align: right; }
.bar { width: 100%; min-width: 6rem; height: .5rem; display: block; }
.track { fill: var(--track); }
.fill { fill: var(--fill); }
.fill2 { fill: var(--fill2); }
.nodata { fill: var(--muted); opacity: .5; }
.chart { width: 100%; height: auto; display: block; margin: .5rem 0; }
.axis { fill: var(--muted); font-size: 9px; }
.axisline { stroke: var(--line); stroke-width: 1; }
.limit { stroke: #c0392b; stroke-width: 1.5; stroke-dasharray: 5 3; }
code { font: .9em ui-monospace, monospace; }
</style>
</head>
<body>
<main>
<h1>Wachiman dashboard</h1>
<p class="muted">${esc(doc.scope)}</p>
<p class="muted">Generated ${esc(doc.generatedAt)} from ${doc.usage ? "the local history and the ledger entries downloaded earlier" : "the local history. Spend is an API-equivalent estimate, not a bill"}. Nothing on this page was sent anywhere.</p>
<div class="tiles">
${doc.usage ? "" : `<div class="tile"><b>${totals.runs}</b>runs</div>
<div class="tile"><b>${usd(totals.costUsdEstimate)}</b>estimated spend</div>`}
<div class="tile"><b>${totals.repositories}</b>repositories</div>
<div class="tile"><b>${findings.total}</b>findings</div>
<div class="tile"><b>${loops.totals.rounds}</b>loop rounds</div>
</div>
${doc.usage ? renderUsage(doc.usage) : `<h2>Spend per day</h2>
${spendDay}
<h2>Spend per repository</h2>
${spendRepo}
<p class="muted">To include GitHub Actions runs here, connect a ledger: <code>wachiman ledger connect &lt;url&gt;</code>.</p>`}
<h2>Findings by severity</h2>
${bySeverity}
<h2>Findings by your verdict</h2>
${byVerdict}
<h2>Loops</h2>
${loopTable}
<p class="muted">${loops.totals.branches} loop${loops.totals.branches === 1 ? "" : "s"}: ${loops.totals.converged} converged, ${loops.totals.open} open. The loop state keeps only open or converged, so the reason a loop stopped is not recorded.</p>
<h2>PR Confidence grades</h2>
${confidence}
</main>
</body>
</html>
`;
}
