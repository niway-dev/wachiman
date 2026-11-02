## apps/kaipu-record/src/main/index.ts:899 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: A floating card left up during a new take un-hides the main window into the recording (confidence high)**

The card has no timer and nothing closes it when a recording starts. A `recordingReady` search in `main/` finds only the create, `openInMain` and shutdown call sites, so neither `recordingStart` nor the countdown touches it. Unlike the capture toast, it is not dismissed either: the toast has a 6 s timer and `dismissToast` runs in `beforeCapture` (`capture-window-hooks.ts:56`). The PR's own test step 7 ("Record twice without closing the card") leaves the first card up during the second take.

A press on that leftover card (chip, Edit first, Open) then runs `openInMain`, which calls `showMainWindow()` (`index.ts:449-457`: restore, show, focus) and navigates the renderer. The main window is hidden on purpose while a take runs (`recording-hub.ts:689`, the `recordingStart` handler). `triggerStartRecording` explicitly refuses to un-hide it into an active recording because it "would get burned into the video" (`index.ts:475-481`). The card is content-protected, but the main window is not, so the user's app window and a navigation away from the recorder land in the video. The old in-app card lived in the hidden main window and could not be pressed mid-take, so this is a regression.

If the next take is not eligible for a card (Settings toggle off, or a non-local video), the previous take's card also stays up indefinitely, showing the wrong recording.

Fix: call `recordingReady?.close()` when a take starts or its countdown begins. Also make `openInMain` do nothing while `hub?.isActive() || hub?.isPending()`, like the other entry points.

<!-- wachi:finding -->

## apps/kaipu-record/src/main/recording/recording-hub.test.ts:290 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: `lastTakeDisplayId` is only tested for the async source-lookup branch (confidence medium)**

The new test covers only a screen source with no area and no countdown region (the `displayIdForSource` branch at `recording-hub.ts:711-713`). It does not cover the area display (`areaDisplay?.id`), the countdown region (`region?.display.id`), a window source (expected `null`), or a take that starts after an earlier one (the value must follow the newest take). These are the branches that decide which display the card opens on. The code at `recording-hub.ts:666` and `:711` has several fallbacks that nothing pins.

<!-- wachi:finding -->

## apps/kaipu-record/src/main/recording/recording-ready-window.ts:104 by github-actions[bot]

👮 **Wachiman** · 🟡🔐 **Consider · security: `recording-ready:show` does not check which window sent it (confidence low)**

The other three channels check `isOwnSender`, but the `recordingReadyShow` handler accepts a call from any renderer. Every app window loads the same preload, so every window can call `showRecordingReady`, not only the main window. A comparable handler in `recording-hub.ts` (`micLevelsReport`, line 786) rejects senders other than the main window. The payload is validated, and `assetId` only ever comes back as a navigation target in the main renderer. So the impact is small: another window could pop the card for an arbitrary asset id. Consider passing a `isMainSender(sender)` dependency and checking it here, to match the "main window → main" contract documented in `ipc.ts`.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:141 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Router Back to the recording page floats the card again (confidence medium)**

The `asked` ref in `useFloatingReadyCard` (use-floating-ready-card.ts:18) lives in the component instance, so it resets whenever `LibraryDetailPage` remounts. Back from Prepare or the editor returns to the same history entry. Its `location.key` and `state.fromRecording` are unchanged, so `showCard` is true again, the probe settles again and `asked.current` is null again. Main is then asked to re-show the card (`recording-ready-window.ts:134`).

After the user has already picked a chip, the same always-on-top card with no timer reappears on the desktop. The hook's doc says "once per arrival", but a remount under the same key is not counted.

The old in-app card also came back on remount, because `cardDismissedFor` is state. That was contained in the app window. A desktop-wide panel is far more intrusive.

A module-level `Set` of asked keys would survive the remount. `location.key` is unique per history entry, so it would be a safe key.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/recording-ready/use-recording-ready-hand-offs.test.ts:4 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: Only the pure path mapping is tested, not the hook that navigates (confidence high)**

`pathForHandOff` is covered. `useRecordingReadyHandOffs` is not: it subscribes through `onRecordingReadyOpen`, navigates on a hand-off, and unsubscribes on unmount. A regression there, such as a missing unsubscribe or a wrong dependency list, would pass this suite. A short render test with a memory router and a captured listener would cover it.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.test.tsx:741 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: No test for the floating ask when the file cannot be read (confidence medium)**

The page deliberately asks main once the probe is `ready` or `error` (library-detail-page.tsx:140). On `error` the payload carries `dimensions: null` and the library's `durationSeconds`. The new tests cover only the successful probe (2560 × 1440, 78 s), so the `error` branch and its payload are untested. The test at 768 also overlaps the existing "not when Settings turned it off" and "not when opened from the Library" tests.

<!-- wachi:finding -->

## apps/documentation/src/content/docs/backlog/floating-ready-window.md:30 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: Doc says the window is closed; main only hides it (confidence medium)**

The doc says "Every action closes the window". `RecordingReadyWindow.close()` calls `window.hide()` and keeps the window for reuse (`recording-ready-window.ts:150-155`). The next recording re-targets the same window. The user-visible effect is the same, but "hides" is accurate. A later reader looking for a leak or a stale-payload bug would be misled. The renderer in a hidden window still holds the previous payload until the next one replaces it.

<!-- wachi:finding -->

