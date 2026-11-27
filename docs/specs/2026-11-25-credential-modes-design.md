# Credential modes: where the review's model credential lives

- **Status:** draft for the owner's review, 2026-11-25. Nothing in it is built.
- **Reader page:** [credentials.md](../credentials.md), the consumer-facing draft of the same plan.
- **ADR:** [ADR 0065](../adr/0065-wachiman-services-never-hold-a-model-credential.md) (new).

## Summary (one minute)

A team that shares one model credential in a repository secret gives it to everyone who can push
a branch. This spec offers the team other places to keep that credential, and promises that
Wachiman's own services never hold it: no hosted vault, no key upload, no proxy run by Wachiman.

Build order:

1. **This documentation,** so the options and their limits are stated before any of them ships.
2. **Provider federation, Anthropic first:** the review gets a short-lived token from Anthropic in
   exchange for GitHub's signed identity, and no key is stored anywhere. Wanted before the official
   release.
3. **`operator: maintain`:** a permission level instead of one login, so a team can command
   Wachiman.
4. **Secret manager connection through Varlock,** for subscription tokens and providers without
   federation.
5. **`wachiman watch`,** reviews posted from a machine the customer controls.
6. **A credential broker,** when one is verified to work with the engine.

## Decisions

| # | Decision | Why | ADR |
| --- | --- | --- | --- |
| 1 | Wachiman's services never receive, store or have permission to fetch a customer's model credential. No hosted vault | A breach of Wachiman must yield no customer credential; concentrating many customers' keys is the target an attacker wants | 0065 (new) |
| 2 | Six options, each labelled available or planned: repository secret, provider federation, secret manager, broker, `watch`, local | Teams differ in whom they trust and which provider they pay | — |
| 3 | Provider federation is built first, Anthropic first, on the workflow that already requests an OIDC token (`wachiman-platform.yml`) | It removes the stored secret entirely; that workflow already grants `id-token: write` for the ledger | 0065 |
| 4 | When a key or a subscription token is passed with a federation rule, the run fails before any model call | Claude Code prefers `ANTHROPIC_API_KEY` and ignores federation without saying so; a token would spend on a plan nobody chose for this mode | 0065 |
| 4a | With federation or a secret manager, the workflow refuses `claude_code_version`, `claude_code_sha256` and `bun_version` overrides | The rule pins the workflow commit, not its inputs; those inputs choose the binary that holds the credential | 0065 |
| 4b | The docs say the provider-side spend limit is the only limit a teammate cannot edit; Wachiman's budgets and `operator` are caller inputs a pusher changes for their own branch's run | A federation rule checks which workflow runs, not its inputs | — |
| 5 | The documented defence against a compromised release is pinning the reusable workflow's SHA in the federation rule or the secret manager's conditions | The provider or manager, not Wachiman, then refuses a release the customer has not approved | — |
| 6 | `operator` accepts `maintain` (GitHub maintain or admin, checked per command) besides a login; a Wachiman role registry is later and not designed here | A team must not depend on one login; GitHub already knows who maintains | amends the `operator` input; ADR at build time |
| 7 | Secret managers are reached through Varlock plugins, not one integration per manager and not a vault Wachiman publishes for customers to deploy | Managers already gate access on GitHub OIDC; a company will not stand up infrastructure for a review tool | — |
| 8 | A broker is supported only when run by the customer or a broker vendor, never by Wachiman | Otherwise the credential passes through Wachiman again (decision 1) | 0065 |
| 9 | Subscription options are documented "for your own use"; for teams the docs point to the API with federation and a workspace spend limit | The consumer terms forbid sharing an account; Anthropic recommends an API key for organizations | — |
| 10 | Every option is opt-in by its own inputs; a caller that changes nothing keeps today's behavior | [ADR 0064](../adr/0064-new-review-behavior-is-opt-in-per-repository-and-off-by-default.md) | reuses 0064 |

## Open questions

1. **Release date.** Federation is wanted before the official release; the date decides whether
   item 2 ships alone or with item 3.
2. **First federation providers beyond Anthropic.** OpenAI's API has federation, but Codex is not a
   supported Actions provider yet and its federation path is beta.
3. **`watch` or secret manager first** (items 4 and 5).
4. **Default of `operator`.** Keep a login as the default, or make `maintain` the default for new
   installs made by `wachiman init`.
5. **Custom model endpoint.** A broker or gateway needs the engine to pass `ANTHROPIC_BASE_URL` or
   `HTTPS_PROXY`, which the child allowlist blocks today on purpose
   (`src/providers/claude-code.ts`). Unblocking it needs its own decision.
6. **Token lifetimes in a long review.** The model process gets one identity token file and
   cannot mint another (AC1). If the identity token or the access token expires before the job
   ends (30 minutes, calls up to `call_timeout_s`), later calls are refused. To settle when
   building: GitHub's identity token lifetime, whether Claude Code re-reads the file, and whether
   the workflow refreshes it or the docs require a minimum rule lifetime.
7. **Subscription terms.** Anthropic's consumer terms and its legal-and-compliance page read
   differently about hosted use of a subscription. Unresolved; only Anthropic can settle it.

## Out of scope

- A hosted vault, a key upload form, or a proxy operated by Wachiman (decision 1).
- The GitHub App and comment identity: designed separately (wachiman pull request 210).
- A Wachiman role registry and central revocation of people.
- `wachiman explain` over a whole repository.
- The website page for this feature; it is written after the features exist.

## Detail

### Today

- The Actions review takes `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` as a secret
  ([ADR 0037](../adr/0037-the-actions-review-can-run-on-a-claude-code-subscription-token.md)).
- The engine passes the model process an allowlist of variables (`CHILD_ENV_ALLOWLIST` in
  `src/providers/claude-code.ts`): the key, the config directory and a few system variables, plus
  the OAuth token in that mode. Federation variables are not on it.
- `wachiman-platform.yml` (formerly `review-platform.yml`) is `review.yml` plus `id-token: write`, used today only to enroll in the
  spend ledger.
- `operator` is one login, required by every job.

### Item 2: provider federation (Anthropic)

How it runs:

1. The caller uses `wachiman-platform.yml` (the deprecated `review-platform.yml` alias is not
   supported for federation: its `job_workflow_ref` differs, so a rule pinned to the new name
   refuses it, and the docs say to move first), grants `id-token: write`, and passes two inputs:
   `anthropic_federation_rule_id` and `anthropic_organization_id`. It passes no model secret.
2. A workflow step requests GitHub's OIDC token with a fixed audience, not one the caller can set,
   and writes it
   to a file outside the checkout, readable only by the runner user.
3. The engine adds `ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID` and
   `ANTHROPIC_IDENTITY_TOKEN_FILE` to the model process's allowlist, only in this mode.
4. Claude Code exchanges the identity token for an access token and makes the calls.
5. The step removes the file when the job ends.

Customer setup, in the Claude Console: a workspace for reviews with a spend limit, GitHub as an
issuer, a service account, and a federation rule for that workspace whose conditions name
the fixed audience, `repository_id` and `job_workflow_ref` at the pinned SHA, all three required.
`wachiman init` can print those conditions for the repository it runs in. Whether federation mode
should also refuse a non-empty `ledger_url`, so the defence does not rest on the customer's rule,
is decided when building.

Acceptance criteria:

- **AC1.** A caller with the two inputs, `id-token: write` and no model secret produces a review.
  The model process's environment holds the three federation variables and no
  `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `ACTIONS_ID_TOKEN_REQUEST_URL` or
  `ACTIONS_ID_TOKEN_REQUEST_TOKEN`: the model process can use the identity token it was given but
  cannot mint new ones.
- **AC2.** A caller that passes a key or a token together with the federation inputs fails before
  any model call, with a message naming both.
- **AC3.** The identity token file is outside the checkout, mode 0600, and gone after the job. A
  test shows the agent's read tools cannot open it, including through a symlink in the head.
- **AC4.** The output scan that blocks a comment containing the key also blocks the identity token
  and any access token the job can see.
- **AC5.** `credentials.md`, `configuration.md` (inputs), `install.md` and `SECURITY.md` describe
  the mode; the draft banner on `credentials.md` is updated for this option.
- **AC6.** One review on a real Console organization, with the rule pinned to the release SHA, is
  recorded as evidence. A second run from a caller pointing at another workflow is refused by
  Anthropic. A third run longer than the identity token's lifetime finishes, or fails
  with a message that names the expired token.
- **AC7.** The federation identity token's audience is a constant in the workflow. The setup page
  tells the customer to put that audience in the rule, so a token minted for `ledger_url` (a host
  the caller chooses) is refused by Anthropic. A test checks that the two audiences can never be
  equal.
- **AC8.** A federation caller that passes `claude_code_version`, `claude_code_sha256` or
  `bun_version` fails before downloading anything, with a message naming the input.

Not proven yet: whether the Claude Code version the workflow pins reads the federation variables
under `claude -p` with the flags the engine uses. It is the first thing to check when building.

### Item 3: `operator: maintain`

`operator` accepts a login, as today, or the word `maintain`. With `maintain`, each command checks
the commenter's permission through GitHub's API and accepts `maintain` and `admin`. Bots are never
accepted. The automatic review is unaffected. Criteria are written in the item's own issue.

### Item 4: secret manager connection

The workflow runs the review under Varlock, which loads the credential from the customer's manager
using a Varlock plugin and GitHub OIDC authentication where the manager supports it. Wachiman
documents one setup per manager it has verified, including whether the manager can condition on
`job_workflow_ref`, not only on the repository. The limit is stated plainly: the review process
holds the real credential; masking prevents accidents, not theft.

### Item 5: `wachiman watch`

A long-running command on the customer's machine or container: polls GitHub, reviews with the local
sign-in or key, posts with a GitHub token scoped to the watched repositories. Hardening to design
and test: no inbound ports, an image pinned by signed digest, read-only model tools, no pull
request code executed, a test that a symlink in the head cannot reach the Claude configuration
directory, the output scan before posting, and a dashboard bound to `localhost`. Gets its own spec.

### Item 6: credential broker

Candidates: Infisical Agent Vault and Aembit's agent proxy. Before it is offered: open question 5
decided, a broker shown to work with a Claude subscription token or documented as API-key only,
and the traffic exposure (the broker sees the code sent to the model) written on the reader page.

## Competitors (2026-11)

- **Pullfrog** keeps connected keys encrypted in its own store and releases them to an Actions run
  after an OIDC check, or uses GitHub secrets. Its documentation does not say who can decrypt them.
  Decision 1 rejects this model for Wachiman.
- **claude-code-action** supports Anthropic federation inputs and has no roles beyond write access.
- **CodeRabbit, Greptile, Graphite** run the model on the vendor's key and manage roles centrally.
  That is the paid, vendor-held model Wachiman does not offer.

## References

- Anthropic: [workload identity federation](https://platform.claude.com/docs/en/manage-claude/workload-identity-federation),
  [GitHub Actions provider](https://platform.claude.com/docs/en/manage-claude/wif-providers/github-actions),
  [workspaces](https://platform.claude.com/docs/en/manage-claude/workspaces),
  [Claude Code authentication](https://code.claude.com/docs/en/authentication),
  [GitHub Actions for organizations](https://code.claude.com/docs/en/github-actions#set-up-for-an-organization),
  [consumer terms](https://www.anthropic.com/legal/consumer-terms),
  [legal and compliance](https://code.claude.com/docs/en/legal-and-compliance).
- GitHub: [OIDC with reusable workflows](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-with-reusable-workflows),
  [using secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions),
  [secure use](https://docs.github.com/en/actions/reference/security/secure-use).
- OpenAI: [workload identity federation for GitHub Actions](https://developers.openai.com/api/docs/guides/workload-identity-federation/github-actions).
- Secret managers and brokers: [Varlock](https://varlock.dev/guides/secrets/),
  [Varlock Infisical plugin](https://varlock.dev/plugins/infisical/),
  [Infisical OIDC auth](https://infisical.com/docs/documentation/platform/identities/oidc-auth/general),
  [Infisical Agent Vault](https://infisical.com/platform/agent-vault),
  [Aembit agent proxy](https://docs.aembit.io/dev-guide/integration/agent-proxy/).
- Competitors: [Pullfrog security](https://pullfrog.com/docs/security),
  [claude-code-action security](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md).
