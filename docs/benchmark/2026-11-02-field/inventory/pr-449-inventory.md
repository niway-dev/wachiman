# kaipu-record #449: bot findings inventory

## F1 · Wachiman · inline · `apps/kaipu-record/src/preload/index.ts:53` · at `1eb0638` · 2026-10-30T19:38:39Z
https://github.com/niway-dev/kaipu-record/pull/449#discussion_r4427785179

🟡🐛 **Consider · bug: Any `workspaces:changed` clears the switching guard, not only the end of a switch**

The listener sets `switching = false` on every `workspaces:changed`. Main sends that broadcast for registry edits and busy-state changes too (dismissHint, remove, `notifyWorkspaceBusyChanged`), not only when a switch ends. If one of those arrives after this window answered prepare but before the switch commits, the window takes item calls again, still under the old stamp. The main-side gate should still refuse them, so this is defence in depth rather than a leak. Still, the preload's own guarantee ("nothing this window starts can reach main") breaks. One fix: clear `switching` only when the generation in the broadcast differs from the current stamp's, or on `prepare-abort`.

> **Reply by csdev19** (2026-10-30T20:39:05Z):
>
> > [!NOTE]
> > 🤖 **Claude Sonnet 5.5 responding on behalf of Cristian Sotomayor**
> 
> Fixed in 32ca6a98: the stamp and the guard moved into `WorkspaceStampGuard`, which clears `switching` only when a broadcast changes the stamp (the switch's end) or on `prepare-abort`. A registry edit or lock-change broadcast under the same stamp no longer clears it. Covered by `workspace-stamp-guard.test.ts`.

## F2 · Wachiman · inline · `apps/kaipu-record/src/main/media-protocol.ts:99` · at `1eb0638` · 2026-10-30T19:38:39Z
https://github.com/niway-dev/kaipu-record/pull/449#discussion_r4427785191

🟡🐛 **Consider · bug: Only screenshot and thumb URLs carry `w`; a URL without it still resolves in whatever workspace is active**

`LibraryVault.describe` adds `w` only to the `screenshot/` and `thumb/` URLs (library-vault.ts:182-184). This check skips every URL without `w`, so recording/video playback URLs, and any URL built elsewhere without `w`, resolve against the active workspace. A video URL cached before a switch can therefore play another workspace's item that has the same id, which is the case this comment says cannot happen. Either stamp every media URL the app hands out, or narrow the comment to what is actually covered.

> **Reply by csdev19** (2026-10-30T20:39:08Z):
>
> > [!NOTE]
> > 🤖 **Claude Sonnet 5.5 responding on behalf of Cristian Sotomayor**
> 
> Fixed in aa9ac609: the protocol check already ran before the kind dispatch, so the gap was URLs without `w`. The renderer built recording and screenshot URLs by hand; they now all go through `mediaUrl()`, which stamps the window's workspace, and a test fails if a hand-built `kaipu-media://<kind>/` URL reappears. A URL with no `w` is still served (I could not exercise a stricter rule without running Electron, which is off limits here); the protocol comment now says so.

## F3 · Wachiman · inline · `apps/kaipu-record/src/main/screenshots/screenshot-ipc.ts:235` · at `1eb0638` · 2026-10-30T19:38:39Z
https://github.com/niway-dev/kaipu-record/pull/449#discussion_r4427785199

🟡❓ **Consider · question: Can `requireCaptureWorkspace` rebind the stamp inside a scoped call and make a successful save reject as stale?**

`requireCaptureWorkspace` calls `rebindAfterAdoption(id)` when the folder's identity differs from the stamp (workspaces/index.ts:109). Here it runs inside `scoped(...)` for the editor's Save. If that rebind broadcasts `workspaces:changed` with a new generation before the invoke reply, the preload's `sameStamp(stamp, sent)` check (preload/index.ts:86) throws `stale-workspace` even though the PNG was written. The user could then save again and get a duplicate item. Does the rebind broadcast before the reply? If it does, should adoption happen outside item-scoped calls?

> **Reply by csdev19** (2026-10-30T20:39:11Z):
>
> > [!NOTE]
> > 🤖 **Claude Sonnet 5.5 responding on behalf of Cristian Sotomayor**
> 
> Real, though narrow, and fixed in 281451c3. Adoption inside the scoped call bumped the generation, so the preload rejected a save that had already written, and saving again duplicated the item. The editor's Save (`saveEditedScreenshot`) now probes the folder before it enters the gate, so the same adoption makes the call refuse before it writes anything. Test: `screenshot-save.test.ts`.

## F4 · Wachiman · inline · `apps/kaipu-record/src/main/workspaces/index.ts:109` · at `1eb0638` · 2026-10-30T19:38:39Z
https://github.com/niway-dev/kaipu-record/pull/449#discussion_r4427785210

🟡🐛 **Consider · bug: Adoption check compares the probed id with the gate stamp, so it can rebind the gate to a workspace that is no longer active**

`requireCaptureWorkspace` captures `active` before the `await reg.availability(active.id)` but compares the result with `workspaceGate().stamp.workspaceId` after the await. If a switch commits while the probe is running (`switchWorkspace` → `gate.commit(target)`, switch-transaction.ts:75), `id` is still the old workspace's id and the stamp is the new one. They differ, so `rebindAfterAdoption(id)` points the gate back at the old workspace while `reg.active()` is the new one. Renderer calls stamped with the committed stamp are then refused until the next broadcast.

`listState` (line 137) has a related window. `registry.setActive` sets `key.activeId` before it awaits `persist` (registry.ts:511-513). A `listState` running during that write sees the target as `reg.active()` while the gate still holds the old id, so it rebinds the gate to the target. If `persist` then fails, `setActive` restores the old activeId and the switch calls `gate.reopen()`. The gate ends up open and bound to the target while the registry's active entry is the old one.

Adoption is the only case that should trigger a rebind: the probed entry's own id changed. Testing that directly (`if (id !== active.id && reg.active().id === id)` here, and the equivalent `id !== <entry id before the await>` in `listState`) would stop a concurrent switch from being mistaken for an adoption.

> **Reply by csdev19** (2026-10-30T20:39:13Z):
>
> > [!NOTE]
> > 🤖 **Claude Sonnet 5.5 responding on behalf of Cristian Sotomayor**
> 
> Fixed in b69ce68b for both spots. `WorkspaceGate.adopt(before, after, registryActiveId)` rebinds only when the gate still holds the entry the probe started from and the registry's active entry is the adopted id. A switch that committed or was persisting meanwhile is no longer taken for an adoption. Tests in `gate.test.ts`. Related: df1a80f6 keeps a probe's own cache update in memory when its write fails, so adoption still takes effect.

## F5 · Wachiman · inline · `apps/kaipu-record/src/main/workspaces/index.ts:196` · at `1eb0638` · 2026-10-30T19:38:39Z
https://github.com/niway-dev/kaipu-record/pull/449#discussion_r4427785220

🟡🐛 **Consider · bug: A window closed during prepare blocks the switch for the full 120 s timeout**

`prepareWindows` sends one request to each window and waits until that window answers or `PREPARE_TIMEOUT_MS` (120 s) expires. If a window is closed or its renderer crashes after the request goes out, nothing answers. The switch waits two minutes and is then cancelled, and `inFlight` blocks any other switch during that time (switch-transaction.ts:48). Listening for `webContents` `destroyed` / `render-process-gone` inside the promise and resolving `true` (that window has nothing left to flush), or `false`, would end the wait at once.

> **Reply by csdev19** (2026-10-30T20:39:16Z):
>
> > [!NOTE]
> > 🤖 **Claude Sonnet 5.5 responding on behalf of Cristian Sotomayor**
> 
> Fixed in efc3280e: the prepare wait moved to `PrepareRequests`, which also resolves a window that closes, is destroyed or loses its renderer (it counts as prepared, since it has nothing to flush). A window that stays open and silent still times out. Tests in `prepare-windows.test.ts`.

## F6 · Wachiman · inline · `apps/kaipu-record/src/main/workspaces/registry.ts:536` · at `1eb0638` · 2026-10-30T19:38:39Z
https://github.com/niway-dev/kaipu-record/pull/449#discussion_r4427785227

🟡🐛 **Consider · bug: update() keeps the in-memory change when the write fails**

`update` runs `mutate(this.key)` and then `persist`. If `persist` throws (for example preferences.json became unparseable, line 548, or the disk is full), the change stays in memory. So `add()` (lines 467/471/490) rejects, yet the new entry is in `entries()` and shows in the switcher. `remove()` (line 500) also rejects, yet the entry is gone for the rest of the session. The next successful write then stores a change the user was told had failed. `setActive` (lines 510–517) already rolls back on failure. Snapshotting `this.key` (e.g. `structuredClone`) before `mutate` and restoring it on a failed `persist` would give `add` and `remove` the same guarantee. `refresh` can keep its best-effort behaviour.

> **Reply by csdev19** (2026-10-30T20:39:18Z):
>
> > [!NOTE]
> > 🤖 **Claude Sonnet 5.5 responding on behalf of Cristian Sotomayor**
> 
> Fixed in 928d5b05: `update()` snapshots the registry and restores it when the write fails, and updates now run one at a time so a rollback never discards another update's change. `setActive` uses the same path. `refresh()` keeps its best-effort behaviour (df1a80f6), as you suggested. Tests: a failed add, remove and dismissHint leave the list as it was.

## F7 · Wachiman · inline · `apps/kaipu-record/src/main/workspaces/switch-transaction.ts:68` · at `1eb0638` · 2026-10-30T19:38:39Z
https://github.com/niway-dev/kaipu-record/pull/449#discussion_r4427785231

🟡🐛 **Consider · bug: Pending captures are dropped before the step that can still abort the switch**

`dropPendingCaptures()` runs before `persistActive(target)`. If `persistActive` throws (`setActive` rethrows a failed persist, registry.ts:513–516), the old workspace stays active and the windows go back to normal, but the retained quiet-capture bytes and toasts are already gone. That breaks the doc comment's promise that a failure before the commit leaves the old workspace "active and unchanged". A Copy whose save failed (the bytes are kept once for Edit) loses its only stored copy. Dropping the captures after `persistActive` succeeds, still under the closed gate, keeps that promise.

> **Reply by csdev19** (2026-10-30T20:39:21Z):
>
> > [!NOTE]
> > 🤖 **Claude Sonnet 5.5 responding on behalf of Cristian Sotomayor**
> 
> Fixed in f2b91d19: `dropPendingCaptures()` now runs after `persistActive` succeeds, still under the closed gate. The switch-transaction test pins the new order and that a failed persist keeps the captures.

## F8 · Wachiman · inline · `apps/kaipu-record/src/main/workspaces/registry.test.ts:411` · at `1eb0638` · 2026-10-30T19:38:39Z
https://github.com/niway-dev/kaipu-record/pull/449#discussion_r4427785239

🟡🧪 **Consider · tests: "refuses ... the last workspace" never reaches the `last` refusal**

Both assertions in this test expect `reason: "active"`. The test never sees the `"last"` outcome. In `registry.ts:498-499` the `active` check runs before `entries.length <= 1`. The active id always points at a registered entry, so with a single entry that entry is the active one, and `remove` returns `"active"` before it gets to `"last"`. So the test name promises coverage of a branch that, as far as I can tell, can't be reached at all. You could rename the test to cover only the active refusal. Or, if the `last` guard is there on purpose as defence in depth, add a comment in `registry.ts` that says so, so nobody assumes this test covers it.

> **Reply by csdev19** (2026-10-30T20:39:23Z):
>
> > [!NOTE]
> > 🤖 **Claude Sonnet 5.5 responding on behalf of Cristian Sotomayor**
> 
> Agreed, the `last` branch is unreachable. Fixed in 928d5b05: the test is renamed to "refuses the active workspace, even when it is the only one", and `registry.ts` now has a comment saying the `last` guard is defence in depth.

## F9 · Wachiman · inline · `apps/kaipu-record/src/renderer/src/features/workspaces/workspace-switcher.tsx:160` · at `1eb0638` · 2026-10-30T19:38:39Z
https://github.com/niway-dev/kaipu-record/pull/449#discussion_r4427785249

🟠🐛 **Fix · bug: Menu says "Saving to: Here" while the active workspace is not connected**

The current-workspace card always shows `Saving to` → `savingToHere` ("Here"). When `active.state === "unavailable"`, the bar beside it says "Not connected · Captures paused" (`notConnectedState`, en.json:2195) and the notice says nothing is saved anywhere else. So the menu shows two statements that contradict each other. Show the paused state (or hide this stat) when `active.state === "unavailable"`, the same way line 149 already dims the tile.

> **Reply by csdev19** (2026-10-30T20:39:25Z):
>
> > [!NOTE]
> > 🤖 **Claude Sonnet 5.5 responding on behalf of Cristian Sotomayor**
> 
> Fixed in 5ceab724: a disconnected active workspace shows `Saving to: Paused` (new `savingToPaused` key, en and es) instead of `Here`. Test in `workspace-switcher.test.tsx`.

## F10 · Wachiman · inline · `apps/kaipu-record/src/renderer/src/features/workspaces/workspace-switcher.tsx:174` · at `1eb0638` · 2026-10-30T19:38:39Z
https://github.com/niway-dev/kaipu-record/pull/449#discussion_r4427785253

🟡🐛 **Consider · bug: Show in Finder is enabled for a disconnected active workspace**

Settings → Workspaces disables Show folder when `workspace.state === "unavailable"` (settings-pages.tsx:256). This menu shortcut stays enabled for an active workspace that isn't connected, so it tries to open a folder that doesn't exist. Disable it the same way here so both places behave alike.

> **Reply by csdev19** (2026-10-30T20:39:27Z):
>
> > [!NOTE]
> > 🤖 **Claude Sonnet 5.5 responding on behalf of Cristian Sotomayor**
> 
> Fixed in 5ceab724: the Finder/Explorer shortcut is disabled when the active workspace is not connected, like Settings' Show folder. Test in `workspace-switcher.test.tsx`.

## F11 · Wachiman · inline · `apps/kaipu-record/src/renderer/src/features/workspaces/workspace-switcher.tsx:76` · at `1eb0638` · 2026-10-30T19:38:39Z
https://github.com/niway-dev/kaipu-record/pull/449#discussion_r4427785260

🟡🐛 **Consider · bug: Any Escape anywhere in the window dismisses the one-time hint for good**

The keydown listener is on `window` and does not check `event.defaultPrevented` or where the key was pressed. While the hint shows, an Escape that closes an editor dialog, a modal or a select also calls `dismissHint()`, which saves the dismissal for good. While the menu is open, the same Escape also closes the menu along with whatever else handles it. Ignore events that are already handled (`event.defaultPrevented`), or only react when focus is inside the switcher.

> **Reply by csdev19** (2026-10-30T20:39:29Z):
>
> > [!NOTE]
> > 🤖 **Claude Sonnet 5.5 responding on behalf of Cristian Sotomayor**
> 
> Fixed in 5ceab724: Escape closes the menu as before, but dismisses the hint only when it was pressed inside the switcher and `defaultPrevented` is false. An Escape meant for a dialog, select or the editor no longer dismisses it for good. Tests cover both cases.

## F12 · Wachiman · inline · `apps/kaipu-record/src/renderer/src/pages/settings/settings-pages.tsx:292` · at `1eb0638` · 2026-10-30T19:38:40Z
https://github.com/niway-dev/kaipu-record/pull/449#discussion_r4427785271

🟡🐛 **Consider · bug: A refused Remove fails silently**

`remove(id)` resolves to a `WorkspaceRemoveResult` that can be `{ ok: false, reason: "active" | "last" | "unknown" | "read-only" }` (shared/types/workspaces.ts:72-74), but the result is dropped. A race can cause a refusal: for example, the workspace became active through the switcher after the dialog opened. The dialog then closes, the row stays, and nothing explains why. Show a toast for a refusal the way `switchTo`/`add` do in workspaces-context.tsx.

> **Reply by csdev19** (2026-10-30T20:39:31Z):
>
> > [!NOTE]
> > 🤖 **Claude Sonnet 5.5 responding on behalf of Cristian Sotomayor**
> 
> Fixed in 8b8c79ae: `remove()` in the workspaces context now shows a toast for a refusal (active, last, read-only, gone), new keys in en and es. Test: `workspaces-settings.test.tsx`.

## F13 · Wachiman · inline · `packages/i18n/messages/en.json:2196` · at `1eb0638` · 2026-10-30T19:38:40Z
https://github.com/niway-dev/kaipu-record/pull/449#discussion_r4427785284

🟠🐛 **Fix · bug: Windows users see "This Mac" as the location of workspaces on the internal drive**

`workspaces.thisMac` ("This Mac" / es "Este Mac") is the location label for any workspace without a volume: `useLocationLabel` in `workspace-switcher.tsx:47` returns `workspace.volume ?? t("thisMac")` whatever the host is. The same component already picks a label per host for the folder shortcut (`isWindowsHost() ? t("showInExplorer") : t("showInFinder")` at `workspace-switcher.tsx:172`), so the app ships on Windows and the switcher bar, the menu stats and the row meta (`rowMeta`, `rowNotConnected`, `notConnectedBody` all fill `{location}` from this label) read "This Mac" on a PC. Fix: add a host-neutral or Windows key (e.g. `thisComputer` / "This PC", es "Este equipo") to both catalogs and pick it in `useLocationLabel` the way line 172 does.

> **Reply by csdev19** (2026-10-30T20:39:33Z):
>
> > [!NOTE]
> > 🤖 **Claude Sonnet 5.5 responding on behalf of Cristian Sotomayor**
> 
> Fixed in 5ceab724: the internal-drive label follows the host the way the Finder/Explorer label does. `thisPc` ("This PC" / "Este equipo") is used on Windows, `thisMac` elsewhere. Test in `workspace-switcher.test.tsx`.


# Review bodies (may hold findings not posted inline)

## Review · Wachiman · at `1eb0638` · 2026-10-30T19:38:39Z
https://github.com/niway-dev/kaipu-record/pull/449#pullrequestreview-5717776432

**Agent review** of the whole pull request, at `1eb0638`: all 74 files reviewed.

13 finding(s): 2 to fix, 11 to consider; 13 on their lines. Reply in a comment's thread to answer it.

### Summary

**Batch 1 of 6.** I found no blockers in part 1. Shared types use only type imports from packages: `STALE_WORKSPACE` is a local const, not a value import from a workspace package. Item-scoped IPC calls are stamped consistently in the preload and gated in main, and the vault-folder channels that were removed are gone from both sides of the bridge. I raised three items, all at \"consider\": 1. The preload's switching guard is cleared by every `workspaces:changed` broadcast, not only by the one that ends a switch. 2. The `kaipu-media://` workspace check covers only screenshot and thumb URLs, so a cached video URL can still play an item from another workspace. 3. A question: a stamp rebind inside a scoped Save might make a save that succeeded reject as stale, which could lead to a duplicate item. Budget limits kept me from tracing every helper in workspaces/ in depth.

**Batch 2 of 6.** I reviewed the three files in this part: gate.ts, identity.ts and index.ts under `src/main/workspaces/`. Nothing blocks the merge. I found two edge cases in index.ts, both rated "consider" with topic "bug".\n\n1. **Wrong gate rebind (index.ts:109).** The check for an adopted id compares the probed id with the gate's current stamp. If a switch lands while the probe is running, that comparison can point the gate back at the old workspace. The same timing problem exists in `listState`, during the registry write that saves the new active workspace.\n2. **120-second wait (index.ts:196).** If a window closes partway through a switch, nothing answers the prepare request. The switch then waits the full 120-second timeout before it is cancelled, and no other switch can start during that time.\n\nI found nothing to flag in gate.ts or identity.ts. Their draining, generation and id/name checks behave as their comments describe.

**Batch 3 of 6.** Part 3 (the registry, the switch transaction, the title and view helpers, and the updated main-process tests) generally holds up. The downgrade contract, the strict preferences read and the read-only fallback agree with the old writer's behaviour, and the old writer's removed tests confirm it. I found two things worth a look, both at "consider". `update()` keeps an in-memory change after a failed write, so `add` and `remove` can report failure even though the change already shows in the list. `switchWorkspace` drops pending captures before the persist step, which can still fail and abort the switch. The tests I read assert what their names say.

**Batch 4 of 6.** Part 4 of 6: I found one minor test-naming issue and nothing that blocks the merge. In `registry.test.ts`, the test "refuses the active and the last workspace" only ever checks the `active` refusal. The `last` refusal looks unreachable, because `registry.remove` checks `active` first. I also checked these and found nothing to flag: the renderer side of the switch in `prepare-switch.ts`, the `onPrepare` wiring in the router (main gives up on a window after 120 s), how `reportError` treats stale-workspace errors, the toast labels, the not-connected notice, and the gate, switch-transaction and window-title tests.

**Batch 5 of 6.** I reviewed the 14 files in part 5: the switcher, the context, the settings page, the page wiring and the tests. The switch preparation is wired up in router.tsx through `onPrepare`, and the editor's autosave flush is registered for it. I found one fix and three considers:

- **Fix:** the switcher menu says \"Saving to: Here\" while the active workspace is disconnected and captures are paused.
- **Consider:** Show in Finder stays enabled for a disconnected active workspace.
- **Consider:** a global Escape listener dismisses the one-time hint for good, even when the Escape was meant for something else.
- **Consider:** a refused Remove in Settings closes the dialog with no message.

No security or rules problems in this part.

**Batch 6 of 6.** Part 6 (tests, stylesheets and messages): I found one problem. The `workspaces.thisMac` label ("This Mac") is used as the location of every workspace that has no volume, on every operating system. So on Windows the switcher shows "This Mac", even though the same component already chooses Finder or Explorer depending on the system. The rest checks out:
- **Messages:** the keys this PR adds are used by the code, and no remaining code uses the keys it removes. `readyToRecord` moved within `record` and is still there, which matters because the web app uses it.
- **Stylesheets:** pulling the tag palette out into a global `tag-palette.css` is safe, because both `tag-chip.tsx` and `workspace-switcher.tsx` import it.
- **Tests:** the test stubs and the record-page and settings-layout assertions match the current components.

[details elided]

<sub>Claude Opus 5.5 via Claude Code 2.1.304 · 6 batches · $1.50</sub>


# Issue comments
