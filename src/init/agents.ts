/**
 * The pointer `wachiman init` writes into the repository's agent instruction file (decision 13 of
 * the repository memory design). It is two or three lines between stable markers: a re-run replaces
 * the block between them and never adds a second one, and text outside the markers is kept byte for
 * byte. The file is `AGENTS.md` when it exists, else `CLAUDE.md` when it exists, else a new
 * `AGENTS.md`. The skill itself is not in the repository; `wachiman skills install` puts it on the
 * developer's machine.
 */
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { relative, sep } from "node:path";
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

/**
 * `file` is the name shown to the person; `writePath` is where the write lands, relative to the
 * repository root (the link's target when `file` is a link that stays inside the repository).
 * `skip` is a pointer that cannot be written, with the reason; it never fails `init`.
 */
export type PointerPlan =
  | { action: "create"; file: string; writePath: string; content: string; inspected: TargetState }
  | { action: "append"; file: string; writePath: string; content: string; inspected: TargetState }
  | { action: "replace"; file: string; writePath: string; content: string; inspected: TargetState }
  | { action: "same"; file: string }
  | { action: "skip"; file: string; reason: string };

const stripCr = (line: string) => line.replace(/\r$/, "");

/**
 * The file with the pointer block in its final form. Markers must each sit alone on a line, and
 * there must be one pair in order; anything else is refused, because a guessed edit could delete
 * the person's own text or leave two blocks.
 */
export function withPointer(current: string, file: string): string {
  const lines = current.split("\n");
  // A file that uses CRLF gets the block with CRLF, so its endings stay uniform.
  const crlf = current.includes("\r\n");
  const eol = crlf ? "\r\n" : "\n";
  const block = pointerBlock().trimEnd().split("\n").join(eol) + eol;
  const begins = lines.flatMap((line, i) => (stripCr(line) === POINTER_BEGIN ? [i] : []));
  const ends = lines.flatMap((line, i) => (stripCr(line) === POINTER_END ? [i] : []));
  if (begins.length === 0 && ends.length === 0) {
    if (current.includes(POINTER_BEGIN) || current.includes(POINTER_END)) {
      throw new UsageError(
        `${file} has a wachiman marker that is not alone on its line; init will not guess where the pointer goes. Put each marker on its own line, or remove it, and run init again.`,
      );
    }
    if (current === "") return block;
    return `${current}${current.endsWith("\n") ? eol : eol + eol}${block}`;
  }
  if (begins.length !== 1 || ends.length !== 1 || ends[0] < begins[0]) {
    throw new UsageError(
      `${file} has ${begins.length} wachiman begin marker(s) and ${ends.length} end marker(s); init needs one pair, begin first. Keep one pair, or remove the block by hand, and run init again.`,
    );
  }
  const before = lines.slice(0, begins[0]);
  const after = lines.slice(ends[0] + 1);
  const endHadCr = lines[ends[0]].endsWith("\r");
  const inner = pointerBlock()
    .trimEnd()
    .split("\n")
    .map((line, i, all) => (i < all.length - 1 ? line + (crlf ? "\r" : "") : line + (endHadCr ? "\r" : "")));
  return [...before, ...inner, ...after].join("\n");
}

/** A dry run does not print the lines when the file is skipped, so the hint carries them. */
export const manualHint = () => `Add this block by hand, or skip it with --no-agent-pointer:\n${pointerBlock().trimEnd()}`;

/**
 * Looks at the file that would hold the pointer, without writing. It never throws: a link out of
 * the repository, a malformed block or any other problem is a `skip` with the reason. A link that
 * stays inside the repository is written through to its target.
 */
export function planPointer(repoDir: string): PointerPlan {
  let file = "AGENTS.md";
  try {
    const exists = (name: string) => {
      try {
        lstatSync(`${repoDir}${sep}${name}`);
        return true;
      } catch {
        return false;
      }
    };
    file = ["AGENTS.md", "CLAUDE.md"].find(exists) ?? "AGENTS.md";
    let writePath = file;
    if (exists(file) && lstatSync(`${repoDir}${sep}${file}`).isSymbolicLink()) {
      const root = realpathSync(repoDir);
      let real: string;
      try {
        real = realpathSync(`${root}${sep}${file}`);
      } catch {
        return { action: "skip", file, reason: `${file} is a symbolic link that does not resolve; init leaves it alone. ${manualHint()}` };
      }
      if (real !== root && !real.startsWith(root + sep)) {
        return {
          action: "skip",
          file,
          reason: `${file} is a symbolic link to ${real}, outside the repository; init does not write there. ${manualHint()}`,
        };
      }
      writePath = relative(root, real).split(sep).join("/");
    }
    const inspected = inspectTarget(repoDir, writePath);
    if (!inspected.exists) return { action: "create", file, writePath, content: withPointer("", file), inspected };
    let current: string;
    try {
      // Strict decoding: a file in another encoding must not be rewritten with replacement characters.
      current = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(readFileSync(inspected.target));
    } catch {
      return { action: "skip", file, reason: `${file} is not valid UTF-8; init does not rewrite it. ${manualHint()}` };
    }
    const content = withPointer(current, file);
    if (content === current) return { action: "same", file };
    return { action: current.includes(POINTER_BEGIN) ? "replace" : "append", file, writePath, content, inspected };
  } catch (error) {
    return { action: "skip", file, reason: `${error instanceof Error ? error.message : String(error)} ${manualHint()}` };
  }
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
    case "skip":
      return [`the wachiman pointer would not be written: ${plan.reason}`];
  }
}
