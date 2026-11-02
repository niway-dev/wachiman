# Blind findings for kaipu-record #276

Every finding below was posted by one of several automated reviewers on the same diff. Reviewer names and labels are removed. Judge each on its merits.


## F01 — `apps/documentation/src/content/docs/specs/2026-10-12-api-upload-abuse.md:46`

**"Up to 3 h 05 min" ignores that resuming an intent extends the ticket **

A deferred cancel leaves the revision `reserved`. Resuming the same `intentKey` then calls `extendTicket` (`create-upload-intent.ts:152-153`), which pushes `ticketExpiresAt` forward again, and line 164 of this spec allows that. So the pending-slot lockout described in open question 1, and the matching statement at lines 203-204, is not capped at 3 h 05 min after the cancel: it is 3 h 05 min after the last resume.


## F02 — `packages/application/src/cloud/retry-pending-deletes.ts:21`

⚡ **Skipped in-window rows stay at the head of `listDeleting` and can starve real retries **

`listDeleting(limit)` returns the oldest `deleting` rows by `updated_at` (`packages/infra-db/src/repositories/cloud-asset.repository.ts:534-541`). This loop skips in-window rows without changing them. If `limit` or more deferred deletes have an older `updated_at` than a row whose storage delete actually failed, every run lists only the deferred rows. The failed row then waits until the deferred windows close, up to 3 h 05 min. The delay has a ceiling, so this is a liveness cost, not a leak. If you want to avoid it, filter the listing on `ticket_expires_at < now - grace`, the way `listReservedExpiredBefore` does for the sweep.


## F03 — `packages/application/src/cloud/retry-pending-deletes.ts:21`

**Filter ineligible revisions before applying the retry limit.**

If the first `limit` deleting revisions still have open ticket windows, this `continue` processes none of them. `listDeleting` orders by `updatedAt` and limits the query before this check, so later revisions with closed windows remain outside every retry page. Their objects and used quota remain until earlier windows close. Select eligible revisions in the repository query, or page past skipped revisions. ([raw.githubusercontent.com](https://raw.githubusercontent.com/niway-dev/kaipu-record/f91b56dec34096ce1b2d29d3dcf3594b7a753f7e/packages/infra-db/src/repositories/cloud-asset.repository.ts))


## F04 — `apps/documentation/src/content/docs/specs/2026-10-12-api-upload-abuse.md:157`

**The spec says the sweep boundary and the predicate agree "and vice versa", then says they don't **

Line 157 says the sweep's boundary (`before = now - grace` with `<`) matches `ticketWindowClosed` "and vice versa". Lines 392-394 say the opposite: at exactly `ticketExpiresAt + grace` the predicate is `<=` (closed) while the sweep's strict `<` doesn't list the revision yet. The code confirms the later statement: `ticket-window.ts:10` uses `<=` and `sweep-expired-reservations.ts:22` together with `cloud-asset.repository.ts:526` uses `lt`. Drop "and vice versa" at line 157, or say there that the two differ by one millisecond and that the difference is safe.


## F05 — `packages/application/src/recordings/recordings.test.ts:63`

**Comment still refers to the removed `failNextUpload` flag **

This PR removed `failNextUpload` from the fake storage, but the comment explaining why `Object.assign` is used still names `storage.failNextUpload` as the reason. Reword it to a field that still exists (for example `existingKeys`), or drop the explanation.


## F06 — `apps/documentation/src/content/docs/specs/2026-10-12-api-upload-abuse.md:157`

**The spec contradicts itself on whether the sweep and the predicate share a boundary **

Lines 157-158 say the predicate uses "the same boundary the sweep uses ... and vice versa". Lines 392-395 of the same spec correctly say they disagree at the exact instant: the sweep compares strictly (`ticketExpiresAt < now - grace`) and the predicate uses `<=`. Make line 157 match the later, correct statement.


## F07 — `apps/documentation/src/content/docs/specs/2026-10-12-api-upload-abuse.md:171`

**Deferred deletes are common, not rare: the window is the ticket TTL plus 3 h of grace **

The spec says a ready revision "only has an open window if it was confirmed within 5 minutes of its last ticket, so this branch is rare in practice". The predicate is `ticketExpiresAt + RESERVATION_GRACE_SECONDS <= now` (`packages/application/src/cloud/ticket-window.ts:10`), where the TTL is 5 min and the grace is 3 h (`packages/domain/src/constants/cloud-limits.ts:25,30`). It depends on when the delete happens, not on when the confirm happened. Any asset deleted within about 3 h 05 min of its last ticket is deferred, and that includes the usual "upload, then remove it" case. While a delete is deferred the revision stays `deleting` and keeps counting as used (`cloud-asset.repository.ts:367`). So a user who deletes a fresh upload to free space does not get the quota back for up to 3 h. Until NIW2-328 schedules `retryPendingDeletes`, they never get it back. The "Strongest argument against" section (lines 202-206) and open question 1 name this cost only for cancels. Please correct the rarity claim and add the delete-side quota hold to the accepted trade-offs.


## F08 — `packages/application/src/cloud/cancel-upload.ts:36`

**Window check is check-then-act: a concurrent intent resume can extend the ticket between the check and `release` **

`cancelUpload` reads `ticketExpiresAt` with `findRevision` and checks the window here, then calls `assets.release` (line 39). `release` only guards `status = 'reserved'` (`packages/infra-db/src/repositories/cloud-asset.repository.ts:350`), and so does `extendTicket` (`cloud-asset.repository.ts:268-273`). A client whose reservation is past the window but has not been swept yet (the cron is not wired, per the spec's open question 2) can send cancel and a resume of the same `intentKey` (`create-upload-intent.ts:152-162`) together. If the resume's `extendTicket` lands after cancel's `findRevision` and before its `release`, the reservation is released, the object is deleted, and the client holds a freshly signed 5-minute ticket that no revision counts. That is the F-1 hole this PR is closing, now opened by a race the client controls. `sweepExpiredReservations` already has the same race (it lists, then calls `release` without re-checking expiry), so the fix belongs in the repository: give `release` a cutoff (`... and ticket_expires_at < ${cutoff}`) and pass `now - grace` from both cancel and the sweep, so the check and the claim happen in one statement.


## F09 — `packages/application/src/cloud/retry-pending-deletes.ts:21`

⚡ **In-window rows are filtered after `limit`, so they can fill every batch **

`listDeleting(limit)` returns the oldest `deleting` rows by `updated_at` (`cloud-asset.repository.ts:534-541`). The new check skips in-window rows only after that `limit` has been applied. Skipped rows keep their `updated_at`, so the next run lists them again. If `limit` or more in-window rows sit at the head of that order, each run skips all of them and does no work. Revisions whose storage delete really failed, possibly from other accounts, then wait up to about 3 h 05 min and keep counting as used. One account can cause this by uploading and deleting many tiny assets. Filtering in the query (a `ticket_expires_at < now - grace` condition on `listDeleting`, matching how `listReservedExpiredBefore` filters) would keep each batch to rows that can actually be finished.


## F10 — `apps/documentation/src/content/docs/specs/2026-10-12-api-upload-abuse.md:157`

**"and vice versa" contradicts the spec's own boundary note **

Line 157 says the predicate and the sweep share the same boundary, "so a revision the sweep would release is one the predicate calls closed, and vice versa". The sweep lists `ticketExpiresAt < now - grace`, a strict comparison (`sweep-expired-reservations.ts:22-23`, `cloud-asset.repository.ts:526`). The predicate uses `<=` (`ticket-window.ts:10`). At the exact instant, the predicate already says closed while the sweep does not list the revision yet. Lines 392-395 of this same spec say exactly that. The first direction holds, but "vice versa" does not, so drop it or point to the boundary note.


## F11 — `packages/domain/src/schemas/cloud-asset.ts:288`

**Reject timestamps that PostgreSQL cannot parse.**

A cursor encoding `253402300800000:0b6f8d3e-5c1a-4d7e-9a2b-3c4d5e6f7a8b` passes this check. Drizzle serializes that date as `+010000-01-01T00:00:00.000Z`, which PostgreSQL rejects. The list request therefore fails instead of returning 400. Limit the timestamp to a range the database driver can serialize. ([raw.githubusercontent.com](https://raw.githubusercontent.com/drizzle-team/drizzle-orm/0.45.1/drizzle-orm/src/pg-core/columns/timestamp.ts))


## F12 — `packages/application/src/cloud/cancel-upload.ts:36`

· **Heavy lift**

****Exploitability:** Difficult  
**CWE:** [CWE-367](https://cwe.mitre.org/data/definitions/367.html) — Time-of-check Time-of-use (TOCTOU) Race Condition

**Make the ticket-window check atomic with reservation release.**

`cancelUpload` checks the expiry from a stale revision snapshot. A concurrent resume can extend the current `ticketExpiresAt` before `release` runs. Because `release` checks only `status = 'reserved'`, it can clear the quota and delete the object while the new PUT ticket remains valid. An authenticated user can race resume and cancel to write unaccounted bytes.

Pass the cancellation time or equivalent cutoff to an atomic release operation. Include the current `ticket_expires_at` in its update predicate. Apply the same guard to the expiry sweep, while preserving the unconditional release used to roll back a newly created intent. Add a regression test for this interleaving.


## F13 — `packages/application/src/cloud/retry-pending-deletes.ts:21`

**Skipped in-window rows still use up the `limit` batch **

`listDeleting(limit)` (`cloud-asset.repository.ts:534-541`) returns the oldest `deleting` rows by `updated_at` and knows nothing about the window. The skip happens here, after the batch is fetched. If `limit` or more deferred deletes are still inside their window, a run finishes nothing, even when older-window rows behind them could be settled. The delay is bounded by the window (about 3 h 05 min), but one account can cause it for every account by confirming and then deleting many assets. Filtering in the query (`ticket_expires_at < now - grace`) would make every row in the batch actionable, the way `listReservedExpiredBefore` already does for the sweep.
