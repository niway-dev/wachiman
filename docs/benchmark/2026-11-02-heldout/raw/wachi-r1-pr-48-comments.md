## packages/application/src/cloud/cancel-upload.ts:36 by github-actions[bot]

👮 **Wachiman** · 🟠🔐 **Fix · security: Window check is check-then-act: a concurrent intent resume can extend the ticket between the check and `release` (confidence high)**

`cancelUpload` reads `ticketExpiresAt` with `findRevision` and checks the window here, then calls `assets.release` (line 39). `release` only guards `status = 'reserved'` (`packages/infra-db/src/repositories/cloud-asset.repository.ts:350`), and so does `extendTicket` (`cloud-asset.repository.ts:268-273`). A client whose reservation is past the window but has not been swept yet (the cron is not wired, per the spec's open question 2) can send cancel and a resume of the same `intentKey` (`create-upload-intent.ts:152-162`) together. If the resume's `extendTicket` lands after cancel's `findRevision` and before its `release`, the reservation is released, the object is deleted, and the client holds a freshly signed 5-minute ticket that no revision counts. That is the F-1 hole this PR is closing, now opened by a race the client controls. `sweepExpiredReservations` already has the same race (it lists, then calls `release` without re-checking expiry), so the fix belongs in the repository: give `release` a cutoff (`... and ticket_expires_at < ${cutoff}`) and pass `now - grace` from both cancel and the sweep, so the check and the claim happen in one statement.

<!-- wachi:finding -->

## packages/application/src/cloud/retry-pending-deletes.ts:21 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Skipped in-window rows still use up the `limit` batch (confidence medium)**

`listDeleting(limit)` (`cloud-asset.repository.ts:534-541`) returns the oldest `deleting` rows by `updated_at` and knows nothing about the window. The skip happens here, after the batch is fetched. If `limit` or more deferred deletes are still inside their window, a run finishes nothing, even when older-window rows behind them could be settled. The delay is bounded by the window (about 3 h 05 min), but one account can cause it for every account by confirming and then deleting many assets. Filtering in the query (`ticket_expires_at < now - grace`) would make every row in the batch actionable, the way `listReservedExpiredBefore` already does for the sweep.

<!-- wachi:finding -->

## packages/application/src/recordings/recordings.test.ts:63 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: Comment still refers to the removed `failNextUpload` flag (confidence high)**

This PR removed `failNextUpload` from the fake storage, but the comment explaining why `Object.assign` is used still names `storage.failNextUpload` as the reason. Reword it to a field that still exists (for example `existingKeys`), or drop the explanation.

<!-- wachi:finding -->

## apps/documentation/src/content/docs/specs/2026-10-12-api-upload-abuse.md:157 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: The spec contradicts itself on whether the sweep and the predicate share a boundary (confidence high)**

Lines 157-158 say the predicate uses "the same boundary the sweep uses ... and vice versa". Lines 392-395 of the same spec correctly say they disagree at the exact instant: the sweep compares strictly (`ticketExpiresAt < now - grace`) and the predicate uses `<=`. Make line 157 match the later, correct statement.

<!-- wachi:finding -->

## apps/documentation/src/content/docs/specs/2026-10-12-api-upload-abuse.md:46 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: "Up to 3 h 05 min" ignores that resuming an intent extends the ticket (confidence medium)**

A deferred cancel leaves the revision `reserved`. Resuming the same `intentKey` then calls `extendTicket` (`create-upload-intent.ts:152-153`), which pushes `ticketExpiresAt` forward again, and line 164 of this spec allows that. So the pending-slot lockout described in open question 1, and the matching statement at lines 203-204, is not capped at 3 h 05 min after the cancel: it is 3 h 05 min after the last resume.

<!-- wachi:finding -->

