/**
 * The pointer `wachiman init` writes into the repository's agent instruction file (decision 13 of
 * the repository memory design). It is two or three lines between stable markers: a re-run replaces
 * the block between them and never adds a second one, and text outside the markers is kept byte for
 * byte. The file is `AGENTS.md` when it exists, else `CLAUDE.md` when it exists, else a new
 * `AGENTS.md`. The skill itself is not in the repository; `wachiman skills install` puts it on the
 * developer's machine.
 */
import { readFileSync } from "node:fs";
import { UsageError } from "../config";
import { inspectTarget, type TargetState } from "./write";

export const POINTER_BEGIN = "<!-- wachiman:begin -->";
export const POINTER_END = "<!-- wachiman:end -->";

const POINTER_TEXT = [
  "Reviews in this repository are run with the `wachiman-loop` skill, which `wachiman skills install` puts in place.",
  "Repository memory lives in `.wachiman/memory/`; the `wachiman-loop` skill says how to change it.",
];

/** The block as the file holds it, with a final newline. */
export const pointerBlock = () => [POINTER_BEGIN, ...POINTER_TEXT, POINTER_END].join("\n") + "\n";

export type PointerPlan =
  | { action: "create"; file: string; content: string; inspected: TargetState }
  | { action: "append"; file: string; content: string; inspected: TargetState }
  | { action: "replace"; file: string; content: string; inspected: TargetState }
  | { action: "same"; file: string };

const stripCr = (line: string) => line.replace(/\r$/, "");

/**
 * The file with the pointer block in its final form. Markers must each sit alone on a line, and
 * there must be one pair in order; anything else is refused, because a guessed edit could delete
 * the person's own text or leave two blocks.
 */
export function withPointer(current: string, file: string): string {
  const lines = current.split("\n");
  const begins = lines.flatMap((line, i) => (stripCr(line) === POINTER_BEGIN ? [i] : []));
  const ends = lines.flatMap((line, i) => (stripCr(line) === POINTER_END ? [i] : []));
  if (begins.length === 0 && ends.length === 0) {
    if (current.includes(POINTER_BEGIN) || current.includes(POINTER_END)) {
      throw new UsageError(`${file} has a wachiman marker that is not alone on its line; init will not guess where the pointer goes. Put each marker on its own line, or remove it, and run init again.`);
    }
    if (current === "") return pointerBlock();
    return `${current}${current.endsWith("\n") ? "\n" : "\n\n"}${pointerBlock()}`;
  }
  if (begins.length !== 1 || ends.length !== 1 || ends[0] < begins[0]) {
    throw new UsageError(`${file} has ${begins.length} wachiman begin marker(s) and ${ends.length} end marker(s); init needs one pair, begin first. Keep one pair, or remove the block by hand, and run init again.`);
  }
  const before = lines.slice(0, begins[0]);
  const after = lines.slice(ends[0] + 1);
  return [...before, ...pointerBlock().trimEnd().split("\n"), ...after].join("\n");
}

/** Looks at the file that would hold the pointer, without writing. Refuses a link there, like the other init writes. */
export function planPointer(repoDir: string): PointerPlan {
  const file = ["AGENTS.md", "CLAUDE.md"].find((name) => inspectTarget(repoDir, name).exists) ?? "AGENTS.md";
  const inspected = inspectTarget(repoDir, file);
  if (!inspected.exists) return { action: "create", file, content: withPointer("", file), inspected };
  const current = readFileSync(inspected.target, "utf8");
  const content = withPointer(current, file);
  if (content === current) return { action: "same", file };
  return { action: current.includes(POINTER_BEGIN) ? "replace" : "append", file, content, inspected };
}

/** What a dry run says the plan would do, on stderr. */
export function describePointer(plan: PointerPlan): string[] {
  const block = pointerBlock().replace(/\n$/, "").split("\n");
  switch (plan.action) {
    case "create":
      return [`would create ${plan.file} with the wachiman pointer:`, ...block.map((l) => `  ${l}`)];
    case "append":
      return [`would add the wachiman pointer to the end of ${plan.file}`];
    case "replace":
      return [`would replace the wachiman pointer in ${plan.file}`];
    case "same":
      return [`${plan.file} already has the wachiman pointer; nothing to write.`];
  }
}
