## apps/kaipu-record/src/main/recording/recording-ready-window.ts:206 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: A card left open shows up as a black box in the next recording on Windows before 10 2004 (confidence medium)**

The card has no timer and nothing closes it when the next capture starts. Content protection is the only thing keeping it out of later recordings and screenshots (lines 206-208). On Windows builds before 10 2004 (19041) there is no `WDA_EXCLUDEFROMCAPTURE`. On those builds, content protection paints the window black in the capture instead of leaving it out. `area-geometry.ts:81-92` says this, and the hub skips the full-display border there for that reason (`recording-hub.ts:701-703`).

The capture toast doesn't rely on content protection alone. Its comment calls content protection the "second guard behind `beforeCapture` dismissing it" (`capture-toast-window.ts:305-307`), and `index.ts:670` wires `dismissToast` into the capture hooks.

The result: a user who leaves the card up and starts another full-display recording or screenshot gets a black rectangle in the top-right of the video, with no error. Fix: close the card when a take starts and in the screenshot capture hooks, as the toast does. Or skip the floating window when `fullDisplayBorderAllowed` is false.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/status-cards/post-recording-card.tsx:47 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: Docstring says the card closes when the user leaves the page; the floating card doesn't (confidence high)**

The updated comment still says the card "stays until the user picks something, closes it or leaves the page". In the floating window (`RecordingReadyCard`), leaving the recording page doesn't close the card: only an action, ✕ or Escape does (`recording-ready-window.ts:88-90`). Consider limiting "leaves the page" to the in-app fallback.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/recording-ready/use-floating-ready-card.ts:17 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Pressing Back to the fresh recording's page floats the card again after the user dismissed it (confidence medium)**

`asked` is a ref, so it resets when the page remounts. The request key is `location.key`, which is the same history entry on Back. The page also still derives `showCard` from the entry (`library-detail-page.tsx:130-134`). So if the user picks a chip on the floating card, lands in Prepare and presses Back, the hook asks main again and the always-on-top card reappears on the desktop.

The in-app card already reappeared on remount (`cardDismissedFor` is component state). A desktop window popping back up is more intrusive, though. The comment "a revisit is a new one" also suggests that only a new arrival should ask. Consider remembering the asked keys outside the component, for example in a module-level set.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:141 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Back onto the recording page floats the desktop card again (confidence medium)**

The guard against asking twice is a ref inside `useFloatingReadyCard` (`use-floating-ready-card.ts:18`). The ref resets whenever the page remounts. The history entry keeps `state.fromRecording` and the same `location.key` (line 101, line 134), so `showCard` is true again.

Example: the user presses a chip on the floating card, and `useRecordingReadyHandOffs` pushes `/prepare/...`. When they press Back, the page remounts, waits for the probe, and calls `showRecordingReady` again. An always-on-top window pops back up on the desktop. The same happens after ✕ on the floating card followed by any round trip away and Back.

The old in-app card also came back on remount, because `cardDismissedFor` is component state. But that card stayed inside the page. The floating one now reappears over whatever app the user is in. It also contradicts the doc's "the card never shows twice" (`floating-ready-window.md:51`).

One fix is to remember the asked keys outside the component, for example in a module-level `Set<string>` of `location.key`s. Another is to `navigate(..., { replace: true, state: {} })` to clear `fromRecording` once the ask is made.

<!-- wachi:finding -->

## apps/documentation/src/content/docs/backlog/floating-ready-window.md:51 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: "The card never shows twice" does not hold across Back navigation (confidence medium)**

The ask is de-duplicated only per mounted page instance (`use-floating-ready-card.ts:18-24`). Remounting the page under the same history entry asks main again, so the floating card shows a second time. Either fix the behavior (see the finding on `library-detail-page.tsx:141`) or narrow the claim to "never both in-app and floating at once".

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:124 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Floating card outlives the page, including a delete of the recording (confidence medium)**

The in-app card ended when the page unmounted. The floating window now ends only on its own action, ✕, Escape, or the next take (`recording-ready-window.ts:149-172`). Nothing on the page closes it.

If the user deletes the recording from this page (`doDelete`, line 212), the card stays on the desktop. Its chips, Edit first and Open hand off to an asset that no longer exists: `/prepare/<id>`, `/editor/video/<id>` and `/library/<id>`, which shows "File not found".

Consider closing the floating card when the recording it names is removed. That needs a small close call through the bridge, or main closing it on a library change for that asset.

<!-- wachi:finding -->

