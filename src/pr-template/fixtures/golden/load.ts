import { readFileSync } from "node:fs";
import { join } from "node:path";

/** A file of this directory: the golden templates and the choice the custom one is rendered from. */
export const golden = (name: string) => readFileSync(join(import.meta.dir, name), "utf8");

/** What a repository formatter, an editor and a Windows checkout could do to a generated body: wider cells, wider separators, trailing spaces, extra blank lines. */
export function reformat(text: string): string {
  return text
    .split("\n")
    .map((l) => (/^\| -/.test(l) ? l.replace(/-+/g, (m) => `${m}--`) : l.startsWith("|") ? l.replace(/ \|/g, "     |") : l.length > 0 && l.length % 2 === 0 ? `${l}  ` : l))
    .join("\n")
    .replace(/\n\n/g, "\n\n\n\n");
}
