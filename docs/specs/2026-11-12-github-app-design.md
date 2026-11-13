# The Wachiman GitHub App: comment identity, repository linking and sign-in

- **Status:** proposed 2026-11-12. Nothing here is implemented. It depends on work that is not on
  `main` yet: the hosted spend platform (issue
  [#205](https://github.com/niway-dev/wachiman/issues/205), draft
  [#202](https://github.com/niway-dev/wachiman/pull/202)) and the reusable workflow
  `review-platform.yml` that carries `id-token: write`.
- **Issue:** [#206](https://github.com/niway-dev/wachiman/issues/206)
- **ADRs:** [0045](../adr/0045-a-github-app-whose-private-key-lives-alone-in-an-exchange-worker.md),
  [0046](../adr/0046-own-output-is-recognised-by-bot-account-id-never-by-text-in-the-body.md)
- **Starts from:** section 3 "The token exchange" of
  `docs/specs/2026-11-07-three-modes-design.md` and ADR 0024, both on branch `design/three-modes`
  (pull request [#135](https://github.com/niway-dev/wachiman/pull/135), open, not merged). The
  owner asked on 2026-11-12 for that text to be used, not designed again. It is copied in
  [section 2](#2-the-token-exchange-carried-from-pull-request-135) with a short list of
  amendments, so it survives when #135 closes.

## Summary (one minute)

Wachiman registers one GitHub App, owned by the `niway-dev` organisation and installable by any
account. It does three things: reviews appear under the App's name and avatar instead of
`github-actions[bot]`; installing it links repositories to a platform account; and it is the
sign-in for the panel and for `wachiman init`. The engine still runs in the consumer's own Actions
with the consumer's own model credential; the App is never a hosted reviewer.

The App's private key is the only secret of one small Worker that does nothing else: it trades a
run's OIDC token for a one-hour installation token limited to that run's repository. The Worker's
source is in the private backend repository, as the owner decided. The public ledger Worker never
holds the key. If the exchange fails, the review posts as `github-actions[bot]`, so a pull request
can carry both authors; the engine recognises its own output by the author's bot account id.

| # | Decision | Why | ADR |
| --- | --- | --- | --- |
| 1 | Build the App now: comment identity, installation linking, sign-in. This overrides "No GitHub App for now" (PR #38), ADR 0005 decision 5 and ADR 0010's rejected alternative | Their reopen condition (someone other than the owner installs) is still not met. Their premises changed: the hosted platform now pays for the backend and for `id-token: write`, two of the four costs PR #38 weighed | 0045 (new) |
| 2 | Permissions: `metadata: read` and `pull_requests: write`. No `issues`, no `contents`. No event is ticked at registration | Every write the engine makes already succeeds under `pull-requests: write` alone (`.github/workflows/review.yml`). One permission less is one thing less a stolen key can do | 0045 |
| 3 | The exchange is a dedicated Worker with one route, `POST /v1/app/token`, one secret (the private key) and no database. Source in the private backend repository | The backend's source is private by the owner's decision of 2026-11-12: public backend code is a larger target, and nothing needs it public today. A Worker with one route keeps the key away from the ledger's public code, the panel, the webhook and their deploy credentials | 0045 |
| 4 | The exchange text of #135 section 3 stands, with eight amendments (section 2) | The owner's instruction. Each amendment follows from decision 2, 3 or 5, or answers a failure listed below | 0045 |
| 5 | The App is public (any account can install it) and the exchange serves every repository where it is installed. Installing is the only admission step; a request limit per owner replaces any list or invitation | The owner wants the identity on their own pull requests and for anyone who installs, with the least friction (2026-11-12). Installing the App is the consent | 0045 |
| 6 | Identity is cosmetic: any exchange failure posts as `github-actions[bot]` and the review still lands | Kept from ADR 0024 decision 5: a name on a comment is not worth a lost review | 0045 |
| 7 | The engine recognises its own reviews and comments by bot account id and author type, in one function. Text in the body never grants trust | Two authors can post on one pull request. An id is the same in REST and GraphQL and survives renaming the App | 0046 (new) |
| 8 | The App token is used only to create reviews, replies and comments. Reading, editing and resolving stay on the workflow's `GITHUB_TOKEN` | The smallest change to the engine, and the calls whose author nobody sees do not need the App | 0046 |
| 9 | Installation webhooks and sign-in live in the platform Worker, with the webhook secret and the OAuth client secret. They never hold the private key | Neither needs it: a webhook is verified with its own secret and sign-in with the client secret | 0045 |
| 10 | Pull requests #135 and #38 close unmerged when this design merges | Their App content is here; #135's other parts already shipped differently or belong to #205 (section 7) | — |
| 11 | A platform account is created by itself on the first run or the first installation, keyed by GitHub's id of the owning account, and is claimed later by signing in | No sign-up, no link code, no invitation. GitHub already issues a stable id, so nothing is generated | — (proposed to #205, section 1.1) |

## Open questions

Each has the default that will be built if the owner does not answer.

1. **The App's name.** `Wachiman` is taken by a personal account that is not the owner's, and
   GitHub refuses the name of someone else's account. Free on 2026-11-12, as account and as App
   slug: `wachiman-review`, `wachiman-reviewer`, `wachiman-app`, `wachiman-bot`, `wachiman-dev`.
   Default: **Wachiman Review** (comments show `wachiman-review[bot]`). Decision 7 makes a later
   rename safe.
2. **Does `job_workflow_ref` pin a tag or a commit?** #135 pins `@refs/tags/v*`, and tags can be
   moved. Default: keep the tag pattern and add a tag ruleset on `niway-dev/wachiman` that forbids
   updating or deleting `v*`. Reason: someone who can move a tag already runs code in every
   consumer's job with that job's own `pull-requests: write` token, so the App token adds no
   reach. An allow list of commits would need a Worker deploy on every release.
3. **The request limit of decision 5.** Default: 60 token requests per repository owner per
   hour; above it the exchange answers 429 and the run posts as `github-actions[bot]`.
   Unverified: that Cloudflare's rate limiting for Workers can count by a value read from the
   verified token without a database.
4. **Who may change an organisation account's limits?** Section 1.1 lets a signed-in person
   claim an organisation's account when their token lists the App's installation there. That is
   true for members with access to an installed repository, not only for owners. Default: the
   person who installed the App administers the account; other members only read it. Owned by
   #205 and [#207](https://github.com/niway-dev/wachiman/issues/207).
5. **The exchange Worker's host name.** Default: its own host under the platform's domain, chosen
   in #205. The OIDC audience is that origin.

## Out of scope

- A hosted reviewer, a Marketplace listing, Check Runs, autofix, any `contents` permission.
- Installing the App as the only step. A repository still needs the caller workflow and its
  model credential, because the review runs in its own Actions; `wachiman init` writes both.
- The platform itself: accounts, limits, the panel, where the webhook writes (issue #205).
- The sign-in flow and the CLI login command (issue #207). This design only fixes which App they
  use and which secrets they need.
- App identity for someone who deploys their own ledger. A self-hosted ledger posts as
  `github-actions[bot]`. Running their own App and exchange is possible and not documented here.
- A second posting job that separates the model from every credential (see ADR 0045, "Reopen
  when").
- A non-exportable key in a key vault.

## Failures this must protect against

- **A stolen private key.** The thief signs App JWTs and mints tokens for every installation,
  without the exchange and its limits: read of pull request patches and `pull_requests: write`
  everywhere the App is installed. Not repository contents, not issues, not pushes. Deleting the
  key does not revoke tokens already minted; they expire within the hour.
- **A deploy credential of another Worker replaces the exchange Worker** and reads its secret.
- **A workflow in repository X gets a token for repository Y.**
- **Another workflow in an installed repository posts as Wachiman.**
- **A stranger installs the public App and floods the exchange.**
- **Someone claims a platform account that is not theirs,** or reads an unclaimed one.
- **A token meant for the ledger is replayed at the exchange,** or the reverse.
- **A prompt-injected model in the job obtains the App token** and posts comments that start
  other workflows of the repository. Comments posted with `GITHUB_TOKEN` start none; comments
  posted with an App token do.
- **The exchange is down in the middle of a pull request.** Earlier output is the App's, later
  output is `github-actions[bot]`'s: the next run must still find the last reviewed commit, the
  unfinished files, the money spent and its own replies.
- **A person or another bot copies a hidden marker or a cost footer** into a comment.
- **The App is renamed** and its earlier reviews stop being recognised.
- **A notice written by one author cannot be edited by the other.**
- **The App's own comments queue runs of the consumer's workflow** and push a waiting reply out of
  its concurrency group.
- **A consumer's other automation reacts to comments** and now sees Wachiman's, which it never
  received while they came from `GITHUB_TOKEN`.

## Acceptance criteria

- [ ] `git grep -n 'github-actions' -- src ':!src/**/*.test.ts'` finds the login in one file: the
      one that defines the own-author rule.
- [ ] A test with reviews, inline comments, replies and notices interleaved from both authors
      passes for each of the ten readers listed in ADR 0046: last reviewed commit, unfinished
      files, thread ownership, no second reply, spend total, notice update, review landed.
- [ ] The same test with a human comment and a third bot's comment that copy every marker and
      footer: neither is counted.
- [ ] `POST /v1/app/token` answers 403 for each of: a `job_workflow_ref` other than
      `review-platform.yml` at a `v*` tag, `event_name` `pull_request_target`, a repository without
      the installation, a token with the ledger's audience; and 429 above the owner's limit.
- [ ] A 200 answer's token, sent to `GET /installation/repositories`, lists one repository, and
      its `permissions` are `metadata: read` and `pull_requests: write`.
- [ ] With the exchange URL unreachable, a review lands as `github-actions[bot]` and the job log
      has the line `app identity unavailable (<reason>); posting as github-actions[bot]`.
- [ ] `wrangler secret list` on the exchange Worker shows one secret. `git grep -n 'app/token'` in
      this repository finds only the engine's client call and documents.
- [ ] The App's settings page shows two repository permissions (Metadata read, Pull requests read
      and write), no subscribed event, and "Any account".
- [ ] The five probes of section 6 are recorded, with their output, in the pull request that
      ships the exchange.
- [ ] `docs/install.md` states what the App's key can reach and how to stay without the App.

---

## 1. What the App is, in three functions

| Function | Needs | Lives in | Secret |
| --- | --- | --- | --- |
| Comment identity | the exchange | the exchange Worker | the App private key |
| Installation linking | a webhook route | the platform Worker | the webhook secret |
| Sign-in, web and CLI | the App's user authorization, device flow on | the platform Worker and the CLI | the client secret (web only; the device flow needs the client id alone) |

They ship separately (section 6). Comment identity does not wait for the accounts table, because
the exchange is stateless.

"Public" means one thing: any GitHub account or organisation can install the App. It says nothing
about source code. The App's code is private; the engine and the ledger stay public.

A repository can run in three ways, and all three stay:

| Way | Caller uses | Spend recorded and checked | Author of the review |
| --- | --- | --- | --- |
| Direct | `review.yml` at a tag | no | `github-actions[bot]` |
| Platform | `review-platform.yml` at a tag | yes, before the model runs | `github-actions[bot]` |
| Platform with the App installed | `review-platform.yml` at a tag | yes | the App |

Recording spend and checking whether a run may spend need the platform workflow and the run's
OIDC token. They need nothing from the App.

### 1.1 Accounts without sign-up (proposed to #205)

The owner asked on 2026-11-12 for the least friction, and whether an account could have a
generated id until someone claims it. Nothing has to be generated: GitHub gives every user and
organisation a numeric id, and it reaches the platform twice, as `repository_owner_id` in a
run's OIDC token and as `installation.account.id` in the installation event.

- **Created by itself.** The first platform run of a repository, or the first installation,
  creates the account for that owner id with the default limits. Spend is recorded and checked
  from that first run. Nobody signed up.
- **Unclaimed.** Until someone claims it, no person can read it or change its limits.
- **Claimed by signing in.** A personal account is claimed when the signed-in user's id equals
  the owner id. An organisation's account is claimed when the signed-in user's token lists the
  App's installation on that organisation (`GET /user/installations`), so claiming an
  organisation needs the App installed there. With "Request user authorization (OAuth) during
  installation" on, whoever installs is signed in by the same flow and the account is claimed
  with no further step.
- **Cleaned up.** An unclaimed account with no run for 30 days is deleted.

This is the App's side of the account model. The table, the limits and the panel are #205's.

## 2. The token exchange, carried from pull request #135

The text below is section 3 of `docs/specs/2026-11-07-three-modes-design.md` on branch
`design/three-modes`, unchanged.

> Route: `POST /v1/app/token`, bearer = the run's OIDC token with the ledger's audience (the same
> token #129 uses for `reserve`). Steps, in the Worker:
>
> 1. `verifyGithubToken` as today (signature, `iss`, `aud`, `nbf`, `exp`).
> 2. `job_workflow_ref` must match `niway-dev/wachiman/.github/workflows/review.yml@refs/tags/v*`
>    (or `@<sha>` once immutable releases are on, PR #38 open question 1). Otherwise 403
>    `wrong_workflow`.
> 3. `event_name` must be `pull_request` or `issue_comment`; `pull_request_target` is refused.
> 4. Look up `repository_id` in the `installations` table; if absent, open question 2. If still
>    absent, 403 `not_installed`.
> 5. Sign an App JWT (RS256, `iat`−60 s, `exp`+9 min, `iss` = App id) with the PKCS#8 key from the
>    Worker secret, through `crypto.subtle` only (no library, ADR 0002's rule carried to the
>    Worker).
> 6. `POST /app/installations/{installation_id}/access_tokens` with
>    `{ repository_ids: [repository_id], permissions: { pull_requests: "write", issues: "write" } }`
>    (the body can limit both; the token lives one hour).
> 7. Return `{ token, expires_at, bot_login }`. Nothing is stored; one log line without the token.
>
> The engine calls the exchange once, before `reserve`, with a 10-second timeout. Any non-200,
> timeout or malformed answer selects `GITHUB_TOKEN` and logs `app identity unavailable (<reason>);
> posting as github-actions[bot]`. The review's hidden footer records which token posted, so the
> re-review logic (ADR 0011) can find earlier comments by either author.
>
> Why fall back rather than fail: a daily limit is money, so #129 fails closed; identity is a name
> on a comment, so losing it costs nothing. Argument against the fallback: a reader sees two
> authors on one pull request after an outage. Accepted; the footer names the reason.
>
> What the exchange refuses to be: a general token service. It mints one token shape for one
> workflow; `jsiebens/gh-app-token-service` is the counter-example recorded in PR #38 (no audience
> check, owner-only claim, full-permission token), and `octo-sts` the reference for the
> validations.

### Amendments

| # | #135 says | This design says | Why |
| --- | --- | --- | --- |
| A1 | The route is in the ledger Worker | The route is in its own Worker, source in the private backend repository | Decision 3 |
| A2 | Bearer has the ledger's audience | The engine requests a second OIDC token whose audience is the exchange Worker's origin; the exchange refuses any other audience | With two services, a token read at one must not be usable at the other |
| A3 | `job_workflow_ref` names `review.yml` | It names `review-platform.yml` | `review.yml` has no `id-token: write`; the platform twin does |
| A4 | `event_name` is `pull_request` or `issue_comment` | Also `pull_request_review_comment` | The threads job answers on that event; without it every reply would fall back |
| A5 | Step 4 reads an `installations` table | Step 4 calls `GET /repos/{owner}/{repo}/installation` with the App JWT, using the `repository` claim; 404 gives 403 `not_installed` | No database in the Worker that holds the key. One more GitHub call per run |
| A6 | The token carries `pull_requests` and `issues` write | `pull_requests: write` only | Decision 2 |
| A7 | No limit on requests | The installation found in step 4 is the admission. Requests are counted per `repository_owner_id`; above the limit the answer is 429 `rate_limited`, which the engine treats as any other failure | Decision 5 |
| A8 | The engine calls the exchange once, before `reserve` | The engine calls it when it is about to post, after the last model call of the run. The token stays in the engine's memory and is handed to each posting call; it is never written to the job environment or to disk | The model's child process and the App token should not exist at the same time. It also keeps the hour from running out |

The hidden footer still records which author posted and why a fallback happened. It is for
people reading the pull request. The engine never uses it to decide what is its own (ADR 0046).

### What the exchange Worker is not allowed to become

- It has no second route, no database binding, no Service Binding into it from the panel.
- It is deployed by hand by the owner. No CI holds a credential that can deploy it. If a CI
  credential in the same Cloudflare account can edit Workers, it is scoped to named Workers, or
  the exchange moves to an account of its own.
- It logs one line per request: repository id, run id, result. Never the OIDC token or the
  minted token.

## 3. Permissions and events

| Setting | Value | Used for |
| --- | --- | --- |
| Repository: Metadata | Read-only (GitHub adds it) | listing an installation's repositories |
| Repository: Pull requests | Read and write | reviews, review comment replies, comments on a pull request |
| Repository: Issues | No access | — |
| Repository: Contents | No access | the consumer's `GITHUB_TOKEN` reads the code |
| Organization, Account | No access | sign-in reads the user's id and login only |
| Subscribed events | none | `installation` and `installation_repositories` are the two the platform handles |

ADR 0024 listed `issues: write` because a comment on a pull request goes through the issues
endpoint. It is not needed: GitHub lists creating and updating an issue comment under the pull
requests permission
([permissions required for GitHub Apps](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps),
read 2026-11-12), and the reusable workflow on `main` posts everything today with
`pull-requests: write` and no issues write. Adding a permission later makes every installation
approve it again
([modifying a registration](https://docs.github.com/en/apps/maintaining-github-apps/modifying-a-github-app-registration)),
so it is added only when a feature needs it.

Unverified: that `installation` and `installation_repositories` reach the webhook without being
ticked. The registration checklist checks it with a first delivery (section 5, step 9).

What the key can reach, stated as it is: with `pull_requests: read` a token lists a pull
request's files with their patches, in private repositories too. The service is never sent code
or a diff, and it holds a key that could fetch pull request patches wherever the App is
installed. `docs/install.md` says both sentences.

## 4. How the engine recognises its own output

Today ten places decide "this is mine" by login, with two spellings: `github-actions[bot]` in
REST and `github-actions` in GraphQL (`src/engine.ts` 1867, 2169, 2287, 2303, 2322, 2439, 2477,
4327; `src/precision.ts` 90, 154). One of them also checks the author type.

The rule (ADR 0046):

- An author is the engine's own when its type is `Bot` and its account id is in the own-author
  set. The set is `41898282` (`github-actions[bot]`) and the App's bot account id, both constants
  in the engine, plus one optional id from configuration for a self-registered App.
- REST gives `user.id` and `user.type`. GraphQL gives `author { __typename ... on Bot { databaseId } }`.
  Checked on 2026-11-12: for `github-actions` both return `41898282`.
- One function holds the rule. Every reader calls it. No login literal is left elsewhere.
- Nothing in a body grants trust: not the `<!-- wachi:… -->` signatures, not the cost footer, not
  the footer line that names the author. They classify a record after the author check passed.
- Every reader takes "latest" across both authors, ordered by time, never per author.

What does not change: any workflow in a repository can post as `github-actions[bot]`, so the
engine trusts the repository's other workflows exactly as it does today. The App's identity is
stronger, since only the exchange can mint it. The ledger, not the footers, is the authority for
money on the platform path.

Posting (decision 8): the App token is used for `POST …/pulls/{n}/reviews`,
`POST …/pulls/{n}/comments/{id}/replies` and creating a comment on the pull request. Reads, the
`PATCH` of a notice and `resolveReviewThread` stay on `GITHUB_TOKEN`. If the `PATCH` of a notice
written by the other author is refused, the engine posts a new notice and later runs pick the
newest one.

The caller's jobs already skip comments whose author type is `Bot`, so the App's comments start
workflow runs that skip at once. That is noise in the Actions tab, not spend. Whether such a
skipped run can displace a waiting run in the threads concurrency group is probe P4.

## 5. Registration: the owner's manual steps

Done once, by the owner, in the browser and a terminal. Nothing here can be done by an agent.

1. Open `https://github.com/organizations/niway-dev/settings/apps/new`.
2. **GitHub App name:** `Wachiman Review` (open question 1). **Homepage URL:** the product's
   site, or `https://github.com/niway-dev/wachiman`. **Description:** one line saying that
   reviews run in your own Actions and the App only names them.
3. **Callback URL:** leave empty now; issue #207 adds the panel's callback when sign-in ships.
   **Expire user authorization tokens:** on. **Request user authorization (OAuth) during
   installation:** off now, on when sign-in ships, so that installing also claims the account
   (section 1.1). **Enable Device Flow:** on.
4. **Webhook → Active:** off now. It is turned on with the platform's URL
   (`POST /v1/app/webhook`) and a secret when installation linking ships (step 9).
5. **Permissions → Repository → Pull requests:** Read and write. Leave everything else at No
   access; Metadata becomes Read-only by itself.
6. **Subscribe to events:** tick none.
7. **Where can this GitHub App be installed?** "Any account". This is what "public" means: other
   accounts can install it. Create the App.
8. On the App's page:
   - note the **App ID** and the **Client ID** (neither is a secret);
   - upload the avatar;
   - **Generate a private key**: the browser downloads a `.pem` file. Convert and store it, then
     delete both files:
     ```sh
     openssl pkcs8 -topk8 -nocrypt -in downloaded.pem -out app.pkcs8.pem
     wrangler secret put APP_PRIVATE_KEY < app.pkcs8.pem   # in the exchange Worker's directory
     rm downloaded.pem app.pkcs8.pem
     ```
     No copy is kept: if the secret is lost, generate another key (an App can hold 25).
   - note the bot account id for the engine's constant:
     `gh api 'users/wachiman-review[bot]' --jq .id`
   - **Install App** on the organisation and on the personal account, choosing repositories.
9. When installation linking ships: set the webhook URL and a secret
   (`openssl rand -hex 32`), turn Active on, and check that installing the App on a test
   repository delivers an `installation` event (the App's "Advanced" tab lists deliveries). If
   none arrives, tick the event by name.
10. On `niway-dev/wachiman`: add a tag ruleset for `v*` that blocks updates and deletions (open
    question 2).

Where each value goes:

| Value | Secret? | Goes to |
| --- | --- | --- |
| App private key (PKCS#8) | yes | exchange Worker secret `APP_PRIVATE_KEY`. Nowhere else: not git, not a laptop, not another Worker, not Actions secrets |
| App ID | no | exchange Worker variable `APP_ID` |
| Webhook secret | yes | platform Worker secret, when linking ships |
| Client secret | yes | platform Worker secret, when web sign-in ships. Generated then, not before |
| Client ID | no | platform Worker variable, and a constant in the CLI for the device flow |
| Bot account id | no | a constant in the engine (ADR 0046) |
| Exchange URL | no | an input of `review-platform.yml` with the hosted URL as default |

No consumer repository receives a secret from the App.

If the key leaks: generate a new key, `wrangler secret put` it, delete the old key on the App's
page. Tokens minted with the old key last at most one hour more.

## 6. Build order

**Parked behind the ledger (owner, 2026-11-12).** Nothing below starts until the spend ledger
records and limits real runs of one repository (pull requests
[#211](https://github.com/niway-dev/wachiman/pull/211),
[#212](https://github.com/niway-dev/wachiman/pull/212) and
[#213](https://github.com/niway-dev/wachiman/pull/213)). The ledger needs nothing from the App.
The App stays optional for every repository: with or without it the review is the same, and
only its author changes.

Each line is one pull request for the build thread, except S2.

- **S1. One own-author rule in the engine** (ADR 0046), with the set holding only
  `github-actions[bot]`. No behaviour change. Does not depend on the platform.
- **S2. The owner registers the App** (section 5, steps 1 to 8) and installs it on one test
  repository.
- **S3. The exchange Worker and the engine's call**, on `review-platform.yml` only, with the
  fallback and the footer line. Needs S1, S2 and the platform pull requests that add
  `review-platform.yml`. Ships with the probes:
  - P1. A Worker imports the PKCS#8 key and signs RS256 with `crypto.subtle`.
  - P2. `GITHUB_TOKEN` edits a notice the App wrote, and the App token edits one
    `github-actions[bot]` wrote.
  - P3. `resolveReviewThread` with `GITHUB_TOKEN` on a thread the App opened.
  - P4. A review of several inline comments posted as the App while a threads run is waiting:
    the waiting run still runs.
  - P5. REST `user.id` and GraphQL `databaseId` of the App's bot are equal.
- **S4. Installation webhook and linking**, in the platform Worker. Needs the accounts work of
  #205.
- **S5. Sign-in, web and device flow.** Owned by #207.

## 7. What happens to earlier documents

- **ADR 0005 decision 5 and ADR 0010's rejected alternative** ("A GitHub App or bot account so
  the avatar shows the mascot"): superseded by ADR 0045. Their Status lines are amended by the
  pull request that ships S3, when the supersession becomes true in code.
- **ADR 0001's non-goal "A hosted service":** it is the platform's ADR (issue #205) that amends
  it. ADR 0045 depends on that amendment and adds nothing to it.
- **Pull request #135** closes unmerged. Its App content is this spec and ADR 0045. Its local
  CLI part shipped under other records on `main` (ADR 0028, ADR 0029). Its account-table record
  (ADR 0025 on that branch) is replaced by what #205 decides. The numbers 0024, 0025 and 0026
  never reach `main`.
- **Pull request #38** (draft, a session handoff file) closes unmerged. What it found is kept
  here: the shape "token exchange that sees an OIDC token and never code", the unsafe
  counter-example, and its open question on immutable releases (open question 2).
- **`README.md`** ("A GitHub App is a design only; it is not implemented"), **`docs/uninstall.md`**
  and the caller template's comment stay as they are until S3 ships.

## Sources and unverified claims

Checked on 2026-11-12:

- A listing on the Marketplace is not needed for other accounts to install a public App; a
  listing asks for an organisation owner, and for a verified publisher when plans are paid.
  [Requirements for listing an app](https://docs.github.com/en/apps/github-marketplace/creating-apps-for-github-marketplace/requirements-for-listing-an-app),
  [installing from a third party](https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party)
- The App name is unique, at most 34 characters, and cannot be another account's name; the
  displayed name is the slug.
  [Registering a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)
- A user can authorize an App that is not installed.
  [Authenticating on behalf of a user](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-with-a-github-app-on-behalf-of-a-user)
- Events caused by `GITHUB_TOKEN` start no workflow run; an App installation token does.
  [Triggering a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
- The private key "is the single most valuable secret for a GitHub App"; keys do not expire; an
  App can hold 25.
  [Managing private keys](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps)
- An App can be transferred to another account; the page does not say what survives.
  [Transferring ownership](https://docs.github.com/en/apps/maintaining-github-apps/transferring-ownership-of-a-github-app)
- Prior art for the exchange: [octo-sts](https://github.com/octo-sts/app),
  [claude-code-action's token exchange](https://raw.githubusercontent.com/anthropics/claude-code-action/main/src/github/token.ts),
  and its documented alternative, an App of one's own with the key in repository secrets
  ([setup](https://github.com/anthropics/claude-code-action/blob/main/docs/setup.md)).
- `GET /users/github-actions[bot]` returns id `41898282`, type `Bot`; GraphQL returns
  `__typename: Bot`, `databaseId: 41898282` for the same author.

Not verified, each with where it is settled:

- A Worker imports the key as PKCS#8 and signs RS256 (P1).
- Editing a comment across the two authors (P2); resolving a thread the App opened (P3).
- A skipped run and the concurrency group (P4).
- `installation` events arrive without a ticked event (section 5, step 9).
- The OIDC token is not issued to pull requests from forks. Wachiman does not review them (ADR
  0001), so nothing depends on it.
- `GET /repos/{owner}/{repo}/installation` needs nothing beyond the App JWT (first run of S3).
- `GET /user/installations` lists an organisation's installation for a member who can reach an
  installed repository, not only for its owners. Read on the REST page, not probed
  ([list app installations accessible to the user access token](https://docs.github.com/en/rest/apps/installations#list-app-installations-accessible-to-the-user-access-token));
  settled in S4, and it is why open question 4 exists.
- A Worker can count requests per repository owner without a database (open question 3;
  settled in S3).
