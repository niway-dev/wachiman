# Judge: kaipu-record PR #276 (head f91b56de)

Ground truth: cancelUpload (cancel-upload.ts:30-39) and sweepExpiredReservations (sweep-expired-reservations.ts:~28) check the window in app code, then call release() separately. Fixed in 8ded5c29 by giving release() `ticketExpiredBy` and re-checking ticket_expires_at in the same UPDATE, plus moving the listDeleting filter into SQL.

## 1-2. Per-finding

**F01** Valid. Spec line 44-46 says "up to 3 h 05 min"; resume calls extendTicket, so the lockout restarts from the last resume. Severity Low (doc accuracy). No later fix found. Match: none.

**F02** Valid. retry-pending-deletes.ts:21 `continue`s after listDeleting(limit) (repo:534-541, ordered by updatedAt, no window filter), so in-window rows can fill the page. Severity Low-Medium (bounded liveness delay). Fixed in 8ded5c29 (listDeleting filters in SQL). Match: none.

**F03** Valid. Same defect as F02 at retry-pending-deletes.ts:21. Low-Medium. Fixed in 8ded5c29. Match: none. (Cites a GitHub URL as source, harmless.)

**F04** Valid. Spec :157 "and vice versa" vs :392-395 strict `<` vs `<=`; ticket-window.ts and the sweep confirm. Severity Info. Not fixed in the commits I checked. Match: none.

**F05** Valid. recordings.test.ts:63 comment still names `storage.failNextUpload`; it appears only in that comment at head. Severity Info. Match: none.

**F06** Valid, same as F04 (spec :157). Info. Match: none.

**F07** Valid. The window is TTL + 3 h grace (`ticketExpiresAt + grace <= now`), so the spec's "rare in practice" claim at :169-171 is wrong for the common upload-then-delete case. It mostly documents a real quota-hold trade-off. Severity Low-Medium (doc, but changes the accepted trade-offs). No later fix found. Match: none.

**F08** Valid. cancel-upload.ts:30-39 reads the revision, checks ticketWindowClosed, then calls release; release only guards status='reserved', and extendTicket only guards status, so a resume between them leaves a fresh PUT ticket on a released key. It also names the sweep (list then release without a re-check, sweep:~28) and gives the fix actually shipped (cutoff in release's WHERE). Severity High/Medium (client-controlled race, unaccounted bytes). Fixed in 8ded5c29. Match: **match**, covering both cancel-upload.ts and the sweep.

**F09** Valid. Same as F02/F03/F13 (starvation). It adds that one account can starve others' failed deletes. Low-Medium. Fixed in 8ded5c29. Match: none.

**F10** Valid, same as F04/F06. Info. Match: none.

**F11** Unconfirmed (plausible). The cursor refine in cloud-asset.ts:~283-292 accepts any ms where `new Date(ms)` is valid (up to 8.64e15). So 253402300800000 (year 10000) passes. I did not verify the Drizzle/Postgres serialization, but the failure (500 instead of 400) is credible. Severity Low. 8ded5c29 reworked the cursor codec but I saw no year-range cap. Match: none.

**F12** Valid. Same defect as F08 at cancel-upload.ts:36: stale snapshot, release checks only status. It proposes an atomic cutoff in the release predicate "for the expiry sweep too", and keeping unconditional release for the new-intent rollback (a careful point). The scenario is slightly vaguer than F08 (no explicit interleaving of extendTicket). Severity Medium-High. Fixed in 8ded5c29. Match: **match**, covering both cancel-upload.ts and the sweep.

**F13** Valid, same as F02/F03/F09. Low-Medium. Fixed in 8ded5c29. Match: none.

## 3. Duplicates
- G1 (catalogued race): F08, F12
- G2 (retry starvation): F02, F03, F09, F13
- G3 (spec "vice versa"): F04, F06, F10
- Unique: F01, F05, F07, F11

## 4. Message quality (0-5)
- F01: 4. Effect/Location/Cause clear, fix implied. "it is 3 h 05 min after the last resume."
- F02: 5. "Skipped in-window rows stay at the head of listDeleting and can starve real retries"; cites the filter model.
- F03: 3. Imperative title, short; fix present but the effect is vaguer. "Select eligible revisions in the repository query, or page past skipped revisions."
- F04: 5. Cites both line ranges, code, and fix. "Drop 'and vice versa' at line 157."
- F05: 4. Short but complete. "Reword it to a field that still exists."
- F06: 4. "Make line 157 match the later, correct statement."
- F07: 5. Strong reasoning with constants, impact, and requested spec changes. "a user who deletes a fresh upload to free space does not get the quota back for up to 3 h."
- F08: 5. Full interleaving, both sites, concrete fix. "the client holds a freshly signed 5-minute ticket that no revision counts."
- F09: 5. Adds abuse vector and fix. "One account can cause this by uploading and deleting many tiny assets."
- F10: 4. "The first direction holds, but 'vice versa' does not."
- F11: 3. Concrete input, but the claim is unverified and there is little causal explanation. "Limit the timestamp to a range the database driver can serialize."
- F12: 4. Good CWE and fix (preserve rollback release, add test); the race is described briefly. "Include the current ticket_expires_at in its update predicate."
- F13: 4. "one account can cause it for every account by confirming and then deleting many assets."

## 5. Table
| F-id | verdict | severity | catalogued match | dup group | quality |
|---|---|---|---|---|---|
| F01 | Valid | Low | none | - | 4 |
| F02 | Valid | Low-Med | none | G2 | 5 |
| F03 | Valid | Low-Med | none | G2 | 3 |
| F04 | Valid | Info | none | G3 | 5 |
| F05 | Valid | Info | none | - | 4 |
| F06 | Valid | Info | none | G3 | 4 |
| F07 | Valid | Low-Med | none | - | 5 |
| F08 | Valid | High | match (cancel + sweep) | G1 | 5 |
| F09 | Valid | Low-Med | none | G2 | 5 |
| F10 | Valid | Info | none | G3 | 4 |
| F11 | Unconfirmed | Low | none | - | 3 |
| F12 | Valid | High | match (cancel + sweep) | G1 | 4 |
| F13 | Valid | Low-Med | none | G2 | 4 |
