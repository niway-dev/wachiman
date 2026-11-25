# ADR 0065: Wachiman's services never hold a model credential

- **Status:** proposed 2026-11-25, for the owner's review. No code changes with this ADR.
- **Date:** 2026-11-25
- **Spec:** [credential modes](../specs/2026-11-25-credential-modes-design.md)
- **Relates to:** [ADR 0001](0001-distribution-and-trust.md) (the key reaches the model process only
  through an allowlist), [ADR 0037](0037-the-actions-review-can-run-on-a-claude-code-subscription-token.md)
  (the subscription token), [ADR 0064](0064-new-review-behavior-is-opt-in-per-repository-and-off-by-default.md)
  (opt-in behavior).

## Context

A review needs a model credential: an API key or a subscription token. Today it is a GitHub
secret, and anyone who can push a branch can read it. Teams asked how to share one credential
without handing it to every developer.

Competitors solve this by holding the credential themselves. Pullfrog keeps connected keys
encrypted in its own store and releases them to an Actions run after an OIDC check. That makes the
vendor the place where many customers' working credentials sit together, which is what an attacker
wants to breach, and an encrypted store does not help when the code allowed to decrypt it is
compromised.

Wachiman charges nothing for inference and pays for none: the customer runs the review with their
own credential. The owner's stated priority is that a breach of Wachiman must not expose
customers.

## Decision

1. **No Wachiman service receives, stores or has permission to fetch a customer's model
   credential.** This covers the spend ledger, any website or dashboard, and any future service.
   No hosted vault, no form that accepts a key, no proxy Wachiman operates.
2. **The credential stays with the provider or with the customer.** The supported places are a
   GitHub secret, provider federation (no stored credential), the customer's secret manager, a
   broker operated by the customer or a broker vendor, or the customer's own machine.
3. **Federation is the recommended team option and is built first, Anthropic first.** When a
   federation rule and a stored key are both passed, the run fails before any model call, because
   Claude Code would use the key and silently ignore the rule.
4. **Wachiman services may hold identifiers,** such as a repository ID, a rule ID or a manager's
   project name, and never a value that authenticates to a model provider.

## Alternatives rejected

- **A hosted vault, Pullfrog style.** Simplest setup for the customer, and it makes Wachiman the
  custodian of every customer's credential. Rejected by decision 1.
- **A vault Worker that customers deploy from published code.** It keeps custody with the customer,
  but asks each company to run infrastructure for a review tool. Secret managers already release
  secrets to GitHub OIDC identities, so connecting to them through Varlock covers the same case.
- **A hosted proxy that injects the credential.** It keeps the key away from the runner, but the
  key and the review traffic would pass through Wachiman. A proxy is acceptable only when the
  customer or a broker vendor runs it.

## Consequences

- A breach of Wachiman's services yields no customer credential. Customers still protect their
  own secret store, CI and machines; [credentials.md](../credentials.md) lists who is responsible
  for what.
- Setup is harder than pasting a key into a vendor's form. The documentation has to carry that
  cost, with one tested setup per provider and per secret manager.
- Spending is not prevented: anyone allowed to start a run can spend. Budgets, the per-pull-request
  ceiling, provider spend limits and the `operator` input bound it.
- The engine gains a federation mode that adds three variables to the model process's allowlist,
  and keeps blocking custom endpoints until a separate decision.

## Non-goals

- Central revocation of people, or a role registry. GitHub permissions decide who commands
  Wachiman for now.
- Paying for or reselling inference.
- Making a subscription shareable across a team; that is a question for the provider's terms.

## Reopen when

- A provider offers delegated, scoped credentials that Wachiman could hold without being able to
  spend or extract the customer's own access, so holding them would expose nothing; or
- customers repeatedly choose not to adopt Wachiman because every option needs a setup step, and a
  custody design is found whose breach would not expose working credentials.
