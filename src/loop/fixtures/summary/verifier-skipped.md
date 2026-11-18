<!-- wachiman-review-summary:local -->
<!-- markdownlint-disable MD013 MD033 MD041 -->
| Review summary — local | |
| --- | --- |
| **Review** | Local, before push. Posted by the user |
| **Reviewer** | Wachiman 1.15.0 |
| **Model** | Claude Sonnet 5.5 high, verifier Claude Opus 5.5 high (round 1), Claude Sonnet 5.5 high, verifier skipped (round 2), Claude Sonnet 5.5 high, verifier failed (round 3) |
| **Rounds** | 3 (budget 5 per pass, counted since the loop last converged or started) |
| **Findings** | 1: 1 fixed |
| **Reviewed** | `0000000..0000003` |
| **Wachiman cost** | $0.75 API-equivalent, 3 min 06 s |

<details>
<summary>Everything the local review caught (1)</summary>

| round | range | findings | cost | time |
| --- | --- | --- | --- | --- |
| 1 | `0000000..0000001` | 1 | $0.25 | 1 min 02 s |
| 2 | `0000001..0000002` | 0 | $0.25 | 1 min 02 s |
| 3 | `0000002..0000003` | 0 | $0.25 | 1 min 02 s |

| id | round | severity | finding | status |
| --- | --- | --- | --- | --- |
| `9999000001` | 1 | 🟠 Fix | `src/a.ts:2` Finding 9999000001 | fixed (the cited line changed) |

</details>

<sub>Summary as of `0000003`.</sub>
