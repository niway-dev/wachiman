# 478-b1 B-r2

questions: destructive-step, overlapping-calls, bounded-wait, stale-write-back
cost_usd: 0.519034, turns: 6, terminal: success, duration_ms: 77282

## Summary

Part 1 has one finding to fix and three smaller ones to consider.

The fix is in the one-time color upgrade. It checks the folder file's color but not its name, and the deferred `pendingIdentity` write then writes the cached name, color and initials over the file. A rename made on another Mac, or while the folder was unplugged, comes back as "Default workspace" with nothing to tell the user.

The three to consider:
- **create's undo:** it deletes identity.json without checking that the file is the one it wrote, so two overlapping creates with the same name can strip the winner's identity.
- **Folder name:** `newWorkspaceFolderName` can return a name ending in a space (for example for `?` or `...`), which its docstring says it never does and Windows refuses.
- **`checkNewLocation`:** it reports an empty or invalid name as "parent-missing", the same state as an unplugged drive.

The IPC handlers follow the same steps as their siblings and type-check their input. `src/shared/workspace-name.ts` imports nothing, which keeps to the preload bundle rule.

## Findings

### [fix/bug/high] `apps/kaipu-record/src/main/workspaces/registry.ts:407` Color upgrade reverts a rename made on another Mac

`upgradeDefaultColor` decides to upgrade from the registry's cached entry (`owner.name === "Default workspace" && owner.color === "rose"`, line 407). It checks only the folder file's **color** (line 411), and then sets `pendingIdentity`. On the next probe, the `pendingIdentity` branch writes the cached `name`, `color` and `initials` over the file (lines 628-633).

Here is the case that breaks. On another Mac the user renamed the folder's workspace to "Work" and kept rose. This Mac's cache still says "Default workspace" because no probe has refreshed it yet. On launch the upgrade runs, the probe at line 427 writes `name: "Default workspace"` into identity.json, and the rename is silently undone on both machines.

The same thing happens when the folder is not connected at launch: `readIdentity` does not return `ok` there, so neither guard applies (lines 410-412), and the stale name is written whenever the folder comes back. The doc comment at lines 403-404 says the reverse ("A name or color the user already changed, here or on another Mac, is left as it is").

The fix: skip the upgrade when `file.identity.name !== DEFAULT_WORKSPACE_NAME`. Better still, have the deferred write touch only the field the upgrade owns (color), so it doesn't replay the cached name.

### [consider/bug/medium] `apps/kaipu-record/src/main/workspaces/registry.ts:520` create's undo deletes identity.json without checking that it wrote that file

Two creates with the same name can overlap. A runs `mkdir` and B's `checkNewLocation` (line 477) still sees the folder as `empty`. B then overwrites A's identity.json (line 506), and B's `update` throws `NameTakenError`. B's `undo` then calls `removeIdentity(path)` (line 494), which force-removes the file without checking that it still holds B's id. A's registered workspace is left either pointing at B's id ("different" → unavailable) or with no identity at all, until a later probe rewrites it.

Nothing re-verifies the target between the decision and the delete. Compare the id in the file with `identity.id` before removing it, or serialize the whole create under a lock.

### [consider/bug/high] `apps/kaipu-record/src/shared/workspace-name.ts:48` A name made only of reserved characters gives the folder "Kaipu Record — " (trailing space)

The trailing strip applies only to `safe`. For a valid name such as `?`, `...` or `:` the result of the strip is empty, so the function returns `"Kaipu Record — "`, which ends in a space. That contradicts the docstring's guarantee and is a name Windows refuses. All such names also map to the same folder. Fall back to a placeholder (or refuse the name) when `safe` is empty.

### [consider/bug/low] `apps/kaipu-record/src/main/workspaces/registry.ts:449` checkNewLocation reports an invalid name as "parent-missing"

An empty or control-character name returns `{ path: null, state: "parent-missing" }`. The type documents that state as "the folder next to the Default workspace cannot be reached (an unplugged drive)". The IPC handler does the same for a non-string (index.ts:314). Does the dialog ever show the "drive not connected" message while the name field is empty? A separate state, or not probing for an invalid name, would keep the two apart.

## Contracts

- **closed** `apps/kaipu-record/src/main/workspaces/registry.ts:405-428`: Deferred `pendingIdentity` write set by the one-time color upgrade
  - failure_mode: A rename made on another Mac, or while the folder was unplugged, is silently overwritten.
  - before_after: The upgrade checks only the file's color, then the probe writes the cached name, color and initials over the file.
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/index.ts:261-278`: workspaces:create IPC
  - failure_mode: A dismissHint persist failure rejects the IPC after the workspace is already registered, the same as in addWorkspace.
  - before_after: Same sequence as the sibling: dismissHint, availability, runSwitch, broadcastState. Input is type-checked; the registry validates name and color.
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/registry.ts:493-496`: removeIdentity in create's undo
  - failure_mode: A concurrent create can lose the identity of the create that won.
  - before_after: Force-removes identity.json without re-checking its id. rmdir protects user content.
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/registry.ts:534-606`: workspaces:edit IPC
  - failure_mode: Folder write failure → not-writable, nothing changed. Registry write failure → previous file restored (only when the file was ok).
  - before_after: Probes, writes the folder file first, then updates the registry; rolls the file back if the registry write fails.
  - open_question: 
