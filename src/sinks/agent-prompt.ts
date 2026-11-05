/**
 * The "prompt for your agent" block (spec, from Greptile's output idea 1): the review as a task
 * for the developer's own coding agent. Text only; Wachiman launches nothing.
 */
import { neutralise, type ReviewResult } from "../engine";
import { indent, location, plainLabel, sha7 } from "./common";

export const AGENT_PROMPT_INTRO = (sha: string) =>
  `Read the review of ${sha} below. For each finding, open the cited file at the cited line, decide whether it is valid against the current code, and fix the ones that are. Report the ones you reject with the reason. Run the repository's checks after the fixes.`;

export function agentPrompt(result: ReviewResult): string {
  const entries = result.findings.map(
    (f, i) => `${i + 1}. ${location(f)} · ${plainLabel(f)}\n${indent(neutralise(f.body), "   ")}`,
  );
  return [AGENT_PROMPT_INTRO(sha7(result.change.head.sha)), "", ...(entries.length > 0 ? entries : ["The review has no findings."])].join(
    "\n",
  );
}
