# 483-b3 B-r1

questions: destructive-step, read-error-as-empty, overlapping-calls, bounded-wait, stale-write-back
cost_usd: 0.5705374000000001, turns: 4, terminal: success, duration_ms: 77099

## Summary

I reviewed all 21 files in part 3 and found three bugs to fix and two smaller points to consider; none blocks the merge.\n\nFix:\n- **Assign to workspace can hang for hours.** It sends up to 500 requests one after another, each with its own 15-second timeout and no limit on the whole batch. After the server says the session expired, it keeps sending the rest anyway.\n- **A catalog refresh can undo a confirmed assignment.** The refresh downloads the catalog before it takes its turn to write the cache. If the queue confirms an assignment during that download, the refresh then writes the older workspace back, and the item shows in its old workspace's Library until the next refresh.\n- **The assignment queue can lose what it owes the server.** If the queue file exists but can't be read, the queue starts empty and the next save overwrites the file. A move or deferral that lands while the file is still loading at startup is also dropped.\n\nConsider:\n- **Checking for evicted files can still hang.** Each `stat` batch is limited to 5 seconds, but when one times out, the fallback runs `lstat` path by path with no limit, so the Library listing can wait indefinitely on a stuck sync provider.\n- **A direct assignment can be undone by the queue.** When the user assigns an item and the server accepts, any older queued assignment for the same item stays. The Library keeps showing the queued target, and the queue later sends it, overwriting the user's choice on the server.\n\nThe server-side repository changes (the `workspace_id` column, keeping the existing workspace when a re-upload doesn't name one, and the owner-scoped `setWorkspace`) look correct. The desktop client's reading of the server's 404 matches what the router returns for a missing asset.

## Findings

### [fix/bug/high] `apps/kaipu-record/src/main/cloud/assign-cloud.ts:42` Assign to workspace waits on up to 500 sequential 15 s requests, and keeps going after a 401

The loop awaits `deps.assign` once per asset, one after another (lines 42-53). Each call has its own `AbortSignal.timeout(15_000)` (assign-client.ts:31), and nothing limits the loop as a whole. `MAX_ITEMS` is 500, so against a server that hangs, the `workspacesAssignCloud` IPC (library/index.ts:198-213) can wait 500 × 15 s ≈ 2 h before the renderer gets an answer. An `unauthorized` outcome also does not stop the loop: every remaining asset is sent again, gets the same 401, and is deferred one at a time. Each `defer` writes the queue file again (assign-queue.ts:100). The queue's own `runOnce` breaks on `unauthorized` (assign-queue.ts:133), and this loop should do the same. Suggested fix: after the first `unauthorized` or `retry`, defer every remaining asset without sending it, or put a deadline on the whole batch.

### [fix/bug/medium] `apps/kaipu-record/src/main/library/library-service.ts:225` A catalog refresh that was fetching while the queue confirmed an assignment overwrites the confirmed workspace

`doRefresh` fetches the catalog outside the cache's write chain (line 222), then replaces every entry with that snapshot inside `cache.update` (lines 225-232). Suppose the AssignQueue's `onConfirmed` → `setCachedWorkspace` (library/index.ts:145-155, 161-164) lands while that fetch is still in flight, for example from a timer or from `enqueue` after a move. Then:
1. The confirm writes the new `workspaceId`.
2. The queue entry is removed (assign-queue.ts:127), so the `pending` overlay no longer applies.
3. The refresh then writes the server's older value back over it.

The item quietly shows up again in its old workspace's Library (workspace-filter.ts:36-51) until the next refresh. The chain only orders the writes; it does not stop a write based on stale data. Possible fixes: keep the fresher value when an entry's cached workspace was confirmed after the fetch started, or run a refresh again after a confirm that overlapped one.

### [fix/bug/medium] `apps/kaipu-record/src/main/cloud/assign-queue.ts:73` Owed assignments can be lost: an unreadable queue file reads as empty, and an enqueue during load() is dropped

`load()` catches every error and sets `entries = []` (lines 73-75). If `cloud-assign-queue.json` exists but cannot be read (EACCES, EIO), the queue starts empty, and the next `save()` (line 157) overwrites the file. The owed assignments are lost, and the server keeps the old workspace without telling anyone. Only ENOENT should mean empty.

Separately, `load()` assigns `this.entries` after its `await readFile` (lines 64-65). library/index.ts:166-175 starts `load()` and installs `queueCloudMove` (and the assign IPC's `defer`) right away. An `enqueue` or `defer` that runs before `load` resolves is replaced in memory by the file's older contents, and the next save drops it. Suggested fix: have `enqueue`, `defer` and `process` await the load promise, and merge the loaded entries instead of replacing the in-memory ones.

### [consider/perf/medium] `apps/kaipu-record/src/main/library/dataless.ts:76` The lstat fallback after a timed-out stat has no time limit, and listing waits for it

`STAT_TIMEOUT_MS` limits each `stat` batch, but batches run one after another (line 65). `LibraryVault.list()` probes two paths per item (library-vault.ts:977-982), so a large vault costs N/100 × 5 s in the worst case. When `stat` prints nothing (the timeout case, line 76), every path in the batch then gets its own `lstat` (lines 77-80), one after another and with no timeout. A File Provider hung enough to time out `stat` can hang those too. The Library listing then waits with no limit, although the comment at line 18 says it "never hangs". Consider putting one deadline on the whole call and treating unanswered paths as evicted (the safe answer), rather than falling back to `lstat`.

### [consider/bug/medium] `apps/kaipu-record/src/main/cloud/assign-cloud.ts:44` A direct assignment that succeeds leaves an older queued assignment of the same asset in place

On `ok`, `confirmed` only updates the cache (library/index.ts:206). Any entry the AssignQueue already holds for that asset, for example from an offline move, is left in place. `effectiveWorkspace` prefers the pending entry over the cache (workspace-filter.ts:36), so the Library still shows the old target. When the queue later sends that entry, the server is overwritten with the old workspace, undoing the user's explicit choice. Consider removing or replacing the asset's queue entry when a direct assign succeeds.

## Contracts

- **closed** `apps/kaipu-record/src/main/library/index.ts:198`: Assign cloud items to a workspace (IPC workspacesAssignCloud)
  - failure_mode: Sequential 15 s timeouts with no overall limit; a 401 is retried for every asset
  - before_after: The queue checks for an account and breaks on unauthorized; assignCloudItems checks the account but never breaks out of the loop
  - open_question: 
- **closed** `apps/kaipu-record/src/main/library/library-service.ts:225`: Catalog refresh replacing cache entries inside update()
  - failure_mode: The newer confirmed workspaceId is lost from the cache
  - before_after: The fetch happens before the chain link, so the refresh's snapshot can be older than a confirm write that ran in between
  - open_question: 
- **closed** `apps/kaipu-record/src/main/cloud/assign-queue.ts:62`: Assignment queue load and save in userData
  - failure_mode: Owed assignments are dropped and the file is overwritten
  - before_after: load() replaces the in-memory entries after an await; any error reads as empty
  - open_question: 
- **closed** `apps/kaipu-record/src/main/library/drag-copies.ts:112`: Synced-workspace drag copy
  - failure_mode: The copy error rejects the IPC handler; nothing is lost
  - before_after: In synced mode a copyFile error is not caught and propagates to the drag handler; an evicted file is refused before the copy
  - open_question: 
- **closed** `apps/kaipu-record/src/main/library/dataless.ts:60`: Eviction probe during listing and media requests
  - failure_mode: lstat on a hung provider has no limit
  - before_after: stat batches are limited to 5 s each; the lstat fallback has no limit
  - open_question: 
