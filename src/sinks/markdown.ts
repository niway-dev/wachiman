/**
 * `--format markdown`: the whole review as one Markdown file. Unlike the GitHub review body it has
 * no size limit, so it holds every finding, and it ends with the prompt for the developer's agent.
 */
import { countLine, label, neutralise, renderContracts, type ReviewResult } from "../engine";
import { agentPrompt } from "./agent-prompt";
import {
  coverageText,
  estimateLine,
  instructionNote,
  location,
  notReviewed,
  profileText,
  providerLine,
  sha7,
  stopLine,
} from "./common";

/** A code fence longer than any run of backticks in `text`. */
function fenced(text: string, info: string) {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${info}\n${text}\n${fence}`;
}

const sentenceCase = (text: string) => `${text[0].toUpperCase()}${text.slice(1)}`;

export function renderMarkdown(result: ReviewResult, opts: { profileNote?: string } = {}): string {
  const parts: string[] = [];
  parts.push(`# Wachiman review of ${neutralise(result.change.describe)}, at ${sha7(result.change.head.sha)}`);
  parts.push(`${sentenceCase(coverageText(result))}.`, `Profile: ${profileText(result, opts.profileNote)}`, countLine(result.findings));
  const note = instructionNote(result);
  if (note) parts.push(note);
  if (result.findings.length > 0) {
    parts.push("## Findings");
    for (const f of result.findings) {
      parts.push(`### ${label(f)}`, `\`${location(f)}\``, neutralise(f.body));
      if (f.verification) {
        const v = f.verification;
        parts.push(`Verified: ${neutralise(v.checked)}${v.example ? ` — ${neutralise(v.example)}` : ""}`);
      }
    }
  }
  const missing = notReviewed(result);
  if (missing.length > 0) {
    parts.push("## Not reviewed", missing.map((f) => `- \`${neutralise(f.path)}\`${f.reason ? `: ${neutralise(f.reason)}` : ""}`).join("\n"));
  }
  parts.push("## Summary", neutralise(result.summary || "(no summary)"));
  const contracts = renderContracts(result.contracts);
  if (contracts) parts.push(contracts);
  if (result.batches.length > 0) {
    const rows = result.batches.map(
      (b) => `| ${neutralise(b.label)} | ${b.files} | ${b.lines} | ${b.maxRisk} | ${b.status} | ${b.turns} | $${b.costUsd.toFixed(2)} |`,
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
