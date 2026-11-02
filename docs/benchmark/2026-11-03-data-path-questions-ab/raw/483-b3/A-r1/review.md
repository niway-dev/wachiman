# 483-b3 A-r1

questions: none (arm A engine)
cost_usd: 0.5806352, turns: 6, terminal: success, duration_ms: 65052

## Summary

I reviewed part 3 (the server repository and schema, plus the desktop cloud filter, assignment queue, eviction checks and synced drag and placement). One fix: the persisted assignment queue is not tied to an account. If a different account signs in, its 404s drop the first account's assignments and nothing tells the user. Two suggestions: the bulk assign keeps calling the server one item at a time after the first `unauthorized` or timeout, and a synced drag copies the whole file before the drag starts with no handling if the copy fails.

## Findings

### [fix/bug/medium] `apps/kaipu-record/src/main/cloud/assign-queue.ts:115` The assignment queue is not tied to an account, so a later sign-in to a different account sends and drops it

Entries in `cloud-assign-queue.json` hold only `assetId`/`workspaceId` (lines 15-21). `runOnce` sends every due entry with whatever account is signed in *now* (line 116). Say a user moves items while offline or while the session has expired, then signs in to a different account. The new account's server answers 404 `NOT_FOUND` for each asset, and line 126 deletes the entry. The first account's assignment is lost and nothing says so. The `pending()` overlay also goes away, so once that account signs back in and refreshes, its item shows in its old workspace's cloud listing. Fix: store `userId` on each entry (and in `pending()`), send only the entries of the current account, and filter the overlay by account.

### [consider/perf/high] `apps/kaipu-record/src/main/cloud/assign-cloud.ts:42` "Assign all" keeps sending requests one after another after the first `unauthorized` or `retry`

The loop awaits one PUT per asset, for up to 500 assets. Each PUT has a 15 s timeout (`assign-client.ts:31`). When the first answer is `unauthorized`, or a timeout on a bad network, every remaining item makes the same call anyway. The IPC handler can then hang for minutes before it returns `queued`. The queue already stops at the first `unauthorized` (`assign-queue.ts:133`). Doing the same here would help: after the first `unauthorized`/`retry`, defer the remaining items without calling the server.

### [consider/bug/medium] `apps/kaipu-record/src/main/library/drag-copies.ts:112` Synced drag copies the whole file before `startDrag`, and a failed copy is never caught

For a synced workspace, `fs.copyFile` runs in full before the handler calls `startDrag` (`library/index.ts:423-435`). A multi-GB recording delays the drag by seconds, often until after the user has released the mouse. If the copy fails (disk full, the source evicted after the probe), the error escapes the handler. It leaves an empty per-drag folder behind and the drag fails with nothing shown to the user. The non-synced path falls back instead (lines 116+). A catch that removes the folder and logs the error would at least make the failure clean.

## Contracts

- **closed** `apps/kaipu-record/src/main/library/index.ts:167`: Move commit queues PUT /assets/{id}/workspace
  - failure_mode: Errors are logged (index.ts:174). A failed save keeps the entry only in memory (assign-queue.ts:158-161). Entries are not tied to an account: see finding
  - before_after: Skipped when the cached catalog is known not to hold the asset; otherwise enqueue persists the entry, then processes it at once
  - open_question: 
- **closed** `apps/kaipu-record/src/main/library/index.ts:198`: IPC workspacesAssignCloud with renderer-supplied ids
  - failure_mode: Requests run one after another with a 15 s timeout each and do not stop on unauthorized: see finding
  - before_after: The ids are filtered to non-empty strings, deduped and capped at 500. The target is checked against the registered workspaces and the sign-in is checked
  - open_question: 
- **closed** `apps/kaipu-record/src/main/media-protocol.ts:126`: kaipu-media:// refuses evicted files with 409
  - failure_mode: A probe that fails reads as not evicted (line 140), and the stream then reads the file
  - before_after: The gate runs after the workspace check and path resolution, and before streamFile
  - open_question: 
- **closed** `apps/kaipu-record/src/main/cloud/assign-client.ts:40`: assign-client tells a missing asset from an old server by the JSON code
  - failure_mode: 
  - before_after: 
  - open_question: 
