import type { DataPathQuestion } from "./types.ts";

/**
 * Trigger rule. The question applies to a batch only when ALL of these hold for one file:
 *
 * 1. The file is source code (ts, tsx, js, jsx, mjs, cjs, mts, cts, py) and not a test, a
 *    declaration file or a story: tests set up caches and stores on purpose.
 * 2. The added lines contain a suspension point: `await` (outside a comment line).
 * 3. The added lines also write shared state that outlives one call:
 *    - a field of the instance: `this.reads.set(...)`, `this.key.activeId = id`, `this.cache = {...}`
 *      (a plain constructor injection such as `this.deps = deps` or `this.x = new Map()` does not count);
 *    - a store-like name mutated by call or index: `cache.set(...)`, `registry.delete(...)`,
 *      `workspaceGate().rebind(...)`, `pendingByKey[key] = ...`;
 *    - a file or persistent write: `writeFile`, `appendFile`, `rename`, `unlink`, `Bun.write`,
 *      `writeSomething(...)`, `persist(...)`, `write_text`.
 *
 * What keeps it narrow: a React component that awaits `fetch` and calls `setState` or `setData`
 * has no store-like write; a pure async helper only assigns local variables; CSS, markdown and
 * JSON files are rejected by the extension. The order of the await and the write is not checked,
 * because both "read, await, write back" and "write, await, roll back" are exposed.
 */
const CODE_FILE = /\.(?:[cm]?[jt]s|[jt]sx|py)$/i;
const SKIPPED_FILE = /(?:\.d\.ts$|\.(?:test|spec|stories)\.[a-z]+$|(?:^|\/)(?:__tests__|__mocks__|tests?)\/)/i;
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|#)/;
const AWAIT = /\bawait\b/;

const STORE_WORD = "(?:cache|store|registry|gate|map|queue|pending|inflight|memo|reads|sessions|tokens)";
const SHARED_WRITES: RegExp[] = [
  // this.reads.set(...), this.items.push(...), this.machine.update(...)
  /\bthis\.[\w$]+(?:\.[\w$]+)*\.(?:set|delete|clear|add|push|unshift|splice|pop|shift|update|commit|rebind)\(/,
  // this.key.activeId = id, this.cache[id] = x, this.total += n
  /\bthis\.[\w$]+(?:\.[\w$]+|\[[^\]\n]+\])+\s*(?:[-+*|&?]{0,2}=)(?![=>])/,
  // this.cache = {}, this.last = compute(); not this.deps = deps, not this.x = new Map()
  /\bthis\.[\w$]+\s*(?:[-+*|&?]{0,2}=)(?![=>])\s*(?!new\b)(?![\w$]+\s*;?\s*$)\S/,
  // cache.set(...), workspaceGate().rebind(...), store.delete(...)
  new RegExp(
    `\\b[\\w$]*${STORE_WORD}[\\w$]*(?:\\(\\))?\\s*\\.(?:set|delete|clear|add|push|splice|update|commit|rebind|remove|reset)\\(`,
    "i",
  ),
  // pendingByKey[key] = ..., cache[id] = ...
  new RegExp(`\\b[\\w$]*${STORE_WORD}[\\w$]*\\[[^\\]\\n]+\\]\\s*(?:[-+*|&?]{0,2}=)(?![=>])`, "i"),
  // files and persistent writes
  /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|rename|renameSync|unlink|unlinkSync|copyFile|truncate|outputFile|writeJson|persist\w*|write_text|write_bytes)\s*\(/,
  /\bBun\.write\s*\(/,
  /\bwrite[A-Z][\w$]*\s*\(/,
];

export const QUESTION: DataPathQuestion = {
  id: "overlapping-calls",
  title: "Two calls in flight at once",
  text: `For each async function here that reads shared state (a cache, map, file or store), awaits, and
then writes it back, run two calls for the same key that overlap: A starts, B starts, then the awaits
resume. Does B's write drop A's change, does an older read land after a newer write, or does a record
end up out of order (a file left "pending")? Is there a per-key lock, queue or serialized tail, and
do all writers and refreshers of that state go through it, or only this one? A check made before an
await: is it still true after it? Answer from the code and cite the lines.`,
  applies(addedLines, filename) {
    if (!CODE_FILE.test(filename) || SKIPPED_FILE.test(filename)) return false;
    const code = addedLines.filter((line) => !COMMENT_LINE.test(line));
    if (!code.some((line) => AWAIT.test(line))) return false;
    return code.some((line) => SHARED_WRITES.some((write) => write.test(line)));
  },
};
