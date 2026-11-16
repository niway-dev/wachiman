# Three ways to run Wachiman: direct workflow, GitHub App, local CLI

- **Status:** proposed 2026-11-07. Nothing here is implemented. Build after
  [#129](https://github.com/niway-dev/wachiman/pull/129) (the ledger) merges.
- **Date:** 2026-11-07
- **Creates:** [ADR 0024](../adr/0024-three-modes-one-engine-and-an-identity-only-github-app.md)
  (three modes, one engine; the App is identity and linking only; the token exchange),
  [ADR 0025](../adr/0025-the-account-table-moves-to-d1-and-links-itself.md) (the account table
  in D1, self-service linking, the panel reaches the ledger by a Service Binding),
  [ADR 0026](../adr/0026-the-local-cli-ships-as-an-npm-package.md) (the local CLI ships as an
  npm package).
- **Reuses:** ADR 0001 (trust model, no forks, exact tags), ADR 0002 (zero dependencies in the
  engine), ADR 0019 (local mode), ADR 0021 and ADR 0022 from #129 (ledger, OIDC, accounts), ADR
  0023 (one name).
- **Refs:** [#134](https://github.com/niway-dev/wachiman/issues/134); PR
  [#38](https://github.com/niway-dev/wachiman/pull/38) (the App-is-identity-only decision and its
  research); PR #129 (ledger).
- **Numbering:** 0024 to 0026, because `main` holds up to 0023 and open pull requests hold
  0014–0015 (#80), 0017–0018 (#90), 0019 (#99), 0020–0021 (#124, the superseded draft of #129)
  and 0021–0022 (#129).

## Summary (one minute)

Wachiman has one engine and three ways to run it. **Direct** is today's reusable workflow: the
consumer's own key in its own repository, comments by `github-actions[bot]`, and the ledger of
#129 when the consumer wants a daily limit. **GitHub App** is the same workflow in the same
consumer's Actions with the same consumer's key; the App adds only a name and avatar on comments,
automatic linking of the repositories it is installed on to the user's ledger account, and
sign-in for the panel. It is never a hosted reviewer: the owner's service receives no code, no
diff and no pull request event. **Local** is `wachiman local` (ADR 0019): nothing leaves the
machine except the model call to the developer's own Claude account; no ledger, no panel, no
limit, no telemetry. The user always pays the model with their own key or subscription; Wachiman
bills nothing. The only server is the ledger Worker from #129, which also hosts the App's backend
(token exchange and installation webhooks) and moves its account table from a hand-edited secret
to D1 so linking can happen at runtime. The local CLI stops being a symlink script and ships as
the npm package `wachiman`.

| # | Decision | Why | ADR |
| --- | --- | --- | --- |
| 1 | Three modes, one engine: direct, App, local. The App mode is the direct mode plus identity and linking; the review still runs in the consumer's Actions with the consumer's key | The owner must never see anyone's code; one pipeline keeps every benchmark valid for every mode (ADR 0019) | 0024 (new) |
| 2 | The App asks for `metadata: read`, `pull_requests: write`, `issues: write`, no `contents`; it subscribes to `installation` and `installation_repositories` only | Posting a review and its comments needs `pull_requests: write`; an issue comment needs `issues` or `pull_requests` write; no pull request or push event ever reaches the Worker | 0024 |
| 3 | Token exchange in the ledger Worker: GitHub OIDC token in (verified by `ledger/src/oidc.ts`), an installation token out, limited to the token's own `repository_id`, to the two write permissions, and only when the App is installed there and `job_workflow_ref` names Wachiman's reusable workflow | The run proves which repository it is; the token cannot reach any other repository; a stolen run cannot borrow another's identity | 0024 |
| 4 | Identity is cosmetic: if the exchange fails for any reason, the run posts as `github-actions[bot]` with its own `GITHUB_TOKEN` and says so in the job log | A review must never be lost because a Worker is down | 0024 |
| 5 | The user always pays the model with their own key or subscription; Wachiman bills nothing | Owner's decision (#134) | 0024 |
| 6 | The ledger Worker is the only server: spend, limits, token exchange, installation webhooks, the panel's data API. No new server; no Go or Rust | One deploy, one secret store, one OIDC verifier already written | 0024, reuses 0021 |
| 7 | The account table moves from the `ACCOUNTS_JSON` secret to a D1 database bound to the ledger; the per-account Durable Object keeps the money | Linking must be writable at runtime; relations (user, account, repository, installation) are a query, not a counter | 0025 (new), amends 0021/0022 |
| 8 | The panel (`wachiman-dev` Worker, wachiman.dev) reaches the ledger only through a Cloudflare Service Binding; it never binds D1 or the Durable Object | One owner of the data; the data API is not a public route | 0025 |
| 9 | App-mode repositories link on `installation` / `installation_repositories` and unlink on removal or uninstall; direct-mode repositories link with a one-time link code the account admin mints in the panel and the repository presents, OIDC-proven, on its first run | GitHub tells us which repositories an installation covers; a repository without the App cannot be checked through the App's user token, so its own OIDC-proven run is the proof | 0025 |
| 10 | Sign-in to the panel is the App's user authorization (GitHub App user access token); a person sees and administers the accounts they are a member of | No second identity provider; the App already exists | 0025 |
| 11 | Local mode: no ledger, no panel, no limit, no telemetry; an optional spend log on disk, never sent | Owner's decision (#134); ADR 0019 decision 5 | reuses 0019 |
| 12 | The local CLI ships as the npm package `wachiman` (free on npm as of 2026-11-07) with provenance, runs on Bun, and `wachiman skills install` replaces the skill-linking half of `scripts/install-local.sh` | The owner prefers a package install; npm with provenance fits ADR 0001's reopen clause; zero dependencies keep the audit surface as it is | 0026 (new), amends 0001, 0023 |
| 13 | Reopening ADR 0005 decision 5 and ADR 0010's App rejection is the owner's choice ahead of their reopen condition ("someone other than the owner installs the tool"), which is not met | Honesty: nobody else uses Wachiman yet | 0024 |

## Open questions

1. **Does the `pull_request` job of the reusable workflow keep `contents: read`?** Yes: the
   consumer's `GITHUB_TOKEN` checks out and reads the code. The App token is for posting only.
   Default if unanswered: unchanged permissions block, plus `id-token: write` (already required
   by #129).
2. **Which GitHub call proves "the App is installed on this repository"?** Default: the
   `installations` table in D1 (fed by the webhooks); on a miss, one call to
   `GET /repos/{owner}/{repo}/installation` with the App JWT, result cached in the table.
   Unverified: that endpoint needs no permission beyond the App JWT (it is an App-level route).
3. **Which account receives an installation?** Default: if the installing user (`sender`) is a
   member of exactly one account, link there; otherwise the repositories wait as *pending* until
   the user assigns them in the panel. A pending repository is refused by `reserve` as today
   (`not_linked`).
4. **Can a direct-mode repository be linked by an admin check instead of a link code?** The
   App's user access token only reaches repositories where the App is installed (the token is the
   intersection of the App's and the user's access), so a repository without the App cannot be
   checked that way. Default: the link code. If a probe shows the user token can read
   `permissions.admin` on a repository without the installation, prefer the admin check and keep
   the code for automation.
5. **PKCS#1 to PKCS#8 for the App key.** GitHub downloads the private key as PKCS#1 PEM; WebCrypto
   `importKey("pkcs8", …)` wants PKCS#8. Default: convert once at setup with
   `openssl pkcs8 -topk8 -nocrypt` and store the PKCS#8 PEM as the Worker secret. Unverified
   until the first probe.
6. **npm publishing account and provenance.** Default: publish from this repository's release
   workflow with `npm publish --provenance` under a trusted publisher (OIDC), no long-lived npm
   token. Unverified: the owner's npm account and 2FA setup.
7. **Does `wachiman` on npm run under `npx`?** The engine uses Bun APIs (ADR 0002), so Node
   cannot run it. Default: document `bunx wachiman` and `bun add -g wachiman`; `npx` is listed
   as not supported.
8. **A local spend log on disk.** Default: off; `--spend-log` appends one JSON line per run
   under `~/.wachiman/spend.jsonl`, never read by anything but the user.

## Out of scope

- A hosted reviewer, a queue, or any run of the engine outside the consumer's Actions or the
  developer's machine.
- The owner's service seeing code, diffs, prompts, findings, pull request titles or bodies.
- Billing, invoices, a paid plan, or a key Wachiman owns.
- Telemetry, a ledger call, a panel or a daily limit in local mode.
- Autofix or any `contents: write` permission for the App.
- Enterprise concerns: SSO, roles beyond account admin and member, bulk linking, audit logs.
- A Marketplace listing.
- Changing what the model is asked or what a review contains.
- A Homebrew tap or compiled binaries (rejected alternatives in ADR 0026, not deferred work).

## Failures this must protect against

- **A stolen App private key.** The thief can mint installation tokens for every installation:
  `pull_requests: write` and `issues: write` on every repository, and read of pull request files
  through those. They cannot read repository contents (no `contents` permission) or push. The key
  is a Worker secret, never in git or a laptop; rotation is one App setting plus one secret.
- **A workflow in repository X mints a token for repository Y.** The exchange reads
  `repository_id` from the verified OIDC token and asks GitHub for a token limited to that id;
  the request body cannot name another repository.
- **A fork pull request.** Forks receive no OIDC token (ADR 0021), so no exchange; the run also
  has no key and does not review (ADR 0001 decision 6).
- **A workflow that is not Wachiman's reusable workflow asks for the App's identity.** The
  exchange checks `job_workflow_ref` against `niway-dev/wachiman/.github/workflows/review.yml@*`
  and refuses anything else; a consumer's own job cannot post as Wachiman.
- **The model sandbox reads the OIDC request token.** #129 keeps `ACTIONS_ID_TOKEN_REQUEST_*`
  out of the agent's environment (`CHILD_ENV_ALLOWLIST`) and refuses a non-Claude-Code provider
  when the variables exist; the exchange reuses the same in-process request. The installation
  token joins the same rule: it is never in the child environment.
- **The App is accidentally granted `contents`.** The exchange requests an explicit
  `permissions` subset, so the minted token never carries `contents` even if the App does; a
  test asserts the request body; a CI check reads the App's permissions through the API and
  fails if `contents` appears.
- **A panel user links a repository they do not administer.** App-mode links come from
  GitHub's own webhook; direct-mode links need a code minted by an account admin and presented
  by the repository's own OIDC-proven run. A code is single-use, expires in 24 hours and is
  bound to one account.
- **Local mode makes a network call to the ledger or wachiman.dev.** The local command builds
  no ledger client; a test runs `wachiman local` with a `fetch` and `curl` stub that throws on
  any host other than the model's.
- **The token exchange is down.** The run logs one line and posts as `github-actions[bot]`;
  the review is never lost.
- **A deleted installation keeps posting or spending.** `installation.deleted` and
  `installation_repositories.removed` unlink; the exchange refuses a repository that is not in
  the table.
- **A webhook forged by a stranger.** Every delivery is verified with the webhook secret
  (`X-Hub-Signature-256`) before it is read.
- **A user access token leaks from the panel.** Tokens are stored server-side only, expire in
  8 hours, and the session cookie is `HttpOnly`, `Secure`, `SameSite=Lax`.

## Acceptance criteria

Engine (`niway-dev/wachiman`, `src/`, `.github/workflows/review.yml`):

- [ ] With `app_identity: true` and `ledger_url` set, the run requests an OIDC token with the
      ledger's audience, calls `POST /v1/app/token`, and posts the review with the returned token;
      the comment's author is the App's bot user.
- [ ] With the exchange returning 5xx, a 403 or a timeout, `bun test` shows the run posting with
      `GITHUB_TOKEN` and the job log containing one line that names the fallback.
- [ ] `CHILD_ENV_ALLOWLIST` contains neither `ACTIONS_ID_TOKEN_REQUEST_*` nor the App token
      variable; a test asserts both.
- [ ] `wachiman local` with a stub that throws on any network call except the model finishes a
      review; the test proves no call to `ledger_url` or `wachiman.dev`.

Ledger (`ledger/`):

- [ ] `POST /v1/app/token` with a valid OIDC token for a linked, App-installed repository returns
      a token whose request body to GitHub contained `repository_ids: [<that id>]` and
      `permissions: { pull_requests: "write", issues: "write" }` and nothing else.
- [ ] The same route with `job_workflow_ref` not matching the reusable workflow returns 403.
- [ ] An `installation.created` delivery with a valid signature inserts the installation and
      links its repositories; `installation.deleted` removes them; a delivery with a bad signature
      returns 401 and writes nothing.
- [ ] `reserve` for a repository whose link was removed returns 403 `not_linked`.
- [ ] `wrangler d1 migrations apply` creates the tables of ADR 0025 and an import script loads
      the former `ACCOUNTS_JSON` with no change to `reserve` and `settle` behaviour (the existing
      route tests pass).

Panel (`wachiman-private/apps/web`):

- [ ] Sign-in through the App's user authorization shows the user's accounts; the panel has no
      D1 or Durable Object binding in its `wrangler.jsonc`, only a `services` entry for
      `wachiman-ledger`.
- [ ] "Mint link code" shows a code; a run in the target repository with that code links it and
      the panel shows the repository with source `code`.

CLI:

- [ ] `bunx wachiman local --help` works from a directory without a clone;
      `bun add -g wachiman && wachiman skills install` installs the two skills;
      `npm view wachiman` shows a provenance attestation.

---

## Detail

### 1. The three modes side by side

| | Direct | GitHub App | Local |
| --- | --- | --- | --- |
| Where the engine runs | Consumer's Actions | Consumer's Actions | Developer's machine |
| Who pays the model | Consumer's `ANTHROPIC_API_KEY` | Consumer's `ANTHROPIC_API_KEY` | Developer's Claude account |
| Who reads the code | Consumer's `GITHUB_TOKEN` | Consumer's `GITHUB_TOKEN` | The clone |
| Comment author | `github-actions[bot]` | Wachiman (App bot user); falls back to `github-actions[bot]` | Nobody; terminal, Markdown or JSON |
| Ledger | Optional (`ledger_url`) | Optional, linked automatically | Never |
| Panel | Repository linked by code | Repository linked by installation | Never |
| What the owner's service receives | Repository id, run id, dollars (#129) | The same, plus installation events and the exchange request | Nothing |

The App mode is `direct` plus one caller input, `app_identity: true`, which only has an effect
when `ledger_url` is set (the exchange lives there). Everything else in the caller is the same
file. The engine chooses the posting token once, before the first model call, and keeps it out
of the agent's environment.

This is the shape of [Pullfrog](https://github.com/apps/pullfrog) (runs in your Actions, your
key, a short-lived installation token for identity; summary at
[everydev](https://www.everydev.ai/tools/pullfrog)) and of
[claude-code-action's App setup](https://raw.githubusercontent.com/anthropics/claude-code-action/main/docs/setup.md)
(OIDC to App token exchange, `id-token: write`). PR-Agent offers CLI, Action, App and Docker as
four installs of one engine ([pr-agent](https://github.com/Codium-ai/pr-agent)); Renovate offers
the hosted App or self-hosting of the same code
([running options](https://github.com/renovatebot/renovate/blob/main/docs/usage/getting-started/running.md)).
Wachiman takes the PR-Agent shape for the engine and the Pullfrog shape for the App, and
rejects the Renovate hosted shape because it would put the owner's service in front of the code.

### 2. App permissions and events (decision 2)

Checked against GitHub's
[permissions required for GitHub Apps](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps)
on 2026-11-07:

| Call the run makes with the App token | Permission |
| --- | --- |
| `POST /repos/{o}/{r}/pulls/{n}/reviews` (the review) | Pull requests: write |
| `POST /repos/{o}/{r}/pulls/{n}/comments` (inline finding) | Pull requests: write |
| `POST /repos/{o}/{r}/issues/{n}/comments` (notice, answer) | Issues or Pull requests: write |
| Thread replies (`pulls/comments/{id}/replies`) | Pull requests: write (same family; unverified individually) |

`metadata: read` is mandatory on every App. No `contents`: the compare endpoint and the contents
API need it, and the run keeps using its own `GITHUB_TOKEN` for them, as today. `issues: write`
is taken although `pull_requests: write` may cover issue comments on pull requests, because the
docs page marks that endpoint as needing more and the cost is nil.

**What this does and does not guarantee.** `pull_requests: read` (implied by write) can list a
pull request's files with their patches. So a token the exchange mints *could* read a diff. The
guarantee is therefore not "the token cannot see code" but: the Worker never calls GitHub with
the minted token (it returns it and forgets it), never stores it, receives no pull request or
push event, and has no `contents` permission at all. The owner would have to change the Worker's
public code to see a diff, and the consumer can read that code (ADR 0021 decision 7).

Events: `installation` and `installation_repositories` are delivered to every App and cannot be
unsubscribed
([webhook events](https://docs.github.com/en/webhooks/webhook-events-and-payloads)); nothing
else is subscribed. The webhook URL is `POST /v1/app/webhook` on the ledger Worker.

### 3. The token exchange (decisions 3 and 4)

Route: `POST /v1/app/token`, bearer = the run's OIDC token with the ledger's audience (the same
token #129 uses for `reserve`). Steps, in the Worker:

1. `verifyGithubToken` as today (signature, `iss`, `aud`, `nbf`, `exp`).
2. `job_workflow_ref` must match `niway-dev/wachiman/.github/workflows/review.yml@refs/tags/v*`
   (or `@<sha>` once immutable releases are on, PR #38 open question 1). Otherwise 403
   `wrong_workflow`.
3. `event_name` must be `pull_request` or `issue_comment`; `pull_request_target` is refused.
4. Look up `repository_id` in the `installations` table; if absent, open question 2. If still
   absent, 403 `not_installed`.
5. Sign an App JWT (RS256, `iat`−60 s, `exp`+9 min, `iss` = App id) with the PKCS#8 key from the
   Worker secret, through `crypto.subtle` only (no library, ADR 0002's rule carried to the
   Worker).
6. `POST /app/installations/{installation_id}/access_tokens` with
   `{ repository_ids: [repository_id], permissions: { pull_requests: "write", issues: "write" } }`
   ([installation access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app):
   the body can limit both; the token lives one hour).
7. Return `{ token, expires_at, bot_login }`. Nothing is stored; one log line without the token.

The engine calls the exchange once, before `reserve`, with a 10-second timeout. Any non-200,
timeout or malformed answer selects `GITHUB_TOKEN` and logs `app identity unavailable (<reason>);
posting as github-actions[bot]`. The review's hidden footer records which token posted, so the
re-review logic (ADR 0011) can find earlier comments by either author.

Why fall back rather than fail: a daily limit is money, so #129 fails closed; identity is a name
on a comment, so losing it costs nothing. Argument against the fallback: a reader sees two
authors on one pull request after an outage. Accepted; the footer names the reason.

What the exchange refuses to be: a general token service. It mints one token shape for one
workflow; `jsiebens/gh-app-token-service` is the counter-example recorded in PR #38 (no audience
check, owner-only claim, full-permission token), and `octo-sts` the reference for the
validations.

### 4. The account table (decisions 7 to 10)

Tables in D1 (schema, not SQL; the ADR 0022 concepts kept, with `repository_id` as the key):

- `organizations (id, name)`; `accounts (id, name, organization_id?, limit_usd)`: as ADR 0022.
- `repositories (repository_id PK, full_name, account_id?, limit_usd?, link_source: app|code,
  installation_id?, linked_at)`: `account_id` null means pending.
- `tags (organization_id, name)`, `repository_tags (repository_id, tag)`: as ADR 0022.
- `installations (installation_id PK, github_account_id, github_account_login, installed_by_user_id,
  account_id?, created_at)`.
- `users (github_user_id PK, login)`; `memberships (github_user_id, account_id, role: admin|member)`.
- `link_codes (code_hash PK, account_id, minted_by, expires_at, used_by_repository_id?)`.

`reserve`, `settle` and `today` replace `parseAccounts(env.ACCOUNTS_JSON)` with one D1 query by
`repository_id`; the Durable Object per account is unchanged and still holds the money. A
one-time import turns the current `ACCOUNTS_JSON` into rows.

Linking flows:

- **Installation created / repositories added:** insert the installation; for each repository,
  insert or update the row with `link_source: app`. Account assignment per open question 3.
- **Repositories removed / installation deleted:** set `account_id` to null and `link_source`
  to null for those rows (history in the Durable Object stays; ADR 0022 decision 4).
- **Link code (direct mode):** an account admin mints a code in the panel; the consumer sets it
  as the caller input `ledger_link_code` for one run (or a repository secret); the engine sends
  it with its first `reserve`; the ledger, with the OIDC-verified `repository_id`, links the
  repository, burns the code, and the run proceeds. The input is then removed by the consumer;
  a used code on a later run is ignored.
- **Sign-in:** the panel runs the App's web application flow
  ([user access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app):
  `state` check, 8-hour token, optional refresh). The panel sends the GitHub user id to the
  ledger over the Service Binding; the ledger answers with the accounts of that user's
  memberships. The first user to sign in with no membership gets an account created for them.

The panel never binds D1 or the Durable Object. Cloudflare's
[Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
let one Worker call another without a public URL (the target must be on the same account);
a Durable Object class from another Worker is reachable by naming `script_name` in the binding
([wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)),
which is exactly what the panel must *not* do, because then two Workers would own the data.
Assumption to confirm: `wachiman-dev` and `wachiman-ledger` are in the same Cloudflare account.

### 5. Local mode (decision 11)

Unchanged from ADR 0019 and `docs/local-review.md`. The local command has no ledger client, no
App client and no panel; the spend log, if enabled, is a file. The acceptance test is a network
stub that throws on every host except Anthropic's.

### 6. The local CLI as a package (decision 12)

`package.json` is renamed to `wachiman` (free on npm as of 2026-11-07, `npm view wachiman` →
404). `bin` keeps both `wachiman` and `agent-review`. `files` lists `src/`, `skills/`,
`bunfig.toml`, `templates/` and the licence. `wachiman skills install [--dir <path>]` copies
(not links) `skills/wachiman-review` and `skills/wachiman-audit` into `~/.agents/skills` and every
Claude config directory, with the same `~/.wachiman` guard the script has;
`wachiman skills uninstall` removes what it installed. `scripts/install-local.sh` stays one
release for contributors who run from a clone, then goes.

The release workflow publishes on each release-please tag with provenance through npm's trusted
publishing (OIDC from Actions; no npm token in secrets). Unverified: the provenance and trusted
publisher steps, and the owner's npm account; see open question 6.

Why not compiled binaries plus Homebrew: see ADR 0026.

## Sources

Checked 2026-11-07 unless marked:

- GitHub, permissions required for GitHub Apps:
  <https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps>
- GitHub, webhook events and payloads (`installation`, `installation_repositories`):
  <https://docs.github.com/en/webhooks/webhook-events-and-payloads>
- GitHub, generating an installation access token (body limits, one-hour lifetime):
  <https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app>
- GitHub, generating a user access token (web flow, 8 hours, intersection of permissions and
  repository access):
  <https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app>
- GitHub, generating a JWT for a GitHub App (RS256, 10 minutes). **Not fetched**; stated from
  memory:
  <https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app>
- Cloudflare, Service bindings:
  <https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/>
- Cloudflare, Wrangler configuration (Durable Object `script_name`, D1 bindings):
  <https://developers.cloudflare.com/workers/wrangler/configuration/>
- Cloudflare, D1 overview. **Not fetched**: <https://developers.cloudflare.com/d1/>
- npm, generating provenance statements / trusted publishing. **Not fetched**:
  <https://docs.npmjs.com/generating-provenance-statements>
- Pullfrog: <https://github.com/apps/pullfrog>, <https://www.everydev.ai/tools/pullfrog>
- claude-code-action setup:
  <https://raw.githubusercontent.com/anthropics/claude-code-action/main/docs/setup.md>
- PR-Agent: <https://github.com/Codium-ai/pr-agent>
- Renovate running options:
  <https://github.com/renovatebot/renovate/blob/main/docs/usage/getting-started/running.md>
- PR #38 research (octo-sts, jsiebens/gh-app-token-service, the claude-code-action v1.0.94 flaw):
  <https://github.com/niway-dev/wachiman/pull/38>
