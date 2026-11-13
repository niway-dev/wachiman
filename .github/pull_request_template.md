<!-- PR description template. Headings and their order are fixed: pr_body.py check enforces them.
     Anything that fits no section goes in Notes. Never add a new heading. -->

| | |
|---|---|
| **Type** | <!-- One of: Feature, Fix, Refactor, Docs, Chore, CI --> |
| **Issue** | <!-- [NIW2-123: issue title](link), or None --> |
| **Risk** | <!-- 🟢 Low, 🟡 Medium or 🔴 High, then the reason in a few words. Start from `pr_body.py risk`; raise it if you know more, never lower it.
     Risk is what the change touches, not whether it is right: a small, correct change to
     authentication is still High. Whether it is right is the reviewer's grade. --> |
| **Rollout** | <!-- When this reaches users. One of: Direct on deploy (no flag) / New flag `NAME` (default OFF, production OFF) / Existing flag `NAME` (production ON) / Manual step: which / No production effect --> |
| **Release** | <!-- What the release tool will do: No release, patch, minor. Major only if the owner asked for it --> |
| **Evidence** | <!-- What kind exists: Screenshots, Video, Command output, or Not verified: reason. Detail in ## Evidence --> |
| **Decisions** | <!-- Each decision in a few words with a link to its ADR, or None --> |

## Needs you
<!-- Everything only the owner can do or decide: text to read, a decision to accept or veto, a
     manual step, a secret to set. Checkboxes, with the link or the command. If there is nothing:
     "Nothing. Merge when checks are green." -->
**Before merge**
- [ ]

**After merge**
- [ ]

## What
<!-- What changed and the result someone can observe. Two or three sentences, in the reader's
     terms. No file list. -->

## Why
<!-- The problem this solves and why it was needed now. For a defect: the concrete failure. -->

## Evidence
<!-- One row per acceptance criterion of the issue; with no issue, one row per claim this PR
     makes. Evidence is something the owner can open: a screenshot, a recording, an output, a CI
     check by name. A row with no evidence says "not verified: reason". Do not list commands CI
     already runs. -->
| Criterion | Evidence |
|---|---|

## Decisions
<!-- Only decisions a later reader will ask "why this and not that" about. Say what was decided,
     link the ADR by title, and mark the ones the owner may want to veto. Delete this section when
     there are none (the status table then says None). -->
| Decision | Why | Record | Your call? |
|---|---|---|---|

<details><summary><b>Changes</b>: N facts, F files, +A −D</summary>

<!-- One row per thing that is now true, not per file. At most seven rows; group the rest.
     Mechanical bulk is one row ("212 files renamed, no behaviour change"). -->
| Change | Before | After | Where to look |
|---|---|---|---|

</details>

<details><summary><b>How to test</b></summary>

<!-- How the owner reproduces the result: directory, environment, command, input, steps and the
     expected result. Highest risk first. -->

</details>

<details><summary><b>Not verified</b> (N)</summary>

<!-- What was not run or checked, and why. Anything here that the owner must act on also appears
     in Needs you. -->

</details>

<details><summary><b>Checks</b></summary>

<!-- Only commands CI does not run, with their exit codes. -->

</details>

<details><summary><b>Notes</b></summary>

<!-- Context that fits no other section. -->

- [ ] I said whether an AI tool wrote part of this change, and I ran it.
- [ ] **Outside contributors only:** I have read [CLA.md](https://github.com/niway-dev/wachiman/blob/main/CLA.md) and I accept it. NIWAY will
      not merge this pull request without it.

</details>

<!-- wachiman:confidence:start -->
<!-- wachiman:confidence:end -->

<sub>Written by <model>. Changes drafted by <model>. Describes commit <sha>.</sub>
