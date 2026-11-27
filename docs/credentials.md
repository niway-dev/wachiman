# Protecting the credential your reviews run on

> **Draft.** This page describes the credential options Wachiman offers and the ones it plans to
> offer. Each option says whether it is **available** today or **planned**. A planned option is
> not in any release yet, and its setup steps may change. The design and build order are in
> [the credential modes spec](specs/2026-11-25-credential-modes-design.md).

A Wachiman review calls an AI model, and that call needs a credential: an API key or a
subscription token. **The credential is always yours, it is used in your CI or on your machine,
and Wachiman's own services never receive it, store it or have permission to fetch it.** This
page helps you choose where the credential lives, so that the people who can run reviews are
not automatically the people who can take the credential.

## The problem in one example

An illustrative case: Pepito leads a team of eight developers. Paying per token for every review would be expensive,
so he buys one Claude plan and wants all the team's reviews to run on it.

The obvious setup is to save the plan's token as a repository secret. That works, but on GitHub
[anyone with write access to a repository can read its Actions secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions):
a developer pushes a branch whose workflow prints the secret, and the token is theirs. A
subscription token lasts a year, so a copied token can drain Pepito's plan until he notices and
revokes it.

The options below close that gap in different ways. None of them is free of trade-offs, so the
table after them says what each one protects against. (Running a team on one personal plan also
raises a question about the provider's terms; see
[Subscriptions and provider terms](#subscriptions-and-provider-terms).)

## Choose an option

| Option | Where the credential lives | Who can take it | Works with a subscription | Status |
| --- | --- | --- | --- | --- |
| [Repository secret](#1-repository-secret) | A GitHub secret | Anyone who can push a branch | Yes | Available |
| [Provider federation](#2-provider-federation-no-stored-secret) | Nowhere: the provider trusts GitHub's signed identity | Nobody gets a lasting credential; a run gets a short-lived one | No, API only | Planned, first |
| [Secret manager connection](#3-secret-manager-connection) | Your secret manager (Infisical, Bitwarden, 1Password, AWS…) | Whoever can change the code the authorized run executes | Yes | Planned |
| [Credential broker](#4-credential-broker) | A proxy you or a broker vendor operate | Nobody through the review; the broker's operators | Not verified | Planned, later |
| [Review on your machine (`watch`)](#5-review-on-your-machine-watch) | Your own machine | Whoever controls that machine | Yes | Planned |
| [Local only](#6-local-only) | Your laptop's Claude sign-in | You | Yes | Available |

A short way to choose:

- **You are alone, or you trust everyone who can push:** a repository secret. Use an account or
  key dedicated to CI, not the one you use every day.
- **A team on an API key:** provider federation. Nothing is stored anywhere, so there is nothing
  to copy.
- **A team on a subscription, or a provider without federation:** a secret manager connection,
  and later a credential broker when the review itself must never hold the credential.
- **The credential must never be on GitHub's runners at all:** review on your machine.

## 1. Repository secret

**Available.** The setup is in [install.md](install.md#review-on-a-claude-subscription) for a
subscription token and in the main tutorial for an API key.

What it protects: what GitHub protects. Secrets are not shown in the settings page, they are
masked in logs, and pull requests from forks do not receive them.

What it does not protect: anyone who can push a branch can change the workflow on that branch,
and that changed workflow runs with the secret
([SECURITY.md](../SECURITY.md#trust-assumptions)).

Use it when:

- you are the only person who can push, or you trust everyone who can;
- the credential belongs to an account or key used only by CI, so you can revoke it after a leak
  without losing your own access.

## 2. Provider federation (no stored secret)

**Planned, first.** Anthropic is the first provider; the others follow the same shape.

**Workload identity federation** means the model provider trusts GitHub to say which workflow is
running, instead of trusting a stored key. It works like this:

1. The review job asks GitHub for an **OIDC token**: a short document, signed by GitHub, that
   says which repository, branch, event and workflow file is running.
2. The job sends that document to the provider.
3. The provider checks GitHub's signature and compares the claims with a **federation rule** you
   configured once. If they match, it returns an access token that expires after the lifetime
   the rule sets (minutes to a day).
4. The review uses that access token. Once it expires, it is useless.

There is no key in GitHub, so there is no key to print. A developer who points the workflow at
other code on a branch gets a different identity from GitHub, the rule does not match, and the
provider refuses.

**What you pin in the rule.** The rule can require, among other claims:

- `aud`: the audience the token was minted for, which Wachiman fixes for federation;
- `repository_id`: your repository's numeric ID, which survives a rename;
- `job_workflow_ref`: the exact reusable workflow that runs, for example
  `niway-dev/wachiman/.github/workflows/wachiman-platform.yml@<commit SHA>` (the variant of the
  workflow that may request an OIDC token).

Pinning `job_workflow_ref` to a commit SHA you reviewed is your defence against a compromised
Wachiman release: a newer workflow, even a malicious one, does not match the rule and gets no
access. To upgrade, you add the new SHA on purpose. See
[GitHub's page on OIDC with reusable workflows](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-with-reusable-workflows).

**Providers.**

| Provider | Federation from GitHub Actions | Notes |
| --- | --- | --- |
| Anthropic (Claude API) | [Workload identity federation](https://platform.claude.com/docs/en/manage-claude/workload-identity-federation), [GitHub Actions guide](https://platform.claude.com/docs/en/manage-claude/wif-providers/github-actions) | Claude Console organizations only; an admin configures it. Not available for Pro or Max plans. |
| OpenAI API | [Workload identity federation for GitHub Actions](https://developers.openai.com/api/docs/guides/workload-identity-federation/github-actions) | The Codex CLI path is in beta. Codex is not yet a supported provider for the Actions review ([SECURITY.md](../SECURITY.md)). |
| Claude on Amazon Bedrock | An AWS IAM role trusted for GitHub OIDC | Not supported by the engine yet. |
| Claude on Google Vertex AI | Google Cloud workload identity federation | Not supported by the engine yet. |
| Azure AI Foundry | Microsoft Entra workload identity | The Codex CLI on Azure takes an API key only. |
| Google AI Studio (Gemini API) | None found | Use a secret manager connection. |

**Setting it up with Anthropic (planned flow).**

1. In the Claude Console, create a **workspace** for reviews. A workspace has its own spend
   limit, rate limits and usage report, so reviews cannot spend more than you allow and you can
   see what they cost. Archiving the workspace stops everything in it.
2. Add GitHub as an identity issuer, create a service account, and create a federation rule for
   that workspace whose conditions name the audience Wachiman documents, your `repository_id`,
   and the Wachiman `job_workflow_ref` at the SHA you pin. **All three are required:** without
   the audience, an identity token the engine mints for another purpose could be replayed.
3. In the caller workflow, call `wachiman-platform.yml`, pass the rule ID and the organization ID
   as inputs, and grant the job `id-token: write`. No secret is added.

What still holds:

- A teammate can still **use** the legitimate workflow and spend from the workspace. They cannot
  take a credential with them. **The workspace spend limit is the only limit they cannot edit.**
  Wachiman's budgets (`budget_usd`, `auto_budget_usd`), the model, and the `operator` input are
  inputs in the caller file, and on `pull_request` GitHub runs the caller file from the pull
  request's own branch. A teammate can raise those inputs on their branch and still match the
  rule, because the rule checks which workflow runs, not the inputs passed to it. Set the
  workspace limit to what you are willing to lose in a month.
- The short-lived access token is on the runner while the review runs. The engine passes it only
  to the model process and never executes code from the pull request
  ([SECURITY.md](../SECURITY.md#what-from-the-head-is-executed-and-what-is-read)).
- **If an `ANTHROPIC_API_KEY` is also present, Claude Code uses the key and silently ignores
  federation.** Wachiman will refuse to start when a key or a subscription token is passed together
  with federation, so a forgotten secret cannot
  undo the setup.

## 3. Secret manager connection

**Planned.** For a credential that has no federation: a subscription token, or a provider that
only issues keys.

The credential lives in a secret manager you already use. The review job proves who it is to the
manager, usually with the same GitHub OIDC token, and the manager releases the credential only to
a job that matches the conditions you set. Wachiman uses
[Varlock](https://varlock.dev/guides/secrets/) as the adapter layer: one configuration format with
plugins for Infisical, Bitwarden, 1Password, AWS Secrets Manager and others, so Wachiman does not
tie you to one manager.

```text
your secret manager ──(checks GitHub's OIDC identity)──▶ review job on GitHub's runner ──▶ model provider
              the credential never passes through Wachiman's services
```

What it protects:

- The credential is not stored in GitHub, so a teammate cannot read it from the repository or
  fetch it with a workflow of their own: the manager checks the identity and refuses. Whether a
  manager can match `job_workflow_ref` as well as the repository is checked for each manager
  before Wachiman lists it as supported. Infisical documents
  [OIDC authentication with claim conditions](https://infisical.com/docs/documentation/platform/identities/oidc-auth/general).
- You rotate or revoke the credential in one place for every repository.
- Varlock hides the value in the output it controls.

What it does not protect: **injecting a secret is not the same as making it unreadable.** The
review process receives the real credential in its environment. Hiding it in logs prevents
accidents, not theft: code that runs inside the authorized job can read it. That is why the
conditions must pin the exact workflow, and why the engine never runs pull request code.

## 4. Credential broker

**Planned, later.** For teams that need the review process itself never to hold the real
credential.

A **credential broker** is a proxy that holds the credential and adds it to requests on the way
out. The review gets a placeholder value and a short session. Its requests to the model go
through the proxy, which swaps the placeholder for the real credential and forwards them. The
real credential never enters the review's memory, so a compromised or tricked review cannot send
it anywhere. Examples: [Infisical Agent Vault](https://infisical.com/platform/agent-vault) and
[Aembit](https://docs.aembit.io/dev-guide/integration/agent-proxy/).

Trade-offs:

- **Someone has to run the proxy.** It runs in your infrastructure or the broker vendor's, never
  Wachiman's. If Wachiman operated it, the credential would pass through Wachiman again.
- **The proxy sees the review traffic,** including the code sent to the model. Choose an operator
  you would trust with that.
- **A placeholder still allows use.** Whoever holds a valid session can spend until it expires.
- **Not verified yet:** that a broker accepts a Claude subscription token, and how the engine
  routes model traffic through a proxy (today it blocks custom endpoints on purpose).

## 5. Review on your machine (`watch`)

**Planned.** For teams that do not want any model credential on GitHub's runners.

`wachiman watch` runs on a machine or container you control. It asks GitHub for new pull requests
and comments, reviews them with your own Claude sign-in or key, and posts the result. GitHub holds
no model credential at all.

How it is meant to stay safe:

- **No inbound ports.** It polls GitHub; nothing on the internet can connect to it.
- **Pull request code is read, never executed.** The model gets read-only tools.
- **A pinned image.** The container is referenced by a signed digest, not a moving tag.
- **An output check.** Every comment is scanned for the credential before it is posted, as the
  Actions review does today.
- **A local dashboard** on `localhost` shows what it reviewed and spent.

What you accept: the machine is now the thing to protect, and it must be running for reviews to
happen. Posting needs a GitHub token on that machine, scoped to the repositories it reviews.

## 6. Local only

**Available.** `wachiman local` reviews a change on your laptop with your own Claude sign-in and
posts nothing. See [local-review.md](local-review.md) and [on-your-machine.md](on-your-machine.md).

## What each option protects against

| Threat | Repository secret | Federation | Secret manager | Broker | `watch` |
| --- | --- | --- | --- | --- | --- |
| A teammate changes the workflow on a branch to print the credential | Exposed | Protected | Protected if the conditions pin the workflow | Protected | Protected |
| A copied credential is used elsewhere for months | Exposed | Protected: tokens expire | Exposed once copied | Protected | Exposed if the machine is breached |
| A malicious newer Wachiman release | Exposed with a moving tag | Protected by the SHA in the rule | Protected if the conditions pin the SHA | Partly: it can spend, not take | Protected by the pinned image |
| Wachiman's own services are breached | Not affected | Not affected | Not affected | Not affected | Not affected |
| A teammate spends through reviews on their own branch | Unbounded: they can take the credential | Bounded by the provider workspace limit only | Bounded only by limits on the provider account | Bounded by the broker's limits | Bounded by the machine's own budgets |

The fourth row is the point of the whole design: Wachiman's services hold no customer
credential, so breaching them yields none.

The last row is why provider-side limits matter. Wachiman's budgets live in the caller file, and
anyone who can push a branch can edit that file for their own pull request's run. They bound
honest mistakes, not a teammate who wants to spend.

## Who may command Wachiman

Protecting the credential bounds who can **take** it. Who may **command** a run is decided by the
`operator` input. Like every caller input, a teammate can edit it on their own branch, so it
decides who commands Wachiman in normal use and does not replace a provider-side spend limit.

- **Today:** the `operator` input names one GitHub login. Only that person can request a review
  with `/wachiman review`, resolve threads and approve a budget; `askers: write` lets other
  collaborators ask questions up to `ask_ceiling_usd`
  ([configuration.md](configuration.md#inputs)).
- **Planned:** `operator: maintain` accepts everyone with GitHub's maintain or admin permission on
  the repository, checked on every command, so a team does not depend on one person's login. A
  Wachiman role registry, with roles beyond GitHub's permissions, may follow later.

## Supply chain: what you trust and how to limit it

Using Wachiman means running its code with your credential. You can limit that trust:

- **Pin the reusable workflow by commit SHA,** not by a moving tag
  ([install.md](install.md#what-pinning-a-version-does-and-does-not-guarantee)).
- **Pin the same SHA in the federation rule or the secret manager conditions,** so a new release
  cannot reach your credential until you approve it.
- **Know what the SHA does not cover.** Today the caller can pass `claude_code_version`,
  `claude_code_sha256` and `bun_version`, which choose the Claude Code and Bun binaries the
  workflow downloads, and the Claude Code binary is what holds the credential. A rule that pins
  the workflow SHA does not see those inputs, and a teammate can change them on their branch.
  **Planned:** with federation or a secret manager, the workflow refuses those overrides and uses
  the versions pinned in the release. No input runs a script or a command of the caller's choosing.
- **Make the rule check the audience too.** GitHub's identity token names the audience it was
  minted for. The engine also mints identity tokens for the spend ledger, at a URL the caller
  chooses (`ledger_url`), and such a token carries the same pinned `job_workflow_ref`. A rule that
  checks the audience refuses a token minted for any other host.

## Shared responsibility

| Wachiman is responsible for | You are responsible for |
| --- | --- |
| Never receiving, storing or being able to fetch your credential | Choosing an option that matches who can push to your repository |
| Passing the credential only to the model process, and never running pull request code | Pinning the workflow and the rule to a SHA you reviewed |
| Scanning output for the credential before posting | Spend limits in your provider account, and revoking a credential that leaked |
| Publishing the code that runs with your credential, release by release | The security of your secret manager, broker or `watch` machine |

## Subscriptions and provider terms

A Claude subscription is tied to one person. Anthropic recommends an API key for a secret shared
across an organization
([GitHub Actions setup](https://code.claude.com/docs/en/github-actions#set-up-for-an-organization)),
and the [consumer terms](https://www.anthropic.com/legal/consumer-terms) forbid making an account
available to others. Running a whole team's reviews on one personal plan may break those terms.
Wachiman documents subscription options for **your own use**. For a team, the API with federation
and a workspace spend limit is the route Anthropic supports.

## Not decided yet

These questions are open, and the options above may change when they are answered:

- Which providers the first federation release covers beyond Anthropic.
- Whether `watch` or the secret manager connection is built first.
- Which secret managers can match the workflow SHA, not only the repository.
- Whether a credential broker can carry a Claude subscription token.
- Whether the engine will allow a custom model endpoint, which a broker needs.
