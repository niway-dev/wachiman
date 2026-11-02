## packages/application/src/cloud/retry-pending-deletes.ts:21 by github-actions[bot]

👮 **Wachiman** · 🟡⚡ **Consider · perf: Skipped in-window rows stay at the head of `listDeleting` and can starve real retries (confidence medium)**

`listDeleting(limit)` returns the oldest `deleting` rows by `updated_at` (`packages/infra-db/src/repositories/cloud-asset.repository.ts:534-541`). This loop skips in-window rows without changing them. If `limit` or more deferred deletes have an older `updated_at` than a row whose storage delete actually failed, every run lists only the deferred rows. The failed row then waits until the deferred windows close, up to 3 h 05 min. The delay has a ceiling, so this is a liveness cost, not a leak. If you want to avoid it, filter the listing on `ticket_expires_at < now - grace`, the way `listReservedExpiredBefore` does for the sweep.

<!-- wachi:finding -->

## apps/documentation/src/content/docs/specs/2026-10-12-api-upload-abuse.md:157 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: The spec says the sweep boundary and the predicate agree "and vice versa", then says they don't (confidence high)**

Line 157 says the sweep's boundary (`before = now - grace` with `<`) matches `ticketWindowClosed` "and vice versa". Lines 392-394 say the opposite: at exactly `ticketExpiresAt + grace` the predicate is `<=` (closed) while the sweep's strict `<` doesn't list the revision yet. The code confirms the later statement: `ticket-window.ts:10` uses `<=` and `sweep-expired-reservations.ts:22` together with `cloud-asset.repository.ts:526` uses `lt`. Drop "and vice versa" at line 157, or say there that the two differ by one millisecond and that the difference is safe.

<!-- wachi:finding -->

