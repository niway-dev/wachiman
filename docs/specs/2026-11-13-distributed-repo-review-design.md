# Distributed-repo review: a local review that reads the sibling repositories of a workspace

- **Status:** proposed 2026-11-13. **Not implemented.** Nothing in `src/` reads a workspace
  manifest or a sibling repository today. Phase 0 (an experiment, below) must pass before phase 1
  is built. Written on Claude Opus 5.5.
- **Date:** 2026-11-13
- **Tracker:** NIW2-761 (this spec and its ADRs), child of NIW2-760 (the feature).
- **Creates:** [ADR 0042](../adr/0042-what-a-run-may-read-depends-on-where-its-output-goes.md)
  (what a run may read depends on where its output goes),
  [ADR 0043](../adr/0043-sibling-references-carry-the-member-and-the-commit.md) (sibling
  references carry the member and the commit),
  [ADR 0044](../adr/0044-contracts-name-a-source-of-truth-and-a-version-rule.md) (contracts name a
  source of truth and a version rule).
- **Numbering:** `main` holds up to 0039 (0037 is used twice there, by the size gate and by the
  subscription-token Actions review). Open pull requests hold 0040 and 0041 (#202, reserved in
  its text) and 0045 to 0048 (#210, #223, #232). 0042 is the first free number.
- **Reuses:** ADR 0016 (the engine, not the model, picks what to add), ADR 0019 (local mode makes
  no GitHub request; snapshots), ADR 0029 (per-user settings kept in the home directory), ADR 0034
  (Wachiman never edits code), ADR 0048 in open PR
  [#232](https://github.com/niway-dev/wachiman/pull/232) (`kind` in `.github/wachiman.yml`).
- **Supersedes, for runs with `--distributed-repo` only:** decision 3 of ADR 0031 and of ADR 0032,
  and ADR 0032's non-goal "answering questions about code outside the change's repository".
  **Amends:** decisions 1 and 3 of ADR 0027 (the verifier sees the same sibling snapshots).

## Summary (one minute)

Wachiman reviews one repository per run. That covers a monorepo, where every package is in one
checkout, but not a **multi-repo workspace**: a coordinator repository whose manifest lists member
repositories cloned side by side, where a change in one member can break another (a client calling
a route the service changed, a palette copied from a desktop app into a web site that drifts from
its source, a base UI library change that breaks a consumer). This design adds
`wachiman local --distributed-repo`: an opt-in mode in which the **engine** reads the manifest's
declared **contracts**, and when the change touches one side of a contract, gives the review
read-only snapshots of the other sides at a version chosen by a declared **version rule**
(`pinned` by default, `local`, `tip`). Each contract names its **source of truth**, so a review of
a copy can check it against the real source. References into a sibling carry the member and the
commit (`billing-service@3f2a9c1:src/routes/invoices.ts:42`), and the verifier and `ask` see the
same snapshots. What a run may read depends on **where its output goes**; version 1 is local only,
and a result built from a private sibling is labelled "private context" everywhere it is stored or
shown. Wachiman reports impact; it never edits a sibling. Before any of it is built, a
frozen-snapshot experiment measures whether sibling context finds real defects a
single-repository review misses, at a cost worth paying.

| # | Decision | Why | ADR |
| --- | --- | --- | --- |
| 1 | The concept is a **workspace** (a coordinator repository with a manifest of member repositories); the flag is `--distributed-repo`, opt-in per run. Its default is `off` and lives in a per-user workspace file the user, or their agent on the user's word, can change | Reading siblings costs more and widens what the model sees; it must be asked for. The owner chose the flag name over `--cross-repo` | reuses 0029 (home-kept settings) |
| 2 | Version 1 is local only: `wachiman local` and `wachiman ask`. No GitHub-mode path reads a manifest or a sibling | The siblings are already on disk; no token or app install is needed; ADR 0019's "no GitHub request" holds | reuses 0019 |
| 3 | What a run may read depends on where its output goes. Output that reaches a public place never reads a private sibling; laptop output may read any cloned sibling. Unknown visibility counts as private | A run that never read private code cannot paraphrase it; a name filter cannot catch a paraphrase | 0042 (new) |
| 4 | A result built with any non-public sibling carries a `privateContext` label in the JSON, history, `ask`, the review loop, the terminal and the Markdown report; any sink that writes outside the laptop refuses a labelled result | Local output does not stay local by itself: history and `ask` reuse it | 0042 (new) |
| 5 | The engine picks siblings from the manifest's `contracts`, never the model. A contract applies when a changed path (either side of a rename, or a deleted path) matches the reviewed member's side paths in it, or the contract's source-of-truth paths when the reviewed member holds the source. `--sibling <dir>` adds a member by hand. With no workspace contract applied, the report says so in one line | Reproducible and testable, like the data-path questions; a silent miss would read as coverage | 0044 (new), reuses 0016 |
| 6 | Each contract names its sides with a role (`provider` or `consumer`, which gives the direction) and its **source of truth**. A review of the side that does not hold the source reads the source when it is cloned and says "source of truth not cloned: not checked" when it is not | The owner: the source of truth does not move, but every side must know where it is and try to consult it | 0044 (new) |
| 7 | A **version rule** per contract or member: `pinned` (default; the version the consumer pins), `local` (the sibling's `HEAD` commit), `tip` (the sibling's recorded `origin/<default>`, never fetched). A per-user file overrides it. The report states the rule applied, why, and the SHA read | Reading the tip of a dependency the consumer pins gives false alarms and false passes; an all-local test needs the version made up locally; one place holds all these rules | 0044 (new) |
| 8 | Siblings are read as snapshots: `git archive` of the resolved commit, tracked files under the contract's paths only (globs expanded by the engine's own matcher, never by git pathspecs), no `.git`, symlinks dropped and listed, manifest paths with `..` or absolute paths refused. Never the live checkout | `--add-dir` on a checkout grants the whole tree, untracked files included | 0043 (new) |
| 9 | References into a sibling are structured `{member, sha, path, line}` and survive only if that line exists in that member's snapshot at that commit; the verifier and `ask` get the same snapshots | Today a sibling reference is dropped by the head-only check, and the verifier cannot see the sibling premise | 0043 (new), supersedes 0031/0032 decision 3 and the 0032 non-goal; amends 0027 |
| 10 | Wachiman reports impact (which consumer or copy is affected and where) and never edits a sibling or proposes a change set across members | Propagating edits is delicate when not everyone can see them; the review loop already never edits code | reuses 0034 |
| 11 | `kind: distributed` in `.github/wachiman.yml` is informative. It never turns on sibling reads; the flag and the contracts decide | A label that changes what is read would widen reads on a file edit nobody reviews as a security change | reuses 0048 (open PR #232) |
| 12 | Measure before building: phase 0 replays frozen snapshots with and without siblings, on seeded mutations, known fix pairs and a consecutive sample, against a bar the owner sets before the run | No cross-repository defect found by Wachiman has been measured yet | — |

## Open questions

Each has the default the build uses if nobody answers.

1. **Manifest file name, and who owns its schema.** The workspace kit creates the coordinator and
   its manifest. *Default:* the kit owns the file; Wachiman documents only the keys it reads
   (`format`, `members`, `contracts`, below) in `docs/formats/`, looks for
   `workspace.manifest.json` walking up from the reviewed repository, and accepts another path from
   the per-user file.
2. **Phase 0's bar.** *Default proposed:* build phase 1 if the run with siblings finds at least one
   real defect the single-repository run misses in every five contract-touching changes, at less
   than 30 % extra cost per review. The owner sets the bar before the run; the number is not
   decided by the result.
3. **`local` rule on a sibling with uncommitted changes.** *Default:* read the `HEAD` commit only
   and report "has uncommitted changes, not read". A tracked-only working-tree snapshot, like the
   `staged|all` one ADR 0019's status line records for the reviewed repository, is the later
   option.
4. **Size gate and estimate.** [ADR 0037 on the size gate](../adr/0037-a-pull-request-above-the-size-gate-is-not-reviewed.md)'s estimate is a pure function of the diff, so sibling reads
   are not in it. *Default:* unchanged in phase 1; phase 0 measures the extra cost; if it exceeds
   the bar, the estimate gains a sibling term in its own decision.
5. **`pinned` beyond a JSON key.** Lockfiles, Swift packages, Gradle catalogs pin versions in
   formats the engine does not parse. *Default:* phase 1 reads an exact version from a dotted key
   of a JSON file in the consumer, or a literal ref in the manifest; anything else falls back to
   `tip` with the reason in the report.
6. **Where the per-user workspace file lives.** *Default:* `~/.wachiman/workspaces.json`, a list of
   workspaces keyed by the manifest's absolute path, next to the ADR 0029 config, never in a
   repository.

## Out of scope

- Any remote run with siblings: GitHub Actions, a GitHub App, a public projection of the manifest
  for public CI. A much later version with its own design.
- Two private repositories with different readers (an authorization model beyond a visibility
  flag). Version 1 has no shared destination, so the question does not arise.
- Editing a sibling, opening pull requests in it, or a workspace-level review of a change set made
  of one pull request per member.
- Checking against what is deployed or released. Version 1 checks against the version the rule
  resolves on the laptop.
- Fetching a sibling, cloning a missing member, or any network call besides the model call.
- Discovering couplings automatically (import graphs, symbol search across members).
- Any guarantee against a person copying a private-context finding into a public place by hand.
- Reading uncommitted sibling changes (open question 3).

## Failures this must protect against

Risks, not observed events. Most come from an adversarial review of the draft (an independent
model attacked the design on 2026-11-13; its report is kept with the private draft because it
names private repositories). Each is an input for a test.

1. A private-context finding reaches a public place through reuse: history, `ask`, the review loop,
   a future sink.
2. A finding discloses private behaviour in prose without naming any private file or member, so a
   name filter passes it.
3. Private text enters a public-destination run through another door: the manifest itself, a
   coordinator instruction file, a diagnostic.
4. A member with no `visibility`, or a typo in it, is treated as public.
5. A stale sibling checkout gives a false "compatible", or an old one a false mismatch, and the
   report does not say how old the read was.
6. `pinned` cannot be resolved (no pin declared, a range instead of a version, the tag not present
   locally) and the review silently reads something else.
7. The snapshot exposes more than the contract: untracked files, `.git`, a symlink out of the
   tree, a manifest glob with `..`, a manifest member `dir` that resolves outside the workspace.
8. A change outside the declared paths (a shared helper, a renamed file) triggers nothing, and the
   report reads as if the workspace was checked.
9. A sibling reference is dropped by the head-only check, or survives against the wrong commit;
   the verifier refutes a finding whose premise is in a sibling it cannot see.
10. `ask` on a stored review re-reads a sibling at a different commit than the review did.
11. `kind: distributed`, or the per-user default, turns on reads in a run where the flag was not
    meant: the GitHub mode, a repository outside the workspace.
12. The source of truth is not cloned and the review of the copy says nothing.
13. Phase 0 reads a sibling that already contains the later fix (an answer from the future).
14. Phase 0's known fix pairs inflate the value; ordinary contract-touching changes pay the cost and
    find nothing.
15. "Zero leaks" in a finite replay is read as proof that leaks cannot happen.

## Acceptance criteria

Phase 1 is done when every item holds. Phase 0 is a precondition, recorded first.

- [ ] Phase 0's result and the owner's decision to build are recorded before phase 1 starts.
- [ ] On a fixture workspace (two members, one palette contract whose source of truth is in
      `desktop-app`), `wachiman local --distributed-repo` on a change to the palette in
      `desktop-app` reports the affected copy in `web-site` with a reference
      `web-site@<sha>:<path>:<line>` that exists in that snapshot.
- [ ] The same fixture, reviewed from `web-site` with the copy changed, reads the source of truth
      and reports the drift; with `desktop-app` not cloned, the report says "source of truth not
      cloned: not checked".
- [ ] Without `--distributed-repo`, with `kind: distributed` set and a manifest present, no
      manifest or sibling is read and the prompts are byte-identical to today's (fake-provider
      test).
- [ ] No GitHub-mode code path reads a manifest or a sibling: a canary string planted in a
      manifest and in a sibling next to the checkout is absent from every provider input
      (fake-provider test), and the GitHub sink refuses a result carrying `privateContext`.
- [ ] A sibling snapshot holds only tracked files under the contract's paths at the resolved
      commit: an untracked file, `.git`, an escaping symlink, a `..` glob and a manifest `dir` that resolves
      outside the coordinator are absent or refused
      (fixture test).
- [ ] Every reference into a sibling survives only if its line exists in that member's snapshot at
      that SHA; the report states how many were removed.
- [ ] The verifier and `wachiman ask` receive the same sibling snapshots (same members, same SHAs)
      as the review that produced the findings (fake-provider test).
- [ ] The report lists, per sibling: member, rule applied and why (including every fallback), SHA,
      age of the last fetch for `tip`, or "not cloned: not checked"; and one line "no contract
      applied" when none did.
- [ ] A per-user override changes the rule for a contract, and the report names the override as
      the rule's source.
- [ ] A result built with a private or unknown-visibility sibling carries `privateContext` in the
      JSON and history, and the terminal, Markdown, `ask` and review-loop output each print the
      private-context line.
- [ ] No sibling is fetched: a `gh` stub that throws and a `git` wrapper that fails on `fetch`,
      `pull` and `clone` leave the run green (fake-provider test).

---

## Context

### What the engine does today

- The model reads with `Read`, `Glob` and `Grep` over the snapshot of the reviewed head plus any
  extra directories (`runProvider`, `src/engine.ts:4528-4546`), passed as `--add-dir` each, with
  Bash disallowed (`src/providers/claude-code.ts:218-222`). The only extra directory today is the
  verifier's base snapshot (`verifyFindings`, `src/engine.ts:3373-3445`).
- Local mode snapshots `HEAD` with `git archive` into a temporary directory that the diff, the
  agent's reads and the citation checks share (`src/connectors/local-git.ts:387-417`).
- References are kept only if their path and line exist at the head of the reviewed repository:
  risk facts ([ADR 0031](../adr/0031-a-risk-map-whose-level-the-engine-computes-from-checked-facts.md)
  decision 3) and answers ([ADR 0032](../adr/0032-one-ask-core-for-pull-request-and-laptop-grounded-in-the-review.md)
  decision 3). A reference into another repository would be dropped.
- The verifier drops a finding only with a disproof at the head commit
  ([ADR 0027](../adr/0027-one-verifier-call-per-pull-request-drops-a-finding-only-with-a-checked-disproof.md)
  decision 3).
- History stores the `ReviewResult` with no confidentiality label (`src/history/types.ts:46-51`),
  and local `ask` picks the latest stored review of the same change and gives it to another model
  call (`src/local-ask.ts:51-75`).
- `refuseLeak` (`src/engine.ts:2888`) checks credential shapes only.
- ADR 0032 lists "answering questions about code outside the change's repository" as a non-goal.
  Its reopen conditions (wrong answers, removed references, the ask ceiling) are not met; this
  design supersedes the non-goal by the owner's decision of 2026-11-13, not by a reopen condition.
- ADR 0048 (open PR #232) records `kind: monorepo | single` in `.github/wachiman.yml`, lists
  "distributed" as coming soon, and says it reopens when distributed repositories get an
  implementation.

### Who does this already

Research of 2026-11-13; pages opened unless marked.

- **CodeRabbit** links up to 20 repositories in `knowledge_base.linked_repositories`; in `auto`
  mode a public repository links only to public ones, a private one to either; the app must be
  installed on each. <https://docs.coderabbit.ai/knowledge-base/multi-repo-analysis>
- **Greptile** "Repo Clusters" or `context.repos` in `.greptile/config.json`; members cloned
  read-only during review. <https://www.greptile.com/docs/code-review/cross-repo-context>
- **Augment Code Review** lists external repositories in `AGENTS.md`; findings cite the external
  repository and path. <https://docs.augmentcode.com/codereview/cross-repo-context>
- **Qodo** (beta) runs a cross-repository agent when a pull request touches a shared library
  export, an API contract, a schema or infrastructure configuration; findings are tagged
  "Cross-repo". <https://docs.qodo.ai/governance/cross-repo-code-review>
- **GitHub Copilot code review** and **Cursor Bugbot** review one repository.
  <https://docs.github.com/en/copilot/concepts/agents/code-review>, <https://cursor.com/docs/bugbot>
- Contract prior art: **Pact** `can-i-deploy` <https://docs.pact.io/pact_broker/can_i_deploy>,
  **Buf** breaking-change detection against a Git ref <https://buf.build/docs/breaking/>.
- Manifest prior art: the **Google `repo`** manifest, with per-user `local_manifests`
  <https://gerrit.googlesource.com/git-repo/+/HEAD/docs/manifest-format.md>; **Go workspaces**,
  where `go.work` lets local module copies override pinned versions (the `local` rule)
  <https://go.dev/ref/mod#workspaces>.

What they share: explicit declaration beats discovery; siblings are read-only context; access
follows the reviewer's installed identity, so all of them run remotely. Only CodeRabbit states a
visibility rule, and none states a rule against quoting a linked private repository in a public
comment. Where Wachiman differs: it needs nothing installed on the siblings, works across
organizations and hosts because it reads what the developer cloned, and sends code only to the
model call. Not shown yet: that this finds defects worth its cost (phase 0).

### Naming

"Workspace" collides with package-manager workspaces (npm, Yarn, pnpm, Bun, Cargo, Go), so a
`--workspace` flag inside a Bun monorepo would read as "use my workspace packages". The flag is
named after the shape instead: `--distributed-repo`. A naming review noted that Git itself is a
distributed version control system; the help text therefore defines the flag in one line: "also
read the sibling repositories declared in the workspace manifest". "Repo cluster" is Greptile's
term and was avoided. The `kind` values are `single`, `monorepo`, `distributed`, one word with the
flag.

## Detail

### The manifest keys Wachiman reads

Illustrative, with invented names. Any other key is ignored.

```json
{
  "format": "workspace/1",
  "members": [
    { "dir": "api-client",      "repo": "acme/api-client",      "visibility": "public"  },
    { "dir": "billing-service", "repo": "acme/billing-service", "visibility": "private" },
    { "dir": "desktop-app",     "repo": "acme/desktop-app",     "visibility": "private" },
    { "dir": "web-site",        "repo": "acme/web-site",        "visibility": "private" }
  ],
  "contracts": [
    {
      "name": "billing-api",
      "sides": [
        { "member": "billing-service", "role": "provider", "paths": ["src/routes/**"] },
        { "member": "api-client",      "role": "consumer", "paths": ["src/billing/**"] }
      ],
      "sourceOfTruth": { "member": "api-client", "paths": ["docs/billing-api.md"] },
      "version": { "rule": "tip" }
    },
    {
      "name": "brand-palette",
      "sides": [
        { "member": "desktop-app", "role": "provider", "paths": ["Assets/palette.json"] },
        { "member": "web-site",    "role": "consumer", "paths": ["packages/tokens/src/**"] }
      ],
      "sourceOfTruth": { "member": "desktop-app", "paths": ["Assets/palette.json"] }
    }
  ]
}
```

- `format`: the kit's identifier for the file, ending in `/<major>`. Wachiman reads the majors it
  knows and refuses any other with a message; it never guesses. Which identifiers it accepts is
  part of open question 1.
- `members[]`: `dir` (relative to the coordinator), `repo` (`owner/name`, matched against the
  reviewed repository's normalised `origin`), `visibility` (`public` or `private`; anything else or
  missing counts as private).
- `contracts[]`: `name` (unique), `sides[]` (at least one `provider` and one `consumer`; `paths`
  are globs relative to the member), `sourceOfTruth` (a member and paths; it may be a third member,
  such as a repository holding only a specification), `version` (optional; default `pinned`).
  The first example shows why the source of truth is its own field: the service provides the
  routes, but the document the client keeps is what both sides must match.
- A member may carry its own `version`, used by every contract that reads it unless the contract
  sets one.

### The per-user workspace file

`~/.wachiman/workspaces.json` (open question 6), never committed, editable by the user or by their
agent on the user's word:

```json
{
  "version": 1,
  "workspaces": [
    {
      "manifest": "/Users/dev/acme/workspace.manifest.json",
      "distributedRepo": "off",
      "members": { "web-site": { "dir": "/Users/dev/other-clones/web-site" } },
      "versions": { "brand-palette": { "rule": "local" } }
    }
  ]
}
```

- `distributedRepo`: the default when the flag is not given (`off` unless the user changes it).
  `--distributed-repo` and `--no-distributed-repo` win over it for one run. A run turned on by
  this default prints `distributed-repo: on (default from ~/.wachiman/workspaces.json)` before
  reading anything, so a change to the file never widens reads silently.
- `members.<dir>.dir`: where that member is cloned, when not inside the coordinator.
  `members.<dir>.watch: false` leaves a cloned member out, reported as "not watched".
- `versions`: per contract name or member `dir`. Precedence, first match wins: this file per
  contract, this file per member, the manifest's contract, the manifest's member, `pinned`.

### Version rules

| Rule | What is read | When it cannot be resolved |
| --- | --- | --- |
| `pinned` (default) | When the reviewed repository is the consumer and the sibling the provider: the commit of the tag the consumer pins. The pin is a literal `ref` in the contract, or `pin: { "file": "package.json", "key": "dependencies.@acme/ui-kit", "tag": "v{version}" }` read from the reviewed head | No pin declared, a range instead of an exact version, the tag not in the sibling's local refs, or any other direction (nothing pins a consumer): read `tip`, and the report says why |
| `local` | The sibling's `HEAD` commit, whatever branch it is on, for an all-local test with a version made up on the laptop | Uncommitted changes are not read and are reported (open question 3) |
| `tip` | The commit `refs/remotes/origin/HEAD` points to, as last fetched; never fetched by Wachiman (ADR 0019) | No remote default recorded: read `local`, and the report says why |

Every report line for a sibling states the rule, its source (default, manifest, per-user file),
any fallback with its reason, the SHA read, and for `tip` the age of the last fetch (from
`FETCH_HEAD`, "unknown" when absent).

### How a run picks its siblings

1. **Find the workspace.** The per-user file lists a manifest whose `members` include the reviewed
   repository (by `repo`, then by `dir`); otherwise walk up from the repository's top level to the
   first directory holding the manifest file. An explicit `--distributed-repo` with no workspace
   found is exit 2 with the reason; a default of `on` outside a workspace does nothing.
2. **Match contracts.** A contract applies when a changed path of the review (the new and old path
   of a rename, and deleted paths) matches the reviewed member's side paths, or its source-of-truth
   paths when the reviewed member holds the source.
3. **Choose what to read.** For each applied contract: the other sides' paths, and the source of
   truth's paths when another member holds it. A member that is not cloned, or not watched, is
   reported, never silently skipped. `--sibling <dir>` adds a member by hand with its whole
   tracked tree.
4. **Resolve versions** (table above), then **check the destination** (ADR 0042): in version 1 the
   destination is always the laptop, so every cloned sibling may be read, and a non-public one sets
   the `privateContext` label.
5. **Snapshot** each `(member, sha)` with `git archive`, restricted to the chosen paths (ADR 0043).
6. **Review.** Only the batches that hold a file which triggered a contract get the snapshots as
   `--add-dir` and a prompt section naming each contract, the roles, the source of truth, the
   member, the SHA and what to check (a copy that drifts from its source; consumers of a changed
   provider path). Every other batch's prompt is byte-identical to today's, as ADR 0016 decision 3
   does for questions. The verifier gets every snapshot of the run.
7. **Report.** The terminal, Markdown and JSON outputs list the siblings (decision 7's line), the
   contracts applied, and the impact: which consumer or copy is affected and where, as references
   into the sibling. Nothing is edited (ADR 0034).

### Result format

Additive, optional fields on result `/2` (ADR 0019 decision 9's rule):

- `siblings[]`: `member`, `repo`, `visibility`, `rule`, `ruleSource`, `fallback?`, `sha`,
  `fetchedAt?`, `paths[]`, `status` (`read`, `not-cloned`, `not-watched`, `uncommitted-not-read`).
- `workspaceContractsApplied[]`: names; and `noWorkspaceContractApplied: true` when none did.
  The prefix keeps them apart from the review's existing contract lines (ADR 0044 decision 1).
- `privateContext?`: `{ members: [...] }`, present when any read sibling is not public.
- On every structured reference (finding evidence, contract-line facts, risk facts, verifier disproofs,
  `ask` references): optional `member` and `sha`. Absent means the reviewed head, as today.

### `ask` and history

History stores the result with its `siblings` and `privateContext`. `wachiman ask` on that review
re-materialises the same snapshots from each sibling's repository by the stored SHA. When a SHA is
gone or the member is not cloned, the answer says which sibling it could not read, and references
into it are removed and counted. An answer grounded in a labelled review is labelled.

`ask` selects no sibling of its own: it reads exactly what the stored review read. `ask --distributed-repo` on a range whose stored review has no siblings, or with no stored review, exits 2 and says to run `wachiman local --distributed-repo --history` first; a per-user default of `on` in that case does nothing and says so in one line. `ask` without the flag on a review that read siblings still re-materialises them and labels the answer, because the answer must stand on the same evidence as the review (ADR 0043 decision 4).

## Phase 0: measure before building

The question to answer, in the owner's terms: in how many of N contract-touching changes does the
review with siblings find a real defect the single-repository review misses, and at what extra cost
each?

- **Harness.** An unmerged branch with a hidden flag that adds frozen sibling directories as
  `--add-dir`; the product's default reviewer, the same settings in both arms, two runs per arm.
- **Inputs frozen in time.** Every sibling read at the commit that existed when the reviewed change
  was made; a later fix is used only to judge (failure 13).
- **Three sets.** Seeded mutations (change the source of truth of a copy, change a provider's
  answer); known fix pairs where a change in one member was followed by a compatibility fix in
  another; and N consecutive contract-touching changes, for the ordinary cost (failure 14). A
  single-repository mismatch is kept as a control.
- **Counted.** Findings gained, findings lost against the single-repository arm, false alarms,
  incomplete reviews, extra cost and time. Judged blind to the arm.
- **Order.** First an all-private workspace with one audience and a verified copy coupling, where
  value can be measured with no leak question; then a mixed-visibility workspace.
- **Where the data goes.** Review data that contains private code stays on the laptop, never in a
  repository. The concrete cases are listed with the private coordinator of each workspace.
- **Leaks.** Reported as "zero observed in N runs", never as proof (failure 15).

## Phases

- **Phase 0:** the experiment above. Decides whether phase 1 is built.
- **Phase 1:** everything in the acceptance criteria. Local only.
- **Later, separate designs:** a remote run for all-private workspaces with one audience (an app
  token over the members); a public projection of the manifest for public CI; private-to-private
  audiences.

## Sources and unverified claims

- The owner's direction of 2026-11-13 (tracker NIW2-760): concept, flag name, `kind` values,
  source of truth, the version rule with a local override, local only, report impact and never
  propagate. The design conversation that produced it names private repositories and stays with
  the private draft.
- A copy coupling of the palette kind exists in one of the owner's private workspaces (checked
  2026-11-13: a web test asserts the tokens against its own copy of the app's palette, not against
  the app's file). Its details stay private; it is phase 0's first seeded case.
- Unverified: whether a Claude Code hook installed in the developer's home directory can inject a
  coordinator's instruction file into the review's `claude -p` subprocess. Not relevant to
  version 1's local destination; it must be tested in ADR 0019's populated-HOME harness before any
  remote phase.
