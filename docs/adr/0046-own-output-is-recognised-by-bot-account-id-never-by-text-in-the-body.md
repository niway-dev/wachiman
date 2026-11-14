# ADR 0046: The engine recognises its own output by bot account id, never by text in the body

- **Status:** proposed 2026-11-12, not implemented. Builds on
  [ADR 0011](0011-review-every-push-incrementally.md) (the next push reads the last review) and
  [ADR 0012](0012-automatic-thread-replies-and-a-per-pr-ceiling.md) (replies and the per-pull-request
  ceiling read earlier output). Needed by
  [ADR 0045](0045-a-github-app-whose-private-key-lives-alone-in-an-exchange-worker.md); its first
  step has no behaviour change and can ship before it.
- **Date:** 2026-11-12
- **Spec:** [The Wachiman GitHub App](../specs/2026-11-12-github-app-design.md), section 4
- **Issue:** [#206](https://github.com/niway-dev/wachiman/issues/206)

## Context

The engine keeps no state of its own on a pull request: it reads what it posted earlier. Ten
places decide that a review or comment is the engine's, all by login (`src/engine.ts` lines 1867,
2169, 2287, 2303, 2322, 2439, 2477, 4327; `src/precision.ts` lines 90, 154). REST reports the
login as `github-actions[bot]` and GraphQL as `github-actions`, so the code carries both
spellings, and one place also checks the author type. From those reads come the last reviewed
commit, the files a partial review did not reach, which threads a finding opened, whether the
last word in a thread is already the engine's, the money spent on the pull request, the notice to
update, and whether this run's review landed.

With ADR 0045 a review is posted by the App when the exchange answers and by
`github-actions[bot]` when it does not, so one pull request can carry both authors in any order.
Pull request [#135](https://github.com/niway-dev/wachiman/pull/135) proposed that a hidden footer
record which token posted "so the re-review logic can find earlier comments by either author".
Anyone who can comment can write that footer.

## Decision

1. **An author is the engine's own when its type is `Bot` and its account id is in the
   own-author set.** The set is `41898282` (`github-actions[bot]`) and the App's bot account id,
   both constants, plus at most one id from configuration for an App someone registered
   themselves.
2. **One function holds the rule** and every reader calls it. It takes the REST shape
   (`user.id`, `user.type`) and the GraphQL shape
   (`author { __typename ... on Bot { databaseId } }`). No login is compared anywhere else. An
   author with no id or no type is not the engine's.
3. **Nothing in a body grants trust.** Hidden signatures, cost footers and the footer line naming
   the author classify a record only after rule 1 passed. The footer line stays, for people.
4. **"Latest" is taken across both authors,** by time. No reader filters by the author of the
   current run.
5. **The App token creates; `GITHUB_TOKEN` does the rest.** Reviews, replies and comments on the
   pull request are created with the App token when there is one. Reads, editing a notice and
   resolving a thread use the workflow's token. When editing a notice the other author wrote is
   refused, the engine posts a new notice, and readers take the newest.

## Alternatives rejected

- **A set of logins.** Simple, and what the code does today for one login. A login changes when
  the App is renamed, which would orphan every open pull request's history, and it has two
  spellings. The id is the same number in both APIs (checked for `github-actions`: REST id and
  GraphQL `databaseId` are both `41898282`).
- **Trust the hidden footer or signature.** No author check at all, so it works for any identity.
  A person or another bot can copy it: a forged cost footer would stop reviews, a forged last
  reviewed commit would skip code.
- **Signed metadata in each comment.** It would also tell the engine apart from other workflows
  that post as `github-actions[bot]`. It needs a signing key in every consumer's job, which is a
  secret Wachiman does not ask for today.
- **Stop when the App token is unavailable,** so there is a single author. Contradicts ADR 0045
  decision 6.
- **Use the App token for every call.** One token in the engine. It would need the App to edit
  and resolve what `github-actions[bot]` wrote, across authors, which nobody has checked, and it
  widens the time the token is in use.

## Consequences

- About twelve test files that hard-code the login gain an author id and type in their fixtures.
- The engine trusts the repository's other workflows as much as it does today: any of them can
  post as `github-actions[bot]`. The App's identity is stronger, since only the exchange mints it.
  On the platform path the ledger, not the footers, decides money.
- Renaming the App changes nothing for the engine.
- A pull request may end with two notices when an edit across authors is refused.
- The App's bot account id is known only after registration, so the constant is added by the
  pull request that ships the exchange.

## Non-goals

- Telling the engine apart from another workflow in the same repository.
- A store of posted comment ids outside the pull request.
- Changing what a footer or a signature contains.

## Reopen when

- The App's REST id and GraphQL `databaseId` differ (probe P5 of the spec): fall back to login
  plus type in the GraphQL readers.
- A repository's other workflow is seen posting text the engine takes for its own: that is the
  case for signed metadata or for a store of ids on the platform.
- Editing across authors turns out to work both ways and two notices become a nuisance: drop the
  "post a new notice" branch.
