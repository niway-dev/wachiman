import type { DataPathQuestion } from "./types";

/**
 * Pattern: a read error treated as "empty", then written back. A `catch` (or `.catch(() => …)`)
 * around a file or store read returns a default (empty map, `{}`, `[]`, a fresh store) while the
 * same value is persisted elsewhere. "Missing" (ENOENT) and "present but unreadable" (EACCES, EIO,
 * EBUSY, a cloud placeholder not downloaded, a lock) are different, and writing the empty default
 * over an unreadable file destroys the real data. Corrupt-JSON handling does not cover it.
 * Origin: kaipu-record #482, `MachineSettingsStore.open` (`catch { return store; }`).
 *
 * The trigger sees one file's added lines of one batch, so it is a regex over lines:
 *  1. a read call (`readFile`, `readJson`, `Bun.file(`, `getItem`, `loadX(`…) sits in a `try`
 *     whose `catch` returns, assigns an empty default, or does nothing but log; or on the same
 *     `.catch(() => …)` chain; and
 *  2. that catch does not rethrow, check an error code (ENOENT…), or return an error result; and
 *  3. the same added lines also call a write (`writeFile`, `atomicWriteFile`, `save…`, `this.write(`…).
 *
 * Trade-off for (3): the write must be in the same added lines, in any order. A catch added to an
 * existing store whose write is unchanged context is missed, which is the price of not sending
 * this question with every config loader that falls back to defaults and never writes. Widening
 * the trigger would need the file's unchanged lines, which `applies` does not receive.
 */

const CODE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/i;

const READ =
  /\b(?:read[A-Za-z]*|load[A-Z][A-Za-z]*|getItem)\s*\(|\bBun\.file\s*\(|\b(?:fs|fsp|promises)\.[a-z]*[Rr]ead[A-Za-z]*\s*\(/;

const WRITE =
  /\b(?:write[A-Z]\w*|atomicWrite\w*|appendFile\w*|outputFile\w*|copyFile\w*|save[A-Z]?\w*|persist\w*|setItem)\s*\(|(?<![.\w])write\s*\(|\bBun\.write\s*\(|\b(?:this|self)\.(?:write|save|persist|flush|commit)\w*\s*\(/;

/** The author separated the cases, or the catch reports the failure instead of defaulting. */
const HANDLED =
  /\bthrow\b|\bENOENT\b|\bEACCES\b|\bEIO\b|\bEBUSY\b|\.code\b|\berrno\b|\bunreadable\b|\bNotFound\b|\breject\b|\bok\s*:\s*false\b|\b[Ee]rr\s*\(|\berror\s*:|\bnew\s+\w*Error\b/;

const EMPTY_DEFAULT = /=\s*(?:\{\s*\}|\[\s*\]|null\b|undefined\b|new\s+(?:Map|Set)\b|""|''|``)/;

/** Blank out whole-line and trailing `//` comments so prose never counts as code. */
function stripComments(line: string): string {
  const t = line.trim();
  if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return "";
  return line.replace(/(?:^|\s)\/\/.*$/, "");
}

function removeLogging(body: string): string {
  return body.replace(/\b(?:console|logger|log)\.\w+\s*\([^)]*\)\s*;?/g, "");
}

/** Text from `start` of line `i` to the brace that closes the block opened at `start`. */
function blockBody(lines: string[], i: number, start: number): string {
  let depth = 0;
  let out = "";
  for (let n = i; n < Math.min(lines.length, i + 12); n++) {
    const text = n === i ? lines[n].slice(start) : lines[n];
    for (const ch of text) {
      if (ch === "{") {
        depth++;
        if (depth === 1) continue;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) return out;
      }
      if (depth >= 1) out += ch;
    }
    out += "\n";
  }
  return out;
}

/** True when a catch body falls back to a value instead of reporting the failure. */
function defaultsOnError(body: string, expression = false): boolean {
  if (HANDLED.test(body)) return false;
  // `.catch(() => value)`: whatever the arrow evaluates to replaces the read, unless it exits.
  if (expression) return body.trim() !== "" && !/\b(?:exit|abort)\b/.test(body);
  const rest = removeLogging(body).replace(/[\s;{}]/g, "");
  return rest === "" || /\breturn\b/.test(body) || EMPTY_DEFAULT.test(body);
}

/** The lines that make up the try (or the call chain) a catch at line `c` belongs to. */
function guardedCode(lines: string[], c: number): string {
  let from = Math.max(0, c - 8);
  for (let n = c; n >= from; n--) {
    if (/\btry\s*\{/.test(lines[n])) {
      from = n;
      break;
    }
  }
  return lines.slice(from, c + 1).join("\n");
}

/** The lines of a method chain that ends on line `c`. */
function chainOf(lines: string[], c: number): string {
  let from = c;
  while (from > 0 && c - from < 4 && !/[;{}]\s*$/.test(lines[from - 1])) from--;
  return lines.slice(from, c + 1).join("\n");
}

function readFailureDefaults(lines: string[]): boolean {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const block = /\bcatch\s*(?:\([^)]*\))?\s*\{/.exec(line);
    if (block) {
      const open = line.indexOf("{", block.index);
      if (READ.test(guardedCode(lines, i)) && defaultsOnError(blockBody(lines, i, open))) {
        return true;
      }
    }
    const callback = /\.catch\s*\(\s*(?:\([^)]*\)|\w+)?\s*=>\s*/.exec(line);
    if (callback && READ.test(chainOf(lines, i))) {
      const after = callback.index + callback[0].length;
      if (line[after] === "{") {
        if (defaultsOnError(blockBody(lines, i, after))) return true;
      } else if (defaultsOnError(line.slice(after).replace(/\)\s*;?\s*$/, ""), true)) {
        return true;
      }
    }
  }
  return false;
}

export const QUESTION: DataPathQuestion = {
  id: "read-error-as-empty",
  title: "An unreadable file treated as empty, then written back",
  text: `For each new or changed read of a file, store or cache whose value is written back later: does the failure handling tell a missing file (ENOENT: empty is right) from one that exists but cannot be read (EACCES, EIO, EBUSY, a cloud placeholder not yet downloaded, a lock, a timeout)? If a \`catch\` or \`.catch\` returns an empty default for every error, find the write that persists that value (an update, save or copy) and say what it overwrites. Unreadable must refuse or retry, never become the empty value. Handling corrupt JSON does not cover this. When it fails, report a finding naming the read, the write and the data lost.`,
  applies(addedLines, filename) {
    if (!CODE_FILE.test(filename)) return false;
    const lines = addedLines.map(stripComments);
    if (!lines.some((l) => WRITE.test(l))) return false;
    return readFailureDefaults(lines);
  },
};
