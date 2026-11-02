# 479-b2 B-r1

questions: destructive-step, read-error-as-empty, overlapping-calls, stale-write-back
cost_usd: 0.5491096, turns: 9, terminal: success, duration_ms: 106473

## Summary

I reviewed the five files in part 2 and found two "fix" issues and two "consider" issues, all in `move-item.ts`, the code that moves an item between workspaces and repairs interrupted moves ("healing"). I only read the code; nothing was run.

**Fix**
- **Healing can delete user edits (`move-item.ts:675`).** When healing finishes an interrupted move, it deletes the source copy without checking that the source still holds the bytes the journal recorded. A move can sit waiting because the target folder is unplugged. If the user overwrites a screenshot or saves an edit in the source workspace during that wait, those changes are deleted without warning once the target comes back. The fix is to quarantine the entry when the source no longer matches.
- **Failed source deletion leaves the item in both workspaces (`move-item.ts:676`).** Errors from deleting the source are ignored (lines 495-499 and 675), and the journal is removed anyway. If the delete fails, the item stays in both workspaces with nothing left to retry the cleanup. A later move back is then refused as "already there".

**Consider**
- **Healing clears every item's drag folder (`move-item.ts:674`).** It wipes the source workspace's whole `.kaipu/drag` folder, while the normal path clears only the moved item's drag folders.
- **Post-commit heal result is ignored (`move-item.ts:414`).** After the commit point, the result of the heal call is discarded, and a heal error makes the UI report a failed move even though the item is already in the target. The reported `mode` is also always "copied", even for a hard-linked move.

The other four files have no issues: `switch-transaction.ts`, `workspace-view.ts`, `video-edit-session.test.ts` and `move-group.test.ts`.

## Findings

### [fix/bug/medium] `apps/kaipu-record/src/main/workspaces/move-item.ts:675` Roll-forward deletes the source media and edit files even when the source changed after the journal was written

The roll-forward branch (line 661) checks only the target: `targetPresent && targetMatches && recordIsOurs`. It then unlinks `sourceMedia` whenever `sourcePresent` is true (line 675) and calls `removeCompanions` on the source (line 676). It never looks at `sourceMatches`, which is computed at lines 638-641 and only used in the `sourcePresent && targetPresent` branch.

Here is a case that hits it. The app dies after `committed` (or after `media-placed`). At the next startup the target folder is unplugged, so `resolveMoveSide` returns null and the entry waits (line 619, `index.ts:103-108`). Meanwhile the item still shows in the source workspace with its media and sidecar. The user overwrites the screenshot there (`screenshot-save.ts:69` takes the item lock, but no heal is holding it), or saves an edit session. When the target comes back, heal deletes the edited source and its newer `.edit.json`/assets, and keeps the target copy, which is older. Nothing tells the user.

This breaks the rule the docblock states at lines 574-576: a side is deleted only when the other side is verified complete. Here the target is complete only for the *old* bytes. Fix: when `sourcePresent && !sourceMatches`, quarantine instead of rolling forward. Also consider comparing the source sidecar with the target record before you remove the source companions.

### [fix/bug/medium] `apps/kaipu-record/src/main/workspaces/move-item.ts:676` A failed source deletion is swallowed and the journal is still dropped, leaving the item in both workspaces

After the commit, `removeCompanions` uses `Promise.allSettled` and ignores every rejection (lines 495-499). In the happy path the journal is then removed at line 402. If `rm(media)` at line 395 throws (EACCES, EBUSY), the catch calls `healEntry`. That function's `unlink(sourceMedia).catch(() => {})` (line 675) also hides the error, and `done()` deletes the journal (line 625).

In both cases the source keeps its media and/or sidecar under the same `assetId` as the target copy, and nothing is left to retry the cleanup. The user ends up with a duplicate in both workspaces. A later move back is refused as `already-there` (line 251), and since the record with no media carries that assetId, it can also feed `removeOrphanRecords` later.

Fix: re-check after deleting. If the source media or sidecar is still there, keep the journal in phase `committed` so the next `healMoves` finishes the job, instead of returning `healed`/`ok`.

### [consider/bug/medium] `apps/kaipu-record/src/main/workspaces/move-item.ts:674` Healing wipes every item's drag folder in the source workspace, not just this item's

`rm(join(sourceDir, META_DIR, "drag"), { recursive: true })` deletes the whole drag directory of the source workspace. The live path scopes this to one item with `deps.dragLedger?.clear(source.workspaceId, id)` (line 274; `drag-ledger.ts:39-43`). Healing therefore also removes drag copies of unrelated items that may be mid-drop, and the in-memory `DragLedger` keeps entries pointing at folders that no longer exist. Scope the removal to this item's drag folders, or document why the whole folder is safe to drop.

### [consider/bug/medium] `apps/kaipu-record/src/main/workspaces/move-item.ts:414` Post-commit heal outcome is ignored and its failure reports the move as an io refusal

In the post-commit catch, `healEntry`'s result is discarded. A quarantined entry still returns `{ ok: true, mode: "copied" }`, and `mode` is also wrong for a linked move. If `healEntry` itself throws, for example from `readSidecarStrict` or `writeJournal`, the error escapes this catch and `moveItem` turns it into `refuse("io")` (lines 204-207). The target then holds the item, and maybe a half-cleaned source, but the UI reports that the move failed. Consider wrapping the heal in a try/catch that still returns `ok: true` with the target id, keeping the actual mode.

## Contracts

- **closed** `apps/kaipu-record/src/main/workspaces/move-item.ts:661-677`: Heal roll-forward deletes source media and companions
  - failure_mode: The source edited while the entry waited is deleted, and the edits are lost silently; deletion errors are swallowed (line 675) and the journal is dropped (line 625).
  - before_after: The live path deletes the source under the item lock right after it verified the copy. Heal deletes it on a later run without re-checking that the source is still the journaled bytes (sourceMatches is unused here).
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/move-item.ts:395-402`: Source cleanup after commit and journal removal
  - failure_mode: Nothing retries the cleanup, because the journal is gone.
  - before_after: removeCompanions ignores every rejection, then the journal is removed.
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/move-item.ts:201`: Item lock taken by the mover and by other writers
  - failure_mode: 
  - before_after: Both the mover and these writers key the lock by (workspaceId, id); healMoves takes the same lock (line 599).
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/move-item.ts:674`: Healing removes the source drag folder
  - failure_mode: The ledger keeps stale entries.
  - before_after: The ledger clears only this item's folders; heal removes the whole directory.
  - open_question: 
