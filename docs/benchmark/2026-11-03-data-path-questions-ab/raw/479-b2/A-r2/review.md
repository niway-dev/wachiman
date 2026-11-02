# 479-b2 A-r2

questions: none (arm A engine)
cost_usd: 0.5976838, turns: 12, terminal: success, duration_ms: 97492

## Summary

Part 2 review. I found no blockers in the mover. The order of steps (journal, reserve the stem, copy the small files, then media via link or verified staged copy as the commit point) and the rule "delete a side only when the other side is proven complete" both hold in the code I read. Findings: (1) A failure after the commit can be reported as `io`, or a quarantined entry as a clean success, because `healEntry` runs unguarded at line 409. (2) Roll-forward healing deletes every item's drag folders in the source vault, not just the moved item's. (3) Rebuilding a missing target record copies the source sidecar without remapping tags or dropping `localRemovedAt`. (4) The `moveItem` docstring says unexpected failures rethrow, but the function returns `io`. `switch-transaction.ts`, `workspace-view.ts` and both test files look correct: `WorkspaceSwitchRefusal` includes `moving`, and the `saveSessionLocked` test matches its `hasMedia` check.

## Findings

### [consider/bug/medium] `apps/kaipu-record/src/main/workspaces/move-item.ts:409` A failure after the commit can still come back as `io`, or as `ok` for a quarantined entry

Once `mediaPlaced` is true the item lives in the target. The catch then awaits `healEntry(...)` without guarding it. If healing throws (for example `writeJournal` failing in userData, or `quarantine` failing to write), the error goes to `moveItem`'s catch (lines 204-207), and the renderer gets `{ ok: false, reason: "io" }` for an item that already moved. The source may also be partly deleted at that point. In the other direction, if `healEntry` returns a quarantined `MoveJournal`, line 414 still reports `ok: true` with `mode: "copied"`, even though the source side was not finished. Suggestion: catch around `healEntry` and return `ok: true` there (the journal stays for the next `healMoves`). Also check the return value, so a quarantine is not reported as a clean move.

### [consider/bug/medium] `apps/kaipu-record/src/main/workspaces/move-item.ts:674` Roll-forward healing deletes every item's drag folders in the source vault

`rm(join(sourceDir, META_DIR, "drag"), { recursive: true })` deletes the whole drag root (`dragRoot` in `library/drag-copies.ts:14-16`). That covers drag copies of every item, not only the moved one. This also runs from the post-commit path inside `moveItem` (line 409), not only at startup. A drop another item's drag started a moment ago can lose its file, and the in-memory `DragLedger` keeps entries for folders that are gone. The live path clears only this item's folders (`deps.dragLedger?.clear(source.workspaceId, id)`, line 274). Suggestion: limit this to the moved item's drag folders, or run the whole-root sweep only from the startup heal.

### [consider/bug/medium] `apps/kaipu-record/src/main/workspaces/move-item.ts:667` Rebuilding a missing target record copies the source sidecar without remapping it

When the target media matches but its record is missing, healing writes `read.sidecar` from the source unchanged. The normal path builds `incoming` instead (lines 306-313): `tagIds` and `tagNames` are resolved in the target registry through `ensureByName`, and `localRemovedAt` is dropped. A record rebuilt here keeps the source workspace's tag ids, which the target registry does not know, so the moved item silently loses its tags in the target. It can also carry `localRemovedAt` along. The trigger is rare, since the record is reserved before the media. Even so, the rebuild could reuse the same `incoming` transformation.

### [consider/docs/high] `apps/kaipu-record/src/main/workspaces/move-item.ts:194` The docstring says unexpected failures rethrow, but `moveItem` returns `io`

The comment says an unexpected failure "rolls back what this move made in the target before it rethrows". `moveItem` catches every error except `SimulatedCrash` and resolves `refuse("io")` (lines 204-207). Only `moveLocked` rethrows. Suggestion: describe the public contract, i.e. the method resolves `io` after the rollback.

## Contracts

- **closed** `apps/kaipu-record/src/main/workspaces/move-item.ts:197`: Single move of one item to another workspace (moveItem)
  - failure_mode: Errors before the commit roll back the target and return io. After the commit, healEntry runs unguarded: if it throws the result is io, and a quarantine is still reported as ok (see finding)
  - before_after: Takes withItemLock(source.workspaceId, id) like saveSessionLocked (video-edit-session.ts:183-187); reserves the target stem through reserveIncoming under the names lock (library-vault.ts:546-549); clears this item's drag folders first (line 274), as drag-ledger.ts:39-43 does
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/move-item.ts:578`: Healing interrupted moves at startup and before each group (healMoves)
  - failure_mode: An unreadable journal is kept and logged. A throwing heal counts as waiting. A quarantined entry is surfaced only in the console log (index.ts:119-124), not shown to the user
  - before_after: Each entry is healed under the same item lock as the move. The workspace directories come from resolveMoveSide, which returns null while a workspace is unavailable, so the entry waits
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/switch-transaction.ts:51`: Switch refusal reason now passes WorkspaceBusy through, including 'moving'
  - failure_mode: 
  - before_after: WorkspaceSwitchRefusal includes 'moving', so passing busy straight through is type-correct
  - open_question: 
