## apps/kaipu-record/src/main/index.ts:899 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: A press on the floating card during the next take shows the main window mid-recording (confidence high)**

The floating card has no timer and is not closed when a take starts. Its content protection exists so that "a card still up never lands in the next recording" (`recording-ready-window.ts:206-208`), so the card is meant to stay up through a following take. If the user clicks a chip, Edit first or Open during that take, `openInMain` calls `showMainWindow()` with no check.

Every other path that reveals the main window refuses while a take is active. The deep-link focus does `if (!hub?.isActive()) showMainWindow()` (`main/index.ts:185`). `triggerStartRecording` says "Don't un-hide the (deliberately hidden) main window into an active recording — it would get burned into the video" (`main/index.ts:475-477`). The hub hides the main window at start on purpose (`recording-hub.ts:689`).

With this change, the main window shows up in the video, and its renderer is navigated to Prepare or the editor in the middle of the take. That renderer is the one running the recorder (`main/index.ts:460-462`).

Fix: guard `openInMain` with `hub?.isActive() || hub?.isPending()` (ignore the press, or show the already-recording notice), or close the ready card when a take starts.

<!-- wachi:finding -->

## apps/kaipu-record/src/main/recording/recording-ready-window.ts:215 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: A card window whose renderer never loads or crashes leaves the user with no card at all (confidence high)**

`show()` returns true as soon as the window object exists (`:143-146`). The page then never shows its in-app fallback (`use-floating-ready-card.ts:26-28`). `load()` discards the `loadURL`/`loadFile` promise (`:261-267`), and nothing listens for `did-fail-load` or `render-process-gone`.

If the card's renderer fails to load, `recording-ready:card-ready` never arrives, `present()` never shows the window, and the user gets no "Your video is ready" for that take, with no visible error. The PR body acknowledges this. A cheap mitigation: log the load rejection, and destroy the window on `render-process-gone` so the next `show()` recreates it.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/status-cards/post-recording-card.tsx:48 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: Docstring says the card goes away when the user leaves the page; the floating one does not (confidence high)**

"stays until the user picks something, closes it or leaves the page" still describes the in-app card only. The floating window outlives the recording page: nothing in `useFloatingReadyCard` or `RecordingReadyWindow` closes it on unmount. It stays until an action, ✕/Escape, or the next take's card replaces it. The same applies after the recording is deleted from that page: the card keeps offering chips for an asset that no longer exists. Either update the comment, or have the page close the floating card when it unmounts or deletes the asset.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:141 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Back onto the recording page pops the floating card up on the desktop again (confidence medium)**

`useFloatingReadyCard` remembers what it already asked for in a ref (`use-floating-ready-card.ts:18`), and that ref is lost when the page unmounts. The request is keyed by `location.key` and gated on `location.state.fromRecording` (lines 101, 130-134). Both survive a router Back, because the remounted page sits on the same history entry. So this sequence reopens the window: a chip on the floating card sends the main window to `/prepare/...` (a push, `use-recording-ready-hand-offs.ts:31`), or the user closes the card with ✕ and later leaves the page. When they press Back, the page asks `showRecordingReady` again and the always-on-top window reappears over whatever app is in front.

The old in-app card had the same remount reset (`cardDismissedFor` is plain state). But that card only came back inside the app's own page. Now it is a desktop window on every Space, and it reappears for a card the user already acted on. That goes against the hook's and the doc's "once per arrival" claim.

Possible fix: remember the history keys already asked for in module scope or in `sessionStorage`, or have the hand-off and dismiss paths clear `fromRecording` with `navigate(..., { replace: true, state: {} })`.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:140 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: The card now waits on the probe with no timeout, and a probe that never settles hides it in both forms (confidence low)**

Before this change the in-app card showed as soon as `showCard` was true, and its numbers filled in once the probe finished. Now both the floating ask and the in-app fallback are gated on `probeState.status` being "ready" or "error" (lines 140-142, 155).

`probeSource` turns a thrown error into `null`, which becomes "error" (`probe-source.ts:42-43`). A read that never resolves leaves `useSourceProbe` at "loading" forever (`use-prepare-copy.ts:51-59`). In that case no card shows anywhere, and nothing tells the user.

A short deadline would keep "the card is never lost": ask with the recording's own numbers if the probe has not settled within about a second or two.

<!-- wachi:finding -->

