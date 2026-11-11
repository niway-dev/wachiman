/**
 * `--format markdown`: the whole review as one Markdown file. Unlike the GitHub review body it has
 * no size limit, so it holds every finding, and it ends with the prompt for the developer's agent.
 */
import { countLine, neutralise, renderContracts, type ReviewResult } from "../engine";
import { renderRiskMap } from "../risk";
import { agentPrompt } from "./agent-prompt";
import {
  coverageText,
  dollars,
  estimateLine,
  instructionNote,
  location,
  notReviewed,
  markdownLabel,
  profileText,
  providerLine,
  SECTION_TITLES,
  sections,
  verificationNotes,
  sha7,
  sinceLastRunMarkdown,
  stopLine,
  type HistoryAnnotation,
} from "./common";

/** A code fence longer than any run of backticks in `text`. */
function fenced(text: string, info: string) {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${info}\n${text}\n${fence}`;
}

const sentenceCase = (text: string) => `${text[0].toUpperCase()}${text.slice(1)}`;

export function renderMarkdown(result: ReviewResult, opts: { profileNote?: string; history?: HistoryAnnotation } = {}): string {
  const parts: string[] = [];
  parts.push(`# Wachiman review of ${neutralise(result.change.describe)}, at ${sha7(result.change.head.sha)}`);
  parts.push(`${sentenceCase(coverageText(result))}.`, `Profile: ${profileText(result, opts.profileNote)}`, countLine(result.findings));
  const note = instructionNote(result);
  if (note) parts.push(note);
  if (result.riskMap) parts.push(renderRiskMap(result.riskMap, "## Risk map"));
  const grouped = sections(result);
  const finding = ({ f, index }: (typeof grouped.main)[number]) => {
    parts.push(`### ${markdownLabel(f)}`, `\`${location(f)}\``);
    const entry = opts.history?.byIndex.get(index);
    if (entry) {
      const where = entry.status === "new" ? "new" : `open since \`${sha7(entry.firstHead)}\`, ${entry.runs} runs`;
      parts.push(`History: ${where}, id \`${entry.id}\`${entry.verdict ? `, verdict: ${entry.verdict}` : ""}`);
    }
    parts.push(neutralise(f.body));
    for (const n of verificationNotes(f)) {
      parts.push(`${n.name}: ${n.text}`);
      if (n.cites) parts.push(`Checked: ${n.cites.map((c) => `\`${c}\``).join(", ")}`);
    }
  };
  if (grouped.main.length > 0) {
    parts.push("## Findings");
    grouped.main.forEach(finding);
  }
  for (const section of ["inconclusive", "pre-existing"] as const) {
    if (grouped[section].length === 0) continue;
    parts.push(`## ${SECTION_TITLES[section].heading}`, SECTION_TITLES[section].note);
    grouped[section].forEach(finding);
  }
  const missing = notReviewed(result);
  if (missing.length > 0) {
    parts.push("## Not reviewed", missing.map((f) => `- \`${neutralise(f.path)}\`${f.reason ? `: ${neutralise(f.reason)}` : ""}`).join("\n"));
  }
  if (opts.history) parts.push("## Since the last run", sinceLastRunMarkdown(opts.history));
  parts.push("## Summary", neutralise(result.summary || "(no summary)"));
  const contracts = renderContracts(result.contracts);
  if (contracts) parts.push(contracts);
  if (result.batches.length > 0) {
    const rows = result.batches.map(
      (b) => `| ${neutralise(b.label)} | ${b.files} | ${b.lines} | ${b.maxRisk} | ${b.status} | ${b.turns} | ${dollars(b.costUsd)} |`,
    );
    parts.push(
      "## Coverage by batch",
      `| Batch | Files | Lines | Highest risk | Status | Turns | Cost |\n| --- | --- | --- | --- | --- | --- | --- |\n${rows.join("\n")}`,
    );
  }
  if (result.execution.notices.length > 0) {
    parts.push("## Notices", result.execution.notices.map((n) => `- ${neutralise(n)}`).join("\n"));
  }
  parts.push(estimateLine(result), stopLine(result), providerLine(result));
  parts.push("## Prompt for your agent", fenced(agentPrompt(result), "text"));
  return `${parts.join("\n\n")}\n`;
}
