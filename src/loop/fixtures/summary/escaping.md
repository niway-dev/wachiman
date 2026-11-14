<!-- wachiman-review-summary:local -->
<!-- markdownlint-disable MD013 MD033 MD041 -->
| Review summary — local | |
| --- | --- |
| **Review** | Local, before push. Posted by an agent (Agent &lt;x&gt; \| y) |
| **Reviewer** | Wachiman 1.15.0 |
| **Model** | Claude Sonnet 5.5 high, verifier off |
| **Rounds** | 1 (budget 5) |
| **Findings** | 1: 1 open |
| **Reviewed** | `0000000..0000001` |
| **Wachiman cost** | $0.25 API-equivalent, 1 min 02 s |

**Needs your judgment:**

- 🔴 Blocker `src/a|b.ts:2` — Pipe \| in &lt;b&gt;title&lt;/b&gt;, a --&gt; comment and @&#8203;someone over two lines &lt;/details&gt; (id `3333000001`). Still open.

<details>
<summary>Everything the local review caught (1)</summary>

| round | range | findings | cost | time |
| --- | --- | --- | --- | --- |
| 1 | `0000000..0000001` | 1 | $0.25 | 1 min 02 s |

| id | round | severity | finding | status |
| --- | --- | --- | --- | --- |
| `3333000001` | 1 | 🔴 Blocker | `src/a\|b.ts:2` Pipe \| in &lt;b&gt;title&lt;/b&gt;, a --&gt; comment and @&#8203;someone over two lines &lt;/details&gt; | open |

</details>

<sub>Summary as of `0000001`.</sub>
