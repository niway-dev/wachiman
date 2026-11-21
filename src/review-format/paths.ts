/**
 * How the review body names a file (spec "The review body", decision 19). A location shows the file
 * name and the line, not the whole path: the table is narrow, and a path of five directories says
 * less than its last name. The link carries the full path, so the short text is never the only
 * address. Two rules keep the short text honest: a very long name is shortened to its first and
 * last words, and two different files that would show the same text each show the shortest
 * directory suffix that tells them apart.
 */

/** A displayed name longer than this is shortened. */
export const MAX_NAME = 40;

/** A name with at least two separators: first word, separator, middle, separator, last word (which keeps the extension). */
const WORDS = /^([^-_]+)([-_])(.*)([-_])([^-_]+)$/s;

/**
 * `0051-…-wachiman.md` for `0051-a-pull-request-…-come-from-wachiman.md`: the first and the last
 * word around an ellipsis, with the joiners the name had. A name with no words to drop, or one
 * whose first and last words alone pass the limit, keeps both ends of itself instead.
 */
export function shortName(name: string): string {
  if (name.length <= MAX_NAME) return name;
  const words = WORDS.exec(name);
  if (words) {
    const [, first, joinFirst, , joinLast, last] = words;
    const short = `${first}${joinFirst}…${joinLast}${last}`;
    if (short.length <= MAX_NAME) return short;
  }
  const head = Math.floor((MAX_NAME - 1) / 2);
  return `${name.slice(0, head)}…${name.slice(name.length - (MAX_NAME - 1 - head))}`;
}

/** The last `depth` segments of `path`, the file name shortened. */
function suffix(segments: string[], depth: number): string {
  const kept = segments.slice(-depth);
  kept[kept.length - 1] = shortName(kept[kept.length - 1]);
  return kept.join("/");
}

/**
 * The text each path shows, keyed by the full path. Without a collision it is the shortened file name.
 * When two different paths would show the same text, each of them takes one more directory until
 * the texts differ, so `src/init/run.ts` and `src/setup/run.ts` show `init/run.ts` and
 * `setup/run.ts`, and a path that no other collides with keeps its short name. Pass every path the
 * body shows, whatever slot it is in: the rule is about one body.
 */
export function displayPaths(paths: Iterable<string>): Map<string, string> {
  const unique = [...new Set(paths)];
  const segments = new Map(unique.map((p) => [p, p.split("/")]));
  const depth = new Map(unique.map((p) => [p, 1]));
  const shown = () => new Map(unique.map((p) => [p, suffix(segments.get(p) as string[], depth.get(p) as number)]));
  for (;;) {
    const now = shown();
    const byText = new Map<string, string[]>();
    for (const [path, text] of now) byText.set(text, [...(byText.get(text) ?? []), path]);
    let widened = false;
    for (const group of byText.values()) {
      if (group.length < 2) continue;
      for (const path of group) {
        if ((depth.get(path) as number) < (segments.get(path) as string[]).length) {
          depth.set(path, (depth.get(path) as number) + 1);
          widened = true;
        }
      }
    }
    // Nothing left to widen: the remaining texts are as distinct as the paths allow.
    if (!widened) return now;
  }
}

/** `run.ts:12`, or `run.ts` for a finding about the whole file (line 0). */
export const displayLocation = (display: string, line: number) => (line > 0 ? `${display}:${line}` : display);
