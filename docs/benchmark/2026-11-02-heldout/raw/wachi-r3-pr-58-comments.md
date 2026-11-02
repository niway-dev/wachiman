## apps/documentation/src/content/docs/specs/2026-10-12-api-upload-abuse.md:171 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: Deferred deletes are common, not rare: the window is the ticket TTL plus 3 h of grace (confidence high)**

The spec says a ready revision "only has an open window if it was confirmed within 5 minutes of its last ticket, so this branch is rare in practice". The predicate is `ticketExpiresAt + RESERVATION_GRACE_SECONDS <= now` (`packages/application/src/cloud/ticket-window.ts:10`), where the TTL is 5 min and the grace is 3 h (`packages/domain/src/constants/cloud-limits.ts:25,30`). It depends on when the delete happens, not on when the confirm happened. Any asset deleted within about 3 h 05 min of its last ticket is deferred, and that includes the usual "upload, then remove it" case. While a delete is deferred the revision stays `deleting` and keeps counting as used (`cloud-asset.repository.ts:367`). So a user who deletes a fresh upload to free space does not get the quota back for up to 3 h. Until NIW2-328 schedules `retryPendingDeletes`, they never get it back. The "Strongest argument against" section (lines 202-206) and open question 1 name this cost only for cancels. Please correct the rarity claim and add the delete-side quota hold to the accepted trade-offs.

<!-- wachi:finding -->

## apps/documentation/src/content/docs/specs/2026-10-12-api-upload-abuse.md:157 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: "and vice versa" contradicts the spec's own boundary note (confidence high)**

Line 157 says the predicate and the sweep share the same boundary, "so a revision the sweep would release is one the predicate calls closed, and vice versa". The sweep lists `ticketExpiresAt < now - grace`, a strict comparison (`sweep-expired-reservations.ts:22-23`, `cloud-asset.repository.ts:526`). The predicate uses `<=` (`ticket-window.ts:10`). At the exact instant, the predicate already says closed while the sweep does not list the revision yet. Lines 392-395 of this same spec say exactly that. The first direction holds, but "vice versa" does not, so drop it or point to the boundary note.

<!-- wachi:finding -->

## packages/application/src/cloud/retry-pending-deletes.ts:21 by github-actions[bot]

👮 **Wachiman** · 🟡⚡ **Consider · perf: In-window rows are filtered after `limit`, so they can fill every batch (confidence medium)**

`listDeleting(limit)` returns the oldest `deleting` rows by `updated_at` (`cloud-asset.repository.ts:534-541`). The new check skips in-window rows only after that `limit` has been applied. Skipped rows keep their `updated_at`, so the next run lists them again. If `limit` or more in-window rows sit at the head of that order, each run skips all of them and does no work. Revisions whose storage delete really failed, possibly from other accounts, then wait up to about 3 h 05 min and keep counting as used. One account can cause this by uploading and deleting many tiny assets. Filtering in the query (a `ticket_expires_at < now - grace` condition on `listDeleting`, matching how `listReservedExpiredBefore` filters) would keep each batch to rows that can actually be finished.

<!-- wachi:finding -->

