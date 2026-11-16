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
 * Test files never trigger it (see TEST_FILE).
 *
 * Trade-off for (3): the write must be in the same added lines, in any order. A catch added to an
 * existing store whose write is unchanged context is missed, which is the price of not sending
 * this question with every config loader that falls back to defaults and never writes. Widening
 * the trigger would need the file's unchanged lines, which `applies` does not receive.
 */

const CODE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
/**
 * Tests read and write fixtures on purpose. On the seven kaipu-record data PRs two of the four
 * firings were test files; the question is about production data paths, so they are excluded.
 */
const TEST_FILE = /(?:\.(?:test|spec)\.[a-z]+$|(?:^|\/)(?:__tests__|__mocks__|tests?|e2e|fixtures?)\/)/i;

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

/** A `/` after one of these (or at the start) begins a regex literal; after an operand it divides. */
const REGEX_CAN_FOLLOW = "(,=:[!&|?{};";

/**
 * End of the string, template, regex literal or comment that starts at `i`, or -1 when none does
 * (or it never ends). `prev` is the last significant character before `i`. A template's `${ }`
 * holds code, so it is scanned like the rest and may nest. This is a scanner for the shapes that
 * hide parentheses, not a parser: no other syntax is interpreted.
 */
function skipLiteral(text: string, i: number, prev: string): number {
  const ch = text[i];
  if (ch === "'" || ch === '"') {
    for (let n = i + 1; n < text.length; n++) {
      if (text[n] === "\\") n++;
      else if (text[n] === ch) return n + 1;
      else if (text[n] === "\n") return -1;
    }
    return -1;
  }
  if (ch === "`") {
    for (let n = i + 1; n < text.length; n++) {
      if (text[n] === "\\") n++;
      else if (text[n] === "`") return n + 1;
      else if (text[n] === "$" && text[n + 1] === "{") {
        n = endOfCode(text, n + 2);
        if (n === -1) return -1;
        n--; // the loop steps past the closing brace
      }
    }
    return -1;
  }
  if (ch !== "/") return -1;
  if (text[i + 1] === "/") {
    const eol = text.indexOf("\n", i);
    return eol === -1 ? text.length : eol;
  }
  if (text[i + 1] === "*") {
    const close = text.indexOf("*/", i + 2);
    return close === -1 ? -1 : close + 2;
  }
  if (prev !== "" && !REGEX_CAN_FOLLOW.includes(prev)) return -1;
  let inClass = false;
  for (let n = i + 1; n < text.length; n++) {
    const c = text[n];
    if (c === "\n") return -1;
    if (c === "\\") n++;
    else if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) {
      let end = n + 1;
      while (end < text.length && /[a-z]/i.test(text[end])) end++;
      return end;
    }
  }
  return -1;
}

/** Index just past the `}` that closes a `${` whose code starts at `from`; -1 if it never closes. */
function endOfCode(text: string, from: number): number {
  let depth = 1;
  let prev = "{";
  for (let i = from; i < text.length; i++) {
    const lit = skipLiteral(text, i, prev);
    if (lit !== -1) {
      i = lit - 1;
      prev = "a";
    } else if (text[i] === "{") {
      depth++;
      prev = "{";
    } else if (text[i] === "}") {
      if (--depth === 0) return i + 1;
      prev = "}";
    } else if (!/\s/.test(text[i])) prev = text[i];
  }
  return -1;
}

/** Index just past the `)` that closes the call opened at `open`; -1 if it never closes. */
function endOfCall(text: string, open: number): number {
  let depth = 0;
  let prev = "";
  for (let i = open; i < text.length; i++) {
    const lit = skipLiteral(text, i, prev);
    if (lit !== -1) {
      i = lit - 1;
      if (text[i] !== "/" || text[i - 1] !== "*") prev = "a"; // a comment leaves `prev` as it was
      continue;
    }
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i + 1;
    if (!/\s/.test(text[i])) prev = text[i];
  }
  return -1;
}

const LOG_CALL = /(?:console|logger|log)\.\w+\s*\(/y;

/** `body` without its logging calls (and the comments outside them), so logging never counts as handling. */
function removeLogging(body: string): string {
  let out = "";
  let prev = "";
  for (let i = 0; i < body.length; i++) {
    const lit = skipLiteral(body, i, prev);
    if (lit !== -1) {
      const comment = body[i] === "/" && (body[i + 1] === "/" || body[i + 1] === "*");
      out += comment ? " " : body.slice(i, lit);
      if (!comment) prev = "a";
      i = lit - 1;
      continue;
    }
    if (/\W/.test(body[i - 1] ?? " ")) {
      LOG_CALL.lastIndex = i;
      const m = LOG_CALL.exec(body);
      const end = m ? endOfCall(body, i + m[0].length - 1) : -1;
      if (end !== -1) {
        i = end - 1;
        const tail = /^\s*;?/.exec(body.slice(end));
        if (tail) i += tail[0].length;
        continue;
      }
    }
    out += body[i];
    if (!/\s/.test(body[i])) prev = body[i];
  }
  return out;
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
  // Logging is not handling: `logger.error({ error })` names the error and the value is still empty.
  const quiet = removeLogging(body);
  if (HANDLED.test(quiet)) return false;
  // `.catch(() => value)`: whatever the arrow evaluates to replaces the read, unless it exits.
  if (expression) return body.trim() !== "" && !/\b(?:exit|abort)\b/.test(body);
  const rest = quiet.replace(/[\s;{}]/g, "");
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
    if (!CODE_FILE.test(filename) || TEST_FILE.test(filename)) return false;
    const lines = addedLines.map(stripComments);
    if (!lines.some((l) => WRITE.test(l))) return false;
    return readFailureDefaults(lines);
  },
};
