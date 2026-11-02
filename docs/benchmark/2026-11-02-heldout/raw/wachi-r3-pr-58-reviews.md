## review by github-actions[bot] at 2026-11-02T06:06:29Z

👮 **Wachiman** · review of the whole pull request, at `f91b56d`: all 19 files reviewed.

4 finding(s): 4 to consider; 3 on their lines. Reply in a comment's thread to answer it.

### Outside the diff

- 🟡🧪 **Consider · tests: The existing delete and retry tests also rely on the wall clock (confidence high)** (`packages/application/src/cloud/cloud.test.ts:831`): The spec's remaining task 1 lists only the cancel test (`:579-612`) as passing because the wall clock is past the fixture date. `deleteCloudCopy` at lines 320, 831, 849 and 860 and `retryPendingDeletes` at line 842 also omit `now`. They now default to `new Date()` and pass only because `NOW` (line 26, 2026-09-10) is more than 3 h 05 min in the past. Without that, `deleteCloudCopy removes the object at once when R2 is healthy` (line 856) would get `physicallyRemoved: false`. Give these calls an explicit post-window `now` too, and add them to the spec's task list.

### Summary

I found no blockers. The code does what the spec describes. Cancel, delete and the retry job all use one window check (`ticketWindowClosed`) and hold the quota and the object until the window closes. The legacy upload routes are gone, and a repository search outside the docs finds no remaining references to them. The new cursor schema accepts every cursor the repository produces and rejects malformed ones with a 400.

All four findings are "consider":
- **Spec, line 171:** it calls a deferred delete rare. In fact any asset deleted within about 3 h 05 min of its last ticket is deferred, so a delete that would have freed quota keeps it counted as used for that long, or indefinitely until NIW2-328 schedules the jobs.
- **Spec, line 157:** \"and vice versa\" contradicts the spec's own note at lines 392-395 that the sweep and the window check disagree at the exact boundary instant.
- **Retry job:** `retryPendingDeletes` skips in-window rows only after `listDeleting(limit)` has picked its batch. Enough in-window rows can fill every batch and hold back retries of deletes that really failed for up to about 3 h.
- **Tests:** the existing `deleteCloudCopy` and `retryPendingDeletes` tests also pass only because the wall clock is past the fixture date. The spec's task list mentions only the cancel test.

<details><summary>What the change connects to (5 closed, 0 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Closed, with the lines they rest on**
- cancelUpload defers while the ticket window is open (`packages/application/src/cloud/cancel-upload.ts:36`) — The API still returns { released: false }; the router passes no `now`, so the default `new Date()` applies. The bytes and the pending slot stay held until the sweep runs. If it fails: If the sweep never runs (no cron until NIW2-328), the reservation is held forever. The spec names this as open question 2. Evidence: `packages/application/src/cloud/cancel-upload.ts:33-40`, `packages/application/src/cloud/sweep-expired-reservations.ts:22-41`, `apps/server-hono/src/modules/cloud/cloud.router.ts:104-114`, `packages/application/src/cloud/ticket-window.ts:9-11`.
- deleteCloudCopy defers the physical delete while the window is open (`packages/application/src/cloud/delete-cloud-copy.ts:29`) — The router returns only { deleted }. The asset disappears from the list right away, but quota stays used for up to 3 h 05 min. If it fails: If retryPendingDeletes never runs, the revision stays deleting and keeps counting as used. Evidence: `packages/application/src/cloud/delete-cloud-copy.ts:27-31`, `packages/infra-db/src/repositories/cloud-asset.repository.ts:366-385`, `apps/server-hono/src/modules/cloud/cloud.router.ts:143-164`.
- retryPendingDeletes skips in-window revisions (`packages/application/src/cloud/retry-pending-deletes.ts:21`) — Background job only; nothing is shown to the user. If it fails: If in-window rows fill the batch, the run finishes nothing. They are retried on later runs. Evidence: `packages/infra-db/src/repositories/cloud-asset.repository.ts:519-542`, `packages/application/src/cloud/retry-pending-deletes.ts:16-21`.
- Asset-list cursor validated by assetCursorSchema at the contract (`apps/server-hono/src/contract/cloud.contract.ts:47`) — A malformed cursor now gets a 400 instead of a silent restart from the first page or a driver error. Evidence: `packages/infra-db/src/repositories/cloud-asset.repository.ts:96-108`, `packages/domain/src/schemas/cloud-asset.ts:18`, `packages/domain/src/schemas/cloud-asset.ts:276-294`.
- Legacy recording upload routes and use cases removed (`apps/server-hono/src/contract/recording.contract.ts:12`) — POST /recordings and POST /recordings/{id}/confirm no longer exist. The list, download and delete routes stay. Evidence: `apps/server-hono/src/modules/recording/recording.router.ts:1`, `packages/application/src/recordings/index.ts:1-3`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 1 | 19 | 998 | 4 | reviewed | 13 | $0.53 |

</details>

<sub>Claude Opus 5.5 via Claude Code 2.1.304 · effort high · $0.53</sub>

<!-- wachi:review -->

<!-- agent-review sha=f91b56dec34096ce1b2d29d3dcf3594b7a753f7e -->

<!-- wachi:attempt id=50c92025-05ac-49a8-8619-72d250b63afd -->

