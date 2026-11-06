# ADR 0021: Accounts are the only wallet; tags only report

- **Status:** proposed 2026-11-06, approved in conversation by the owner. Not implemented.
  Builds on [ADR 0020](0020-a-daily-spend-limit-kept-by-a-ledger-service.md).
- **Spec:** [A daily spend limit across every repository](../specs/2026-11-06-daily-spend-limit-design.md)
- **Issue:** [#122](https://github.com/niway-dev/wachiman/issues/122)

## Context

The owner wants to group repositories flexibly: by GitHub owner (`csdev19`, `niway-dev`), by an
invented group ("open-source products"), across owners, and later per team in a company with
several IT areas and one cross-cutting admin. The owner also asked whether a limit can be set per
account, per repository and per group, and how annexations (one organization absorbed by another,
or a very large one) would work.

A GitHub OIDC token proves `repository` and `repository_owner`; it carries no team or group. Any
grouping beyond the owner is therefore a table the ledger keeps, not something the token says.

A hard limit needs one place that decides atomically (ADR 0020: one Durable Object). A group that
spans accounts spans objects, so a hard limit per group would make every reservation coordinate
several objects.

## Decision

1. **Three concepts.** An **organization** (optional) owns accounts, organization-wide tags and
   the organization report, and is where a cross-cutting admin lives. An **account** is the
   wallet: it holds the daily limit and is one Durable Object. A **repository** is linked to
   exactly one account, by hand in the console, and is proven by OIDC on every call. Linking
   may cross GitHub owners.
2. **Hard limits live where atomicity lives.** Per account (the daily number) and per
   repository (a stricter number for one repository) are decided inside the account's object.
   Per organization is decided by a second reservation in the organization's object, released
   if the account's reservation fails; it is designed here and not built until someone needs it.
3. **Tags never limit.** A repository carries any number of tags; tags are scoped to the
   organization and cross accounts; reports and alerts group by them. A tag may have an alert
   threshold that notifies; it never stops a run. If a tag must stop runs, it becomes an
   account.
4. **The ledger is append-only and attributes spend to the account it happened in.** Moving a
   repository to another account, an account to another organization, or merging organizations
   changes pointers; history stays where it was recorded and reports include the moved entity
   from the day of the move. A repository rename changes nothing because the key is
   `repository_id`.
5. **Scale by accounts.** Each account is its own object; reservations never touch another
   account. The organization report sums one daily total per account.

## Alternatives rejected

- **A `team` attribute in the caller's yml.** Anyone can write someone else's team name.
- **A team UUID in the yml.** A leaked UUID is enough to join; the protection would have to be
  the OIDC-verified link anyway, so the UUID adds nothing the link does not.
- **Hard limits per tag.** Cross-object coordination on every reservation, for a case the owner
  can express as another account.
- **One global object for everyone.** Simple, but every customer shares one serialized queue
  and one storage limit, and a customer's data is not isolated.
- **Owner-only grouping** (`repository_owner` as the account). Cannot put `csdev19/x` and
  `niway-dev/y` in one wallet, which is the owner's own case.

## Consequences

- The first version is a hand-edited account table; the console comes later and must preserve
  the three concepts and `repository_id` keys so no migration is needed.
- A company with many IT areas is many accounts under one organization; the organization limit
  costs a second call per run when enabled.
- Very large organizations still need SSO, roles and bulk linking that this record does not
  design.

## Non-goals

- Limits per tag. Roles and sign-in. Automatic linking from GitHub App installation events.

## Reopen when

- A customer needs a hard limit on a set of repositories that must stay in different accounts
  for another reason: design cross-object reservation then, with the organization limit as the
  pattern.
- Linking by hand becomes the main support cost: design GitHub App-based linking.
