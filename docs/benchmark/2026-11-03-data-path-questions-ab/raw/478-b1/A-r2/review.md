# 478-b1 A-r2

questions: none (arm A engine)
cost_usd: 0.6480456000000001, turns: 7, terminal: success, duration_ms: 73167

## Summary

Part 1 covers the IPC and registry side of workspace create/edit and the upgrade to the kaipu color. The preload only adds three invoke calls, and the main process checks the type of every input; the new shared module has no imports. Two bugs need fixing. First, the color upgrade can write \"Default workspace\" back over a rename made on another Mac when that file is still rose. Second, an edit whose internal probe adopts a new id for the active entry never rebinds the workspace gate. There are also smaller suggestions: re-check the name inside edit's write, avoid the folder name with a trailing space, and return invalid-color instead of invalid-name for a non-string color.

## Findings

### [fix/bug/medium] `apps/kaipu-record/src/main/workspaces/registry.ts:411` Color upgrade can undo a rename made on another Mac

`upgradeDefaultColor` only skips when the folder's `identity.json` has a non-rose color. If the file was renamed elsewhere (for example, renamed to "Work" on another Mac running this version, with the color left as rose), this Mac's stale cache still says `Default workspace`/rose. In that case `upgrade` stays true, `pendingIdentity` is set (line 419), and the `availability` probe at line 427 takes the pending branch (lines 625-633). That branch writes `name: entry.name`, which puts "Default workspace" back into the folder's file. The rename is lost and nothing tells the user. This contradicts the docstring ("A name or color the user already changed, here or on another Mac, is left as it is"). Fix: also skip the upgrade when `file.identity.name !== DEFAULT_WORKSPACE_NAME`, or have the upgrade write only the color.

### [fix/bug/medium] `apps/kaipu-record/src/main/workspaces/index.ts:289` Edit can move the active workspace's id without rebinding the gate

`reg.edit` runs `this.availability(id)` itself (registry.ts:560). For a `pendingInit` entry whose folder now has an identity, that probe adopts the folder's id and rewrites `key.activeId` (registry.ts:657-666). Every other caller of a probe on the active entry then calls `workspaceGate().adopt(before, after, reg.active().id)`: see `listState` (index.ts:136) and `requireCaptureWorkspace` (index.ts:113). `editWorkspace` does not. Later probes return the same id, so `listState` sees before === after and never catches up. The gate keeps the old id while the registry's active id is the new one. After that, `runActive(reg.active().id, …)` throws `StaleWorkspaceError` (gate.ts:61), and windows are never re-stamped. Fix: after `reg.edit`, call `if (workspaceGate().adopt(id, outcome.entry.id, reg.active().id))` before broadcasting.

### [consider/bug/medium] `apps/kaipu-record/src/main/workspaces/registry.ts:540` Edit does not re-check the name inside the write, unlike create

`create` checks again that the name is free inside `update` (lines 514-516), so two concurrent creates cannot take the same name. `edit` checks only before its awaits (probe, `readIdentity`, `writeIdentity`). A create or edit that finishes in between, for example from a second window, can leave two workspaces whose names differ only by case. Consider the same `NameTakenError` re-check in the `update` at line 588, and roll back the folder write when it fails.

### [consider/bug/high] `apps/kaipu-record/src/shared/workspace-name.ts:48` A name made only of forbidden or trailing characters gives a folder name that ends in a space

For names like `???`, `...` or `//`, `safe` ends up empty, and the result is `Kaipu Record — ` with a trailing space. That is exactly what the docstring says Windows refuses, and the repository ships a Windows build. All of these names also map to the same folder, so the second one is refused as `exists`, which the user cannot explain. Consider stripping trailing spaces after adding the prefix, or rejecting a name whose `safe` part is empty.

### [consider/bug/high] `apps/kaipu-record/src/main/workspaces/index.ts:264` A non-string color is reported as invalid-name

`createWorkspace` returns `invalid-name` when `color` is not a string. Return `invalid-color` in that case, the same as `reg.create` does for an unknown color string, so the dialog does not flag the name field.

## Contracts

- **closed** `apps/kaipu-record/src/main/workspaces/index.ts:261`: workspaces:create IPC: create a folder next to the Default workspace, register it, then switch
  - failure_mode: create undoes its own files when the identity write or the registry write fails (registry.ts:493-521). If dismissHint rejects after the create succeeded, the IPC rejects while the workspace stays registered. addWorkspace has the same behavior.
  - before_after: Same order as addWorkspace. The read-only check is in reg.create (registry.ts:471). A refused switch is returned as switchResult, and runSwitch re-broadcasts on refusal (index.ts:211).
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/index.ts:280`: workspaces:edit IPC: rename and/or recolor a workspace
  - failure_mode: If the folder write fails, the edit is refused whole. If the registry write fails, the previous identity is restored. When the id is adopted, the gate is left stale (reported as a finding).
  - before_after: editWorkspace probes the entry inside reg.edit but never calls gate.adopt, so if the active pending entry adopts a new id, the gate is not told.
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/index.ts:309`: workspaces:check-location IPC: compute and probe the folder a new workspace would get
  - failure_mode: A non-string or invalid name returns parent-missing. A stat error other than ENOENT returns not-empty.
  - before_after: The name is normalized, and separators are replaced by newWorkspaceFolderName, so a renderer string cannot escape the parent folder.
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/registry.ts:405`: One-time upgrade of the migrated Default workspace from rose to the kaipu color on open
  - failure_mode: If the preferences write fails, the upgrade is logged and retried on the next launch. If the file was renamed elsewhere but is still rose, the rename is overwritten (reported as a finding).
  - before_after: The marker and the color change are stored in one update, and then the folder is probed.
  - open_question: 
