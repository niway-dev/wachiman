# ADR 0044: The engine picks siblings from declared contracts, and each contract names a source of truth and a version rule

- **Status:** proposed 2026-11-13. **Not implemented.** Phase 1 of the
  [distributed-repo review design](../specs/2026-11-13-distributed-repo-review-design.md) builds it,
  after phase 0. Reuses [ADR 0016](0016-data-path-questions-chosen-by-the-engine.md) (the engine,
  not the model, chooses what to add, from text, deterministically) and
  [ADR 0029](0029-named-account-profiles-external-config-directories-and-home-kept-project-bindings.md)
  (per-user settings kept in the home directory, never in a repository).
- **Date:** 2026-11-13
- **Spec:** [Distributed-repo review](../specs/2026-11-13-distributed-repo-review-design.md),
  decisions 1, 5 to 7 and 11.
- **Tracker:** NIW2-761

## Context

A multi-repo workspace is a coordinator repository whose manifest lists member repositories cloned
side by side. To review across them, Wachiman must know which sibling to read when a change
touches a file, which side is the real source, and which version of the sibling counts.

Three cases from the design conversation, with invented names:

- **A copy.** `web-site` keeps a copy of the palette whose source is
  `desktop-app/Assets/palette.json`, and tests its tokens against its own copy. The source of truth stays in the app; a review of either side
  needs the other, and a review of the copy must consult the real source, or say it could not.
- **An API.** `billing-service` provides routes; `api-client` calls them and keeps the document
  both must match. The provider and the source of truth are different members.
- **Layers of libraries.** A page uses a page-level design system, which uses the organization's
  UI library, at the version its lockfile pins. Reading the library's latest commit gives false
  alarms and false passes. For an all-local test the developer may want a version they made up on
  the laptop. The owner: these per-project version conventions must live together in one place.

Every cross-repository reviewer researched declares the links explicitly rather than discovering
them (CodeRabbit `linked_repositories`, Greptile `context.repos`, Augment `AGENTS.md`); Qodo fires
its cross-repository agent on changes to a shared export, an API contract or a schema
([docs](https://docs.qodo.ai/governance/cross-repo-code-review)). Go workspaces let local copies
override pinned versions ([`go.work`](https://go.dev/ref/mod#workspaces)); the Google `repo` tool
keeps per-user overrides in `local_manifests`
([format](https://gerrit.googlesource.com/git-repo/+/HEAD/docs/manifest-format.md)).

## Decision

1. **Contracts are declared in the workspace manifest.** Wachiman reads `format`, `members[]`
   (`dir`, `repo`, `visibility`) and `contracts[]`, and ignores every other key. An unknown
   `format` is refused with a message. The keys are documented in `docs/formats/`.
   **Naming:** these entries are *workspace contracts*. The review already has *contract lines*
   (the `contracts` a review reports, ADR 0031 decision 3 and ADR 0027): claims a change makes
   about an interface. They are different things. Docs say "workspace contract" wherever both
   could be meant, and the result fields carry the prefix (`workspaceContractsApplied`); the
   manifest key stays `contracts`, because the manifest has no other kind.
2. **A contract has sides with roles.** Each side is a member, `role: provider | consumer`, and
   path globs. The roles give the direction: a consumer change reads its providers (upward); a
   provider change reads its consumers (downward) to report impact.
3. **A contract names its source of truth** (a member and paths; it may be a third member). A
   review of a member that does not hold it reads the source when it is cloned, and reports
   "source of truth not cloned: not checked" when it is not.
4. **The engine picks, never the model.** A contract applies when a changed path of the review,
   including both paths of a rename and deleted paths, matches the reviewed member's side paths in
   it, or the contract's source-of-truth paths when the reviewed member holds the source (a change
   to the source reads the copies and consumers that depend on it).
   No model call, no network, no reading of unchanged code to decide. The selection is logged and
   reported. `--sibling <dir>` adds a member by hand for one run. The directory must be a member of the manifest (matched by `dir`); it keeps that member's name, `visibility` and version rule from the usual precedence, and a directory that is not a member exits 2. With none applied, the report
   says "no workspace contract applied" in one line.
5. **A version rule resolves each sibling's commit.** `pinned` (default): the tag the consumer
   pins, from a literal `ref` in the contract or a `pin` (a JSON file in the consumer, a key path
   of literal keys, a tag template); when it cannot be resolved, or when nothing pins the side being read, the
   engine reads `tip` and the report says why. `local`: the sibling's `HEAD` commit. `tip`: the
   commit `refs/remotes/origin/HEAD` points to, as last fetched. Wachiman never fetches. With no
   `refs/remotes/origin/HEAD` recorded, `tip` reads `local` and the report says so, so a `tip`
   line that is really a read of unpushed work is visible.
6. **One precedence, one place per level.** First match wins: the per-user workspace file per
   contract, then per member; the manifest's contract, then its member; then `pinned`. The
   per-user file (`~/.wachiman/workspaces.json`) is never committed and also holds the mode's
   default (`off` until the user changes it), where uncloned members live, and which cloned
   members are not watched. When the mode is on because of that default rather than the flag,
   every run prints `distributed-repo: on (default from ~/.wachiman/workspaces.json)` before it
   reads anything, and the report repeats it.
7. **The report states the rule.** For each sibling: the rule, where it came from, any fallback
   and its reason, the SHA read, and for `tip` the age of the last fetch.
8. **`kind` is informative.** `kind: distributed` in `.github/wachiman.yml` (ADR 0048, open PR
   [#232](https://github.com/niway-dev/wachiman/pull/232)) describes the repository. It never
   turns the mode on and never changes what is read.

## Alternatives rejected

- **Let the model pick siblings, or give it every member.** No manifest work. Rejected: not
  reproducible, and ADR 0016 already decided the engine chooses what to add while the model
  judges. Every member at once multiplies cost on changes that touch no contract.
- **Discover couplings from imports or symbols.** No declaration to maintain. Rejected for
  version 1: copies across languages (a palette in a desktop app's JSON and a web token file) have
  no import to follow, and discovery across repositories needs an index. `--sibling` and "no
  contract applied" cover the misses honestly.
- **Always read the sibling's latest commit.** Simplest. Rejected: for a pinned dependency it
  checks the wrong version, as the layered-library case shows.
- **Rules only in the committed manifest.** One file. Rejected: an all-local test with a made-up
  version is one developer's choice, not the team's.
- **`kind: distributed` turns the mode on.** One less setting. Rejected: a one-line edit nobody
  reviews as a security change would widen what every run reads, for everyone who clones the
  repository. The per-user default also widens reads, but only for its owner, only on the laptop
  destination (ADR 0042), and every run it affects announces it (decision 6).

## Consequences

- The kit that writes the manifest must keep `contracts` accurate; a stale glob triggers nothing.
  The "no workspace contract applied" line and phase 0's consecutive sample make that visible.
- `pinned` falls back to `tip` often in version 1 (copies have no pin; only JSON pins are read).
  Every fallback is in the report, so the rate can be measured.
- A member can be read at different commits by different contracts; ADR 0043 keys snapshots by
  `(member, sha)`.
- The per-user file is a new input. Like ADR 0029's bindings, it is read from the home directory,
  never from a reviewed repository.

## Non-goals

- Editing a sibling, or proposing a change set across members. Wachiman reports impact
  ([ADR 0034](0034-a-review-loop-driven-by-the-cli-that-never-edits-code.md) already keeps the
  review loop from editing code).
- Checking against deployed or released versions.
- Parsing lockfiles and package formats beyond a JSON key (spec, open question 5).
- Owning the manifest file name or its other keys; the workspace kit decides those.

## Reopen if

- Phase 0 or the phase 1 trial shows that most cross-repository defects found came through
  `--sibling` rather than a contract: declaration is not working, and discovery comes back.
- `pinned` falls back on more than half of the reads where a pin exists in the consumer: the pin
  formats need to grow.
- A team needs a version rule that none of the three expresses (a release channel, a deployed
  commit).
