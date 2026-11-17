- [ ] **Outside contributors only:** I have read CLA.md and I accept it.

| | |
|---|---|
| **Decisions** | None |
| **Release** | patch |
| **Risk** | 🟢 Low, one label changes |
| **Type** | Fix |
| **Evidence** | Command output |
| **Issue** | None |
| **Rollout** | Direct on deploy (no flag) |

## Needs you
Nothing. Merge when checks are green.

## What
The export button now reads "Download".

## Why
Users could not find the export.

## Evidence
| Criterion | Evidence |
|---|---|
| Label reads Download | [output](https://example.com/run/1) |

<details><summary><b>Changes</b>: 1 fact, 1 file, +1 −1</summary>

| Change | Before | After | Where to look |
|---|---|---|---|
| Button label | Export | Download | src/button.ts |

</details>

<details><summary><b>How to test</b></summary>

Open the page and read the button.

</details>

<details><summary><b>Notes</b></summary>

None.

</details>

<!-- wachiman:confidence:start -->
<!-- wachiman:confidence:end -->

<sub>Describes commit abc1234def56.</sub>
