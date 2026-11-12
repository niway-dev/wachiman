# ADR 0037: The Actions review can run on a Claude Code subscription token

- **Status:** proposed 2026-11-12; implemented by the pull request that adds this record.
  Not yet proven with a real token: see "Consequences" and the pull request's "Not proven".
- **Date:** 2026-11-12
- **Relates to:** [ADR 0019](0019-a-review-core-behind-source-and-sink-ports-and-a-local-subscription-mode.md)
  decisions 4 and 6, [ADR 0001](0001-distribution-and-trust.md) (the key reaches the child only
  through an allowlist).
- **Numbering:** 0036 is the latest record on `main` at the time of writing; no open pull request
  uses 0037.

## Context

The Actions review authenticates with `ANTHROPIC_API_KEY`, a Console key billed per token. The
owner deactivated that key for cost reasons and wants the automatic reviews to run on their own
Claude subscription instead.

Anthropic documents a route for exactly this ([authentication](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token),
[GitHub Actions](https://code.claude.com/docs/en/github-actions)): `claude setup-token` prints a
one-year token that can only make model requests, and `claude -p` reads it from
`CLAUDE_CODE_OAUTH_TOKEN`. In `claude -p`'s credential order an `ANTHROPIC_API_KEY` in the
environment outranks that token ([precedence](https://code.claude.com/docs/en/authentication#authentication-precedence)),
and bare mode does not read it.

ADR 0019 decision 4 added a `subscription` mode for the **local** command. That mode exists for a
person's own laptop: it refuses to start when a key is set, passes `USER`, isolates the config
directory and never reads or forwards OAuth tokens or `~/.claude` contents. It is not a fit for CI,
and this record does not change it.

A personal Pro or Max account is under Anthropic's Consumer terms (training setting, retention);
a Team or Enterprise account is under commercial terms (wording as in ADR 0019).

## Decision

1. **Selection by presence, and the token wins.** In GitHub mode, if `CLAUDE_CODE_OAUTH_TOKEN`
   is non-empty the child gets it and never `ANTHROPIC_API_KEY`, even when both are set. With only
   the key, behaviour is unchanged. With neither, the run fails as before and the message names
   both variables. There is no new workflow input.
2. **No automatic fallback from the subscription to the API key.** A call the subscription
   refuses (plan access, usage limit, rejected token, rate limit) is reported through the existing
   `on_provider_unavailable` path with a message that fits the credential: it names the
   `CLAUDE_CODE_OAUTH_TOKEN` secret and `claude setup-token`, never the `ANTHROPIC_API_KEY` secret.
3. **A third auth mode in the provider, `oauth-token`,** distinct from the local `subscription`
   mode. Its child allowlist gains `CLAUDE_CODE_OAUTH_TOKEN` and loses `ANTHROPIC_API_KEY`. The
   local mode's extras (`USER`, the isolated config directory, the non-essential-traffic switches,
   `--no-session-persistence`, the refusal of a key) do not apply and are unchanged for the local
   mode. The engine never reads `~/.claude`, the keychain or the token's content beyond passing
   the variable to the unmodified `claude` binary, and never calls the API with it.
4. **The leak check covers the token's exact value.** A review that contains the token is
   refused like one that contains the key. `KEY_SHAPE` (`sk-ant-[a-z0-9]+-[A-Za-z0-9_-]{20,}`) is
   not loosened. Finding: it would match a token shaped `sk-ant-oat01-…`, but Anthropic does not
   document the shape of a `setup-token` value, so the exact-value comparison is the guarantee and
   the shape match is a bonus, not something to rely on.
5. **A subscription run's cost is an estimate.** `total_cost_usd` on a subscription is an
   API-price equivalent (ADR 0019 decision 6). Budgets and the per-PR ceiling keep using it as a
   guard. The `wachiman-cost` JSON gains an `auth` field. The footer, the "paused" notice and the
   log say it is an API-price estimate and not a bill. The estimate note sits **before** the dollar
   figure, so `readAutoCost` and the other signed-footer readers parse old and new footers alike.
6. **The reusable workflow accepts either secret.** `ANTHROPIC_API_KEY` becomes `required: false`;
   a new optional secret `CLAUDE_CODE_OAUTH_TOKEN` is declared and passed as an environment
   variable in every step that passes the key. Existing key-only callers behave exactly as before.
   The caller templates carry a commented alternative line.

## Relation to ADR 0019 decision 4

Decision 4 is about the **local** mode and about **collecting a person's sign-in**: the engine must
not read or forward the credentials a person's `claude` stored. This record adds forwarding **one
variable the user minted on purpose for CI**, from a GitHub secret, to the child. The engine learns
nothing about the sign-in itself. ADR 0019's reopen condition (Anthropic's terms for subscription
use of the binary change) is therefore not what reopens this record.

## Alternatives rejected

- **Automatic fallback to the API key when the subscription refuses.** It would turn a usage-limit
  stop into a silent per-token bill, which is the cost the owner switched off. The refusal is
  reported and the owner decides.
- **An explicit `auth` workflow input.** It adds a second source of truth next to the secrets the
  caller already passes; a mismatch (`auth: oauth` with no token) would be one more way to fail.
  Presence of the secret already says which one the caller wants.
- **Reading the laptop's sign-in (keychain, `~/.claude`).** CI has no laptop, and doing it would
  contradict ADR 0019 decision 4.

## Consequences

- The token is tied to **one person's subscription** and shares that plan's usage limits with that
  person's own Claude use: a busy day of reviews can use up their interactive allowance, and the
  reverse.
- **Anyone who can change the workflow on a branch of the same repository can read the secret**,
  exactly as with the key.
- Anthropic recommends an API key for a secret shared across an organization's repositories; the
  token is meant for the person's own repositories.
- A personal plan is under Consumer terms (training setting, retention); see Context.
- The run's dollar figures are estimates. A subscription is not billed per call, and the ceiling
  stays a work bound expressed in estimated dollars.
- **Unproven until a real run:** that `claude -p` reports `total_cost_usd` with this token, and the
  text a subscription usage limit produces. The classifier treats an unrecognized refusal as a
  generic rejection and the engine posts the standard "provider unavailable" notice.
- A token lasts a year, then reviews stop with a rejected-token notice until a new one is made.

## Non-goals

- Changing the local mode, the Codex provider, the daily spend limit or the budget defaults.
- Collecting, refreshing or validating the token: the engine only forwards it.
- Calling Anthropic's API with the token.
- Any automatic choice between the two credentials beyond "the token wins if present".

## Reopen if

- Anthropic changes how `claude -p` treats `CLAUDE_CODE_OAUTH_TOKEN` (precedence, bare mode,
  what the token can do, or its terms for CI use): revisit decisions 1 and 3.
- A real run shows `claude -p` does not report `total_cost_usd` with the token: drop the budget
  and ceiling guard for this mode and bound by work only, as ADR 0019 reopen condition 3 says for
  the local mode.
- The owner wants a fallback or a spend cap across both credentials: that is a new decision with
  its own record.
