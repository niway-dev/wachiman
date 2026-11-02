# 482-b2 B-r2

questions: destructive-step, overlapping-calls, bounded-wait, stale-write-back
cost_usd: 0.47658960000000006, turns: 5, terminal: success, duration_ms: 60360

## Summary

Part 2 has four findings, all in `workspace-settings.ts`; the five test files had nothing to flag.

1. **Lost edits (fix):** nothing serializes the folder file's read-modify-write. Two overlapping edits to the same workspace drop one of them without telling the user. A refresh that overlaps a write can also leave this Mac's own overrides showing as `pending`.
2. **Failure path (fix):** when a write lands only partly, the call reports `failed` but never calls `changed()`. The cache and the folder file no longer match what the windows show.
3. **Unknown keys dropped (consider):** rewriting the folder file removes keys this build does not know or rejects.
4. **Slow All scope (consider):** opening Settings at the All scope refreshes every workspace one after another, so the wait grows with the number of slow or evicted folders.

One question stays open: whether `reg.availability`, which every refresh awaits, has its own timeout. I didn't read the registry to check.

## Findings

### [fix/bug/medium] `apps/kaipu-record/src/main/workspaces/workspace-settings.ts:224` Folder-file read-modify-write has no per-workspace lock; two overlapping edits lose one

`applyFolder` reads the folder file (line 224), awaits, builds `next` from that read, and writes the whole file (line 241). Nothing serializes calls: the IPC handlers in `apps/kaipu-record/src/main/workspaces/index.ts:533-557` call `setOverride`/`resetOverrides`/`copyToAll` directly, and only `MachineSettingsStore.update` has a tail queue (`settings-overrides.ts:244-260`). If the user flips two workspace-scoped settings quickly (say the badge, then copy mode), A and B both read base X. A writes X+a, then B writes X+b, so A's key is gone from the file. Both calls return `ok`, and B's answer leaves the change out without any message. `refresh` can race the same way: a read that started before the write can finish after line 242 and overwrite the cache with the old bytes (line 92). The machine record now holds the new sha, so `stateOf` reports `pending` and this Mac's own overrides stop applying until the next refresh. Fix: chain every folder read-and-write per workspace id on one promise tail, the way `MachineSettingsStore` does, and have `refresh` use the same tail.

### [fix/bug/high] `apps/kaipu-record/src/main/workspaces/workspace-settings.ts:210` Partial write on the failure path updates the cache without telling anyone and reports `failed`

Two cases. (1) `writeFolderOverrides` succeeds and the cache is set to the new bytes (lines 241-242), then `machine.update` (243) throws. The record keeps the old sha, so `stateOf` now returns `pending` for this Mac's own write (`folderState`, `settings-overrides.ts:168`), and every folder override of the workspace goes inactive. (2) In a mixed change (`resetOverrides` with every key, or `copyToAll`), the folder write succeeds and then the `uploadMode` machine update fails. In both cases the catch at line 210 returns `failed` and never calls `deps.changed()`. Windows keep the old effective settings while the resolver's cache already holds the new ones, and the folder file has changed even though the user was told nothing was saved. Call `deps.changed()` in the catch, or before returning `failed` once any write has landed, so the state that is shown matches what is on disk.

### [consider/bug/medium] `apps/kaipu-record/src/main/workspaces/workspace-settings.ts:231` Rewriting the folder file drops keys this version does not know or cannot validate

`base` comes from `read.overrides`, which `readFolderOverrides` has already filtered down to the four valid folder keys (`settings-overrides.ts:97-102`). A file in a synced folder that a newer app version wrote, with an extra key or a value this build rejects, loses those entries the first time this Mac edits any key. Consider keeping the raw `overrides` object from the file and changing only the keys being edited.

### [consider/perf/medium] `apps/kaipu-record/src/main/workspaces/workspace-settings.ts:126` The All scope refreshes every workspace one after another; the wait is not bounded as a whole

`getScoped("all")` awaits `refresh` for each workspace in turn. Each refresh is `isAvailable`, which has no timeout (`reg.availability`), plus a read capped at 2 s. Opening Settings at the All scope can therefore wait about N × 2 s plus the availability probes when several folders sit on evicted or slow cloud drives. Running the refreshes in parallel (`Promise.all`) would cap the wait at roughly one timeout. `getScoped(id)` also calls `isAvailable` twice (line 155, then again inside `refresh`).

## Contracts

- **closed** `apps/kaipu-record/src/main/workspaces/workspace-settings.ts:218`: Edit a folder-bound override (setOverride/resetOverrides/copyToAll -> applyFolder)
  - failure_mode: Overlapping calls lose one edit. If the machine update fails after the file write, the state turns pending and nothing is broadcast
  - before_after: MachineSettingsStore chains each update; applyFolder reads the disk, awaits, then writes the whole file with no chaining
  - open_question: 
- **open** `apps/kaipu-record/src/main/workspaces/workspace-settings.ts:88`: Read a folder file with a timeout at capture start or a workspace switch (refresh)
  - failure_mode: A read that times out counts as unreadable and the overrides go inactive. A hung availability probe blocks capture start
  - before_after: The read is raced against a 2 s timeout; isAvailable before it has no bound
  - open_question: Does reg.availability have its own timeout?
