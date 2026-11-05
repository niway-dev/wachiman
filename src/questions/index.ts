/**
 * The data-path questions and the rule that picks them per batch (ADR 0014).
 *
 * A question is asked of a batch only when one of the batch's files shows its pattern in the
 * lines the pull request adds, so a batch without the pattern pays nothing. The choice is made
 * by the engine from text, never by the model (ADR 0009).
 */
import type { ReviewFile } from "../engine";
import { addedLinesOf } from "../evidence";
import { QUESTION as boundedWait } from "./bounded-wait";
import { QUESTION as destructiveStep } from "./destructive-step";
import { QUESTION as overlappingCalls } from "./overlapping-calls";
import { QUESTION as readErrorAsEmpty } from "./read-error-as-empty";
import { QUESTION as staleWriteBack } from "./stale-write-back";
import type { DataPathQuestion } from "./types";

export type { DataPathQuestion } from "./types";

/** The order here is the order of the prompt section and of the log line: never sort it. */
export const QUESTIONS: readonly DataPathQuestion[] = [
  destructiveStep,
  readErrorAsEmpty,
  overlappingCalls,
  boundedWait,
  staleWriteBack,
];

/**
 * The questions that apply to at least one of `files`, each once, in registry order. A file with
 * no patch (binary, or too large for GitHub to send) has no added lines and selects nothing.
 */
export function selectQuestions(files: ReviewFile[]): DataPathQuestion[] {
  const added = files.map((f) => ({ filename: f.filename, lines: addedLinesOf(f.patch) }));
  return QUESTIONS.filter((q) => added.some((f) => f.lines.length > 0 && q.applies(f.lines, f.filename)));
}

/**
 * The prompt section for the selected questions, with a leading blank line so it can follow
 * `FLOW_QUESTIONS` directly; an empty string when none was selected, which leaves the prompt as
 * it was before these questions existed.
 */
export function renderDataPathQuestions(questions: readonly DataPathQuestion[]): string {
  if (questions.length === 0) return "";
  const body = questions.map((q) => `### ${q.title}\n\n${q.text}`).join("\n\n");
  return `

## Risks this part's added lines show

The added lines of this part contain the patterns the questions below ask about. Answer each from
the code, reading the unchanged files it points to, and record the answer as one entry of
\`contracts\`, like the questions above. When an answer shows a defect, report it as a finding as
well. A question whose pattern turns out not to apply to this code needs no entry.

${body}`;
}
