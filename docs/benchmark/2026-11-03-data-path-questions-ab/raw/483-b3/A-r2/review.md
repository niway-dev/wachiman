# 483-b3 A-r2

questions: none (arm A engine)
cost_usd: 0.5366107999999999, turns: 4, terminal: success, duration_ms: 60433

## Summary

Part 3 covers the server column and repository, and on the desktop the cloud filter, the assignment client and its retry queue, eviction detection and the synced-folder scratch paths. I found three problems, all in the assignment flow; nothing in the other files of this part needed a finding.

- **Old queued assignment wins (fix, high confidence):** when "Assign to workspace…" succeeds, it does not clear an older queued assignment of the same asset. The queued value keeps overriding what the UI shows, and the queue later sends it to the server, which silently undoes the user's choice.
- **Queue not tied to an account (fix, medium confidence):** entries do not record which account owes them. After an account switch they are sent with the other account's token, get NOT_FOUND, and are dropped without any log or visible state.
- **Startup race (consider):** the queue file is loaded without waiting for it, so an entry added in the first moments after startup can be overwritten by the older file contents and lost.

## Findings

### [fix/bug/high] `apps/kaipu-record/src/main/library/index.ts:206` An explicit assignment that succeeds leaves an older queued assignment of the same asset in place, and the queue later sends the old one

When `assignCloudItems` gets `ok`, it calls `confirmed` → `setCachedWorkspace` (line 206). That updates the cache, but nothing removes an `AssignQueue` entry the same asset may already have. Only `defer` and `enqueue` replace entries (`assign-queue.ts:85`, `:93`). The overlay then stays wrong in two ways:
1. `effectiveWorkspace` prefers `pending` over the cache (`workspace-filter.ts:36`), so the Library and the "Unassigned cloud items" list keep showing the item where the stale entry puts it.
2. On its next backoff, `runOnce` sends the stale `workspaceId` (`assign-queue.ts:121`), which overwrites the user's explicit choice on the server. `onConfirmed` then writes that stale value into the cache too.

How to hit it: move an item offline into workspace W, which queues it (`cloudItemMoved`). Delete W. The item now appears under Unassigned, because its pending workspace is not registered (`workspace-filter.ts:62`). Assign it to X while online. X is confirmed, then silently undone. Fix: on `ok`, drop any queue entry for the asset, for example with an `AssignQueue.resolve(assetId)` that filters the entry out and saves. Alternatively, always route explicit assignments through the queue.

### [fix/bug/medium] `apps/kaipu-record/src/main/cloud/assign-queue.ts:15` Queued assignments are not tied to the account that owes them

`QueuedAssignment` stores no `userId`. The queue file is one per Mac (`userData/cloud-assign-queue.json`). `runOnce` sends every entry with whatever `account()` returns when the queue runs (lines 116–121). Suppose a move is queued under account A, and the user signs out and into account B before the server confirms. Each entry then goes out with B's token. The server answers `NOT_FOUND`, because the asset is owner-scoped (`cloud-asset.repository.ts:431`), and the entry is dropped (line 126). A's cloud asset keeps its old workspace, and nothing logs or shows this. `onConfirmed`/`setCachedWorkspace` also write into the current account's cache (`library/index.ts:146`). Fix: store `userId` on each entry, and send or apply only the entries that match the current account.

### [consider/bug/medium] `apps/kaipu-record/src/main/cloud/assign-queue.ts:62` A `load()` that finishes after an early enqueue/defer overwrites it

`library/index.ts:166` starts `load()` without waiting for it, while `queueCloudMove` and the assign handler are already live. If `enqueue` or `defer` pushes an entry while `readFile` is still pending, `load` then replaces `this.entries` with the file's older contents. The next `save()` persists the queue without that entry. The window is small (startup only), but the loss is silent. One option: have `enqueue`/`defer` wait on a stored load promise. Another: merge the loaded entries into the existing ones instead of assigning over them.

## Contracts

- **closed** `apps/kaipu-record/src/main/library/index.ts:198`: Explicit "Assign to workspace…" IPC (workspaces:assign-cloud)
  - failure_mode: Unanswered outcomes are deferred to the queue (assign-cloud.ts:50). not-found is reported as failed. Renderer input is validated: the ids are filtered and capped at 500, and the target must be registered (assign-cloud.ts:28-36). A stale queue entry can override a confirmed assignment (reported as a finding).
  - before_after: The queue path replaces any older entry of the asset before it sends (assign-queue.ts:85). The explicit path sends directly. On ok it updates only the cache and does not clear a pending queue entry.
  - open_question: 
- **closed** `apps/kaipu-record/src/main/cloud/assign-queue.ts:115`: Background retry of owed cloud assignments (AssignQueue)
  - failure_mode: When signed out, runOnce returns early and schedules nothing, so the queue waits for the next successful refresh. unauthorized/unsupported/retry back off up to 1 h. A save failure is logged and the entry is kept in memory only. Entries are not account-scoped (reported as a finding).
  - before_after: It is loaded at registration and processed after load (library/index.ts:166). It is also flushed after a successful refresh (library/index.ts:221-225).
  - open_question: 
- **closed** `apps/kaipu-record/src/main/media-protocol.ts:126`: kaipu-media:// refuses evicted files of a synced workspace
  - failure_mode: A probe failure reads as not evicted (media-protocol.ts:139-141). The stat timeout is 5 s, and the fallback guesses from the block count (dataless.ts:76-80).
  - before_after: The protocol checks eviction through a 2 s EvictionCache before it opens the stream. describe() uses the same probe (activeEvictionProbe).
  - open_question: 
