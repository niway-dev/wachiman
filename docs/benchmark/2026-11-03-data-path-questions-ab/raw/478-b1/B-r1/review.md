# 478-b1 B-r1

questions: destructive-step, overlapping-calls, bounded-wait, stale-write-back
cost_usd: 0.6194364, turns: 7, terminal: success, duration_ms: 89492

## Summary

Part 1: main-side create, edit and check-location, the brand-color upgrade, and the shared name helpers. Renderer input is type-checked and validated in main. `src/shared/workspace-name.ts` has no imports, and `src/shared/types/workspaces.ts` imports `TagColor` as a type only, so neither breaks the preload bundle. One fix: the one-time brand-color upgrade checks only the folder file's color. Through the whole-entry `pendingIdentity` write, it can put back \"Default workspace\" over a name changed on another Mac. Four smaller points: `edit` checks name uniqueness outside the lock, `edit`'s rollback misses the case where the folder had no identity file before, a name made only of forbidden characters gives a folder name ending in a space, and a non-string color is refused as \"invalid-name\".

## Findings

### [fix/bug/high] `apps/kaipu-record/src/main/workspaces/registry.ts:411` Brand-color upgrade can overwrite a name changed on another Mac

`upgradeDefaultColor` decides to upgrade from the registry's cached `owner.name === "Default workspace"` (line 407). It then only checks the folder file's **color** (line 411). When the folder's `identity.json` was renamed on another Mac (say to "Work") but still says rose, `upgrade` stays true and the entry gets `pendingIdentity`. The `availability(owner.id)` call at line 427 then reaches the pending branch at lines 625-634, which writes `name: entry.name` (the stale "Default workspace") and its initials over the file. The rename from the other Mac is lost without any message. That contradicts the docstring at lines 402-403 ("A name or color the user already changed … on another Mac, is left as it is").

The unplugged case is worse. `readIdentity` returns `absent`, so nothing is checked at all, and the full overwrite happens whenever the drive comes back.

Suggested fix: skip the upgrade when `file.identity.name !== DEFAULT_WORKSPACE_NAME`. Also make the deferred write for the upgrade touch only the color, and only if the file is still rose, instead of reusing the whole-entry `pendingIdentity` overwrite.

### [consider/bug/medium] `apps/kaipu-record/src/main/workspaces/registry.ts:588` edit() checks name uniqueness outside the update lock

`create` re-checks the name inside `update` (lines 514-516) so that two writers can't take the same name. `edit` only checks at line 540. It then awaits `availability`, `readIdentity` and `writeIdentity`, and finally applies the name in `update` without checking again (lines 588-597).

A `create` or another `edit` that takes the same name during those awaits passes its own check, because this edit isn't in `key.entries` yet. The result is two workspaces with the same name. It takes two dialogs in flight, so it's rare, but adding the same re-check inside the `update` callback would close it.

### [consider/bug/medium] `apps/kaipu-record/src/main/workspaces/registry.ts:600` Rollback skips the case where the folder had no identity.json before

The rollback only restores the file when `previous.kind === "ok"`. If the folder had no `identity.json` and the registry write fails, the file keeps the new name while `update` rolls the key back. The next probe sees a matching id and no `pendingIdentity`, takes the file as authoritative (lines 640-653), and adopts the refused rename in memory anyway. So the comment "The folder must not keep a change the registry refused" doesn't hold here. Removing the newly written file (for example with `removeIdentity`) when `previous.kind === "absent"` would make it true.

### [consider/bug/high] `apps/kaipu-record/src/shared/workspace-name.ts:48` A name made only of forbidden characters gives a folder name ending in a space

The trailing-character strip runs on `safe` alone, before the prefix is added. A name like `?`, `*` or `...` passes `normalizeWorkspaceName`, but `safe` becomes `""` and the folder is `"Kaipu Record — "`. That name ends with a space, which the docstring says never happens (Windows refuses it). It also means all such names map to the same folder, so the second one gets a confusing "exists" refusal. Applying the strip to the full folder name, or falling back to a placeholder when `safe` is empty, would fix both.

### [consider/bug/high] `apps/kaipu-record/src/main/workspaces/index.ts:265` A non-string color is refused as "invalid-name"

A missing or non-string `color` returns `reason: "invalid-name"`, so the dialog would show a name error for a color problem. Returning `"invalid-color"` when only `color` fails the type check would match what `reg.create` reports for a bad string color.

## Contracts

- **closed** `apps/kaipu-record/src/main/workspaces/index.ts:261`: workspaces:create IPC: create a folder next to the Default workspace's, register it, then switch to it
  - failure_mode: Refusals come back as typed reasons. If mkdir or writeIdentity fails, the folder and identity are undone (registry.ts:493-510). If the registry write fails, the same undo runs (512-522). A rejection from dismissHint after a successful create makes the IPC reject even though the workspace exists; addWorkspace has the same behaviour.
  - before_after: Same sequence as addWorkspace after the registry call: dismissHint, availability, runSwitch, broadcastState. The read-only check happens inside reg.create instead of in the handler.
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/identity.ts:166`: removeIdentity undo inside create
  - failure_mode: Errors are swallowed. At worst an empty .kaipu folder or the new folder is left over, and since nothing was registered there is no orphan record. The target is not re-verified: content added between checkNewLocation and the undo would only lose Kaipu's own file.
  - before_after: Removes identity.json, then rmdir on the .kaipu folders, which refuses a non-empty folder. The folder itself is removed only if create made it (madeFolder). It is only reached for a folder found free or empty earlier in the same call.
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/index.ts:280`: workspaces:edit IPC: rename or recolor
  - failure_mode: A failed folder write refuses the edit. A failed registry write rolls the file back only when it existed before (finding). The uniqueness check sits outside the lock (finding). When a pending edit is written later, it overwrites any name or color changed on another Mac in the meantime; this is the documented design.
  - before_after: Probes, writes identity.json if the folder is connected, then updates the registry. Otherwise it sets pendingIdentity, and the next probe writes the file (registry.ts:625-639).
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/registry.ts:405`: One-time brand-color upgrade at open
  - failure_mode: If preferences.json can't be written, the update rolls back and the upgrade is retried on the next launch. A folder renamed on another Mac but still rose has its name overwritten (finding).
  - before_after: Sets the marker and the owner's color with pendingIdentity in one update, then probes. The probe writes the whole cached entry (name, color, initials) to the file.
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/index.ts:309`: workspaces:check-location IPC
  - failure_mode: An invalid name returns parent-missing with a null path. Any stat error other than ENOENT is reported as not-empty. The wait is bounded only by the file system calls (isDirectory on up to 3 parents, then stat and readdir).
  - before_after: Read-only: stat and readdir on the candidate folder.
  - open_question: 
