# Code comments

A comment in code is allowed in two forms only. Everything else is prose, and the lint rule
`local/comments-point-to-docs` reports it. The explanation of why code is the way it is lives in a document
(an ADR, a reference page, a spec), where it can be reviewed, linked and kept current, and the code carries
a pointer to it.

## What is allowed

1. **A pointer** to the document that explains the code. The whole comment is `See <path>` or
   `See <path>#<anchor>`, with the path relative to the repository root and the file existing:

   ```ts
   // See docs/adr/0061-bun-is-the-development-toolchain-with-a-ratchet-for-what-already-exists.md
   // See docs/ledger-api.md#authentication
   ```

   A pointer to a file that does not exist is reported with its own message. The anchor is not checked.
2. **A tool directive:**
   - `@ts-expect-error <reason>`, `@ts-ignore <reason>` and `@ts-nocheck <reason>` (a reason is required);
   - `@ts-check`;
   - `eslint-disable`, `eslint-disable-next-line`, `eslint-disable-line` and the `oxlint-` equivalents, with a
     reason after ` -- `, as in `// eslint-disable-next-line no-empty -- the probe may throw`;
   - `eslint-enable` and `oxlint-enable`;
   - the shebang (`#!/usr/bin/env bun`);
   - `/// <reference ... />`.

## What is reported

Any other comment: a line comment, a block comment, a TODO, commented-out code. Remove it, or move what it
says to a document and leave a pointer.

**JSDoc on exported symbols is reported like any other prose.** There is no exception: the types carry the
contract, and the reasoning belongs in the document the symbol points to.

## Relation to the review rule

This page is about the lint rule that guards this repository's own source. It is a development tool: the
plugin is not part of the npm package, and it changes nothing for people who use Wachiman.

The opt-in review behavior [`review.comments_point_to_docs`](configuration.md#the-comment-rule-reviewcomments_point_to_docs)
is a separate thing, a review opinion on the comments a pull request adds, off unless a repository turns it
on ([ADR 0064](adr/0064-new-review-behavior-is-opt-in-per-repository-and-off-by-default.md)). Both accept
the same two forms (a pointer and a tool directive). The lint rule is mechanical and rejects every other
comment in a file; the review rule is a model's judgement and only reports with `Consider` severity.

## How it is enforced

`scripts/lint/plugin.js` is loaded by the `[lint]` section of `bunfig.toml`. The ratchet
(`scripts/ratchet.ts`, ADR 0061) records the comments that existed when the rule was adopted in
`scripts/ratchet-baseline.json`, so a new prose comment in a file fails `bun run lint` once that file's count passes its baseline, and the
pull request that removes comments runs `bun run ratchet:update` to lower it. `scripts/lint/plugin.test.ts` runs the rule through the real `bun lint`.
