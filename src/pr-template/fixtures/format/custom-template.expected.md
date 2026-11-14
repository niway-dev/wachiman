| | |
|---|---|
| **Type** | Fix |
| **Issue** | None |
| **Risk** | 🟢 Low, one label changes |
| **Rollout** | Direct on deploy (no flag) |
| **Release** | patch |
| **Evidence** | Command output |
| **Decisions** | None |
| **Ticket** | ABC-1 |

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

## Migration notes
No data moves.

<details><summary><b>Notes</b></summary>

None.

## Decisions
| Decision | Why | Record | Your call? |
|---|---|---|---|
| Keep the old key | Avoids a migration | None | No |

</details>

<!-- wachiman:confidence:start -->
<!-- wachiman:confidence:end -->

<sub>Describes commit abc1234def56.</sub>
