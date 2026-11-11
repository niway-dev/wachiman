# Session handoff

## Goal
Answer the SHA-pin security finding on csdev-monorepo PR 35 so consumers can trust the code Wachi runs with their key, keeping the current model (review runs in the consumer's Actions with the consumer's key; no Wachi backend touches consumer code).

## Mode
discussion (design; no code changed in this repository)

## Where we stopped
- Last done: the user read the research on Pullfrog, claude-code-action, octo-sts, Go on Cloudflare, Check Runs and autofix, and decided: no GitHub App for now (see Decided). The agent clarified that a required merge check needs no App: the `review` job of the reusable workflow is already a check the consumer can require.
- Next: in `csdev19/csdev-monorepo` PR 35, file `.github/workflows/agent-review.yml`: change the `uses:` line to the full commit SHA of `v1.2.0` with `# v1.2.0` as a trailing comment, and rewrite the comment on lines 4-6 so it no longer claims the tag never moves (say: pinned to a commit; updates arrive as Dependabot pull requests). Then, in this repository, open open question 1 (immutable releases) with the user and update `docs/install.md`, `templates/agent-review-caller.yml`, `SECURITY.md` and ADR 0001 to offer the SHA form.

## Decided
- SHA (or an immutable exact tag) over a floating tag. The user: "mejor pinear un sha para que nadie mueva algo que no quiere y no movamos algo que no quieren". Delivery of fixes stays Dependabot: one pull request per release to each consumer, which is already how Wachi works. Settled; do not reopen.
- No GitHub App for now. Reasons: identity (name and icon), buttons and install counts do not justify registering an App, holding its private key, hosting a Go token service (~$5/month on Cloudflare Containers) and adding `id-token: write` to every consumer; a required merge check and inline annotations are possible today without an App; autofix needs `contents: write`, which the user does not want. The user's words: "me dan motivos para no hacer una app"; "quiero mantenerlo como pullfrog ... pero no quiero acceder a su código". Settled; reopen only if a consumer asks for the bot identity or install counts are needed.
- If an App is ever built, it is identity only: a token-exchange service (GitHub OIDC in, short-lived App installation token out) that sees a JWT with repository, workflow ref and commit, never code or diff. The review keeps running in the consumer's Actions with the consumer's key. The research for that case (Go on Cloudflare Containers; fixed policy on `job_workflow_ref` and release SHAs; `jsiebens/gh-app-token-service` unsafe as-is: no audience check, owner-only claim, full-permission token; `octo-sts` as the reference for validations; OIDC step separate from the model step, cf. the claude-code-action flaw patched in v1.0.94) is recorded here so it is not redone. Settled as the shape, not scheduled.
- "The model only reads the diff and has no shell" refers to Claude in the consumer's runner, which is already the case (`SECURITY.md`). Nothing of the consumer's passes through any Wachi service. Settled.

## Open
1. **Enable GitHub immutable releases on this repository?** GA since 2025-10-28. Tags of immutable releases cannot be moved or deleted even by admins (today's `v*` ruleset has a `RepositoryRole` admin bypass, which is what the PR 35 reviewer flagged), and each release gets an attestation of tag + SHA. It is all-or-nothing per repository, so the floating `v1` tag kept for installed callers (`docs/releasing.md`) would stop being movable; decide its fate first. With it on, an exact tag is as strong as a SHA and stays readable.
2. **ADR 0001 amendment.** The ADR rejects SHA pinning ("adds nothing over an exact tag while the `v*` ruleset holds", "unreadable in the caller"); its reopen conditions do not cover an outside security review. Offering the SHA form means amending the rejected alternative, and the ADR's residual-risk text should name the admin bypass. Pending the user's go-ahead on the wording.
3. **Blocking mode.** Offer an input that fails the `review` job when a finding has the highest severity, so a consumer can require the job in branch protection. ADR 0001 lists "making the review blocking" as a non-goal; this would be a new ADR, not an amendment. Not requested yet; recorded because it replaces the Check Runs argument for an App.
4. Whether Anthropic's workload identity federation (OIDC to a short-lived Anthropic token, documented for claude-code-action) is usable from a third-party reusable workflow; it would remove the consumer's `ANTHROPIC_API_KEY` secret. Unverified; low priority.

## State
- Branch `wip/app-identity-trust-model`, PR https://github.com/niway-dev/wachi-reviewer/pull/38 (draft)
- Committed: nothing beyond this handoff; `main` is at `9528de1` (release 1.2.0)
- Uncommitted at park time: nothing

## For the agent
- Original request, verbatim (Spanish chat): "mi pregunta es: esto se hubiera solucionado si creamos una app? para que los que vayan a usar mi reviewer lo hagan con mas confianza y sea mas seguro para todos". English: would a GitHub App have solved the tag-pin finding, so adopters trust the reviewer more. Final direction, verbatim: "quiero mantenerlo como pullfrog no quiero que usen mi backend en general, si es necesario con el firmador bueno que importa. pero no quiero acceder a su codigo".
- Files in play: `SECURITY.md` (Supply chain paragraph), `docs/install.md`, `docs/releasing.md` ("Pinning" section), `docs/adr/0001-distribution-and-trust.md`, `templates/agent-review-caller.yml`; external: `csdev19/csdev-monorepo` PR 35 (https://github.com/csdev19/csdev-monorepo/pull/35), file `.github/workflows/agent-review.yml`. The commit for `v1.2.0`: `git rev-list -n1 v1.2.0` in this repository.
- Check command: `bun test` — result at park time: exit 0, 141 pass, 0 fail across 8 files (engine unit tests; nothing in this session touched code).
- Conventions to keep: this repo's hook blocks commits in the main checkout and requires a worktree under `.claude/worktrees/`; the user's rule is to commit, push, open the PR and remove the worktree before stopping. The `gh` account for this remote (`github-personal`) is `csdev19`; for `csdev-monorepo` (`github-csdev`) check `~/GITHUB_ACCOUNTS.md`. Chat in Spanish, every artifact in English. Design questions in prose with numbered options, never the picker. Write short sentences; the user found a dense trade-off paragraph unreadable this session. Specs go to `docs/specs/`, ADRs to `docs/adr/`.
