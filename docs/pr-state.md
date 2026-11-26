# `wachiman pr-state` and the review state block

`wachiman pr-state` tells a coding agent (or a script) what Wachiman's own review of a pull request
needs next: wait, act, stop or finish. It reads GitHub, prints one JSON object and exits with a
code that matches. It never posts, resolves, replies or edits, and it stores nothing: every field
is derived from GitHub on each call
([ADR 0060](adr/0060-the-review-state-is-one-versioned-block-in-the-signed-footer-and-pr-state-derives-the-next-step.md),
[design](specs/2026-11-19-pr-state-design.md)).

```sh
wachiman pr-state 42 --json                       # the pull request of the current repository
wachiman pr-state --repo niway-dev/wachiman 42    # another repository
wachiman pr-state --json                          # the pull request of the current branch
wachiman pr-state 42 --wait                       # until Wachiman's review of the head lands, or 540 s
```

`<pr>` is digits only. Without `--repo`, the repository is the one `gh` resolves for the current
directory. `--json` is accepted; JSON is the only output. `gh` must be installed and signed in.

## Waiting: `--wait`, `--timeout`, `--interval`

Without `--wait`, one call is one read and the answer may be `wait`. With `--wait`, the command reads
again until `next` is not `wait`, then prints that state once and exits with its code.

| Flag | Default | Rule |
| --- | --- | --- |
| `--wait` | off | Loop. `--timeout` and `--interval` are a usage error (exit 2) without it |
| `--timeout <s>` | 540 | Whole seconds, at least 1. Under ten minutes by default so a harness's foreground time limit does not end the wait first |
| `--interval <s>` | 30 | Whole seconds, at least 20 (the minimum). A bad value is a usage error, exit 2 |

- **On timeout** it prints the last state read with `why: timeout` (still `next: wait`) and exits 21. The deadline bounds the whole call: it does not start a read after it, and a read in progress when it passes is cut off (each `gh` call is killed with the time left), so the call ends with the last state read (when none finished, a `wait` document with `head` as an empty string and `review.state` `none`). A timeout while only finding the repository is exit 1.
- **At most one state read per interval.** A read is one GraphQL query for the threads, extra pages only when there are more than 100 threads, the other `gh api` calls of a read, and the head check at its end. Two reads are never closer than one interval, whatever else happens.
- **Stdout is always one JSON object**, printed at the end. Notes about the wait go to stderr. A GitHub error while waiting is exit 1 with nothing on stdout.

### `gh event listen` (optional acceleration, unverified)

When this `gh` has `gh event listen` (v2.105.0 or later, a preview, github.com only), `--wait` starts
it for the repository and treats each event as a wake signal only. With a listener the loop still
reads at least every three intervals (the command has no replay and drops events while it is
disconnected), and an event can bring the next read forward, but never sooner than one interval
after the last read. The content of an event is never read or trusted: the state is read again.
The listener is killed when the wait ends, on every path, and on SIGINT, SIGTERM or SIGHUP (the handlers exist only while waiting). While a `gh` call is running the process is blocked, so a signal is handled when that call ends (at most the time left before the deadline).

When the command is missing, not supported, or stops (including its 24 h subscription ending, exit
8), `--wait` polls every interval and says so once on stderr, for example `gh event listen is not
available; polling every 30 s.`

**Unverified against a real `gh event listen`.** It was written from the announced interface and was
developed with `gh` 2.100.0, which has no `event` command. The polling path and the loop are covered
by tests with a fake clock and a fake GitHub; the listener path is covered with a fake process. The
exact command line (`gh event listen --repo <owner/repo>`) is an assumption: if the real command
rejects it, the wait falls back to polling and nothing else changes.

## What it covers, and what `done` means

It covers Wachiman's own review and findings only. **`done` means Wachiman has nothing pending on
the current head**: a complete review of it and no unresolved Wachiman finding thread. It does not
say the pull request can merge: other reviewers, CI results other than the "Wachiman review" check
run, conflicts and mergeability are not read.

## Exit codes

| Exit | `next` | Meaning |
| --- | --- | --- |
| `0` | `done` or `closed` | Nothing pending from Wachiman on this head, or the pull request is closed or merged |
| `20` | `act` | At least one Wachiman finding thread is unresolved, or the review counts Blocker or Fix findings that have no thread |
| `21` | `wait` | No review of the current head yet, or the head moved while reading. With `--wait`, also the timeout (`why: timeout`) |
| `22` | `blocked` | The review was refused or skipped (see `why`), it is partial, or its job finished without a review |
| `1` | | GitHub or `gh` failed. One line on stderr, nothing on stdout |
| `2` | | Usage error |

Exits 3, 10, 11 and 130 mean other things in other commands and are never used here.

## The answer: `wachiman.pr-state/1`

```json
{
  "format": "wachiman.pr-state/1",
  "repo": "niway-dev/wachiman",
  "pr": 42,
  "head": "9f2c…",
  "review": {
    "state": "complete",
    "reason": null,
    "reviewed_head": "9f2c…",
    "attempt": "6b1e…",
    "engine": "1.18.0",
    "source": "block"
  },
  "findings": {
    "open": [
      {
        "thread_id": "PRRT_kwDO…",
        "url": "https://github.com/niway-dev/wachiman/pull/42#discussion_r123",
        "path": "src/a.ts",
        "line": 12,
        "severity": "fix",
        "outdated": false,
        "awaiting": "fix_or_reply"
      }
    ],
    "unthreaded": { "blocking": 0, "body": 2, "outside_diff": 1 }
  },
  "next": "act",
  "why": "findings_open"
}
```

| Field | Meaning |
| --- | --- |
| `format` | Always `wachiman.pr-state/1`. A change to a field needs a new version |
| `head` | The pull request's head commit, read at the start of the call |
| `review.state` | `none` (no review of this head and none of another), `running` (the check run is queued or in progress), `complete`, `partial`, `not-reviewed`, `scoped` (only a scoped review exists for this head; it never decides), `stale` (reviews exist, none for this head) |
| `review.reason` | Why nothing was reviewed: `billing`, `auth`, `rate_limit`, `ceiling`, `limit`, `turn_limit`, `timeout` or `budget`. Null otherwise. A pull request stopped by the room gate has no review (the gate posts an issue comment, which never carries a block), so it reads as `blocked` with `why: review_missing` |
| `review.reviewed_head` | The head the deciding review covers; for `scoped`, that review's own head; for `stale` and `running`, the latest other review's head. Null when there is none |
| `review.attempt`, `review.engine` | From the block. Null for `legacy-markers` |
| `review.source` | `block`, or `legacy-markers` for a review posted by an engine without the block. Null when no review is read |
| `findings.open` | One entry per unresolved Wachiman finding thread, from any review, whoever replied last |
| `findings.open[].awaiting` | `fix_or_reply` when Wachiman wrote the last comment; `resolve` when someone else did |
| `findings.open[].severity` | `blocker`, `fix`, `consider`, `info`, or null when the comment does not say |
| `findings.open[].outdated` | The code the thread points at changed; the thread is still unresolved |
| `findings.unthreaded` | Counts from the deciding block of findings with no thread: `blocking` (Blocker and Fix), `body` and `outside_diff` placements. Null with no block to count from |
| `next` | `wait`, `act`, `blocked`, `done` or `closed` |
| `why` | A fixed code, not prose: see the table below. `--wait` adds `timeout` (with `next: wait`) when the timeout passes |

## The rule table

Evaluated in order; the first row that matches decides.

| # | Condition | `next` | Exit | `why` |
| --- | --- | --- | --- | --- |
| 1 | The pull request is closed or merged | `closed` | 0 | `closed` |
| 2 | The head at the end of the read differs from the head at the start | `wait` | 21 | `head_moved` |
| 3 | No review of the current head, and the "Wachiman review" check run on it is queued or in progress | `wait` | 21 | `review_running` |
| 4 | No review of the current head and no check run on it | `wait` | 21 | `review_not_started` |
| 5 | The latest review of the head is `not-reviewed` | `blocked` | 22 | the review's `reason` |
| 6 | The check run on the head finished and no review of it exists | `blocked` | 22 | `review_missing` |
| 7 | An unresolved Wachiman finding thread exists, or the review counts Blocker or Fix findings outside a thread | `act` | 20 | `findings_open` |
| 8 | The block is `partial`, or a legacy review of the head carries `wachi:partial` | `blocked` | 22 | `partial` |
| 9 | The block is `complete` and counts no Blocker or Fix finding outside a thread | `done` | 0 | `clean` |
| 10 | A legacy review (`wachiman sha=` for the head, no block, no `wachi:partial`) covers the head | `done` | 0 | `clean_legacy` |

Rules the table does not repeat:

- **Only the engine's own reviews count.** A review counts when its author is `github-actions[bot]`, it carries the review signature, and the state block sits in its signed footer. (Reviews from before signatures existed count only under the engine's own deprecation window: before the first signed review and before 2026-11-01.) A `wachi:state` text anywhere else (a finding, a file name, the pull request description, another author's comment) is ignored.
- **The latest attempt decides.** With several own reviews of the same head, the most recent by creation time decides. A push makes every older review `stale`.
- **A `scoped` review never decides.** A review an operator asked for on some paths says nothing about the rest of the head. It is skipped when choosing the head's review, and its threads are still listed under `findings.open`.
- **A base-update line counts as `complete`** for its head: the engine carries the earlier review over (`carried_from`) and repeats its counts.
- **"Nothing to review" is a review.** A push whose changed files are all excluded (lockfiles, build output, generated) or outside the requested paths gets a signed notice with a block (`complete`, zero findings; `scoped` when paths were requested), so `pr-state` reads it as a finished review and not as `review_missing`.
- **Row 4 is `wait`, not `blocked`,** because the workflow's push debounce can delay the check run. A caller decides how long to accept it.
- **A thread never drops out because someone replied.** Resolving a thread stays with the operator; an agent acting for them resolves it, or waits for Wachiman's automatic reply.
- **Reviews from an engine without the block** are read from `wachiman sha=` (complete) and `wachi:partial` (partial) with `source: "legacy-markers"`. A notice with no sha (a refusal, ceiling or limit notice from before the block) says nothing about any head, so it is skipped and never reads as `complete`: the review state is `stale` when an earlier review of another head exists, and `none` when no review is read. A legacy review of the head has no counts (`findings.unthreaded` is null), so with no unresolved Wachiman finding thread it is `done` with `why: clean_legacy`, never `clean`.
- **Threads are read in full.** Review threads are read 100 at a time until the last page, and each thread's first and last comment are read by name, so no thread or comment count hides one.

## The state block: `wachiman.review-state/1`

Every signed review the engine posts (full review, re-review, partial, the notices of an automatic run, and a base-update line that can carry the earlier counts over) ends its
signed footer with one `<!-- wachi:state <base64url JSON> -->`, after the review signature and its
marker and before the attempt line. It never holds finding text, and it is never placed on inline
comments, replies or issue comments. It is built last, from the body and inline comments actually
sent: if GitHub refuses the inline comments and the engine moves them into the body, the block
counts them under `body`.

```json
{
  "format": "wachiman.review-state/1",
  "engine": "1.18.0",
  "head": "9f2c…",
  "attempt": "6b1e…",
  "status": "complete",
  "reason": null,
  "carried_from": "1a2b…",
  "scope": 2,
  "findings": {
    "total": 7,
    "by_severity": { "blocker": 0, "fix": 1, "consider": 4, "info": 2 },
    "by_placement": { "inline": 4, "body": 2, "outside_diff": 1 },
    "unthreaded_blocking": 0
  }
}
```

| Field | Meaning |
| --- | --- |
| `format` | Always `wachiman.review-state/1` |
| `engine` | The engine version that wrote the review |
| `head` | The commit the review is about |
| `attempt` | The attempt id the engine also writes in the footer; one per post |
| `status` | `complete`, `partial` (some files not reached; the `wachi:partial` marker keeps the continuation state), `scoped` (a review of some paths an operator asked for) or `not-reviewed` (a notice: nothing was reviewed) |
| `reason` | Required when `not-reviewed`, null otherwise: `billing`, `auth`, `rate_limit`, `ceiling`, `limit`, `size_gate`, `turn_limit`, `timeout`, `budget`. The engine does not write `size_gate` today: the room gate posts an issue comment, not a review |
| `carried_from` | Optional. On a base-update line, the earlier head whose review it carries over |
| `scope` | Optional. `binary_only` on the all-binary notice (zero findings; `complete`, or `scoped` when the request named paths); otherwise, on a scoped review, the number of paths |
| `findings.total` | The headline count |
| `findings.by_severity`, `findings.by_placement` | Counts that each add up to `total`. `inline` findings have a thread; `outside_diff` ones are listed under "Outside the diff"; `body` ones (information, pre-existing, inconclusive, or inline findings GitHub refused to anchor) are in the body only. This is why the headline count can differ from the inline comments |
| `findings.unthreaded_blocking` | Blocker and Fix findings that have no thread |

A block that does not validate (another format version, a wrong type, counts that do not add up, a
reason missing on a notice) is read as no block. When an encoded block would pass 2,000 characters
the engine drops the optional fields and the engine version (it becomes `unknown`), and keeps the counts.
