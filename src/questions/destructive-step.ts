import type { DataPathQuestion } from "./types";

/**
 * Field run on kaipu-record (2026-11-02-field in niway-dev/wachiman-benchmarks): the engine flagged the line above an
 * unguarded delete and moved on, three times. The delete ran later than the decision to delete
 * (crash recovery, healing), so nothing proved the target was still the thing meant to go, and a
 * failed delete still dropped the record that would have allowed a retry.
 *
 * FLOW_QUESTIONS item 6 asks what happens when an async call fails; this asks what a destructive
 * call is aimed at and what is lost when it misses or fails, so the two do not overlap.
 */
const TEXT = `For each delete or destructive overwrite these lines add (unlink, rm, rmdir, trash, SQL DELETE, a loop clearing "every other" record), answer from the code:
1. What proves the target is still what this code means to delete? Find a check made since the decision to delete (id, size, mtime or content compared with what was recorded). An earlier check does not count: recovery, heal, retry and cleanup paths run later, when the target may have changed.
2. If the delete fails or its error is swallowed, is the journal or record that allows a retry still dropped, leaving a duplicate or orphan?
3. Does it remove more than this one item, or run when its source is unreadable?`;

/** Calls that delete or destructively overwrite: filesystem, SQL, and the usual helper names. */
const DESTRUCTIVE_CALL = new RegExp(
  [
    // Node / Bun / fs-extra / rimraf / trash, Python, Go, Rust, Java.
    String.raw`\b(?:unlink|rmdir|rm)(?:Sync)?\s*\(`,
    String.raw`\b(?:rimraf|emptyDir)(?:Sync)?\s*\(`,
    String.raw`\b(?:fse|fsExtra)\.remove(?:Sync)?\s*\(`,
    String.raw`\btrash(?:Item)?\s*\(`,
    String.raw`\bos\.(?:remove|rmdir|removedirs)\s*\(`,
    String.raw`\bshutil\.rmtree\s*\(`,
    String.raw`\bos\.Remove(?:All)?\s*\(`,
    String.raw`\bremove_(?:file|dir|dir_all)\s*\(`,
    String.raw`\bFiles\.delete(?:IfExists)?\s*\(`,
    // Helpers named after what they delete, e.g. removeCompanions(), deleteSidecar().
    String.raw`\b(?:delete|remove|purge|wipe)(?:File|Files|Dir|Dirs|Directory|Folder|Record|Records|Sidecar|Companions|Media)\w*\s*\(`,
    // SQL and ORMs. Upper case only for SQL, so prose such as "delete from the list" never matches.
    String.raw`\bDELETE\s+FROM\b`,
    String.raw`\bTRUNCATE\s+TABLE\b`,
    String.raw`\b(?:deleteMany|deleteFrom)\s*\(`,
  ].join("|"),
);

/** A "clear every other ..." step: a clear/reset/wipe/purge call made inside a loop. */
const CLEAR_CALL = /\b(?:clear|reset|wipe|purge)[A-Z]\w*\s*\(/g;
const NOT_A_DATA_CLEAR = /^(?:clear|reset)(?:Timeout|Interval|Immediate|AnimationFrame|Idle|Form|Focus|Selection|Error|Filters?|Search|Input|Cache)/;
const LOOP_HEADER = /\b(?:for|while)\s*\(|\.(?:forEach|map|flatMap)\s*\(|\bfor\s+\w+\s+in\b/;
/** How many added lines above a clear call may hold the loop header. */
const LOOP_WINDOW = 3;

/** Only source files: docs, styles, config and shell scripts say "rm" without deleting user data. */
const CODE_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte|py|rb|go|rs|java|kt|cs|swift|php|sql)$/;
/**
 * Tests are excluded: they delete temp dirs in cleanup hooks, and the question is about production
 * data paths. A batch that holds only test files therefore pays nothing.
 */
const TEST_FILE = /(?:\.(?:test|spec)\.|(?:^|\/)(?:__tests__|tests?|e2e|fixtures?|__mocks__)\/|_test\.(?:go|py)$|(?:^|\/)test_[^/]*\.py$)/;

const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|#|--)/;

function isClearInLoop(code: string[], index: number): boolean {
  const matches = code[index]!.match(CLEAR_CALL);
  if (!matches || matches.every((m) => NOT_A_DATA_CLEAR.test(m))) return false;
  for (let i = Math.max(0, index - LOOP_WINDOW); i <= index; i++) {
    if (LOOP_HEADER.test(code[i]!)) return true;
  }
  return false;
}

export const QUESTION: DataPathQuestion = {
  id: "destructive-step",
  title: "Destructive steps that do not re-verify their target",
  text: TEXT,
  applies(addedLines, filename) {
    if (!CODE_FILE.test(filename) || TEST_FILE.test(filename)) return false;
    const code = addedLines.filter((line) => !COMMENT_LINE.test(line));
    return code.some((line, i) => DESTRUCTIVE_CALL.test(line) || isClearInLoop(code, i));
  },
};
