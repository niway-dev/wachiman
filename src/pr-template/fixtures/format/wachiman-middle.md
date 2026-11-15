| | |
|---|---|
| **Type** | Fix |
| **Issue** | None |
| **Risk** | 🟢 Low, one label changes |
| **Rollout** | Direct on deploy (no flag) |
| **Release** | patch |
| **Evidence** | Command output |
| **Decisions** | None |

## Needs you
Nothing. Merge when checks are green.

## What
The export button now reads "Download".

<!-- wachiman:confidence:start -->
Grade: B
<!-- wachiman:confidence:end -->

<sub>Describes commit abc1234def56.</sub>

## Why
Users could not find the export.

## Evidence
| Criterion | Evidence |
|---|---|
| Label reads Download | [output](https://example.com/run/1) |

<details><summary><b>How to test</b></summary>

Open the page and read the button.

</details>
