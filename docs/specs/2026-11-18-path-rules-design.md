# Path rules: a repository marks its dangerous paths, read from the base commit

- **Status:** approved for build 2026-11-18. The open questions of the issue were answered by the
  coordinating session; the owner has not ruled on each answer individually and can reverse any of
  them on the pull request.
- **Issue:** [Path rules (#250)](https://github.com/niway-dev/wachiman/issues/250)
- **Creates:** [ADR 0058](../adr/0058-path-rules-in-wachiman-yml-read-from-the-base-commit.md).
  **Reuses:** [ADR 0048](../adr/0048-a-repository-settings-file-at-the-root-wachiman-yml.md) (the
  settings file), [ADR 0049](../adr/0049-model-and-effort-in-wachiman-yml-read-from-the-base-commit.md)
  (read from the base commit, a broken file never blocks a review), ADR 0031 (the engine computes
  the risk level).

## Summary (one minute)

Today the files of a review are ordered by a built-in path heuristic (`RISK_RULES` and
`riskScore` in `src/engine.ts`), and the PR confidence grade drops to B for "a file on a high-risk
path" by that heuristic. The maintainer has no say. This design adds a `paths:` list to
`.wachiman.yml`: a glob, a severity (`critical`, `high`, `medium`) and the maintainer's reason. A
changed file that matches a rule is reviewed first, the review quotes the rule and its reason, the
risk map and the grade use the rule's severity instead of the heuristic, and `critical` and `high`
say that a person should approve the change. Wachiman never approves or blocks.

The rules come from the base commit, never from the change under review. A pull request that edits
`paths:` is flagged as touching review policy and is reviewed under the base's rules; its rules
apply after merge.

## Decisions

| # | Decision | Why | ADR |
| --- | --- | --- | --- |
| 1 | Severities are `critical`, `high`, `medium`, a set of their own, separate from finding severities | A path rule says how dangerous a place is; a finding severity says how bad a defect is. Sharing names would suggest a match is a finding | 0058 |
| 2 | A `critical` match does not bypass the size gate's skip on Actions. It orders the file first and at full depth; when the gate skips the run, the skip notice names the matched critical paths and their reasons | The size gate protects the owner's key; a path list must not be a way around it. Naming the paths tells the person what they must read themselves | 0058 |
| 3 | No CODEOWNERS import in the first version | CODEOWNERS says who owns a path, not how dangerous it is; importing it would guess a severity | none |
| 4 | Without `paths:`, today's `riskScore` heuristic is unchanged | No behavior change for repositories that do not opt in | none |
| 5 | The review quotes the rule and the maintainer's `reason`. For `critical` and `high` it adds advisory wording: "a person should approve this change". Wachiman never blocks or approves | Engineering principle 8: the review advises, a person decides | 0058 |
| 6 | The reference to the Claude Code team's article on code review lives in `docs/configuration.md` and in the comment `wachiman init` writes above `paths:`, not in every review comment | Prior art belongs where a maintainer configures the feature, not in every pull request | none |
| 7 | Rules are read from the base commit (Actions) or the merge-base (local), never the head. A pull request that edits `paths:` is flagged as touching review policy, and its new rules apply after merge | Otherwise a change could remove its own path from the list. Not negotiable | 0058 |

## Open questions

None for the first version. Ordering a `medium` match above every heuristic weight (item 1 of
"What a match changes") is a default the owner may tune after use.

## Out of scope

- Importing CODEOWNERS or branch protection.
- A rule that un-excludes a file: a file dropped by the built-in exclude list or
  `WACHIMAN_EXCLUDE` stays dropped, rule or not.
- Blocking, approving or requesting changes. The review stays advisory.
- Changing the built-in `RISK_RULES` table.
- A rule that sets the model or the effort for its files.

## Behavior

### The setting

```yaml
paths:
  - match: ".github/workflows/**"
    severity: critical
    reason: CI can publish releases and read secrets
  - match: "src/billing/**"
    severity: high
    reason: charges customers
```

1. `paths` is an optional list. Each entry has `match` (a glob with the syntax of the exclude
   patterns, matched with `Bun.Glob` against the repository-relative path), `severity` (one of
   `critical`, `high`, `medium`) and `reason` (non-empty text). Unknown keys inside an entry are
   ignored, like unknown top-level keys.
2. A missing `match`, an unknown `severity`, an empty `reason`, an entry that is not a mapping or a
   `paths` that is not a list is a usage error naming the entry. At run time a broken file is
   ignored with one warning and the run continues on the defaults (ADR 0049 decision 5): the pull
   request that fixes the file must be reviewable.
3. When several rules match a file, the most severe wins; on a tie, the first in the file.

### What a match changes

1. **Order.** A matched file scores above every heuristic weight, `critical` above `high` above
   `medium`. `planBatches` takes matched files out of their modules and packs them before every
   other file, across modules, most severe first, then by score and filename; the other files pack
   as before. This holds for tests and documents too: the maintainer named the path. "Full depth"
   means exactly this: the file is in the earliest batches, so a spent budget leaves lower-risk
   files unread before it.
2. **The prompt.** Each matched file's line in the batch's file list carries the rule:
   `path rule <severity> (<match>): <reason>`. The reason is neutralised like other repository text.
3. **The review body.** The risk map lists each matched file with its rule and reason, in place of
   the heuristic's reason. For `critical` and `high` the line ends with "a person should approve
   this change". Wachiman's own wording never says it blocks or approves.
4. **The level and the grade.** `critical` and `high` set the path level to high; `medium` to
   medium. A matched file's level comes from its rule, not from the heuristic, so a rule can also
   lower a file the heuristic scores high. The grade follows the level as it does today
   (`docs/pr-confidence.md`): high gives B, a medium path alone keeps A.
5. **The size gate.** When the gate skips a run on Actions, the notice lists the changed files that
   match a `critical` rule, with their reasons, and says a person should read them. Nothing is sent
   to a model. Local runs are never refused and are unchanged.

### The trust rule

1. Actions reads `.wachiman.yml` at the pull request's base commit for `paths`, whatever the
   workflow inputs set for model and effort (the model and effort read stays as ADR 0049 says).
   Local reads it at the commit the instruction files are read at (`localSettingsCommit`).
2. When `.wachiman.yml` is among the changed files, its head copy is read and its `paths` compared
   with the base's. When they differ, or the head copy cannot be parsed, the review shows a
   **Review policy changed** notice ("this pull request edits the path rules in `.wachiman.yml`; the
   review ran under the rules at the base commit `<sha>`; the change takes effect after merge"), and
   `.wachiman.yml` itself counts as a high-risk path ("edits the review's path rules"), so it is
   read first and the grade is at most B.
3. A change that edits only `model`, `effort` or `kind` is not a path policy change; ADR 0049
   already covers those.

## Acceptance (from the issue)

- A rule from the base branch changes the order and the review text, which a fake-provider test
  shows.
- A pull request that edits `paths:` cannot weaken its own review, which a test shows.
- `docs/configuration.md` documents `paths:`, and the golden prompts are re-recorded with the diff
  reviewed.

## References

- The Claude Code team's account of its review process, section
  [The life of a change](https://claude.dev/blog/solving-code-review-at-anthropic/#the-life-of-a-change):
  "Some paths always need a person". Inspiration, not an endorsement; their results are not
  Wachiman results.
- [Repository review memory](../principles/repository-review-memory.md), "Current boundary": the
  trusted-revision condition this design applies.
