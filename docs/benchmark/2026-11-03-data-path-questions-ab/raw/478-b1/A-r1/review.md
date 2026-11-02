# 478-b1 A-r1

questions: none (arm A engine)
cost_usd: 0.5731839999999999, turns: 7, terminal: success, duration_ms: 75325

## Summary

I found one bug in part 1, two smaller points to consider, and no security or rules problems.

- **Bug (fix):** `edit` always clears `pendingInit`, even when the folder was not reached. A workspace that was registered while its drive was unplugged and then renamed while still offline can no longer adopt the id it finds in its folder. When the drive comes back, it stays "different" (unavailable) for good.
- **Consider:** a name made only of dots or forbidden characters gives the folder name "Kaipu Record — " with a trailing space, which the function's own docstring says it prevents.
- **Consider:** `edit` checks that the name is free outside the update lock, while `create` checks again inside it, so two overlapping requests could end up with the same name.

The rest checks out:
- The new IPC handlers check the types of the values the renderer sends.
- `src/shared/workspace-name.ts` has no imports.
- `create` removes what it wrote when something fails.
- The one-time brand-color upgrade stores its marker in the same write as the color change.

## Findings

### [fix/bug/medium] `apps/kaipu-record/src/main/workspaces/registry.ts:594` Editing an unreachable pendingInit workspace drops pendingInit, so it can never adopt its folder's id

`edit` clears `pendingInit` every time (line 594), including when the folder was not reached and `savedToFolder` is false. `pendingInit` is the flag `availability` checks before adopting the id it finds in the folder (line 657: `if (entry.pendingInit && !this.get(identity.identity.id))`). Here is the failing case. An entry is registered while its drive is unplugged (`migrate` line 293, `register` line 372). The user renames it while the drive is still away, and the probe at line 560 returns `missing`. Line 594 then deletes `pendingInit` and line 596 sets `pendingIdentity`. When the folder comes back holding an identity.json with another id (one written by another Mac, or by an earlier run), the adoption branch is skipped and the workspace stays `unavailable: different` for good. It did not before the rename. Fix: clear `pendingInit` only when `savedToFolder` is true, the same way `pendingIdentity` is handled on lines 595-596.

### [consider/bug/high] `apps/kaipu-record/src/shared/workspace-name.ts:48` A name made only of unsafe characters or dots gives a folder name ending in a space

`newWorkspaceFolderName` cleans only the user's part. If that part is all dots or forbidden characters (`"..."`, `"?"`, `"/"`), `safe` is empty. The result is then `"Kaipu Record — "`, which ends in the prefix's trailing space. That is exactly what the docstring says it prevents, and Windows silently strips the space, so the registered path would not match the created folder. Such names pass `normalizeWorkspaceName`, so `create` accepts them. Two options: trim the whole result, or refuse an empty `safe` (or fall back to a placeholder).

### [consider/bug/medium] `apps/kaipu-record/src/main/workspaces/registry.ts:540` edit checks name uniqueness outside the update lock, unlike create

`create` checks the name again inside `update` (lines 514-516) so that two concurrent creates cannot take the same name. `edit` checks only against the snapshot it reads before the awaits at lines 560-581. A `create` or another `edit` that finishes in between can register the same name, and the edit's `update` (lines 588-597) never checks again. One option is to throw `NameTakenError` from inside the mutate, as `create` does, and roll back the folder write in the catch.

## Contracts

- **closed** `apps/kaipu-record/src/main/workspaces/index.ts:261`: workspaces:create IPC: validate name and color, make the folder `Kaipu Record — <name>` next to the Default workspace's, write identity.json, register it, then switch
  - failure_mode: If writeIdentity or the registry update fails, the code removes identity.json and, when it made the folder, the folder too, then returns not-writable. A name taken during the create comes back as name-taken. If dismissHint rejects (preferences write failed), the handler rejects after the workspace is already registered; addWorkspace has the same behaviour.
  - before_after: Same order as addWorkspace: reg.dismissHint, then reg.availability, runSwitch, broadcastState. createWorkspace does not check reg.readOnly itself, but reg.create returns 'read-only' at its first line.
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/index.ts:280`: workspaces:edit IPC: rename or recolor, written to identity.json first and then to the registry
  - failure_mode: If the folder write fails, nothing changes (not-writable). If the registry write fails, the previous identity is written back when one existed. Line 594 clears pendingInit even when the folder was not reached (reported as a finding).
  - before_after: Runs a probe first, writes the identity atomically, then updates the registry with rollback. On success: refreshTitles and broadcastState. An unreachable folder is updated in the registry only, with pendingIdentity set.
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/index.ts:309`: workspaces:check-location IPC: a read-only stat and readdir of the computed folder path
  - failure_mode: A stat error other than ENOENT (for example EACCES) is reported as not-empty, so create refuses with 'exists'. A non-string name gives parent-missing. Nothing is written.
  - before_after: Normalizes the name, resolves the parent folder (Default entry, then defaultDirectory, then the active workspace's parent), then stats the target.
  - open_question: 
