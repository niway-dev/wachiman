/**
 * `--format terminal` (the default): the review as plain text on stdout, no colours, so it reads
 * the same in a pipe, a log or a screen reader. Progress goes to stderr, never here.
 */
import { countLine, neutralise, type ReviewResult } from "../engine";
import { agentPrompt } from "./agent-prompt";
import {
  coverageText,
  estimateLine,
  indent,
  instructionNote,
  location,
  notReviewed,
  plainLabel,
  profileText,
  providerLine,
  sha7,
  stopLine,
} from "./common";

export function renderTerminal(result: ReviewResult, opts: { profileNote?: string; agentPrompt: boolean }): string {
  const blocks: string[] = [];
  blocks.push(
    [
      `Wachiman · review of ${neutralise(result.change.describe)}, at ${sha7(result.change.head.sha)}: ${coverageText(result)}.`,
      `profile: ${profileText(result, opts.profileNote)}`,
      countLine(result.findings),
    ].join("\n"),
  );
  const note = instructionNote(result);
  if (note) blocks.push(note);
  for (const f of result.findings) blocks.push(`${location(f)}  ${plainLabel(f)}\n${indent(neutralise(f.body), "    ")}`);
  const missing = notReviewed(result);
  if (missing.length > 0) {
    blocks.push(`Not reviewed:\n${missing.map((f) => `  - ${neutralise(f.path)}${f.reason ? ` (${neutralise(f.reason)})` : ""}`).join("\n")}`);
  }
  if (result.summary) blocks.push(`Summary:\n${indent(neutralise(result.summary), "    ")}`);
  blocks.push([estimateLine(result), stopLine(result), providerLine(result)].join("\n"));
  if (opts.agentPrompt) blocks.push(agentPrompt(result));
  return `${blocks.join("\n\n")}\n`;
}
