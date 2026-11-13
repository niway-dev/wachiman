# ADR 0045: A GitHub App for identity, linking and sign-in, whose private key lives alone in an exchange Worker

- **Status:** proposed 2026-11-12, not implemented. Depends on the hosted platform (issue
  [#205](https://github.com/niway-dev/wachiman/issues/205)) and on the reusable workflow
  `review-platform.yml`, neither on `main` yet. When the exchange ships, this record
  **supersedes** decision 5 of [ADR 0005](0005-name-wachi-reviewer.md) ("Reviews keep posting as
  `github-actions[bot]`. No GitHub App and no backend.") and the rejected alternative "A GitHub
  App or bot account so the avatar shows the mascot" of [ADR 0010](0010-name-wachiman.md). It
  replaces ADR 0024, which exists only on the branch of pull request
  [#135](https://github.com/niway-dev/wachiman/pull/135) and never reached `main`.
- **Date:** 2026-11-12
- **Spec:** [The Wachiman GitHub App](../specs/2026-11-12-github-app-design.md)
- **Issue:** [#206](https://github.com/niway-dev/wachiman/issues/206)

## Context

Reviews are posted by `github-actions[bot]`, the author of anything any workflow posts with its
own token. ADR 0005 decision 5 and ADR 0010 refused a GitHub App because it "needs a service
holding a private key, which ADR 0001 rules out", and both reopen when "someone other than the
owner installs the tool". Pull request [#38](https://github.com/niway-dev/wachiman/pull/38)
recorded "No GitHub App for now" for four costs: registering an App, holding its private key,
hosting a token service, and adding `id-token: write` to every consumer; it reopens "only if a
consumer asks for the bot identity or install counts are needed".

Neither reopen condition is met: on 2026-11-12 the owner is still the only user
([#206](https://github.com/niway-dev/wachiman/issues/206)). What changed is the premise. On
2026-11-12 the owner chose a hosted spend platform: one for everyone, on Cloudflare, with the
ledger of pull request [#129](https://github.com/niway-dev/wachiman/pull/129). That platform
already needs a backend and `id-token: write` in a caller workflow, so two of the four costs are
paid whatever is decided here. The owner then leaned towards the App ("en este momento empieza a
parecer una buena idea") and asked that the exchange designed in pull request #135 be used. The
owner's words of that day are recorded under "Decided" in
[#206](https://github.com/niway-dev/wachiman/issues/206).

The owner also decided where the backend's code lives: this repository is public, and the
backend is in a private repository "para que no sea publico y vulnerable". ADR 0024 put the
exchange in the ledger Worker, whose source is public here, and its guarantee to consumers rested
on that ("the Worker's public code never calls GitHub with the minted token"). Both cannot hold.

## Decision

1. **Wachiman has one GitHub App,** owned by the `niway-dev` organisation, installable by any
   account. It gives reviews a name and avatar, links installed repositories to a platform
   account, and is the sign-in for the panel and the CLI. It is never a hosted reviewer: the
   engine runs in the consumer's Actions with the consumer's model credential, and the service
   receives no code, diff, finding or pull request event.
2. **Permissions are `metadata: read` and `pull_requests: write`.** No `issues`, no `contents`,
   no organisation or account permission, no subscribed event. A permission is added when a
   feature needs it, never ahead of it.
3. **The private key is the only secret of a dedicated Worker** with one route,
   `POST /v1/app/token`, and no database. Its source is in the private backend repository. It is
   deployed by hand; no CI credential can deploy it. The ledger Worker, the panel and the webhook
   never hold the key.
4. **The exchange is the one specified in pull request #135, section 3,** with the eight
   amendments in the spec: its own Worker, its own OIDC audience, `review-platform.yml` in
   `job_workflow_ref`, `pull_request_review_comment` admitted, the installation looked up at
   GitHub instead of in a table, `pull_requests: write` only, an allow list of repository owners,
   and the call moved to the moment of posting.
5. **The App is public and the exchange is closed.** Any account can install the App. The
   exchange mints tokens only for repository owners on its allow list until the owner invites
   outside users.
6. **Identity never blocks a review.** On any exchange failure the run posts as
   `github-actions[bot]`. How the engine then recognises its own output is
   [ADR 0046](0046-own-output-is-recognised-by-bot-account-id-never-by-text-in-the-body.md).
7. **The webhook and sign-in live in the platform Worker** with their own secrets (the webhook
   secret, the OAuth client secret).
8. **What consumers are told is what is true.** The service is sent an OIDC token and
   installation events, never code. The key it holds could read pull request patches and write to
   pull requests wherever the App is installed. Whoever does not accept that does not install the
   App and gets the same review as `github-actions[bot]`.

## Alternatives rejected

- **Keep `github-actions[bot]` until someone else installs** (ADR 0005 decision 5, PR #38). It
  costs nothing and holds no key. Rejected by the owner's choice: the platform is being built
  now, and the product is compared on the same pull request with reviewers that carry a name.
- **Register the App for sign-in and linking, add identity later** (the going-in recommendation of
  issue #206). It defers the one function the owner asked for and builds first the one that
  serves nobody while there is a single user: each run already proves its repository and owner
  with its OIDC token.
- **An App of the owner's own with the key in repository secrets and no exchange**
  (`actions/create-github-app-token`, the documented alternative of `claude-code-action`). No
  backend and no service holding a key. It gives the identity to the owner only: every other
  user would have to register an App. Rejected once the owner chose one hosted platform for
  everyone.
- **The exchange inside the ledger Worker** (ADR 0024 decision 4). One deploy and one OIDC
  verifier. Rejected: the ledger's source is public and its route takes input from every run, so
  the key would share a process with the most exposed code; and it contradicts the owner's
  decision on where the backend lives.
- **The exchange inside the platform Worker,** beside the webhook, the accounts and the panel.
  One private Worker fewer. Rejected: that Worker has sessions, pages and the largest code
  surface, and a fault in any of it would run where the key is.
- **Public source for the exchange,** so a consumer can read the code that holds the key. This is
  the stronger position on trust and the owner's decision goes the other way. Private source does
  not protect the key; what protects it is decision 3. Public source would let ADR 0024's
  guarantee be checked, though a reader still could not prove the deployed Worker matches it. See
  "Reopen when".
- **`issues: write` as well** (ADR 0024 decision 3). Not needed by any call the engine makes.
- **Pin `job_workflow_ref` to an allow list of commits.** Stronger than a tag pattern. Rejected
  for now: a moved tag already runs code in the consumer's job with an equal token, and the list
  would need a Worker deploy on every release. A tag ruleset is used instead.
- **A private App.** It installs on its owner's account only, and the owner's repositories are
  in two accounts.

## Consequences

- The owner holds the most sensitive secret Wachiman has had. A leaked key lets a thief read
  pull request patches and write to pull requests on every installation, without the exchange's
  limits, until the key is deleted; tokens already minted live up to one hour more. One person
  operates the service and there is no on-call.
- A consumer's pull request can show two authors after an exchange failure.
- Comments posted as the App start workflow runs; comments posted with `GITHUB_TOKEN` did not.
  The caller's own jobs skip bot authors. A consumer's other automation that reacts to comments
  will now see Wachiman's, and the install documentation says so.
- The model runs in the same job that can request the exchange's OIDC token. Moving the exchange
  to the moment of posting keeps the App token away from the model's process; it does not stop a
  process that escaped its sandbox from asking for one.
- Three Workers instead of ADR 0024's one, and two OIDC audiences in the engine.
- Someone who deploys their own ledger gets no App identity.
- ADR 0024's guarantee ("the Worker's public code never calls GitHub with the minted token")
  cannot be made. Decision 8 replaces it.

## Non-goals

- A hosted reviewer, autofix, Check Runs, a Marketplace listing.
- A general token service: one token shape, for one workflow.
- A key Wachiman owns for any model, billing, or a paid plan.
- The platform's accounts, limits and panel (issue #205) and the sign-in flow (issue
  [#207](https://github.com/niway-dev/wachiman/issues/207)).

## Reopen when

- **The owner invites the first outside user.** Before the allow list opens, decide again: an
  admission rule tied to platform accounts, a separate posting job so the model's job has no
  `id-token`, a non-exportable key, and whether the exchange's source becomes public.
- A consumer asks to read the code that holds the key: publish the exchange Worker's source. It
  contains no secret.
- The exchange fails on more than 5% of platform runs in a month: the fallback is hiding an
  outage.
- GitHub lets an App post on a pull request without being able to read its patches: tighten
  decision 8 to the stronger claim.
- A feature needs the App to read code or write to issues: that is a new permission, a new
  approval by every installation, and its own record.
