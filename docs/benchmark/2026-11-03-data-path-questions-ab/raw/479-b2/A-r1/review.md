# 479-b2 A-r1

questions: none (arm A engine)
cost_usd: 0.583781, turns: 10, terminal: success, duration_ms: 108667

## Summary

I reviewed the five files in this part (no build, test or run) and found three things in `move-item.ts`. The other four files have no findings.

**Fix (confidence medium):**
- **`move-item.ts:667`, tags lost after recovery.** When an interrupted move is finished and the copied item's record is missing in the target, the record is rebuilt from the source's raw record. That record still uses the source workspace's tag ids, and its "removed" mark (`localRemovedAt`) stays on it. The live move maps tags into the target workspace by name; recovery does not. The moved item loses its tags with no error, and the source record that could restore them is deleted right after. This only happens if the record disappears after the move already saved it, so it is rare.

**Consider:**
- **`move-item.ts:674`, too-broad cleanup.** Recovery deletes the source workspace's whole drag-copy folder, so a drag-and-drop of an unrelated item that is still in progress can lose its file. The normal move path only clears this item's drag copies.
- **`move-item.ts:409`, wrong result after the commit point.** A likely late failure is the app's data folder being full or unwritable. Recovery then probably fails the same way, and the user is told the move failed even though the item already exists in the target and is still in the source. The leftover source copy is cleaned up on the next recovery run. Separately, this path always reports the move as "copied", even when the file was linked.

**No findings:**
- The rest of `move-item.ts` holds up: the checks, journal order, reservation, transfer, checksum, rollback and recovery logic. `refreshFreshness` merges into the record rather than replacing it.
- `switch-transaction.ts` now passes the busy reason straight through.
- `workspace-view.ts` now reports a device only for workspaces that are available.
- `move-group.test.ts` matches what `runMoveGroup` does: one move at a time, progress reported before each move, Stop skips the rest, and a thrown error counts as `io`.
- The `video-edit-session` test asserts the right thing: a save waiting behind a move writes nothing and fails with `ItemMovedError`.

## Findings

### [fix/bug/medium] `apps/kaipu-record/src/main/workspaces/move-item.ts:667` Roll-forward rebuilds the target record from the raw source sidecar, which still has the source's tag ids

When healing finds the target media committed but its record missing, it writes `read.sidecar` from the source unchanged. The live move does not do that. At lines 306-313 it maps the tags into the target registry through `ensureByName` (which gives target tag ids and names) and drops `localRemovedAt`. The healed record keeps the source registry's `tagIds` and any `localRemovedAt`. In the target workspace those ids point at nothing, so the moved item's tags disappear without any error. The source record is deleted right after (line 676), so they can't be recovered. The trigger is rare, because `reserveIncoming` makes the record durable before the media lands (library-vault.ts:546-557). The suggested fix is to run the same tag mapping here, or at least to strip `tagIds` and `localRemovedAt` and keep `tagNames` so the names survive.

### [consider/bug/medium] `apps/kaipu-record/src/main/workspaces/move-item.ts:674` Healing deletes every drag copy in the source workspace, not just this item's

`join(sourceDir, META_DIR, "drag")` is `dragRoot` (drag-copies.ts:14-15), the folder that holds the drag copies of all items in the vault. When a move rolls forward (at startup, before each group, or inline after a failure past the commit at line 409), any drag of an unrelated item that a drop target is still reading loses its file. The live path clears only this item's folders through `dragLedger.clear(workspaceId, id)` (line 274). If the ledger can't be used here (it lives in memory and is gone after a restart), consider limiting the inline post-commit call to the ledger, and keep the broad sweep for startup only.

### [consider/bug/medium] `apps/kaipu-record/src/main/workspaces/move-item.ts:409` A post-commit failure that also breaks healEntry is reported as a failed move

A likely post-commit failure is `writeJournal` at line 393, for example when userData is full or unwritable. In that case `healEntry` will probably fail too, either in `writeJournal` at line 670 or in `quarantine`. Its throw leaves this catch and reaches `moveItem`'s catch, which returns `refuse("io")`. The user is told the move failed, yet the target already holds the committed item and the source still has it. The item shows in both workspaces until a later `healMoves` run. Also, when `healEntry` returns a quarantined journal, this branch still reports `ok: true` with `mode: "copied"`, even when the media was linked. Consider catching around `healEntry` here and returning `ok: true` with the real `mode`, since the media placement is the commit.

## Contracts

- **closed** `apps/kaipu-record/src/main/workspaces/move-item.ts:197`: moveItem: move one item from the active workspace to another under the item lock
  - failure_mode: An unexpected error before the commit rolls back the target and returns 'io'. After the commit, healEntry finishes the source side, but if healEntry throws, the user gets 'io' while both workspaces hold the item (see finding).
  - before_after: Preconditions run before any write. The journal is written before the target is reserved. reserveIncoming writes the record under NAMES_LOCK before the media lands. The source is removed only after the media is placed. writeMeta in refreshFreshness merges into the record (read-merge-write), so the reserved record is kept.
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/move-item.ts:578`: healMoves: finish journal entries at startup and before each group
  - failure_mode: A journal that can't be read is kept and logged. A throw during healing counts as waiting and is retried later. Roll-forward with a missing target record writes the raw source sidecar (see finding).
  - before_after: Each entry is healed under the source item lock. A workspace that resolveMoveSide reports as not connected is left waiting.
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/move-item.ts:674`: Healing roll-forward clears the source drag folder
  - failure_mode: Errors are swallowed (.catch).
  - before_after: The live path clears only this item's drag folders. Healing removes the whole dragRoot.
  - open_question: 
