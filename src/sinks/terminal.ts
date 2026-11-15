/**
 * `--format terminal` (the default): the review as plain text on stdout, no colours, so it reads
 * the same in a pipe, a log or a screen reader. Progress goes to stderr, never here.
 */
import { countLine, neutralise, type ReviewResult } from "../engine";
import { PLAIN_STYLE, renderRiskMap } from "../risk";
import { agentPrompt } from "./agent-prompt";
import {
  coverageText,
  estimateLine,
  historyLabel,
  indent,
  instructionNote,
  location,
  notReviewed,
  plainLabel,
  profileText,
  sections,
  verificationNotes,
  providerLine,
  type SettingsFrom,
  sha7,
  sinceLastRunText,
  stopLine,
  type HistoryAnnotation,
} from "./common";

export function renderTerminal(result: ReviewResult, opts: { profileNote?: string; agentPrompt: boolean; history?: HistoryAnnotation; settingsFrom?: SettingsFrom }): string {
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
  if (result.riskMap) blocks.push(renderRiskMap(result.riskMap, "Risk map:", { style: PLAIN_STYLE }));
  const grouped = sections(result);
  const finding = ({ f, index }: (typeof grouped.main)[number]) => {
    const entry = opts.history?.byIndex.get(index);
    const notes = verificationNotes(f).flatMap((n) => [`${n.name}: ${n.text}`, ...(n.cites ? [`Checked: ${n.cites.join(", ")}`] : [])]);
    return `${location(f)}  ${plainLabel(f)}${entry ? `  ${historyLabel(entry)}` : ""}\n${indent([neutralise(f.body), ...notes].join("\n"), "    ")}`;
  };
  blocks.push(...grouped.main.map(finding));
  if (grouped.inconclusive.length > 0) blocks.push("Inconclusive (the verifier could not settle these):", ...grouped.inconclusive.map(finding));
  if (grouped["pre-existing"].length > 0) blocks.push("Pre-existing (true, but not introduced by this change):", ...grouped["pre-existing"].map(finding));
  if (opts.history) blocks.push(sinceLastRunText(opts.history));
  const missing = notReviewed(result);
  if (missing.length > 0) {
    blocks.push(`Not reviewed:\n${missing.map((f) => `  - ${neutralise(f.path)}${f.reason ? ` (${neutralise(f.reason)})` : ""}`).join("\n")}`);
  }
  if (result.summary) blocks.push(`Summary:\n${indent(neutralise(result.summary), "    ")}`);
  blocks.push([estimateLine(result), stopLine(result), providerLine(result, opts.settingsFrom)].join("\n"));
  if (opts.agentPrompt) blocks.push(agentPrompt(result));
  return `${blocks.join("\n\n")}\n`;
}
