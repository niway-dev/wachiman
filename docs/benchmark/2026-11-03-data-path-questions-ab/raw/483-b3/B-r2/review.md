# 483-b3 B-r2

questions: destructive-step, read-error-as-empty, overlapping-calls, bounded-wait, stale-write-back
cost_usd: 0.5745728, turns: 5, terminal: success, duration_ms: 72279

## Summary

Part 3 has three issues to fix, all in the new cloud assignment queue.

1. **Not per account.** The queue file is shared by every account and never cleared on sign-out. After an account switch, the previous account's queued assignments go out with the new account's token, come back as not-found, and are silently dropped.
2. **Older entry undoes an explicit assign.** When "Assign to workspace…" succeeds at once, an older queued entry for the same asset stays in the queue. It keeps overriding what the listing shows, and when it is retried it reverts the user's choice on the server.
3. **Unreadable file treated as empty.** `load()` turns any read error into an empty queue, and the next save overwrites the file, losing every assignment still owed.

Two smaller points:
- An assign of up to 500 items runs one request at a time, each with a 15 s timeout, while the renderer waits on the call.
- When `stat` is killed by its timeout, partial output may count as a full answer, so files it never printed are treated as not evicted. I'm least sure of this one, so it's phrased as a question.

The repository, mapper and schema changes are consistent with each other.

## Findings

### [fix/bug/high] `apps/kaipu-record/src/main/cloud/assign-queue.ts:15` The assignment queue is not per account: a queued entry is sent with the next account's token and then dropped

`QueuedAssignment` has no `userId`. The queue file (`userData/cloud-assign-queue.json`, `library/index.ts:157`) is shared by every account, and nothing clears it on sign-out (the only callers are at `library/index.ts:156-224`). `runOnce` sends each entry with whatever `account()` returns now (`assign-queue.ts:116-121`). Say account A moves an item while offline, then signs out and B signs in. The entry goes out with B's token, the server answers `NOT_FOUND`, and line 126 drops it for good. A's asset keeps its old workspace on the server and nothing reports it. Meanwhile `pending()` lays A's entries over B's listing. Fix: store `userId` on each entry, and send or overlay only the entries of the current account.

### [fix/bug/medium] `apps/kaipu-record/src/main/library/index.ts:206` An explicit "Assign to workspace…" that succeeds at once leaves an older queued assignment of the same asset in place, and that entry later undoes it

`confirmed` only updates the cache (`setCachedWorkspace`). `defer` replaces any queued entry for the asset (`assign-queue.ts:93`), but the `ok` path never touches the queue. Say a move queued X→A, A was then deleted, so X shows under Unassigned, and the user assigns X to B. The server takes B, but `pending()` still says A, so `effectiveWorkspace` keeps X unassigned (`workspace-filter.ts:36`). On its next backoff the queue sends A and overwrites the user's choice. Fix: when `assign` returns `ok`, drop any queued entry for that asset, e.g. with an `AssignQueue.settle(assetId)` that removes the entry and saves.

### [fix/bug/medium] `apps/kaipu-record/src/main/cloud/assign-queue.ts:73` `load()` treats an unreadable queue file as empty, and the next save overwrites it

The bare `catch` turns every error (EACCES, EIO, EBUSY, a read that loses to a startup race) into `entries = []`. The next `enqueue`/`defer` (`save()` at line 157) then writes only the new entries over the file, so every assignment still owed is lost. Those items show in their old workspace again and are never sent. Only ENOENT, and arguably a JSON parse error, should start empty. For any other error, keep the file untouched (e.g. skip saving for the session) and log it. Also, `load()` runs fire-and-forget (`library/index.ts:166`): an `enqueue` that lands before it resolves is overwritten in memory by the file's contents.

### [consider/perf/high] `apps/kaipu-record/src/main/cloud/assign-cloud.ts:42` An assign of up to 500 items runs sequentially, each with a 15 s timeout, while the renderer waits on the IPC call

Each `deps.assign` call can take up to 15 s (`assign-client.ts:31`), and the loop awaits them one by one, up to `MAX_ITEMS = 500`. Against a server that hangs instead of refusing, the `workspacesAssignCloud` invoke can stay pending for up to about 2 hours. Once one item comes back `retry`/`unsupported`/`unauthorized`, the remaining items will almost certainly get the same answer, so `defer` them at once without sending. Or bound the whole batch with a deadline.

### [consider/bug/low] `apps/kaipu-record/src/main/library/dataless.ts:69` Partial `stat` output (killed by the timeout) counts as a full answer

When `execFile` kills `stat` after 5 s, `stdout` can already hold some lines, so `flags.size > 0`. The paths it never printed are then treated as missing, i.e. not evicted. `describe()` hands out a URL for them, and the protocol reads and downloads the file. Should a run with `failed: true` also check each path in the batch that `stat` did not print, using the `lstat` fallback? Also note the whole wait: each listing makes ceil(2N/200) sequential batches of up to 5 s each, then one `lstat` per path with no limit of its own.

## Contracts

- **closed** `apps/kaipu-record/src/main/library/index.ts:167`: Move commits → cloudItemMoved queues PUT /assets/{id}/workspace
  - failure_mode: Errors are logged. The queue is shared across accounts (finding), and load() turns an unreadable file into empty (finding)
  - before_after: Reads the cached catalog to skip assets it knows are not in the cloud, then enqueue saves and processes at once
  - open_question: 
- **closed** `apps/kaipu-record/src/main/cloud/catalog-cache.ts:51`: Catalog cache update chain used by list(), refresh and confirmations
  - failure_mode: read() returns null on any error. list() and setCachedWorkspace write nothing then. doRefresh writes the fresh list with lastSeenLocalId null, as the old code did
  - before_after: Each read-modify-write runs inside the per-user chain. list() merges only lastSeenLocalId into the full catalog
  - open_question: 
- **closed** `apps/kaipu-record/src/main/library/index.ts:412`: Synced-workspace drag copy is a real copy in userData scratch
  - failure_mode: A copyFile error rejects the startDrag handler (same as the link path's copyFile fallback)
  - before_after: Probes for eviction before copying. copyFile has no fallback, unlike the link path
  - open_question: 
