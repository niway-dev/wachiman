## apps/kaipu-record/src/main/recording/recording-ready-window.ts:146 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: `show()` answers true before the card has painted, so a renderer that never loads loses the card silently (confidence high)**

`show()` returns true as soon as the BrowserWindow exists (l.137–146). `present()` only paints after `recording-ready:card-ready` (l.108–112, 221). If `loadFile`/`loadURL` rejects (its promise is discarded with `void`, l.261/265), or the card's renderer crashes before it sends `ready()`, the page has already been told `true`. `useFloatingReadyCard` therefore never sets `inApp` (use-floating-ready-card.ts:26-28), and the user gets no card anywhere, with no visible error. The same happens when an existing window's renderer has gone away: `rendererReady` stays true, and `showInactive` shows an empty transparent window. The PR body acknowledges this. A cheap way to close the gap: resolve the invoke only once the card reports ready, or after a short timeout that resolves false, so the in-app fallback covers load failures too.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/recording-ready/use-floating-ready-card.ts:18 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Back to the recording's page floats the card again after the user already acted on it (confidence medium)**

The `asked` ref only lives as long as the component instance. Say the user picks a chip on the floating card: main hides it and navigates to Prepare. If they then press Back, `LibraryDetailPage` remounts under the same history entry, with the same `location.key` and, presumably, the same `fromRecording` state (library-detail-page.tsx:130-134). The ref is null again, so the hook calls `showRecordingReady` a second time and the card pops up on the desktop over whatever the user is doing. The in-app card also came back on Back (`cardDismissedFor` is component state), but that happened inside the page. Now it is an always-on-top window outside the app, after the user already answered the question. The doc on l.4 ("a revisit is a new one") implies the key alone dedupes. To make that true, keep the asked keys in module scope (or in `history.state`) instead of a ref that dies on unmount.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/status-cards/post-recording-card.tsx:48 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: Doc says the card goes away when the user leaves the page; the floating one does not (confidence high)**

"stays until the user picks something, closes it or leaves the page" is still true of the in-app fallback. It is not true of the floating window: `RecordingReadyWindow` only hides on an action, ✕ or Escape (recording-ready-window.ts:150-172), so it outlives navigation, and it also outlives deletion of the recording, after which its chips and Open lead to an asset that is gone. Either say so here, or close the floating card when the asset is deleted or a new take starts.

<!-- wachi:finding -->

## apps/kaipu-record/src/main/recording/recording-ready-window.ts:208 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Card stays up over the next take; content protection does not hide it everywhere (confidence medium)**

The card has no timer and is not closed when a recording starts. It stays on top during the next take and relies on `setContentProtection(true)` to stay out of the video. The hub itself does not trust content protection on every platform: it gates the display border on `fullDisplayBorderAllowed(process.platform, release())` (recording-hub.ts:703) because old Windows cannot exclude windows from capture. On those systems a card left up lands in the next recording. Closing the card on `recordingStart`, or applying the same gate, would avoid it.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:141 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Router Back to the recording page floats the card again, even after it was used or dismissed (confidence medium)**

The "once per arrival" guard is `asked` in `use-floating-ready-card.ts:18`, a ref keyed by `location.key`. A ref does not survive an unmount. Here is the sequence: the floating card's chip sends the main window to `/prepare/...`. The user then goes router Back (or leaves for Settings and comes back the same way). React Router reuses the same history entry, so `location.key` is the same and `state.fromRecording` is still true. `showCard` is true again, the new mount's ref is null, and `showRecordingReady` runs a second time. The card the user already handled opens again on the desktop.

The old in-app card had the same gap, because `cardDismissedFor` was component state. The difference now is that this is an always-on-top window outside the app, and the hook's doc ("`key` is its history entry, so a revisit is a new one") suggests that keying by `location.key` deduplicates arrivals. One fix: keep the asked/dismissed keys somewhere that outlives the page, such as a module-level Set or the history entry's state via `navigate(..., { replace: true, state: { ...state, fromRecording: false } })` once the request is sent. Then main's replace-on-next-show never gets a stale request.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.test.tsx:741 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: No test covers a remount under the same history entry (confidence medium)**

The new tests check one ask per mount (line 756) and the fallback path. None of them navigates away and goes back with `router.navigate(-1)`, so nothing checks the "once per arrival" contract this hook claims. A test that picks a chip with `showRecordingReady` resolving true, then navigates back and asserts `toHaveBeenCalledTimes(1)`, would cover it. Today that test would fail (see the finding on `library-detail-page.tsx:141`).

<!-- wachi:finding -->

