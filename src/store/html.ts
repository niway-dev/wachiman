/**
 * The dashboard as one static HTML file: inline CSS, no script, no font, no image, no link and no
 * request of any kind, so it opens offline from a file. A page security policy (`default-src 'none'`)
 * says the same to the browser. Every string that came from a history file goes through `esc`.
 */
import { GRADES } from "../fidelity/types";
import { SEVERITY_ORDER, type Figures } from "./figures";

export interface DashboardDocument extends Figures {
  format: string;
  generatedAt: string;
  scope: string;
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
:root { color-scheme: light dark; --bg: #fbfbf9; --fg: #1d1d1b; --muted: #6b6b66; --line: #dcdcd6; --fill: #2f6f9f; --track: #ecece6; }
@media (prefers-color-scheme: dark) { :root { --bg: #161615; --fg: #ecece8; --muted: #9a9a94; --line: #34342f; --fill: #6fa8d6; --track: #262623; } }
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
</style>
</head>
<body>
<main>
<h1>Wachiman dashboard</h1>
<p class="muted">${esc(doc.scope)}</p>
<p class="muted">Generated ${esc(doc.generatedAt)} from the local history. Spend is an API-equivalent estimate, not a bill. Nothing on this page was sent anywhere.</p>
<div class="tiles">
<div class="tile"><b>${totals.runs}</b>runs</div>
<div class="tile"><b>${usd(totals.costUsdEstimate)}</b>estimated spend</div>
<div class="tile"><b>${totals.repositories}</b>repositories</div>
<div class="tile"><b>${findings.total}</b>findings</div>
<div class="tile"><b>${loops.totals.rounds}</b>loop rounds</div>
</div>
<h2>Spend per day</h2>
${spendDay}
<h2>Spend per repository</h2>
${spendRepo}
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
