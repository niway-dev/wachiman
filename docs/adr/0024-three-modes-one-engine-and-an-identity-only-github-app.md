# ADR 0024: Three modes of one engine, and a GitHub App that is identity and linking only

- **Status:** proposed 2026-11-07, not implemented. Build after
  [#129](https://github.com/niway-dev/wachiman/pull/129) merges. **Supersedes** decision 5 of
  [ADR 0005](0005-name-wachi-reviewer.md) ("reviews keep posting as `github-actions[bot]`; no
  GitHub App and no backend") and the rejected alternative "A GitHub App or bot account so the
  avatar shows the mascot" of [ADR 0010](0010-name-wachiman.md). The reopen condition of both
  ("someone other than the owner installs the tool") is **not met**: nobody else uses Wachiman
  yet. The owner reopens ahead of it by choice, so the design exists before the first outside
  installation instead of after.
- **Date:** 2026-11-07
- **Spec:** [Three ways to run Wachiman](../specs/2026-11-07-three-modes-design.md)
- **Issue:** [#134](https://github.com/niway-dev/wachiman/issues/134); the App shape was first
  recorded in PR [#38](https://github.com/niway-dev/wachiman/pull/38).
- **Numbering:** 0024 because `main` holds up to 0023 and open pull requests hold 0014–0022.

## Context

Wachiman runs today as a reusable workflow in the consumer's Actions with the consumer's key
(ADR 0001) and, since ADR 0019, as `wachiman local` on a developer's own Claude account. Comments
are posted by `github-actions[bot]`, so a reader cannot tell a Wachiman review from any other
workflow's comment. #129 adds a ledger service for a daily spend limit; its account table is
hand-edited and a repository is linked by the owner by hand.

ADR 0005 and ADR 0010 rejected a GitHub App because it needed a service holding a private key,
which ADR 0001 ruled out. ADR 0021 (#129) has since accepted one hosted service for one purpose.
PR #38 settled what an App may be if one is built: a token-exchange service that sees an OIDC
token and never code or a diff, with the review still in the consumer's Actions.

The owner's constraints (#134, 2026-11-07): the owner must never see anyone's code or diff; the
user always pays the model with their own key; no new server; no Go or Rust; local mode counts
for nothing anywhere.

## Decision

1. **Three modes, one engine.** *Direct*: the reusable workflow as today. *App*: the same
   workflow, same consumer's Actions, same consumer's key, plus a name and avatar on comments,
   automatic linking of installed repositories to the user's ledger account, and sign-in for the
   panel. *Local*: ADR 0019, untouched; no ledger, panel, limit or telemetry; an optional spend
   log on disk that never leaves the machine. Prompts and pipeline are shared, so every benchmark
   holds for every mode.
2. **The App is never a hosted reviewer.** The owner's service receives no pull request or push
   event, no diff, no finding, no title or body. It receives installation events and the
   exchange request. What it could technically see is stated, not hidden: a minted token with
   `pull_requests: write` can read a pull request's file patches, so the guarantee is that the
   Worker's public code never calls GitHub with the minted token, never stores it, and the App
   has no `contents` permission.
3. **App permissions and events.** `metadata: read`, `pull_requests: write`, `issues: write`;
   nothing else. Events: `installation` and `installation_repositories` only. Reading code stays
   with the consumer's `GITHUB_TOKEN` (`contents: read` in the job), as today.
4. **The token exchange lives in the ledger Worker.** `POST /v1/app/token`: GitHub OIDC token
   in (verified by `ledger/src/oidc.ts`), installation token out, limited by request body to
   the token's own `repository_id` and to `pull_requests: write` plus `issues: write`, one hour,
   only when the App is installed on that repository, only when `job_workflow_ref` names
   Wachiman's reusable workflow at a release ref, and never for `pull_request_target`. The App's
   private key is a Worker secret (PKCS#8 PEM, converted once from GitHub's PKCS#1 download;
   unverified until probed) and the JWT is signed with WebCrypto RS256, no library.
5. **Identity is cosmetic and never blocks a review.** If the exchange fails for any reason, the
   run posts with its own `GITHUB_TOKEN` as `github-actions[bot]`, logs one line and records the
   fallback in the hidden footer.
6. **The user pays the model; Wachiman bills nothing.** No key of Wachiman's own, no plan, no
   invoice, in any mode.
7. **No new server.** The ledger Worker also hosts the exchange, the installation webhook
   (signature-verified) and the panel's data API. No Go, no Rust, no container.
8. **Reopening ahead of condition.** This record supersedes ADR 0005 decision 5 and ADR 0010's
   rejection without their reopen condition being met; the reason is the owner's choice to design
   before the first outside installation. If no outside installation exists by the time #129 has
   run for three months, the App part of this record is paused, not built.

## Alternatives rejected

- **A hosted App that reviews on the owner's infrastructure** (the Renovate-hosted shape). The
  owner would see code and pay for compute; it contradicts the one constraint everything else
  here follows.
- **No App at all; keep `github-actions[bot]`** (ADR 0005 decision 5). Still the right answer for
  a single consumer, but it leaves linking by hand and no sign-in for the panel #129 already
  promises.
- **A bot user account instead of an App.** A long-lived personal access token to distribute,
  no per-repository scoping, no webhooks for linking.
- **Fail the review when the exchange fails.** Right for money (ADR 0021 fails closed), wrong
  for a name on a comment.
- **A general token service** (any workflow, any permission the App has). The shape PR #38
  found unsafe in `jsiebens/gh-app-token-service`; here the Worker mints one token shape for one
  workflow.
- **A separate Worker for the App.** Two deploys, two secret stores, two OIDC verifiers for one
  table they both need.
- **Claim "the App cannot see code".** Not true with `pull_requests: read` reaching patches;
  decision 2 says what is true instead.

## Consequences

- The caller gains `app_identity: true` (effective only with `ledger_url`); `id-token: write` is
  already required by #129. The reusable workflow's `permissions` block is unchanged.
- The engine chooses its posting token before the first model call and keeps the App token out
  of the agent's environment, under the same `CHILD_ENV_ALLOWLIST` rule as the OIDC variables.
- The re-review logic (ADR 0011) must find earlier comments by either author; the footer records
  which one posted.
- The owner holds an App private key. A leak lets a thief post and read pull request files on
  every installation until rotation; it does not reach repository contents.
- Registering the App means a public App name; `wachiman` on GitHub is a personal account
  (ADR 0010), so the App name may need to be "Wachiman Reviewer" or similar. Unverified.
- Everything here is public code; the account data stays private (ADR 0021 decision 7).

## Non-goals

- Hosted review, autofix, `contents: write`, Check Runs, a Marketplace listing.
- Billing or a key Wachiman owns.
- Any change to local mode beyond the optional spend log.

## Reopen if

- A consumer needs the App to read code (for example, reviews of repositories whose Actions
  cannot hold the key): that is a different product and needs its own trust model.
- GitHub lets an App post comments without `pull_requests: read` reaching patches: tighten
  decision 2 to the stronger claim.
- The exchange fails on more than 5 % of App-mode runs in a month: the fallback is hiding an
  outage; add monitoring or move the exchange.
- Three months after #129 ships, nobody outside the owner has installed Wachiman: pause the App
  (decision 8).
