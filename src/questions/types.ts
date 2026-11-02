/**
 * A review question asked only of batches whose added lines show the pattern it targets.
 * The engine selects questions per batch with `applies`, so a batch without the pattern pays nothing.
 */
export interface DataPathQuestion {
  /** Kebab-case, stable: used in logs and tests. */
  id: string;
  /** One short line, used as the question's heading in the prompt. */
  title: string;
  /** The question itself: at most 120 words, plain prose, no markdown heading. */
  text: string;
  /** True when this batch's added lines (without the leading "+") in `filename` show the pattern. */
  applies(addedLines: string[], filename: string): boolean;
}
