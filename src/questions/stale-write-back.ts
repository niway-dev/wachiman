import type { DataPathQuestion } from "./types";

/**
 * Cached or deferred state written back over someone else's change.
 *
 * Field evidence: kaipu-record #478. A Default workspace was upgraded to the brand colour by
 * writing the cached name and colour to the folder's identity file. A rename made on another Mac
 * was overwritten when the folder was reachable (first review, found by Pullfrog), and again
 * when the upgrade was deferred while the folder was unplugged and written on reconnect (found by
 * CodeRabbit after the first fix). The fix for the first case was reviewed without reading the
 * write the deferred case goes through, because that write sat outside the diff.
 *
 * Trigger (`applies`), all of it over the batch's added lines of one non-test source file:
 *
 * - Rule A, a persistent write fed by remembered state. A line shows a remembered value
 *   (`pendingX`, `deferred`, `cached`, `snapshot`, `stale`, `offline`, `reconnect`, `unplugged`)
 *   and a code line, within WINDOW added lines of it, makes a persistent write (`writeFile`,
 *   `writeIdentity`, `appendFile`, `rename(`, `setItem(`, an SQL `UPDATE ... SET`, `.upsert(`).
 * - Rule B, a comment or code that admits another writer. A line names one ("another Mac",
 *   "other window", "second device") and a line within WINDOW of it shows a remembered value or a
 *   bare `cache`. The write may live in unchanged code (the second #478 round), so no write
 *   is required; the question tells the model to find it.
 *
 * It stays off: non-source files (docs, CSS, JSON, markdown), tests, writes with no remembered
 * value near them, remembered values with no write or other-writer wording near them, and
 * `clipboard.writeText`-style calls. A bare `cache` word alone never counts, because
 * `useQuery`-style code and memoisation use it for in-memory values that nobody else writes.
 * Lines over MAX_LINE characters (minified or generated code) are ignored.
 */

/** How many added lines apart two signals may be and still count as "in the same code". */
const WINDOW = 40;
/** Added lines longer than this are generated or minified; they are skipped. */
const MAX_LINE = 500;

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|py|go|rs|swift|kt|java|rb|php|cs|scala|dart)$/i;
const TEST_FILE =
  /(?:\.(?:test|spec|stories)\.[a-z]+$|_test\.(?:go|py)$|(?:^|\/)(?:__tests__|__mocks__|tests?|specs?|fixtures?|e2e)\/)/i;

/** A value remembered from an earlier moment: pending, deferred, cached, snapshotted, offline. */
const REMEMBERED =
  /\bpending[A-Z_]\w*|\bdeferred\b|\bdeferred[A-Z_]\w*|\bcached\b|\bcached[A-Z_]\w*|\b[a-z]\w*Cached\b|[Ss]napshot\w*|\bstale\b|[Oo]ffline\b|[Rr]econnect\w*|[Uu]nplugged\b/;
/** `cache` as a bare noun counts only next to wording about another writer (rule B). */
const BARE_CACHE = /\bcache\b/i;
const OTHER_WRITER =
  /\b(?:another|other|second|different)\s+(?:mac|pc|computer|device|machine|window|process|tab|user|client|instance|session|laptop|phone)s?\b/i;
/** Persistent writes. `write(?!Text|Head...)[A-Z]` skips the clipboard and HTTP response APIs. */
const PERSISTENT_WRITE =
  /\b(?:write(?!Text\b|Head\b|EarlyHints\b)[A-Z]\w*|appendFile\w*|copyFile\w*|rename|atomicWrite\w*)\s*\(|\.(?:setItem|upsert)\s*\(|\b(?:UPDATE\s+\w+\s+SET|INSERT\s+OR\s+REPLACE|REPLACE\s+INTO)\b/i;

function isComment(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("#");
}

/** True when some index in `marks` lies within WINDOW of `at`. `prefix[i]` counts marks below `i`. */
function near(prefix: number[], at: number): boolean {
  const lo = Math.max(0, at - WINDOW);
  const hi = Math.min(prefix.length - 1, at + WINDOW + 1);
  return prefix[hi]! - prefix[lo]! > 0;
}

function prefixCounts(marks: boolean[]): number[] {
  const prefix = [0];
  for (const m of marks) prefix.push(prefix[prefix.length - 1]! + (m ? 1 : 0));
  return prefix;
}

function applies(addedLines: string[], filename: string): boolean {
  if (!SOURCE_FILE.test(filename) || TEST_FILE.test(filename)) return false;
  const lines = addedLines.map((l) => (l.length > MAX_LINE ? "" : l));
  const remembered = lines.map((l) => REMEMBERED.test(l));
  const rememberedOrCache = lines.map((l, i) => remembered[i]! || BARE_CACHE.test(l));
  const otherWriter = lines.map((l) => OTHER_WRITER.test(l));
  const writes = lines.map((l) => !isComment(l) && PERSISTENT_WRITE.test(l));

  const rememberedNear = prefixCounts(remembered);
  const cacheNear = prefixCounts(rememberedOrCache);
  for (let i = 0; i < lines.length; i++) {
    if (writes[i] && near(rememberedNear, i)) return true; // rule A
    if (otherWriter[i] && near(cacheNear, i)) return true; // rule B
  }
  return false;
}

export const QUESTION: DataPathQuestion = {
  id: "stale-write-back",
  title: "A write that uses values read earlier",
  text: `For each persistent write (a file, a settings store, a database row) whose value comes from a cache, a pending or deferred record, or a snapshot: what can have changed the target since the value was read? Another device on a synced folder, another window, process or user, or the same user while the folder was unplugged or the app offline. Does the write read the target again and compare before writing, or overwrite? Does it write only the fields this change owns, or the whole cached object? Check both paths: target reachable now with a stale cache, and target unreachable now, written when it returns. Name what is lost, and whose change.`,
  applies,
};
