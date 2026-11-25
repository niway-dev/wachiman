👮 **Wachiman** · review of the whole pull request, at `e943b35`: all 1 files reviewed.

1 finding(s): 1 to consider; 1 on their lines. Reply in a comment's thread to answer it.

### Risk map

**High.**

- `auth` · `.github/workflows/wachiman-review.yml:23` — The job's GitHub OIDC identity token is now issued for and sent to a different host.
- `config-or-ci` · `.github/workflows/wachiman-review.yml:23` — The ledger endpoint, which is also the OIDC token audience, changes, so a mismatch on the ledger side stops every review on this repository with exit 3.

**Read first:** `.github/workflows/wachiman-review.yml`.

### Summary

The change is one line: `ledger_url` now points to `https://ledger.wachiman-api.dev`. Nothing else in the repository hardcodes the old host. The one open point is whether the ledger's configured audience was also changed to the new URL, which the PR's merge note doesn't cover. If it wasn't, every review fails with 401 and exit 3.

<details><summary>What the change connects to (0 closed, 1 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Open: the reviewer could not close these**
- Review workflow sends the ledger reserve/settle/record calls and requests the OIDC token for the new host `https://ledger.wachiman-api.dev` (`.github/workflows/wachiman-review.yml:23`) — Is the ledger deployed at ledger.wachiman-api.dev with its configured audience set to exactly `https://ledger.wachiman-api.dev`, and is the repository still linked to an account there? This lives outside the repository. Files that would answer it: `docs/ledger-api.md`, `docs/troubleshooting.md`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost (estimate) |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 1 | 1 | 2 | 8 | reviewed | 6 | $0.08 |

</details>

<sub>Not counted against the spend limit: the ledger could not be reached.</sub>

<sub>Claude Sonnet 5.5 via Claude Code 2.1.304 · effort high · review · PR so far $0.08 over 1 automatic run · 6 in / 2.1k out / 32k cache read / 15k cache write · Claude subscription: API-equivalent estimate, not a bill · $0.08</sub>

<!-- wachi:auto -->

<!-- wachi:review -->

<!-- wachiman sha=e943b35660df37e27aab6ddfbe8ed8cded38e64d -->

<!-- wachi:attempt id=4393d850-8121-44a8-bb5c-c5a9e42e5718 -->
