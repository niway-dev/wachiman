# 479-b2 B-r2

questions: destructive-step, read-error-as-empty, overlapping-calls, stale-write-back
cost_usd: 0.5195982, turns: 7, terminal: success, duration_ms: 76446

## Summary

I found three problems in this part, all in move-item.ts; the other four files had nothing to flag.

- **Fix (lost edits):** when the startup heal finishes an interrupted move, it deletes the source copy of the item without checking that it is still the version recorded when the move started (line 675). This bites when the target drive was unplugged after the crash and the user kept editing the item in the source workspace: the edits are deleted silently once the target comes back.
- **Consider:** the heal deletes the drag folders of every item in the source workspace, not just the moved one (line 674). It also runs before each move group, so it can break another item's drag-out that is still in progress.
- **Consider:** if the heal fails after the commit (line 409), the user is told the move failed even though it completed. That same path always reports the move as a copy, even when the file was hard-linked.

Checked and fine:
- A heal can't run on a journal while that move is still in flight; the `moveRun` guard keeps them apart.
- Rolling back the target re-reads its sidecar before deleting anything.
- The switch-transaction and workspace-view changes are type and field plumbing and look right.

## Findings

### [fix/bug/medium] `apps/kaipu-record/src/main/workspaces/move-item.ts:675` Roll-forward deletes the source media and records without checking they are still the journaled version

In the roll-forward branch (661-678), the target is checked with `mediaMatches`, but the source is not. `sourceMatches` is computed at 638-641 and used only in the both-present branch (690). Line 675 unlinks `sourceMedia` and line 676 removes every source companion (sidecar, edit session, assets) whenever the source file exists.

How it can happen: the app crashes between `media-placed` and `source-media-deleted`. At the next start the target workspace is unplugged, so `healEntry` returns `waiting` (619). The source item is still complete and listed in the active workspace, and the user keeps editing it (a screenshot overwrite, an edit-session save). When the target comes back, `healPendingMoves` runs before the next move group (`workspaces/index.ts:169`). The target still matches the journal, so the source media and records holding the newer edits are deleted. The target keeps the pre-crash copy. The only log is the generic heal report, so the edits are lost silently.

Suggested fix: roll forward only when `sourceMatches` is true or the source is absent. If the source exists but changed since the journal was written, quarantine the entry instead.

### [consider/bug/medium] `apps/kaipu-record/src/main/workspaces/move-item.ts:674` Healing one move wipes the drag folders of every item in the source vault

Line 674 removes `<source>/.kaipu/drag` (`dragRoot`, `library/drag-copies.ts:14-16`) for the whole vault. The mover itself clears only this item's folders through the ledger (`deps.dragLedger?.clear(source.workspaceId, id)`, line 274) and refuses `dragged-just-now` (243). Healing runs before every move group (`workspaces/index.ts:169`), not only at startup, so a pending entry can delete another item's drag copy while a drop into another app is still reading it. The ledger keeps listing the deleted folders.

Suggested fix: pass the ledger in and clear only `(journal.source.workspaceId, journal.sourceId)`. A vault-wide wipe would still be fine at startup, where `drag-copies.ts` already does one.

### [consider/bug/high] `apps/kaipu-record/src/main/workspaces/move-item.ts:409` A heal error after the commit makes a completed move report `io`

Past the commit, the catch calls `healEntry` (409-413) with no guard of its own. Any error it throws (for example from `writeJournal` or `readSidecarStrict`) reaches `moveItem`'s catch (204-207), which returns `refuse("io")`. The item is already in the target, with its source partly deleted, but the user is told the move failed.

Separately, line 414 always reports `mode: "copied"`, even when the media was hard-linked.

Suggested fix: wrap the heal in a try/catch, log the error, and still return `ok: true` with the real `mode`. The journal stays in place for the next heal.

## Contracts

- **closed** `apps/kaipu-record/src/main/workspaces/move-item.ts:661`: Healing rolls a journaled move forward and deletes the source media and companions
  - failure_mode: If the source changed while the entry waited, the newer source media and records are deleted with no notice. unlink errors are swallowed (675).
  - before_after: moveLocked deletes the source right after the commit, while it holds the lock. Healing can run much later, after the source may have been edited, and it re-verifies only the target (654), not the source (638-641 are computed but not used here).
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/move-item.ts:674`: Healing deletes the whole source drag root
  - failure_mode: Errors are swallowed (`.catch(() => {})`), and the ledger keeps the deleted folders listed.
  - before_after: The mover clears only this item's folders. Healing removes every item's folders, and also runs before each move group.
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/move-item.ts:590`: Concurrent healMoves and moveItem on the same journal
  - failure_mode: 
  - before_after: healMoves reads each journal before it takes the item lock. A second run is refused while moveRun is set, and healing runs inside the same run before its moves, so a stale journal read cannot overlap an in-flight move.
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/move-item.ts:506`: rollBackTarget deletes the target record and companions
  - failure_mode: removeCompanions uses allSettled, so a failed rm leaves orphan files that removeOrphanRecords collects later.
  - before_after: Re-reads the target sidecar strictly. It returns without deleting when the record belongs to another asset or cannot be read, and deletes media only when the caller passes it.
  - open_question: 
