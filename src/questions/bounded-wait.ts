import type { DataPathQuestion } from "./types";

/**
 * "A wait with no overall bound": a probe, poll, retry, per-item check or loop of awaits whose
 * individual calls are bounded but whose total is not. The evidence is three kaipu-record pull
 * requests (a capture-start probe outside its 2 s race, a Library listing whose per-batch 5 s
 * timeout multiplies across batches, and a deadline checked only between batches). The pattern
 * the model tends to miss is accepting a constant that looks like a bound without asking what it
 * bounds, so the question tells it what to compare. FLOW_QUESTIONS item 6 already asks "times out
 * or never delivers"; this adds the "what bounds the whole operation" check.
 *
 * Trigger (all pure regex over lines; no I/O):
 * - the file is non-test source code: a code extension, not a test, mock, fixture or story path,
 *   and not .tsx/.jsx (components are where debounces, animations and toasts live);
 * - at least one added line, ignoring comment-only lines and lines about UI timing
 *   (debounce, throttle, animation, transition, toast, tooltip, hover), has a wait-bound signal:
 *   `Promise.race`, `AbortSignal.timeout`, an identifier or option with "timeout" or "deadline"
 *   in it (`READ_TIMEOUT_MS`, `{ timeout: ... }`, `deadlineMs`), or a probe/poll/retry/backoff.
 *
 * Before matching, `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval` and handle names
 * such as `timeoutId` are blanked, so a bare `setTimeout(fn, 300)` is not a signal on its own:
 * the delay has to be named by a timeout or deadline to count. A bound-looking constant is the
 * signal, because that is exactly what the question tells the model to distrust.
 */

const SOURCE_FILE = /\.(?:[cm]?ts|[cm]?js|go|py|rs|swift|kt|java|rb|cs)$/i;
const TEST_PATH =
  /(?:[._-](?:test|spec|e2e)\.[^/]+$|_test\.(?:go|py)$|(?:^|\/)test_[^/]*\.py$|(?:^|\/)(?:__tests__|__mocks__|tests?|e2e|fixtures?|mocks?|stories)\/|\.stories\.)/i;

const COMMENT_ONLY = /^\s*(?:\/\/|\/\*|\*|#)/;
const UI_TIMING = /debounce|throttle|animat|transition|requestAnimationFrame|toast|tooltip|hover/i;

/** Timer calls and their handles say nothing about a bound; the delay's name does. */
const TIMER_NOISE = /\b(?:set|clear)(?:Timeout|Interval)\b|\b\w*timeout(?:Id|Ref|Handle)\b/gi;

const WAIT_BOUND_SIGNAL = new RegExp(
  [
    String.raw`\bPromise\.race\b`,
    String.raw`\bAbortSignal\.timeout\b`,
    String.raw`\b\w*(?:timeout|deadline)\w*\b`,
    String.raw`probe`,
    String.raw`\bpoll(?:s|ed|ing|er)?(?![a-z])`,
    String.raw`\bretr(?:y|ies|ying)`,
    String.raw`\bbackoff`,
  ].join("|"),
  "i",
);

export const QUESTION: DataPathQuestion = {
  id: "bounded-wait",
  title: "What bounds the whole wait",
  text:
    "For each probe, poll, retry, race or loop of awaits in the added code, name what bounds the " +
    "whole operation, not one call. A per-call timeout multiplies by the number of sequential " +
    "calls or batches; a deadline checked only between batches overshoots by one full call. " +
    "Read what sits outside the timeout or race: an await before the raced call, or a fallback " +
    "after a timed-out probe (an lstat, a retry), and whether it has its own limit. If a user " +
    "action waits on it (a hotkey, capture start, a listing), say what they see in the worst " +
    "case. A constant, or a comment saying it never hangs, is not the bound until you check " +
    "what it covers.",
  applies(addedLines, filename) {
    if (!SOURCE_FILE.test(filename) || TEST_PATH.test(filename)) return false;
    return addedLines.some((line) => {
      if (COMMENT_ONLY.test(line) || UI_TIMING.test(line)) return false;
      return WAIT_BOUND_SIGNAL.test(line.replace(TIMER_NOISE, " "));
    });
  },
};
