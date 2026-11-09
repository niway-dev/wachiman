/**
 * The two outputs of `wachiman doctor`: text for a person, `wachiman.doctor/1` JSON for a tool,
 * and the `--redact-paths` pass that both go through (command contract 5.6).
 */
import { resolve } from "node:path";
import type { CheckStatus, DoctorReport, DoctorRow } from "./checks";

export const PROMISE =
  "Local mode: no telemetry and no GitHub requests by Wachiman; the code goes to the Claude account of the chosen profile. https://code.claude.com/docs/en/legal-and-compliance";

export const renderJson = (report: DoctorReport) => `${JSON.stringify(report, null, 2)}\n`;

const MARK: Record<CheckStatus, string> = { ok: "✓", fail: "✗", warn: "!", skip: "·" };

const label = (r: DoctorRow) => (typeof r.detail?.profile === "string" ? `${r.id}[${r.detail.profile}]` : r.id);

/** One row as it reads in the text output, with its fix on the next line. */
export function renderRow(r: DoctorRow, width: number) {
  const lines = [`  ${MARK[r.status]} ${label(r).padEnd(width)}  ${r.evidence}`];
  if (r.fix && r.status !== "ok") lines.push(`  ${" ".repeat(width + 3)}  fix: ${r.fix}`);
  return lines;
}

export function renderText(report: DoctorReport) {
  const first = report.checks.find((r) => r.id === "wachiman");
  const path = typeof first?.detail?.path === "string" ? first.detail.path : "";
  const header = `Wachiman ${report.version} (${[report.install, path, report.platform, `tier ${report.tier}`].filter(Boolean).join(", ")})`;
  const width = Math.max(...report.checks.map((r) => label(r).length));
  const lines = [header, PROMISE, ""];
  for (const [title, level] of [["Required", "required"], ["Optional", "optional"]] as const) {
    lines.push(title);
    for (const r of report.checks.filter((c) => c.level === level)) lines.push(...renderRow(r, width));
    lines.push("");
  }
  lines.push(report.failedRequired > 0 ? `${report.failedRequired} required check(s) failed.` : "All required checks passed.", "");
  return lines.join("\n");
}

const URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s,;()"'`]+/gi;
// A complete path: absolute, not the tail of something else (`src/a`, `https://x/y`).
const PATH = /(?<![\w.:/\\-])((?:[A-Za-z]:\\|\/)[^\s,;()"'`]+)/g;

/**
 * Replaces every complete path with a stable placeholder (`<home-path-1>` under the Wachiman or the
 * user's home, `<external-path-1>` elsewhere) and every URL with `<remote>`, in evidence, fix text
 * and string details alike. The same path is the same placeholder wherever it appears.
 */
export function redactReport(report: DoctorReport, where: { home: string; userHome: string }): DoctorReport {
  const seen = { home: new Map<string, number>(), external: new Map<string, number>() };
  const roots = [resolve(where.home), resolve(where.userHome)];
  const holder = (path: string) => {
    const under = roots.some((root) => path === root || path.startsWith(`${root}/`) || path.startsWith(`${root}\\`));
    const kind = under ? "home" : "external";
    const map = seen[kind];
    if (!map.has(path)) map.set(path, map.size + 1);
    return `<${kind}-path-${map.get(path)}>`;
  };
  const shorten = (whole: string) => {
    const trailing = whole.match(/[.:]+$/)?.[0] ?? "";
    return holder(trailing ? whole.slice(0, -trailing.length) : whole) + trailing;
  };
  // A known root is matched as a literal prefix, so a space inside it (`/Users/Jane Doe`) does not end the path.
  const known = [...new Set(roots)]
    .sort((a, b) => b.length - a.length)
    .map((root) => new RegExp(`(?<![\\w.:/\\\\-])${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![^\\s/\\\\,;()"'\`])[^\\s,;()"'\`]*`, "g"));
  const clean = (text: string) => known.reduce((t, re) => t.replace(re, shorten), text.replace(URL, "<remote>")).replace(PATH, shorten);
  return {
    ...report,
    checks: report.checks.map((r) => ({
      ...r,
      evidence: clean(r.evidence),
      ...(r.fix !== undefined ? { fix: clean(r.fix) } : {}),
      ...(r.detail ? { detail: Object.fromEntries(Object.entries(r.detail).map(([k, v]) => [k, typeof v === "string" ? clean(v) : v])) } : {}),
    })),
  };
}
